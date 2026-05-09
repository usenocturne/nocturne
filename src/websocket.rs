use crate::ab;
use crate::app::AppMessage;
use crate::error::Result;
use crate::image_cache::ImageCache;
use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex, RwLock};
use tokio_tungstenite::{accept_async, tungstenite::Message, WebSocketStream};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum WebSocketMessage {
    #[serde(rename = "request")]
    Request {
        id: String,
        method: String,
        params: serde_json::Value,
    },
    #[serde(rename = "response")]
    Response {
        id: String,
        result: serde_json::Value,
    },
    #[serde(rename = "error")]
    Error { id: String, error: String },
    #[serde(rename = "event")]
    Event {
        topic: String,
        data: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        server_timestamp_ms: Option<u128>,
    },
}

pub struct WebSocketConnection {
    id: String,
    #[allow(dead_code)]
    addr: SocketAddr,
    tx: mpsc::UnboundedSender<WebSocketMessage>,
}

pub struct WebSocketServer {
    connections: Arc<RwLock<HashMap<String, WebSocketConnection>>>,
    app_manager_tx: mpsc::UnboundedSender<AppMessage>,
    port: u16,
    image_cache: Arc<Mutex<ImageCache>>,
    pending_image_fetches: Arc<RwLock<HashSet<String>>>,
    last_app_ready: Arc<RwLock<Option<serde_json::Value>>>,
    last_wakeword_state: Arc<RwLock<Option<bool>>>,
}

