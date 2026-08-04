use crate::error::Result;
use crate::http::WebSocketServer;
use libnocturne::generated::device::AmbientLightUpdateEvent;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::fs;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

const BACKLIGHT_CLASS_DIR: &str = "/sys/class/backlight";
const BRIGHTNESS_SAVE_PATH: &str = "/var/lib/brightness.json";
const IIO_BUS_DIR: &str = "/sys/bus/iio/devices";
const ALS_INTEGRATION_TIME: &str = "0.100";
const ALS_GAIN: &str = "16";
const AUTO_SAMPLE_INTERVAL: Duration = Duration::from_millis(200);
const BACKLIGHT_UPDATE_INTERVAL: Duration = Duration::from_millis(40);
const AMBIENT_EVENT_TICKS: u8 = 25;

const BRIGHTNESS_BRIGHTEST: u8 = 0;
const BRIGHTNESS_DIMMEST: u8 = 160;
const DEFAULT_BRIGHTNESS: u8 = 113;
const AUTO_RAW_AT_MAX: f64 = 1500.0;
const AUTO_MIN_BACKLIGHT: u32 = 16;
const AUTO_DIM_KNEE: u32 = 3;
const BACKLIGHT_STEP_FRACTION: f32 = 0.02;
const SMOOTHING_SAMPLES: usize = 11;
const STOCK_AMBIENT_DARKEST_LEVEL: u32 = 235;
const STOCK_AMBIENT_BRIGHTEST_LEVEL: u32 = 50;
const STOCK_AMBIENT_LEVEL_MAX: u32 = 255;
const STOCK_AMBIENT_CURVE_MIN_RAW: u32 = 13;
const STOCK_AMBIENT_CURVE_MAX_RAW: u32 = 1999;

static AUTO_TASK: std::sync::Mutex<Option<JoinHandle<()>>> = std::sync::Mutex::new(None);
static BRIGHTNESS_OP_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static AMBIENT_LIGHT_DISCOVERY_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static DISPLAY_SLEEP_STATE: std::sync::Mutex<Option<BrightnessConfig>> =
    std::sync::Mutex::new(None);
static BACKLIGHT_DEVICE: OnceLock<BacklightDevice> = OnceLock::new();
static AMBIENT_LIGHT_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone)]
struct BacklightDevice {
    brightness_path: PathBuf,
    max_brightness: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrightnessConfig {
    pub auto: bool,
    pub brightness: u8,
}

impl Default for BrightnessConfig {
    fn default() -> Self {
        Self {
            auto: true,
            brightness: DEFAULT_BRIGHTNESS,
        }
    }
}

pub async fn get_brightness_config() -> Result<BrightnessConfig> {
    if !Path::new(BRIGHTNESS_SAVE_PATH).exists() {
        return Ok(BrightnessConfig::default());
    }

    let data = fs::read_to_string(BRIGHTNESS_SAVE_PATH).await?;
    let mut config: BrightnessConfig = serde_json::from_str(&data)?;
    config.brightness = clamp_brightness(config.brightness);
    Ok(config)
}

async fn read_u32_file(path: &Path) -> Option<u32> {
    let raw = fs::read_to_string(path).await.ok()?;
    raw.trim().parse().ok()
}

async fn try_backlight_device(base: PathBuf) -> Option<BacklightDevice> {
    let brightness_path = base.join("brightness");
    if !fs::try_exists(&brightness_path).await.ok()? {
        return None;
    }

    let max_brightness = read_u32_file(&base.join("max_brightness")).await?;
    if max_brightness == 0 {
        return None;
    }

    Some(BacklightDevice {
        brightness_path,
        max_brightness,
    })
}

async fn discover_backlight_device() -> Result<BacklightDevice> {
    if let Some(device) = BACKLIGHT_DEVICE.get() {
        return Ok(device.clone());
    }

    let mut candidates = Vec::new();

    if let Ok(mut entries) = fs::read_dir(BACKLIGHT_CLASS_DIR).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            candidates.push(entry.path());
        }
    }

    for candidate in candidates {
        let Some(device) = try_backlight_device(candidate).await else {
            continue;
        };
        let _ = BACKLIGHT_DEVICE.set(device.clone());
        info!(
            "Using backlight {} with max_brightness {}",
            device.brightness_path.display(),
            device.max_brightness
        );
        return Ok(device);
    }

    Err(crate::error::NocturnedError::General(anyhow::anyhow!(
        "no usable backlight device found under {}",
        BACKLIGHT_CLASS_DIR
    )))
}

