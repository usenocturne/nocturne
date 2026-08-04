//! Audio capture and wake word detection.

use anyhow::{anyhow, Result};
use bytes::BytesMut;
use tokio::process::Command;

pub(crate) const ARECORD_CAPTURE_DEVICE: &str = "hw:0,0";
pub(crate) const ARECORD_RAW_CHANNELS: &str = "4";
pub(crate) const ARECORD_RAW_SAMPLE_RATE: &str = "48000";
pub(crate) const ARECORD_ARGS: &[&str] = &[
    "-q",
    "-D",
    ARECORD_CAPTURE_DEVICE,
    "-f",
    "S32_LE",
    "-c",
    ARECORD_RAW_CHANNELS,
    "-r",
    ARECORD_RAW_SAMPLE_RATE,
    "-t",
    "raw",
];

const AMIXER_CARD: &str = "0";
const AMIXER_TODDR_A_SRC: &str = "name=TODDR_A SRC SEL";
const AMIXER_TODDR_B_SRC: &str = "name=TODDR_B SRC SEL";
const AMIXER_PDM_CAPTURE_SOURCE: &str = "IN 4";
const RAW_CHANNEL_COUNT: usize = 4;
const RAW_SAMPLE_BYTES: usize = 4;
const RAW_FRAME_BYTES: usize = RAW_CHANNEL_COUNT * RAW_SAMPLE_BYTES;
const DOWNSAMPLE_RATIO: usize = 3;
const PCM_SCALE_SHIFT: u32 = 12;

pub(crate) async fn configure_capture_route() -> Result<()> {
    set_capture_route(AMIXER_TODDR_A_SRC).await?;
    set_capture_route(AMIXER_TODDR_B_SRC).await
}

async fn set_capture_route(control: &'static str) -> Result<()> {
    let output = Command::new("amixer")
        .args([
            "-c",
            AMIXER_CARD,
            "cset",
            control,
            AMIXER_PDM_CAPTURE_SOURCE,
        ])
        .output()
        .await
        .map_err(|err| anyhow!("failed to run amixer for {control}: {err}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(anyhow!(
            "amixer failed for {control}: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[derive(Default)]
pub(crate) struct ARecordPcmConverter {
    raw_buffer: BytesMut,
    downsample_frames: usize,
    downsample_sum: i64,
    wind_frame_tx: Option<wind::WindFrameSender>,
    wind_frames: Vec<wind::RawFrame>,
}

impl ARecordPcmConverter {
    pub(crate) fn with_wind_detection(frame_tx: wind::WindFrameSender) -> Self {
        Self {
            wind_frame_tx: Some(frame_tx),
            wind_frames: Vec::with_capacity(wind::FRAME_BATCH_SIZE),
            ..Self::default()
        }
    }

    pub(crate) fn push_raw(&mut self, raw: &[u8], pcm_out: &mut BytesMut) {
        self.raw_buffer.extend_from_slice(raw);
        while self.raw_buffer.len() >= RAW_FRAME_BYTES {
            let frame = self.raw_buffer.split_to(RAW_FRAME_BYTES);
            let mut raw_frame = [0i32; RAW_CHANNEL_COUNT];
            let mut frame_sum = 0i64;
            for (index, sample) in frame.chunks_exact(RAW_SAMPLE_BYTES).enumerate() {
                let value = i32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
                raw_frame[index] = value;
                frame_sum += i64::from(value);
            }
            if self.wind_frame_tx.is_some() {
                self.wind_frames.push(raw_frame);
                if self.wind_frames.len() == wind::FRAME_BATCH_SIZE {
                    let frames = std::mem::replace(
                        &mut self.wind_frames,
                        Vec::with_capacity(wind::FRAME_BATCH_SIZE),
                    );
                    if let Some(frame_tx) = &self.wind_frame_tx {
                        frame_tx.try_send(frames);
                    }
                }
            }

            self.downsample_sum += frame_sum;
            self.downsample_frames += 1;
            if self.downsample_frames == DOWNSAMPLE_RATIO {
                let sample_count = (DOWNSAMPLE_RATIO * RAW_CHANNEL_COUNT) as i64;
                let averaged = self.downsample_sum / sample_count;
                let pcm =
                    (averaged >> PCM_SCALE_SHIFT).clamp(i16::MIN as i64, i16::MAX as i64) as i16;
                pcm_out.extend_from_slice(&pcm.to_le_bytes());
                self.downsample_frames = 0;
                self.downsample_sum = 0;
            }
        }
    }
}

pub mod capture;
pub mod wakeword;
pub mod wind;

pub use capture::{AudioCapture, AudioCommand, AudioEvent};
pub use wakeword::{threshold_from_env, WakeWordCommand, WakeWordDetector, WakeWordEvent};
pub use wind::start_detector as start_wind_detector;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arecord_args_use_superbird_native_capture_format() {
        assert_eq!(ARECORD_CAPTURE_DEVICE, "hw:0,0");
        assert_eq!(
            ARECORD_ARGS,
            ["-q", "-D", "hw:0,0", "-f", "S32_LE", "-c", "4", "-r", "48000", "-t", "raw"]
        );
    }

    #[test]
    fn converter_downmixes_and_downsamples_split_raw_frames() {
        let mut converter = ARecordPcmConverter::default();
        let mut pcm = BytesMut::new();
        let raw = raw_frames(&[
            [4096 * 10, 4096 * 10, 4096 * 10, 4096 * 10],
            [4096 * 20, 4096 * 20, 4096 * 20, 4096 * 20],
            [4096 * 30, 4096 * 30, 4096 * 30, 4096 * 30],
        ]);

        converter.push_raw(&raw[..5], &mut pcm);
        assert!(pcm.is_empty());
        converter.push_raw(&raw[5..], &mut pcm);

        assert_eq!(pcm.as_ref(), &20i16.to_le_bytes());
    }

    #[test]
    fn converter_clamps_to_i16_range() {
        let mut converter = ARecordPcmConverter::default();
        let mut pcm = BytesMut::new();
        let raw = raw_frames(&[[i32::MAX; 4], [i32::MAX; 4], [i32::MAX; 4]]);

        converter.push_raw(&raw, &mut pcm);

        assert_eq!(pcm.as_ref(), &i16::MAX.to_le_bytes());
    }

    #[tokio::test]
    async fn wind_analysis_does_not_change_converted_pcm() {
        let (wind_frame_tx, _wind_event_rx) = wind::start_detector();
        let mut plain = ARecordPcmConverter::default();
        let mut with_wind = ARecordPcmConverter::with_wind_detection(wind_frame_tx);
        let mut plain_pcm = BytesMut::new();
        let mut wind_pcm = BytesMut::new();
        let frames = (0..wind::FRAME_BATCH_SIZE * 2 + 17)
            .map(|index| {
                [
                    index as i32 * 4096,
                    -(index as i32) * 2048,
                    (index as i32 % 97) * 8192,
                    (index as i32 % 31) * -4096,
                ]
            })
            .collect::<Vec<_>>();
        let raw = raw_frames(&frames);

        for chunk in raw.chunks(137) {
            plain.push_raw(chunk, &mut plain_pcm);
            with_wind.push_raw(chunk, &mut wind_pcm);
        }

        assert_eq!(wind_pcm, plain_pcm);
    }

    fn raw_frames(frames: &[[i32; 4]]) -> Vec<u8> {
        let mut raw = Vec::with_capacity(frames.len() * RAW_FRAME_BYTES);
        for frame in frames {
            for sample in frame {
                raw.extend_from_slice(&sample.to_le_bytes());
            }
        }
        raw
    }
}
