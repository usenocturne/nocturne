use crate::error::Result;
use crate::websocket::WebSocketServer;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::fs;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

const BRIGHTNESS_PATH: &str = "/sys/class/backlight/aml-bl/brightness";
const BRIGHTNESS_SAVE_PATH: &str = "/var/lib/brightness.json";
const ALS_BASE_DIR: &str = "/sys/bus/iio/devices";
const ALS_FILE_NAME: &str = "in_intensity0_raw";
const ALS_POLL_INTERVAL: Duration = Duration::from_secs(1);
const AUTO_POLL_INTERVAL: Duration = Duration::from_millis(40);

const MIN_BRIGHTNESS: u8 = 255;
const MAX_BRIGHTNESS: u8 = 1;
const AUTO_MIN_BRIGHTNESS: u8 = 240;
const AUTO_MAX_BRIGHTNESS: u8 = 20;

const STOCK_ALS_LOW_THRESHOLD: u32 = 12;
const STOCK_ALS_HIGH_THRESHOLD: u32 = 2000;
const STOCK_FLOOR: f64 = 235.0;
const STOCK_CEILING: f64 = 50.0;

const STOCK_C1_ALS_MUL: f64 = 182.881;
const STOCK_C2_ALS_CONST: f64 = 2219.95;
const STOCK_C3_LOG_MUL: f64 = 19.3238;
const STOCK_C4_LOG_CONST: f64 = 297.479;

const STEP_FRACTION: f32 = 0.02;
const SMOOTHING_SAMPLES: usize = 11;

static AUTO_TASK: std::sync::Mutex<Option<JoinHandle<()>>> = std::sync::Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrightnessConfig {
    pub auto: bool,
    pub brightness: u8,
}

impl Default for BrightnessConfig {
    fn default() -> Self {
        Self {
            auto: true,
            brightness: 180,
        }
    }
}

pub async fn get_brightness_config() -> Result<BrightnessConfig> {
    if !Path::new(BRIGHTNESS_SAVE_PATH).exists() {
        return Ok(BrightnessConfig::default());
    }

    let data = fs::read_to_string(BRIGHTNESS_SAVE_PATH).await?;
    let config: BrightnessConfig = serde_json::from_str(&data)?;
    Ok(config)
}

async fn write_backlight(value: u8) -> std::result::Result<(), std::io::Error> {
    fs::write(BRIGHTNESS_PATH, value.to_string()).await
}

async fn save_config(config: &BrightnessConfig) {
    let data = match serde_json::to_string(config) {
        Ok(d) => d,
        Err(e) => {
            warn!("Failed to serialize brightness config: {}", e);
            return;
        }
    };
    if let Err(e) = fs::write(BRIGHTNESS_SAVE_PATH, data).await {
        warn!("Failed to save brightness config: {}", e);
    }
}

fn als_to_brightness(als_raw: u32) -> u8 {
    let stock_brightness: f64 = if als_raw <= STOCK_ALS_LOW_THRESHOLD {
        STOCK_FLOOR
    } else if als_raw >= STOCK_ALS_HIGH_THRESHOLD {
        STOCK_CEILING
    } else {
        let inner_f64 = STOCK_C2_ALS_CONST - (als_raw as f64) * STOCK_C1_ALS_MUL;
        let log_input_f32 = inner_f64.abs() as f32;
        let log_out_f32 = log_input_f32.ln();
        let merged_f64 = STOCK_C4_LOG_CONST - (log_out_f32 as f64) * STOCK_C3_LOG_MUL;
        (merged_f64 as f32).round() as f64
    };

    let stock_range = STOCK_FLOOR - STOCK_CEILING;
    let new_range = AUTO_MIN_BRIGHTNESS as f64 - AUTO_MAX_BRIGHTNESS as f64;
    let remapped =
        AUTO_MIN_BRIGHTNESS as f64 - (STOCK_FLOOR - stock_brightness) * new_range / stock_range;

    remapped
        .round()
        .clamp(AUTO_MAX_BRIGHTNESS as f64, AUTO_MIN_BRIGHTNESS as f64) as u8
}

fn parse_brightness_value(raw: &str) -> Option<u8> {
    raw.trim()
        .parse::<u32>()
        .ok()
        .and_then(|v| u8::try_from(v).ok())
}

async fn read_current_brightness_file() -> Option<u8> {
    let raw = tokio::fs::read_to_string(BRIGHTNESS_PATH).await.ok()?;
    parse_brightness_value(&raw)
}

fn median_of_samples(samples: &VecDeque<u32>) -> Option<u32> {
    if samples.is_empty() {
        return None;
    }
    let mut sorted: Vec<u32> = samples.iter().copied().collect();
    sorted.sort_unstable();
    Some(sorted[sorted.len() / 2])
}

