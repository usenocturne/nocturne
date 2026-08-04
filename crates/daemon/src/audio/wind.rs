use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::sync::{broadcast, mpsc};
use tracing::warn;

const RAW_SAMPLE_SCALE: f32 = 4096.0;
const FULL_SCALE: f32 = 32768.0;
const SAMPLE_RATE: f32 = 48_000.0;
const ANALYSIS_WINDOW_FRAMES: usize = 12_000;
const EVENT_WINDOW_INTERVAL: u8 = 4;
const ATTACK_WINDOWS: u8 = 4;
const RELEASE_WINDOWS: u8 = 8;
const LOW_CUTOFF_HZ: f32 = 20.0;
const HIGH_CUTOFF_HZ: f32 = 250.0;
const MIN_LOW_FREQUENCY_RATIO: f64 = 0.30;
const FULL_LOW_FREQUENCY_RATIO: f64 = 0.70;
const MIN_SPATIAL_INCOHERENCE: f64 = 0.08;
const FULL_SPATIAL_INCOHERENCE: f64 = 0.50;
const MIN_STRENGTH_DBFS: f64 = -62.0;
const MAX_STRENGTH_DBFS: f64 = -32.0;
const SCORE_SMOOTHING: f64 = 0.25;
const EVENT_CHANNEL_CAPACITY: usize = 16;
const FRAME_CHANNEL_CAPACITY: usize = 16;
pub(crate) const FRAME_BATCH_SIZE: usize = 1_200;

pub(crate) type RawFrame = [i32; 4];

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindLevelReading {
    pub level: u8,
    pub stat: f32,
}

#[derive(Clone)]
pub struct WindFrameSender {
    frame_tx: mpsc::Sender<Vec<RawFrame>>,
    queue_full_logged: Arc<AtomicBool>,
}

pub fn start_detector() -> (WindFrameSender, broadcast::Receiver<WindLevelReading>) {
    let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
    let (frame_tx, mut frame_rx) = mpsc::channel::<Vec<RawFrame>>(FRAME_CHANNEL_CAPACITY);
    tokio::task::spawn_blocking(move || {
        let mut detector = WindDetector::new(event_tx);
        while let Some(frames) = frame_rx.blocking_recv() {
            for frame in frames {
                detector.process_frame(frame);
            }
        }
    });

    (
        WindFrameSender {
            frame_tx,
            queue_full_logged: Arc::new(AtomicBool::new(false)),
        },
        event_rx,
    )
}

impl WindFrameSender {
    pub(crate) fn try_send(&self, frames: Vec<RawFrame>) {
        match self.frame_tx.try_send(frames) {
            Ok(()) => {
                self.queue_full_logged.store(false, Ordering::Relaxed);
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                if !self.queue_full_logged.swap(true, Ordering::Relaxed) {
                    warn!("wind analysis queue full; dropping one audio batch");
                }
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                if !self.queue_full_logged.swap(true, Ordering::Relaxed) {
                    warn!("wind analysis worker stopped; dropping audio batch");
                }
            }
        }
    }
}

pub(crate) struct WindDetector {
    event_tx: broadcast::Sender<WindLevelReading>,
    low_pass_20: [f64; 4],
    low_pass_250: [f64; 4],
    low_energy: f64,
    incoherent_energy: f64,
    total_energy: f64,
    frame_count: usize,
    smoothed_score: f64,
    current_level: u8,
    pending_level: u8,
    pending_windows: u8,
    windows_since_event: u8,
}

impl WindDetector {
    pub(crate) fn new(event_tx: broadcast::Sender<WindLevelReading>) -> Self {
        Self {
            event_tx,
            low_pass_20: [0.0; 4],
            low_pass_250: [0.0; 4],
            low_energy: 0.0,
            incoherent_energy: 0.0,
            total_energy: 0.0,
            frame_count: 0,
            smoothed_score: 0.0,
            current_level: 0,
            pending_level: 0,
            pending_windows: 0,
            windows_since_event: 0,
        }
    }

