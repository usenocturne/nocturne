use rmpv::ValueRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;
use typeshare::typeshare;
use uuid::Uuid;

use crate::Priority;

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "wire.ts")]
pub struct ResponseMeta {
    #[ts(type = "string")]
    #[typeshare(serialized_as = "Vec<u8>")]
    pub request_id: Uuid,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "kind", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "wire.ts")]
pub enum MsgMeta {
    Command,
    Event,
    Request,
    Response(ResponseMeta),
}

#[typeshare]
#[serde_with::skip_serializing_none]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
#[ts(export, export_to = "wire.ts")]
pub enum WireError {
    Unsupported,
    Unimplemented,
    Malformed { reason: String },
    HandlerFailed { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrioritizedFrame<T> {
    pub priority: Priority,
    pub msg: T,
}

impl<T> PrioritizedFrame<T> {
    pub fn normal(msg: T) -> Self {
        Self {
            priority: Priority::Normal,
            msg,
        }
    }

    pub fn bulk(msg: T) -> Self {
        Self {
            priority: Priority::Bulk,
            msg,
        }
    }

    pub fn map<U, F: FnOnce(T) -> U>(self, f: F) -> PrioritizedFrame<U> {
        PrioritizedFrame {
            priority: self.priority,
            msg: f(self.msg),
        }
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct EnvelopeProbe {
    pub id: Option<Uuid>,
    pub meta_kind: Option<String>,
    pub data_type: Option<String>,
    pub data_event: Option<String>,
    pub request_id: Option<Uuid>,
}

impl EnvelopeProbe {
    pub fn is_request(&self) -> bool {
        matches!(self.meta_kind.as_deref(), Some("request"))
    }
}

pub fn try_probe_envelope_msgpack(bytes: &[u8]) -> EnvelopeProbe {
    let mut probe = EnvelopeProbe::default();
    let value = match rmpv::decode::read_value_ref(&mut &bytes[..]) {
        Ok(v) => v,
        Err(_) => return probe,
    };
    let map = match value {
        ValueRef::Map(m) => m,
        _ => return probe,
    };

    for (k, v) in &map {
        let Some(key) = vref_str(k) else { continue };
        match key {
            "id" => probe.id = msgpack_uuid(v),
            "meta" => {
                if let ValueRef::Map(meta_map) = v {
                    for (mk, mv) in meta_map {
                        match vref_str(mk) {
                            Some("kind") => probe.meta_kind = vref_str(mv).map(str::to_owned),
                            Some("data") => {
                                if let ValueRef::Map(data_map) = mv {
                                    for (dk, dv) in data_map {
                                        if vref_str(dk) == Some("requestId") {
                                            probe.request_id = msgpack_uuid(dv);
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            "data" => {
                if let ValueRef::Map(data_map) = v {
                    for (dk, dv) in data_map {
                        match vref_str(dk) {
                            Some("type") => probe.data_type = vref_str(dv).map(str::to_owned),
                            Some("data") => {
                                if let ValueRef::Map(inner) = dv {
                                    for (ik, iv) in inner {
                                        if vref_str(ik) == Some("event") {
                                            probe.data_event = vref_str(iv).map(str::to_owned);
                                        }
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ => {}
        }
    }

    probe
}

pub fn try_probe_envelope_json(bytes: &[u8]) -> EnvelopeProbe {
    let mut probe = EnvelopeProbe::default();
    let value: Value = match serde_json::from_slice(bytes) {
        Ok(v) => v,
        Err(_) => return probe,
    };
    let Value::Object(map) = value else {
        return probe;
    };

    if let Some(id) = map.get("id") {
        probe.id = json_uuid(id);
    }
    if let Some(Value::Object(meta)) = map.get("meta") {
        if let Some(Value::String(kind)) = meta.get("kind") {
            probe.meta_kind = Some(kind.clone());
        }
        if let Some(Value::Object(meta_data)) = meta.get("data") {
            if let Some(rid) = meta_data.get("requestId") {
                probe.request_id = json_uuid(rid);
            }
        }
    }
    if let Some(Value::Object(data)) = map.get("data") {
        if let Some(Value::String(type_str)) = data.get("type") {
            probe.data_type = Some(type_str.clone());
        }
        if let Some(Value::Object(inner)) = data.get("data") {
            if let Some(Value::String(event)) = inner.get("event") {
                probe.data_event = Some(event.clone());
            }
        }
    }

    probe
}

fn vref_str<'a>(v: &'a ValueRef<'a>) -> Option<&'a str> {
    match v {
        ValueRef::String(s) => s.as_str(),
        _ => None,
    }
}

fn msgpack_uuid(value: &ValueRef) -> Option<Uuid> {
    match value {
        ValueRef::Binary(bytes) if bytes.len() == 16 => Uuid::from_slice(bytes).ok(),
        ValueRef::Array(arr) if arr.len() == 16 => {
            let mut buf = [0u8; 16];
            for (i, v) in arr.iter().enumerate() {
                let n = v.as_u64()?;
                if n > u8::MAX as u64 {
                    return None;
                }
                buf[i] = n as u8;
            }
            Some(Uuid::from_bytes(buf))
        }
        ValueRef::String(s) => s.as_str().and_then(|s| Uuid::parse_str(s).ok()),
        _ => None,
    }
}

fn json_uuid(value: &Value) -> Option<Uuid> {
    match value {
        Value::String(s) => Uuid::parse_str(s).ok(),
        Value::Array(arr) if arr.len() == 16 => {
            let mut buf = [0u8; 16];
            for (i, v) in arr.iter().enumerate() {
                let n = v.as_u64()?;
                if n > u8::MAX as u64 {
                    return None;
                }
                buf[i] = n as u8;
            }
            Some(Uuid::from_bytes(buf))
        }
        _ => None,
    }
}
