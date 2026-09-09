//! Audio capture and wake word detection.

use anyhow::{anyhow, Result};
use bytes::{Bytes, BytesMut};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio::process::Command;
use tokio::sync::broadcast;

pub(crate) const ARECORD_WAKEWORD_DEVICE: &str = "hw:0,0";
pub(crate) const ARECORD_CAPTURE_DEVICE: &str = "hw:0,1";
pub(crate) const ARECORD_RAW_CHANNELS: &str = "4";
pub(crate) const ARECORD_RAW_SAMPLE_RATE: &str = "48000";

pub(crate) fn arecord_args(device: &'static str) -> [&'static str; 12] {
    [
        "-q",
        "--fatal-errors",
        "-D",
        device,
        "-f",
        "S32_LE",
        "-c",
        ARECORD_RAW_CHANNELS,
        "-r",
        ARECORD_RAW_SAMPLE_RATE,
        "-t",
        "raw",
    ]
}

const AMIXER_CARD: &str = "0";
const AMIXER_TODDR_A_SRC: &str = "name=TODDR_A SRC SEL";
const AMIXER_TODDR_B_SRC: &str = "name=TODDR_B SRC SEL";
const AMIXER_PDM_CAPTURE_SOURCE: &str = "IN 4";
const RAW_CHANNEL_COUNT: usize = dsp::RAW_CHANNELS;
const RAW_SAMPLE_BYTES: usize = 4;
const RAW_FRAME_BYTES: usize = RAW_CHANNEL_COUNT * RAW_SAMPLE_BYTES;
// The PDM front-end delivers i16-range audio left-shifted into S32 samples.
const RAW_SAMPLE_SCALE: f64 = 4096.0;

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

const RAW_BYTES_PER_SECOND: usize = 48_000 * RAW_FRAME_BYTES;
const CONTINUOUS_CHUNK_BYTES: usize = 2560;
const CONTINUOUS_QUEUE_CHUNKS: usize = 512;
const CONTINUOUS_FRESHNESS: std::time::Duration = std::time::Duration::from_millis(500);
const PREROLL_MAX_BYTES: usize = RAW_BYTES_PER_SECOND * 33 / 10;
const VOICE_PRIMING_MAX_BYTES: usize = RAW_BYTES_PER_SECOND * 3;

pub struct PreRollBuffer {
    inner: std::sync::Mutex<PreRollInner>,
}

struct PreRollInner {
    chunks: std::collections::VecDeque<(std::time::Instant, Bytes)>,
    total_bytes: usize,
    carry: Vec<u8>,
    live: broadcast::Sender<Bytes>,
    generation: Arc<AtomicU64>,
}

