use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::anyhow;
use bytes::BytesMut;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};
use tokio::process::{Child, ChildStderr, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc};
use tokio::time::sleep;
use tracing::{debug, info, warn};
use tract_onnx::prelude::*;

use crate::error::{NocturnedError, Result};

const SHARED_MODELS: &[&str] = &["melspectrogram.onnx", "embedding_model.onnx"];

const FRAME_SAMPLES: usize = 1_280;
const FRAME_BYTES: usize = FRAME_SAMPLES * 2;
const MEL_OVERLAP_SAMPLES: usize = 480; // 160 * 3 — STFT context from previous chunk
const MEL_INPUT_SAMPLES: usize = FRAME_SAMPLES + MEL_OVERLAP_SAMPLES;
const MEL_BINS: usize = 32;
const MEL_WINDOW_SIZE: usize = 76;
const MEL_SLIDE_STEP: usize = 8;
const EMBEDDING_SIZE: usize = 96;
const EMBEDDING_WINDOW: usize = 16;
const MAX_EMBEDDINGS: usize = 120;
const EVENT_CHANNEL_CAPACITY: usize = 16;
const SCORE_SUPPORT_WINDOW: usize = 3;
const SCORE_SUPPORT_REQUIRED: usize = SCORE_SUPPORT_WINDOW;
const RESTART_DELAY: Duration = Duration::from_millis(250);
const PREFERENCE_PATH: &str = "/var/lib/wakeword.state";

pub fn threshold_from_env(name: &str, default: f32) -> f32 {
    match std::env::var(name) {
        Ok(raw) => match parse_threshold(&raw) {
            Some(value) => value,
            None => {
                warn!(
                    name,
                    value = raw,
                    default,
                    "Ignoring invalid wake word threshold"
                );
                default
            }
        },
        Err(std::env::VarError::NotPresent) => default,
        Err(err) => {
            warn!(name, default, "Failed to read wake word threshold: {err}");
            default
        }
    }
}

fn parse_threshold(raw: &str) -> Option<f32> {
    let value = raw.parse::<f32>().ok()?;
    (value.is_finite() && (0.0 < value && value <= 1.0)).then_some(value)
}

async fn load_preference_muted() -> bool {
    if !Path::new(PREFERENCE_PATH).exists() {
        return false;
    }
    match fs::read_to_string(PREFERENCE_PATH).await {
        Ok(content) => content.trim() == "paused",
        Err(err) => {
            warn!("Failed to read persisted wake word preference: {}", err);
            false
        }
    }
}

async fn save_preference_muted(muted: bool) {
    let content = if muted { "paused" } else { "running" };
    if let Err(err) = fs::write(PREFERENCE_PATH, content).await {
        warn!("Failed to persist wake word preference: {}", err);
    }
}