    pub(crate) fn process_frame(&mut self, frame: [i32; 4]) {
        let alpha_20 = one_pole_alpha(LOW_CUTOFF_HZ);
        let alpha_250 = one_pole_alpha(HIGH_CUTOFF_HZ);
        let mut low_band = [0.0; 4];
        let mut total = [0.0; 4];

        for (index, raw_sample) in frame.into_iter().enumerate() {
            let sample = f64::from(raw_sample) / f64::from(RAW_SAMPLE_SCALE);
            self.low_pass_20[index] += alpha_20 * (sample - self.low_pass_20[index]);
            self.low_pass_250[index] += alpha_250 * (sample - self.low_pass_250[index]);
            low_band[index] = self.low_pass_250[index] - self.low_pass_20[index];
            total[index] = sample - self.low_pass_20[index];
        }

        let low_mean = low_band.iter().sum::<f64>() / low_band.len() as f64;
        for index in 0..low_band.len() {
            self.low_energy += low_band[index] * low_band[index];
            let incoherent = low_band[index] - low_mean;
            self.incoherent_energy += incoherent * incoherent;
            self.total_energy += total[index] * total[index];
        }

        self.frame_count += 1;
        if self.frame_count >= ANALYSIS_WINDOW_FRAMES {
            self.finish_window();
        }
    }

    fn finish_window(&mut self) {
        let divisor = (self.frame_count * self.low_pass_20.len()) as f64;
        let low_power = self.low_energy / divisor;
        let incoherent_power = self.incoherent_energy / divisor;
        let total_power = self.total_energy / divisor;
        let score = wind_score(low_power, incoherent_power, total_power);
        self.smoothed_score =
            SCORE_SMOOTHING * score + (1.0 - SCORE_SMOOTHING) * self.smoothed_score;

        let candidate = score_to_level(self.smoothed_score);
        if candidate == self.current_level {
            self.pending_level = candidate;
            self.pending_windows = 0;
        } else if candidate == self.pending_level {
            self.pending_windows = self.pending_windows.saturating_add(1);
        } else {
            self.pending_level = candidate;
            self.pending_windows = 1;
        }

        let required_windows = if candidate > self.current_level {
            ATTACK_WINDOWS
        } else {
            RELEASE_WINDOWS
        };
        let changed = self.pending_windows >= required_windows;
        if changed {
            self.current_level = candidate;
            self.pending_windows = 0;
        }

        self.windows_since_event = self.windows_since_event.saturating_add(1);
        if changed || self.windows_since_event >= EVENT_WINDOW_INTERVAL {
            self.windows_since_event = 0;
            let _ = self.event_tx.send(WindLevelReading {
                level: self.current_level,
                stat: self.smoothed_score.round() as f32,
            });
        }

        self.low_energy = 0.0;
        self.incoherent_energy = 0.0;
        self.total_energy = 0.0;
        self.frame_count = 0;
    }
}

fn one_pole_alpha(cutoff_hz: f32) -> f64 {
    let radians = 2.0 * std::f32::consts::PI * cutoff_hz;
    f64::from(radians / (radians + SAMPLE_RATE))
}

fn wind_score(low_power: f64, incoherent_power: f64, total_power: f64) -> f64 {
    if low_power <= f64::EPSILON || total_power <= f64::EPSILON {
        return 0.0;
    }

    let rms = incoherent_power.sqrt();
    let strength_dbfs = 20.0 * (rms / f64::from(FULL_SCALE)).max(1.0e-12).log10();
    let strength = ((strength_dbfs - MIN_STRENGTH_DBFS) / (MAX_STRENGTH_DBFS - MIN_STRENGTH_DBFS))
        .clamp(0.0, 1.0);
    let low_ratio = ((low_power / total_power) - MIN_LOW_FREQUENCY_RATIO)
        / (FULL_LOW_FREQUENCY_RATIO - MIN_LOW_FREQUENCY_RATIO);
    let incoherence = ((incoherent_power / low_power) - MIN_SPATIAL_INCOHERENCE)
        / (FULL_SPATIAL_INCOHERENCE - MIN_SPATIAL_INCOHERENCE);

    100.0 * strength * low_ratio.clamp(0.0, 1.0) * incoherence.clamp(0.0, 1.0)
}