fn clamp_brightness(value: u8) -> u8 {
    value.clamp(BRIGHTNESS_BRIGHTEST, BRIGHTNESS_DIMMEST)
}

fn logical_to_backlight_raw(value: u8, max_brightness: u32) -> u32 {
    let logical = clamp_brightness(value) as u32;
    let logical_span = (BRIGHTNESS_DIMMEST - BRIGHTNESS_BRIGHTEST) as f64;
    let raw_min = 0;
    let raw_span = max_brightness.saturating_sub(raw_min) as f64;
    let bright_fraction = (BRIGHTNESS_DIMMEST as u32 - logical) as f64 / logical_span;

    (raw_min as f64 + bright_fraction * raw_span)
        .round()
        .clamp(raw_min as f64, max_brightness as f64) as u32
}

fn backlight_raw_to_logical(raw: u32, max_brightness: u32) -> u8 {
    if max_brightness == 0 {
        return BRIGHTNESS_BRIGHTEST;
    }

    let raw_min = 0;
    let raw = raw.clamp(raw_min, max_brightness);
    let raw_span = (max_brightness - raw_min) as f64;
    let bright_fraction = (raw - raw_min) as f64 / raw_span;
    let logical_span = (BRIGHTNESS_DIMMEST - BRIGHTNESS_BRIGHTEST) as f64;

    (BRIGHTNESS_DIMMEST as f64 - bright_fraction * logical_span)
        .round()
        .clamp(BRIGHTNESS_BRIGHTEST as f64, BRIGHTNESS_DIMMEST as f64) as u8
}

async fn write_backlight(value: u8) -> Result<()> {
    let device = discover_backlight_device().await?;
    let raw = logical_to_backlight_raw(value, device.max_brightness);
    write_backlight_raw(&device, raw).await?;
    Ok(())
}

