use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Deserialize, Clone)]
pub struct VersionInfo {
    version: String,
    #[serde(rename = "shortVersion")]
    short_version: String,
    #[serde(rename = "gitHash")]
    git_hash: String,
    #[serde(rename = "buildDate")]
    build_date: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoMetadata {
    pub device: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub build_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub git_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub debug_logs: bool,
}

impl Config {
    pub fn load() -> Result<Self> {
        let config_path = "/etc/nocturne/config.json";
        if Path::new(config_path).exists() {
            let contents = std::fs::read_to_string(config_path)?;
            Ok(serde_json::from_str(&contents)?)
        } else {
            Ok(Config::default())
        }
    }
}

pub fn get_bluetooth_device_name() -> Result<String> {
    let serial_number = get_serial_number()?;
    let last_four = if serial_number.len() >= 4 {
        &serial_number[serial_number.len() - 4..]
    } else {
        &serial_number
    };
    Ok(format!("Nocturne ({})", last_four))
}

pub fn get_serial_number() -> Result<String> {
    let usid_path = Path::new("/sys/class/efuse/usid");

    let contents = std::fs::read_to_string(usid_path)
        .map_err(|e| anyhow::anyhow!("Failed to read serial number: {}", e))?;

    let serial = contents.trim().to_string();
    if serial.is_empty() {
        return Err(anyhow::anyhow!("Serial number is empty"));
    }

    Ok(serial)
}

pub fn get_version_info() -> Result<VersionInfo> {
    let version_path = Path::new("/etc/nocturne/version.json");

    let contents = std::fs::read_to_string(version_path)
        .map_err(|e| anyhow::anyhow!("Failed to read firmware version: {}", e))?;

    let version_info: VersionInfo = serde_json::from_str(&contents)
        .map_err(|e| anyhow::anyhow!("Failed to parse version JSON: {}", e))?;

    Ok(version_info)
}

pub fn get_firmware_version() -> Result<String> {
    let info = get_version_info()?;

    let mut version = info.short_version.trim_start_matches('v').to_string();
    if version.is_empty() {
        version = info.version.trim_start_matches('v').to_string();
    }

    if version.is_empty() {
        return Err(anyhow::anyhow!("Firmware version is empty"));
    }

    Ok(version)
}

pub fn collect_device_info_metadata() -> DeviceInfoMetadata {
    let device = get_bluetooth_device_name().unwrap_or_else(|_| "Nocturne".to_string());

    let mut version = "unknown".to_string();
    let mut full_version = None;
    let mut build_date = None;
    let mut git_hash = None;

    if let Ok(info) = get_version_info() {
        let normalized = info.short_version.trim_start_matches('v').to_string();
        let fallback = info.version.trim_start_matches('v').to_string();

        if !normalized.is_empty() {
            version = normalized;
        } else if !fallback.is_empty() {
            version = fallback;
        }

        if !info.version.is_empty() {
            full_version = Some(info.version.clone());
        }
        if !info.build_date.is_empty() {
            build_date = Some(info.build_date.clone());
        }
        if !info.git_hash.is_empty() {
            git_hash = Some(info.git_hash.clone());
        }
    }

    let serial_number = match get_serial_number() {
        Ok(serial) if !serial.is_empty() => Some(serial),
        _ => None,
    };

    DeviceInfoMetadata {
        device,
        version,
        full_version,
        build_date,
        git_hash,
        serial_number,
    }
}
