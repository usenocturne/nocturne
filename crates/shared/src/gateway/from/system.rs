use derive_more::derive::Debug;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use typeshare::typeshare;
use uuid::Uuid;

use crate::{OtaKind, RangePart};

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaBegin {
    pub kind: OtaKind,
    pub update_id: String,
    pub update_url_base: Option<String>,
    pub expected_sha256: String,
    pub expected_size: u32,
}

#[typeshare]
#[serde_with::serde_as]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaChunk {
    pub update_id: String,
    pub offset: u32,
    #[debug(skip)]
    #[serde_as(as = "serde_with::Bytes")]
    #[ts(type = "Uint8Array")]
    pub bytes: Vec<u8>,
    pub last: bool,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAbandon {
    pub update_id: String,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAssetRangeReply {
    pub total_size: u32,
    pub parts: Vec<RangePart>,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAssetRangeRejected {
    pub reason: String,
}

#[typeshare]
#[serde_with::serde_as]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct OtaAssetRangeChunk {
    #[ts(type = "string")]
    #[typeshare(serialized_as = "Vec<u8>")]
    pub request_id: Uuid,
    pub part_index: u32,
    pub offset: u32,
    #[debug(skip)]
    #[serde_as(as = "serde_with::Bytes")]
    #[ts(type = "Uint8Array")]
    pub bytes: Vec<u8>,
    pub last: bool,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub enum GatewayToNocturneSystemMsg {
    OtaBegin(OtaBegin),
    OtaChunk(OtaChunk),
    OtaAbandon(OtaAbandon),
    OtaAssetRangeReply(OtaAssetRangeReply),
    OtaAssetRangeRejected(OtaAssetRangeRejected),
    OtaAssetRangeChunk(OtaAssetRangeChunk),
}

impl From<OtaBegin> for GatewayToNocturneSystemMsg {
    fn from(value: OtaBegin) -> Self {
        Self::OtaBegin(value)
    }
}

impl From<OtaChunk> for GatewayToNocturneSystemMsg {
    fn from(value: OtaChunk) -> Self {
        Self::OtaChunk(value)
    }
}

impl From<OtaAbandon> for GatewayToNocturneSystemMsg {
    fn from(value: OtaAbandon) -> Self {
        Self::OtaAbandon(value)
    }
}

impl From<OtaAssetRangeReply> for GatewayToNocturneSystemMsg {
    fn from(value: OtaAssetRangeReply) -> Self {
        Self::OtaAssetRangeReply(value)
    }
}

impl From<OtaAssetRangeRejected> for GatewayToNocturneSystemMsg {
    fn from(value: OtaAssetRangeRejected) -> Self {
        Self::OtaAssetRangeRejected(value)
    }
}

impl From<OtaAssetRangeChunk> for GatewayToNocturneSystemMsg {
    fn from(value: OtaAssetRangeChunk) -> Self {
        Self::OtaAssetRangeChunk(value)
    }
}
