use serde::{Deserialize, Serialize};
use ts_rs::TS;
use typeshare::typeshare;
use uuid::Uuid;

pub mod from;
pub mod to;

pub use from::*;
pub use to::*;

use crate::protocol::{MsgMeta, WireError};

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct GatewayToNocturneMsg {
    #[ts(type = "string")]
    #[typeshare(serialized_as = "Vec<u8>")]
    pub id: Uuid,
    pub meta: MsgMeta,
    pub data: GatewayToNocturneMsgData,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub enum GatewayToNocturneMsgData {
    System(GatewayToNocturneSystemMsg),
    Error(WireError),
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub struct NocturneToGatewayMsg {
    #[ts(type = "string")]
    #[typeshare(serialized_as = "Vec<u8>")]
    pub id: Uuid,
    pub meta: MsgMeta,
    pub data: NocturneToGatewayMsgData,
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "gateway.ts")]
pub enum NocturneToGatewayMsgData {
    System(NocturneToGatewaySystemMsg),
    Error(WireError),
    Ack,
    Done,
}

impl From<GatewayToNocturneSystemMsg> for GatewayToNocturneMsgData {
    fn from(value: GatewayToNocturneSystemMsg) -> Self {
        Self::System(value)
    }
}

impl From<NocturneToGatewaySystemMsg> for NocturneToGatewayMsgData {
    fn from(value: NocturneToGatewaySystemMsg) -> Self {
        Self::System(value)
    }
}