async fn write_backlight_raw(device: &BacklightDevice, value: u32) -> Result<()> {
    let raw = value.min(device.max_brightness);
    fs::write(&device.brightness_path, raw.to_string()).await?;
    Ok(())
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

fn minimum_auto_backlight(max_brightness: u32) -> u32 {
    AUTO_MIN_BACKLIGHT.min(max_brightness)
}

fn ambient_to_backlight_target(ambient_raw: u32, max_brightness: u32) -> u32 {
    let min_brightness = minimum_auto_backlight(max_brightness);
    if ambient_raw <= AUTO_DIM_KNEE {
        return min_brightness;
    }
    let normalized =
        ambient_raw.saturating_sub(AUTO_DIM_KNEE) as f64 / (AUTO_RAW_AT_MAX - AUTO_DIM_KNEE as f64);
    let ratio = normalized.clamp(0.0, 1.0).sqrt();
    let span = (max_brightness - min_brightness) as f64;
    min_brightness + (span * ratio).round() as u32
}

async fn read_backlight_raw(device: &BacklightDevice) -> Option<u32> {
    let actual_path = device.brightness_path.with_file_name("actual_brightness");
    let raw = match read_u32_file(&actual_path).await {
        Some(raw) => raw,
        None => read_u32_file(&device.brightness_path).await?,
    };
    Some(raw.min(device.max_brightness))
}

async fn read_current_brightness_file() -> Option<u8> {
    let device = discover_backlight_device().await.ok()?;
    let raw = read_backlight_raw(&device).await?;
    Some(backlight_raw_to_logical(raw, device.max_brightness))
}

fn median_of_samples(samples: &VecDeque<u32>) -> Option<u32> {
    if samples.len() < SMOOTHING_SAMPLES {
        return None;
    }
    let mut sorted: Vec<u32> = samples.iter().copied().collect();
    sorted.sort_unstable();
    Some(sorted[sorted.len() / 2])
}

fn ambient_to_stock_level(ambient_raw: u32) -> u32 {
    if ambient_raw < STOCK_AMBIENT_CURVE_MIN_RAW {
        return STOCK_AMBIENT_DARKEST_LEVEL;
    }
    if ambient_raw > STOCK_AMBIENT_CURVE_MAX_RAW {
        return STOCK_AMBIENT_BRIGHTEST_LEVEL;
    }

    let curve_input = ((ambient_raw as f32 * -182.88 + 2219.9).trunc()).abs();
    (curve_input.ln() * -19.324 + 297.48)
        .round()
        .clamp(0.0, STOCK_AMBIENT_LEVEL_MAX as f32) as u32
}

fn normalize_stock_ambient_level(level: u32) -> u32 {
    100 * level.min(STOCK_AMBIENT_LEVEL_MAX) / STOCK_AMBIENT_LEVEL_MAX
}

struct AmbientLightEventFilter {
    samples: VecDeque<u32>,
    raw_value: Option<u32>,
    current_level: Option<u32>,
    target_level: Option<u32>,
    previous_target: Option<u32>,
    previous_step: i64,
    ticks_since_event: u8,
}

impl AmbientLightEventFilter {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(SMOOTHING_SAMPLES),
            raw_value: None,
            current_level: None,
            target_level: None,
            previous_target: None,
            previous_step: 0,
            ticks_since_event: 0,
        }
    }

    fn push_sample(&mut self, value: u32) {
        self.samples.push_back(value);
        if self.samples.len() > SMOOTHING_SAMPLES {
            self.samples.pop_front();
        }
        if let Some(median) = median_of_samples(&self.samples) {
            self.raw_value = Some(median);
            self.target_level = Some(ambient_to_stock_level(median));
        }
    }

    fn tick(&mut self) -> Option<AmbientLightUpdateEvent> {
        let target = self.target_level?;
        let current = match self.current_level {
            Some(current) => {
                let (next, step) = smooth_backlight_step(
                    current,
                    target,
                    self.previous_target,
                    self.previous_step,
                    STOCK_AMBIENT_LEVEL_MAX,
                );
                self.previous_target = Some(target);
                self.previous_step = step;
                next
            }
            None => target,
        };
        self.current_level = Some(current);
        self.ticks_since_event = self.ticks_since_event.saturating_add(1);

        if self.ticks_since_event < AMBIENT_EVENT_TICKS {
            return None;
        }
        self.ticks_since_event = 0;

        Some(AmbientLightUpdateEvent {
            value: self.raw_value?,
            normalized_value: normalize_stock_ambient_level(current),
        })
    }
}

fn transition_step(current: u32, target: u32) -> i64 {
    if current == target {
        return 0;
    }
    let diff = target as i64 - current as i64;
    let magnitude = diff.unsigned_abs();
    let step = ((magnitude as f32 * BACKLIGHT_STEP_FRACTION).round() as u64).max(1);
    if diff > 0 {
        step as i64
    } else {
        -(step as i64)
    }
}

fn advance_backlight(current: u32, target: u32, step: i64, max_brightness: u32) -> u32 {
    if current == target {
        return current;
    }
    let next = current as i64 + step;
    let next = if (step > 0 && next >= target as i64) || (step < 0 && next <= target as i64) {
        target
    } else {
        next.max(0) as u32
    };
    next.clamp(minimum_auto_backlight(max_brightness), max_brightness)
}