fn score_to_level(score: f64) -> u8 {
    match score {
        score if score >= 80.0 => 4,
        score if score >= 60.0 => 3,
        score if score >= 40.0 => 2,
        score if score >= 20.0 => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn detector() -> (WindDetector, broadcast::Receiver<WindLevelReading>) {
        let (event_tx, event_rx) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        (WindDetector::new(event_tx), event_rx)
    }

    fn feed_signal<F>(detector: &mut WindDetector, seconds: usize, mut sample: F)
    where
        F: FnMut(usize, usize) -> f32,
    {
        for frame_index in 0..seconds * SAMPLE_RATE as usize {
            let mut frame = [0i32; 4];
            for (channel, value) in frame.iter_mut().enumerate() {
                *value = (sample(frame_index, channel) * RAW_SAMPLE_SCALE) as i32;
            }
            detector.process_frame(frame);
        }
    }

    fn latest_reading(receiver: &mut broadcast::Receiver<WindLevelReading>) -> WindLevelReading {
        let mut latest = None;
        while let Ok(reading) = receiver.try_recv() {
            latest = Some(reading);
        }
        latest.expect("detector should emit a reading")
    }

    #[test]
    fn common_mode_voice_does_not_report_wind() {
        let (mut detector, mut receiver) = detector();
        feed_signal(&mut detector, 3, |index, _| {
            let time = index as f32 / SAMPLE_RATE;
            6000.0 * (2.0 * std::f32::consts::PI * 140.0 * time).sin()
        });

        assert_eq!(latest_reading(&mut receiver).level, 0);
    }

    #[test]
    fn high_frequency_spatial_noise_does_not_report_wind() {
        let (mut detector, mut receiver) = detector();
        feed_signal(&mut detector, 3, |index, channel| {
            let time = index as f32 / SAMPLE_RATE;
            let frequency = 2500.0 + channel as f32 * 300.0;
            7000.0 * (2.0 * std::f32::consts::PI * frequency * time).sin()
        });

        assert_eq!(latest_reading(&mut receiver).level, 0);
    }

    #[test]
    fn strong_incoherent_low_frequency_turbulence_crosses_alert_level() {
        let (mut detector, mut receiver) = detector();
        feed_signal(&mut detector, 5, |index, channel| {
            let time = index as f32 / SAMPLE_RATE;
            let frequency = 70.0 + channel as f32 * 23.0;
            let phase = channel as f32 * 1.1;
            7000.0 * (2.0 * std::f32::consts::PI * frequency * time + phase).sin()
        });

        let reading = latest_reading(&mut receiver);
        assert!(reading.level >= 3, "unexpected reading: {reading:?}");
        assert!(reading.stat >= 60.0, "unexpected reading: {reading:?}");
    }

    #[test]
    fn alert_level_releases_only_after_sustained_clean_audio() {
        let (mut detector, mut receiver) = detector();
        feed_signal(&mut detector, 5, |index, channel| {
            let time = index as f32 / SAMPLE_RATE;
            let frequency = 70.0 + channel as f32 * 23.0;
            7000.0 * (2.0 * std::f32::consts::PI * frequency * time).sin()
        });
        assert!(latest_reading(&mut receiver).level >= 3);

        feed_signal(&mut detector, 4, |_, _| 0.0);
        assert_eq!(latest_reading(&mut receiver).level, 0);
    }
}
