use crate::image_cache::ImageCache;
use crate::websocket::WebSocketServer;
use crate::{app::AppMessage, error::Result};
use base64::{engine::general_purpose, Engine as _};
use bytes::{Buf, BufMut, Bytes, BytesMut};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, error, info, warn};

type CallHandler = Box<dyn Fn(&serde_json::Value) -> serde_json::Value + Send + Sync>;

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
const OTA_CHUNK_SIZE: usize = 1800;
const MSGPACK_PROTOCOL: &str = "com.usenocturne.daemon";
const MAX_INBOUND_BUFFER: usize = 256 * 1024;

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
    MsgPackMessage::Event {
        topic: "audio.data".to_string(),
        data: serde_json::json!({
            "seq": seq,
            "opus": general_purpose::STANDARD.encode(opus_data),
            "ts": timestamp_ms,
        }),
    }
}

pub fn create_audio_lifecycle_event(topic: &str, data: serde_json::Value) -> MsgPackMessage {
    MsgPackMessage::Event {
        topic: topic.to_string(),
        data,
    }
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

#[allow(dead_code)]
#[derive(Debug, Clone)]
struct OtaPackageInfo {
    name: String,
    version: String,
    hash: String,
    size: u64,
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
    ota_file_chunks: HashMap<String, Vec<Option<Vec<u8>>>>,
    ota_package_info: Option<OtaPackageInfo>,
    pending_calls: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
    session_tx: Option<Arc<Mutex<tokio::sync::mpsc::UnboundedSender<crate::app::AppMessage>>>>,
    session_id: Option<u8>,
    app_ready_received: Arc<AtomicBool>,
    hid_tx: Option<tokio::sync::mpsc::UnboundedSender<iap2_rs::HidCommand>>,
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
            ota_file_chunks: HashMap::new(),
            ota_package_info: None,
            pending_calls: Arc::new(Mutex::new(HashMap::new())),
            session_tx: None,
            session_id: None,
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
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
            ota_file_chunks: HashMap::new(),
            ota_package_info: None,
            pending_calls: Arc::new(Mutex::new(HashMap::new())),
            session_tx: None,
            session_id: None,
            app_ready_received: Arc::new(AtomicBool::new(false)),
            hid_tx: None,
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
                serde_json::to_value(crate::config::collect_device_info_metadata()).unwrap_or_else(
                    |_| {
                        serde_json::json!({
                            "device": "Nocturne",
                            "version": "unknown"
                        })
                    },
                )
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
                } else {
                    if rmp_serde::from_slice::<MsgPackMessage>(buffer).is_ok() {
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

                if method.starts_with("media.control.") {
                    let cmd = crate::app::hid_mapping::method_to_hid_command(&method);
                    return Ok(Some(match cmd {
                        Some(cmd) => match &self.hid_tx {
                            Some(tx) => match tx.send(cmd) {
                                Ok(()) => MsgPackMessage::Result {
                                    id,
                                    result: serde_json::json!({"status":"ok"}),
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
                    let volume_percent = params
                        .get("volumePercent")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);

                    info!("Received phone volume update: {}%", volume_percent);

                    if let Some(ws_server) = &self.websocket_server {
                        let volume_data = serde_json::json!({
                            "volumePercent": volume_percent
                        });

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
                        result: serde_json::json!({ "success": true }),
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
                    match method.as_str() {
                        "device.time.get" => {
                            if let Some(datetime_str) =
                                result.get("datetime").and_then(|v| v.as_str())
                            {
                                info!("Setting system datetime to: {}", datetime_str);
                                let datetime_str = datetime_str.to_string();
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
                        "device.ota.download" => {
                            info!("Received OTA download response (new pull-based approach, no action needed)");
                        }
                        _ => {}
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
                } else if topic == "device.ota.package_state" {
                    if let Err(e) = self.handle_package_state(&data).await {
                        error!("Failed to handle OTA package state: {}", e);
                    }
                    return Ok(None);
                } else if topic == "device.ota.chunk" {
                    if let Err(e) = self.handle_ota_chunk(&data).await {
                        error!("Failed to handle OTA chunk: {}", e);
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        let chunk_index = data
                            .get("chunk_index")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let total_chunks = data
                            .get("total_chunks")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0);
                        let file_name = data
                            .get("file_name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");

                        let progress_data = serde_json::json!({
                            "chunk_index": chunk_index,
                            "total_chunks": total_chunks,
                            "file_name": file_name
                        });

                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            async move {
                                ws_server
                                    .broadcast_event(
                                        "device.ota.progress".to_string(),
                                        progress_data,
                                    )
                                    .await;
                            }
                        });
                    }
                    return Ok(None);
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
                    if let Some(status) = data.get("subscriptionStatus").and_then(|v| v.as_str()) {
                        info!("Subscription tier from app.ready: {}", status);
                    }
                    if let Some(has_lifetime) = data.get("hasLifetime").and_then(|v| v.as_bool()) {
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
                    if let Some(has_lifetime) = data.get("hasLifetime").and_then(|v| v.as_bool()) {
                        info!("Lifetime entitlement updated: {}", has_lifetime);
                    }
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

                let data = if topic == "media.nowPlaying.update" {
                    let mut d = data;
                    if let Some(attrs) = d.get_mut("MediaItemAttributes") {
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
            let retransmit_data = serde_json::json!({
                "message_id": message_id,
                "chunk_idx": chunk_idx
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

    #[allow(dead_code)]
    async fn handle_ota_download_result(&mut self, result: &serde_json::Value) -> Result<()> {
        let file_name = result
            .get("fileName")
            .and_then(|v| v.as_str())
            .unwrap_or("nocturne-update.swu");

        let file_data_base64 = result
            .get("data")
            .and_then(|v| v.as_str())
            .ok_or_else(|| crate::error::NocturnedError::Config("Missing file data".into()))?;

        let file_size = result.get("size").and_then(|v| v.as_u64()).unwrap_or(0) as usize;

        info!("Decoding OTA file {} ({} bytes)", file_name, file_size);

        let file_data = base64::engine::general_purpose::STANDARD
            .decode(file_data_base64)
            .map_err(|e| {
                crate::error::NocturnedError::Config(format!("Failed to decode base64: {}", e))
            })?;

        info!("Decoded OTA file: {} bytes", file_data.len());

        let file_path = format!("/tmp/{}", file_name);
        tokio::fs::write(&file_path, &file_data)
            .await
            .map_err(|e| {
                crate::error::NocturnedError::Config(format!("Failed to write OTA file: {}", e))
            })?;

        info!(
            "OTA file written successfully: {} ({} bytes)",
            file_path,
            file_data.len()
        );

        if let Some(ws_server) = &self.websocket_server {
            tokio::spawn({
                let ws_server = Arc::clone(ws_server);
                let event_data = serde_json::json!({
                    "status": "complete",
                    "file_path": file_path,
                    "size": file_data.len()
                });
                async move {
                    ws_server
                        .broadcast_event("device.ota.complete".to_string(), event_data)
                        .await;
                }
            });
        }

        Ok(())
    }

    async fn handle_ota_chunk(&mut self, data: &serde_json::Value) -> Result<()> {
        let chunk_index = data
            .get("chunk_index")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| crate::error::NocturnedError::Config("Missing chunk_index".into()))?
            as usize;

        let total_chunks = data
            .get("total_chunks")
            .and_then(|v| v.as_u64())
            .ok_or_else(|| crate::error::NocturnedError::Config("Missing total_chunks".into()))?
            as usize;

        let chunk_data_base64 = data
            .get("data")
            .and_then(|v| v.as_str())
            .ok_or_else(|| crate::error::NocturnedError::Config("Missing chunk data".into()))?;

        let file_name = data
            .get("file_name")
            .and_then(|v| v.as_str())
            .unwrap_or("nocturne-update.swu");

        let chunk_data = base64::engine::general_purpose::STANDARD
            .decode(chunk_data_base64)
            .map_err(|e| {
                crate::error::NocturnedError::Config(format!("Failed to decode base64: {}", e))
            })?;

        info!(
            "Received OTA chunk {}/{} ({} bytes) for {}",
            chunk_index + 1,
            total_chunks,
            chunk_data.len(),
            file_name
        );

        let chunks = self
            .ota_file_chunks
            .entry(file_name.to_string())
            .or_insert_with(|| vec![None; total_chunks]);

        if chunk_index < chunks.len() {
            if chunks[chunk_index].is_some() {
                warn!(
                    "Duplicate chunk received: index {} already exists, overwriting",
                    chunk_index
                );
            }
            chunks[chunk_index] = Some(chunk_data);
        } else {
            error!("Invalid chunk index: {} >= {}", chunk_index, chunks.len());
            return Ok(());
        }

        let received_count = chunks.iter().filter(|c| c.is_some()).count();
        let missing_chunks: Vec<usize> = chunks
            .iter()
            .enumerate()
            .filter_map(|(i, c)| if c.is_none() { Some(i) } else { None })
            .collect();

        if !missing_chunks.is_empty() {
            info!(
                "OTA progress: {}/{} chunks received for {} (missing: {:?})",
                received_count, total_chunks, file_name, missing_chunks
            );
        } else {
            info!(
                "OTA progress: {}/{} chunks received for {}",
                received_count, total_chunks, file_name
            );
        }

        if received_count == total_chunks {
            info!(
                "All {} OTA chunks received for {}, assembling file",
                total_chunks, file_name
            );

            let mut complete_file = Vec::new();
            for data in chunks.iter().flatten() {
                complete_file.extend_from_slice(data);
            }

            let file_path = format!("/tmp/{}", file_name);
            tokio::fs::write(&file_path, &complete_file)
                .await
                .map_err(|e| {
                    crate::error::NocturnedError::Config(format!("Failed to write OTA file: {}", e))
                })?;

            info!(
                "OTA file written successfully: {} ({} bytes)",
                file_path,
                complete_file.len()
            );

            self.ota_file_chunks.remove(file_name);

            if let Some(ws_server) = &self.websocket_server {
                tokio::spawn({
                    let ws_server = Arc::clone(ws_server);
                    let event_data = serde_json::json!({
                        "status": "complete",
                        "file_path": file_path,
                        "size": complete_file.len()
                    });
                    async move {
                        ws_server
                            .broadcast_event("device.ota.complete".to_string(), event_data)
                            .await;
                    }
                });
            }
        }

        Ok(())
    }

    #[allow(dead_code)]
    async fn call_method(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let message_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = tokio::sync::oneshot::channel();

        {
            let mut pending_calls = self.pending_calls.lock().await;
            pending_calls.insert(message_id.clone(), tx);
        }

        let message = MsgPackMessage::Call {
            id: message_id.clone(),
            method: method.to_string(),
            params,
        };

        let serialized = rmp_serde::to_vec_named(&message).map_err(|e| {
            crate::error::NocturnedError::Config(format!("Failed to serialize message: {}", e))
        })?;

        info!("Calling method {} with id {}", method, message_id);

        let chunks = Self::create_chunks(&serialized)?;

        if let (Some(session_tx), Some(session_id)) = (&self.session_tx, self.session_id) {
            let session_tx = session_tx.lock().await;
            for chunk in chunks {
                let app_message = crate::app::AppMessage {
                    id: message_id.clone(),
                    protocol: MSGPACK_PROTOCOL.to_string(),
                    session_id,
                    data: chunk,
                };
                session_tx.send(app_message).map_err(|e| {
                    crate::error::NocturnedError::Config(format!("Failed to send message: {}", e))
                })?;
            }
        } else {
            return Err(crate::error::NocturnedError::Config(
                "Session not initialized".into(),
            ));
        }

        let result = rx.await.map_err(|_| {
            crate::error::NocturnedError::Config("Method call timeout or cancelled".into())
        })?;

        Ok(result)
    }

    async fn handle_package_state(&mut self, data: &serde_json::Value) -> Result<()> {
        let state = data
            .get("state")
            .and_then(|v| v.as_str())
            .ok_or_else(|| crate::error::NocturnedError::Config("Missing state".into()))?;

        info!("Received package state: {}", state);

        if state == "download_success" {
            let name = data
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("nocturne-os")
                .to_string();

            let version = data
                .get("version")
                .and_then(|v| v.as_str())
                .ok_or_else(|| crate::error::NocturnedError::Config("Missing version".into()))?
                .to_string();

            let hash = data
                .get("hash")
                .and_then(|v| v.as_str())
                .ok_or_else(|| crate::error::NocturnedError::Config("Missing hash".into()))?
                .to_string();

            let size = data
                .get("size")
                .and_then(|v| v.as_u64())
                .ok_or_else(|| crate::error::NocturnedError::Config("Missing size".into()))?;

            info!(
                "OTA package ready: {} version {} ({} bytes, MD5: {})",
                name, version, size, hash
            );

            self.ota_package_info = Some(OtaPackageInfo {
                name: name.clone(),
                version: version.clone(),
                hash: hash.clone(),
                size,
            });

            info!("Starting OTA chunk download in background task");

            let session_tx = self.session_tx.clone();
            let session_id = self.session_id;
            let ws_server = self.websocket_server.clone();
            let pending_calls = Arc::clone(&self.pending_calls);

            tokio::spawn(async move {
                if let Err(e) = Self::download_ota_chunks_task(
                    session_tx,
                    session_id,
                    ws_server,
                    pending_calls,
                    name,
                    version,
                    hash,
                    size,
                )
                .await
                {
                    error!("OTA chunk download failed: {}", e);
                }
            });
        }

        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn download_ota_chunks_task(
        session_tx: Option<Arc<Mutex<tokio::sync::mpsc::UnboundedSender<crate::app::AppMessage>>>>,
        session_id: Option<u8>,
        ws_server: Option<Arc<WebSocketServer>>,
        pending_calls: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>>,
        name: String,
        version: String,
        expected_hash: String,
        total_size: u64,
    ) -> Result<()> {
        let total_chunks = total_size.div_ceil(OTA_CHUNK_SIZE as u64) as usize;
        let file_path = "/tmp/nocturne-update.swu";

        info!(
            "Downloading {} chunks ({} bytes total) for {}",
            total_chunks, total_size, name
        );

        let mut file_data = Vec::with_capacity(total_size as usize);

        for chunk_idx in 0..total_chunks {
            let offset = chunk_idx * OTA_CHUNK_SIZE;
            let size = std::cmp::min(OTA_CHUNK_SIZE, (total_size as usize) - offset);

            info!(
                "Requesting chunk {}/{} (offset={}, size={})",
                chunk_idx + 1,
                total_chunks,
                offset,
                size
            );

            let params = serde_json::json!({
                "name": name,
                "offset": offset,
                "size": size,
                "version": version
            });

            let result = Self::call_method_static(
                &session_tx,
                session_id,
                &pending_calls,
                "device.ota.transfer",
                params,
            )
            .await?;

            let chunk_bytes = if let Some(data_value) = result.get("data") {
                if let Some(bytes_array) = data_value.as_array() {
                    let mut bytes = Vec::with_capacity(bytes_array.len());
                    for v in bytes_array {
                        if let Some(n) = v.as_u64() {
                            bytes.push(n as u8);
                        } else {
                            return Err(crate::error::NocturnedError::Config(
                                "Invalid byte value in chunk data array".into(),
                            ));
                        }
                    }
                    bytes
                } else if let Some(bytes_str) = data_value.as_str() {
                    base64::engine::general_purpose::STANDARD
                        .decode(bytes_str)
                        .map_err(|e| {
                            crate::error::NocturnedError::Config(format!(
                                "Failed to decode base64 chunk: {}",
                                e
                            ))
                        })?
                } else {
                    return Err(crate::error::NocturnedError::Config(
                        "Chunk data is neither array nor string".into(),
                    ));
                }
            } else {
                return Err(crate::error::NocturnedError::Config(
                    "Missing chunk data in response".into(),
                ));
            };

            if chunk_bytes.len() != size {
                return Err(crate::error::NocturnedError::Config(format!(
                    "Chunk size mismatch: expected {}, got {}",
                    size,
                    chunk_bytes.len()
                )));
            }

            file_data.extend_from_slice(&chunk_bytes);

            if let Some(ws) = &ws_server {
                let progress_data = serde_json::json!({
                    "chunk_index": chunk_idx,
                    "total_chunks": total_chunks,
                    "percent": (chunk_idx * 100 / total_chunks)
                });

                tokio::spawn({
                    let ws_server = Arc::clone(ws);
                    async move {
                        ws_server
                            .broadcast_event("device.ota.progress".to_string(), progress_data)
                            .await;
                    }
                });
            }
        }

        info!("All chunks downloaded, verifying MD5 hash");

        let actual_hash = Self::compute_md5(&file_data);

        if actual_hash != expected_hash {
            error!(
                "MD5 hash mismatch! Expected: {}, Actual: {}",
                expected_hash, actual_hash
            );

            if let Some(ws) = &ws_server {
                let error_data = serde_json::json!({
                    "message": "MD5 hash mismatch",
                    "expected": expected_hash,
                    "actual": actual_hash
                });

                tokio::spawn({
                    let ws_server = Arc::clone(ws);
                    async move {
                        ws_server
                            .broadcast_event("device.ota.error".to_string(), error_data)
                            .await;
                    }
                });
            }

            return Err(crate::error::NocturnedError::Config(
                "MD5 hash verification failed".into(),
            ));
        }

        info!("MD5 hash verified successfully: {}", actual_hash);

        tokio::fs::write(file_path, &file_data).await.map_err(|e| {
            crate::error::NocturnedError::Config(format!("Failed to write OTA file: {}", e))
        })?;

        info!(
            "OTA file written successfully: {} ({} bytes)",
            file_path,
            file_data.len()
        );

        if let Some(ws) = &ws_server {
            let event_data = serde_json::json!({
                "status": "complete",
                "file_path": file_path,
                "size": file_data.len()
            });

            tokio::spawn({
                let ws_server = Arc::clone(ws);
                async move {
                    ws_server
                        .broadcast_event("device.ota.complete".to_string(), event_data)
                        .await;
                }
            });
        }

        Ok(())
    }

    async fn call_method_static(
        session_tx: &Option<Arc<Mutex<tokio::sync::mpsc::UnboundedSender<crate::app::AppMessage>>>>,
        session_id: Option<u8>,
        pending_calls: &Arc<
            Mutex<HashMap<String, tokio::sync::oneshot::Sender<serde_json::Value>>>,
        >,
        method: &str,
        params: serde_json::Value,
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

        let serialized = rmp_serde::to_vec_named(&message).map_err(|e| {
            crate::error::NocturnedError::Config(format!("Failed to serialize message: {}", e))
        })?;

        info!("Calling method {} with id {}", method, message_id);

        let chunks = Self::create_chunks(&serialized)?;

        if let (Some(tx), Some(sid)) = (session_tx, session_id) {
            let session_tx = tx.lock().await;
            for chunk in chunks {
                let app_message = crate::app::AppMessage {
                    id: message_id.clone(),
                    protocol: MSGPACK_PROTOCOL.to_string(),
                    session_id: sid,
                    data: chunk,
                };
                session_tx.send(app_message).map_err(|e| {
                    crate::error::NocturnedError::Config(format!("Failed to send message: {}", e))
                })?;
            }
        } else {
            return Err(crate::error::NocturnedError::Config(
                "Session not initialized".into(),
            ));
        }

        let result = rx.await.map_err(|_| {
            crate::error::NocturnedError::Config("Method call timeout or cancelled".into())
        })?;

        Ok(result)
    }

    fn compute_md5(data: &[u8]) -> String {
        let digest = md5::compute(data);
        format!("{:x}", digest)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_audio_data_event, create_audio_lifecycle_event, MsgPackMessage,
        MsgPackProtocolHandler,
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
        let event = create_audio_lifecycle_event(
            "audio.recording.started",
            serde_json::json!({
                "sample_rate": 16000,
                "channels": 1,
                "frame_ms": 20,
            }),
        );

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
        let event = create_audio_lifecycle_event(
            "audio.recording.stopped",
            serde_json::json!({
                "reason": "user_requested",
                "total_frames": 128_u64,
            }),
        );

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
}