fn smooth_backlight_step(
    current: u32,
    target: u32,
    previous_target: Option<u32>,
    previous_step: i64,
    max_brightness: u32,
) -> (u32, i64) {
    let direction = (target as i64 - current as i64).signum();
    let step = if previous_target == Some(target) && previous_step.signum() == direction {
        previous_step
    } else {
        transition_step(current, target)
    };
    (
        advance_backlight(current, target, step, max_brightness),
        step,
    )
}

async fn auto_brightness_loop(device: BacklightDevice) {
    let mut samples: VecDeque<u32> = VecDeque::with_capacity(SMOOTHING_SAMPLES);
    let mut target: Option<u32> = None;
    let mut previous_target: Option<u32> = None;
    let mut previous_step = 0;
    let mut sample_interval = tokio::time::interval(AUTO_SAMPLE_INTERVAL);
    sample_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut update_interval = tokio::time::interval(BACKLIGHT_UPDATE_INTERVAL);
    update_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            _ = sample_interval.tick() => {
                if let Some(als_raw) = read_ambient_light().await {
                    samples.push_back(als_raw);
                    if samples.len() > SMOOTHING_SAMPLES {
                        samples.pop_front();
                    }
                    target = median_of_samples(&samples).map(|median| {
                        ambient_to_backlight_target(median, device.max_brightness)
                    });
                }
            }
            _ = update_interval.tick() => {
                let Some(target) = target else {
                    continue;
                };
                let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;
                if is_display_sleeping() {
                    continue;
                }
                let Some(current_backlight) = read_backlight_raw(&device).await else {
                    continue;
                };
                let (next, step) = smooth_backlight_step(
                    current_backlight,
                    target,
                    previous_target,
                    previous_step,
                    device.max_brightness,
                );
                previous_target = Some(target);
                previous_step = step;
                if next != current_backlight {
                    if let Err(e) = write_backlight_raw(&device, next).await {
                        warn!("Auto-brightness failed to write: {}", e);
                    }
                }
            }
        }
    }
}

fn stop_auto_brightness() {
    let mut handle = AUTO_TASK.lock().unwrap();
    if let Some(h) = handle.take() {
        h.abort();
    }
}

fn auto_brightness_running() -> bool {
    let mut handle = AUTO_TASK.lock().unwrap();
    match handle.as_ref() {
        Some(task) if !task.is_finished() => true,
        Some(_) => {
            handle.take();
            false
        }
        None => false,
    }
}

async fn start_auto_brightness() -> Result<()> {
    let device = discover_backlight_device().await?;
    let current = read_backlight_raw(&device).await.ok_or_else(|| {
        crate::error::NocturnedError::General(anyhow::anyhow!(
            "failed to read current backlight brightness"
        ))
    })?;
    let minimum = minimum_auto_backlight(device.max_brightness);
    if current < minimum {
        write_backlight_raw(&device, minimum).await?;
    }
    if auto_brightness_running() {
        return Ok(());
    }

    stop_auto_brightness();
    info!("Starting native auto-brightness");
    let mut handle = AUTO_TASK.lock().unwrap();
    *handle = Some(tokio::spawn(auto_brightness_loop(device)));
    Ok(())
}

fn clear_display_sleep_state() {
    DISPLAY_SLEEP_STATE.lock().unwrap().take();
}

pub fn is_display_sleeping() -> bool {
    DISPLAY_SLEEP_STATE.lock().unwrap().is_some()
}

pub async fn get_display_config() -> Result<BrightnessConfig> {
    let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;
    if let Some(config) = DISPLAY_SLEEP_STATE.lock().unwrap().clone() {
        return Ok(config);
    }
    get_brightness_config().await
}

pub async fn sleep_display() -> Result<BrightnessConfig> {
    let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;

    if let Some(config) = DISPLAY_SLEEP_STATE.lock().unwrap().clone() {
        return Ok(config);
    }

    let mut config = get_brightness_config().await.unwrap_or_default();
    if let Some(current_brightness) = read_current_brightness_file().await {
        config.brightness = current_brightness;
    }

    write_backlight(BRIGHTNESS_DIMMEST).await?;
    stop_auto_brightness();
    *DISPLAY_SLEEP_STATE.lock().unwrap() = Some(config.clone());

    info!("Display backlight sleeping");
    Ok(config)
}