impl Default for PreRollInner {
    fn default() -> Self {
        Self {
            chunks: Default::default(),
            total_bytes: 0,
            carry: Vec::new(),
            live: broadcast::channel(CONTINUOUS_QUEUE_CHUNKS).0,
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

pub(crate) struct ContinuousCapture {
    snapshot: std::collections::VecDeque<Bytes>,
    receiver: broadcast::Receiver<Bytes>,
    generation: Arc<AtomicU64>,
    subscribed_generation: u64,
    pub(crate) preroll_bytes: usize,
}

pub(crate) struct PrimedVoiceCapture {
    pub(crate) source: ContinuousCapture,
    pub(crate) history_before_output_bytes: usize,
}

impl ContinuousCapture {
    pub(crate) fn validate(&self) -> Result<()> {
        if self.generation.load(Ordering::Acquire) != self.subscribed_generation {
            return Err(anyhow!("continuous microphone stream reset"));
        }
        if self.receiver.len() > CONTINUOUS_QUEUE_CHUNKS {
            return Err(anyhow!("continuous microphone stream lagged"));
        }
        Ok(())
    }

    pub(crate) async fn next_chunk(&mut self) -> Result<Bytes> {
        self.validate()?;
        if let Some(chunk) = self.snapshot.pop_front() {
            return Ok(chunk);
        }
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(2), self.receiver.recv())
            .await
            .map_err(|_| anyhow!("continuous microphone stream stalled"))?
            .map_err(|err| anyhow!("continuous microphone stream interrupted: {err}"))?;
        self.validate()?;
        Ok(chunk)
    }
}

impl PreRollBuffer {
    pub fn new() -> Self {
        Self {
            inner: std::sync::Mutex::new(PreRollInner::default()),
        }
    }

    pub(crate) fn push(&self, data: &[u8]) {
        let mut inner = self.inner.lock().expect("preroll lock poisoned");
        let mut buffer = std::mem::take(&mut inner.carry);
        buffer.extend_from_slice(data);
        let aligned = buffer.len() - buffer.len() % RAW_FRAME_BYTES;
        if aligned > 0 {
            inner.carry = buffer.split_off(aligned);
            let now = std::time::Instant::now();
            for chunk in buffer.chunks(CONTINUOUS_CHUNK_BYTES) {
                let chunk = Bytes::copy_from_slice(chunk);
                inner.total_bytes += chunk.len();
                let _ = inner.live.send(chunk.clone());
                inner.chunks.push_back((now, chunk));
            }
        } else {
            inner.carry = buffer;
        }
        while inner.total_bytes > PREROLL_MAX_BYTES {
            match inner.chunks.pop_front() {
                Some((_, chunk)) => inner.total_bytes -= chunk.len(),
                None => break,
            }
        }
    }

    pub(crate) fn reset_stream(&self) {
        let mut inner = self.inner.lock().expect("preroll lock poisoned");
        inner.generation.fetch_add(1, Ordering::AcqRel);
        let _ = inner.live.send(Bytes::new());
        inner.chunks.clear();
        inner.total_bytes = 0;
        inner.carry.clear();
    }

    pub(crate) fn subscribe_since(&self, cutoff: std::time::Instant) -> Option<ContinuousCapture> {
        let inner = self.inner.lock().expect("preroll lock poisoned");
        let (latest, _) = inner.chunks.back()?;
        if latest.elapsed() > CONTINUOUS_FRESHNESS {
            return None;
        }
        let snapshot: std::collections::VecDeque<_> = inner
            .chunks
            .iter()
            .filter(|(received_at, _)| *received_at >= cutoff)
            .map(|(_, chunk)| chunk.clone())
            .collect();
        Some(ContinuousCapture {
            preroll_bytes: snapshot.iter().map(Bytes::len).sum(),
            snapshot,
            receiver: inner.live.subscribe(),
            generation: Arc::clone(&inner.generation),
            subscribed_generation: inner.generation.load(Ordering::Acquire),
        })
    }

    pub(crate) fn subscribe_for_voice_priming(
        &self,
        output_cutoff: std::time::Instant,
    ) -> Option<PrimedVoiceCapture> {
        let inner = self.inner.lock().expect("preroll lock poisoned");
        let (latest, _) = inner.chunks.back()?;
        if latest.elapsed() > CONTINUOUS_FRESHNESS {
            return None;
        }
        let history_bytes: usize = inner
            .chunks
            .iter()
            .take_while(|(received_at, _)| *received_at < output_cutoff)
            .map(|(_, chunk)| chunk.len())
            .sum();
        let mut skip = history_bytes.saturating_sub(VOICE_PRIMING_MAX_BYTES);
        let mut snapshot = std::collections::VecDeque::new();
        for (_, chunk) in &inner.chunks {
            let skipped = skip.min(chunk.len());
            skip -= skipped;
            if skipped < chunk.len() {
                snapshot.push_back(chunk.slice(skipped..));
            }
        }
        Some(PrimedVoiceCapture {
            history_before_output_bytes: history_bytes.min(VOICE_PRIMING_MAX_BYTES),
            source: ContinuousCapture {
                preroll_bytes: snapshot.iter().map(Bytes::len).sum(),
                snapshot,
                receiver: inner.live.subscribe(),
                generation: Arc::clone(&inner.generation),
                subscribed_generation: inner.generation.load(Ordering::Acquire),
            },
        })
    }

    #[cfg(test)]
    pub(crate) fn snapshot_since(&self, cutoff: std::time::Instant) -> Vec<u8> {
        let inner = self.inner.lock().expect("preroll lock poisoned");
        let mut out = Vec::new();
        for (received_at, chunk) in &inner.chunks {
            if *received_at >= cutoff {
                out.extend_from_slice(chunk);
            }
        }
        out
    }
}

impl Default for PreRollBuffer {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) struct ARecordPcmConverter {
    raw_buffer: BytesMut,
    high_pass: [dsp::HighPass4; RAW_CHANNEL_COUNT],
    mixer: dsp::WindAwareMixer,
    denoiser: Option<dsp::Denoiser>,
    decimator: dsp::FirDecimator,
    wind_frame_tx: Option<wind::WindFrameSender>,
    wind_frames: Vec<wind::RawFrame>,
}

impl Default for ARecordPcmConverter {
    fn default() -> Self {
        Self::new()
    }
}

impl ARecordPcmConverter {
    pub(crate) fn new() -> Self {
        Self {
            raw_buffer: BytesMut::new(),
            high_pass: std::array::from_fn(|_| dsp::HighPass4::new()),
            mixer: dsp::WindAwareMixer::new(),
            denoiser: None,
            decimator: dsp::FirDecimator::new(),
            wind_frame_tx: None,
            wind_frames: Vec::new(),
        }
    }

    pub(crate) fn with_wind_detection(frame_tx: wind::WindFrameSender) -> Self {
        Self {
            wind_frame_tx: Some(frame_tx),
            wind_frames: Vec::with_capacity(wind::FRAME_BATCH_SIZE),
            ..Self::new()
        }
    }

    pub(crate) fn with_denoise(mut self) -> Self {
        self.denoiser = Some(dsp::Denoiser::new());
        self
    }

    pub(crate) fn take_vad_peak(&mut self) -> Option<f32> {
        self.denoiser.as_mut().map(dsp::Denoiser::take_vad_peak)
    }

    pub(crate) fn push_raw(&mut self, raw: &[u8], pcm_out: &mut BytesMut) {
        self.raw_buffer.extend_from_slice(raw);
        while self.raw_buffer.len() >= RAW_FRAME_BYTES {
            let frame = self.raw_buffer.split_to(RAW_FRAME_BYTES);
            let mut raw_frame = [0i32; RAW_CHANNEL_COUNT];
            for (index, sample) in frame.chunks_exact(RAW_SAMPLE_BYTES).enumerate() {
                raw_frame[index] = i32::from_le_bytes([sample[0], sample[1], sample[2], sample[3]]);
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

            let samples = raw_frame.map(|value| f64::from(value) / RAW_SAMPLE_SCALE);
            let weights = self.mixer.weights(&samples);
            let mut mono = 0.0f64;
            for ch in 0..RAW_CHANNEL_COUNT {
                mono += weights[ch] * self.high_pass[ch].process(samples[ch]);
            }
            let mono = mono as f32;

            match &mut self.denoiser {
                Some(denoiser) => {
                    if let Some(block) = denoiser.push(mono) {
                        for &sample in block {
                            if let Some(out) = self.decimator.push(sample) {
                                write_pcm_sample(pcm_out, out);
                            }
                        }
                    }
                }
                None => {
                    if let Some(out) = self.decimator.push(mono) {
                        write_pcm_sample(pcm_out, out);
                    }
                }
            }
        }
    }
}

#[inline]
fn write_pcm_sample(pcm_out: &mut BytesMut, sample: f32) {
    let clamped = sample
        .round()
        .clamp(f32::from(i16::MIN), f32::from(i16::MAX)) as i16;
    pcm_out.extend_from_slice(&clamped.to_le_bytes());
}

pub mod capture;
pub(crate) mod dsp;
mod noise_suppression;
pub mod wakeword;
pub mod wind;

pub use capture::{AudioCapture, AudioCommand, AudioEvent};
pub use wakeword::{threshold_from_env, WakeWordCommand, WakeWordDetector, WakeWordEvent};
pub use wind::start_detector as start_wind_detector;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arecord_args_use_native_format_and_fail_on_xrun_for_both_sources() {
        assert_eq!(ARECORD_WAKEWORD_DEVICE, "hw:0,0");
        assert_eq!(ARECORD_CAPTURE_DEVICE, "hw:0,1");
        assert_eq!(
            arecord_args(ARECORD_WAKEWORD_DEVICE),
            [
                "-q",
                "--fatal-errors",
                "-D",
                "hw:0,0",
                "-f",
                "S32_LE",
                "-c",
                "4",
                "-r",
                "48000",
                "-t",
                "raw"
            ]
        );
        assert_eq!(
            arecord_args(ARECORD_CAPTURE_DEVICE),
            [
                "-q",
                "--fatal-errors",
                "-D",
                "hw:0,1",
                "-f",
                "S32_LE",
                "-c",
                "4",
                "-r",
                "48000",
                "-t",
                "raw"
            ]
        );
    }

    #[test]
    fn preroll_buffer_keeps_frame_alignment_across_odd_pushes() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        let data: Vec<u8> = (0..3000u32).map(|i| (i % 251) as u8).collect();
        preroll.push(&data[..1000]);
        preroll.push(&data[1000..1003]);
        preroll.push(&data[1003..]);

        let snapshot = preroll.snapshot_since(start);
        assert_eq!(snapshot.len() % RAW_FRAME_BYTES, 0);
        assert_eq!(snapshot.len(), 3000 - (3000 % RAW_FRAME_BYTES));
        assert_eq!(snapshot[..], data[..snapshot.len()]);
    }

    #[test]
    fn preroll_buffer_evicts_oldest_beyond_capacity_and_resets() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        let chunk = vec![7u8; RAW_FRAME_BYTES * 3000]; // 48000 bytes
        for _ in 0..PREROLL_MAX_BYTES / chunk.len() + 2 {
            preroll.push(&chunk);
        }
        let snapshot = preroll.snapshot_since(start);
        assert!(snapshot.len() <= PREROLL_MAX_BYTES);
        assert_eq!(snapshot.len() % RAW_FRAME_BYTES, 0);
        assert!(!snapshot.is_empty());

        preroll.reset_stream();
        assert!(preroll.snapshot_since(start).is_empty());
    }

