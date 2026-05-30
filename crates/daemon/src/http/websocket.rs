use crate::app::AppMessage;
use crate::error::Result;
use crate::hardware::ImageCache;
use crate::system::ab;
use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use libnocturne::generated::bluetooth::*;
use libnocturne::generated::device::*;
use libnocturne::generated::spotify::*;
use libnocturne::generated::voice::VoiceWakewordStateEvent;
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

pub(crate) fn canonical_music_request(
    method: &str,
    params: serde_json::Value,
) -> std::result::Result<Option<(String, serde_json::Value)>, String> {
    let Some(canonical_method) = canonical_music_method(method) else {
        return Ok(None);
    };
    let params = normalize_music_params(canonical_method, params);
    let data = match canonical_method {
        "spotify.album.get" => typed::<SpotifyAlbumGetRequest>(params),
        "spotify.album.tracks" => typed::<SpotifyAlbumTracksRequest>(params),
        "spotify.artist.get" => typed::<SpotifyArtistGetRequest>(params),
        "spotify.artist.top_tracks" => typed::<SpotifyArtistTopTracksRequest>(params),
        "spotify.auth.get_status" => typed::<SpotifyAuthGetStatusRequest>(unit_params(params)),
        "spotify.devices" => typed::<SpotifyDevicesRequest>(unit_params(params)),
        "spotify.dj.signal" => typed::<SpotifyDjSignalRequest>(params),
        "spotify.dj.start" => typed::<SpotifyDjStartRequest>(unit_params(params)),
        "spotify.image.fetch" => typed::<SpotifyImageFetchRequest>(params),
        "spotify.me.playlists" => typed::<SpotifyMePlaylistsRequest>(params),
        "spotify.me.profile" => typed::<SpotifyMeProfileRequest>(unit_params(params)),
        "spotify.me.recently_played" => typed::<SpotifyMeRecentlyPlayedRequest>(params),
        "spotify.me.shows" => typed::<SpotifyMeShowsRequest>(params),
        "spotify.me.shows.contains" => typed::<SpotifyMeShowsContainsRequest>(params),
        "spotify.me.shows.remove" => typed::<SpotifyMeShowsRemoveRequest>(params),
        "spotify.me.shows.save" => typed::<SpotifyMeShowsSaveRequest>(params),
        "spotify.me.top_artists" => typed::<SpotifyMeTopArtistsRequest>(params),
        "spotify.me.top_tracks" => typed::<SpotifyMeTopTracksRequest>(params),
        "spotify.me.tracks" => typed::<SpotifyMeTracksRequest>(params),
        "spotify.me.tracks.contains" => typed::<SpotifyMeTracksContainsRequest>(params),
        "spotify.me.tracks.remove" => typed::<SpotifyMeTracksRemoveRequest>(params),
        "spotify.me.tracks.save" => typed::<SpotifyMeTracksSaveRequest>(params),
        "spotify.player.next" => typed::<SpotifyPlayerNextRequest>(unit_params(params)),
        "spotify.player.pause" => typed::<SpotifyPlayerPauseRequest>(unit_params(params)),
        "spotify.player.play" => typed::<SpotifyPlayerPlayRequest>(params),
        "spotify.player.previous" => typed::<SpotifyPlayerPreviousRequest>(unit_params(params)),
        "spotify.player.queue" => typed::<SpotifyPlayerQueueRequest>(unit_params(params)),
        "spotify.player.queue.add" => typed::<SpotifyPlayerQueueAddRequest>(params),
        "spotify.player.repeat" => typed::<SpotifyPlayerRepeatRequest>(params),
        "spotify.player.seek" => typed::<SpotifyPlayerSeekRequest>(params),
        "spotify.player.shuffle" => typed::<SpotifyPlayerShuffleRequest>(params),
        "spotify.player.speed" => typed::<SpotifyPlayerSpeedRequest>(params),
        "spotify.player.state" => typed::<SpotifyPlayerStateRequest>(unit_params(params)),
        "spotify.player.transfer" => typed::<SpotifyPlayerTransferRequest>(params),
        "spotify.player.volume" => typed::<SpotifyPlayerVolumeRequest>(params),
        "spotify.playlist.get" => typed::<SpotifyPlaylistGetRequest>(params),
        "spotify.playlist.tracks" => typed::<SpotifyPlaylistTracksRequest>(params),
        "spotify.radio.discoveries" => typed::<SpotifyRadioDiscoveriesRequest>(unit_params(params)),
        "spotify.radio.mixes" => typed::<SpotifyRadioMixesRequest>(unit_params(params)),
        "spotify.radio.playlist" => typed::<SpotifyRadioPlaylistRequest>(params),
        "spotify.radio.top_mix" => typed::<SpotifyRadioTopMixRequest>(unit_params(params)),
        "spotify.show.episodes" => typed::<SpotifyShowEpisodesRequest>(params),
        "spotify.show.get" => typed::<SpotifyShowGetRequest>(params),
        "spotify.track.lyrics" => typed::<SpotifyTrackLyricsRequest>(params),
        _ => unreachable!("canonical music method table drifted"),
    }?;
    Ok(Some((canonical_method.to_string(), data)))
}

