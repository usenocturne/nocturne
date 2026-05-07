use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::anyhow;
use bytes::BytesMut;
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{sleep, Instant};
use tracing::{debug, info, warn};
use tract_onnx::prelude::*;

use crate::error::{NocturnedError, Result};

const SHARED_MODELS: &[&str] = &["melspectrogram.onnx", "embedding_model.onnx"];

const SAMPLE_RATE: u32 = 16_000;
const CHANNELS: u8 = 1;
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
const DETECTION_DEBOUNCE: Duration = Duration::from_secs(2);
const RESTART_DELAY: Duration = Duration::from_millis(250);
const PREFERENCE_PATH: &str = "/var/lib/wakeword.state";

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
}

pub struct WakeWordDetector {
    models_dir: String,
    threshold: f32,
    event_tx: broadcast::Sender<WakeWordEvent>,
}

impl WakeWordDetector {
    pub fn new(models_dir: String, threshold: f32) -> (Self, broadcast::Receiver<WakeWordEvent>) {
        let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        (
            Self {
                models_dir,
                threshold,
                event_tx,
            },
            event_rx,
        )
    }

    pub async fn run(self, mut cmd_rx: mpsc::UnboundedReceiver<WakeWordCommand>) -> Result<()> {
        let models_dir = PathBuf::from(&self.models_dir);
        let melspectrogram = tract_onnx::onnx()
            .model_for_path(model_path(&models_dir, "melspectrogram.onnx"))?
            .with_input_fact(0, f32::fact([1, MEL_INPUT_SAMPLES]).into())?
            .into_optimized()?
            .into_runnable()?;
        let embedding_model = tract_onnx::onnx()
            .model_for_path(model_path(&models_dir, "embedding_model.onnx"))?
            .with_input_fact(0, f32::fact([1, MEL_WINDOW_SIZE, MEL_BINS, 1]).into())?
            .into_optimized()?
            .into_runnable()?;
        let classifiers = load_classifiers(&models_dir)?;
        if classifiers.is_empty() {
            warn!(
                "No wake word classifier models found in {}",
                models_dir.display()
            );
            return Ok(());
        }
        for (name, _) in &classifiers {
            info!("Loaded wake word model: {}", name);
        }

        let mut paused = load_preference_muted().await;
        if paused {
            info!("Wake word detector starting in paused state (persisted preference)");
        }
        let _ = self
            .event_tx
            .send(WakeWordEvent::StateChanged { muted: paused });
        let mut child = None;
        let mut stdout = None;
        let mut pcm_buffer = BytesMut::with_capacity(FRAME_BYTES * 2);
        let mut mel_overlap: Vec<f32> = vec![0.0; MEL_OVERLAP_SAMPLES];
        let mut mel_buffer: Vec<[f32; MEL_BINS]> = Vec::new();
        let mut mel_frames_since_embed: usize = 0;
        let mut embeddings: VecDeque<[f32; EMBEDDING_SIZE]> =
            VecDeque::with_capacity(MAX_EMBEDDINGS);
        let mut last_detection_at = None;

        loop {
            if paused {
                if let Some(mut active_child) = child.take() {
                    let _ = stop_child(&mut active_child).await;
                }
                stdout = None;
                pcm_buffer.clear();
                mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                mel_buffer.clear();
                mel_frames_since_embed = 0;
                embeddings.clear();

                loop {
                    match cmd_rx.recv().await {
                        Some(WakeWordCommand::Resume { persist }) => {
                            paused = false;
                            if persist {
                                persist_and_notify(&self.event_tx, false).await;
                            }
                            info!("Resuming wake word detection");
                            break;
                        }
                        Some(WakeWordCommand::Pause { ack, persist }) => {
                            if persist {
                                persist_and_notify(&self.event_tx, true).await;
                            }
                            if let Some(tx) = ack {
                                let _ = tx.send(());
                            }
                        }
                        None => return Ok(()),
                    }
                }

                continue;
            }

            if stdout.is_none() {
                match spawn_arecord() {
                    Ok(mut spawned_child) => match spawned_child.stdout.take() {
                        Some(spawned_stdout) => {
                            info!("Wake word listener started");
                            child = Some(spawned_child);
                            stdout = Some(spawned_stdout);
                            pcm_buffer.clear();
                            mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                            mel_buffer.clear();
                            mel_frames_since_embed = 0;
                            embeddings.clear();
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
                            if let Some(mut active_child) = child.take() {
                                let _ = stop_child(&mut active_child).await;
                            }
                            stdout = None;
                            pcm_buffer.clear();
                            mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                            mel_buffer.clear();
                            mel_frames_since_embed = 0;
                            embeddings.clear();
                            paused = true;
                            if persist {
                                persist_and_notify(&self.event_tx, true).await;
                            }
                            if let Some(tx) = ack {
                                let _ = tx.send(());
                            }
                            continue;
                        }
                        Some(WakeWordCommand::Resume { persist }) => {
                            if persist {
                                persist_and_notify(&self.event_tx, false).await;
                            }
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
                    next_pcm_frame(stdout, &mut pcm_buffer).await
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
                    mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                    mel_buffer.clear();
                    mel_frames_since_embed = 0;
                    embeddings.clear();
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
                    mel_overlap = vec![0.0; MEL_OVERLAP_SAMPLES];
                    mel_buffer.clear();
                    mel_frames_since_embed = 0;
                    embeddings.clear();
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
                for i in 0..EMBEDDING_SIZE {
                    embedding[i] = embed_view.as_slice().unwrap_or(&[])[i];
                }

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

            let now = Instant::now();
            if last_detection_at
                .map(|last| now.duration_since(last) < DETECTION_DEBOUNCE)
                .unwrap_or(false)
            {
                continue;
            }

            for (keyword, cls_model) in &classifiers {
                let cls_result = cls_model.run(tvec![cls_input.clone().into_tvalue()])?;
                let confidence = cls_result[0]
                    .as_slice::<f32>()
                    .map_err(|e| NocturnedError::General(anyhow!(e)))?
                    .first()
                    .copied()
                    .unwrap_or(0.0);

                if confidence >= self.threshold {
                    debug!("Wake word '{}' confidence: {:.3}", keyword, confidence);
                    last_detection_at = Some(now);
                    let _ = self.event_tx.send(WakeWordEvent::Detected {
                        keyword: keyword.clone(),
                        confidence,
                    });
                    break;
                }
            }
        }
    }
}

type RunModel = SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>;

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

fn spawn_arecord() -> Result<Child> {
    Command::new("arecord")
        .arg("-D")
        .arg("hw:0,0")
        .arg("-f")
        .arg("S16_LE")
        .arg("-c")
        .arg(CHANNELS.to_string())
        .arg("-r")
        .arg(SAMPLE_RATE.to_string())
        .arg("-t")
        .arg("raw")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(NocturnedError::from)
}

async fn next_pcm_frame(
    stdout: &mut ChildStdout,
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

        pcm_buffer.extend_from_slice(&chunk[..bytes_read]);
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
}