    #[test]
    fn preroll_snapshot_filters_by_cutoff() {
        let preroll = PreRollBuffer::new();
        let chunk = vec![1u8; RAW_FRAME_BYTES * 4];
        preroll.push(&chunk);
        let after_first = std::time::Instant::now();
        let chunk2 = vec![2u8; RAW_FRAME_BYTES * 4];
        preroll.push(&chunk2);

        let recent = preroll.snapshot_since(after_first);
        assert_eq!(recent, chunk2);
        let all = preroll.snapshot_since(after_first - std::time::Duration::from_secs(1));
        assert_eq!(all.len(), chunk.len() + chunk2.len());
    }

    #[tokio::test]
    async fn voice_priming_snapshot_preserves_atomic_history_and_live_continuity() {
        let preroll = PreRollBuffer::new();
        let raw: Vec<u8> = (0..CONTINUOUS_CHUNK_BYTES * 80)
            .map(|i| (i % 251) as u8)
            .collect();
        let older_bytes = CONTINUOUS_CHUNK_BYTES * 30;
        preroll.push(&raw[..older_bytes]);
        let cutoff = std::time::Instant::now();
        preroll.push(&raw[older_bytes..CONTINUOUS_CHUNK_BYTES * 60]);
        let ordinary = preroll.subscribe_since(cutoff).unwrap();
        assert_eq!(ordinary.preroll_bytes, CONTINUOUS_CHUNK_BYTES * 30);
        let mut voice = preroll.subscribe_for_voice_priming(cutoff).unwrap();
        assert_eq!(voice.history_before_output_bytes, older_bytes);
        assert_eq!(voice.source.preroll_bytes, CONTINUOUS_CHUNK_BYTES * 60);
        preroll.push(&raw[CONTINUOUS_CHUNK_BYTES * 60..CONTINUOUS_CHUNK_BYTES * 60 + 17]);
        preroll.push(&raw[CONTINUOUS_CHUNK_BYTES * 60 + 17..]);
        let mut received = Vec::new();
        while received.len() < raw.len() {
            let chunk = voice.source.next_chunk().await.unwrap();
            assert_eq!(chunk.len() % RAW_FRAME_BYTES, 0);
            received.extend_from_slice(&chunk);
        }
        assert_eq!(received, raw);
        preroll.reset_stream();
        assert!(voice.source.validate().is_err());
    }