pub async fn wake_display() -> Result<BrightnessConfig> {
    let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;
    let sleeping_config = DISPLAY_SLEEP_STATE.lock().unwrap().clone();
    let config = match sleeping_config {
        Some(config) => config,
        None => get_brightness_config().await.unwrap_or_default(),
    };

    if config.auto {
        write_backlight(config.brightness).await?;
        if let Err(e) = start_auto_brightness().await {
            let _ = write_backlight(BRIGHTNESS_DIMMEST).await;
            return Err(e);
        }
    } else {
        stop_auto_brightness();
        write_backlight(config.brightness).await?;
    }

    clear_display_sleep_state();
    info!("Display backlight awake");
    Ok(config)
}

pub async fn set_brightness(value: u8) -> Result<()> {
    if !(BRIGHTNESS_BRIGHTEST..=BRIGHTNESS_DIMMEST).contains(&value) {
        return Err(crate::error::NocturnedError::General(anyhow::anyhow!(
            "brightness value must be between {} and {}",
            BRIGHTNESS_BRIGHTEST,
            BRIGHTNESS_DIMMEST
        )));
    }

    let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;
    write_backlight(value).await?;
    stop_auto_brightness();
    clear_display_sleep_state();

    save_config(&BrightnessConfig {
        auto: false,
        brightness: value,
    })
    .await;

    Ok(())
}

pub async fn set_auto_brightness(enabled: bool) -> Result<()> {
    let _op_guard = BRIGHTNESS_OP_LOCK.lock().await;
    let sleeping_config = DISPLAY_SLEEP_STATE.lock().unwrap().clone();
    let mut config = match sleeping_config.clone() {
        Some(config) => config,
        None => get_brightness_config().await.unwrap_or_default(),
    };

    if enabled {
        if let Some(sleeping_config) = &sleeping_config {
            write_backlight(sleeping_config.brightness).await?;
        }
        if let Err(e) = start_auto_brightness().await {
            if sleeping_config.is_some() {
                let _ = write_backlight(BRIGHTNESS_DIMMEST).await;
            }
            return Err(e);
        }
    } else {
        write_backlight(config.brightness).await?;
        stop_auto_brightness();
        info!("Stopped native auto-brightness");
    }

    clear_display_sleep_state();
    config.auto = enabled;
    save_config(&config).await;

    Ok(())
}

pub async fn init_brightness() -> Result<()> {
    let _ = discover_ambient_light_path().await;

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

async fn try_ambient_light_file(path: PathBuf) -> Option<PathBuf> {
    read_u32_file(&path).await?;
    Some(path)
}

async fn ambient_light_file_in_iio_device(device_path: &Path) -> Option<PathBuf> {
    for file_name in ["in_intensity0_raw", "in_illuminance0_input"] {
        let path = device_path.join(file_name);
        if let Some(path) = try_ambient_light_file(path).await {
            return Some(path);
        }
    }
    None
}

async fn configure_ambient_light_sensor(device_path: &Path) {
    let integration_time_path = device_path.join("in_intensity0_integration_time");
    if let Err(e) = fs::write(&integration_time_path, ALS_INTEGRATION_TIME).await {
        warn!(
            "Failed to set ambient light integration time at {}: {}",
            integration_time_path.display(),
            e
        );
    }

    let gain_path = device_path.join("in_intensity0_calibscale");
    if let Err(e) = fs::write(&gain_path, ALS_GAIN).await {
        warn!(
            "Failed to set ambient light gain at {}: {}",
            gain_path.display(),
            e
        );
    }
}

async fn discover_ambient_light_path() -> Option<PathBuf> {
    if let Some(path) = AMBIENT_LIGHT_PATH.get() {
        return Some(path.clone());
    }

    let _discovery_guard = AMBIENT_LIGHT_DISCOVERY_LOCK.lock().await;
    if let Some(path) = AMBIENT_LIGHT_PATH.get() {
        return Some(path.clone());
    }

    if let Ok(mut entries) = fs::read_dir(IIO_BUS_DIR).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let file_name = entry.file_name();
            if !file_name.to_string_lossy().starts_with("iio:device") {
                continue;
            }
            let device_path = entry.path();
            if let Some(path) = ambient_light_file_in_iio_device(&device_path).await {
                configure_ambient_light_sensor(&device_path).await;
                let _ = AMBIENT_LIGHT_PATH.set(path.clone());
                info!("Using ambient light sensor {}", path.display());
                return Some(path);
            }
        }
    }

    None
}