fn step_fn(current: i32, target: i32) -> i32 {
    let diff_scaled = (target - current) as f32 * STEP_FRACTION;
    if diff_scaled >= 1.0 {
        diff_scaled.round() as i32
    } else if diff_scaled > 0.0 {
        1
    } else if diff_scaled <= -1.0 {
        diff_scaled.round() as i32
    } else if diff_scaled < 0.0 {
        -1
    } else {
        0
    }
}

fn next_value(current: u8, target: u8, step: i32) -> u8 {
    if current == target {
        return target;
    }
    let next = current as i32 + step;
    if step > 0 && (target as i32) < next {
        return target;
    }
    if step < 0 && (target as i32) > next {
        return target;
    }
    next.clamp(AUTO_MAX_BRIGHTNESS as i32, AUTO_MIN_BRIGHTNESS as i32) as u8
}

fn tick_auto_brightness(
    samples: &VecDeque<u32>,
    prev_target: Option<u8>,
    prev_step: i32,
    current_bl: u8,
) -> Option<(u8, u8, i32)> {
    let median = median_of_samples(samples)?;
    let target = als_to_brightness(median);
    let step = if prev_target == Some(target) {
        prev_step
    } else {
        step_fn(current_bl as i32, target as i32)
    };
    let next = next_value(current_bl, target, step);
    Some((next, target, step))
}

async fn auto_brightness_loop() {
    let mut samples: VecDeque<u32> = VecDeque::with_capacity(SMOOTHING_SAMPLES);
    let mut prev_target: Option<u8> = None;
    let mut prev_step: i32 = 0;

    loop {
        if let Some(als_raw) = read_ambient_light().await {
            samples.push_back(als_raw);
            if samples.len() > SMOOTHING_SAMPLES {
                samples.pop_front();
            }
        }
        tokio::time::sleep(AUTO_POLL_INTERVAL).await;

        let Some(current_bl) = read_current_brightness_file().await else {
            continue;
        };
        let Some((next, target, step)) =
            tick_auto_brightness(&samples, prev_target, prev_step, current_bl)
        else {
            continue;
        };
        prev_target = Some(target);
        prev_step = step;

        if let Err(e) = write_backlight(next).await {
            warn!("Auto-brightness failed to write: {}", e);
        }
    }
}

fn stop_auto_brightness() {
    let mut handle = AUTO_TASK.lock().unwrap();
    if let Some(h) = handle.take() {
        h.abort();
    }
}

pub async fn set_brightness(value: u8) -> Result<()> {
    if !(MAX_BRIGHTNESS..=MIN_BRIGHTNESS).contains(&value) {
        return Err(crate::error::NocturnedError::General(anyhow::anyhow!(
            "brightness value must be between {} and {}",
            MAX_BRIGHTNESS,
            MIN_BRIGHTNESS
        )));
    }

    stop_auto_brightness();
    write_backlight(value).await?;

    save_config(&BrightnessConfig {
        auto: false,
        brightness: value,
    })
    .await;

    Ok(())
}

pub async fn set_auto_brightness(enabled: bool) -> Result<()> {
    if enabled {
        let mut handle = AUTO_TASK.lock().unwrap();
        if let Some(h) = handle.take() {
            h.abort();
        }
        info!("Starting native auto-brightness");
        *handle = Some(tokio::spawn(auto_brightness_loop()));
    } else {
        stop_auto_brightness();
        info!("Stopped native auto-brightness");
    }

    let mut config = get_brightness_config().await.unwrap_or_default();
    config.auto = enabled;
    save_config(&config).await;

    Ok(())
}

pub async fn init_brightness() -> Result<()> {
    let _ = Command::new("supervisorctl")
        .args(["stop", "backlight"])
        .output()
        .await;

    let config = match get_brightness_config().await {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    if config.auto {
        set_auto_brightness(true).await
    } else {
        write_backlight(config.brightness).await?;
        Ok(())
    }
}

pub async fn read_ambient_light() -> Option<u32> {
    let path = format!("{ALS_BASE_DIR}/iio:device0/{ALS_FILE_NAME}");
    match fs::read_to_string(path).await {
        Ok(s) => s.trim().parse().ok(),
        Err(_) => None,
    }
}

pub fn start_ambient_light_task(websocket_server: Arc<WebSocketServer>) {
    tokio::spawn(async move {
        let mut last_value: Option<u32> = None;

        loop {
            if let Some(value) = read_ambient_light().await {
                if last_value != Some(value) {
                    debug!("Ambient light sensor value: {}", value);
                    websocket_server
                        .broadcast_event(
                            "ambient_light_update".to_string(),
                            serde_json::json!({ "value": value }),
                        )
                        .await;
                    last_value = Some(value);
                }
            }

            tokio::time::sleep(ALS_POLL_INTERVAL).await;
        }
    });
}
