use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::anyhow;
use bytes::BytesMut;
use opus::{Application, Bitrate, Channels, Encoder};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc, oneshot, Semaphore, SemaphorePermit};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::error::{NocturnedError, Result};

const PCM_FRAME_BYTES: usize = 1920;
const PCM_FRAME_SAMPLES: usize = 960;
const _: () = assert!(PCM_FRAME_SAMPLES.is_multiple_of(super::noise_suppression::FRAME_SAMPLES));
const OPUS_OUTPUT_BYTES: usize = 4096;
const EVENT_CHANNEL_CAPACITY: usize = 64;
const SILENCE_THRESHOLD_RMS: f32 = 200.0;
const VAD_ACTIVITY_MIN: f32 = 0.15;
const VAD_CONFIDENT_SPEECH: f32 = 0.75;
const SILENCE_DURATION_MS: u64 = 1500;
const SILENCE_GRACE_PERIOD_MS: u64 = 1500;
const PREROLL_MARGIN: Duration = Duration::from_millis(300);
const RAW_BYTES_PER_MS: usize = 48 * 16;
const PCM_TRACE_MAX_BYTES: usize = 30 * 16_000 * 2;
const RAW_TRACE_MAX_BYTES: usize = 30 * 48_000 * 4 * 4;
const RAW_TRACE_FRAME_BYTES: usize = 4 * 4;
static PCM_TRACE_SLOT: Semaphore = Semaphore::const_new(1);

struct PcmTrace {
    directory: PathBuf,
    started_ms: u64,
    pcm: Vec<u8>,
    raw: Option<RawTrace>,
    _slot: SemaphorePermit<'static>,
}

struct RawTrace {
    bytes: Vec<u8>,
    consumed_bytes: u64,
    priming_target_pcm_frames: usize,
    priming_discarded_pcm_frames: usize,
    source: &'static str,
}

impl RawTrace {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(RAW_TRACE_MAX_BYTES),
            consumed_bytes: 0,
            priming_target_pcm_frames: 0,
            priming_discarded_pcm_frames: 0,
            source: "unavailable",
        }
    }

    fn record(&mut self, chunk: &[u8]) {
        self.consumed_bytes = self.consumed_bytes.saturating_add(chunk.len() as u64);
        let retained = chunk.len().min(RAW_TRACE_MAX_BYTES - self.bytes.len());
        self.bytes.extend_from_slice(&chunk[..retained]);
    }

    fn aligned_bytes(&self) -> &[u8] {
        &self.bytes[..self.bytes.len() / RAW_TRACE_FRAME_BYTES * RAW_TRACE_FRAME_BYTES]
    }
}

impl PcmTrace {
    fn from_env() -> Option<Self> {
        let directory = std::env::var_os("NOCTURNE_AUDIO_TRACE_DIR")?;
        if directory.is_empty() {
            return None;
        }
        let Ok(slot) = PCM_TRACE_SLOT.try_acquire() else {
            warn!("skipping PCM diagnostic trace: previous trace still active");
            return None;
        };
        Some(Self {
            directory: directory.into(),
            started_ms: now_ms(),
            pcm: Vec::with_capacity(PCM_TRACE_MAX_BYTES),
            raw: (std::env::var("NOCTURNE_AUDIO_TRACE_RAW").ok().as_deref() == Some("1"))
                .then(RawTrace::new),
            _slot: slot,
        })
    }

    fn record_encoded(&mut self, frame: &[u8]) {
        if self.pcm.len() + frame.len() <= PCM_TRACE_MAX_BYTES {
            self.pcm.extend_from_slice(frame);
        }
    }

    fn record_raw(&mut self, chunk: &[u8]) {
        if let Some(raw) = self.raw.as_mut() {
            raw.record(chunk);
        }
    }

    fn finish(self, reason: String, total_frames: u64) {
        tokio::spawn(async move {
            if let Err(error) = self.write(&reason, total_frames).await {
                warn!(%error, "failed to write PCM diagnostic trace");
            }
        });
    }

    async fn write(&self, reason: &str, total_frames: u64) -> std::io::Result<()> {
        tokio::fs::create_dir_all(&self.directory).await?;
        let stem = format!("voice-{}-{}", self.started_ms, uuid::Uuid::new_v4());
        let pcm_path = self.directory.join(format!("{stem}.s16le"));
        let metadata_path = self.directory.join(format!("{stem}.json"));
        let mut pcm_file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&pcm_path)
            .await?;
        pcm_file.write_all(&self.pcm).await?;
        pcm_file.flush().await?;
        let trace_frames = self.pcm.len() / PCM_FRAME_BYTES;
        let mut metadata = serde_json::json!({
            "format": "s16le",
            "sample_rate": 16_000,
            "channels": 1,
            "frame_duration_ms": 60,
            "stage": "post_dsp_pre_opus",
            "noise_suppression": "sonora_ns_0.2.0_k12db",
            "endpoint_sidechain": "nnnoiseless_0.5.2",
            "started_ms": self.started_ms,
            "stop_reason": reason,
            "total_encoded_frames": total_frames,
            "trace_frames": trace_frames,
            "trace_bytes": self.pcm.len(),
            "truncated": (trace_frames as u64) < total_frames,
        });
        if let Some(raw) = &self.raw {
            let filename = format!("{stem}.s32le");
            let mut raw_file = tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(self.directory.join(&filename))
                .await?;
            for chunk in raw.aligned_bytes().chunks(64 * 1024) {
                raw_file.write_all(chunk).await?;
            }
            raw_file.flush().await?;
            metadata["raw"] = serde_json::json!({
                "file": filename,
                "format": "s32le",
                "sample_rate": 48_000,
                "channels": 4,
                "stage": "capture_input_pre_dsp",
                "source": raw.source,
                "scope": "all_consumed_input_including_priming_history_preroll_and_conversion_lookahead",
                "priming_target_pcm_frames": raw.priming_target_pcm_frames,
                "priming_discarded_pcm_frames": raw.priming_discarded_pcm_frames,
                "priming_discarded_pcm_samples": raw.priming_discarded_pcm_frames * PCM_FRAME_SAMPLES,
                "consumed_bytes": raw.consumed_bytes,
                "trace_bytes": raw.aligned_bytes().len(),
                "trace_frames": raw.aligned_bytes().len() / RAW_TRACE_FRAME_BYTES,
                "maximum_bytes": RAW_TRACE_MAX_BYTES,
                "truncated": raw.consumed_bytes > raw.aligned_bytes().len() as u64,
                "discarded_partial_frame_bytes": raw.bytes.len() % RAW_TRACE_FRAME_BYTES,
                "encoded_frames_only": false,
            });
        }
        let mut metadata_file = tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(metadata_path)
            .await?;
        metadata_file
            .write_all(metadata.to_string().as_bytes())
            .await?;
        metadata_file.flush().await?;
        info!(path = %pcm_path.display(), total_frames, trace_frames, "PCM diagnostic trace saved locally");
        Ok(())
    }
}

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
    preroll: Arc<super::PreRollBuffer>,
}

