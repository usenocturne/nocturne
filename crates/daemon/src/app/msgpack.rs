use crate::hardware::ImageCache;
use crate::http::WebSocketServer;
use crate::{app::AppMessage, error::Result};
use base64::{engine::general_purpose, Engine as _};
use bluer::Address;
use bytes::{Buf, BufMut, Bytes, BytesMut};
use libnocturne::gateway::{OtaAbandon, OtaAssetRangeChunk, OtaBegin, OtaChunk};
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
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, error, info, warn};

type JsonValue = serde_json::Value;
type CallHandler = Box<dyn Fn(&JsonValue) -> JsonValue + Send + Sync>;

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

const CHUNK_SIZE: usize = 2000;
const MSGPACK_PROTOCOL: &str = "com.usenocturne.daemon";
const MAX_INBOUND_BUFFER: usize = 256 * 1024;

fn media_control_payload<T: serde::Serialize>(payload: T) -> serde_json::Value {
    serde_json::to_value(payload).expect("generated media_control payload must serialize")
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
    let event = serde_json::from_value::<AppReadyEvent>(data.clone()).unwrap_or(AppReadyEvent {
        datetime: string_field(&data, "datetime", "datetime"),
        timezone: data.get("timezone").cloned(),
        platform: string_field(&data, "platform", "platform"),
        subscribed: bool_field(&data, "subscribed", "subscribed"),
        subscription_status: string_field(&data, "subscription_status", "subscriptionStatus"),
        has_lifetime: bool_field(&data, "has_lifetime", "hasLifetime"),
        spotify_skipped: bool_field(&data, "spotify_skipped", "spotifySkipped"),
    });
    bt_only_payload(event)
}

fn normalize_entitlement_update_event(data: serde_json::Value) -> serde_json::Value {
    let event = serde_json::from_value::<SubscriptionUpdatedEvent>(data.clone()).unwrap_or(
        SubscriptionUpdatedEvent {
            subscribed: bool_field(&data, "subscribed", "subscribed"),
            subscription_status: string_field(&data, "subscription_status", "subscriptionStatus"),
            has_lifetime: bool_field(&data, "has_lifetime", "hasLifetime"),
        },
    );
    bt_only_payload(event)
}

