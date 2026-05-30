use std::process::Stdio;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::anyhow;
use bytes::BytesMut;
use opus::{Application, Bitrate, Channels, Encoder};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;
use tracing::{debug, warn};

use crate::error::{NocturnedError, Result};

const PCM_FRAME_BYTES: usize = 1920;
const PCM_FRAME_SAMPLES: usize = 960;
const OPUS_OUTPUT_BYTES: usize = 4096;
const EVENT_CHANNEL_CAPACITY: usize = 64;
const SILENCE_THRESHOLD_RMS: f32 = 300.0;
const SILENCE_DURATION_MS: u64 = 1500;
const SILENCE_GRACE_PERIOD_MS: u64 = 700;

#[derive(Debug, Clone, PartialEq)]
pub enum AudioEvent {
    Started {
        sample_rate: u32,
        channels: u8,
        frame_ms: u16,
    },
    Data {
        seq: u64,
        opus_data: Vec<u8>,
        timestamp_ms: u64,
    },
    Stopped {
        reason: String,
        total_frames: u64,
    },
    MicLevel {
        level: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioCommand {
    Start,
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioConfig {
    pub sample_rate: u32,
    pub channels: u8,
    pub frame_duration_ms: u16,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 16_000,
            channels: 1,
            frame_duration_ms: 60,
        }
    }
}

pub struct AudioCapture {
    config: AudioConfig,
    event_tx: broadcast::Sender<AudioEvent>,
}

struct RecordingHandle {
    stop_tx: oneshot::Sender<()>,
    done_rx: mpsc::UnboundedReceiver<()>,
    task: JoinHandle<()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureState {
    Idle,
    Recording,
}

impl CaptureState {
    fn apply(self, cmd: AudioCommand) -> Self {
        match (self, cmd) {
            (Self::Idle, AudioCommand::Start) => Self::Recording,
            (Self::Recording, AudioCommand::Stop) => Self::Idle,
            (state, _) => state,
        }
    }
}

impl AudioCapture {
    pub fn new() -> (AudioCapture, broadcast::Receiver<AudioEvent>) {
        let (event_tx, event_rx) = broadcast::channel::<AudioEvent>(EVENT_CHANNEL_CAPACITY);
        (
            Self {
                config: AudioConfig::default(),
                event_tx,
            },
            event_rx,
        )
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AudioEvent> {
        self.event_tx.subscribe()
    }

    pub async fn run(self, mut cmd_rx: mpsc::UnboundedReceiver<AudioCommand>) -> Result<()> {
        let mut state = CaptureState::Idle;
        let mut recording: Option<RecordingHandle> = None;

        loop {
            tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(AudioCommand::Start) => {
                            if recording.is_some() {
                                debug!("audio capture already recording; ignoring start");
                                continue;
                            }

                            let (stop_tx, stop_rx) = oneshot::channel();
                            let (done_tx, done_rx) = mpsc::unbounded_channel();
                            let config = self.config;
                            let event_tx = self.event_tx.clone();
                            let task = tokio::spawn(async move {
                                if let Err(err) = run_recording_task(config, event_tx, stop_rx, done_tx).await {
                                    warn!("audio capture task failed: {}", err);
                                }
                            });

                            recording = Some(RecordingHandle {
                                stop_tx,
                                done_rx,
                                task,
                            });
                            state = state.apply(AudioCommand::Start);
                        }
                        Some(AudioCommand::Stop) => {
                            if let Some(handle) = recording.take() {
                                stop_recording(handle).await;
                                state = state.apply(AudioCommand::Stop);
                            } else {
                                debug!("audio capture already idle; ignoring stop");
                            }
                        }
                        None => {
                            if let Some(handle) = recording.take() {
                                stop_recording(handle).await;
                            }
                            break;
                        }
                    }
                }
                done = async {
                    match recording.as_mut() {
                        Some(handle) => handle.done_rx.recv().await,
                        None => std::future::pending::<Option<()>>().await,
                    }
                } => {
                    if done.is_some() {
                        if let Some(handle) = recording.take() {
                            finish_recording(handle).await;
                        }
                        state = CaptureState::Idle;
                    }
                }
            }
        }

        Ok(())
    }
}

