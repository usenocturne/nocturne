use anyhow::{anyhow, Result};
use libnocturne::generated::device::{DeviceInfoResponse, DeviceVersionResponse};
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionInfo {
    version: String,
    short_version: String,
    image_version: String,
    bandaid_version: String,
    git_hash: String,
    build_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledOtaVersions {
    pub image: String,
    pub bandaid: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub debug_logs: bool,
}

const NVMEM_EFUSE_CELLS_DIR: &str = "/sys/bus/nvmem/devices/efuse0/cells";
const SERIAL_NUMBER_CELL_PREFIX: &str = "serial-number@";
const BT_MAC_CELL_PREFIX: &str = "bt-mac@";
const LEGACY_USID_PATH: &str = "/sys/class/efuse/usid";
const SUPERBIRD_META_PATH: &str = "/etc/superbird";
const BANDAID_OVERLAY_ROOT: &str = "/var/lib/bandaid/nocturne";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SuperbirdMetadata {
    #[serde(default)]
    version: String,
    #[serde(default)]
    image_build_date: String,
    #[serde(default)]
    image_version: String,
    #[serde(default)]
    bt_mac: String,
    #[serde(default)]
    serial_number: String,
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
    read_serial_number_from_paths(
        Path::new(NVMEM_EFUSE_CELLS_DIR),
        Path::new(LEGACY_USID_PATH),
        Path::new(SUPERBIRD_META_PATH),
    )
}

pub fn get_bluetooth_mac() -> Result<[u8; 6]> {
    read_bluetooth_mac_from_paths(
        Path::new(NVMEM_EFUSE_CELLS_DIR),
        Path::new(SUPERBIRD_META_PATH),
    )
}

fn read_serial_number_from_paths(
    nvmem_cells_dir: &Path,
    legacy_usid_path: &Path,
    metadata_path: &Path,
) -> Result<String> {
    let nvmem_err =
        match read_nvmem_text_cell(nvmem_cells_dir, SERIAL_NUMBER_CELL_PREFIX, "serial number") {
            Ok(serial) => return Ok(serial),
            Err(err) => err,
        };

    let legacy_err = match read_text_identifier(legacy_usid_path, "serial number") {
        Ok(serial) => return Ok(serial),
        Err(err) => err,
    };

    match read_superbird_metadata(metadata_path).and_then(|meta| {
        trim_identifier(&meta.serial_number, "serial number", metadata_path.display())
    }) {
        Ok(serial) => Ok(serial),
        Err(metadata_err) => Err(anyhow!(
            "Failed to read serial number: nvmem: {nvmem_err}; legacy usid: {legacy_err}; metadata: {metadata_err}"
        )),
    }
}

fn read_bluetooth_mac_from_paths(nvmem_cells_dir: &Path, metadata_path: &Path) -> Result<[u8; 6]> {
    let nvmem_err = match read_nvmem_mac_cell(nvmem_cells_dir, BT_MAC_CELL_PREFIX) {
        Ok(mac) => return Ok(mac),
        Err(err) => err,
    };

    match read_superbird_metadata(metadata_path)
        .and_then(|meta| parse_bluetooth_mac(&meta.bt_mac, metadata_path.display()))
    {
        Ok(mac) => Ok(mac),
        Err(metadata_err) => Err(anyhow!(
            "Failed to read Bluetooth MAC: nvmem: {nvmem_err}; metadata: {metadata_err}"
        )),
    }
}

fn read_nvmem_text_cell(cells_dir: &Path, prefix: &str, field: &str) -> Result<String> {
    let path = first_nvmem_cell_path(cells_dir, prefix)?;
    read_text_identifier(&path, field)
}

fn read_nvmem_mac_cell(cells_dir: &Path, prefix: &str) -> Result<[u8; 6]> {
    let path = first_nvmem_cell_path(cells_dir, prefix)?;
    let bytes = std::fs::read(&path).map_err(|err| {
        anyhow!(
            "Failed to read Bluetooth MAC from {}: {err}",
            path.display()
        )
    })?;
    parse_raw_bluetooth_mac(&bytes, path.display())
}

fn first_nvmem_cell_path(cells_dir: &Path, prefix: &str) -> Result<PathBuf> {
    let entries = std::fs::read_dir(cells_dir).map_err(|err| {
        anyhow!(
            "Failed to read efuse nvmem cells directory {}: {err}",
            cells_dir.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|err| {
            anyhow!(
                "Failed to inspect efuse nvmem cell in {}: {err}",
                cells_dir.display()
            )
        })?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if file_name.starts_with(prefix) {
            return Ok(entry.path());
        }
    }

    Err(anyhow!(
        "No efuse nvmem cell matching {}* in {}",
        prefix,
        cells_dir.display()
    ))
}

fn read_text_identifier(path: &Path, field: &str) -> Result<String> {
    let bytes = std::fs::read(path)
        .map_err(|err| anyhow!("Failed to read {field} from {}: {err}", path.display()))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|err| anyhow!("Invalid UTF-8 in {field} from {}: {err}", path.display()))?;
    trim_identifier(text, field, path.display())
}

fn trim_identifier(text: &str, field: &str, source: impl fmt::Display) -> Result<String> {
    let value = text.trim_matches(|ch: char| ch == '\0' || ch.is_ascii_whitespace());
    if value.is_empty() {
        return Err(anyhow!("{field} is empty in {source}"));
    }
    Ok(value.to_string())
}

fn parse_raw_bluetooth_mac(bytes: &[u8], source: impl fmt::Display) -> Result<[u8; 6]> {
    if bytes.len() != 6 {
        return Err(anyhow!(
            "Bluetooth MAC in {source} must be 6 raw bytes, got {}",
            bytes.len()
        ));
    }

    let mut mac = [0u8; 6];
    mac.copy_from_slice(bytes);
    Ok(mac)
}

fn parse_bluetooth_mac(text: &str, source: impl fmt::Display) -> Result<[u8; 6]> {
    let mut mac = [0u8; 6];
    let mut parts = text.split(':');

    for octet in &mut mac {
        let part = parts
            .next()
            .ok_or_else(|| anyhow!("Bluetooth MAC in {source} has fewer than 6 octets"))?;
        if part.len() != 2 {
            return Err(anyhow!(
                "Bluetooth MAC in {source} has invalid octet '{part}'"
            ));
        }
        *octet = u8::from_str_radix(part, 16).map_err(|err| {
            anyhow!("Bluetooth MAC in {source} has invalid octet '{part}': {err}")
        })?;
    }

    if parts.next().is_some() {
        return Err(anyhow!("Bluetooth MAC in {source} has more than 6 octets"));
    }

    Ok(mac)
}

fn read_superbird_metadata(path: &Path) -> Result<SuperbirdMetadata> {
    let contents = std::fs::read(path)
        .map_err(|err| anyhow!("Failed to read metadata from {}: {err}", path.display()))?;
    serde_json::from_slice(&contents)
        .map_err(|err| anyhow!("Failed to parse metadata from {}: {err}", path.display()))
}

pub fn get_version_info() -> Result<VersionInfo> {
    read_version_info_from_paths(
        Path::new(SUPERBIRD_META_PATH),
        Path::new(crate::ota::BANDAID_VERSION_PATH),
        Path::new(BANDAID_OVERLAY_ROOT),
    )
}

#[cfg(test)]
fn read_version_info_from_path(path: &Path) -> Result<VersionInfo> {
    let metadata = read_superbird_metadata(path)?;
    version_info_from_superbird_metadata(&metadata, path.display())
}

fn read_version_info_from_paths(
    metadata_path: &Path,
    overlay_version_path: &Path,
    overlay_root: &Path,
) -> Result<VersionInfo> {
    let metadata = read_superbird_metadata(metadata_path)?;
    let mut info = version_info_from_superbird_metadata(&metadata, metadata_path.display())?;
    if overlay_is_active(overlay_root) {
        if let Ok(version) = read_overlay_version(overlay_version_path) {
            info.version = version.clone();
            info.short_version = version.clone();
            info.bandaid_version = version;
        }
    }
    Ok(info)
}

fn overlay_is_active(root: &Path) -> bool {
    [
        root.join("daemon/nocturned.current"),
        root.join("webapps/ui/index.html"),
    ]
    .iter()
    .all(|path| {
        std::fs::symlink_metadata(path)
            .map(|metadata| metadata.file_type().is_file())
            .unwrap_or(false)
    })
}

fn read_overlay_version(path: &Path) -> Result<String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|err| {
        anyhow!(
            "Failed to inspect overlay version marker {}: {err}",
            path.display()
        )
    })?;
    if !metadata.file_type().is_file() {
        return Err(anyhow!(
            "Overlay version marker {} is not a regular file",
            path.display()
        ));
    }
    let version = read_text_identifier(path, "overlay version")?;
    crate::ota::validate_target_version(&version)
        .map_err(|reason| anyhow!("Invalid overlay version in {}: {reason}", path.display()))?;
    Ok(version)
}