    #[test]
    fn voice_priming_history_is_bounded_and_requires_fresh_input() {
        let preroll = PreRollBuffer::new();
        assert!(preroll
            .subscribe_for_voice_priming(std::time::Instant::now())
            .is_none());
        for _ in 0..1100 {
            preroll.push(&[7; CONTINUOUS_CHUNK_BYTES]);
        }
        let now = std::time::Instant::now();
        {
            let mut inner = preroll.inner.lock().unwrap();
            assert!(inner.total_bytes <= PREROLL_MAX_BYTES);
            assert_eq!(PREROLL_MAX_BYTES, RAW_BYTES_PER_SECOND * 33 / 10);
            for (received_at, _) in &mut inner.chunks {
                *received_at = now - std::time::Duration::from_secs(1);
            }
            inner.chunks.back_mut().unwrap().0 = now;
        }
        let voice = preroll.subscribe_for_voice_priming(now).unwrap();
        assert_eq!(voice.history_before_output_bytes, VOICE_PRIMING_MAX_BYTES);
        assert_eq!(
            voice.source.preroll_bytes,
            VOICE_PRIMING_MAX_BYTES + CONTINUOUS_CHUNK_BYTES
        );
        assert!(voice
            .source
            .snapshot
            .iter()
            .all(|chunk| chunk.len() % RAW_FRAME_BYTES == 0));
        preroll.inner.lock().unwrap().chunks.back_mut().unwrap().0 = now - CONTINUOUS_FRESHNESS;
        assert!(preroll.subscribe_for_voice_priming(now).is_none());
    }