async fn persist_and_notify(event_tx: &broadcast::Sender<WakeWordEvent>, muted: bool) {
    save_preference_muted(muted).await;
    let _ = event_tx.send(WakeWordEvent::StateChanged { muted });
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WakeWordPauseState {
    user_muted: bool,
    recording_suppressed: bool,
}

impl WakeWordPauseState {
    fn new(user_muted: bool) -> Self {
        Self {
            user_muted,
            recording_suppressed: false,
        }
    }

    fn is_paused(self) -> bool {
        self.user_muted || self.recording_suppressed
    }

    fn pause(&mut self, persist: bool) -> Option<bool> {
        if persist {
            self.user_muted = true;
            Some(true)
        } else {
            self.recording_suppressed = true;
            None
        }
    }

    fn resume(&mut self, persist: bool) -> Option<bool> {
        if persist {
            self.user_muted = false;
            Some(false)
        } else {
            self.recording_suppressed = false;
            None
        }
    }
}

#[derive(Debug, Clone)]
pub enum WakeWordEvent {
    Detected { keyword: String, confidence: f32 },
    StateChanged { muted: bool },
}

pub enum WakeWordCommand {
    Pause {
        ack: Option<tokio::sync::oneshot::Sender<()>>,
        persist: bool,
    },
    Resume {
        persist: bool,
    },
    RejectDetection,
}

pub struct WakeWordDetector {
    models_dir: String,
    activation_threshold: f32,
    support_threshold: f32,
    playback_threshold: f32,
    playback_active: Arc<AtomicBool>,
    event_tx: broadcast::Sender<WakeWordEvent>,
    wind_frame_tx: super::wind::WindFrameSender,
}

impl WakeWordDetector {
    pub fn new(
        models_dir: String,
        activation_threshold: f32,
        support_threshold: f32,
        playback_threshold: f32,
        playback_active: Arc<AtomicBool>,
        wind_frame_tx: super::wind::WindFrameSender,
    ) -> (Self, broadcast::Receiver<WakeWordEvent>) {
        let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        let support_threshold = if support_threshold > activation_threshold {
            warn!(
                support_threshold,
                activation_threshold,
                "Wake word support threshold exceeds activation threshold; using activation threshold"
            );
            activation_threshold
        } else {
            support_threshold
        };
        (
            Self {
                models_dir,
                activation_threshold,
                support_threshold,
                playback_threshold,
                playback_active,
                event_tx,
                wind_frame_tx,
            },
            event_rx,
        )
    }

    pub async fn run(self, mut cmd_rx: mpsc::UnboundedReceiver<WakeWordCommand>) -> Result<()> {
        let models_dir = PathBuf::from(&self.models_dir);
        let models = tokio::task::spawn_blocking(move || load_models(&models_dir))
            .await
            .map_err(|err| {
                NocturnedError::General(anyhow!("wake word model loader failed: {err}"))
            })??;
        let LoadedModels {
            melspectrogram,
            embedding_model,
            classifiers,
        } = models;
        if classifiers.is_empty() {
            warn!(
                "No wake word classifier models found in {}",
                self.models_dir
            );
            return Ok(());
        }
        for (name, _) in &classifiers {
            info!("Loaded wake word model: {}", name);
        }
        let mut score_gates = (0..classifiers.len())
            .map(|_| WakeWordScoreGate::new(self.support_threshold))
            .collect::<Vec<_>>();
        let mut last_playback_active = self.playback_active.load(Ordering::Relaxed);

        let mut pause_state = WakeWordPauseState::new(load_preference_muted().await);
        if pause_state.user_muted {
            info!("Wake word detector starting in paused state (persisted preference)");
        }
        let _ = self.event_tx.send(WakeWordEvent::StateChanged {
            muted: pause_state.user_muted,
        });
        let mut child = None;
        let mut stdout = None;
        let mut pcm_buffer = BytesMut::with_capacity(FRAME_BYTES * 2);
        let mut converter =
            super::ARecordPcmConverter::with_wind_detection(self.wind_frame_tx.clone());
        let mut mel_overlap: Vec<f32> = vec![0.0; MEL_OVERLAP_SAMPLES];
        let mut mel_buffer: Vec<[f32; MEL_BINS]> = Vec::new();
        let mut mel_frames_since_embed: usize = 0;
        let mut embeddings: VecDeque<[f32; EMBEDDING_SIZE]> =
            VecDeque::with_capacity(MAX_EMBEDDINGS);
        let mut candidate_pending = false;

        loop {
            if pause_state.is_paused() {
                if let Some(mut active_child) = child.take() {
                    let _ = stop_child(&mut active_child).await;
                }
                stdout = None;
                pcm_buffer.clear();
                converter =
                    super::ARecordPcmConverter::with_wind_detection(self.wind_frame_tx.clone());
                mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                mel_buffer.clear();
                mel_frames_since_embed = 0;
                embeddings.clear();
                score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                candidate_pending = false;

                loop {
                    match cmd_rx.recv().await {
                        Some(WakeWordCommand::Resume { persist }) => {
                            if let Some(muted) = pause_state.resume(persist) {
                                persist_and_notify(&self.event_tx, muted).await;
                            }
                            if !pause_state.is_paused() {
                                info!("Resuming wake word detection");
                                break;
                            }
                        }
                        Some(WakeWordCommand::Pause { ack, persist }) => {
                            if let Some(muted) = pause_state.pause(persist) {
                                persist_and_notify(&self.event_tx, muted).await;
                            }
                            if let Some(tx) = ack {
                                let _ = tx.send(());
                            }
                        }
                        Some(WakeWordCommand::RejectDetection) => {
                            score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                        }
                        None => return Ok(()),
                    }
                }

                continue;
            }

            if stdout.is_none() {
                match spawn_arecord().await {
                    Ok(mut spawned_child) => match spawned_child.stdout.take() {
                        Some(spawned_stdout) => {
                            if let Some(stderr) = spawned_child.stderr.take() {
                                tokio::spawn(log_arecord_stderr(stderr));
                            }
                            info!("Wake word listener started");
                            child = Some(spawned_child);
                            stdout = Some(spawned_stdout);
                            pcm_buffer.clear();
                            converter = super::ARecordPcmConverter::with_wind_detection(
                                self.wind_frame_tx.clone(),
                            );
                            mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                            mel_buffer.clear();
                            mel_frames_since_embed = 0;
                            embeddings.clear();
                            score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                            candidate_pending = false;
                        }
                        None => {
                            warn!("wake word arecord stdout not piped");
                            let _ = stop_child(&mut spawned_child).await;
                            sleep(RESTART_DELAY).await;
                            continue;
                        }
                    },
                    Err(err) => {
                        warn!("failed to start wake word arecord: {}", err);
                        sleep(RESTART_DELAY).await;
                        continue;
                    }
                }
            }

            let frame_result = tokio::select! {
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(WakeWordCommand::Pause { ack, persist }) => {
                            let notify_muted = pause_state.pause(persist);
                            if let Some(mut active_child) = child.take() {
                                let _ = stop_child(&mut active_child).await;
                            }
                            stdout = None;
                            pcm_buffer.clear();
                            converter = super::ARecordPcmConverter::with_wind_detection(
                                self.wind_frame_tx.clone(),
                            );
                            mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                            mel_buffer.clear();
                            mel_frames_since_embed = 0;
                            embeddings.clear();
                            score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                            candidate_pending = false;
                            if let Some(muted) = notify_muted {
                                persist_and_notify(&self.event_tx, muted).await;
                            }
                            if let Some(tx) = ack {
                                let _ = tx.send(());
                            }
                            continue;
                        }
                        Some(WakeWordCommand::Resume { persist }) => {
                            if let Some(muted) = pause_state.resume(persist) {
                                persist_and_notify(&self.event_tx, muted).await;
                            }
                            continue;
                        }
                        Some(WakeWordCommand::RejectDetection) => {
                            score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                            candidate_pending = false;
                            continue;
                        }
                        None => {
                            if let Some(mut active_child) = child.take() {
                                let _ = stop_child(&mut active_child).await;
                            }
                            return Ok(());
                        }
                    }
                }

                frame = async {
                    let stdout = stdout.as_mut().ok_or_else(|| {
                        std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "wake word stdout unavailable")
                    })?;
                    next_pcm_frame(stdout, &mut converter, &mut pcm_buffer).await
                } => frame,
            };

            let pcm_frame = match frame_result {
                Ok(Some(frame)) => frame,
                Ok(None) => {
                    warn!("wake word arecord exited; restarting listener");
                    if let Some(mut active_child) = child.take() {
                        let _ = stop_child(&mut active_child).await;
                    }
                    stdout = None;
                    pcm_buffer.clear();
                    converter =
                        super::ARecordPcmConverter::with_wind_detection(self.wind_frame_tx.clone());
                    mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                    mel_buffer.clear();
                    mel_frames_since_embed = 0;
                    embeddings.clear();
                    score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                    candidate_pending = false;
                    sleep(RESTART_DELAY).await;
                    continue;
                }
                Err(err) => {
                    warn!("wake word audio read failed: {}", err);
                    if let Some(mut active_child) = child.take() {
                        let _ = stop_child(&mut active_child).await;
                    }
                    stdout = None;
                    pcm_buffer.clear();
                    converter =
                        super::ARecordPcmConverter::with_wind_detection(self.wind_frame_tx.clone());
                    mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                    mel_buffer.clear();
                    mel_frames_since_embed = 0;
                    embeddings.clear();
                    score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
                    candidate_pending = false;
                    sleep(RESTART_DELAY).await;
                    continue;
                }
            };

            let audio_f32 = pcm_to_f32(&pcm_frame);
            let mut mel_input_data = Vec::with_capacity(MEL_INPUT_SAMPLES);
            mel_input_data.extend_from_slice(&mel_overlap);
            mel_input_data.extend_from_slice(&audio_f32);
            mel_overlap = audio_f32[audio_f32.len() - MEL_OVERLAP_SAMPLES..].to_vec();
            let mel_input =
                tract_ndarray::Array2::from_shape_vec((1, MEL_INPUT_SAMPLES), mel_input_data)
                    .map_err(|err| NocturnedError::General(anyhow!(err)))?;
            let mel_result = melspectrogram.run(tvec![mel_input.into_tvalue()])?;
            let mel_shape = mel_result[0].shape().to_vec();
            let mel_data = mel_result[0]
                .as_slice::<f32>()
                .map_err(|e| NocturnedError::General(anyhow!(e)))?;

            if mel_frames_since_embed == 0 && mel_buffer.is_empty() {
                debug!(
                    "Mel model output shape: {:?} ({} values)",
                    mel_shape,
                    mel_data.len()
                );
            }

            let num_bins = if mel_shape.len() >= 2 {
                *mel_shape.last().unwrap()
            } else {
                MEL_BINS
            };
            let num_mel_frames = mel_data.len() / num_bins;
            for frame_idx in 0..num_mel_frames {
                let mut frame = [0f32; MEL_BINS];
                for bin in 0..num_bins.min(MEL_BINS) {
                    frame[bin] = mel_data[frame_idx * num_bins + bin] / 10.0 + 2.0;
                }
                mel_buffer.push(frame);
                mel_frames_since_embed += 1;
            }

            if mel_buffer.len() >= MEL_WINDOW_SIZE && mel_frames_since_embed >= MEL_SLIDE_STEP {
                let start = mel_buffer.len() - MEL_WINDOW_SIZE;
                let embed_input = tract_ndarray::Array4::from_shape_fn(
                    (1, MEL_WINDOW_SIZE, MEL_BINS, 1),
                    |(_, f, b, _)| mel_buffer[start + f][b],
                );
                let embed_result = embedding_model.run(tvec![embed_input.into_tvalue()])?;
                let embed_view = embed_result[0].to_array_view::<f32>()?;

                let mut embedding = [0f32; EMBEDDING_SIZE];
                let Some(embed_slice) = embed_view.as_slice() else {
                    warn!("wake word embedding output was not contiguous");
                    continue;
                };
                if embed_slice.len() < EMBEDDING_SIZE {
                    warn!(
                        expected = EMBEDDING_SIZE,
                        actual = embed_slice.len(),
                        "wake word embedding output was shorter than expected"
                    );
                    continue;
                }
                embedding.copy_from_slice(&embed_slice[..EMBEDDING_SIZE]);

                if embeddings.len() == MAX_EMBEDDINGS {
                    embeddings.pop_front();
                }
                embeddings.push_back(embedding);
                mel_frames_since_embed = 0;

                if mel_buffer.len() > MEL_WINDOW_SIZE + MEL_SLIDE_STEP * 4 {
                    let drain_to = mel_buffer.len() - MEL_WINDOW_SIZE;
                    mel_buffer.drain(..drain_to);
                }
            }

            if embeddings.len() < EMBEDDING_WINDOW {
                continue;
            }

            let recent: Vec<&[f32; EMBEDDING_SIZE]> = embeddings
                .iter()
                .rev()
                .take(EMBEDDING_WINDOW)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let cls_input = tract_ndarray::Array3::from_shape_fn(
                (1, EMBEDDING_WINDOW, EMBEDDING_SIZE),
                |(_, f, feat)| recent[f][feat],
            );

            let effective_threshold = threshold_for_playback_state(
                self.playback_active.load(Ordering::Relaxed),
                &mut last_playback_active,
                &mut score_gates,
                self.activation_threshold,
                self.playback_threshold,
            );

            for (model_index, (keyword, cls_model)) in classifiers.iter().enumerate() {
                let cls_result = cls_model.run(tvec![cls_input.clone().into_tvalue()])?;
                let confidence = cls_result[0]
                    .as_slice::<f32>()
                    .map_err(|e| NocturnedError::General(anyhow!(e)))?
                    .first()
                    .copied()
                    .unwrap_or(0.0);

                let gate = &mut score_gates[model_index];
                let confirmed_confidence =
                    gate.observe_at_threshold(confidence, effective_threshold);
                if candidate_pending {
                    continue;
                }
                if let Some(confirmed_confidence) = confirmed_confidence {
                    debug!(
                        "Wake word '{}' confirmed at confidence {:.3}",
                        keyword, confirmed_confidence
                    );
                    if self
                        .event_tx
                        .send(WakeWordEvent::Detected {
                            keyword: keyword.clone(),
                            confidence: confirmed_confidence,
                        })
                        .is_ok()
                    {
                        candidate_pending = true;
                    }
                    break;
                } else if confidence >= effective_threshold {
                    debug!(
                        keyword,
                        confidence,
                        effective_threshold,
                        supporting_frames = gate.supporting_frames(),
                        required_frames = SCORE_SUPPORT_REQUIRED,
                        "Wake word candidate awaiting temporal confirmation"
                    );
                }
            }
        }
    }
}

