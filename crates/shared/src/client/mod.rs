pub use crate::gateway::OtaBegin;
pub use crate::{OtaError, OtaProgress};

pub const OTA_PROGRESS_EVENT: &str = "otaProgress";
pub const OTA_ERROR_EVENT: &str = "otaError";
pub const OTA_BEGIN_REQUEST: &str = "otaBegin";
pub const OTA_CHUNK_EVENT: &str = "otaChunk";
pub const OTA_ABANDON_COMMAND: &str = "otaAbandon";
pub const OTA_ASSET_RANGE_REQUEST: &str = "otaAssetRange";
pub const OTA_ASSET_RANGE_CHUNK_EVENT: &str = "otaAssetRangeChunk";