    #[tokio::test]
    async fn continuous_capture_preserves_split_frames_across_snapshot_boundary() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        let raw: Vec<u8> = (0..9600).map(|i| (i % 251) as u8).collect();
        preroll.push(&raw[..1003]);
        let mut capture = preroll.subscribe_since(start).unwrap();
        assert_eq!(capture.preroll_bytes, 992);
        preroll.push(&raw[1003..2561]);
        preroll.push(&raw[2561..]);
        let mut actual = Vec::new();
        while actual.len() < raw.len() {
            let chunk = capture.next_chunk().await.unwrap();
            assert_eq!(chunk.len() % RAW_FRAME_BYTES, 0);
            actual.extend_from_slice(&chunk);
        }
        assert_eq!(actual, raw);
    }

    #[tokio::test]
    async fn continuous_capture_rejects_reset_and_overflow_without_skipping_audio() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        preroll.push(&[1; RAW_FRAME_BYTES]);
        let mut reset_capture = preroll.subscribe_since(start).unwrap();
        preroll.reset_stream();
        preroll.push(&[2; RAW_FRAME_BYTES]);
        assert!(reset_capture
            .next_chunk()
            .await
            .unwrap_err()
            .to_string()
            .contains("reset"));
        let mut lagged_capture = preroll.subscribe_since(start).unwrap();
        for _ in 0..=CONTINUOUS_QUEUE_CHUNKS {
            preroll.push(&[3; RAW_FRAME_BYTES]);
        }
        assert!(lagged_capture
            .next_chunk()
            .await
            .unwrap_err()
            .to_string()
            .contains("lagged"));
    }

    #[test]
    fn continuous_capture_requires_a_fresh_source() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        assert!(preroll.subscribe_since(start).is_none());
        preroll.push(&[1; RAW_FRAME_BYTES]);
        preroll.inner.lock().unwrap().chunks.back_mut().unwrap().0 =
            start - CONTINUOUS_FRESHNESS - std::time::Duration::from_millis(1);
        assert!(preroll.subscribe_since(start).is_none());
    }

    #[tokio::test]
    async fn continuous_capture_aborts_when_source_stalls() {
        let preroll = PreRollBuffer::new();
        let start = std::time::Instant::now();
        preroll.push(&[1; RAW_FRAME_BYTES]);
        let mut capture = preroll.subscribe_since(start).unwrap();
        capture.next_chunk().await.unwrap();
        assert!(capture
            .next_chunk()
            .await
            .unwrap_err()
            .to_string()
            .contains("stalled"));
    }

    #[test]
    fn converter_emits_one_pcm_sample_per_three_raw_frames_across_split_pushes() {
        let mut converter = ARecordPcmConverter::new();
        let mut pcm = BytesMut::new();
        let frames = (0..300)
            .map(|i| [(i % 50 - 25) * 4096; 4])
            .collect::<Vec<_>>();
        let raw = raw_frames(&frames);

        converter.push_raw(&raw[..5], &mut pcm);
        assert!(pcm.is_empty());
        converter.push_raw(&raw[5..], &mut pcm);

        assert_eq!(pcm.len(), (frames.len() / 3) * 2);
    }

    #[test]
    fn converter_passes_speech_band_tone_at_unity_and_clamps_extremes() {
        let mut converter = ARecordPcmConverter::new();
        let mut pcm = BytesMut::new();
        let frames = (0..48_000)
            .map(|i| {
                let tone =
                    20_000.0 * (2.0 * std::f64::consts::PI * 1_000.0 * i as f64 / 48_000.0).sin();
                [(tone * RAW_SAMPLE_SCALE) as i32; 4]
            })
            .collect::<Vec<_>>();
        converter.push_raw(&raw_frames(&frames), &mut pcm);

        let samples: Vec<i16> = pcm
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .collect();
        let tail = &samples[4_000..];
        let rms = (tail
            .iter()
            .map(|&s| f64::from(s) * f64::from(s))
            .sum::<f64>()
            / tail.len() as f64)
            .sqrt();
        let expected = 20_000.0 / 2.0f64.sqrt();
        assert!(
            (rms / expected - 1.0).abs() < 0.05,
            "tone rms {rms:.0} vs expected {expected:.0}"
        );
        assert!(tail.iter().all(|&s| s > i16::MIN && s < i16::MAX));

        let mut converter = ARecordPcmConverter::new();
        let mut pcm = BytesMut::new();
        converter.push_raw(&raw_frames(&[[i32::MAX; 4]; 600]), &mut pcm);
        assert!(pcm
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]))
            .any(|s| s == i16::MAX || s == i16::MIN));
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

    #[test]
    #[ignore = "requires NOCTURNE_AB_INPUT (raw 4ch capture) and NOCTURNE_AB_OUT_DIR"]
    fn ab_process_device_recording() {
        let input = std::env::var("NOCTURNE_AB_INPUT").expect("NOCTURNE_AB_INPUT not set");
        let out_dir = std::env::var("NOCTURNE_AB_OUT_DIR").expect("NOCTURNE_AB_OUT_DIR not set");
        let raw = std::fs::read(&input).expect("read raw input");
        let seconds = raw.len() as f64 / (RAW_FRAME_BYTES as f64 * 48_000.0);

        let legacy_started = std::time::Instant::now();
        let mut legacy = Vec::with_capacity(raw.len() / RAW_FRAME_BYTES / 3 * 2);
        let mut sum = 0i64;
        let mut count = 0usize;
        for frame in raw.chunks_exact(RAW_FRAME_BYTES) {
            for sample in frame.chunks_exact(RAW_SAMPLE_BYTES) {
                sum += i64::from(i32::from_le_bytes([
                    sample[0], sample[1], sample[2], sample[3],
                ]));
            }
            count += 1;
            if count == 3 {
                let averaged = sum / (3 * RAW_CHANNEL_COUNT as i64);
                let pcm = (averaged >> 12).clamp(i16::MIN as i64, i16::MAX as i64) as i16;
                legacy.extend_from_slice(&pcm.to_le_bytes());
                sum = 0;
                count = 0;
            }
        }
        let legacy_elapsed = legacy_started.elapsed();

        let run = |denoise: bool| {
            let mut converter = if denoise {
                ARecordPcmConverter::new().with_denoise()
            } else {
                ARecordPcmConverter::new()
            };
            let started = std::time::Instant::now();
            let mut pcm = BytesMut::new();
            let mut vad = Vec::new();
            for chunk in raw.chunks(RAW_FRAME_BYTES * 480) {
                converter.push_raw(chunk, &mut pcm);
                if let Some(peak) = converter.take_vad_peak() {
                    vad.push(peak);
                }
            }
            (pcm.to_vec(), started.elapsed(), vad)
        };
        let (frontend, frontend_elapsed, _) = run(false);
        let (denoised, denoised_elapsed, vad_trace) = run(true);
        let vad_bytes: Vec<u8> = vad_trace.iter().flat_map(|v| v.to_le_bytes()).collect();
        std::fs::write(format!("{out_dir}/vad.f32"), vad_bytes).expect("write vad trace");

        let frame_rms_stats = |pcm: &[u8]| {
            let mut values = Vec::new();
            for frame in pcm.chunks_exact(1920) {
                let sum: f64 = frame
                    .chunks_exact(2)
                    .map(|b| {
                        let s = f64::from(i16::from_le_bytes([b[0], b[1]]));
                        s * s
                    })
                    .sum();
                values.push((sum / 960.0).sqrt());
            }
            values.sort_by(|a, b| a.total_cmp(b));
            let pick = |q: f64| values[(q * (values.len() - 1) as f64) as usize];
            (pick(0.1), pick(0.5), pick(0.9))
        };

        for (name, pcm, elapsed) in [
            ("legacy", &legacy, legacy_elapsed),
            ("frontend", &frontend, frontend_elapsed),
            ("frontend+rnnoise", &denoised, denoised_elapsed),
        ] {
            let (p10, p50, p90) = frame_rms_stats(pcm);
            println!(
                "{name}: {:.1}x realtime, 60ms-frame RMS p10/p50/p90 = {p10:.0}/{p50:.0}/{p90:.0}",
                seconds / elapsed.as_secs_f64()
            );
            let path = format!("{out_dir}/{}.pcm", name.replace('+', "_"));
            std::fs::write(&path, pcm).expect("write output pcm");
        }
    }
}