fn normalize_notification_show_event(data: serde_json::Value) -> serde_json::Value {
    let event = serde_json::from_value::<NotificationShowEvent>(data.clone()).unwrap_or(
        NotificationShowEvent {
            id: string_field(&data, "id", "id"),
            title: string_field(&data, "title", "title").unwrap_or_default(),
            body: string_field(&data, "body", "body"),
            category: string_field(&data, "category", "category"),
            days_until_expiry: i64_field(&data, "days_until_expiry", "daysUntilExpiry"),
            timestamp: u64_field(&data, "timestamp", "timestamp"),
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

fn voice_payload<T: serde::Serialize>(payload: T) -> JsonValue {
    serde_json::to_value(payload).expect("generated voice payload must serialize")
}

fn normalize_voice_event(topic: String, data: JsonValue) -> (String, JsonValue) {
    match topic.as_str() {
        "voice.transcription" => {
            let event = serde_json::from_value::<VoiceTranscriptionEvent>(data.clone())
                .unwrap_or_else(|_| VoiceTranscriptionEvent {
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
                });
            (topic, voice_payload(event))
        }
        "ai.state" => {
            let event = serde_json::from_value::<AiStateEvent>(data.clone()).unwrap_or_else(|_| {
                AiStateEvent {
                    state: data
                        .get("state")
                        .and_then(|value| value.as_str())
                        .unwrap_or("idle")
                        .to_string(),
                    message: data
                        .get("message")
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                }
            });
            (topic, voice_payload(event))
        }
        "ai.response" => {
            let event =
                serde_json::from_value::<AiResponseEvent>(data.clone()).unwrap_or_else(|_| {
                    AiResponseEvent {
                        message: data
                            .get("message")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                        text: data
                            .get("text")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    }
                });
            (topic, voice_payload(event))
        }
        "ai.tool_executed" => {
            let event =
                serde_json::from_value::<AiToolExecutedEvent>(data.clone()).unwrap_or_else(|_| {
                    AiToolExecutedEvent {
                        tool_name: data
                            .get("tool_name")
                            .or_else(|| data.get("toolName"))
                            .or_else(|| data.get("tool"))
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                        result: data.get("result").cloned(),
                        error: data
                            .get("error")
                            .and_then(|value| value.as_str())
                            .map(str::to_string),
                    }
                });
            (topic, voice_payload(event))
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

fn normalize_media_control_event(
    topic: String,
    data: serde_json::Value,
) -> (String, serde_json::Value) {
    match topic.as_str() {
        "media.nowPlaying.update" | "media.now_playing.update" => {
            let event = serde_json::from_value::<MediaNowPlayingUpdateEvent>(data.clone())
                .unwrap_or_else(|_| MediaNowPlayingUpdateEvent {
                    media_item_attributes: data.get("MediaItemAttributes").cloned(),
                    playback_attributes: data.get("PlaybackAttributes").cloned(),
                });
            (
                "media.now_playing.update".to_string(),
                media_control_payload(event),
            )
        }
        "media.nowPlaying.artwork" | "media.now_playing.artwork" => {
            let event = serde_json::from_value::<MediaNowPlayingArtworkEvent>(data.clone())
                .unwrap_or_else(|_| MediaNowPlayingArtworkEvent {
                    data: data
                        .get("data")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    content_type: data
                        .get("contentType")
                        .or_else(|| data.get("content_type"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("image/jpeg")
                        .to_string(),
                });
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
    session_tx: Option<Arc<Mutex<tokio::sync::mpsc::UnboundedSender<crate::app::AppMessage>>>>,
    session_id: Option<u8>,
    app_ready_received: Arc<AtomicBool>,
    hid_tx: Option<tokio::sync::mpsc::UnboundedSender<iap2_rs::HidCommand>>,
    ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    ota_peer: Option<Address>,
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
            session_tx: None,
            session_id: None,
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
            ota_cmd_tx: None,
            ota_peer: None,
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
            session_tx: None,
            session_id: None,
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
            ota_cmd_tx: None,
            ota_peer: None,
        };

        handler.register_default_handlers();
        handler
    }

    pub fn app_ready_flag(&self) -> Arc<AtomicBool> {
        self.app_ready_received.clone()
    }

    pub fn set_session_info(
        &mut self,
        session_tx: tokio::sync::mpsc::UnboundedSender<crate::app::AppMessage>,
        session_id: u8,
    ) {
        self.session_tx = Some(Arc::new(Mutex::new(session_tx)));
        self.session_id = Some(session_id);
    }

    pub fn set_hid_tx(&mut self, sender: tokio::sync::mpsc::UnboundedSender<iap2_rs::HidCommand>) {
        self.hid_tx = Some(sender);
    }

    pub fn set_ota_cmd_tx(&mut self, sender: mpsc::Sender<crate::ota::Command>) {
        self.ota_cmd_tx = Some(sender);
    }

    pub fn set_ota_peer(&mut self, peer: Address) {
        self.ota_peer = Some(peer);
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
                let (ack, rx) = oneshot::channel();
                cmd_tx
                    .send(crate::ota::Command::Begin {
                        req,
                        peer: self.ota_peer,
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
                cmd_tx
                    .send(crate::ota::Command::Chunk(chunk))
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.asset_range_chunk" | "system.ota.asset_range_chunk" => {
                let chunk: OtaAssetRangeChunk =
                    serde_json::from_value(params.clone()).map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAssetRangeChunk payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::AssetRangeChunk(chunk))
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.abandon" | "system.ota.abandon" => {
                let abandon: OtaAbandon =
                    serde_json::from_value(params.clone()).map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "invalid OtaAbandon payload: {err}"
                        ))
                    })?;
                cmd_tx
                    .send(crate::ota::Command::Abandon {
                        update_id: abandon.update_id,
                    })
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
            }
            "ota.cancel" | "system.ota.cancel" => {
                cmd_tx
                    .send(crate::ota::Command::Cancel)
                    .await
                    .map_err(|err| {
                        crate::error::NocturnedError::Config(format!(
                            "ota actor mailbox closed: {err}"
                        ))
                    })?;
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
            debug!("Single chunk message, returning payload directly");
            return Ok(Some(chunk_data));
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
            });

        chunked_msg
            .received_chunks
            .insert(chunk_idx, chunk_data.clone());
        chunked_msg.complete_size += chunk_data.len();

        info!(
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

            info!(
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
                    ws_server.broadcast_event(topic, data).await;
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
        if self.session_id.is_none() {
            self.session_id = Some(message.session_id);
        }

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
                if let Some(sess_tx) = &self.session_tx {
                    let sess_tx = sess_tx.lock().await;
                    if let Err(e) = sess_tx.send(extra) {
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

                if let Ok(rmpv_value) = rmpv::decode::read_value(&mut &complete_data[..]) {
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

        if let Some(ws_server) = &self.websocket_server {
            let retransmit_data = bt_only_payload(ChunkRetransmitRequestEvent {
                message_id: message_id.to_string(),
                chunk_idx,
            });

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
    use libnocturne::generated::bt_only::{AudioRecordingStartedEvent, AudioRecordingStoppedEvent};

    use super::{
        create_audio_data_event, create_audio_recording_started_event,
        create_audio_recording_stopped_event, MsgPackMessage, MsgPackProtocolHandler,
    };

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
            crate::ota::Command::AssetRangeChunk(chunk) => {
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
    async fn ota_begin_call_preserves_source_peer() {
        let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel(1);
        let mut handler = MsgPackProtocolHandler::new(None);
        handler.set_ota_cmd_tx(cmd_tx);
        let peer: bluer::Address = "00:11:22:33:44:55".parse().unwrap();
        handler.set_ota_peer(peer);

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
                peer: actual, ack, ..
            } => {
                assert_eq!(actual, Some(peer));
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
}
