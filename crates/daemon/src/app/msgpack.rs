use crate::hardware::ImageCache;
use crate::http::WebSocketServer;
use crate::{
    app::{AppMessage, AppMessagePriority},
    error::Result,
};
use base64::{engine::general_purpose, Engine as _};
use bluer::Address;
use bytes::{Buf, BufMut, Bytes, BytesMut};
use libnocturne::gateway::{
    OtaAbandon, OtaAssetRangeChunk, OtaAssetRangeRejected, OtaAssetRangeReply, OtaBegin, OtaChunk,
    OtaDownloadProgress, OtaPackageReady,
};
use libnocturne::generated::bt_only::{
    AudioDataEvent, AudioRecordingStartedEvent, AudioRecordingStoppedEvent,
    ChunkRetransmitRequestEvent, DaemonHeartbeatEvent, DaemonReadyEvent, DeviceVolumeUpdateRequest,
    DeviceVolumeUpdateResponse,
};
use libnocturne::generated::device::{
    AppReadyEvent, DeviceTimeGetResponse, NetworkStatusEvent, NotificationShowEvent,
    SubscriptionUpdatedEvent,
};
use libnocturne::generated::media_control::{
    MediaControlNextResponse, MediaControlPauseResponse, MediaControlPlayResponse,
    MediaControlPreviousResponse, MediaControlRepeatResponse, MediaControlShuffleResponse,
    MediaControlVolumeDownResponse, MediaControlVolumeUpResponse, MediaNowPlayingArtworkEvent,
    MediaNowPlayingArtworkFailedEvent, MediaNowPlayingUpdateEvent, PhoneVolumeUpdateEvent,
};
use libnocturne::generated::voice::{
    AiResponseEvent, AiStateEvent, AiToolExecutedEvent, VoiceTranscriptionEvent,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

type JsonValue = serde_json::Value;
type CallHandler = Box<dyn Fn(&JsonValue) -> JsonValue + Send + Sync>;

#[derive(Clone)]
struct AppSessionRoute {
    tx: mpsc::UnboundedSender<AppMessage>,
    session_id: u8,
}

type SharedAppSessionRoute = Arc<Mutex<Option<AppSessionRoute>>>;

fn rmpv_to_json(value: rmpv::Value) -> serde_json::Value {
    match value {
        rmpv::Value::Nil => serde_json::Value::Null,
        rmpv::Value::Boolean(b) => serde_json::Value::Bool(b),
        rmpv::Value::Integer(i) => {
            if let Some(u) = i.as_u64() {
                serde_json::json!(u)
            } else if let Some(s) = i.as_i64() {
                serde_json::json!(s)
            } else {
                serde_json::Value::Null
            }
        }
        rmpv::Value::F32(f) => serde_json::json!(f),
        rmpv::Value::F64(f) => serde_json::json!(f),
        rmpv::Value::String(s) => serde_json::Value::String(s.into_str().unwrap_or_default()),
        rmpv::Value::Binary(b) => {
            let array: Vec<serde_json::Value> =
                b.iter().map(|&byte| serde_json::json!(byte)).collect();
            serde_json::Value::Array(array)
        }
        rmpv::Value::Array(arr) => {
            let array: Vec<serde_json::Value> = arr.into_iter().map(rmpv_to_json).collect();
            serde_json::Value::Array(array)
        }
        rmpv::Value::Map(map) => {
            let mut obj = serde_json::Map::new();
            for (k, v) in map {
                if let rmpv::Value::String(key_str) = k {
                    obj.insert(key_str.into_str().unwrap_or_default(), rmpv_to_json(v));
                }
            }
            serde_json::Value::Object(obj)
        }
        rmpv::Value::Ext(_, _) => serde_json::Value::Null,
    }
}

fn normalize_transfer_result_binary(value: &mut rmpv::Value) {
    let rmpv::Value::Map(root) = value else {
        return;
    };
    let is_result = root
        .iter()
        .any(|(key, value)| key.as_str() == Some("type") && value.as_str() == Some("result"));
    if !is_result {
        return;
    }
    let Some((_, rmpv::Value::Map(result))) = root
        .iter_mut()
        .find(|(key, _)| key.as_str() == Some("result"))
    else {
        return;
    };
    let Some((_, data)) = result
        .iter_mut()
        .find(|(key, _)| key.as_str() == Some("data"))
    else {
        return;
    };
    if let rmpv::Value::Binary(bytes) = data {
        *data = rmpv::Value::String(general_purpose::STANDARD.encode(bytes).into());
    }
}

const CHUNK_SIZE: usize = 2000;
const OTA_LEGACY_PULL_SIZE: usize = 1800;
const OTA_MAX_PULL_WINDOW_SIZE: usize = 256 * 1024;
const OTA_TRANSFER_CALL_TIMEOUT: Duration = Duration::from_secs(120);
const OTA_TRANSFER_MAX_ATTEMPTS: usize = 3;
const OTA_PULL_BURST_CHUNKS: u64 = 16;
const OTA_PULL_BURST_DELAY: Duration = Duration::from_millis(40);
const MSGPACK_PROTOCOL: &str = "com.usenocturne.daemon";
const MAX_INBOUND_BUFFER: usize = OTA_MAX_PULL_WINDOW_SIZE * 2;
const MAX_REASSEMBLED_MESSAGE: usize = MAX_INBOUND_BUFFER;
const MAX_PENDING_MESSAGE_BYTES: usize = MAX_REASSEMBLED_MESSAGE;
const PENDING_MESSAGE_TTL: Duration = Duration::from_secs(120);
const MAX_PENDING_MESSAGES: usize = 8;

fn media_control_payload<T: serde::Serialize>(payload: T) -> serde_json::Value {
    let mut value =
        serde_json::to_value(payload).expect("generated media_control payload must serialize");
    if value
        .get("media_generation")
        .is_some_and(serde_json::Value::is_null)
    {
        value
            .as_object_mut()
            .expect("generated media_control payload must be an object")
            .remove("media_generation");
    }
    value
}

fn bt_only_payload<T: serde::Serialize>(payload: T) -> serde_json::Value {
    serde_json::to_value(payload).expect("generated bt_only payload must serialize")
}

pub fn create_daemon_ready_event() -> MsgPackMessage {
    MsgPackMessage::Event {
        topic: "daemon.ready".to_string(),
        data: bt_only_payload(DaemonReadyEvent),
    }
}

pub fn create_daemon_heartbeat_event(timestamp: u64) -> MsgPackMessage {
    MsgPackMessage::Event {
        topic: "daemon.heartbeat".to_string(),
        data: bt_only_payload(DaemonHeartbeatEvent { timestamp }),
    }
}

fn string_field(data: &serde_json::Value, snake: &str, camel: &str) -> Option<String> {
    data.get(snake)
        .or_else(|| data.get(camel))
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
}

fn bool_field(data: &serde_json::Value, snake: &str, camel: &str) -> Option<bool> {
    data.get(snake)
        .or_else(|| data.get(camel))
        .and_then(|value| value.as_bool())
}

fn u64_field(data: &serde_json::Value, snake: &str, camel: &str) -> Option<u64> {
    data.get(snake)
        .or_else(|| data.get(camel))
        .and_then(|value| value.as_u64())
}

fn i64_field(data: &serde_json::Value, snake: &str, camel: &str) -> Option<i64> {
    data.get(snake)
        .or_else(|| data.get(camel))
        .and_then(|value| value.as_i64())
}

fn normalize_app_ready_event(data: serde_json::Value) -> serde_json::Value {
    let event = AppReadyEvent {
        datetime: string_field(&data, "datetime", "datetime"),
        timezone: data.get("timezone").cloned(),
        platform: string_field(&data, "platform", "platform"),
        subscribed: bool_field(&data, "subscribed", "subscribed"),
        subscription_status: string_field(&data, "subscription_status", "subscriptionStatus"),
        has_lifetime: bool_field(&data, "has_lifetime", "hasLifetime"),
        is_admin: bool_field(&data, "is_admin", "isAdmin"),
        entitlements_verified: bool_field(&data, "entitlements_verified", "entitlementsVerified"),
        spotify_skipped: bool_field(&data, "spotify_skipped", "spotifySkipped"),
    };
    bt_only_payload(event)
}

fn normalize_entitlement_update_event(data: serde_json::Value) -> serde_json::Value {
    let event = SubscriptionUpdatedEvent {
        subscribed: bool_field(&data, "subscribed", "subscribed"),
        subscription_status: string_field(&data, "subscription_status", "subscriptionStatus"),
        has_lifetime: bool_field(&data, "has_lifetime", "hasLifetime"),
        is_admin: bool_field(&data, "is_admin", "isAdmin"),
        entitlements_verified: bool_field(&data, "entitlements_verified", "entitlementsVerified"),
    };
    bt_only_payload(event)
}

fn normalize_notification_show_event(data: serde_json::Value) -> serde_json::Value {
    let event = serde_json::from_value::<NotificationShowEvent>(data.clone()).unwrap_or(
        NotificationShowEvent {
            id: string_field(&data, "id", "id"),
            title: string_field(&data, "title", "title").unwrap_or_default(),
            body: string_field(&data, "body", "body"),
            subtitle: string_field(&data, "subtitle", "subtitle"),
            category: string_field(&data, "category", "category"),
            days_until_expiry: i64_field(&data, "days_until_expiry", "daysUntilExpiry"),
            timestamp: u64_field(&data, "timestamp", "timestamp"),
            app_bundle_id: string_field(&data, "app_bundle_id", "appBundleId"),
            app_name: string_field(&data, "app_name", "appName"),
            silent: bool_field(&data, "silent", "silent"),
            important: bool_field(&data, "important", "important"),
            pre_existing: bool_field(&data, "pre_existing", "preExisting"),
        },
    );
    bt_only_payload(event)
}

fn normalize_bt_only_event(topic: String, data: serde_json::Value) -> (String, serde_json::Value) {
    let normalized = match topic.as_str() {
        "app.ready" => normalize_app_ready_event(data),
        "subscription.updated" => normalize_entitlement_update_event(data),
        "network.status" => serde_json::from_value::<NetworkStatusEvent>(data.clone())
            .map(bt_only_payload)
            .unwrap_or(data),
        "notification.show" => normalize_notification_show_event(data),
        "chunk.retransmit_request" => {
            serde_json::from_value::<ChunkRetransmitRequestEvent>(data.clone())
                .map(bt_only_payload)
                .unwrap_or(data)
        }
        "audio.recording.started" => {
            serde_json::from_value::<AudioRecordingStartedEvent>(data.clone())
                .map(bt_only_payload)
                .unwrap_or(data)
        }
        "audio.data" => serde_json::from_value::<AudioDataEvent>(data.clone())
            .map(bt_only_payload)
            .unwrap_or(data),
        "audio.recording.stopped" => {
            serde_json::from_value::<AudioRecordingStoppedEvent>(data.clone())
                .map(bt_only_payload)
                .unwrap_or(data)
        }
        _ => data,
    };
    (topic, normalized)
}

fn attach_phone_source(
    topic: &str,
    mut data: serde_json::Value,
    connection_peer: Option<Address>,
) -> serde_json::Value {
    if matches!(
        topic,
        "phone.call.started" | "phone.call.updated" | "phone.call.ended"
    ) {
        if let (Some(peer), Some(payload)) = (connection_peer, data.as_object_mut()) {
            payload.insert(
                "device".to_string(),
                serde_json::Value::String(peer.to_string()),
            );
        }
    }
    data
}

fn voice_payload<T: serde::Serialize>(payload: T) -> JsonValue {
    serde_json::to_value(payload).expect("generated voice payload must serialize")
}

fn merge_voice_metadata(canonical: JsonValue, original: JsonValue) -> JsonValue {
    match (canonical, original) {
        (JsonValue::Object(mut canonical), JsonValue::Object(original)) => {
            for (key, value) in original {
                canonical.entry(key).or_insert(value);
            }
            JsonValue::Object(canonical)
        }
        (canonical, _) => canonical,
    }
}

fn normalize_voice_event(topic: String, data: JsonValue) -> (String, JsonValue) {
    match topic.as_str() {
        "voice.transcription" => {
            let event = VoiceTranscriptionEvent {
                transcript: data
                    .get("transcript")
                    .or_else(|| data.get("text"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                is_final: data
                    .get("is_final")
                    .or_else(|| data.get("isFinal"))
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                session_id: data
                    .get("session_id")
                    .or_else(|| data.get("sessionId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            };
            (topic, merge_voice_metadata(voice_payload(event), data))
        }
        "ai.state" => {
            let event = AiStateEvent {
                state: data
                    .get("state")
                    .and_then(|value| value.as_str())
                    .unwrap_or("idle")
                    .to_string(),
                message: data
                    .get("message")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                session_id: data
                    .get("session_id")
                    .or_else(|| data.get("sessionId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            };
            (topic, merge_voice_metadata(voice_payload(event), data))
        }
        "ai.response" => {
            let event = AiResponseEvent {
                message: data
                    .get("message")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                text: data
                    .get("text")
                    .or_else(|| data.get("response"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                is_final: data
                    .get("is_final")
                    .or_else(|| data.get("isFinal"))
                    .and_then(|value| value.as_bool()),
                session_id: data
                    .get("session_id")
                    .or_else(|| data.get("sessionId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            };
            (topic, merge_voice_metadata(voice_payload(event), data))
        }
        "ai.tool_executed" => {
            let event = AiToolExecutedEvent {
                tool_name: data
                    .get("tool_name")
                    .or_else(|| data.get("toolName"))
                    .or_else(|| data.get("tool"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                tool: data
                    .get("tool")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                call_id: data
                    .get("call_id")
                    .or_else(|| data.get("callId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                status: data
                    .get("status")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                tool_arguments: data
                    .get("tool_arguments")
                    .or_else(|| data.get("toolArguments"))
                    .cloned(),
                result: data.get("result").cloned(),
                error: data
                    .get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                session_id: data
                    .get("session_id")
                    .or_else(|| data.get("sessionId"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
            };
            (topic, merge_voice_metadata(voice_payload(event), data))
        }
        _ => (topic, data),
    }
}

fn media_control_response_payload(method: &str) -> Option<serde_json::Value> {
    let status = "ok".to_string();
    match method {
        "media.control.play" => Some(media_control_payload(MediaControlPlayResponse { status })),
        "media.control.pause" => Some(media_control_payload(MediaControlPauseResponse { status })),
        "media.control.next" => Some(media_control_payload(MediaControlNextResponse { status })),
        "media.control.previous" | "media.control.prev" => {
            Some(media_control_payload(MediaControlPreviousResponse {
                status,
            }))
        }
        "media.control.shuffle" => Some(media_control_payload(MediaControlShuffleResponse {
            status,
        })),
        "media.control.repeat" => {
            Some(media_control_payload(MediaControlRepeatResponse { status }))
        }
        "media.control.volumeUp" | "media.control.volume_up" => {
            Some(media_control_payload(MediaControlVolumeUpResponse {
                status,
            }))
        }
        "media.control.volumeDown" | "media.control.volume_down" => {
            Some(media_control_payload(MediaControlVolumeDownResponse {
                status,
            }))
        }
        _ => None,
    }
}

fn phone_volume_update_event(volume_percent: u8) -> PhoneVolumeUpdateEvent {
    PhoneVolumeUpdateEvent { volume_percent }
}

fn media_generation(data: &serde_json::Value) -> Option<u64> {
    data.get("media_generation")
        .or_else(|| data.get("mediaGeneration"))
        .and_then(serde_json::Value::as_u64)
}

fn normalize_media_control_event(
    topic: String,
    data: serde_json::Value,
) -> (String, serde_json::Value) {
    match topic.as_str() {
        "media.nowPlaying.update" | "media.now_playing.update" => {
            let event = MediaNowPlayingUpdateEvent {
                media_item_attributes: data
                    .get("media_item_attributes")
                    .or_else(|| data.get("mediaItemAttributes"))
                    .or_else(|| data.get("MediaItemAttributes"))
                    .cloned(),
                playback_attributes: data
                    .get("playback_attributes")
                    .or_else(|| data.get("playbackAttributes"))
                    .or_else(|| data.get("PlaybackAttributes"))
                    .cloned(),
                media_generation: media_generation(&data),
            };
            (
                "media.now_playing.update".to_string(),
                media_control_payload(event),
            )
        }
        "media.nowPlaying.artwork" | "media.now_playing.artwork" => {
            let event = MediaNowPlayingArtworkEvent {
                data: data
                    .get("data")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                content_type: data
                    .get("content_type")
                    .or_else(|| data.get("contentType"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("image/jpeg")
                    .to_string(),
                media_generation: media_generation(&data),
            };
            (
                "media.now_playing.artwork".to_string(),
                media_control_payload(event),
            )
        }
        "media.nowPlaying.artwork.failed" | "media.now_playing.artwork.failed" => {
            let event = serde_json::from_value::<MediaNowPlayingArtworkFailedEvent>(data.clone())
                .unwrap_or_else(|_| MediaNowPlayingArtworkFailedEvent {
                    transfer_id: data
                        .get("transferId")
                        .or_else(|| data.get("transfer_id"))
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                        .min(u32::MAX as u64) as u32,
                });
            (
                "media.now_playing.artwork.failed".to_string(),
                media_control_payload(event),
            )
        }
        "phone.volume.update" => {
            let event = serde_json::from_value::<PhoneVolumeUpdateEvent>(data.clone())
                .unwrap_or_else(|_| {
                    phone_volume_update_event(
                        data.get("volumePercent")
                            .or_else(|| data.get("volume_percent"))
                            .and_then(|value| value.as_u64())
                            .unwrap_or(0)
                            .min(100) as u8,
                    )
                });
            (topic, media_control_payload(event))
        }
        _ => (topic, data),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
pub enum MsgPackMessage {
    #[serde(rename = "call")]
    Call {
        id: String,
        method: String,
        params: serde_json::Value,
    },
    #[serde(rename = "result")]
    Result {
        id: String,
        result: serde_json::Value,
    },
    #[serde(rename = "error")]
    Error { id: String, error: String },
    #[serde(rename = "event")]
    Event {
        topic: String,
        data: serde_json::Value,
    },
}

pub fn create_audio_data_event(seq: u64, opus_data: &[u8], timestamp_ms: u64) -> MsgPackMessage {
    let payload = AudioDataEvent {
        seq,
        opus: general_purpose::STANDARD.encode(opus_data),
        ts: timestamp_ms,
    };

    MsgPackMessage::Event {
        topic: "audio.data".to_string(),
        data: audio_payload(payload),
    }
}

pub fn create_audio_recording_started_event(payload: AudioRecordingStartedEvent) -> MsgPackMessage {
    MsgPackMessage::Event {
        topic: "audio.recording.started".to_string(),
        data: audio_payload(payload),
    }
}

pub fn create_audio_recording_stopped_event(payload: AudioRecordingStoppedEvent) -> MsgPackMessage {
    MsgPackMessage::Event {
        topic: "audio.recording.stopped".to_string(),
        data: audio_payload(payload),
    }
}

fn parse_ota_package_ready(params: &serde_json::Value) -> Result<OtaPackageReady> {
    if let Some(state) = params.get("state").and_then(|value| value.as_str()) {
        if state != "download_success" {
            return Err(crate::error::NocturnedError::Config(format!(
                "ota package not ready: state={state}"
            )));
        }
    }

    let update_id = string_field(params, "update_id", "updateId")
        .ok_or_else(|| crate::error::NocturnedError::Config("Missing update_id".into()))?;
    let version = string_field(params, "version", "version")
        .ok_or_else(|| crate::error::NocturnedError::Config("Missing version".into()))?;
    crate::ota::validate_target_version(&version).map_err(crate::error::NocturnedError::Config)?;
    let size = u64_field(params, "size", "size")
        .or_else(|| u64_field(params, "expected_size", "expectedSize"))
        .ok_or_else(|| crate::error::NocturnedError::Config("Missing size".into()))?;
    let expected_sha256 = string_field(params, "expected_sha256", "expectedSha256")
        .or_else(|| string_field(params, "sha256", "sha256"))
        .or_else(|| string_field(params, "hash", "hash"))
        .unwrap_or_default();
    let resume_from_offset = u64_field(params, "resume_from_offset", "resumeFromOffset")
        .unwrap_or(0)
        .min(u32::MAX as u64) as u32;
    let max_transfer_chunk_size =
        u64_field(params, "max_transfer_chunk_size", "maxTransferChunkSize")
            .map(u32::try_from)
            .transpose()
            .map_err(|_| {
                crate::error::NocturnedError::Config("OTA transfer chunk size is too large".into())
            })?;
    let supports_chunked_transfer_response = bool_field(
        params,
        "supports_chunked_transfer_response",
        "supportsChunkedTransferResponse",
    );
    let transfer_data_encoding =
        string_field(params, "transfer_data_encoding", "transferDataEncoding");

    let size = u32::try_from(size).map_err(|_| {
        crate::error::NocturnedError::Config(format!("OTA package too large: {size}"))
    })?;

    Ok(OtaPackageReady {
        update_id,
        version,
        size,
        expected_sha256,
        resume_from_offset,
        max_transfer_chunk_size,
        supports_chunked_transfer_response,
        transfer_data_encoding,
    })
}

fn advertised_ota_pull_window(ready: &OtaPackageReady) -> u32 {
    if ready.supports_chunked_transfer_response != Some(true)
        || ready.transfer_data_encoding.as_deref() != Some("msgpack_binary")
    {
        return OTA_LEGACY_PULL_SIZE as u32;
    }
    ready
        .max_transfer_chunk_size
        .filter(|size| *size > 0)
        .unwrap_or(OTA_LEGACY_PULL_SIZE as u32)
        .min(OTA_MAX_PULL_WINDOW_SIZE as u32)
}

async fn call_method_static(
    session_route: &SharedAppSessionRoute,
    pending_calls: &Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    method: &str,
    params: serde_json::Value,
    priority: AppMessagePriority,
) -> Result<serde_json::Value> {
    let message_id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = tokio::sync::oneshot::channel();

    {
        let mut calls = pending_calls.lock().await;
        calls.insert(message_id.clone(), tx);
    }

    let message = MsgPackMessage::Call {
        id: message_id.clone(),
        method: method.to_string(),
        params,
    };
    let serialized = rmp_serde::to_vec_named(&message).map_err(|err| {
        crate::error::NocturnedError::Config(format!("Failed to serialize message: {err}"))
    })?;
    let chunks = MsgPackProtocolHandler::create_chunks(&serialized)?;
    let route = {
        let route = session_route.lock().await;
        route.clone()
    };

    if let Some(route) = route {
        for chunk in chunks {
            let app_message = crate::app::AppMessage {
                id: message_id.clone(),
                protocol: MSGPACK_PROTOCOL.to_string(),
                session_id: route.session_id,
                priority,
                data: chunk,
            };
            if let Err(err) = route.tx.send(app_message) {
                let mut calls = pending_calls.lock().await;
                calls.remove(&message_id);
                return Err(crate::error::NocturnedError::Config(format!(
                    "Failed to send app RPC {method}: {err}"
                )));
            }
        }
    } else {
        let mut calls = pending_calls.lock().await;
        calls.remove(&message_id);
        return Err(crate::error::NocturnedError::Config(
            "No active app session for OTA transfer".into(),
        ));
    }

    match tokio::time::timeout(OTA_TRANSFER_CALL_TIMEOUT, rx).await {
        Ok(Ok(result)) => {
            if let Some(error) = result.get("__error").and_then(|value| value.as_str()) {
                return Err(crate::error::NocturnedError::Config(format!(
                    "App RPC {method} failed: {error}"
                )));
            }
            Ok(result)
        }
        Ok(Err(_)) => Err(crate::error::NocturnedError::Config(format!(
            "App RPC {method} response channel closed"
        ))),
        Err(_) => {
            let mut calls = pending_calls.lock().await;
            calls.remove(&message_id);
            Err(crate::error::NocturnedError::Config(format!(
                "App RPC {method} timed out"
            )))
        }
    }
}

fn transfer_result_bytes(result: &serde_json::Value) -> Result<Vec<u8>> {
    let data = result
        .get("data")
        .ok_or_else(|| crate::error::NocturnedError::Config("Missing transfer data".into()))?;

    if let Some(bytes_str) = data.as_str() {
        return general_purpose::STANDARD.decode(bytes_str).map_err(|err| {
            crate::error::NocturnedError::Config(format!(
                "Failed to decode base64 transfer chunk: {err}"
            ))
        });
    }

    if let Some(bytes_array) = data.as_array() {
        let mut bytes = Vec::with_capacity(bytes_array.len());
        for value in bytes_array {
            let byte = value.as_u64().ok_or_else(|| {
                crate::error::NocturnedError::Config("Invalid transfer byte value".into())
            })?;
            let byte = u8::try_from(byte).map_err(|_| {
                crate::error::NocturnedError::Config("Transfer byte out of range".into())
            })?;
            bytes.push(byte);
        }
        return Ok(bytes);
    }

    Err(crate::error::NocturnedError::Config(
        "Transfer data must be base64 string or byte array".into(),
    ))
}

async fn request_transfer_chunk(
    session_route: &SharedAppSessionRoute,
    pending_calls: &Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    update_id: &str,
    offset: u64,
    size: usize,
    params: serde_json::Value,
) -> Result<Vec<u8>> {
    let mut last_error = None;

    for attempt in 1..=OTA_TRANSFER_MAX_ATTEMPTS {
        match call_method_static(
            session_route,
            pending_calls,
            "device.ota.transfer",
            params.clone(),
            AppMessagePriority::Bulk,
        )
        .await
        {
            Ok(result) => {
                let bytes = transfer_result_bytes(&result)?;
                if bytes.len() != size {
                    return Err(crate::error::NocturnedError::Config(format!(
                        "OTA transfer chunk size mismatch at offset {offset}: expected {size}, got {}",
                        bytes.len()
                    )));
                }
                return Ok(bytes);
            }
            Err(err) => {
                let message = err.to_string();
                if attempt == OTA_TRANSFER_MAX_ATTEMPTS {
                    return Err(err);
                }
                warn!(
                    update_id,
                    offset,
                    size,
                    attempt,
                    max_attempts = OTA_TRANSFER_MAX_ATTEMPTS,
                    error = %message,
                    "OTA transfer chunk request failed; retrying"
                );
                last_error = Some(message);
                tokio::time::sleep(Duration::from_millis(250 * attempt as u64)).await;
            }
        }
    }

    Err(crate::error::NocturnedError::Config(format!(
        "OTA transfer chunk request failed at offset {offset}: {}",
        last_error.unwrap_or_else(|| "unknown error".to_string())
    )))
}

async fn pull_ota_chunks_task(
    session_route: SharedAppSessionRoute,
    pending_calls: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    cmd_tx: mpsc::Sender<crate::ota::Command>,
    source: crate::ota::OtaSource,
    ready: OtaPackageReady,
    transfer_window_size: u32,
) -> Result<()> {
    let update_id = ready.update_id.clone();
    let result = pull_ota_chunks_inner(
        session_route,
        pending_calls,
        cmd_tx.clone(),
        source.clone(),
        ready,
        transfer_window_size,
    )
    .await;

    if let Err(err) = &result {
        let _ = cmd_tx
            .send(crate::ota::Command::TransferPaused {
                update_id,
                source,
                message: err.to_string(),
            })
            .await;
    }

    result
}

async fn abort_ota_pull_task(
    task: &Arc<Mutex<Option<JoinHandle<()>>>>,
    pending_calls: &Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    reason: &'static str,
) {
    let prior = {
        let mut task = task.lock().await;
        task.take()
    };
    if let Some(prior) = prior {
        prior.abort();
        let pending_count = {
            let mut calls = pending_calls.lock().await;
            let count = calls.len();
            calls.clear();
            count
        };
        warn!(reason, pending_count, "aborting active OTA pull task");
    } else {
        let pending_count = {
            let mut calls = pending_calls.lock().await;
            let count = calls.len();
            calls.clear();
            count
        };
        if pending_count > 0 {
            warn!(
                reason,
                pending_count, "cleared stale OTA pull response waiters"
            );
        }
    }
}

async fn pull_ota_chunks_inner(
    session_route: SharedAppSessionRoute,
    pending_calls: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    cmd_tx: mpsc::Sender<crate::ota::Command>,
    source: crate::ota::OtaSource,
    ready: OtaPackageReady,
    transfer_window_size: u32,
) -> Result<()> {
    let transfer_window_size = usize::try_from(transfer_window_size)
        .unwrap_or(OTA_LEGACY_PULL_SIZE)
        .clamp(1, OTA_MAX_PULL_WINDOW_SIZE);
    let total_size = ready.size as u64;
    let mut offset = u64::from(ready.resume_from_offset).min(total_size);
    let initial_offset = offset;
    let transfer_started_at = Instant::now();
    let total_windows = total_size.div_ceil(transfer_window_size as u64).max(1);

    info!(
        update_id = %ready.update_id,
        version = %ready.version,
        total_size,
        resume_from_offset = offset,
        transfer_window_size,
        total_windows,
        "starting pull-based OTA transfer"
    );

    if offset == total_size {
        let (ack, rx) = oneshot::channel();
        cmd_tx
            .send(crate::ota::Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: ready.update_id,
                    offset: offset as u32,
                    bytes: Vec::new(),
                    last: true,
                },
                source: source.clone(),
                ack,
            })
            .await
            .map_err(|err| {
                crate::error::NocturnedError::Config(format!(
                    "ota actor mailbox closed during final resume chunk: {err}"
                ))
            })?;
        rx.await
            .map_err(|err| {
                crate::error::NocturnedError::Config(format!(
                    "ota actor dropped final resume chunk ack: {err}"
                ))
            })?
            .map_err(crate::error::NocturnedError::Config)?;
        return Ok(());
    }

    while offset < total_size {
        let size = (total_size - offset).min(transfer_window_size as u64) as usize;
        let params = serde_json::json!({
            "updateId": ready.update_id.clone(),
            "update_id": ready.update_id.clone(),
            "name": "nocturne-os",
            "offset": offset,
            "size": size,
            "version": ready.version.clone(),
        });
        let bytes = request_transfer_chunk(
            &session_route,
            &pending_calls,
            &ready.update_id,
            offset,
            size,
            params,
        )
        .await?;

        let next_offset = offset + bytes.len() as u64;
        let last = next_offset >= total_size;
        let payload_received_at = last.then(Instant::now);
        let (ack, rx) = oneshot::channel();
        cmd_tx
            .send(crate::ota::Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: ready.update_id.clone(),
                    offset: offset as u32,
                    bytes,
                    last,
                },
                source: source.clone(),
                ack,
            })
            .await
            .map_err(|err| {
                crate::error::NocturnedError::Config(format!(
                    "ota actor mailbox closed during pulled chunk: {err}"
                ))
            })?;
        rx.await
            .map_err(|err| {
                crate::error::NocturnedError::Config(format!(
                    "ota actor dropped pulled chunk ack: {err}"
                ))
            })?
            .map_err(crate::error::NocturnedError::Config)?;

        if let Some(payload_received_at) = payload_received_at {
            let transfer_elapsed = payload_received_at.duration_since(transfer_started_at);
            let transferred_bytes = next_offset.saturating_sub(initial_offset);
            let effective_mbps = transferred_bytes as f64 * 8.0
                / transfer_elapsed.as_secs_f64().max(f64::EPSILON)
                / 1_000_000.0;
            info!(
                update_id = %ready.update_id,
                transferred_bytes,
                transfer_window_size,
                transfer_elapsed_ms = transfer_elapsed.as_secs_f64() * 1_000.0,
                finalize_elapsed_ms = payload_received_at.elapsed().as_secs_f64() * 1_000.0,
                effective_mbps,
                "completed pull-based OTA payload transfer"
            );
        }

        offset = next_offset;
        if !last {
            let completed_windows = next_offset.div_ceil(transfer_window_size as u64);
            if completed_windows.is_multiple_of(OTA_PULL_BURST_CHUNKS) {
                tokio::time::sleep(OTA_PULL_BURST_DELAY).await;
            } else {
                tokio::task::yield_now().await;
            }
        }
    }

    Ok(())
}

fn audio_payload<T: serde::Serialize>(payload: T) -> serde_json::value::Value {
    bt_only_payload(payload)
}

#[allow(dead_code)]
#[derive(Debug)]
struct ChunkedMessage {
    message_id: String,
    total_chunks: u16,
    received_chunks: HashMap<u16, Bytes>,
    complete_size: usize,
    expected_checksum: Option<u32>,
    updated_at: Instant,
}

enum ChunkEnvelopeParse {
    Complete {
        message_id: String,
        index: u16,
        total: u16,
        checksum: u32,
        payload: Bytes,
        consumed: usize,
    },
    NeedMore,
    Invalid,
}

/// Binary layout:
///   [1 byte: id_len][id_len bytes: message_id][2 bytes: index BE][2 bytes: total BE]
///   [4 bytes: checksum BE][2 bytes: payload_len BE][payload]
fn parse_one_chunk_envelope(data: &[u8]) -> ChunkEnvelopeParse {
    if data.is_empty() {
        return ChunkEnvelopeParse::NeedMore;
    }

    let id_len = data[0] as usize;
    if id_len != 36 {
        return ChunkEnvelopeParse::Invalid;
    }

    let header_len = 1 + id_len + 2 + 2 + 4 + 2;
    if data.len() < header_len {
        return ChunkEnvelopeParse::NeedMore;
    }

    let message_id = match std::str::from_utf8(&data[1..1 + id_len]) {
        Ok(s) => s,
        Err(_) => return ChunkEnvelopeParse::Invalid,
    };

    let chars: Vec<char> = message_id.chars().collect();
    let hyphen_positions = [8, 13, 18, 23];
    if !hyphen_positions
        .iter()
        .all(|&pos| chars.get(pos) == Some(&'-'))
    {
        return ChunkEnvelopeParse::Invalid;
    }

    let offset = 1 + id_len;
    let index = u16::from_be_bytes([data[offset], data[offset + 1]]);
    let total = u16::from_be_bytes([data[offset + 2], data[offset + 3]]);
    let checksum = u32::from_be_bytes([
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ]);
    let payload_len = u16::from_be_bytes([data[offset + 8], data[offset + 9]]) as usize;

    if total == 0 || index >= total || total > 1000 {
        return ChunkEnvelopeParse::Invalid;
    }

    let total_needed = header_len + payload_len;
    if data.len() < total_needed {
        return ChunkEnvelopeParse::NeedMore;
    }

    let payload = Bytes::copy_from_slice(&data[header_len..total_needed]);

    ChunkEnvelopeParse::Complete {
        message_id: message_id.to_string(),
        index,
        total,
        checksum,
        payload,
        consumed: total_needed,
    }
}

pub struct MsgPackProtocolHandler {
    pending_messages: HashMap<String, ChunkedMessage>,
    inbound_buffers: HashMap<u8, BytesMut>,
    call_handlers: HashMap<String, CallHandler>,
    websocket_server: Option<Arc<WebSocketServer>>,
    websocket_message_ids: HashSet<String>,
    image_cache: Option<Arc<Mutex<ImageCache>>>,
    pending_image_requests: HashMap<String, String>,
    pending_methods: HashMap<String, String>,
    pending_calls: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    session_route: SharedAppSessionRoute,
    ota_pull_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    app_ready_received: Arc<AtomicBool>,
    hid_tx: Option<tokio::sync::mpsc::UnboundedSender<iap2_rs::HidCommand>>,
    ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    connection_peer: Option<Address>,
    connection_route: Option<String>,
}

impl MsgPackProtocolHandler {
    pub fn new(websocket_server: Option<Arc<WebSocketServer>>) -> Self {
        let mut handler = Self {
            pending_messages: HashMap::new(),
            inbound_buffers: HashMap::new(),
            call_handlers: HashMap::new(),
            websocket_server,
            websocket_message_ids: HashSet::new(),
            image_cache: None,
            pending_image_requests: HashMap::new(),
            pending_methods: HashMap::new(),
            pending_calls: Arc::new(Mutex::new(HashMap::new())),
            session_route: Arc::new(Mutex::new(None)),
            ota_pull_task: Arc::new(Mutex::new(None)),
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
            ota_cmd_tx: None,
            connection_peer: None,
            connection_route: None,
        };

        handler.register_default_handlers();
        handler
    }

    pub fn with_image_cache(
        websocket_server: Option<Arc<WebSocketServer>>,
        image_cache: Arc<Mutex<ImageCache>>,
    ) -> Self {
        let mut handler = Self {
            pending_messages: HashMap::new(),
            inbound_buffers: HashMap::new(),
            call_handlers: HashMap::new(),
            websocket_server,
            websocket_message_ids: HashSet::new(),
            image_cache: Some(image_cache),
            pending_image_requests: HashMap::new(),
            pending_methods: HashMap::new(),
            pending_calls: Arc::new(Mutex::new(HashMap::new())),
            session_route: Arc::new(Mutex::new(None)),
            ota_pull_task: Arc::new(Mutex::new(None)),
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
            ota_cmd_tx: None,
            connection_peer: None,
            connection_route: None,
        };

        handler.register_default_handlers();
        handler
    }

    pub fn app_ready_flag(&self) -> Arc<AtomicBool> {
        self.app_ready_received.clone()
    }

    pub async fn set_session_info(
        &mut self,
        session_tx: mpsc::UnboundedSender<AppMessage>,
        session_id: u8,
    ) {
        let mut route = self.session_route.lock().await;
        *route = Some(AppSessionRoute {
            tx: session_tx,
            session_id,
        });
    }

    pub fn set_hid_tx(&mut self, sender: tokio::sync::mpsc::UnboundedSender<iap2_rs::HidCommand>) {
        self.hid_tx = Some(sender);
    }

    pub fn set_ota_cmd_tx(&mut self, sender: mpsc::Sender<crate::ota::Command>) {
        self.ota_cmd_tx = Some(sender);
    }

    pub fn set_connection_peer(&mut self, peer: Address) {
        self.connection_peer = Some(peer);
    }

    pub fn set_connection_route(&mut self, route: String) {
        self.connection_route = Some(route);
    }

    fn ota_source(&self) -> crate::ota::OtaSource {
        crate::ota::OtaSource::new(self.connection_peer, self.connection_route.clone())
    }

    fn register_default_handlers(&mut self) {
        self.register_call_handler(
            "ping".to_string(),
            Box::new(|_params: &serde_json::Value| {
                serde_json::json!({
                    "pong": "hello from nocturne"
                })
            }),
        );

        self.register_call_handler(
            "device.info".to_string(),
            Box::new(|_: &serde_json::Value| {
                serde_json::to_value(crate::system::config::collect_device_info_metadata())
                    .unwrap_or_else(|_| {
                        serde_json::json!({
                            "device": "Nocturne",
                            "version": "unknown"
                        })
                    })
            }),
        );
    }

    pub fn register_call_handler<F>(&mut self, method: String, handler: F)
    where
        F: Fn(&serde_json::Value) -> serde_json::Value + Send + Sync + 'static,
    {
        info!("Registered msgpack call handler: {}", method);
        self.call_handlers.insert(method, Box::new(handler));
    }

    async fn try_route_ota_call(
        &self,
        id: &str,
        method: &str,
        params: &serde_json::Value,
    ) -> Result<Option<MsgPackMessage>> {
        let Some(cmd_tx) = &self.ota_cmd_tx else {
            return Ok(None);
        };

        match method {
            "ota.begin" | "system.ota.begin" => {
                let req: OtaBegin = serde_json::from_value(params.clone()).map_err(|err| {
                    crate::error::NocturnedError::Config(format!("invalid OtaBegin payload: {err}"))
                })?;
                abort_ota_pull_task(&self.ota_pull_task, &self.pending_calls, "ota.begin").await;
                let (ack, rx) = oneshot::channel();
                cmd_tx
                    .send(crate::ota::Command::Begin {
                        req,
                        source: self.ota_source(),
                        ack,
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
                let result = rx.await.map_err(|err| {
                    crate::error::NocturnedError::Config(format!("ota begin reply dropped: {err}"))
                })?;
                return Ok(Some(match result {
                    Ok(ack) => MsgPackMessage::Result {
                        id: id.to_string(),
                        result: serde_json::to_value(ack).unwrap_or_else(|_| serde_json::json!({})),
                    },
                    Err(rejected) => MsgPackMessage::Error {
                        id: id.to_string(),
                        error: rejected.reason,
                    },
                }));
            }
            "ota.chunk" | "system.ota.chunk" => {
                let chunk: OtaChunk = serde_json::from_value(params.clone()).map_err(|err| {
                    crate::error::NocturnedError::Config(format!("invalid OtaChunk payload: {err}"))
                })?;
                // Non-blocking enqueue: `send().await` on a full mailbox would
                // park this whole iAP2 select! task (read + downlink + heartbeat
                // share it), stalling acks/heartbeats and tearing down the EA
                // session under a fast .swu push. On a full mailbox, ack "busy"
                // and let the phone re-send this same chunk — write_chunk enforces
                // offset continuity, so dropping the enqueue is safe.
                use tokio::sync::mpsc::error::TrySendError;
                match cmd_tx.try_send(crate::ota::Command::Chunk {
                    chunk,
                    source: self.ota_source(),
                }) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        return Ok(Some(MsgPackMessage::Result {
                            id: id.to_string(),
                            result: serde_json::json!({ "status": "busy" }),
                        }));
                    }
                    Err(TrySendError::Closed(_)) => {
                        return Err(crate::error::NocturnedError::Config(
                            "ota actor mailbox closed".into(),
                        ));
                    }
                }
            }
            "ota.asset_range_chunk" | "system.ota.asset_range_chunk" => {
                let chunk: OtaAssetRangeChunk =
                    serde_json::from_value(params.clone()).map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAssetRangeChunk payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::AssetRangeChunk {
                        chunk,
                        source: self.ota_source(),
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.asset_range_reply" | "system.ota.asset_range_reply" => {
                let reply: OtaAssetRangeReply =
                    serde_json::from_value(params.clone()).map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAssetRangeReply payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::AssetRangeReply {
                        reply,
                        source: self.ota_source(),
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.asset_range_rejected" | "system.ota.asset_range_rejected" => {
                let rejected: OtaAssetRangeRejected = serde_json::from_value(params.clone())
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAssetRangeRejected payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::AssetRangeRejected {
                        rejected,
                        source: self.ota_source(),
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.abandon" | "system.ota.abandon" => {
                abort_ota_pull_task(&self.ota_pull_task, &self.pending_calls, "ota.abandon").await;
                let abandon: OtaAbandon =
                    serde_json::from_value(params.clone()).map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAbandon payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::Abandon {
                        update_id: abandon.update_id,
                        source: self.ota_source(),
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.download_progress" | "system.ota.download_progress" => {
                let progress: OtaDownloadProgress = serde_json::from_value(params.clone())
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaDownloadProgress payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::DownloadProgress {
                        update_id: progress.update_id,
                        percent: progress.percent,
                        source: self.ota_source(),
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.package_ready" | "system.ota.package_ready" | "device.ota.package_state" => {
                let mut ready = parse_ota_package_ready(params)?;
                let advertised_transfer_window_size = advertised_ota_pull_window(&ready);
                let source = self.ota_source();
                let (ack, rx) = oneshot::channel();
                cmd_tx
                    .send(crate::ota::Command::AuthorizePull {
                        ready: ready.clone(),
                        transfer_window_size: advertised_transfer_window_size,
                        source: source.clone(),
                        ack,
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
                let authorization = match rx.await.map_err(|err| {
                    crate::error::NocturnedError::Config(format!(
                        "ota pull authorization reply dropped: {err}"
                    ))
                })? {
                    Ok(authorization) => authorization,
                    Err(error) => {
                        return Ok(Some(MsgPackMessage::Error {
                            id: id.to_string(),
                            error,
                        }));
                    }
                };
                ready.resume_from_offset = authorization.resume_from_offset;
                let transfer_window_size = authorization.transfer_window_size;
                abort_ota_pull_task(
                    &self.ota_pull_task,
                    &self.pending_calls,
                    "ota.package_ready",
                )
                .await;
                let session_route = Arc::clone(&self.session_route);
                let pending_calls = Arc::clone(&self.pending_calls);
                let cmd_tx = cmd_tx.clone();
                let task_slot = Arc::clone(&self.ota_pull_task);

                let task = tokio::spawn(async move {
                    if let Err(err) = pull_ota_chunks_task(
                        session_route,
                        pending_calls,
                        cmd_tx.clone(),
                        source,
                        ready,
                        transfer_window_size,
                    )
                    .await
                    {
                        error!("OTA pull transfer failed: {}", err);
                    }
                });
                let mut slot = task_slot.lock().await;
                *slot = Some(task);
            }
            "ota.cancel" | "system.ota.cancel" => {
                abort_ota_pull_task(&self.ota_pull_task, &self.pending_calls, "ota.cancel").await;
                let (ack, rx) = oneshot::channel();
                cmd_tx
                    .send(crate::ota::Command::Cancel {
                        source: self.ota_source(),
                        ack,
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
                if let Err(error) = rx.await.map_err(|err| {
                    crate::error::NocturnedError::Config(format!("ota cancel reply dropped: {err}"))
                })? {
                    return Ok(Some(MsgPackMessage::Error {
                        id: id.to_string(),
                        error,
                    }));
                }
            }
            _ => return Ok(None),
        }

        Ok(Some(MsgPackMessage::Result {
            id: id.to_string(),
            result: serde_json::json!({ "status": "queued" }),
        }))
    }

    pub fn mark_as_websocket_message(&mut self, message_id: String) {
        debug!("Marking message ID as from WebSocket: {}", message_id);
        self.websocket_message_ids.insert(message_id);
    }

    pub fn mark_method_for_message(&mut self, message_id: String, method: String) {
        debug!("Marking method {} for message ID: {}", method, message_id);
        self.pending_methods.insert(message_id, method);
    }

    pub fn mark_as_image_request(&mut self, message_id: String, url: String) {
        debug!(
            "Marking message ID as image request: {} for URL: {}",
            message_id, url
        );
        self.pending_image_requests.insert(message_id, url);
    }

    /// Create binary chunk envelopes for transmission (iOS-compatible format)
    /// Format: [1 byte: id_len][id_len bytes: message_id][2 bytes: index BE][2 bytes: total BE][4 bytes: checksum BE][2 bytes: payload_len BE][payload]
    pub fn create_chunks(data: &[u8]) -> Result<Vec<Bytes>> {
        let total_chunks = data.len().div_ceil(CHUNK_SIZE).max(1);
        let message_id = uuid::Uuid::new_v4().to_string().to_ascii_uppercase();
        let mut chunks = Vec::new();

        for (chunk_idx, chunk_data) in data.chunks(CHUNK_SIZE.max(1)).enumerate() {
            let chunk_checksum = crc32fast::hash(chunk_data);

            let id_bytes = message_id.as_bytes();
            let header_len = 1 + id_bytes.len() + 2 + 2 + 4 + 2;
            let mut buffer = BytesMut::with_capacity(header_len + chunk_data.len());

            buffer.put_u8(id_bytes.len() as u8);
            buffer.put_slice(id_bytes);
            buffer.put_u16(chunk_idx as u16); // big-endian by default
            buffer.put_u16(total_chunks as u16);
            buffer.put_u32(chunk_checksum);
            buffer.put_u16(chunk_data.len() as u16);
            buffer.put_slice(chunk_data);

            chunks.push(buffer.freeze());

            debug!(
                "Created chunk {}/{} for message {} ({} bytes payload, {} bytes total, checksum: 0x{:08x})",
                chunk_idx + 1,
                total_chunks,
                message_id,
                chunk_data.len(),
                chunks.last().map(|c| c.len()).unwrap_or(0),
                chunk_checksum
            );
        }

        debug!(
            "Created {} chunks for message {} ({} bytes total)",
            chunks.len(),
            message_id,
            data.len()
        );
        Ok(chunks)
    }

    pub fn outbound_app_message(id: String, data: &[u8]) -> Result<MsgPackMessage> {
        let json_data: serde_json::Value = serde_json::from_slice(data).map_err(|err| {
            crate::error::NocturnedError::Config(format!("invalid app message JSON: {err}"))
        })?;
        if let Some(topic) = json_data.get("topic").and_then(|topic| topic.as_str()) {
            return Ok(MsgPackMessage::Event {
                topic: topic.to_string(),
                data: json_data
                    .get("data")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({})),
            });
        }
        let method = json_data
            .get("method")
            .and_then(|method| method.as_str())
            .unwrap_or("unknown")
            .to_string();
        let params = json_data
            .get("params")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(MsgPackMessage::Call { id, method, params })
    }

    async fn process_inbound(&mut self, session_id: u8, new_data: &[u8]) -> Result<Vec<Bytes>> {
        debug!(
            "Inbound EA bytes for session {}: {} new bytes, first bytes: {:02x?}",
            session_id,
            new_data.len(),
            &new_data[..new_data.len().min(10)]
        );

        {
            let buffer = self.inbound_buffers.entry(session_id).or_default();
            if buffer.len().saturating_add(new_data.len()) > MAX_INBOUND_BUFFER {
                warn!(
                    "Session {} inbound buffer would exceed cap ({} + {} > {}), discarding existing buffer",
                    session_id,
                    buffer.len(),
                    new_data.len(),
                    MAX_INBOUND_BUFFER
                );
                buffer.clear();
            }
            buffer.extend_from_slice(new_data);
        }

        let mut completed = Vec::new();

        enum Step {
            Stop,
            FullMsgpack(Bytes),
            Envelope {
                message_id: String,
                index: u16,
                total: u16,
                checksum: u32,
                payload: Bytes,
            },
        }

        loop {
            let step = {
                let buffer = match self.inbound_buffers.get_mut(&session_id) {
                    Some(b) => b,
                    None => break,
                };

                if buffer.is_empty() {
                    Step::Stop
                } else if buffer[0] == 0x24 {
                    match parse_one_chunk_envelope(buffer) {
                        ChunkEnvelopeParse::NeedMore => {
                            debug!(
                                "Session {} buffer holds partial envelope ({} bytes), waiting for more",
                                session_id,
                                buffer.len()
                            );
                            Step::Stop
                        }
                        ChunkEnvelopeParse::Invalid => {
                            warn!(
                                "Session {} buffer holds invalid chunk envelope, discarding {} bytes (first: {:02x?})",
                                session_id,
                                buffer.len(),
                                &buffer[..buffer.len().min(16)]
                            );
                            buffer.clear();
                            Step::Stop
                        }
                        ChunkEnvelopeParse::Complete {
                            message_id,
                            index,
                            total,
                            checksum,
                            payload,
                            consumed,
                        } => {
                            buffer.advance(consumed);
                            debug!(
                                "Parsed binary chunk envelope: id={}, index={}/{}, checksum=0x{:08x}, payload={} bytes ({} bytes remain in buffer)",
                                message_id,
                                index + 1,
                                total,
                                checksum,
                                payload.len(),
                                buffer.len()
                            );
                            Step::Envelope {
                                message_id,
                                index,
                                total,
                                checksum,
                                payload,
                            }
                        }
                    }
                } else if rmp_serde::from_slice::<MsgPackMessage>(buffer).is_ok() {
                    debug!(
                        "Session {} buffer is a complete MessagePack RPC message ({} bytes), not chunked",
                        session_id,
                        buffer.len()
                    );
                    let bytes = Bytes::copy_from_slice(buffer);
                    buffer.clear();
                    Step::FullMsgpack(bytes)
                } else {
                    warn!(
                        "Session {} inbound buffer starts with unrecognized prefix [{:02x?}], discarding {} bytes",
                        session_id,
                        &buffer[..buffer.len().min(8)],
                        buffer.len()
                    );
                    buffer.clear();
                    Step::Stop
                }
            };

            match step {
                Step::Stop => break,
                Step::FullMsgpack(bytes) => {
                    completed.push(bytes);
                    break;
                }
                Step::Envelope {
                    message_id,
                    index,
                    total,
                    checksum,
                    payload,
                } => {
                    if let Some(complete) = self
                        .add_chunk_to_pending(message_id, index, total, checksum, payload)
                        .await?
                    {
                        completed.push(complete);
                    }
                }
            }
        }

        Ok(completed)
    }

    async fn add_chunk_to_pending(
        &mut self,
        message_id: String,
        chunk_idx: u16,
        total_chunks: u16,
        expected_checksum: u32,
        chunk_data: Bytes,
    ) -> Result<Option<Bytes>> {
        if chunk_idx >= total_chunks || total_chunks == 0 {
            debug!(
                "Invalid chunk indices (chunk_idx={}, total_chunks={}), discarding",
                chunk_idx, total_chunks
            );
            return Ok(None);
        }

        let actual_checksum = crc32fast::hash(&chunk_data);
        if actual_checksum != expected_checksum {
            warn!(
                "Chunk {}/{} checksum mismatch: expected 0x{:08x}, got 0x{:08x}, requesting retransmission",
                chunk_idx + 1, total_chunks, expected_checksum, actual_checksum
            );
            self.request_chunk_retransmission(&message_id, chunk_idx)
                .await?;
            return Ok(None);
        } else {
            debug!(
                "Chunk {}/{} checksum verified: 0x{:08x}",
                chunk_idx + 1,
                total_chunks,
                actual_checksum
            );
        }

        debug!(
            "Parsed chunk - ID: {}, chunk {}/{}, payload: {} bytes",
            message_id,
            chunk_idx + 1,
            total_chunks,
            chunk_data.len()
        );

        if total_chunks == 1 {
            if chunk_data.len() > MAX_REASSEMBLED_MESSAGE {
                warn!(
                    message_id,
                    size = chunk_data.len(),
                    max = MAX_REASSEMBLED_MESSAGE,
                    "discarding oversized single-chunk message"
                );
                return Ok(None);
            }
            debug!("Single chunk message, returning payload directly");
            return Ok(Some(chunk_data));
        }

        self.pending_messages
            .retain(|_, pending| pending.updated_at.elapsed() <= PENDING_MESSAGE_TTL);
        if !self.pending_messages.contains_key(&message_id)
            && self.pending_messages.len() >= MAX_PENDING_MESSAGES
        {
            if let Some(oldest) = self
                .pending_messages
                .iter()
                .max_by_key(|(_, pending)| pending.updated_at.elapsed())
                .map(|(id, _)| id.clone())
            {
                self.pending_messages.remove(&oldest);
            }
        }
        let replaced_size = self
            .pending_messages
            .get(&message_id)
            .and_then(|pending| pending.received_chunks.get(&chunk_idx))
            .map_or(0, Bytes::len);
        loop {
            let aggregate_size = self
                .pending_messages
                .values()
                .map(|pending| pending.complete_size)
                .sum::<usize>();
            let projected_size = aggregate_size
                .saturating_sub(replaced_size)
                .saturating_add(chunk_data.len());
            if projected_size <= MAX_PENDING_MESSAGE_BYTES {
                break;
            }
            let oldest_other = self
                .pending_messages
                .iter()
                .filter(|(id, _)| *id != &message_id)
                .max_by_key(|(_, pending)| pending.updated_at.elapsed())
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest_other {
                self.pending_messages.remove(&oldest);
            } else {
                warn!(
                    message_id,
                    projected_size,
                    max = MAX_PENDING_MESSAGE_BYTES,
                    "discarding chunk that would exceed pending-message aggregate cap"
                );
                self.pending_messages.remove(&message_id);
                return Ok(None);
            }
        }

        if let Some(existing) = self.pending_messages.get(&message_id) {
            if existing.total_chunks != total_chunks {
                warn!(
                    message_id,
                    expected = existing.total_chunks,
                    got = total_chunks,
                    "discarding chunk sequence with inconsistent total"
                );
                self.pending_messages.remove(&message_id);
                return Ok(None);
            }
        }

        let chunked_msg = self
            .pending_messages
            .entry(message_id.clone())
            .or_insert_with(|| ChunkedMessage {
                message_id: message_id.clone(),
                total_chunks,
                received_chunks: HashMap::new(),
                complete_size: 0,
                expected_checksum: None,
                updated_at: Instant::now(),
            });

        let prior_len = chunked_msg
            .received_chunks
            .get(&chunk_idx)
            .map_or(0, Bytes::len);
        let next_size = chunked_msg
            .complete_size
            .saturating_sub(prior_len)
            .saturating_add(chunk_data.len());
        if next_size > MAX_REASSEMBLED_MESSAGE {
            warn!(
                message_id,
                size = next_size,
                max = MAX_REASSEMBLED_MESSAGE,
                "discarding oversized chunked message"
            );
            self.pending_messages.remove(&message_id);
            return Ok(None);
        }
        chunked_msg
            .received_chunks
            .insert(chunk_idx, chunk_data.clone());
        chunked_msg.complete_size = next_size;
        chunked_msg.updated_at = Instant::now();

        debug!(
            "Received chunk {}/{} for message {} ({} bytes)",
            chunk_idx + 1,
            total_chunks,
            message_id,
            chunk_data.len()
        );

        if chunked_msg.received_chunks.len() == total_chunks as usize {
            debug!(
                "All chunks received for message {}, reassembling {} total chunks",
                message_id, total_chunks
            );
            let actual_size: usize = chunked_msg
                .received_chunks
                .values()
                .map(|chunk| chunk.len())
                .sum();
            let mut complete_data = BytesMut::with_capacity(actual_size);

            for i in 0..total_chunks {
                if let Some(chunk) = chunked_msg.received_chunks.get(&i) {
                    if !chunk.is_empty() && complete_data.len() + chunk.len() <= actual_size {
                        complete_data.put_slice(chunk);
                    } else {
                        error!(
                            "Invalid chunk {} for message {} (size: {}, would exceed buffer)",
                            i,
                            message_id,
                            chunk.len()
                        );
                        self.pending_messages.remove(&message_id);
                        return Ok(None);
                    }
                } else {
                    error!("Missing chunk {} for message {}", i, message_id);
                    self.pending_messages.remove(&message_id);
                    return Ok(None);
                }
            }

            let complete_message = complete_data.freeze();
            self.pending_messages.remove(&message_id);

            debug!(
                "Reassembled complete message {} ({} bytes)",
                message_id,
                complete_message.len()
            );

            return Ok(Some(complete_message));
        }

        Ok(None)
    }

    async fn handle_msgpack_message(
        &mut self,
        msg: MsgPackMessage,
    ) -> Result<Option<MsgPackMessage>> {
        match msg {
            MsgPackMessage::Call { id, method, params } => {
                debug!("Handling msgpack call: {} -> {}", id, method);

                if let Some(response) = self.try_route_ota_call(&id, &method, &params).await? {
                    return Ok(Some(response));
                }

                if method.starts_with("media.control.") {
                    let cmd = crate::app::hid_mapping::method_to_hid_command(&method);
                    return Ok(Some(match cmd {
                        Some(cmd) => match &self.hid_tx {
                            Some(tx) => match tx.send(cmd) {
                                Ok(()) => MsgPackMessage::Result {
                                    id,
                                    result: media_control_response_payload(&method)
                                        .unwrap_or_else(|| serde_json::json!({ "status": "ok" })),
                                },
                                Err(e) => MsgPackMessage::Error {
                                    id,
                                    error: format!("hid_send_failed: {}", e),
                                },
                            },
                            None => MsgPackMessage::Error {
                                id,
                                error: "hid_unavailable".to_string(),
                            },
                        },
                        None => MsgPackMessage::Error {
                            id,
                            error: format!("unknown_method: {}", method),
                        },
                    }));
                }

                if method == "device.volume.update" {
                    let request = DeviceVolumeUpdateRequest {
                        volume_percent: params
                            .get("volume_percent")
                            .or_else(|| params.get("volumePercent"))
                            .and_then(|v| v.as_u64())
                            .and_then(|v| u8::try_from(v).ok())
                            .unwrap_or(0),
                    };

                    info!("Received phone volume update: {}%", request.volume_percent);

                    if let Some(ws_server) = &self.websocket_server {
                        let volume_data = media_control_payload(phone_volume_update_event(
                            request.volume_percent,
                        ));

                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            async move {
                                ws_server
                                    .broadcast_event("phone.volume.update".to_string(), volume_data)
                                    .await;
                            }
                        });
                    }

                    return Ok(Some(MsgPackMessage::Result {
                        id,
                        result: serde_json::to_value(DeviceVolumeUpdateResponse { success: true })?,
                    }));
                }

                if let Some(handler) = self.call_handlers.get(&method) {
                    let result = handler(&params);
                    Ok(Some(MsgPackMessage::Result { id, result }))
                } else {
                    warn!("No handler for method: {}", method);
                    Ok(Some(MsgPackMessage::Error {
                        id,
                        error: format!("Method not found: {}", method),
                    }))
                }
            }
            MsgPackMessage::Result { id, result } => {
                debug!(
                    "Received msgpack result: {} (tracked_as_websocket: {}, tracked_as_image: {})",
                    id,
                    self.websocket_message_ids.contains(&id),
                    self.pending_image_requests.contains_key(&id)
                );

                {
                    let mut pending_calls = self.pending_calls.lock().await;
                    if let Some(tx) = pending_calls.remove(&id) {
                        let _ = tx.send(result.clone());
                        return Ok(None);
                    }
                }

                if let Some(method) = self.pending_methods.remove(&id) {
                    if method.as_str() == "device.time.get" {
                        if let Ok(response) =
                            serde_json::from_value::<DeviceTimeGetResponse>(result.clone())
                        {
                            let datetime_str = response.datetime;
                            info!("Setting system datetime to: {}", datetime_str);
                            tokio::spawn(async move {
                                if let Err(e) = tokio::process::Command::new("date")
                                    .args(["-s", &datetime_str])
                                    .output()
                                    .await
                                {
                                    error!("Failed to set datetime: {}", e);
                                } else {
                                    info!("Datetime set successfully to {}", datetime_str);
                                }
                            });
                        }
                    }
                }

                if let Some(url) = self.pending_image_requests.remove(&id) {
                    info!(
                        "IMAGE_RESPONSE: Processing image fetch result for request {} URL: {}",
                        id, url
                    );

                    if let Some(ws_server) = &self.websocket_server {
                        let ws_server = Arc::clone(ws_server);
                        let request_id = id.clone();
                        tokio::spawn(async move {
                            ws_server.untrack_image_fetch(&request_id).await;
                        });
                    }

                    if let Some(image_cache) = &self.image_cache {
                        if let Some(data) = result.get("data").and_then(|d| d.as_str()) {
                            let cache = Arc::clone(image_cache);
                            let url_clone = url.clone();
                            let data_clone = data.to_string();
                            let data_len = data.len();

                            tokio::spawn(async move {
                                let cache = cache.lock().await;
                                if let Err(e) = cache.put(&url_clone, data_clone).await {
                                    error!(
                                        "IMAGE_RESPONSE: Failed to cache image for {}: {}",
                                        url_clone, e
                                    );
                                } else {
                                    info!("IMAGE_RESPONSE: Successfully cached image for {} ({} bytes base64)", url_clone, data_len);
                                }
                            });
                        } else {
                            warn!("IMAGE_RESPONSE: Result for {} has no 'data' field", id);
                        }
                    }
                } else if !id.is_empty() && result.get("data").is_some() {
                    warn!("IMAGE_RESPONSE: Received result with 'data' field but request {} not tracked as image request!", id);
                }

                if self.websocket_message_ids.contains(&id) {
                    info!(
                        "ROUTE_TO_WEBSOCKET: Routing result for request {} back to WebSocket",
                        id
                    );
                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let request_id = id.clone();
                            async move {
                                info!("ROUTE_TO_WEBSOCKET: Sending response for request {} to WebSocket clients", request_id);
                                ws_server.send_response(request_id, result).await;
                            }
                        });
                    }
                    self.websocket_message_ids.remove(&id);
                } else {
                    warn!(
                        "ROUTE_TO_WEBSOCKET: Received result with untracked ID: {}, no WebSocket client waiting (websocket_message_ids has {} entries)",
                        id,
                        self.websocket_message_ids.len()
                    );
                }
                Ok(None)
            }
            MsgPackMessage::Error { id, error } => {
                warn!("Received msgpack error: {} -> {}", id, error);

                {
                    let mut pending_calls = self.pending_calls.lock().await;
                    if let Some(tx) = pending_calls.remove(&id) {
                        let _ = tx.send(serde_json::json!({ "__error": error.clone() }));
                        return Ok(None);
                    }
                }

                if self.websocket_message_ids.contains(&id) {
                    debug!("Routing error back to WebSocket: {}", id);
                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let request_id = id.clone();
                            let error_msg = error.clone();
                            async move {
                                ws_server.send_error(request_id, error_msg).await;
                            }
                        });
                    }
                    self.websocket_message_ids.remove(&id);
                } else {
                    warn!(
                        "Received error with untracked ID: {}, no WebSocket client waiting",
                        id
                    );
                }
                Ok(None)
            }
            MsgPackMessage::Event { topic, data } => {
                let (topic, data) = normalize_bt_only_event(topic, data);
                let data = attach_phone_source(&topic, data, self.connection_peer);

                if self
                    .try_route_ota_call(&uuid::Uuid::new_v4().to_string(), &topic, &data)
                    .await?
                    .is_some()
                {
                    debug!(%topic, "Routed OTA event into OTA actor");
                    return Ok(None);
                }

                if topic == "network.status" {
                    if let Some(status) = data.get("status").and_then(|s| s.as_str()) {
                        match status {
                            "disconnected" => {
                                warn!("iPhone lost internet connection");
                            }
                            "connected" => {
                                info!("iPhone reconnected to internet");
                            }
                            _ => {
                                info!("Unknown network status: {}", status);
                            }
                        }
                    }
                } else if topic == "app.ready" {
                    self.app_ready_received.store(true, Ordering::Relaxed);

                    if let Some(datetime_str) = data.get("datetime").and_then(|v| v.as_str()) {
                        info!("Setting system datetime from app.ready: {}", datetime_str);
                        let datetime_str = datetime_str.to_string();
                        tokio::spawn(async move {
                            if let Err(e) = tokio::process::Command::new("date")
                                .args(["-s", &datetime_str])
                                .output()
                                .await
                            {
                                error!("Failed to set datetime from app.ready: {}", e);
                            } else {
                                info!(
                                    "Datetime set successfully from app.ready to {}",
                                    datetime_str
                                );
                            }
                        });
                    }

                    if let Some(tz) = data.get("timezone") {
                        if let Some(tz_id) = tz.get("identifier").and_then(|v| v.as_str()) {
                            info!("Phone timezone: {}", tz_id);
                        }
                    }

                    if let Some(subscribed) = data.get("subscribed").and_then(|v| v.as_bool()) {
                        info!(
                            "Subscription status from app.ready: {}",
                            if subscribed {
                                "subscribed"
                            } else {
                                "not subscribed"
                            }
                        );
                    }
                    if let Some(status) =
                        string_field(&data, "subscription_status", "subscriptionStatus")
                    {
                        info!("Subscription tier from app.ready: {}", status);
                    }
                    if let Some(has_lifetime) = bool_field(&data, "has_lifetime", "hasLifetime") {
                        info!("Lifetime entitlement from app.ready: {}", has_lifetime);
                    }

                    info!("Broadcasting app.ready event to WebSocket clients");
                } else if topic == "subscription.updated" {
                    if let Some(subscribed) = data.get("subscribed").and_then(|v| v.as_bool()) {
                        info!(
                            "Subscription status updated: {}",
                            if subscribed {
                                "subscribed"
                            } else {
                                "not subscribed"
                            }
                        );
                    }
                    if let Some(has_lifetime) = bool_field(&data, "has_lifetime", "hasLifetime") {
                        info!("Lifetime entitlement updated: {}", has_lifetime);
                    }
                } else if topic == "notification.show" {
                    let id = data.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let title = data.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let category = data.get("category").and_then(|v| v.as_str()).unwrap_or("");
                    info!(
                        "Forwarding notification.show to UI: id={} category={} title=\"{}\"",
                        id, category, title
                    );
                } else {
                    info!("Broadcasting event to WebSocket clients: {}", topic);
                }

                if topic == "voice.transcription" {
                    if let Some(transcript) = data.get("transcript").and_then(|v| v.as_str()) {
                        let is_final = data
                            .get("is_final")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        if is_final {
                            info!("Voice transcription (final): {}", transcript);
                        } else {
                            debug!("Voice transcription (partial): {}", transcript);
                        }
                    }
                }

                let (topic, data) = normalize_voice_event(topic, data);
                let (topic, data) = normalize_media_control_event(topic, data);

                let data = if topic == "media.now_playing.update" {
                    let mut d = data;
                    if let Some(attrs) = d.get_mut("media_item_attributes") {
                        if let Some(artist) = attrs.get("MediaItemArtist").and_then(|v| v.as_str())
                        {
                            let cleaned = artist
                                .replace(" • Video Available", "")
                                .replace("Video Available • ", "")
                                .replace("Video Available", "")
                                .replace(" • Lossless", "")
                                .replace("Lossless • ", "")
                                .replace("Lossless", "");
                            attrs["MediaItemArtist"] = serde_json::json!(cleaned);
                        }
                    }
                    d
                } else {
                    data
                };

                if let Some(ws_server) = &self.websocket_server {
                    let source_peer = self.connection_peer.map(|peer| peer.to_string());
                    ws_server
                        .broadcast_event_from_route(
                            topic,
                            data,
                            self.connection_route.as_deref(),
                            source_peer.as_deref(),
                        )
                        .await;
                }
                Ok(None)
            }
        }
    }
}

impl MsgPackProtocolHandler {
    pub fn protocol_name(&self) -> &str {
        MSGPACK_PROTOCOL
    }

    pub async fn handle_message(&mut self, message: AppMessage) -> Result<Option<AppMessage>> {
        let completed = self
            .process_inbound(message.session_id, &message.data)
            .await?;

        if completed.is_empty() {
            return Ok(None);
        }

        let mut response_to_return: Option<AppMessage> = None;
        for complete_data in completed {
            let response = match self
                .dispatch_complete_message(&message.id, complete_data)
                .await?
            {
                Some(r) => r,
                None => continue,
            };

            if response_to_return.is_none() {
                response_to_return = Some(response);
            } else {
                let mut extra = response;
                extra.session_id = message.session_id;
                let route = {
                    let route = self.session_route.lock().await;
                    route.clone()
                };
                if let Some(route) = route {
                    if let Err(e) = route.tx.send(extra) {
                        error!("Failed to forward extra response via session_tx: {}", e);
                    }
                } else {
                    warn!(
                        "Multiple responses produced but no session_tx available to forward them"
                    );
                }
            }
        }

        Ok(response_to_return)
    }

    async fn dispatch_complete_message(
        &mut self,
        request_id: &str,
        complete_data: Bytes,
    ) -> Result<Option<AppMessage>> {
        debug!(
            "Processing complete message data: {} bytes",
            complete_data.len()
        );

        let rpc_msg = match rmp_serde::from_slice::<MsgPackMessage>(&complete_data) {
            Ok(msg) => msg,
            Err(de_error) => {
                debug!(
                    "Direct MessagePack decode failed, trying rmpv conversion: {}",
                    de_error
                );

                if let Ok(mut rmpv_value) = rmpv::decode::read_value(&mut &complete_data[..]) {
                    normalize_transfer_result_binary(&mut rmpv_value);
                    let json_value = rmpv_to_json(rmpv_value);

                    if let Ok(msg) = serde_json::from_value::<MsgPackMessage>(json_value.clone()) {
                        debug!("Successfully decoded via rmpv conversion");
                        msg
                    } else {
                        warn!("Failed to decode MessagePack message: {}", de_error);
                        debug!("Raw data hex: {}", hex::encode(&complete_data));

                        if let Some(id) = json_value.get("id").and_then(|v| v.as_str()) {
                            if self.websocket_message_ids.contains(id) {
                                debug!("Sending decode error to WebSocket: {}", id);
                                if let Some(ws_server) = &self.websocket_server {
                                    let ws_server = Arc::clone(ws_server);
                                    let error_id = id.to_string();
                                    let error_msg =
                                        format!("MessagePack decode error: {}", de_error);
                                    tokio::spawn(async move {
                                        ws_server.send_error(error_id, error_msg).await;
                                    });
                                }
                                self.websocket_message_ids.remove(id);
                            }
                        }
                        return Ok(None);
                    }
                } else {
                    warn!("Failed to decode MessagePack message: {}", de_error);
                    debug!("Raw data hex: {}", hex::encode(&complete_data));
                    return Ok(None);
                }
            }
        };

        if let Some(response_msg) = self.handle_msgpack_message(rpc_msg).await? {
            let response_data = rmp_serde::to_vec_named(&response_msg).map_err(|e| {
                crate::error::NocturnedError::Config(format!(
                    "MessagePack serialization error: {}",
                    e
                ))
            })?;

            info!(
                "Sending MessagePack response ({} bytes)",
                response_data.len()
            );

            let chunks = Self::create_chunks(&response_data)?;
            if chunks.len() == 1 {
                let response = self.create_response(request_id.to_string(), chunks[0].clone());
                debug!(
                    "Returning response from handle_message: {} bytes, id={}",
                    response.data.len(),
                    request_id
                );
                return Ok(Some(response));
            } else {
                error!("Multi-chunk responses not yet supported");
                return Ok(None);
            }
        }

        Ok(None)
    }

    pub fn create_response(&self, request_id: String, data: Bytes) -> AppMessage {
        AppMessage {
            id: request_id,
            protocol: self.protocol_name().to_string(),
            session_id: 0,
            priority: AppMessagePriority::Normal,
            data,
        }
    }

    async fn request_chunk_retransmission(
        &mut self,
        message_id: &str,
        chunk_idx: u16,
    ) -> Result<()> {
        warn!(
            "Requesting retransmission of chunk {} for message {}",
            chunk_idx, message_id
        );

        let retransmit_data = bt_only_payload(ChunkRetransmitRequestEvent {
            message_id: message_id.to_string(),
            chunk_idx,
        });
        let event = MsgPackMessage::Event {
            topic: "chunk.retransmit_request".to_string(),
            data: retransmit_data.clone(),
        };
        let serialized = rmp_serde::to_vec_named(&event).map_err(|err| {
            crate::error::NocturnedError::Config(format!(
                "failed to serialize retransmit request: {err}"
            ))
        })?;
        let chunks = Self::create_chunks(&serialized)?;
        let route = self.session_route.lock().await.clone();
        if let Some(route) = route {
            let outbound_id = uuid::Uuid::new_v4().to_string();
            for chunk in chunks {
                route
                    .tx
                    .send(AppMessage {
                        id: outbound_id.clone(),
                        protocol: MSGPACK_PROTOCOL.to_string(),
                        session_id: route.session_id,
                        priority: AppMessagePriority::Normal,
                        data: chunk,
                    })
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "failed to send retransmit request: {err}"
                        ))
                    })?;
            }
        } else {
            warn!(
                message_id,
                chunk_idx, "no active companion route for retransmit request"
            );
        }

        if let Some(ws_server) = &self.websocket_server {
            tokio::spawn({
                let ws_server = Arc::clone(ws_server);
                async move {
                    ws_server
                        .broadcast_event("chunk.retransmit_request".to_string(), retransmit_data)
                        .await;
                }
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use base64::{engine::general_purpose, Engine as _};
    use bytes::{Bytes, BytesMut};
    use libnocturne::generated::bt_only::{AudioRecordingStartedEvent, AudioRecordingStoppedEvent};
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::{mpsc, Mutex};
    use tokio::time::{timeout, Duration};

    use super::{
        advertised_ota_pull_window, attach_phone_source, create_audio_data_event,
        create_audio_recording_started_event, create_audio_recording_stopped_event,
        normalize_app_ready_event, normalize_entitlement_update_event,
        normalize_media_control_event, normalize_transfer_result_binary, normalize_voice_event,
        parse_one_chunk_envelope, parse_ota_package_ready, pull_ota_chunks_inner, rmpv_to_json,
        transfer_result_bytes, AppSessionRoute, ChunkEnvelopeParse, MsgPackMessage,
        MsgPackProtocolHandler, MAX_INBOUND_BUFFER, MAX_PENDING_MESSAGE_BYTES,
        MAX_REASSEMBLED_MESSAGE, OTA_LEGACY_PULL_SIZE, OTA_MAX_PULL_WINDOW_SIZE,
    };
    use crate::app::AppMessagePriority;

    fn decode_single_chunk_call(message: &crate::app::AppMessage) -> MsgPackMessage {
        match parse_one_chunk_envelope(&message.data) {
            ChunkEnvelopeParse::Complete { payload, .. } => {
                rmp_serde::from_slice(&payload).expect("outbound app call should decode")
            }
            ChunkEnvelopeParse::NeedMore => panic!("test call should fit in one chunk"),
            ChunkEnvelopeParse::Invalid => panic!("test call should be a valid chunk envelope"),
        }
    }

    #[test]
    fn media_generation_is_preserved_across_companion_casing() {
        let (topic, update) = normalize_media_control_event(
            "media.nowPlaying.update".to_string(),
            serde_json::json!({
                "MediaItemAttributes": { "MediaItemTitle": "Song" },
                "PlaybackAttributes": { "PlaybackStatus": "playing" },
                "mediaGeneration": 7,
            }),
        );
        assert_eq!(topic, "media.now_playing.update");
        assert_eq!(update["media_generation"], 7);
        assert_eq!(update["media_item_attributes"]["MediaItemTitle"], "Song");

        let (topic, artwork) = normalize_media_control_event(
            "media.now_playing.artwork".to_string(),
            serde_json::json!({
                "data": "YWJj",
                "content_type": "image/png",
                "media_generation": 7,
            }),
        );
        assert_eq!(topic, "media.now_playing.artwork");
        assert_eq!(artwork["media_generation"], 7);
        assert_eq!(artwork["content_type"], "image/png");
    }

    #[test]
    fn untagged_media_events_remain_untagged() {
        let (_, update) = normalize_media_control_event(
            "media.nowPlaying.update".to_string(),
            serde_json::json!({
                "mediaItemAttributes": { "MediaItemTitle": "Legacy" },
                "playbackAttributes": { "PlaybackStatus": "paused" },
            }),
        );
        assert!(update.get("media_generation").is_none());

        let (_, artwork) = normalize_media_control_event(
            "media.nowPlaying.artwork".to_string(),
            serde_json::json!({ "data": "YWJj", "contentType": "image/jpeg" }),
        );
        assert!(artwork.get("media_generation").is_none());
    }

    #[tokio::test]
    async fn chunk_reassembly_requests_retransmit_on_the_exact_route() {
        let (session_tx, mut session_rx) = mpsc::unbounded_channel();
        let mut handler = MsgPackProtocolHandler::new(None);
        handler.set_session_info(session_tx, 7).await;
        let message_id = uuid::Uuid::new_v4().to_string();
        let first = Bytes::from_static(b"first");
        let second = Bytes::from_static(b"second");

        assert!(handler
            .add_chunk_to_pending(
                message_id.clone(),
                0,
                2,
                crc32fast::hash(&first),
                first.clone(),
            )
            .await
            .unwrap()
            .is_none());
        assert!(handler
            .add_chunk_to_pending(message_id.clone(), 1, 2, 0, second.clone())
            .await
            .unwrap()
            .is_none());

        let request = timeout(Duration::from_secs(1), session_rx.recv())
            .await
            .expect("retransmit request should use the companion route")
            .expect("route should remain open");
        assert_eq!(request.session_id, 7);
        assert_eq!(request.priority, AppMessagePriority::Normal);
        match decode_single_chunk_call(&request) {
            MsgPackMessage::Event { topic, data } => {
                assert_eq!(topic, "chunk.retransmit_request");
                assert_eq!(data["message_id"], message_id);
                assert_eq!(data["chunk_idx"], 1);
            }
            other => panic!("expected retransmit event, got {other:?}"),
        }

        let complete = handler
            .add_chunk_to_pending(message_id, 1, 2, crc32fast::hash(&second), second)
            .await
            .unwrap()
            .expect("correct retransmission should complete the message");
        assert_eq!(&complete[..], b"firstsecond");
    }

    #[tokio::test]
    async fn reassembly_accepts_max_ota_response_and_exact_cap_but_rejects_oversize() {
        let bytes = vec![0x5a; OTA_MAX_PULL_WINDOW_SIZE];
        let response = MsgPackMessage::Result {
            id: uuid::Uuid::new_v4().to_string(),
            result: serde_json::json!({
                "data": general_purpose::STANDARD.encode(&bytes),
            }),
        };
        let encoded = rmp_serde::to_vec_named(&response).unwrap();
        assert!(encoded.len() > OTA_MAX_PULL_WINDOW_SIZE);
        assert!(encoded.len() < MAX_REASSEMBLED_MESSAGE);
        assert!(MAX_PENDING_MESSAGE_BYTES >= MAX_REASSEMBLED_MESSAGE);

        let native_response = rmpv::Value::Map(vec![
            (rmpv::Value::from("type"), rmpv::Value::from("result")),
            (rmpv::Value::from("id"), rmpv::Value::from("transfer-1")),
            (
                rmpv::Value::from("result"),
                rmpv::Value::Map(vec![(
                    rmpv::Value::from("data"),
                    rmpv::Value::Binary(bytes.clone()),
                )]),
            ),
        ]);
        let mut native_encoded = Vec::new();
        rmpv::encode::write_value(&mut native_encoded, &native_response).unwrap();
        assert!(native_encoded.len() < encoded.len());

        for wire_message in [&native_encoded, &encoded] {
            let envelopes = MsgPackProtocolHandler::create_chunks(wire_message).unwrap();
            let envelope_size = envelopes.iter().map(Bytes::len).sum::<usize>();
            assert!(envelope_size < MAX_INBOUND_BUFFER);
            let mut coalesced = BytesMut::with_capacity(envelope_size);
            for envelope in envelopes {
                coalesced.extend_from_slice(&envelope);
            }
            let mut handler = MsgPackProtocolHandler::new(None);
            let completed = handler.process_inbound(1, &coalesced).await.unwrap();
            assert_eq!(
                completed.as_slice(),
                &[Bytes::copy_from_slice(wire_message)]
            );
        }

        for message_size in [
            encoded.len(),
            192 * 1024,
            MAX_REASSEMBLED_MESSAGE,
            MAX_REASSEMBLED_MESSAGE + 1,
        ] {
            let mut handler = MsgPackProtocolHandler::new(None);
            let message_id = uuid::Uuid::new_v4().to_string();
            let payload = vec![0x42; message_size];
            let pieces = payload.chunks(2000).collect::<Vec<_>>();
            let mut complete = None;
            for (index, piece) in pieces.iter().enumerate() {
                complete = handler
                    .add_chunk_to_pending(
                        message_id.clone(),
                        index as u16,
                        pieces.len() as u16,
                        crc32fast::hash(piece),
                        Bytes::copy_from_slice(piece),
                    )
                    .await
                    .unwrap();
            }
            if message_size <= MAX_REASSEMBLED_MESSAGE {
                assert_eq!(complete.as_deref(), Some(payload.as_slice()));
            } else {
                assert!(complete.is_none());
                assert!(!handler.pending_messages.contains_key(&message_id));
            }
        }
    }

    async fn answer_transfer_call(
        pending_calls: &Arc<
            Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
        >,
        id: &str,
        bytes: Vec<u8>,
    ) {
        let tx = pending_calls
            .lock()
            .await
            .remove(id)
            .expect("transfer call should be pending");
        tx.send(serde_json::json!({
            "data": general_purpose::STANDARD.encode(bytes),
        }))
        .expect("transfer response receiver should be alive");
    }

    fn test_ota_source() -> crate::ota::OtaSource {
        crate::ota::OtaSource::new(None, Some("test-route".into()))
    }

    #[test]
    fn entitlement_events_normalize_compatible_camel_case_to_canonical_fields() {
        let ready = normalize_app_ready_event(serde_json::json!({
            "platform": "ios",
            "subscribed": true,
            "subscriptionStatus": "none",
            "hasLifetime": true,
            "isAdmin": true,
            "entitlementsVerified": true,
            "spotifySkipped": false,
        }));

        assert_eq!(ready["subscription_status"], "none");
        assert_eq!(ready["has_lifetime"], true);
        assert_eq!(ready["is_admin"], true);
        assert_eq!(ready["entitlements_verified"], true);
        assert_eq!(ready["spotify_skipped"], false);
        assert!(ready.get("subscriptionStatus").is_none());
        assert!(ready.get("hasLifetime").is_none());
        assert!(ready.get("isAdmin").is_none());
        assert!(ready.get("entitlementsVerified").is_none());

        let update = normalize_entitlement_update_event(serde_json::json!({
            "subscribed": true,
            "subscriptionStatus": "active",
            "hasLifetime": false,
            "isAdmin": false,
            "entitlementsVerified": true,
        }));

        assert_eq!(update["subscription_status"], "active");
        assert_eq!(update["has_lifetime"], false);
        assert_eq!(update["is_admin"], false);
        assert_eq!(update["entitlements_verified"], true);
        assert!(update.get("subscriptionStatus").is_none());
        assert!(update.get("hasLifetime").is_none());
        assert!(update.get("isAdmin").is_none());
        assert!(update.get("entitlementsVerified").is_none());
    }

    #[test]
    fn audio_data_event_has_expected_wire_format() {
        let opus_data = [0xAA, 0xBB, 0xCC, 0xDD];
        let event = create_audio_data_event(42, &opus_data, 1_713_000);

        match event {
            MsgPackMessage::Event { topic, data } => {
                assert_eq!(topic, "audio.data");
                assert_eq!(data["seq"], serde_json::json!(42_u64));
                assert_eq!(data["opus"], serde_json::json!("qrvM3Q=="));
                assert_eq!(data["ts"], serde_json::json!(1_713_000_u64));
            }
            other => panic!("expected event message, got {other:?}"),
        }
    }

    #[test]
    fn audio_recording_started_event_has_expected_fields() {
        let event = create_audio_recording_started_event(AudioRecordingStartedEvent {
            sample_rate: 16000,
            channels: 1,
            frame_ms: 20,
        });

        match event {
            MsgPackMessage::Event { topic, data } => {
                assert_eq!(topic, "audio.recording.started");
                assert_eq!(data["sample_rate"], serde_json::json!(16000));
                assert_eq!(data["channels"], serde_json::json!(1));
                assert_eq!(data["frame_ms"], serde_json::json!(20));
            }
            other => panic!("expected event message, got {other:?}"),
        }
    }

    #[test]
    fn audio_recording_stopped_event_has_expected_fields() {
        let event = create_audio_recording_stopped_event(AudioRecordingStoppedEvent {
            reason: "user_requested".to_string(),
            total_frames: 128,
        });

        match event {
            MsgPackMessage::Event { topic, data } => {
                assert_eq!(topic, "audio.recording.stopped");
                assert_eq!(data["reason"], serde_json::json!("user_requested"));
                assert_eq!(data["total_frames"], serde_json::json!(128_u64));
            }
            other => panic!("expected event message, got {other:?}"),
        }
    }

    #[test]
    fn companion_phone_lifecycle_uses_daemon_observed_peer_identity() {
        let peer: bluer::Address = "D8:3A:DD:31:B0:49".parse().unwrap();
        for topic in [
            "phone.call.started",
            "phone.call.updated",
            "phone.call.ended",
        ] {
            let data = attach_phone_source(
                topic,
                serde_json::json!({
                    "call_id": "call-1",
                    "device": "02:00:00:00:00:00",
                }),
                Some(peer),
            );

            assert_eq!(data["device"], peer.to_string());
        }
    }

    #[test]
    fn companion_source_identity_does_not_modify_unrelated_events() {
        let peer: bluer::Address = "D8:3A:DD:31:B0:49".parse().unwrap();
        let data = attach_phone_source(
            "notification.show",
            serde_json::json!({ "device": "mobile-owned" }),
            Some(peer),
        );

        assert_eq!(data["device"], "mobile-owned");
    }

    #[test]
    fn voice_transcription_normalization_preserves_session_metadata() {
        let (topic, data) = normalize_voice_event(
            "voice.transcription".to_string(),
            serde_json::json!({
                "transcript": "play daft punk",
                "is_final": true,
                "session_id": "voice-session-1"
            }),
        );

        assert_eq!(topic, "voice.transcription");
        assert_eq!(data["transcript"], serde_json::json!("play daft punk"));
        assert_eq!(data["is_final"], serde_json::json!(true));
        assert_eq!(data["session_id"], serde_json::json!("voice-session-1"));
    }

    #[test]
    fn ai_tool_normalization_preserves_ios_tool_metadata() {
        let (topic, data) = normalize_voice_event(
            "ai.tool_executed".to_string(),
            serde_json::json!({
                "tool": "spotify_play",
                "call_id": "call-1",
                "status": "completed",
                "result": { "uri": "spotify:track:123" },
                "tool_arguments": { "uri": "spotify:track:123" },
                "session_id": "voice-session-1"
            }),
        );

        assert_eq!(topic, "ai.tool_executed");
        assert_eq!(data["tool_name"], serde_json::json!("spotify_play"));
        assert_eq!(data["tool"], serde_json::json!("spotify_play"));
        assert_eq!(data["call_id"], serde_json::json!("call-1"));
        assert_eq!(data["status"], serde_json::json!("completed"));
        assert_eq!(
            data["result"]["uri"],
            serde_json::json!("spotify:track:123")
        );
        assert_eq!(
            data["tool_arguments"]["uri"],
            serde_json::json!("spotify:track:123")
        );
        assert_eq!(data["session_id"], serde_json::json!("voice-session-1"));
    }

    #[test]
    fn voice_normalization_canonicalizes_camel_case_metadata() {
        let (topic, data) = normalize_voice_event(
            "ai.state".to_string(),
            serde_json::json!({
                "state": "thinking",
                "sessionId": "voice-session-1"
            }),
        );

        assert_eq!(topic, "ai.state");
        assert_eq!(data["state"], serde_json::json!("thinking"));
        assert_eq!(data["session_id"], serde_json::json!("voice-session-1"));
        assert_eq!(data["sessionId"], serde_json::json!("voice-session-1"));
    }

    #[test]
    fn audio_data_event_for_sixty_byte_frame_fits_one_chunk() {
        let opus_data = vec![0xAB; 60];
        let event = create_audio_data_event(7, &opus_data, 999);
        let serialized = rmp_serde::to_vec_named(&event).expect("audio event should serialize");

        assert!(serialized.len() < 2000);

        let chunks =
            MsgPackProtocolHandler::create_chunks(&serialized).expect("audio event should chunk");

        assert_eq!(chunks.len(), 1);
    }

    #[test]
    fn transfer_result_accepts_msgpack_binary_data() {
        let mut wire = rmpv::Value::Map(vec![
            (rmpv::Value::from("type"), rmpv::Value::from("result")),
            (rmpv::Value::from("id"), rmpv::Value::from("transfer-1")),
            (
                rmpv::Value::from("result"),
                rmpv::Value::Map(vec![(
                    rmpv::Value::from("data"),
                    rmpv::Value::Binary(vec![0, 1, 2, 127, 128, 255]),
                )]),
            ),
        ]);
        normalize_transfer_result_binary(&mut wire);
        let json = rmpv_to_json(wire);
        let msg: MsgPackMessage =
            serde_json::from_value(json).expect("binary result should convert through fallback");

        let MsgPackMessage::Result { result, .. } = msg else {
            panic!("expected result message");
        };
        assert!(result["data"].is_string());
        assert_eq!(
            transfer_result_bytes(&result).expect("binary data should decode"),
            vec![0, 1, 2, 127, 128, 255]
        );
    }

    #[test]
    fn outbound_app_message_preserves_event_shape() {
        let data = serde_json::to_vec(&serde_json::json!({
            "topic": "ota.asset_range",
            "data": {
                "requestId": "550e8400-e29b-41d4-a716-446655440000",
                "updateId": "update-1",
                "asset": "rootfs.swu",
                "ranges": [{ "start": 0, "length": 4 }]
            },
            "_targetPeer": "00:11:22:33:44:55"
        }))
        .unwrap();

        let message = MsgPackProtocolHandler::outbound_app_message("msg-1".to_string(), &data)
            .expect("event app message should convert");

        match message {
            MsgPackMessage::Event { topic, data } => {
                assert_eq!(topic, "ota.asset_range");
                assert_eq!(data["requestId"], "550e8400-e29b-41d4-a716-446655440000");
                assert!(data.get("_targetPeer").is_none());
            }
            other => panic!("expected event message, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ota_asset_range_chunk_event_routes_to_ota_actor() {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel(1);
        let mut handler = MsgPackProtocolHandler::new(None);
        handler.set_ota_cmd_tx(cmd_tx);
        let request_id = uuid::Uuid::new_v4();

        let response = handler
            .handle_msgpack_message(MsgPackMessage::Event {
                topic: "ota.asset_range_chunk".to_string(),
                data: serde_json::json!({
                    "requestId": request_id.to_string(),
                    "partIndex": 0,
                    "offset": 0,
                    "bytes": [1, 2, 3],
                    "last": true,
                }),
            })
            .await
            .expect("OTA event should route");

        assert!(response.is_none());
        match cmd_rx.recv().await.expect("expected OTA command") {
            crate::ota::Command::AssetRangeChunk { chunk, .. } => {
                assert_eq!(chunk.request_id, request_id);
                assert_eq!(chunk.part_index, 0);
                assert_eq!(chunk.offset, 0);
                assert_eq!(chunk.bytes, vec![1, 2, 3]);
                assert!(chunk.last);
            }
            other => panic!("expected asset range chunk, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ota_package_ready_pulls_from_the_authoritative_device_offset() {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel(1);
        let mut handler = MsgPackProtocolHandler::new(None);
        handler.set_ota_cmd_tx(cmd_tx);

        let task = tokio::spawn(async move {
            handler
                .handle_msgpack_message(MsgPackMessage::Event {
                    topic: "ota.package_ready".to_string(),
                    data: serde_json::json!({
                        "updateId": "update-1",
                        "version": "4.2.0+20260725010101",
                        "size": 4,
                        "expectedSha256": "a".repeat(64),
                        "resumeFromOffset": 0,
                    }),
                })
                .await
        });

        match cmd_rx.recv().await.expect("expected OTA authorization") {
            crate::ota::Command::AuthorizePull { ready, ack, .. } => {
                assert_eq!(ready.resume_from_offset, 0);
                ack.send(Ok(crate::ota::OtaPullAuthorization {
                    resume_from_offset: 4,
                    transfer_window_size: OTA_LEGACY_PULL_SIZE as u32,
                }))
                .unwrap();
            }
            other => panic!("expected OTA authorization, got {other:?}"),
        }

        let response = task.await.unwrap().expect("handler should succeed");
        assert!(response.is_none());

        match timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("pull task should use the authorization offset")
            .expect("OTA actor mailbox should remain open")
        {
            crate::ota::Command::PulledChunk { chunk, ack, .. } => {
                assert_eq!(chunk.update_id, "update-1");
                assert_eq!(chunk.offset, 4);
                assert!(chunk.bytes.is_empty());
                assert!(chunk.last);
                ack.send(Ok(())).unwrap();
            }
            other => panic!("expected final resumed chunk, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn ota_begin_call_preserves_source_peer() {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel(1);
        let mut handler = MsgPackProtocolHandler::new(None);
        handler.set_ota_cmd_tx(cmd_tx);
        let peer: bluer::Address = "00:11:22:33:44:55".parse().unwrap();
        handler.set_connection_peer(peer);

        let task = tokio::spawn(async move {
            handler
                .handle_msgpack_message(MsgPackMessage::Call {
                    id: "begin-1".to_string(),
                    method: "ota.begin".to_string(),
                    params: serde_json::json!({
                        "kind": "image",
                        "updateId": "update-1",
                        "expectedSha256": "abc123",
                        "expectedSize": 4,
                    }),
                })
                .await
        });

        match cmd_rx.recv().await.expect("expected OTA begin command") {
            crate::ota::Command::Begin {
                source: actual,
                ack,
                ..
            } => {
                assert_eq!(actual.peer, Some(peer));
                ack.send(Ok(libnocturne::gateway::OtaBeginAck {
                    resume_from_offset: 0,
                }))
                .unwrap();
            }
            other => panic!("expected OTA begin, got {other:?}"),
        }

        let response = task.await.unwrap().expect("handler should succeed");
        assert!(matches!(response, Some(MsgPackMessage::Result { .. })));
    }

    #[test]
    fn ota_package_ready_requires_a_safe_target_version() {
        let valid = parse_ota_package_ready(&serde_json::json!({
            "updateId": "update-1",
            "version": "4.2.0+20260725010101",
            "size": 4,
            "expectedSha256": "a".repeat(64),
            "resumeFromOffset": 0,
        }))
        .expect("valid package metadata should parse");
        assert_eq!(valid.version, "4.2.0+20260725010101");
        assert_eq!(
            advertised_ota_pull_window(&valid),
            OTA_LEGACY_PULL_SIZE as u32
        );

        let capable = parse_ota_package_ready(&serde_json::json!({
            "updateId": "update-1",
            "version": "4.2.0+20260725010101",
            "size": 4,
            "expectedSha256": "a".repeat(64),
            "resumeFromOffset": 0,
            "maxTransferChunkSize": OTA_MAX_PULL_WINDOW_SIZE * 2,
            "supportsChunkedTransferResponse": true,
            "transferDataEncoding": "msgpack_binary",
        }))
        .expect("capable package metadata should parse");
        assert_eq!(
            advertised_ota_pull_window(&capable),
            OTA_MAX_PULL_WINDOW_SIZE as u32
        );

        for version in [serde_json::Value::Null, serde_json::json!("4.2.0\nunsafe")] {
            let result = parse_ota_package_ready(&serde_json::json!({
                "updateId": "update-1",
                "version": version,
                "size": 4,
                "expectedSha256": "a".repeat(64),
                "resumeFromOffset": 0,
            }));
            assert!(result.is_err());
        }
    }

    #[tokio::test]
    async fn pull_ota_chunks_is_daemon_paced_and_uses_bounded_windows() {
        let (session_tx, mut session_rx) = mpsc::unbounded_channel();
        let session_route = Arc::new(Mutex::new(Some(AppSessionRoute {
            tx: session_tx,
            session_id: 7,
        })));
        let pending_calls = Arc::new(Mutex::new(HashMap::new()));
        let (cmd_tx, mut cmd_rx) = mpsc::channel(4);
        let package: Vec<u8> = (0..(OTA_MAX_PULL_WINDOW_SIZE * 2 + 1))
            .map(|idx| (idx % 251) as u8)
            .collect();
        let ready = libnocturne::gateway::OtaPackageReady {
            update_id: "pull-test-update".to_string(),
            version: "9.9.9".to_string(),
            size: package.len() as u32,
            expected_sha256: "a".repeat(64),
            resume_from_offset: 0,
            max_transfer_chunk_size: Some(OTA_MAX_PULL_WINDOW_SIZE as u32),
            supports_chunked_transfer_response: Some(true),
            transfer_data_encoding: Some("msgpack_binary".into()),
        };

        let transfer_task = tokio::spawn(pull_ota_chunks_inner(
            session_route,
            Arc::clone(&pending_calls),
            cmd_tx,
            test_ota_source(),
            ready,
            OTA_MAX_PULL_WINDOW_SIZE as u32,
        ));

        let first_call = timeout(Duration::from_secs(1), session_rx.recv())
            .await
            .expect("first transfer request should be sent")
            .expect("session should stay open");
        let first_id = first_call.id.clone();
        assert_eq!(first_call.priority, AppMessagePriority::Bulk);
        match decode_single_chunk_call(&first_call) {
            MsgPackMessage::Call { method, params, .. } => {
                assert_eq!(method, "device.ota.transfer");
                assert_eq!(params["offset"], serde_json::json!(0_u64));
                assert_eq!(params["size"], serde_json::json!(OTA_MAX_PULL_WINDOW_SIZE));
            }
            other => panic!("expected transfer call, got {other:?}"),
        }
        assert!(cmd_rx.try_recv().is_err(), "no chunk before app response");

        answer_transfer_call(
            &pending_calls,
            &first_id,
            package[..OTA_MAX_PULL_WINDOW_SIZE].to_vec(),
        )
        .await;

        let first_chunk = timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("first pulled chunk should be delivered")
            .expect("ota command channel should stay open");
        let first_ack = match first_chunk {
            crate::ota::Command::PulledChunk { chunk, ack, .. } => {
                assert_eq!(chunk.update_id, "pull-test-update");
                assert_eq!(chunk.offset, 0);
                assert_eq!(chunk.bytes, package[..OTA_MAX_PULL_WINDOW_SIZE]);
                assert!(!chunk.last);
                ack
            }
            other => panic!("expected pulled chunk, got {other:?}"),
        };

        assert!(
            timeout(Duration::from_millis(50), session_rx.recv())
                .await
                .is_err(),
            "daemon must wait for actor ack before requesting the next OTA chunk"
        );
        first_ack
            .send(Ok(()))
            .expect("ack receiver should be alive");

        let second_call = timeout(Duration::from_secs(1), session_rx.recv())
            .await
            .expect("second transfer request should be sent after ack")
            .expect("session should stay open");
        let second_id = second_call.id.clone();
        assert_eq!(second_call.priority, AppMessagePriority::Bulk);
        match decode_single_chunk_call(&second_call) {
            MsgPackMessage::Call { method, params, .. } => {
                assert_eq!(method, "device.ota.transfer");
                assert_eq!(
                    params["offset"],
                    serde_json::json!(OTA_MAX_PULL_WINDOW_SIZE as u64)
                );
                assert_eq!(params["size"], serde_json::json!(OTA_MAX_PULL_WINDOW_SIZE));
            }
            other => panic!("expected transfer call, got {other:?}"),
        }

        answer_transfer_call(
            &pending_calls,
            &second_id,
            package[OTA_MAX_PULL_WINDOW_SIZE..OTA_MAX_PULL_WINDOW_SIZE * 2].to_vec(),
        )
        .await;
        let second_chunk = timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("second pulled chunk should be delivered")
            .expect("ota command channel should stay open");
        match second_chunk {
            crate::ota::Command::PulledChunk { chunk, ack, .. } => {
                assert_eq!(chunk.offset, OTA_MAX_PULL_WINDOW_SIZE as u32);
                assert_eq!(
                    chunk.bytes,
                    package[OTA_MAX_PULL_WINDOW_SIZE..OTA_MAX_PULL_WINDOW_SIZE * 2]
                );
                assert!(!chunk.last);
                ack.send(Ok(())).expect("ack receiver should be alive");
            }
            other => panic!("expected pulled chunk, got {other:?}"),
        }

        let final_call = timeout(Duration::from_secs(1), session_rx.recv())
            .await
            .expect("final transfer request should be sent")
            .expect("session should stay open");
        let final_id = final_call.id.clone();
        assert_eq!(final_call.priority, AppMessagePriority::Bulk);
        match decode_single_chunk_call(&final_call) {
            MsgPackMessage::Call { method, params, .. } => {
                assert_eq!(method, "device.ota.transfer");
                assert_eq!(
                    params["offset"],
                    serde_json::json!((OTA_MAX_PULL_WINDOW_SIZE * 2) as u64)
                );
                assert_eq!(params["size"], serde_json::json!(1_usize));
            }
            other => panic!("expected transfer call, got {other:?}"),
        }
        answer_transfer_call(
            &pending_calls,
            &final_id,
            package[OTA_MAX_PULL_WINDOW_SIZE * 2..].to_vec(),
        )
        .await;

        let final_chunk = timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("final pulled chunk should be delivered")
            .expect("ota command channel should stay open");
        match final_chunk {
            crate::ota::Command::PulledChunk { chunk, ack, .. } => {
                assert_eq!(chunk.offset, (OTA_MAX_PULL_WINDOW_SIZE * 2) as u32);
                assert_eq!(chunk.bytes, package[OTA_MAX_PULL_WINDOW_SIZE * 2..]);
                assert!(chunk.last);
                ack.send(Ok(())).expect("ack receiver should be alive");
            }
            other => panic!("expected pulled chunk, got {other:?}"),
        }

        transfer_task
            .await
            .expect("transfer task should not panic")
            .expect("transfer should complete");
    }

    #[tokio::test]
    async fn pull_ota_chunks_uses_latest_session_route_after_reconnect() {
        let (first_tx, mut first_rx) = mpsc::unbounded_channel();
        let (second_tx, mut second_rx) = mpsc::unbounded_channel();
        let session_route = Arc::new(Mutex::new(Some(AppSessionRoute {
            tx: first_tx,
            session_id: 1,
        })));
        let pending_calls = Arc::new(Mutex::new(HashMap::new()));
        let (cmd_tx, mut cmd_rx) = mpsc::channel(2);
        let package: Vec<u8> = (0..(OTA_MAX_PULL_WINDOW_SIZE + 1))
            .map(|idx| (idx % 251) as u8)
            .collect();
        let ready = libnocturne::gateway::OtaPackageReady {
            update_id: "route-swap-update".to_string(),
            version: "9.9.9".to_string(),
            size: package.len() as u32,
            expected_sha256: "a".repeat(64),
            resume_from_offset: 0,
            max_transfer_chunk_size: Some(OTA_MAX_PULL_WINDOW_SIZE as u32),
            supports_chunked_transfer_response: Some(true),
            transfer_data_encoding: Some("msgpack_binary".into()),
        };

        let transfer_task = tokio::spawn(pull_ota_chunks_inner(
            Arc::clone(&session_route),
            Arc::clone(&pending_calls),
            cmd_tx,
            test_ota_source(),
            ready,
            OTA_MAX_PULL_WINDOW_SIZE as u32,
        ));

        let first_call = timeout(Duration::from_secs(1), first_rx.recv())
            .await
            .expect("first session should receive first request")
            .expect("first session should stay open");
        assert_eq!(first_call.session_id, 1);
        let first_id = first_call.id.clone();

        answer_transfer_call(
            &pending_calls,
            &first_id,
            package[..OTA_MAX_PULL_WINDOW_SIZE].to_vec(),
        )
        .await;

        let first_chunk = timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("first pulled chunk should be delivered")
            .expect("ota command channel should stay open");
        match first_chunk {
            crate::ota::Command::PulledChunk { ack, .. } => {
                *session_route.lock().await = Some(AppSessionRoute {
                    tx: second_tx,
                    session_id: 2,
                });
                ack.send(Ok(())).expect("ack receiver should be alive");
            }
            other => panic!("expected pulled chunk, got {other:?}"),
        }

        let second_call = timeout(Duration::from_secs(1), second_rx.recv())
            .await
            .expect("second session should receive request after route swap")
            .expect("second session should stay open");
        assert_eq!(second_call.session_id, 2);
        assert!(
            first_rx.try_recv().is_err(),
            "stale session must not receive requests after route swap"
        );
        let second_id = second_call.id.clone();

        answer_transfer_call(
            &pending_calls,
            &second_id,
            package[OTA_MAX_PULL_WINDOW_SIZE..].to_vec(),
        )
        .await;

        let final_chunk = timeout(Duration::from_secs(1), cmd_rx.recv())
            .await
            .expect("final pulled chunk should be delivered")
            .expect("ota command channel should stay open");
        match final_chunk {
            crate::ota::Command::PulledChunk { chunk, ack, .. } => {
                assert_eq!(chunk.offset, OTA_MAX_PULL_WINDOW_SIZE as u32);
                assert!(chunk.last);
                ack.send(Ok(())).expect("ack receiver should be alive");
            }
            other => panic!("expected pulled chunk, got {other:?}"),
        }

        transfer_task
            .await
            .expect("transfer task should not panic")
            .expect("transfer should complete");
    }
}
