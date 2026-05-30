use serde::{Deserialize, Serialize};
use ts_rs::TS;
use typeshare::typeshare;
use uuid::Uuid;

use crate::{OtaError, OtaProgress, RangeSpec};

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaBeginAck {
    pub resume_from_offset: u32,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaBeginRejected {
    pub reason: String,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAssetRange {
    pub update_id: String,
    pub asset: String,
    pub ranges: Vec<RangeSpec>,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAssetRangeAbandon {
    #[ts(type = "string")]
    #[typeshare(serialized_as = "Vec<u8>")]
    pub request_id: Uuid,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub enum NocturneToGatewaySystemMsg {
    OtaProgress(OtaProgress),
    OtaError(OtaError),
    OtaBeginAck(OtaBeginAck),
    OtaBeginRejected(OtaBeginRejected),
    OtaAssetRange(OtaAssetRange),
    OtaAssetRangeAbandon(OtaAssetRangeAbandon),
}

impl From<OtaProgress> for NocturneToGatewaySystemMsg {
    fn from(value: OtaProgress) -> Self {
        Self::OtaProgress(value)
    }
}

impl From<OtaError> for NocturneToGatewaySystemMsg {
    fn from(value: OtaError) -> Self {
        Self::OtaError(value)
    }
}

impl From<OtaBeginAck> for NocturneToGatewaySystemMsg {
    fn from(value: OtaBeginAck) -> Self {
        Self::OtaBeginAck(value)
    }
}

impl From<OtaBeginRejected> for NocturneToGatewaySystemMsg {
    fn from(value: OtaBeginRejected) -> Self {
        Self::OtaBeginRejected(value)
    }
}

impl From<OtaAssetRange> for NocturneToGatewaySystemMsg {
    fn from(value: OtaAssetRange) -> Self {
        Self::OtaAssetRange(value)
    }
}

impl From<OtaAssetRangeAbandon> for NocturneToGatewaySystemMsg {
    fn from(value: OtaAssetRangeAbandon) -> Self {
        Self::OtaAssetRangeAbandon(value)
    }
}