#[derive(Debug)]
struct WakeWordScoreGate {
    support_threshold: f32,
    scores: VecDeque<f32>,
}

impl WakeWordScoreGate {
    fn new(support_threshold: f32) -> Self {
        Self {
            support_threshold,
            scores: VecDeque::with_capacity(SCORE_SUPPORT_WINDOW),
        }
    }

    #[cfg(test)]
    fn observe(&mut self, score: f32) -> Option<f32> {
        self.observe_at_threshold(score, 0.65)
    }

    fn observe_at_threshold(&mut self, score: f32, activation_threshold: f32) -> Option<f32> {
        if !score.is_finite() {
            self.reset();
            return None;
        }

        if self.scores.len() == SCORE_SUPPORT_WINDOW {
            self.scores.pop_front();
        }
        self.scores.push_back(score);

        let peak = self.scores.iter().copied().fold(0.0f32, f32::max);
        if peak < activation_threshold || self.supporting_frames() < SCORE_SUPPORT_REQUIRED {
            return None;
        }

        Some(peak)
    }

    fn supporting_frames(&self) -> usize {
        self.scores
            .iter()
            .filter(|score| **score >= self.support_threshold)
            .count()
    }

    fn reset(&mut self) {
        self.scores.clear();
    }
}

fn threshold_for_playback_state(
    playback_active: bool,
    last_playback_active: &mut bool,
    score_gates: &mut [WakeWordScoreGate],
    activation_threshold: f32,
    playback_threshold: f32,
) -> f32 {
    if playback_active != *last_playback_active {
        score_gates.iter_mut().for_each(WakeWordScoreGate::reset);
        *last_playback_active = playback_active;
    }

    if playback_active {
        playback_threshold
    } else {
        activation_threshold
    }
}

type RunModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

struct LoadedModels {
    melspectrogram: RunModel,
    embedding_model: RunModel,
    classifiers: Vec<(String, RunModel)>,
}

fn load_models(models_dir: &Path) -> Result<LoadedModels> {
    let melspectrogram = tract_onnx::onnx()
        .model_for_path(model_path(models_dir, "melspectrogram.onnx"))?
        .with_input_fact(0, f32::fact([1, MEL_INPUT_SAMPLES]).into())?
        .into_optimized()?
        .into_runnable()?;
    let embedding_model = tract_onnx::onnx()
        .model_for_path(model_path(models_dir, "embedding_model.onnx"))?
        .with_input_fact(0, f32::fact([1, MEL_WINDOW_SIZE, MEL_BINS, 1]).into())?
        .into_optimized()?
        .into_runnable()?;
    let classifiers = load_classifiers(models_dir)?;

    Ok(LoadedModels {
        melspectrogram,
        embedding_model,
        classifiers,
    })
}

fn load_classifiers(models_dir: &Path) -> Result<Vec<(String, RunModel)>> {
    let mut classifiers = Vec::new();
    let entries = std::fs::read_dir(models_dir)
        .map_err(|e| NocturnedError::General(anyhow!("failed to read models dir: {}", e)))?;

    for entry in entries {
        let entry = entry.map_err(|e| NocturnedError::General(anyhow!(e)))?;
        let path = entry.path();

        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        if !file_name.ends_with(".onnx") || SHARED_MODELS.contains(&file_name.as_str()) {
            continue;
        }

        let keyword = file_name.trim_end_matches(".onnx").to_string();
        match tract_onnx::onnx()
            .model_for_path(&path)
            .and_then(|m| {
                m.with_input_fact(0, f32::fact([1, EMBEDDING_WINDOW, EMBEDDING_SIZE]).into())
            })
            .and_then(|m| m.into_optimized())
            .and_then(|m| m.into_runnable())
        {
            Ok(model) => classifiers.push((keyword, model)),
            Err(e) => warn!("Skipping {}: {}", file_name, e),
        }
    }

    Ok(classifiers)
}