fn version_info_from_superbird_metadata(
    metadata: &SuperbirdMetadata,
    source: impl fmt::Display,
) -> Result<VersionInfo> {
    let source = source.to_string();
    let short_version = trim_identifier(&metadata.version, "firmware version", &source)?;
    let image_version = if metadata.image_version.trim().is_empty() {
        short_version.clone()
    } else {
        trim_identifier(&metadata.image_version, "image version", &source)?
    };
    let build_date = metadata
        .image_build_date
        .trim_matches(|ch: char| ch == '\0' || ch.is_ascii_whitespace())
        .to_string();

    Ok(VersionInfo {
        version: image_version.clone(),
        short_version,
        image_version: image_version.clone(),
        bandaid_version: image_version,
        git_hash: String::new(),
        build_date,
    })
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

pub fn get_installed_ota_versions() -> Result<InstalledOtaVersions> {
    let info = get_version_info()?;
    Ok(InstalledOtaVersions {
        image: info.image_version,
        bandaid: info.bandaid_version,
    })
}

pub fn collect_device_info_metadata() -> DeviceInfoResponse {
    let device = get_bluetooth_device_name().unwrap_or_else(|_| "Nocturne".to_string());

    let mut version = "unknown".to_string();
    let mut full_version = None;
    let mut image_version = None;
    let mut bandaid_version = None;
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
        if !info.image_version.is_empty() {
            image_version = Some(info.image_version.clone());
        }
        if !info.bandaid_version.is_empty() {
            bandaid_version = Some(info.bandaid_version.clone());
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

    DeviceInfoResponse {
        device,
        version,
        full_version,
        image_version,
        bandaid_version,
        build_date,
        git_hash,
        serial_number,
    }
}

pub fn collect_device_version_metadata() -> DeviceVersionResponse {
    match get_version_info() {
        Ok(info) => DeviceVersionResponse {
            version: non_empty_option(info.version),
            short_version: non_empty_option(info.short_version),
            image_version: non_empty_option(info.image_version),
            bandaid_version: non_empty_option(info.bandaid_version),
            git_hash: non_empty_option(info.git_hash),
            build_date: non_empty_option(info.build_date),
            error: None,
        },
        Err(e) => DeviceVersionResponse {
            version: None,
            short_version: None,
            image_version: None,
            bandaid_version: None,
            git_hash: None,
            build_date: None,
            error: Some(e.to_string()),
        },
    }
}

fn non_empty_option(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn serial_number_reads_named_nvmem_cell_first() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let cells_dir = dir.path().join("cells");
        fs::create_dir(&cells_dir)?;
        let legacy_usid = dir.path().join("usid");
        let metadata = dir.path().join("superbird");

        fs::write(cells_dir.join("serial-number@12"), b"\0BT1234567890\n")?;
        fs::write(&legacy_usid, "LEGACY")?;
        fs::write(
            &metadata,
            r#"{"serialNumber":"META","btMac":"A0:52:72:8E:56:ED"}"#,
        )?;

        let serial = read_serial_number_from_paths(&cells_dir, &legacy_usid, &metadata)?;
        assert_eq!(serial, "BT1234567890");
        Ok(())
    }

    #[test]
    fn serial_number_falls_back_to_legacy_usid() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let legacy_usid = dir.path().join("usid");
        fs::write(&legacy_usid, "LEGACY1234\n")?;

        let serial = read_serial_number_from_paths(
            &dir.path().join("missing-cells"),
            &legacy_usid,
            &dir.path().join("missing-meta"),
        )?;
        assert_eq!(serial, "LEGACY1234");
        Ok(())
    }

    #[test]
    fn serial_number_and_bluetooth_mac_fall_back_to_superbird_metadata() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let metadata = dir.path().join("superbird");
        fs::write(
            &metadata,
            r#"{"serialNumber":"BT9999999999","btMac":"A0:52:72:8E:56:ED"}"#,
        )?;

        let serial = read_serial_number_from_paths(
            &dir.path().join("missing-cells"),
            &dir.path().join("missing-usid"),
            &metadata,
        )?;
        let mac = read_bluetooth_mac_from_paths(&dir.path().join("missing-cells"), &metadata)?;

        assert_eq!(serial, "BT9999999999");
        assert_eq!(mac, [0xA0, 0x52, 0x72, 0x8E, 0x56, 0xED]);
        Ok(())
    }

    #[test]
    fn bluetooth_mac_reads_raw_nvmem_cell_first() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let cells_dir = dir.path().join("cells");
        fs::create_dir(&cells_dir)?;
        let metadata = dir.path().join("superbird");

        fs::write(cells_dir.join("bt-mac@6"), [1, 2, 3, 4, 5, 6])?;
        fs::write(
            &metadata,
            r#"{"serialNumber":"BT9999999999","btMac":"A0:52:72:8E:56:ED"}"#,
        )?;

        let mac = read_bluetooth_mac_from_paths(&cells_dir, &metadata)?;
        assert_eq!(mac, [1, 2, 3, 4, 5, 6]);
        Ok(())
    }

    #[test]
    fn version_info_reads_superbird_metadata() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let metadata = dir.path().join("superbird");
        fs::write(
            &metadata,
            r#"{
  "version": "4.1.0",
  "imageBuildId": "nocturne-4.1.0-20260531170650",
  "imageBuildDate": "2026-05-31T17:06:50Z",
  "imageVersion": "4.1.0-dev"
}"#,
        )?;

        let info = read_version_info_from_path(&metadata)?;
        assert_eq!(
            info,
            VersionInfo {
                version: "4.1.0-dev".to_string(),
                short_version: "4.1.0".to_string(),
                image_version: "4.1.0-dev".to_string(),
                bandaid_version: "4.1.0-dev".to_string(),
                git_hash: String::new(),
                build_date: "2026-05-31T17:06:50Z".to_string(),
            }
        );
        Ok(())
    }

    #[test]
    fn version_info_falls_back_to_base_version_when_image_version_is_absent() -> Result<()> {
        let metadata = SuperbirdMetadata {
            version: "4.1.0".to_string(),
            ..SuperbirdMetadata::default()
        };

        let info = version_info_from_superbird_metadata(&metadata, "test")?;
        assert_eq!(info.version, "4.1.0");
        assert_eq!(info.short_version, "4.1.0");
        assert_eq!(info.image_version, "4.1.0");
        assert_eq!(info.bandaid_version, "4.1.0");
        Ok(())
    }

    #[test]
    fn version_info_prefers_active_bandaid_version_marker() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let metadata = dir.path().join("superbird");
        let overlay = dir.path().join("bandaid");
        let marker = overlay.join(".floor-version");
        fs::write(
            &metadata,
            r#"{"version":"4.1.0","imageVersion":"4.1.0-prod"}"#,
        )?;
        fs::create_dir_all(overlay.join("daemon"))?;
        fs::create_dir_all(overlay.join("webapps/ui"))?;
        fs::write(overlay.join("daemon/nocturned.current"), b"daemon")?;
        fs::write(overlay.join("webapps/ui/index.html"), b"ui")?;
        fs::write(&marker, b"4.2.0+20260725010101\n")?;

        let info = read_version_info_from_paths(&metadata, &marker, &overlay)?;

        assert_eq!(info.version, "4.2.0+20260725010101");
        assert_eq!(info.short_version, "4.2.0+20260725010101");
        assert_eq!(info.image_version, "4.1.0-prod");
        assert_eq!(info.bandaid_version, "4.2.0+20260725010101");
        assert_eq!(info.build_date, "");
        Ok(())
    }

    #[test]
    fn version_info_ignores_overlay_marker_without_active_overlay() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let metadata = dir.path().join("superbird");
        let overlay = dir.path().join("bandaid");
        let marker = overlay.join(".floor-version");
        fs::write(
            &metadata,
            r#"{"version":"4.1.0","imageVersion":"4.1.0-prod"}"#,
        )?;
        fs::create_dir_all(&overlay)?;
        fs::write(&marker, b"4.2.0+20260725010101\n")?;

        let info = read_version_info_from_paths(&metadata, &marker, &overlay)?;

        assert_eq!(info.version, "4.1.0-prod");
        assert_eq!(info.short_version, "4.1.0");
        assert_eq!(info.image_version, "4.1.0-prod");
        assert_eq!(info.bandaid_version, "4.1.0-prod");
        Ok(())
    }

    #[test]
    fn version_info_requires_superbird_version() {
        let metadata = SuperbirdMetadata::default();
        let err = version_info_from_superbird_metadata(&metadata, "test").unwrap_err();
        assert!(err.to_string().contains("firmware version is empty"));
    }

    #[test]
    fn bluetooth_mac_rejects_malformed_metadata() {
        let err = parse_bluetooth_mac("A0:52:72:8E:56", "test").unwrap_err();
        assert!(err.to_string().contains("fewer than 6 octets"));
    }
}