fn typed<T>(params: serde_json::Value) -> std::result::Result<serde_json::Value, String>
where
    T: for<'de> Deserialize<'de> + Serialize,
{
    let decoded = serde_json::from_value::<T>(params)
        .map_err(|err| format!("invalid request payload: {err}"))?;
    serde_json::to_value(decoded).map_err(|err| format!("failed to encode request payload: {err}"))
}

fn unit_params(params: serde_json::Value) -> serde_json::Value {
    match params {
        serde_json::Value::Object(_) => serde_json::Value::Null,
        value => value,
    }
}

fn canonical_music_method(method: &str) -> Option<&'static str> {
    Some(match method {
        "spotify.album.get" => "spotify.album.get",
        "spotify.album.tracks" => "spotify.album.tracks",
        "spotify.artist.get" => "spotify.artist.get",
        "spotify.artist.topTracks" | "spotify.artist.top_tracks" => "spotify.artist.top_tracks",
        "spotify.auth.getStatus" | "spotify.auth.get_status" => "spotify.auth.get_status",
        "spotify.devices" => "spotify.devices",
        "spotify.dj.signal" => "spotify.dj.signal",
        "spotify.dj.start" => "spotify.dj.start",
        "spotify.image.fetch" => "spotify.image.fetch",
        "spotify.me.playlists" => "spotify.me.playlists",
        "spotify.me.profile" => "spotify.me.profile",
        "spotify.me.recentlyPlayed" | "spotify.me.recently_played" => "spotify.me.recently_played",
        "spotify.me.shows" => "spotify.me.shows",
        "spotify.me.shows.contains" => "spotify.me.shows.contains",
        "spotify.me.shows.remove" => "spotify.me.shows.remove",
        "spotify.me.shows.save" => "spotify.me.shows.save",
        "spotify.me.topArtists" | "spotify.me.top_artists" => "spotify.me.top_artists",
        "spotify.me.topTracks" | "spotify.me.top_tracks" => "spotify.me.top_tracks",
        "spotify.me.tracks" => "spotify.me.tracks",
        "spotify.me.tracks.contains" => "spotify.me.tracks.contains",
        "spotify.me.tracks.remove" => "spotify.me.tracks.remove",
        "spotify.me.tracks.save" => "spotify.me.tracks.save",
        "spotify.player.next" => "spotify.player.next",
        "spotify.player.pause" => "spotify.player.pause",
        "spotify.player.play" => "spotify.player.play",
        "spotify.player.previous" => "spotify.player.previous",
        "spotify.player.queue" => "spotify.player.queue",
        "spotify.player.queue.add" => "spotify.player.queue.add",
        "spotify.player.repeat" => "spotify.player.repeat",
        "spotify.player.seek" => "spotify.player.seek",
        "spotify.player.shuffle" => "spotify.player.shuffle",
        "spotify.player.speed" => "spotify.player.speed",
        "spotify.player.state" => "spotify.player.state",
        "spotify.player.transfer" => "spotify.player.transfer",
        "spotify.player.volume" => "spotify.player.volume",
        "spotify.playlist.get" => "spotify.playlist.get",
        "spotify.playlist.tracks" => "spotify.playlist.tracks",
        "spotify.radio.discoveries" => "spotify.radio.discoveries",
        "spotify.radio.mixes" => "spotify.radio.mixes",
        "spotify.radio.playlist" => "spotify.radio.playlist",
        "spotify.radio.topMix" | "spotify.radio.top_mix" => "spotify.radio.top_mix",
        "spotify.show.episodes" => "spotify.show.episodes",
        "spotify.show.get" => "spotify.show.get",
        "spotify.track.lyrics" => "spotify.track.lyrics",
        _ => return None,
    })
}

