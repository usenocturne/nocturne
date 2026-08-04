use serde::{Deserialize, Serialize};
use ts_rs::TS;
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub enum OtaKind {
    Image,
    Daemon,
    BuiltinWebapp,
    Bandaid,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub enum OtaPhase {
    /// Companion downloading the artifact from the OTA server (server -> phone),
    /// reported by the phone via `ota.download_progress`. Precedes `Streaming`.
    Downloading,
    /// Companion transferring the downloaded artifact to the device over the
    /// link (phone -> daemon), tracked daemon-side from received chunk bytes.
    Streaming,
    Verifying,
    Writing,
    Confirming,
    Reboot,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub struct OtaProgress {
    pub phase: OtaPhase,
    pub percent: u8,
    pub eta_ms: Option<u32>,
    pub asset: Option<String>,
    pub transferred_bytes: Option<u32>,
    pub total_bytes: Option<u32>,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub enum OtaErrorCode {
    UnknownUpdate,
    OffsetMismatch,
    HashMismatch,
    SizeMismatch,
    Cancelled,
    WriteFailed,
    ConfirmFailed,
    Internal,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub struct OtaError {
    pub code: OtaErrorCode,
    pub msg: String,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub struct RangeSpec {
    pub start: u32,
    pub length: u32,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub struct RangePart {
    pub start: u32,
    pub length: u32,
}

#[typeshare]
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, Hash, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "shared.ts")]
pub enum Priority {
    #[default]
    Normal,
    Bulk,
}

impl Priority {
    pub const fn as_byte(self) -> u8 {
        match self {
            Self::Normal => 0x00,
            Self::Bulk => 0x01,
        }
    }

    pub const fn from_byte(byte: u8) -> Self {
        match byte {
            0x01 => Self::Bulk,
            _ => Self::Normal,
        }
    }
}