struct RecordingHandle {
    stop_tx: oneshot::Sender<()>,
    task: JoinHandle<()>,
}

impl AudioCapture {
    pub fn new(
        preroll: Arc<super::PreRollBuffer>,
    ) -> (AudioCapture, broadcast::Receiver<AudioEvent>) {
        let (event_tx, event_rx) = broadcast::channel::<AudioEvent>(EVENT_CHANNEL_CAPACITY);
        (
            Self {
                config: AudioConfig::default(),
                event_tx,
                preroll,
            },
            event_rx,
        )
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AudioEvent> {
        self.event_tx.subscribe()
    }

    pub async fn run(self, mut cmd_rx: mpsc::UnboundedReceiver<AudioCommand>) -> Result<()> {
        let mut recording: Option<RecordingHandle> = None;

        loop {
            tokio::select! {
                biased;
                result = async {
                    match recording.as_mut() {
                        Some(handle) => (&mut handle.task).await,
                        None => std::future::pending().await,
                    }
                } => {
                    recording.take();
                    observe_recording_exit(result, &self.event_tx);
                }
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(AudioCommand::Start) => {
                            if recording.is_some() {
                                debug!("audio capture already recording; ignoring start");
                                continue;
                            }

                            let (stop_tx, stop_rx) = oneshot::channel();
                            let config = self.config;
                            let event_tx = self.event_tx.clone();
                            let preroll = Arc::clone(&self.preroll);
                            let task = tokio::spawn(async move {
                                if let Err(err) = run_recording_task(config, event_tx, preroll, stop_rx).await {
                                    warn!("audio capture task failed: {}", err);
                                }
                            });

                            recording = Some(RecordingHandle {
                                stop_tx,
                                task,
                            });
                        }
                        Some(AudioCommand::Stop) => {
                            if let Some(handle) = recording.take() {
                                stop_recording(handle, &self.event_tx).await;
                            } else {
                                debug!("audio capture already idle; ignoring stop");
                            }
                        }
                        None => {
                            if let Some(handle) = recording.take() {
                                stop_recording(handle, &self.event_tx).await;
                            }
                            break;
                        }
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
    preroll: Arc<super::PreRollBuffer>,
    stop_rx: oneshot::Receiver<()>,
) -> Result<()> {
    run_recording_task_with(
        config,
        event_tx,
        preroll,
        stop_rx,
        priming_enabled(std::env::var("NOCTURNE_AUDIO_PRIME").ok().as_deref()),
        spawn_arecord(config),
        encode_pcm_frame,
    )
    .await
}

async fn run_recording_task_with(
    config: AudioConfig,
    event_tx: broadcast::Sender<AudioEvent>,
    preroll: Arc<super::PreRollBuffer>,
    mut stop_rx: oneshot::Receiver<()>,
    prime: bool,
    spawn: impl std::future::Future<Output = Result<Child>>,
    mut encode: impl FnMut(&mut Encoder, &[u8]) -> Result<Vec<u8>>,
) -> Result<()> {
    let task_started = Instant::now();
    let mut child = None;
    let mut total_frames = 0u64;
    let mut trace = PcmTrace::from_env();
    let result: Result<String> = async {
        validate_config(config)?;
        let cutoff = task_started.checked_sub(PREROLL_MARGIN).unwrap_or(task_started);
        let continuous = voice_subscription(&preroll, cutoff, prime);
        let priming_frames = continuous.as_ref().map_or(0, |capture| {
            capture.history_before_output_bytes / (RAW_BYTES_PER_MS * 60)
        });
        let preroll_bytes = continuous.as_ref().map_or(0, |capture| {
            capture.source.preroll_bytes - priming_frames * RAW_BYTES_PER_MS * 60
        });
        let mut priming_remaining = priming_frames;
        let mut source = if let Some(continuous) = continuous {
            CaptureSource::Continuous(continuous.source)
        } else {
            let child = child.insert(spawn.await?);
            let stdout = child.stdout.take().ok_or_else(|| {
                NocturnedError::General(anyhow!("arecord stdout not piped"))
            })?;

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

            CaptureSource::Dedicated(stdout)
        };
        if let Some(raw) = trace.as_mut().and_then(|trace| trace.raw.as_mut()) {
            raw.priming_target_pcm_frames = priming_frames;
            raw.source = match &source {
                CaptureSource::Continuous(_) if priming_frames > 0 => "shared_priming_preroll_and_live",
                CaptureSource::Continuous(_) => "shared_preroll_and_live",
                CaptureSource::Dedicated(_) => "dedicated_live",
            };
        }
        let mut encoder = build_encoder()?;

        let mut converter = CapturePcmConverter::new();
        let mut seq = 0u64;
        let mut started_sent = false;
        let mut first_frame_at = None;
        let mut silence_start = None;
        let mut mic_level_counter = 0u64;

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    return Ok("stopped".to_string());
                }
                frame = next_pcm_frame(&mut source, &mut converter, &mut trace) => {
                    match frame {
                        Ok(Some(frame)) => {
                            if discard_priming_frame(&mut priming_remaining, &mut trace) {
                                tokio::task::yield_now().await;
                                continue;
                            }
                            if !started_sent {
                                info!(
                                    preroll_ms = preroll_bytes / RAW_BYTES_PER_MS,
                                    priming_ms = priming_frames * 60,
                                    startup_ms = task_started.elapsed().as_millis() as u64,
                                    continuous = matches!(source, CaptureSource::Continuous(_)),
                                    "voice capture live"
                                );
                                let _ = event_tx.send(AudioEvent::Started {
                                    sample_rate: config.sample_rate,
                                    channels: config.channels,
                                    frame_ms: config.frame_duration_ms,
                                });
                                started_sent = true;
                            }

                            let now = Instant::now();
                            let first_frame = *first_frame_at.get_or_insert(now);
                            let within_grace_period = now.duration_since(first_frame)
                                < Duration::from_millis(SILENCE_GRACE_PERIOD_MS);
                            let rms = rms_energy(&frame.endpoint_pcm);
                            let vad_peak = frame.vad_peak;

                            mic_level_counter += 1;
                            if mic_level_counter.is_multiple_of(3) {
                                let normalized = normalize_mic_level(rms);
                                let _ = event_tx.send(AudioEvent::MicLevel { level: normalized });

                                if mic_level_counter.is_multiple_of(18) {
                                    debug!(
                                        "mic_level: rms={:.1} vad={:?} normalized={:.3}",
                                        rms, vad_peak, normalized
                                    );
                                }
                            }

                            let voice_active = match vad_peak {
                                Some(vad) => {
                                    (rms >= SILENCE_THRESHOLD_RMS && vad >= VAD_ACTIVITY_MIN)
                                        || vad >= VAD_CONFIDENT_SPEECH
                                }
                                None => rms >= SILENCE_THRESHOLD_RMS,
                            };

                            if within_grace_period || voice_active {
                                silence_start = None;
                            } else {
                                let silence_since = silence_start.get_or_insert(now);
                                if now.duration_since(*silence_since)
                                    >= Duration::from_millis(SILENCE_DURATION_MS)
                                {
                                    return Ok("silence".to_string());
                                }
                            }

                            let opus_data = encode(&mut encoder, &frame.pcm)?;
                            if let Some(trace) = trace.as_mut() {
                                trace.record_encoded(&frame.pcm);
                            }
                            let _ = event_tx.send(AudioEvent::Data {
                                seq,
                                opus_data,
                                timestamp_ms: now_ms(),
                            });
                            seq += 1;
                            total_frames += 1;
                        }
                        Err(err) => return Err(err.into()),
                        Ok(None) => {
                            return Err(NocturnedError::General(anyhow!(
                                "dedicated microphone stream ended unexpectedly after {total_frames} frames"
                            )));
                        }
                    }
                }
            }
        }
    }.await;

    if let Some(child) = child.as_mut() {
        if let Err(err) = stop_child(child).await {
            warn!("failed to stop audio capture process: {}", err);
        }
    }
    let reason = match &result {
        Ok(reason) => reason.clone(),
        Err(_) => "cancelled".to_string(),
    };
    send_stopped(&event_tx, reason.clone(), total_frames);
    if let Some(trace) = trace {
        trace.finish(reason, total_frames);
    }
    result.map(|_| ())
}

fn priming_enabled(value: Option<&str>) -> bool {
    value == Some("1")
}

fn voice_subscription(
    preroll: &super::PreRollBuffer,
    cutoff: Instant,
    prime: bool,
) -> Option<super::PrimedVoiceCapture> {
    if prime {
        preroll.subscribe_for_voice_priming(cutoff)
    } else {
        preroll
            .subscribe_since(cutoff)
            .map(|source| super::PrimedVoiceCapture {
                source,
                history_before_output_bytes: 0,
            })
    }
}

fn discard_priming_frame(remaining: &mut usize, trace: &mut Option<PcmTrace>) -> bool {
    if *remaining == 0 {
        return false;
    }
    *remaining -= 1;
    if let Some(raw) = trace.as_mut().and_then(|trace| trace.raw.as_mut()) {
        raw.priming_discarded_pcm_frames += 1;
    }
    true
}

fn validate_config(config: AudioConfig) -> Result<()> {
    if config.sample_rate != 16_000 || config.channels != 1 || config.frame_duration_ms != 60 {
        return Err(NocturnedError::General(anyhow!(
            "audio capture only supports 16kHz mono 60ms frames"
        )));
    }

    Ok(())
}

async fn spawn_arecord(_config: AudioConfig) -> Result<Child> {
    super::configure_capture_route().await?;
    Command::new("arecord")
        .args(super::arecord_args(super::ARECORD_CAPTURE_DEVICE))
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

struct CapturePcmFrame {
    pcm: Vec<u8>,
    endpoint_pcm: Vec<u8>,
    vad_peak: Option<f32>,
}

struct CapturePcmConverter {
    output: super::ARecordPcmConverter,
    endpoint: super::ARecordPcmConverter,
    output_pcm: BytesMut,
    endpoint_pcm: BytesMut,
    suppressor: super::noise_suppression::NoiseSuppressor16k,
}

impl CapturePcmConverter {
    fn new() -> Self {
        Self {
            output: super::ARecordPcmConverter::new(),
            endpoint: super::ARecordPcmConverter::new().with_denoise(),
            output_pcm: BytesMut::with_capacity(PCM_FRAME_BYTES * 2),
            endpoint_pcm: BytesMut::with_capacity(PCM_FRAME_BYTES * 2),
            suppressor: super::noise_suppression::NoiseSuppressor16k::new(),
        }
    }

    fn push_raw(&mut self, raw: &[u8]) {
        self.output.push_raw(raw, &mut self.output_pcm);
        self.endpoint.push_raw(raw, &mut self.endpoint_pcm);
    }

    fn next_frame(&mut self) -> anyhow::Result<Option<CapturePcmFrame>> {
        // RNNoise's block cadence continues to own capture and endpoint timing.
        if self.endpoint_pcm.len() < PCM_FRAME_BYTES {
            return Ok(None);
        }
        if self.output_pcm.len() < PCM_FRAME_BYTES {
            return Err(anyhow!("capture output fell behind its endpoint sidechain"));
        }
        let mut pcm = self.output_pcm.split_to(PCM_FRAME_BYTES).to_vec();
        for block in pcm.chunks_exact_mut(super::noise_suppression::FRAME_SAMPLES * 2) {
            let mut frame = std::array::from_fn(|index| {
                f32::from(i16::from_le_bytes([block[index * 2], block[index * 2 + 1]]))
            });
            self.suppressor.process(&mut frame);
            for (bytes, sample) in block.chunks_exact_mut(2).zip(frame) {
                bytes.copy_from_slice(&(sample as i16).to_le_bytes());
            }
        }
        Ok(Some(CapturePcmFrame {
            pcm,
            endpoint_pcm: self.endpoint_pcm.split_to(PCM_FRAME_BYTES).to_vec(),
            vad_peak: self.endpoint.take_vad_peak(),
        }))
    }
}

enum CaptureSource {
    Continuous(super::ContinuousCapture),
    Dedicated(ChildStdout),
}

async fn next_pcm_frame(
    source: &mut CaptureSource,
    converter: &mut CapturePcmConverter,
    trace: &mut Option<PcmTrace>,
) -> anyhow::Result<Option<CapturePcmFrame>> {
    loop {
        if let CaptureSource::Continuous(source) = source {
            source.validate()?;
        }
        if let Some(frame) = converter.next_frame()? {
            return Ok(Some(frame));
        }

        match source {
            CaptureSource::Continuous(source) => {
                let chunk = source.next_chunk().await?;
                if let Some(trace) = trace.as_mut() {
                    trace.record_raw(&chunk);
                }
                converter.push_raw(&chunk);
            }
            CaptureSource::Dedicated(stdout) => {
                let mut chunk = [0u8; PCM_FRAME_BYTES];
                let bytes_read =
                    tokio::time::timeout(Duration::from_secs(2), stdout.read(&mut chunk))
                        .await
                        .map_err(|_| anyhow!("dedicated microphone stream stalled"))??;
                if bytes_read == 0 {
                    return Ok(None);
                }
                if let Some(trace) = trace.as_mut() {
                    trace.record_raw(&chunk[..bytes_read]);
                }
                converter.push_raw(&chunk[..bytes_read]);
            }
        }
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

async fn stop_recording(handle: RecordingHandle, event_tx: &broadcast::Sender<AudioEvent>) {
    let _ = handle.stop_tx.send(());
    observe_recording_exit(handle.task.await, event_tx);
}

fn observe_recording_exit(
    result: std::result::Result<(), tokio::task::JoinError>,
    event_tx: &broadcast::Sender<AudioEvent>,
) {
    if let Err(err) = result {
        warn!("audio capture task terminated unexpectedly: {}", err);
        send_stopped(event_tx, "cancelled".to_string(), 0);
    }
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
    #[ignore = "requires NOCTURNE_AB_INPUT saved 48 kHz four-channel S32_LE recording"]
    fn benchmark_recorded_capture_sidechain_and_opus() {
        use std::io::Read;

        let input = std::env::var("NOCTURNE_AB_INPUT").expect("set NOCTURNE_AB_INPUT");
        let limit = 30 * 48_000 * 16;
        let metadata = std::fs::metadata(&input).unwrap();
        assert!(metadata.is_file() && metadata.len() <= limit);
        let mut raw = Vec::new();
        std::fs::File::open(input)
            .unwrap()
            .take(limit + 1)
            .read_to_end(&mut raw)
            .unwrap();
        assert!(!raw.is_empty() && raw.len() <= limit as usize && raw.len() % 16 == 0);
        let expected_frames = raw.len() / (48 * 16 * 60);
        assert!(expected_frames > 0);
        let run = |paired: bool, validate: bool| {
            let mut candidate = paired.then(CapturePcmConverter::new);
            let mut previous =
                (!paired).then(|| super::super::ARecordPcmConverter::new().with_denoise());
            let mut pcm = BytesMut::new();
            let mut encoder = build_encoder().unwrap();
            let mut decoder = validate.then(|| opus::Decoder::new(16_000, Channels::Mono).unwrap());
            let mut endpoints = Vec::new();
            let mut output = Vec::new();
            let mut frames = 0;
            let mut total = Duration::ZERO;
            let mut frame_cost = Duration::ZERO;
            let mut maximum = Duration::ZERO;
            for chunk in raw.chunks(super::super::CONTINUOUS_CHUNK_BYTES) {
                let started = Instant::now();
                let frame = if let Some(candidate) = candidate.as_mut() {
                    candidate.push_raw(chunk);
                    candidate.next_frame().unwrap()
                } else {
                    let previous = previous.as_mut().unwrap();
                    previous.push_raw(chunk, &mut pcm);
                    (pcm.len() >= PCM_FRAME_BYTES).then(|| CapturePcmFrame {
                        pcm: pcm.split_to(PCM_FRAME_BYTES).to_vec(),
                        endpoint_pcm: Vec::new(),
                        vad_peak: previous.take_vad_peak(),
                    })
                };
                let encoded = frame.as_ref().map(|frame| {
                    let endpoint = if paired {
                        &frame.endpoint_pcm
                    } else {
                        &frame.pcm
                    };
                    std::hint::black_box((rms_energy(endpoint), frame.vad_peak));
                    encode_pcm_frame(&mut encoder, &frame.pcm).unwrap()
                });
                let elapsed = started.elapsed();
                total += elapsed;
                frame_cost += elapsed;
                if let (Some(frame), Some(encoded)) = (frame, encoded) {
                    assert!(!encoded.is_empty());
                    maximum = maximum.max(frame_cost);
                    frame_cost = Duration::ZERO;
                    frames += 1;
                    if let Some(decoder) = decoder.as_mut() {
                        output.extend_from_slice(&frame.pcm);
                        let mut decoded = [0i16; PCM_FRAME_SAMPLES];
                        assert_eq!(
                            decoder.decode(&encoded, &mut decoded, false).unwrap(),
                            PCM_FRAME_SAMPLES
                        );
                        let endpoint = if paired {
                            frame.endpoint_pcm
                        } else {
                            frame.pcm
                        };
                        endpoints.push((endpoint, frame.vad_peak));
                    }
                }
            }
            assert_eq!(frames, expected_frames);
            if paired && validate {
                if let Some(path) = std::env::var_os("NOCTURNE_AB_OUTPUT") {
                    use std::io::Write;
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)
                        .expect("NOCTURNE_AB_OUTPUT must be a new file");
                    file.write_all(&output).unwrap();
                }
            }
            (endpoints, frames, total, maximum)
        };
        let old = run(false, true);
        let candidate = run(true, true);
        assert_eq!(old.0, candidate.0, "endpoint PCM/VAD must remain exact");
        let repeats = std::env::var("NOCTURNE_AB_REPEATS")
            .map(|value| {
                value
                    .parse::<usize>()
                    .expect("NOCTURNE_AB_REPEATS must be an integer")
            })
            .unwrap_or(0);
        assert!(repeats <= 5);
        println!(
            "capture_validation frames={} endpoint_pcm_vad_exact=true opus_decode_samples={PCM_FRAME_SAMPLES}",
            candidate.1
        );
        for repeat in 1..=repeats {
            for paired in if repeat % 2 == 0 {
                [true, false]
            } else {
                [false, true]
            } {
                let (_, frames, total, maximum) = run(paired, false);
                println!(
                    "capture_benchmark variant={} repeat={repeat} frames={frames} total_ms={:.3} max_frame_processing_ms={:.3}",
                    if paired { "sonora" } else { "rnnoise" },
                    total.as_secs_f64() * 1000.0,
                    maximum.as_secs_f64() * 1000.0,
                );
            }
        }
    }

    #[tokio::test]
    async fn default_voice_subscription_matches_unprimed_snapshot_and_live_audio() {
        for value in [None, Some(""), Some("0"), Some("true"), Some("01")] {
            assert!(!priming_enabled(value));
        }
        assert!(priming_enabled(Some("1")));
        let preroll = super::super::PreRollBuffer::new();
        preroll.push(&[1; 2560]);
        let cutoff = Instant::now();
        preroll.push(&[2; 2560]);
        let mut original = preroll.subscribe_since(cutoff).unwrap();
        let mut selected = voice_subscription(&preroll, cutoff, priming_enabled(None)).unwrap();
        assert_eq!(selected.history_before_output_bytes, 0);
        assert_eq!(selected.source.preroll_bytes, original.preroll_bytes);
        assert_eq!(selected.source.preroll_bytes, 2560);
        preroll.push(&[3; 2560]);
        for expected in [2, 3] {
            let before = original.next_chunk().await.unwrap();
            let after = selected.source.next_chunk().await.unwrap();
            assert_eq!(after, before);
            assert!(after.iter().all(|byte| *byte == expected));
        }
    }

    fn priming_test_raw() -> Vec<u8> {
        (0..48_000 * 320 / 1000)
            .flat_map(|index| {
                let tone = 4000.0 * (index as f64 * 0.09).sin();
                [(tone * 4096.0) as i32; 4]
            })
            .flat_map(i32::to_le_bytes)
            .collect()
    }

    fn sonora_reference(raw: &[u8]) -> Vec<u8> {
        let mut dry = super::super::ARecordPcmConverter::new();
        let mut pcm = BytesMut::new();
        dry.push_raw(raw, &mut pcm);
        let mut suppressor = super::super::noise_suppression::NoiseSuppressor16k::new();
        for block in pcm.chunks_exact_mut(super::super::noise_suppression::FRAME_SAMPLES * 2) {
            let mut samples = std::array::from_fn(|index| {
                f32::from(i16::from_le_bytes([block[index * 2], block[index * 2 + 1]]))
            });
            suppressor.process(&mut samples);
            for (bytes, sample) in block.chunks_exact_mut(2).zip(samples) {
                bytes.copy_from_slice(&(sample as i16).to_le_bytes());
            }
        }
        pcm.to_vec()
    }

    #[test]
    fn recording_sonora_is_chunk_invariant_and_endpoint_evidence_matches_rnnoise() {
        let raw = priming_test_raw();
        let expected = sonora_reference(&raw);
        let expected_bytes = raw.len() / (RAW_BYTES_PER_MS * 60) * PCM_FRAME_BYTES;
        for chunk_size in [1, 17, 2560, 8192, 100_003] {
            let mut converter = CapturePcmConverter::new();
            let mut baseline = super::super::ARecordPcmConverter::new().with_denoise();
            let mut baseline_pcm = BytesMut::new();
            let mut output = Vec::new();
            for chunk in raw.chunks(chunk_size) {
                converter.push_raw(chunk);
                baseline.push_raw(chunk, &mut baseline_pcm);
                while baseline_pcm.len() >= PCM_FRAME_BYTES {
                    let frame = converter.next_frame().unwrap().unwrap();
                    let endpoint = baseline_pcm.split_to(PCM_FRAME_BYTES);
                    assert_eq!(frame.endpoint_pcm, endpoint);
                    assert_eq!(frame.vad_peak, baseline.take_vad_peak());
                    assert_eq!(rms_energy(&frame.endpoint_pcm), rms_energy(&endpoint));
                    output.extend_from_slice(&frame.pcm);
                }
                assert!(converter.next_frame().unwrap().is_none());
            }
            assert_eq!(
                output,
                expected[..expected_bytes],
                "raw chunk size {chunk_size}"
            );
        }
    }

    #[tokio::test]
    async fn voice_priming_discards_only_complete_history_frames_before_encoding() {
        let raw = priming_test_raw();
        let filtered = sonora_reference(&raw);
        let expected = filtered[PCM_FRAME_BYTES..PCM_FRAME_BYTES * 2].to_vec();
        let preroll = Arc::new(super::super::PreRollBuffer::new());
        let history_bytes = 80 * RAW_BYTES_PER_MS;
        preroll.push(&raw[..history_bytes]);
        {
            let mut inner = preroll.inner.lock().unwrap();
            for (received_at, _) in &mut inner.chunks {
                *received_at = Instant::now() - Duration::from_secs(1);
            }
        }
        preroll.push(&raw[history_bytes..]);
        let (event_tx, mut events) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let (_stop_tx, stop_rx) = oneshot::channel();
        let mut encoded = Vec::new();
        let result = run_recording_task_with(
            AudioConfig::default(),
            event_tx,
            Arc::clone(&preroll),
            stop_rx,
            true,
            async { panic!("primed source must not open another recorder") },
            |encoder, pcm| {
                encoded.push(pcm.to_vec());
                preroll.reset_stream();
                encode_pcm_frame(encoder, pcm)
            },
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("reset"));
        assert_eq!(encoded, vec![expected]);
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Started { .. }
        ));
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Data { seq: 0, .. }
        ));
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Stopped {
                total_frames: 1,
                ..
            }
        ));
        assert!(events.try_recv().is_err());
    }

    #[test]
    fn discarded_priming_frames_clear_vad_without_touching_output_count() {
        static TEST_SLOT: Semaphore = Semaphore::const_new(1);
        let raw = priming_test_raw();
        let mut converter = CapturePcmConverter::new();
        let mut reference = super::super::ARecordPcmConverter::new().with_denoise();
        let mut reference_pcm = BytesMut::new();
        converter.push_raw(&raw[..60 * RAW_BYTES_PER_MS]);
        let frame = converter.next_frame().unwrap().unwrap();
        assert_eq!(frame.pcm.len(), PCM_FRAME_BYTES);
        reference.push_raw(&raw[..60 * RAW_BYTES_PER_MS], &mut reference_pcm);
        let reference_vad = reference.take_vad_peak();
        assert!(reference_vad.unwrap() > 0.0);
        assert_eq!(frame.vad_peak, reference_vad);
        assert_eq!(frame.endpoint_pcm, reference_pcm);
        let mut raw_trace = RawTrace::new();
        raw_trace.priming_target_pcm_frames = 3;
        let mut trace = Some(PcmTrace {
            directory: PathBuf::new(),
            started_ms: 0,
            pcm: Vec::new(),
            raw: Some(raw_trace),
            _slot: TEST_SLOT.try_acquire().unwrap(),
        });
        let mut remaining = 3;
        assert!(discard_priming_frame(&mut remaining, &mut trace));
        assert_eq!(remaining, 2);
        assert_eq!(converter.endpoint.take_vad_peak(), Some(0.0));
        let trace = trace.as_ref().unwrap();
        assert!(trace.pcm.is_empty());
        assert_eq!(trace.raw.as_ref().unwrap().priming_discarded_pcm_frames, 1);
        assert_eq!(trace.raw.as_ref().unwrap().priming_target_pcm_frames, 3);
        remaining = 0;
        assert!(!discard_priming_frame(&mut remaining, &mut None));
    }

    #[test]
    fn raw_trace_preserves_split_input_and_caps_on_complete_frames() {
        let mut trace = RawTrace::new();
        let chunk: Vec<u8> = (0..1003).map(|index| (index % 251) as u8).collect();
        let total = RAW_TRACE_MAX_BYTES + 19;
        let mut consumed = 0;
        while consumed < total {
            let count = chunk.len().min(total - consumed);
            trace.record(&chunk[..count]);
            consumed += count;
        }
        assert_eq!(trace.consumed_bytes, total as u64);
        assert_eq!(trace.bytes.len(), RAW_TRACE_MAX_BYTES);
        assert_eq!(trace.bytes.capacity(), RAW_TRACE_MAX_BYTES);
        assert_eq!(trace.aligned_bytes().len() % RAW_TRACE_FRAME_BYTES, 0);
        assert!(trace
            .bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| *byte == chunk[index % chunk.len()]));
        trace.record(&[255; 33]);
        assert_eq!(trace.consumed_bytes, (total + 33) as u64);
        assert_eq!(trace.bytes.len(), RAW_TRACE_MAX_BYTES);
    }

    #[tokio::test]
    async fn raw_trace_writes_owner_only_input_and_honest_lookahead_metadata() {
        use std::os::unix::fs::PermissionsExt;

        static TEST_SLOT: Semaphore = Semaphore::const_new(1);
        let directory = std::env::temp_dir().join(format!("raw-trace-{}", uuid::Uuid::new_v4()));
        let mut raw = RawTrace::new();
        raw.source = "shared_priming_preroll_and_live";
        raw.priming_target_pcm_frames = 3;
        raw.priming_discarded_pcm_frames = 1;
        let input: Vec<u8> = (0..60 * RAW_BYTES_PER_MS + 45)
            .map(|i| (i % 251) as u8)
            .collect();
        raw.record(&input[..3]);
        raw.record(&input[3..19]);
        raw.record(&input[19..]);
        let trace = PcmTrace {
            directory: directory.clone(),
            started_ms: 456,
            pcm: Vec::new(),
            raw: Some(raw),
            _slot: TEST_SLOT.try_acquire().unwrap(),
        };
        assert!(TEST_SLOT.try_acquire().is_err());
        trace.write("cancelled", 0).await.unwrap();
        let mut files = tokio::fs::read_dir(&directory).await.unwrap();
        let mut checked_raw = false;
        let mut checked_metadata = false;
        while let Some(file) = files.next_entry().await.unwrap() {
            let metadata = tokio::fs::metadata(file.path()).await.unwrap();
            assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
            let bytes = tokio::fs::read(file.path()).await.unwrap();
            if file.path().extension().unwrap() == "s32le" {
                assert_eq!(
                    bytes,
                    input[..input.len() / RAW_TRACE_FRAME_BYTES * RAW_TRACE_FRAME_BYTES]
                );
                checked_raw = true;
            } else if file.path().extension().unwrap() == "json" {
                let metadata: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(metadata["total_encoded_frames"], 0);
                assert_eq!(metadata["raw"]["stage"], "capture_input_pre_dsp");
                assert_eq!(metadata["raw"]["source"], "shared_priming_preroll_and_live");
                assert_eq!(metadata["raw"]["priming_target_pcm_frames"], 3);
                assert_eq!(metadata["raw"]["priming_discarded_pcm_frames"], 1);
                assert_eq!(metadata["raw"]["priming_discarded_pcm_samples"], 960);
                assert_eq!(metadata["raw"]["consumed_bytes"], input.len());
                assert_eq!(metadata["raw"]["trace_bytes"], input.len() - 13);
                assert_eq!(
                    metadata["raw"]["trace_frames"],
                    input.len() / RAW_TRACE_FRAME_BYTES
                );
                assert_eq!(metadata["raw"]["discarded_partial_frame_bytes"], 13);
                assert_eq!(metadata["raw"]["encoded_frames_only"], false);
                assert_eq!(metadata["raw"]["truncated"], true);
                checked_metadata = true;
            }
        }
        assert!(checked_raw && checked_metadata);
        drop(trace);
        assert!(TEST_SLOT.try_acquire().is_ok());
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[tokio::test]
    async fn pcm_trace_preserves_frame_order_and_caps_at_thirty_seconds() {
        static TEST_SLOT: Semaphore = Semaphore::const_new(1);
        let directory = std::env::temp_dir().join(format!("pcm-trace-{}", uuid::Uuid::new_v4()));
        let mut trace = PcmTrace {
            directory: directory.clone(),
            started_ms: 123,
            pcm: Vec::with_capacity(PCM_TRACE_MAX_BYTES),
            raw: None,
            _slot: TEST_SLOT.try_acquire().unwrap(),
        };
        let retained_frames = PCM_TRACE_MAX_BYTES / PCM_FRAME_BYTES;
        for index in 0..retained_frames + 2 {
            let frame = vec![index as u8; PCM_FRAME_BYTES];
            trace.record_encoded(&frame);
        }
        assert_eq!(trace.pcm.len(), PCM_TRACE_MAX_BYTES);
        assert_eq!(trace.pcm.capacity(), PCM_TRACE_MAX_BYTES);
        for (index, frame) in trace.pcm.chunks_exact(PCM_FRAME_BYTES).enumerate() {
            assert!(frame.iter().all(|byte| *byte == index as u8));
        }
        trace
            .write("silence", retained_frames as u64 + 2)
            .await
            .unwrap();
        let mut files = tokio::fs::read_dir(&directory).await.unwrap();
        let mut checked_pcm = false;
        let mut checked_metadata = false;
        while let Some(file) = files.next_entry().await.unwrap() {
            let bytes = tokio::fs::read(file.path()).await.unwrap();
            if file.path().extension().unwrap() == "s16le" {
                assert_eq!(bytes, trace.pcm);
                checked_pcm = true;
            } else {
                let metadata: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(metadata["format"], "s16le");
                assert!(metadata.get("raw").is_none());
                assert_eq!(metadata["trace_frames"], retained_frames);
                assert_eq!(metadata["total_encoded_frames"], retained_frames + 2);
                assert_eq!(metadata["stop_reason"], "silence");
                assert_eq!(metadata["truncated"], true);
                checked_metadata = true;
            }
        }
        assert!(checked_pcm && checked_metadata);
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[tokio::test]
    async fn failed_recording_returns_to_idle_and_can_restart() {
        let (mut capture, mut events) =
            AudioCapture::new(Arc::new(super::super::PreRollBuffer::new()));
        capture.config.sample_rate = 0;
        let (commands, command_rx) = mpsc::unbounded_channel();
        let task = tokio::spawn(capture.run(command_rx));
        for _ in 0..2 {
            commands.send(AudioCommand::Start).unwrap();
            let event = tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .unwrap()
                .unwrap();
            assert!(matches!(
                event,
                AudioEvent::Stopped {
                    total_frames: 0,
                    ..
                }
            ));
        }
        commands.send(AudioCommand::Stop).unwrap();
        drop(commands);
        tokio::time::timeout(Duration::from_secs(5), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn unexpected_task_exit_emits_a_terminal_event() {
        let (event_tx, mut events) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let task = tokio::spawn(std::future::pending::<()>());
        task.abort();
        observe_recording_exit(task.await, &event_tx);
        assert_eq!(
            events.try_recv().unwrap(),
            AudioEvent::Stopped {
                reason: "cancelled".to_string(),
                total_frames: 0,
            }
        );
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn encoding_failure_reaps_process_and_emits_one_terminal_event() {
        let (event_tx, mut events) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let (_stop_tx, stop_rx) = oneshot::channel();
        let child = Command::new("cat")
            .arg("/dev/zero")
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let process_id = child.id().unwrap();
        let mut frames = 0;
        let result = tokio::time::timeout(
            Duration::from_secs(5),
            run_recording_task_with(
                AudioConfig::default(),
                event_tx,
                Arc::new(super::super::PreRollBuffer::new()),
                stop_rx,
                false,
                async { Ok(child) },
                |encoder, pcm| {
                    frames += 1;
                    if frames == 2 {
                        return Err(NocturnedError::General(anyhow!("injected encode failure")));
                    }
                    encode_pcm_frame(encoder, pcm)
                },
            ),
        )
        .await
        .unwrap();
        assert!(result.is_err());
        assert!(!std::path::Path::new(&format!("/proc/{process_id}")).exists());
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Started { .. }
        ));
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Data { seq: 0, .. }
        ));
        assert!(
            matches!(events.try_recv().unwrap(), AudioEvent::Stopped { reason, total_frames: 1 }
            if reason == "cancelled")
        );
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn dedicated_eof_cancels_partial_recording_and_next_attempt_starts() {
        let (event_tx, mut events) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let preroll = Arc::new(super::super::PreRollBuffer::new());
        for _ in 0..2 {
            let (_stop_tx, stop_rx) = oneshot::channel();
            let child = Command::new("head")
                .args(["-c", "192000", "/dev/zero"])
                .stdout(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .unwrap();
            let process_id = child.id().unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                run_recording_task_with(
                    AudioConfig::default(),
                    event_tx.clone(),
                    Arc::clone(&preroll),
                    stop_rx,
                    false,
                    async { Ok(child) },
                    encode_pcm_frame,
                ),
            )
            .await
            .unwrap();
            assert!(result
                .unwrap_err()
                .to_string()
                .contains("ended unexpectedly"));
            assert!(!std::path::Path::new(&format!("/proc/{process_id}")).exists());
            assert!(matches!(
                events.try_recv().unwrap(),
                AudioEvent::Started { .. }
            ));
            let mut encoded_frames = 0;
            loop {
                match events.try_recv().unwrap() {
                    AudioEvent::Data { seq, .. } => {
                        assert_eq!(seq, encoded_frames);
                        encoded_frames += 1;
                    }
                    AudioEvent::MicLevel { .. } => {}
                    AudioEvent::Stopped {
                        reason,
                        total_frames,
                    } => {
                        assert_eq!(reason, "cancelled");
                        assert!(encoded_frames > 0);
                        assert_eq!(total_frames, encoded_frames);
                        break;
                    }
                    event => panic!("unexpected event: {event:?}"),
                }
            }
            assert!(events.try_recv().is_err());
        }
    }

    #[tokio::test]
    async fn continuous_capture_never_spawns_dedicated_capture_and_reset_cancels() {
        let (event_tx, mut events) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let (_stop_tx, stop_rx) = oneshot::channel();
        let preroll = Arc::new(super::super::PreRollBuffer::new());
        preroll.push(&vec![0; 48_000 * 16 / 4]);
        let mut frames = 0;
        let result = run_recording_task_with(
            AudioConfig::default(),
            event_tx,
            Arc::clone(&preroll),
            stop_rx,
            false,
            async { panic!("continuous capture must not open independent ALSA device") },
            |encoder, pcm| {
                frames += 1;
                let encoded = encode_pcm_frame(encoder, pcm)?;
                preroll.reset_stream();
                Ok(encoded)
            },
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("reset"));
        assert_eq!(frames, 1);
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Started { .. }
        ));
        assert!(matches!(
            events.try_recv().unwrap(),
            AudioEvent::Data { seq: 0, .. }
        ));
        assert!(
            matches!(events.try_recv().unwrap(), AudioEvent::Stopped { reason, total_frames: 1 } if reason == "cancelled")
        );
        assert!(events.try_recv().is_err());
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