fn normalize_music_params(method: &str, params: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(mut map) = params else {
        return params;
    };

    for target in [
        "content_id",
        "context_uri",
        "device_id",
        "device_ids",
        "position_ms",
        "time_range",
        "volume_percent",
    ] {
        normalize_alias(&mut map, target);
    }

    if matches!(
        method,
        "spotify.album.get"
            | "spotify.album.tracks"
            | "spotify.artist.get"
            | "spotify.artist.top_tracks"
            | "spotify.playlist.get"
            | "spotify.playlist.tracks"
            | "spotify.show.get"
            | "spotify.show.episodes"
            | "spotify.track.lyrics"
    ) {
        normalize_content_id(&mut map);
    }

    serde_json::Value::Object(map)
}

fn normalize_content_id(map: &mut serde_json::Map<String, serde_json::Value>) {
    if map.contains_key("content_id") {
        return;
    }
    for alias in ["contentId", "id"] {
        if let Some(value) = map.remove(alias) {
            map.insert("content_id".to_string(), value);
            return;
        }
    }
}

fn normalize_alias(map: &mut serde_json::Map<String, serde_json::Value>, target: &str) {
    if map.contains_key(target) {
        return;
    }
    let mut alias = String::new();
    let mut upper_next = false;
    for ch in target.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            alias.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            alias.push(ch);
        }
    }
    if let Some(value) = map.remove(&alias) {
        map.insert(target.to_string(), value);
    }
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
    async fn send_typed_response<T>(&self, request_id: String, result: T)
    where
        T: Serialize,
    {
        let result = serde_json::to_value(result).unwrap_or_else(|err| {
            serde_json::json!({
                "success": false,
                "error": format!("failed to encode response: {err}")
            })
        });
        self.send_response(request_id, result).await;
    }

    fn decode_params<T>(params: serde_json::Value) -> serde_json::Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        serde_json::from_value(params)
    }

    fn ab_response<T>(info: &crate::system::ab::ABData) -> serde_json::Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        serde_json::from_value(info.to_json_value())
    }

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
            serde_json::to_value(VoiceWakewordStateEvent { muted })
                .expect("generated voice wakeword state event should serialize"),
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
                    data: serde_json::to_value(VoiceWakewordStateEvent { muted })
                        .expect("generated voice wakeword state event should serialize"),
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
                                    let response: DeviceAbGetResponse = Self::ab_response(&info)?;
                                    self.send_typed_response(id, response).await;
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
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
                                            let response: DeviceAbResetResponse =
                                                Self::ab_response(&info)?;
                                            self.send_typed_response(id, response).await;
                                        }
                                        Err(e) => {
                                            self.send_error(id, e.to_string()).await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.setSlot" | "device.ab.set_slot" => {
                            let request: DeviceAbSetSlotRequest = Self::decode_params(params)?;
                            if request.slot > 1 {
                                self.send_error(
                                    id,
                                    "invalid slot number: must be 0 or 1".to_string(),
                                )
                                .await;
                                return Ok(());
                            }
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    info.set_active_slot(request.slot as usize);
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response: DeviceAbSetSlotResponse =
                                                Self::ab_response(&info)?;
                                            self.send_typed_response(id, response).await;
                                        }
                                        Err(e) => {
                                            self.send_error(id, e.to_string()).await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
                                }
                            }
                            return Ok(());
                        }
                        "device.ab.setBootResult" | "device.ab.set_boot_result" => {
                            let request: DeviceAbSetBootResultRequest =
                                Self::decode_params(params)?;
                            if request.result != 0 && request.result != 1 {
                                self.send_error(
                                    id,
                                    "invalid boot result: must be 0 or 1".to_string(),
                                )
                                .await;
                                return Ok(());
                            }
                            match ab::open_and_load_ab_data() {
                                Ok(mut info) => {
                                    if request.result == 0 {
                                        info.failover();
                                    } else {
                                        let active = info.get_active_slot();
                                        info.set_successful_boot(active);
                                    }
                                    match ab::save_ab_data(info.clone()) {
                                        Ok(()) => {
                                            let response: DeviceAbSetBootResultResponse =
                                                Self::ab_response(&info)?;
                                            self.send_typed_response(id, response).await;
                                        }
                                        Err(e) => {
                                            self.send_error(id, e.to_string()).await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
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
                                            let response: DeviceAbFailoverResponse =
                                                Self::ab_response(&info)?;
                                            self.send_typed_response(id, response).await;
                                        }
                                        Err(e) => {
                                            self.send_error(id, e.to_string()).await;
                                        }
                                    }
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
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
                            match crate::hardware::get_brightness_config().await {
                                Ok(config) => {
                                    self.send_typed_response(
                                        id,
                                        DeviceBrightnessGetResponse {
                                            auto: config.auto,
                                            brightness: config.brightness,
                                        },
                                    )
                                    .await;
                                }
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
                                }
                            }
                            return Ok(());
                        }
                        "device.brightness.set" => {
                            let request: DeviceBrightnessSetRequest = Self::decode_params(params)?;

                            match crate::hardware::set_brightness(request.brightness).await {
                                Ok(()) => match crate::hardware::get_brightness_config().await {
                                    Ok(config) => {
                                        self.send_typed_response(
                                            id,
                                            DeviceBrightnessSetResponse {
                                                auto: config.auto,
                                                brightness: config.brightness,
                                            },
                                        )
                                        .await;
                                    }
                                    Err(e) => {
                                        self.send_error(id, e.to_string()).await;
                                    }
                                },
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
                                }
                            }
                            return Ok(());
                        }
                        "device.brightness.auto" => {
                            let request: DeviceBrightnessAutoRequest = Self::decode_params(params)?;

                            match crate::hardware::set_auto_brightness(request.enabled).await {
                                Ok(()) => match crate::hardware::get_brightness_config().await {
                                    Ok(config) => {
                                        self.send_typed_response(
                                            id,
                                            DeviceBrightnessAutoResponse {
                                                auto: config.auto,
                                                brightness: config.brightness,
                                            },
                                        )
                                        .await;
                                    }
                                    Err(e) => {
                                        self.send_error(id, e.to_string()).await;
                                    }
                                },
                                Err(e) => {
                                    self.send_error(id, e.to_string()).await;
                                }
                            }
                            return Ok(());
                        }
                        _ => {}
                    }
                }

                if method == "bluetooth.discoverable" {
                    let request = Self::decode_params::<BluetoothDiscoverableRequest>(params)
                        .unwrap_or(BluetoothDiscoverableRequest { discoverable: true });
                    let discoverable = request.discoverable;

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

                    self.send_typed_response(
                        id,
                        BluetoothDiscoverableResponse {
                            discoverable,
                            status: "requested".to_string(),
                        },
                    )
                    .await;

                    self.broadcast_event(
                        "bluetooth.discoverable".to_string(),
                        serde_json::to_value(BluetoothDiscoverableEvent { discoverable })?,
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
                        (|| -> std::result::Result<BluetoothDevicesListResponse, String> {
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

                            Ok(BluetoothDevicesListResponse {
                                payload: devices,
                                r#type: "bluetooth_device_list".to_string(),
                            })
                        })();

                    match devices_result {
                        Ok(response) => self.send_typed_response(id, response).await,
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
                    let params = match Self::decode_params::<BluetoothDeviceConnectRequest>(params)
                    {
                        Ok(request) => serde_json::to_value(request)?,
                        Err(e) => {
                            self.send_error(
                                id,
                                format!("invalid bluetooth.device.connect params: {e}"),
                            )
                            .await;
                            return Ok(());
                        }
                    };

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
                    let params =
                        match Self::decode_params::<BluetoothDeviceDisconnectRequest>(params) {
                            Ok(request) => serde_json::to_value(request)?,
                            Err(e) => {
                                self.send_error(
                                    id,
                                    format!("invalid bluetooth.device.disconnect params: {e}"),
                                )
                                .await;
                                return Ok(());
                            }
                        };

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
                    let params = match Self::decode_params::<BluetoothDeviceUnpairRequest>(params) {
                        Ok(request) => serde_json::to_value(request)?,
                        Err(e) => {
                            self.send_error(id, format!("invalid {method} params: {e}"))
                                .await;
                            return Ok(());
                        }
                    };

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
                    self.send_typed_response(
                        id,
                        crate::system::config::collect_device_version_metadata(),
                    )
                    .await;
                    return Ok(());
                }

                if method == "device.info" {
                    self.send_typed_response(
                        id,
                        crate::system::config::collect_device_info_metadata(),
                    )
                    .await;
                    return Ok(());
                }

                if method == "ota.request_check" {
                    info!(
                        "ota.request_check from UI; forwarding to companion over existing app path"
                    );
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
                        error!("Failed to forward ota.request_check to app manager: {}", e);
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
                                DevicePowerRebootResponse {
                                    success: true,
                                    error: None,
                                }
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("reboot failed: {}", stderr);
                                DevicePowerRebootResponse {
                                    success: false,
                                    error: Some(stderr),
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute reboot: {}", e);
                            DevicePowerRebootResponse {
                                success: false,
                                error: Some(e.to_string()),
                            }
                        }
                    };

                    self.send_typed_response(id, result).await;

                    return Ok(());
                }

                if method == "device.power.off" {
                    info!("Received device.power.off command, executing halt");

                    let _ = tokio::process::Command::new("sync").output().await;

                    let output = tokio::process::Command::new("halt").output().await;

                    let result = match output {
                        Ok(result) => {
                            if result.status.success() {
                                info!("halt executed successfully");
                                DevicePowerOffResponse {
                                    success: true,
                                    error: None,
                                }
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("halt failed: {}", stderr);
                                DevicePowerOffResponse {
                                    success: false,
                                    error: Some(stderr),
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute halt: {}", e);
                            DevicePowerOffResponse {
                                success: false,
                                error: Some(e.to_string()),
                            }
                        }
                    };

                    self.send_typed_response(id, result).await;

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
                                DevicePowerShutdownResponse {
                                    success: true,
                                    error: None,
                                }
                            } else {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("halt failed: {}", stderr);
                                DevicePowerShutdownResponse {
                                    success: false,
                                    error: Some(stderr),
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to execute halt: {}", e);
                            DevicePowerShutdownResponse {
                                success: false,
                                error: Some(e.to_string()),
                            }
                        }
                    };

                    self.send_typed_response(id, result).await;

                    return Ok(());
                }

                if method == "device.factoryreset" || method == "device.factory_reset" {
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
                                return DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!(
                                        "Failed to set firstboot flag: {}",
                                        stderr
                                    )),
                                };
                            }
                            Err(e) => {
                                warn!("Failed to execute uenv: {}", e);
                                return DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!("Failed to execute uenv: {}", e)),
                                };
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
                                return DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!("Failed to sync filesystem: {}", stderr)),
                                };
                            }
                            Err(e) => {
                                warn!("Failed to execute sync: {}", e);
                                return DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!("Failed to execute sync: {}", e)),
                                };
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
                                DeviceFactoryResetResponse {
                                    success: true,
                                    error: None,
                                }
                            }
                            Ok(result) => {
                                let stderr = String::from_utf8_lossy(&result.stderr).to_string();
                                warn!("shutdown -r now failed: {}", stderr);
                                DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!("Failed to reboot: {}", stderr)),
                                }
                            }
                            Err(e) => {
                                warn!("Failed to execute shutdown: {}", e);
                                DeviceFactoryResetResponse {
                                    success: false,
                                    error: Some(format!("Failed to execute shutdown: {}", e)),
                                }
                            }
                        }
                    }
                    .await;

                    self.send_typed_response(id, result).await;

                    return Ok(());
                }

                let (method, params) = match canonical_music_request(&method, params.clone()) {
                    Ok(Some(request)) => request,
                    Ok(None) => (method, params),
                    Err(error) => {
                        self.send_error(id, error).await;
                        return Ok(());
                    }
                };

                let is_image_fetch = method == "spotify.image.fetch";
                if is_image_fetch {
                    let request: SpotifyImageFetchRequest = Self::decode_params(params.clone())?;
                    debug!("Image fetch request for URL: {}", request.url);
                    let cache = self.image_cache.lock().await;

                    if let Some(base64_data) = cache.get(&request.url).await {
                        debug!(
                            "CACHE HIT - Returning cached image for URL: {}",
                            request.url
                        );
                        self.send_typed_response(
                            id,
                            SpotifyImageFetchResponse {
                                url: request.url,
                                data: base64_data,
                                content_type: "image/jpeg".to_string(),
                            },
                        )
                        .await;

                        return Ok(());
                    }

                    info!(
                        "CACHE MISS - Forwarding image fetch to iPhone for URL: {}",
                        request.url
                    );
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