async fn run_recording_task(
    config: AudioConfig,
    event_tx: broadcast::Sender<AudioEvent>,
    mut stop_rx: oneshot::Receiver<()>,
    done_tx: mpsc::UnboundedSender<()>,
) -> Result<()> {
    if let Err(err) = validate_config(config) {
        send_stopped(&event_tx, err.to_string(), 0);
        let _ = done_tx.send(());
        return Err(err);
    }

    let mut child = match spawn_arecord(config) {
        Ok(child) => child,
        Err(err) => {
            send_stopped(&event_tx, err.to_string(), 0);
            let _ = done_tx.send(());
            return Err(err);
        }
    };

    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let err = NocturnedError::General(anyhow!("arecord stdout not piped"));
            send_stopped(&event_tx, err.to_string(), 0);
            let _ = stop_child(&mut child).await;
            let _ = done_tx.send(());
            return Err(err);
        }
    };

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            use tokio::io::AsyncBufReadExt;
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut line = String::new();
            while let Ok(n) = reader.read_line(&mut line).await {
                if n == 0 {
                    break;
                }
                warn!("arecord stderr: {}", line.trim());
                line.clear();
            }
        });
    }

    let mut encoder = match build_encoder() {
        Ok(encoder) => encoder,
        Err(err) => {
            send_stopped(&event_tx, err.to_string(), 0);
            let _ = stop_child(&mut child).await;
            let _ = done_tx.send(());
            return Err(err);
        }
    };

    let mut pcm_buffer = BytesMut::with_capacity(PCM_FRAME_BYTES * 2);
    let mut seq = 0u64;
    let mut total_frames = 0u64;
    let mut started_sent = false;
    let recording_started_at = Instant::now();
    let mut silence_start = None;
    let mut mic_level_counter = 0u64;

    loop {
        tokio::select! {
            _ = &mut stop_rx => {
                let _ = stop_child(&mut child).await;
                send_stopped(&event_tx, "stopped".to_string(), total_frames);
                let _ = done_tx.send(());
                return Ok(());
            }
            frame = next_pcm_frame(&mut stdout, &mut pcm_buffer) => {
                match frame {
                    Ok(Some(pcm_frame)) => {
                        if !started_sent {
                            let _ = event_tx.send(AudioEvent::Started {
                                sample_rate: config.sample_rate,
                                channels: config.channels,
                                frame_ms: config.frame_duration_ms,
                            });
                            started_sent = true;
                        }

                        let now = Instant::now();
                        let within_grace_period = now.duration_since(recording_started_at)
                            < Duration::from_millis(SILENCE_GRACE_PERIOD_MS);
                        let rms = rms_energy(&pcm_frame);

                        mic_level_counter += 1;
                        if mic_level_counter.is_multiple_of(3) {
                            let normalized = normalize_mic_level(rms);
                            let _ = event_tx.send(AudioEvent::MicLevel { level: normalized });

                            if mic_level_counter.is_multiple_of(18) {
                                debug!(
                                    "mic_level: rms={:.1} normalized={:.3}",
                                    rms, normalized
                                );
                            }
                        }

                        if within_grace_period {
                            silence_start = None;
                        } else if rms < SILENCE_THRESHOLD_RMS {
                            let silence_since = silence_start.get_or_insert(now);
                            if now.duration_since(*silence_since)
                                >= Duration::from_millis(SILENCE_DURATION_MS)
                            {
                                let _ = stop_child(&mut child).await;
                                send_stopped(&event_tx, "silence".to_string(), total_frames);
                                let _ = done_tx.send(());
                                return Ok(());
                            }
                        } else {
                            silence_start = None;
                        }

                        let opus_data = encode_pcm_frame(&mut encoder, &pcm_frame)?;
                        let _ = event_tx.send(AudioEvent::Data {
                            seq,
                            opus_data,
                            timestamp_ms: now_ms(),
                        });
                        seq += 1;
                        total_frames += 1;
                    }
                    Ok(None) | Err(_) => {
                        let _ = stop_child(&mut child).await;
                        let reason = if total_frames == 0 { "startup_failed" } else { "arecord_eof" };
                        send_stopped(&event_tx, reason.to_string(), total_frames);
                        let _ = done_tx.send(());
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn validate_config(config: AudioConfig) -> Result<()> {
    if config.sample_rate != 16_000 || config.channels != 1 || config.frame_duration_ms != 60 {
        return Err(NocturnedError::General(anyhow!(
            "audio capture only supports 16kHz mono 60ms frames"
        )));
    }

    Ok(())
}

fn spawn_arecord(config: AudioConfig) -> Result<Child> {
    Command::new("arecord")
        .arg("-D")
        .arg("hw:0,0")
        .arg("-f")
        .arg("S16_LE")
        .arg("-c")
        .arg(config.channels.to_string())
        .arg("-r")
        .arg(config.sample_rate.to_string())
        .arg("-t")
        .arg("raw")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(NocturnedError::from)
}

fn build_encoder() -> Result<Encoder> {
    let mut encoder =
        Encoder::new(16_000, Channels::Mono, Application::Voip).map_err(map_opus_error)?;
    encoder
        .set_bitrate(Bitrate::Bits(24_000))
        .map_err(map_opus_error)?;
    encoder.set_vbr(true).map_err(map_opus_error)?;
    encoder.set_complexity(5).map_err(map_opus_error)?;
    Ok(encoder)
}

async fn next_pcm_frame(
    stdout: &mut ChildStdout,
    pcm_buffer: &mut BytesMut,
) -> std::io::Result<Option<Vec<u8>>> {
    loop {
        if pcm_buffer.len() >= PCM_FRAME_BYTES {
            let frame = pcm_buffer.split_to(PCM_FRAME_BYTES).to_vec();
            return Ok(Some(frame));
        }

        let mut chunk = [0u8; PCM_FRAME_BYTES];
        let bytes_read = stdout.read(&mut chunk).await?;
        if bytes_read == 0 {
            return Ok(None);
        }

        pcm_buffer.extend_from_slice(&chunk[..bytes_read]);
    }
}

fn encode_pcm_frame(encoder: &mut Encoder, pcm_frame: &[u8]) -> Result<Vec<u8>> {
    if pcm_frame.len() != PCM_FRAME_BYTES {
        return Err(NocturnedError::General(anyhow!(
            "invalid pcm frame size: expected {} bytes, got {}",
            PCM_FRAME_BYTES,
            pcm_frame.len()
        )));
    }

    let mut pcm_i16 = [0i16; PCM_FRAME_SAMPLES];
    for (dst, bytes) in pcm_i16.iter_mut().zip(pcm_frame.chunks_exact(2)) {
        *dst = i16::from_le_bytes([bytes[0], bytes[1]]);
    }

    let mut output = vec![0u8; OPUS_OUTPUT_BYTES];
    let written = encoder
        .encode(&pcm_i16, &mut output)
        .map_err(map_opus_error)?;
    output.truncate(written);
    Ok(output)
}

fn rms_energy(pcm_frame: &[u8]) -> f32 {
    let mut sum = 0.0f64;
    let mut count = 0usize;

    for bytes in pcm_frame.chunks_exact(2) {
        let sample = i16::from_le_bytes([bytes[0], bytes[1]]) as f64;
        sum += sample * sample;
        count += 1;
    }

    if count == 0 {
        return 0.0;
    }

    (sum / count as f64).sqrt() as f32
}

fn normalize_mic_level(rms: f32) -> f32 {
    if rms < 1.0 {
        return 0.0;
    }
    const FULL_SCALE: f32 = 32768.0;
    const NOISE_FLOOR_DB: f32 = -72.0;
    const RANGE_DB: f32 = 15.0;
    let dbfs = 20.0 * (rms / FULL_SCALE).log10();
    ((dbfs - NOISE_FLOOR_DB) / RANGE_DB).clamp(0.0, 1.0)
}

async fn stop_child(child: &mut Child) -> Result<()> {
    if let Some(_status) = child.try_wait()? {
        return Ok(());
    }

    child.start_kill()?;
    let _ = child.wait().await?;
    Ok(())
}

async fn stop_recording(handle: RecordingHandle) {
    let _ = handle.stop_tx.send(());
    let _ = handle.task.await;
}

async fn finish_recording(handle: RecordingHandle) {
    let _ = handle.task.await;
}

fn send_stopped(event_tx: &broadcast::Sender<AudioEvent>, reason: String, total_frames: u64) {
    let _ = event_tx.send(AudioEvent::Stopped {
        reason,
        total_frames,
    });
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_millis(0))
        .as_millis() as u64
}

fn map_opus_error(err: opus::Error) -> NocturnedError {
    NocturnedError::General(anyhow::Error::new(err))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_state_transitions_idle_recording_idle() {
        let state = CaptureState::Idle;
        let state = state.apply(AudioCommand::Start);
        assert_eq!(state, CaptureState::Recording);

        let state = state.apply(AudioCommand::Stop);
        assert_eq!(state, CaptureState::Idle);
    }

    #[test]
    fn opus_encoder_produces_non_empty_output() {
        let mut encoder = build_encoder().expect("encoder should initialize");
        let mut pcm_frame = vec![0u8; PCM_FRAME_BYTES];

        for (idx, sample) in pcm_frame.chunks_exact_mut(2).enumerate() {
            let value = ((idx as i16 % 64) - 32) * 512;
            sample.copy_from_slice(&value.to_le_bytes());
        }

        let encoded = encode_pcm_frame(&mut encoder, &pcm_frame).expect("encoding should succeed");
        assert!(!encoded.is_empty());
    }
}