fn model_path(models_dir: &Path, file_name: &str) -> PathBuf {
    models_dir.join(file_name)
}

async fn spawn_arecord() -> Result<Child> {
    super::configure_capture_route().await?;
    Command::new("arecord")
        .args(super::ARECORD_ARGS)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(NocturnedError::from)
}

async fn log_arecord_stderr(stderr: ChildStderr) {
    let mut reader = tokio::io::BufReader::new(stderr);
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => warn!("wake word arecord stderr: {}", line.trim()),
            Err(err) => {
                warn!("wake word arecord stderr read failed: {}", err);
                break;
            }
        }
    }
}

async fn next_pcm_frame(
    stdout: &mut ChildStdout,
    converter: &mut super::ARecordPcmConverter,
    pcm_buffer: &mut BytesMut,
) -> std::io::Result<Option<Vec<u8>>> {
    loop {
        if pcm_buffer.len() >= FRAME_BYTES {
            return Ok(Some(pcm_buffer.split_to(FRAME_BYTES).to_vec()));
        }

        let mut chunk = [0u8; FRAME_BYTES];
        let bytes_read = stdout.read(&mut chunk).await?;
        if bytes_read == 0 {
            return Ok(None);
        }

        converter.push_raw(&chunk[..bytes_read], pcm_buffer);
    }
}