impl WebSocketServer {
    pub fn new(
        app_manager_tx: mpsc::UnboundedSender<AppMessage>,
        port: u16,
        image_cache: Arc<Mutex<ImageCache>>,
    ) -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
            app_manager_tx,
            port,
            image_cache,
            pending_image_fetches: Arc::new(RwLock::new(HashSet::new())),
            last_app_ready: Arc::new(RwLock::new(None)),
            last_wakeword_state: Arc::new(RwLock::new(None)),
        }
    }

    pub fn image_cache(&self) -> Arc<Mutex<ImageCache>> {
        Arc::clone(&self.image_cache)
    }

    pub async fn update_last_wakeword_state(&self, muted: bool) {
        *self.last_wakeword_state.write().await = Some(muted);
        self.broadcast_event(
            "voice.wakeword.state".to_string(),
            serde_json::json!({ "muted": muted }),
        )
        .await;
    }

    pub async fn track_image_fetch(&self, request_id: String) {
        let mut pending = self.pending_image_fetches.write().await;
        pending.insert(request_id);
    }

    pub async fn untrack_image_fetch(&self, request_id: &str) {
        let mut pending = self.pending_image_fetches.write().await;
        pending.remove(request_id);
    }

    pub async fn cancel_all_pending_image_fetches(&self) {
        let pending_ids: Vec<String> = {
            let mut pending = self.pending_image_fetches.write().await;
            pending.drain().collect()
        };

        if pending_ids.is_empty() {
            return;
        }

        info!(
            "Cancelling {} pending image fetch request(s) due to artwork event",
            pending_ids.len()
        );

        let connections = self.connections.read().await;
        for request_id in pending_ids {
            let response = WebSocketMessage::Response {
                id: request_id.clone(),
                result: serde_json::json!({
                    "cancelled": true,
                    "reason": "artwork_event_received"
                }),
            };

            for conn in connections.values() {
                if let Err(e) = conn.tx.send(response.clone()) {
                    warn!(
                        "Failed to send cancelled response to WebSocket connection {}: {}",
                        conn.id, e
                    );
                }
            }

            debug!(
                "Sent cancelled response for image fetch request {}",
                request_id
            );
        }
    }

    pub async fn start(self: Arc<Self>) -> Result<()> {
        let listener = TcpListener::bind(format!("127.0.0.1:{}", self.port)).await?;
        info!("WebSocket server listening on port {}", self.port);

        while let Ok((stream, addr)) = listener.accept().await {
            let server = Arc::clone(&self);
            tokio::spawn(async move {
                if let Err(e) = server.handle_connection(stream, addr).await {
                    error!("WebSocket connection error from {}: {}", addr, e);
                }
            });
        }

        Ok(())
    }

    async fn handle_connection(&self, stream: TcpStream, addr: SocketAddr) -> Result<()> {
        let ws_stream = accept_async(stream).await?;
        let connection_id = Uuid::new_v4().to_string();

        info!(
            "WebSocket connection {} established from {}",
            connection_id, addr
        );

        let (tx, rx) = mpsc::unbounded_channel();

        let connection = WebSocketConnection {
            id: connection_id.clone(),
            addr,
            tx,
        };

        {
            let mut connections = self.connections.write().await;
            connections.insert(connection_id.clone(), connection);
        }

        if let Some(data) = self.last_app_ready.read().await.clone() {
            info!(
                "Replaying cached app.ready to new WebSocket client {}",
                connection_id
            );
            let connections = self.connections.read().await;
            if let Some(conn) = connections.get(&connection_id) {
                let _ = conn.tx.send(WebSocketMessage::Event {
                    topic: "app.ready".to_string(),
                    data,
                    server_timestamp_ms: None,
                });
            }
        }

        if let Some(muted) = *self.last_wakeword_state.read().await {
            debug!(
                "Replaying cached voice.wakeword.state to new WebSocket client {}",
                connection_id
            );
            let connections = self.connections.read().await;
            if let Some(conn) = connections.get(&connection_id) {
                let _ = conn.tx.send(WebSocketMessage::Event {
                    topic: "voice.wakeword.state".to_string(),
                    data: serde_json::json!({ "muted": muted }),
                    server_timestamp_ms: None,
                });
            }
        }

        let result = self
            .handle_websocket_messages(ws_stream, connection_id.clone(), rx)
            .await;

        {
            let mut connections = self.connections.write().await;
            connections.remove(&connection_id);
        }

        info!(
            "WebSocket connection {} from {} closed",
            connection_id, addr
        );
        result
    }

    async fn handle_websocket_messages(
        &self,
        ws_stream: WebSocketStream<TcpStream>,
        connection_id: String,
        mut outbound_rx: mpsc::UnboundedReceiver<WebSocketMessage>,
    ) -> Result<()> {
        let (mut ws_sender, mut ws_receiver) = ws_stream.split();

        loop {
            tokio::select! {
                msg = ws_receiver.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            if let Err(e) = self.handle_incoming_message(&text).await {
                                error!("Error handling WebSocket message: {}", e);
                                let error_msg = WebSocketMessage::Error {
                                    id: "unknown".to_string(),
                                    error: e.to_string(),
                                };
                                if let Ok(json) = serde_json::to_string(&error_msg) {
                                    let _ = ws_sender.send(Message::Text(json)).await;
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) => {
                            debug!("WebSocket connection {} closed by client", connection_id);
                            break;
                        }
                        Some(Err(e)) => {
                            warn!("WebSocket error on connection {}: {}", connection_id, e);
                            break;
                        }
                        None => {
                            debug!("WebSocket connection {} ended", connection_id);
                            break;
                        }
                        _ => {}
                    }
                }
                outbound_msg = outbound_rx.recv() => {
                    match outbound_msg {
                        Some(msg) => {
                            if let Ok(json) = serde_json::to_string(&msg) {
                                if let Err(e) = ws_sender.send(Message::Text(json)).await {
                                    warn!("Failed to send WebSocket message: {}", e);
                                    break;
                                }
                            }
                        }
                        None => break,
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_incoming_message(&self, text: &str) -> Result<()> {
        let ws_msg: WebSocketMessage = serde_json::from_str(text)?;

        match ws_msg {
            WebSocketMessage::Request { id, method, params } => {
                debug!("WebSocket request: {} -> {}", id, method);

                if method.starts_with("device.ab.") {
                    match method.as_str() {
                        "device.ab.get" => {
                            match ab::open_and_load_ab_data() {
                                Ok(info) => {
                                    let response = WebSocketMessage::Response {
                                        id,
                                        result: info.to_json_value(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(response.clone());
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.reset" => {
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    info.reset();
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response = WebSocketMessage::Response {
                                                id,
                                                result: info.to_json_value(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(response.clone());
                                            }
                                        }
                                        Err(e) => {
                                            let msg = WebSocketMessage::Error {
                                                id,
                                                error: e.to_string(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(msg.clone());
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.setSlot" => {
                            let slot = params
                                .get("slot")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as usize);
                            if slot != Some(0) && slot != Some(1) {
                                let msg = WebSocketMessage::Error {
                                    id,
                                    error: "invalid slot number: must be 0 or 1".to_string(),
                                };
                                let connections = self.connections.read().await;
                                for connection in connections.values() {
                                    let _ = connection.tx.send(msg.clone());
                                }
                                return Ok(());
                            }
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    info.set_active_slot(slot.unwrap());
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response = WebSocketMessage::Response {
                                                id,
                                                result: info.to_json_value(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(response.clone());
                                            }
                                        }
                                        Err(e) => {
                                            let msg = WebSocketMessage::Error {
                                                id,
                                                error: e.to_string(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(msg.clone());
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.setBootResult" => {
                            let result = params.get("result").and_then(|v| v.as_i64());
                            if result != Some(0) && result != Some(1) {
                                let msg = WebSocketMessage::Error {
                                    id,
                                    error: "invalid boot result: must be 0 or 1".to_string(),
                                };
                                let connections = self.connections.read().await;
                                for connection in connections.values() {
                                    let _ = connection.tx.send(msg.clone());
                                }
                                return Ok(());
                            }
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    if result == Some(0) {
                                        info.failover();
                                    } else {
                                        let active = info.get_active_slot();
                                        info.set_successful_boot(active);
                                    }
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response = WebSocketMessage::Response {
                                                id,
                                                result: info.to_json_value(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(response.clone());
                                            }
                                        }
                                        Err(e) => {
                                            let msg = WebSocketMessage::Error {
                                                id,
                                                error: e.to_string(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(msg.clone());
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.failover" => {
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    info.failover();
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response = WebSocketMessage::Response {
                                                id,
                                                result: info.to_json_value(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(response.clone());
                                            }
                                        }
                                        Err(e) => {
                                            let msg = WebSocketMessage::Error {
                                                id,
                                                error: e.to_string(),
                                            };
                                            let connections = self.connections.read().await;
                                            for connection in connections.values() {
                                                let _ = connection.tx.send(msg.clone());
                                            }
                                        }
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        _ => {}
                    }
                }

                if method.starts_with("device.brightness.") {
                    match method.as_str() {
                        "device.brightness.get" => {
                            match crate::brightness::get_brightness_config().await {
                                Ok(config) => {
                                    let response = WebSocketMessage::Response {
                                        id,
                                        result: serde_json::json!({
                                            "auto": config.auto,
                                            "brightness": config.brightness
                                        }),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(response.clone());
                                    }
                                }
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.brightness.set" => {
                            let brightness = params
                                .get("brightness")
                                .and_then(|v| v.as_u64())
                                .map(|v| v as u8);

                            if brightness.is_none() {
                                let msg = WebSocketMessage::Error {
                                    id,
                                    error: "missing brightness parameter".to_string(),
                                };
                                let connections = self.connections.read().await;
                                for connection in connections.values() {
                                    let _ = connection.tx.send(msg.clone());
                                }
                                return Ok(());
                            }

                            match crate::brightness::set_brightness(brightness.unwrap()).await {
                                Ok(()) => match crate::brightness::get_brightness_config().await {
                                    Ok(config) => {
                                        let response = WebSocketMessage::Response {
                                            id,
                                            result: serde_json::json!({
                                                "auto": config.auto,
                                                "brightness": config.brightness
                                            }),
                                        };
                                        let connections = self.connections.read().await;
                                        for connection in connections.values() {
                                            let _ = connection.tx.send(response.clone());
                                        }
                                    }
                                    Err(e) => {
                                        let msg = WebSocketMessage::Error {
                                            id,
                                            error: e.to_string(),
                                        };
                                        let connections = self.connections.read().await;
                                        for connection in connections.values() {
                                            let _ = connection.tx.send(msg.clone());
                                        }
                                    }
                                },
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        "device.brightness.auto" => {
                            let enabled = params
                                .get("enabled")
                                .and_then(|v| v.as_bool())
                                .unwrap_or(true);

                            match crate::brightness::set_auto_brightness(enabled).await {
                                Ok(()) => match crate::brightness::get_brightness_config().await {
                                    Ok(config) => {
                                        let response = WebSocketMessage::Response {
                                            id,
                                            result: serde_json::json!({
                                                "auto": config.auto,
                                                "brightness": config.brightness
                                            }),
                                        };
                                        let connections = self.connections.read().await;
                                        for connection in connections.values() {
                                            let _ = connection.tx.send(response.clone());
                                        }
                                    }
                                    Err(e) => {
                                        let msg = WebSocketMessage::Error {
                                            id,
                                            error: e.to_string(),
                                        };
                                        let connections = self.connections.read().await;
                                        for connection in connections.values() {
                                            let _ = connection.tx.send(msg.clone());
                                        }
                                    }
                                },
                                Err(e) => {
                                    let msg = WebSocketMessage::Error {
                                        id,
                                        error: e.to_string(),
                                    };
                                    let connections = self.connections.read().await;
                                    for connection in connections.values() {
                                        let _ = connection.tx.send(msg.clone());
                                    }
                                }
                            }
                            return Ok(());
                        }
                        _ => {}
                    }
                }

                if method == "bluetooth.discoverable" {
                    let discoverable = params
                        .get("discoverable")
                        .and_then(|d| {
                            if let Some(b) = d.as_bool() {
                                Some(b)
                            } else if let Some(s) = d.as_str() {
                                match s.to_lowercase().as_str() {
                                    "true" | "1" | "yes" | "on" => Some(true),
                                    "false" | "0" | "no" | "off" => Some(false),
                                    _ => None,
                                }
                            } else {
                                None
                            }
                        })
                        .unwrap_or(true);

                    info!("Setting Bluetooth discoverability to: {}", discoverable);

                    tokio::spawn(async move {
                        match bluer::Session::new().await {
                            Ok(session) => match session.default_adapter().await {
                                Ok(adapter) => {
                                    if let Err(e) = adapter.set_discoverable(discoverable).await {
                                        warn!("Failed to set Bluetooth discoverability: {}", e);
                                    } else {
                                        info!("Bluetooth discoverability set to: {}", discoverable);
                                    }
                                }
                                Err(e) => {
                                    warn!("Failed to get default Bluetooth adapter: {}", e);
                                }
                            },
                            Err(e) => {
                                warn!("Failed to create Bluetooth session: {}", e);
                            }
                        }
                    });

                    let response = WebSocketMessage::Response {
                        id,
                        result: serde_json::json!({
                            "discoverable": discoverable,
                            "status": "requested"
                        }),
                    };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    self.broadcast_event(
                        "bluetooth.discoverable".to_string(),
                        serde_json::json!({
                            "discoverable": discoverable
                        }),
                    )
                    .await;

                    return Ok(());
                }

                if method == "bluetooth.devices.list" {
                    use dbus::arg::RefArg;
                    use dbus::blocking::stdintf::org_freedesktop_dbus::ObjectManager;
                    use dbus::blocking::Connection;
                    use std::time::Duration;

                    let devices_result =
                        (|| -> std::result::Result<Vec<serde_json::Value>, String> {
                            let conn = Connection::new_system().map_err(|e| e.to_string())?;
                            let proxy = conn.with_proxy("org.bluez", "/", Duration::from_secs(1));
                            let objects = proxy.get_managed_objects().map_err(|e| e.to_string())?;

                            let mut devices = Vec::new();

                            for (_path, interfaces) in objects {
                                if let Some(device_props) = interfaces.get("org.bluez.Device1") {
                                    let address = device_props
                                        .get("Address")
                                        .and_then(|v| v.0.as_str())
                                        .unwrap_or("unknown")
                                        .to_string();

                                    let name = device_props
                                        .get("Name")
                                        .and_then(|v| v.0.as_str())
                                        .or_else(|| {
                                            device_props.get("Alias").and_then(|v| v.0.as_str())
                                        })
                                        .unwrap_or("Unknown Device")
                                        .to_string();

                                    let paired = device_props
                                        .get("Paired")
                                        .and_then(|v| v.0.as_u64())
                                        .map(|v| v != 0)
                                        .unwrap_or(false);

                                    let blocked = device_props
                                        .get("Blocked")
                                        .and_then(|v| v.0.as_u64())
                                        .map(|v| v != 0)
                                        .unwrap_or(false);

                                    let connected = device_props
                                        .get("Connected")
                                        .and_then(|v| v.0.as_u64())
                                        .map(|v| v != 0)
                                        .unwrap_or(false);

                                    let trusted = device_props
                                        .get("Trusted")
                                        .and_then(|v| v.0.as_u64())
                                        .map(|v| v != 0)
                                        .unwrap_or(false);

                                    if paired {
                                        devices.push(serde_json::json!({
                                            "address": address,
                                            "blocked": blocked,
                                            "default": trusted,
                                            "connected": connected,
                                            "device_info": {
                                                "name": name
                                            }
                                        }));
                                    }
                                }
                            }

                            Ok(devices)
                        })();

                    match devices_result {
                        Ok(devices) => {
                            let response = WebSocketMessage::Response {
                                id,
                                result: serde_json::json!({
                                    "payload": devices,
                                    "type": "bluetooth_device_list"
                                }),
                            };

                            let connections = self.connections.read().await;
                            for connection in connections.values() {
                                let _ = connection.tx.send(response.clone());
                            }
                        }
                        Err(e) => {
                            let msg = WebSocketMessage::Error { id, error: e };
                            let connections = self.connections.read().await;
                            for connection in connections.values() {
                                let _ = connection.tx.send(msg.clone());
                            }
                        }
                    }
                    return Ok(());
                }

                if method == "bluetooth.device.connect" {
                    info!("Received bluetooth.device.connect request");

                    let app_msg = AppMessage {
                        id,
                        protocol: "bluetooth.control".to_string(),
                        session_id: 1,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "method": method,
                            "params": params
                        }))?),
                    };

                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!(
                            "Failed to send bluetooth control message to app manager: {}",
                            e
                        );
                    }

                    return Ok(());
                }

                if method == "bluetooth.device.disconnect" {
                    info!("Received bluetooth.device.disconnect request");

                    let app_msg = AppMessage {
                        id,
                        protocol: "bluetooth.control".to_string(),
                        session_id: 1,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "method": method,
                            "params": params
                        }))?),
                    };

                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!(
                            "Failed to send bluetooth control message to app manager: {}",
                            e
                        );
                    }

                    return Ok(());
                }

                if method == "bluetooth.device.unpair" || method == "bluetooth.device.forget" {
                    info!("Received {} request", method);

                    let app_msg = AppMessage {
                        id,
                        protocol: "bluetooth.control".to_string(),
                        session_id: 1,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "method": method,
                            "params": params
                        }))?),
                    };

                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!(
                            "Failed to send bluetooth control message to app manager: {}",
                            e
                        );
                    }

                    return Ok(());
                }

                if method == "device.version" {
                    let result = match tokio::fs::read_to_string("/etc/nocturne/version.json").await
                    {
                        Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
                            Ok(version_data) => version_data,
                            Err(e) => {
                                serde_json::json!({
                                    "error": format!("Failed to parse version.json: {}", e)
                                })
                            }
                        },
                        Err(e) => {
                            serde_json::json!({
                                "error": format!("Failed to read version.json: {}", e)
                            })
                        }
                    };

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "device.info" {
                    let result =
                        serde_json::to_value(crate::config::collect_device_info_metadata())
                            .unwrap_or_else(|_| {
                                serde_json::json!({
                                    "device": "Nocturne",
                                    "version": "unknown"
                                })
                            });

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "device.ota.check" {
                    info!("Received device.ota.check request, forwarding to iPhone");

                    let app_msg = AppMessage {
                        id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: 1,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "method": method,
                            "params": params
                        }))?),
                    };

                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!("Failed to send OTA check message to app manager: {}", e);
                    }

                    return Ok(());
                }

                if method == "device.ota.download" {
                    info!("Received device.ota.download request, forwarding to iPhone");

                    let app_msg = AppMessage {
                        id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: 1,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "method": method,
                            "params": params
                        }))?),
                    };

                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!("Failed to send OTA download message to app manager: {}", e);
                    }

                    return Ok(());
                }

                if method == "device.ota.apply" {
                    info!(
                        "Received device.ota.apply request, spawning swupdate-client in background"
                    );

                    let file_path = params
                        .get("file_path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("/tmp/nocturne-update.swu")
                        .to_string();

                    info!("Starting OTA update from: {}", file_path);

                    let connections_clone = Arc::clone(&self.connections);

                    tokio::spawn(async move {
                        debug!("Executing command: swupdate-client {}", file_path);

                        let output = tokio::process::Command::new("swupdate-client")
                            .arg(&file_path)
                            .output()
                            .await;

                        let result = match output {
                            Ok(result) => {
                                let exit_code = result.status.code();
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                let stdout = String::from_utf8_lossy(&result.stdout).to_string();

                                debug!(
                                    "swupdate-client exit code: {:?}, stdout length: {}, stderr length: {}",
                                    exit_code,
                                    stdout.len(),
                                    stderr.len()
                                );

                                if !stdout.is_empty() {
                                    debug!("swupdate-client stdout: {}", stdout);
                                }
                                if !stderr.is_empty() {
                                    debug!("swupdate-client stderr: {}", stderr);
                                }

                                let is_success = result.status.success()
                                    && !stdout.contains("Swupdate *failed* !")
                                    && !stdout.contains("Installation failed !")
                                    && !stderr.contains("ERROR");

                                if is_success {
                                    info!(
                                        "OTA update completed successfully (exit code: {:?})",
                                        exit_code
                                    );
                                    serde_json::json!({
                                        "current": "finished",
                                        "ota": "complete"
                                    })
                                } else {
                                    error!(
                                        "OTA update failed (exit code: {:?}), stderr: {}, stdout: {}",
                                        exit_code, stderr, stdout
                                    );
                                    serde_json::json!({
                                        "current": "finished",
                                        "ota": "failed"
                                    })
                                }
                            }
                            Err(e) => {
                                error!("Failed to execute swupdate-client: {}", e);
                                serde_json::json!({
                                    "current": "finished",
                                    "ota": "failed"
                                })
                            }
                        };

                        let status_event = WebSocketMessage::Event {
                            topic: "device.ota.status".to_string(),
                            data: result,
                            server_timestamp_ms: Some(
                                std::time::SystemTime::now()
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap()
                                    .as_millis(),
                            ),
                        };

                        let connections = connections_clone.read().await;
                        for connection in connections.values() {
                            let _ = connection.tx.send(status_event.clone());
                        }
                    });

                    let response = WebSocketMessage::Response {
                        id,
                        result: serde_json::json!({
                            "current": "in_progress",
                            "ota": "started"
                        }),
                    };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "reset_boot_counter" {
                    info!("Received reset_boot_counter command, executing phb -r 1");

                    let output = tokio::process::Command::new("phb")
                        .arg("-r")
                        .arg("1")
                        .output()
                        .await;

                    let result = match output {
                        Ok(result) => {
                            if result.status.success() {
                                info!("phb -r 1 executed successfully");
                                serde_json::json!({ "success": true })
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("phb -r 1 failed: {}", stderr);
                                serde_json::json!({
                                    "success": false,
                                    "error": stderr
                                })
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute phb -r 1: {}", e);
                            serde_json::json!({
                                "success": false,
                                "error": e.to_string()
                            })
                        }
                    };

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "device.power.reboot" {
                    info!("Received device.power.reboot command, executing reboot");

                    let _ = tokio::process::Command::new("sync").output().await;

                    let output = tokio::process::Command::new("reboot").output().await;

                    let result = match output {
                        Ok(result) => {
                            if result.status.success() {
                                info!("reboot executed successfully");
                                serde_json::json!({ "success": true })
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("reboot failed: {}", stderr);
                                serde_json::json!({
                                    "success": false,
                                    "error": stderr
                                })
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute reboot: {}", e);
                            serde_json::json!({
                                "success": false,
                                "error": e.to_string()
                            })
                        }
                    };

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "device.power.shutdown" {
                    info!("Received device.power.shutdown command, executing halt");

                    let _ = tokio::process::Command::new("sync").output().await;

                    let output = tokio::process::Command::new("halt").output().await;

                    let result = match output {
                        Ok(result) => {
                            if result.status.success() {
                                info!("halt executed successfully");
                                serde_json::json!({ "success": true })
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("halt failed: {}", stderr);
                                serde_json::json!({
                                    "success": false,
                                    "error": stderr
                                })
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute halt: {}", e);
                            serde_json::json!({
                                "success": false,
                                "error": e.to_string()
                            })
                        }
                    };

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                if method == "device.factoryreset" {
                    info!("Received device.factoryreset command, executing factory reset sequence");

                    let result = async {
                        info!("Step 1/3: Setting firstboot flag with uenv");
                        let uenv_output = tokio::process::Command::new("uenv")
                            .arg("set")
                            .arg("firstboot")
                            .arg("1")
                            .output()
                            .await;

                        match uenv_output {
                            Ok(result) if result.status.success() => {
                                info!("uenv set firstboot 1 executed successfully");
                            }
                            Ok(result) => {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("uenv set firstboot 1 failed: {}", stderr);
                                return serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to set firstboot flag: {}", stderr)
                                });
                            }
                            Err(e) => {
                                warn!("Failed to execute uenv: {}", e);
                                return serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to execute uenv: {}", e)
                                });
                            }
                        }

                        info!("Step 2/3: Syncing filesystem");
                        let sync_output = tokio::process::Command::new("sync").output().await;

                        match sync_output {
                            Ok(result) if result.status.success() => {
                                info!("sync executed successfully");
                            }
                            Ok(result) => {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("sync failed: {}", stderr);
                                return serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to sync filesystem: {}", stderr)
                                });
                            }
                            Err(e) => {
                                warn!("Failed to execute sync: {}", e);
                                return serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to execute sync: {}", e)
                                });
                            }
                        }

                        info!("Step 3/3: Rebooting with shutdown -r now");
                        let shutdown_output = tokio::process::Command::new("shutdown")
                            .arg("-r")
                            .arg("now")
                            .output()
                            .await;

                        match shutdown_output {
                            Ok(result) if result.status.success() => {
                                info!("shutdown -r now executed successfully");
                                serde_json::json!({ "success": true })
                            }
                            Ok(result) => {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("shutdown -r now failed: {}", stderr);
                                serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to reboot: {}", stderr)
                                })
                            }
                            Err(e) => {
                                warn!("Failed to execute shutdown: {}", e);
                                serde_json::json!({
                                    "success": false,
                                    "error": format!("Failed to execute shutdown: {}", e)
                                })
                            }
                        }
                    }
                    .await;

                    let response = WebSocketMessage::Response { id, result };

                    let connections = self.connections.read().await;
                    for connection in connections.values() {
                        let _ = connection.tx.send(response.clone());
                    }

                    return Ok(());
                }

                let is_image_fetch = method == "spotify.image.fetch";
                if is_image_fetch {
                    if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                        debug!("Image fetch request for URL: {}", url);
                        let cache = self.image_cache.lock().await;

                        if let Some(base64_data) = cache.get(url).await {
                            debug!("CACHE HIT - Returning cached image for URL: {}", url);

                            let response = WebSocketMessage::Response {
                                id,
                                result: serde_json::json!({
                                    "url": url,
                                    "data": base64_data,
                                    "contentType": "image/jpeg"
                                }),
                            };

                            let connections = self.connections.read().await;
                            for connection in connections.values() {
                                let _ = connection.tx.send(response.clone());
                            }

                            return Ok(());
                        }

                        info!(
                            "CACHE MISS - Forwarding image fetch to iPhone for URL: {}",
                            url
                        );
                    }
                }

                if is_image_fetch {
                    self.track_image_fetch(id.clone()).await;
                }

                let app_msg = AppMessage {
                    id,
                    protocol: "com.usenocturne.daemon".to_string(),
                    session_id: 1,
                    data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                        "method": method,
                        "params": params
                    }))?),
                };

                if let Err(e) = self.app_manager_tx.send(app_msg) {
                    error!("Failed to send message to app manager: {}", e);
                }
            }
            _ => {
                warn!("Unexpected WebSocket message type: {:?}", ws_msg);
            }
        }

        Ok(())
    }

    pub async fn clear_app_ready(&self) {
        *self.last_app_ready.write().await = None;
    }

    pub async fn broadcast_event(&self, topic: String, data: serde_json::Value) {
        if topic == "app.ready" {
            *self.last_app_ready.write().await = Some(data.clone());
        } else if topic == "subscription.updated" {
            let mut cached = self.last_app_ready.write().await;
            if let Some(ref mut app_ready_data) = *cached {
                if let Some(subscribed) = data.get("subscribed") {
                    app_ready_data["subscribed"] = subscribed.clone();
                }
                if let Some(status) = data.get("subscriptionStatus") {
                    app_ready_data["subscriptionStatus"] = status.clone();
                }
                if let Some(has_lifetime) = data.get("hasLifetime") {
                    app_ready_data["hasLifetime"] = has_lifetime.clone();
                }
            }
        }

        let event = WebSocketMessage::Event {
            topic,
            data,
            server_timestamp_ms: None,
        };
        let connections = self.connections.read().await;

        for conn in connections.values() {
            if let Err(e) = conn.tx.send(event.clone()) {
                warn!(
                    "Failed to send event to WebSocket connection {}: {}",
                    conn.id, e
                );
            }
        }
    }

    pub async fn send_response(&self, request_id: String, result: serde_json::Value) {
        let response = WebSocketMessage::Response {
            id: request_id,
            result,
        };

        let connections = self.connections.read().await;
        for conn in connections.values() {
            if let Err(e) = conn.tx.send(response.clone()) {
                warn!(
                    "Failed to send response to WebSocket connection {}: {}",
                    conn.id, e
                );
            }
        }
    }

    pub async fn send_error(&self, request_id: String, error: String) {
        let error_msg = WebSocketMessage::Error {
            id: request_id,
            error,
        };

        let connections = self.connections.read().await;
        for conn in connections.values() {
            if let Err(e) = conn.tx.send(error_msg.clone()) {
                warn!(
                    "Failed to send error to WebSocket connection {}: {}",
                    conn.id, e
                );
            }
        }
    }
}