pub async fn read_ambient_light() -> Option<u32> {
    let path = discover_ambient_light_path().await?;
    read_u32_file(&path).await
}

pub fn start_ambient_light_task(websocket_server: Arc<WebSocketServer>) {
    tokio::spawn(async move {
        let mut filter = AmbientLightEventFilter::new();
        let mut sample_interval = tokio::time::interval(AUTO_SAMPLE_INTERVAL);
        sample_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut event_interval = tokio::time::interval(BACKLIGHT_UPDATE_INTERVAL);
        event_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = sample_interval.tick() => {
                    if let Some(value) = read_ambient_light().await {
                        filter.push_sample(value);
                    }
                }
                _ = event_interval.tick() => {
                    if let Some(event) = filter.tick() {
                        debug!(
                            value = event.value,
                            normalized_value = event.normalized_value,
                            "Ambient light sensor value"
                        );
                        websocket_server
                            .broadcast_event(
                                "ambient_light_update".to_string(),
                                serde_json::to_value(event).unwrap_or_else(|error| {
                                    warn!(%error, "Failed to serialize ambient light event");
                                    serde_json::json!({})
                                }),
                            )
                            .await;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_logical_brightness_to_full_backlight_range() {
        assert_eq!(logical_to_backlight_raw(BRIGHTNESS_BRIGHTEST, 160), 160);
        assert_eq!(logical_to_backlight_raw(BRIGHTNESS_DIMMEST, 160), 0);
        assert_eq!(backlight_raw_to_logical(160, 160), BRIGHTNESS_BRIGHTEST);
        assert_eq!(backlight_raw_to_logical(0, 160), BRIGHTNESS_DIMMEST);
    }

    #[test]
    fn clamps_logical_brightness_before_writing_backlight() {
        assert_eq!(logical_to_backlight_raw(200, 160), 0);
        assert_eq!(clamp_brightness(200), BRIGHTNESS_DIMMEST);
    }

    #[test]
    fn default_brightness_uses_current_logical_range() {
        assert_eq!(BrightnessConfig::default().brightness, DEFAULT_BRIGHTNESS);
        assert_eq!(clamp_brightness(DEFAULT_BRIGHTNESS), DEFAULT_BRIGHTNESS);
    }

    #[test]
    fn maps_ambient_light_to_calibrated_backlight_curve() {
        assert_eq!(ambient_to_backlight_target(0, 160), 16);
        assert_eq!(ambient_to_backlight_target(AUTO_DIM_KNEE, 160), 16);
        assert_eq!(ambient_to_backlight_target(AUTO_DIM_KNEE + 1, 160), 20);
        assert_eq!(ambient_to_backlight_target(31, 160), 36);
        assert_eq!(ambient_to_backlight_target(34, 160), 37);
        assert_eq!(ambient_to_backlight_target(36, 160), 37);
        assert_eq!(ambient_to_backlight_target(100, 160), 53);
        assert_eq!(ambient_to_backlight_target(500, 160), 99);
        assert_eq!(ambient_to_backlight_target(1000, 160), 134);
        assert_eq!(ambient_to_backlight_target(1500, 160), 160);
        assert_eq!(ambient_to_backlight_target(u32::MAX, 160), 160);
        assert_eq!(ambient_to_backlight_target(0, 8), 8);

        let mut previous = minimum_auto_backlight(160);
        for raw in 0..=2000 {
            let target = ambient_to_backlight_target(raw, 160);
            assert!((minimum_auto_backlight(160)..=160).contains(&target));
            assert!(target >= previous);
            previous = target;
        }

        let knee_target = ambient_to_backlight_target(AUTO_DIM_KNEE, 160);
        let next_target = ambient_to_backlight_target(AUTO_DIM_KNEE + 1, 160);
        assert!(next_target - knee_target <= 4);
    }

    #[test]
    fn waits_for_a_full_window_and_maps_the_median_to_a_target() {
        let mut samples = VecDeque::new();
        for _ in 0..SMOOTHING_SAMPLES - 1 {
            samples.push_back(AUTO_RAW_AT_MAX as u32);
        }
        assert_eq!(median_of_samples(&samples), None);

        samples.push_back(AUTO_RAW_AT_MAX as u32);
        let median = median_of_samples(&samples).unwrap();
        assert_eq!(ambient_to_backlight_target(median, 160), 160);
        assert_eq!(minimum_auto_backlight(0), 0);
        assert_eq!(minimum_auto_backlight(8), 8);
        assert_eq!(minimum_auto_backlight(160), 16);
    }

    #[test]
    fn restores_nocturnes_small_fixed_transition_steps() {
        let (next, step) = smooth_backlight_step(16, 160, None, 0, 160);
        assert_eq!(step, 3);
        assert_eq!(next, 19);

        let (next, step) = smooth_backlight_step(next, 160, Some(160), step, 160);
        assert_eq!(step, 3);
        assert_eq!(next, 22);

        let (next, step) = smooth_backlight_step(159, 160, Some(160), step, 160);
        assert_eq!(step, 3);
        assert_eq!(next, 160);

        assert_eq!(
            smooth_backlight_step(160, 160, Some(160), step, 160),
            (160, 0)
        );
        assert_eq!(smooth_backlight_step(160, 16, Some(160), 3, 160), (157, -3));
        assert_eq!(smooth_backlight_step(0, 160, None, 0, 160), (16, 3));
        assert_eq!(smooth_backlight_step(5, 16, None, 0, 160), (16, 1));
        assert_eq!(AUTO_SAMPLE_INTERVAL / 5, BACKLIGHT_UPDATE_INTERVAL);
    }

    #[test]
    fn median_window_rejects_single_sample_outliers() {
        let samples = VecDeque::from([0, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1000]);
        assert_eq!(median_of_samples(&samples), Some(100));
    }

    #[test]
    fn stock_ambient_curve_matches_reversed_daemon_boundaries() {
        assert_eq!(ambient_to_stock_level(0), 235);
        assert_eq!(ambient_to_stock_level(12), 235);
        assert_eq!(ambient_to_stock_level(13), 200);
        assert_eq!(ambient_to_stock_level(100), 110);
        assert_eq!(ambient_to_stock_level(1999), 50);
        assert_eq!(ambient_to_stock_level(2000), 50);
        assert_eq!(normalize_stock_ambient_level(235), 92);
        assert_eq!(normalize_stock_ambient_level(50), 19);
    }

    #[test]
    fn ambient_event_filter_median_filters_and_repeats_current_value() {
        let mut filter = AmbientLightEventFilter::new();
        for value in [1, 1, 1, 1, 1, 1000, 1, 1, 1, 1, 1] {
            filter.push_sample(value);
        }

        let mut emitted = Vec::new();
        for _ in 0..50 {
            if let Some(event) = filter.tick() {
                emitted.push(event);
            }
        }

        assert_eq!(emitted.len(), 2);
        assert!(emitted.iter().all(|event| event.value == 1));
        assert!(emitted.iter().all(|event| event.normalized_value == 92));
    }
}