fn pcm_to_f32(pcm_frame: &[u8]) -> Vec<f32> {
    pcm_frame
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]) as f32)
        .collect()
}

async fn stop_child(child: &mut Child) -> Result<()> {
    if let Some(_status) = child.try_wait()? {
        return Ok(());
    }

    child.start_kill()?;
    let _ = child.wait().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pcm_to_f32_returns_raw_magnitude() {
        let max_bytes = i16::MAX.to_le_bytes();
        let neg_one_bytes = (-1i16).to_le_bytes();
        let result = pcm_to_f32(&[
            max_bytes[0],
            max_bytes[1],
            neg_one_bytes[0],
            neg_one_bytes[1],
        ]);
        assert_eq!(result[0], 32767.0f32);
        assert_eq!(result[1], -1.0f32);
    }

    #[test]
    fn threshold_parser_accepts_finite_unit_interval_values() {
        assert_eq!(parse_threshold("0.7"), Some(0.7));
        assert_eq!(parse_threshold("1"), Some(1.0));
    }

    #[test]
    fn threshold_parser_rejects_invalid_values() {
        for value in ["", "nope", "-0.1", "0", "1.1", "NaN", "inf", "-inf"] {
            assert_eq!(parse_threshold(value), None, "value: {value}");
        }
    }

    #[test]
    fn isolated_score_spike_does_not_activate() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.1), None);
        assert_eq!(gate.observe(0.92), None);
        assert_eq!(gate.observe(0.2), None);
        assert_eq!(gate.observe(0.1), None);
    }

    #[test]
    fn peak_with_two_supporting_scores_activates_with_peak_confidence() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.54), None);
        assert_eq!(gate.observe(0.58), None);
        assert_eq!(gate.observe(0.86), Some(0.86));
    }

    #[test]
    fn peak_with_only_one_supporting_score_does_not_activate() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.54), None);
        assert_eq!(gate.observe(0.86), None);
        assert_eq!(gate.observe(0.1), None);
    }

    #[test]
    fn two_falling_scores_can_confirm_a_recent_peak() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.81), None);
        assert_eq!(gate.observe(0.58), None);
        assert_eq!(gate.observe(0.56), Some(0.81));
    }

    #[test]
    fn supporting_scores_below_peak_do_not_activate() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.55), None);
        assert_eq!(gate.observe(0.64), None);
        assert_eq!(gate.observe(0.62), None);
    }

    #[test]
    fn evidence_from_different_keywords_stays_isolated() {
        let mut first_keyword = WakeWordScoreGate::new(0.5);
        let mut second_keyword = WakeWordScoreGate::new(0.5);

        assert_eq!(first_keyword.observe(0.84), None);
        assert_eq!(second_keyword.observe(0.56), None);
        assert_eq!(first_keyword.observe(0.1), None);
        assert_eq!(second_keyword.observe(0.1), None);
    }

    #[test]
    fn rejected_candidate_can_be_followed_by_stronger_detection() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.55), None);
        assert_eq!(gate.observe(0.56), None);
        assert_eq!(gate.observe(0.75), Some(0.75));
        gate.reset();
        assert_eq!(gate.observe(0.95), None);
        assert_eq!(gate.observe(0.6), None);
        assert_eq!(gate.observe(0.61), Some(0.95));
    }

    #[test]
    fn playback_threshold_evaluates_the_original_rising_score_window() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe_at_threshold(0.55, 0.9), None);
        assert_eq!(gate.observe_at_threshold(0.75, 0.9), None);
        assert_eq!(gate.observe_at_threshold(0.95, 0.9), Some(0.95));
    }

    #[test]
    fn playback_transition_discards_scores_from_the_previous_threshold() {
        let mut gates = [WakeWordScoreGate::new(0.5)];
        let mut last_playback_active = true;

        let threshold =
            threshold_for_playback_state(true, &mut last_playback_active, &mut gates, 0.65, 0.9);
        assert_eq!(gates[0].observe_at_threshold(0.75, threshold), None);
        assert_eq!(gates[0].observe_at_threshold(0.6, threshold), None);

        let threshold =
            threshold_for_playback_state(false, &mut last_playback_active, &mut gates, 0.65, 0.9);
        assert_eq!(gates[0].observe_at_threshold(0.6, threshold), None);
        assert_eq!(gates[0].observe_at_threshold(0.67, threshold), None);
        assert_eq!(gates[0].observe_at_threshold(0.55, threshold), Some(0.67));
    }

    #[test]
    fn invalid_score_clears_pending_evidence() {
        let mut gate = WakeWordScoreGate::new(0.5);

        assert_eq!(gate.observe(0.8), None);
        assert_eq!(gate.observe(f32::NAN), None);
        assert_eq!(gate.observe(0.5), None);
    }

    #[test]
    fn transient_resume_does_not_clear_user_mute() {
        let mut state = WakeWordPauseState::new(true);

        state.pause(false);
        state.resume(false);

        assert!(state.is_paused());
        assert!(state.user_muted);
        assert!(!state.recording_suppressed);
    }

    #[test]
    fn user_resume_keeps_recording_suppression_active() {
        let mut state = WakeWordPauseState::new(true);

        state.pause(false);
        state.resume(true);

        assert!(state.is_paused());
        assert!(!state.user_muted);
        assert!(state.recording_suppressed);
    }

    #[test]
    fn transient_pause_resumes_when_recording_finishes() {
        let mut state = WakeWordPauseState::new(false);

        state.pause(false);
        assert!(state.is_paused());

        state.resume(false);

        assert!(!state.is_paused());
        assert!(!state.user_muted);
        assert!(!state.recording_suppressed);
    }
}
