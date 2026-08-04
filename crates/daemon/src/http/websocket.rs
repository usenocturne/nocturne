use crate::app::{AppMessage, AppMessagePriority};
use crate::error::Result;
use crate::hardware::ImageCache;
use crate::ota::slots;
use crate::system::ab;
use bytes::Bytes;
use futures::{SinkExt, StreamExt};
use libnocturne::generated::bluetooth::*;
use libnocturne::generated::device::*;
use libnocturne::generated::media_control::MediaNowPlayingUpdateEvent;
use libnocturne::generated::spotify::*;
use libnocturne::generated::voice::VoiceWakewordStateEvent;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
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

fn playback_active_from_now_playing(data: &serde_json::Value) -> Option<bool> {
    let event = serde_json::from_value::<MediaNowPlayingUpdateEvent>(data.clone()).ok()?;
    let playback_attributes = event
        .playback_attributes
        .or_else(|| data.get("PlaybackAttributes").cloned())?;
    let status = playback_attributes
        .get("PlaybackStatus")
        .or_else(|| playback_attributes.get("playback_status"))
        .or_else(|| playback_attributes.get("playbackStatus"))?
        .as_str()?;
    Some(status.eq_ignore_ascii_case("playing"))
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

fn companion_music_request(
    method: &str,
    params: serde_json::Value,
    platform: Option<&str>,
) -> std::result::Result<Option<(String, serde_json::Value)>, String> {
    let Some((canonical_method, mut params)) = canonical_music_request(method, params)? else {
        return Ok(None);
    };

    if platform != Some("web") {
        return Ok(Some((canonical_method, params)));
    }

    if matches!(
        canonical_method.as_str(),
        "spotify.album.tracks" | "spotify.playlist.tracks"
    ) {
        if let serde_json::Value::Object(map) = &mut params {
            if let Some(content_id) = map.get("content_id").cloned() {
                map.entry("id".to_string()).or_insert(content_id);
            }
        }
    }

    let method = match canonical_method.as_str() {
        "spotify.artist.top_tracks" => "spotify.artist.topTracks",
        "spotify.auth.get_status" => "spotify.auth.getStatus",
        "spotify.me.recently_played" => "spotify.me.recentlyPlayed",
        "spotify.me.top_artists" => "spotify.me.topArtists",
        "spotify.me.top_tracks" => "spotify.me.topTracks",
        "spotify.radio.top_mix" => "spotify.radio.topMix",
        _ => canonical_method.as_str(),
    };

    Ok(Some((method.to_string(), params)))
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

const UNSCOPED_APP_ROUTE: &str = "__unscoped__";

#[derive(Clone)]
struct AppReadyEntry {
    data: serde_json::Value,
    source_peer: Option<String>,
    generation: u64,
}

#[derive(Clone)]
struct ActiveAppReady {
    data: serde_json::Value,
    route: Option<String>,
    source_peer: Option<String>,
}

#[derive(Default)]
struct AppReadyRegistry {
    entries: HashMap<String, AppReadyEntry>,
    active_route: Option<String>,
    next_generation: u64,
}

impl AppReadyRegistry {
    fn register(
        &mut self,
        route: Option<&str>,
        source_peer: Option<&str>,
        data: serde_json::Value,
    ) {
        self.next_generation = self.next_generation.saturating_add(1);
        let route = route.unwrap_or(UNSCOPED_APP_ROUTE).to_string();
        self.entries.insert(
            route.clone(),
            AppReadyEntry {
                data,
                source_peer: source_peer.map(ToOwned::to_owned),
                generation: self.next_generation,
            },
        );
        self.active_route = Some(route);
    }

    fn active(&self) -> Option<ActiveAppReady> {
        let route = self.active_route.as_ref()?;
        let entry = self.entries.get(route)?;
        Some(ActiveAppReady {
            data: entry.data.clone(),
            route: (route != UNSCOPED_APP_ROUTE).then(|| route.clone()),
            source_peer: entry.source_peer.clone(),
        })
    }

    fn is_active(&self, route: &str) -> bool {
        self.active_route.as_deref() == Some(route)
    }

    fn update_active(&mut self, update: &serde_json::Value) {
        let Some(route) = self.active_route.as_ref() else {
            return;
        };
        let Some(entry) = self.entries.get_mut(route) else {
            return;
        };
        if let Some(subscribed) = update.get("subscribed") {
            entry.data["subscribed"] = subscribed.clone();
        }
        update_compatible_field(
            &mut entry.data,
            update,
            "subscription_status",
            "subscriptionStatus",
        );
        update_compatible_field(&mut entry.data, update, "has_lifetime", "hasLifetime");
        update_compatible_field(&mut entry.data, update, "is_admin", "isAdmin");
        update_compatible_field(
            &mut entry.data,
            update,
            "entitlements_verified",
            "entitlementsVerified",
        );
    }

    fn remove(&mut self, route: &str) -> Option<ActiveAppReady> {
        self.entries.remove(route);
        if self.active_route.as_deref() != Some(route) {
            return None;
        }

        self.active_route = self
            .entries
            .iter()
            .max_by_key(|(_, entry)| entry.generation)
            .map(|(route, _)| route.clone());
        self.active()
    }
}

fn update_compatible_field(
    cached: &mut serde_json::Value,
    update: &serde_json::Value,
    canonical: &str,
    compatible: &str,
) {
    let Some(value) = update.get(canonical).or_else(|| update.get(compatible)) else {
        return;
    };

    if cached.get(canonical).is_some() || cached.get(compatible).is_none() {
        cached[canonical] = value.clone();
    }
    if cached.get(compatible).is_some() {
        cached[compatible] = value.clone();
    }
}

fn phone_request_route(device: &str, active_app: Option<&ActiveAppReady>) -> String {
    if let Some(active_app) = active_app {
        let is_android = active_app
            .data
            .get("platform")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|platform| platform.eq_ignore_ascii_case("android"));
        let peer_matches = active_app
            .source_peer
            .as_deref()
            .is_some_and(|peer| peer.eq_ignore_ascii_case(device));
        if is_android && peer_matches {
            if let Some(route) = active_app
                .route
                .as_deref()
                .filter(|route| route.starts_with("spp:"))
            {
                return route.to_string();
            }
        }
    }

    format!("iap2:{device}")
}

pub struct WebSocketServer {
    connections: Arc<RwLock<HashMap<String, WebSocketConnection>>>,
    app_manager_tx: mpsc::UnboundedSender<AppMessage>,
    port: u16,
    image_cache: Arc<Mutex<ImageCache>>,
    pending_image_fetches: Arc<RwLock<HashSet<String>>>,
    app_ready_registry: Arc<RwLock<AppReadyRegistry>>,
    last_wakeword_state: Arc<RwLock<Option<bool>>>,
    last_playback_active: Arc<AtomicBool>,
    pairing_window_lock: Arc<Mutex<()>>,
    pairing_window_requested: Arc<AtomicBool>,
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
            app_ready_registry: Arc::new(RwLock::new(AppReadyRegistry::default())),
            last_wakeword_state: Arc::new(RwLock::new(None)),
            last_playback_active: Arc::new(AtomicBool::new(false)),
            pairing_window_lock: Arc::new(Mutex::new(())),
            pairing_window_requested: Arc::new(AtomicBool::new(false)),
        }
    }

    async fn apply_pairing_window(
        adapter: &bluer::Adapter,
        discoverable: bool,
    ) -> bluer::Result<()> {
        if discoverable {
            adapter.set_pairable(true).await?;
            if let Err(error) = adapter.set_discoverable(true).await {
                if let Err(rollback_error) = adapter.set_pairable(false).await {
                    warn!(
                        "Failed to close Pairable after discovery failed: {}",
                        rollback_error
                    );
                }
                return Err(error);
            }
        } else {
            let discoverable_result = adapter.set_discoverable(false).await;
            let pairable_result = adapter.set_pairable(false).await;
            discoverable_result?;
            pairable_result?;
        }

        Ok(())
    }

    pub async fn restore_pairing_window(&self, adapter: &bluer::Adapter) -> bluer::Result<bool> {
        let _transition = self.pairing_window_lock.lock().await;
        let discoverable = self.pairing_window_requested.load(Ordering::SeqCst);
        Self::apply_pairing_window(adapter, discoverable).await?;
        Ok(discoverable)
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

        if let Some(active_app) = self.app_ready_registry.read().await.active() {
            info!(
                "Replaying cached app.ready to new WebSocket client {}",
                connection_id
            );
            let connections = self.connections.read().await;
            if let Some(conn) = connections.get(&connection_id) {
                let _ = conn.tx.send(WebSocketMessage::Event {
                    topic: "app.ready".to_string(),
                    data: active_app.data,
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

                if method.starts_with("device.display.") {
                    match method.as_str() {
                        "device.display.get" => {
                            match crate::hardware::get_display_config().await {
                                Ok(config) => {
                                    self.send_typed_response(
                                        id,
                                        DeviceDisplayGetResponse {
                                            auto: config.auto,
                                            brightness: config.brightness,
                                            sleeping: crate::hardware::is_display_sleeping(),
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
                        "device.display.sleep" => {
                            match crate::hardware::sleep_display().await {
                                Ok(config) => {
                                    self.send_typed_response(
                                        id,
                                        DeviceDisplaySleepResponse {
                                            auto: config.auto,
                                            brightness: config.brightness,
                                            sleeping: crate::hardware::is_display_sleeping(),
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
                        "device.display.wake" => {
                            match crate::hardware::wake_display().await {
                                Ok(config) => {
                                    self.send_typed_response(
                                        id,
                                        DeviceDisplayWakeResponse {
                                            auto: config.auto,
                                            brightness: config.brightness,
                                            sleeping: crate::hardware::is_display_sleeping(),
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
                        _ => {}
                    }
                }

                if method == "bluetooth.discoverable" {
                    let request = Self::decode_params::<BluetoothDiscoverableRequest>(params)
                        .unwrap_or(BluetoothDiscoverableRequest { discoverable: true });
                    let discoverable = request.discoverable;

                    info!("Setting Bluetooth pairing window to: {}", discoverable);

                    let transition_result = async {
                        let _transition = self.pairing_window_lock.lock().await;
                        self.pairing_window_requested
                            .store(discoverable, Ordering::SeqCst);
                        let session = bluer::Session::new().await?;
                        let adapter = session.default_adapter().await?;
                        Self::apply_pairing_window(&adapter, discoverable).await
                    }
                    .await;

                    if let Err(error) = transition_result {
                        warn!("Failed to set Bluetooth pairing window: {}", error);
                        self.send_error(id, error.to_string()).await;
                        return Ok(());
                    }

                    info!("Bluetooth pairing window set to: {}", discoverable);

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

                                    let icon = device_props
                                        .get("Icon")
                                        .and_then(|v| v.0.as_str())
                                        .map(|value| value.to_string());

                                    let class =
                                        device_props.get("Class").and_then(|v| v.0.as_u64());

                                    let looks_like_macos_connector =
                                        crate::bluetooth::metadata_identifies_computer(
                                            icon.as_deref(),
                                            class.and_then(|value| u32::try_from(value).ok()),
                                            Some(&name),
                                            Some(&name),
                                        );

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
                                        let mut payload = serde_json::json!({
                                            "address": address,
                                            "blocked": blocked,
                                            "default": trusted,
                                            "connected": connected,
                                            "device_info": {
                                                "name": name,
                                                "icon": icon,
                                                "class": class
                                            }
                                        });

                                        if looks_like_macos_connector {
                                            if let Some(object) = payload.as_object_mut() {
                                                object.insert(
                                                    "device_type".to_string(),
                                                    serde_json::json!("macos_connector"),
                                                );
                                                object.insert(
                                                    "connection_type".to_string(),
                                                    serde_json::json!("macos_connector"),
                                                );
                                                object.insert(
                                                    "channel".to_string(),
                                                    serde_json::json!(
                                                        crate::bluetooth::BluetoothDaemon::MACOS_CONNECTOR_PROBE_CHANNEL
                                                    ),
                                                );
                                            }
                                        }

                                        devices.push(payload);
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
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
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

                // The UI drives OTA in two explicit steps: `ota.request_check`
                // asks the companion to check the server (it replies with an
                // `ota.check_result` event and does NOT download), and
                // `ota.request_install` tells it to download + stream the update.
                // Both forward as events, the same `{topic, data}` shape the
                // companion already decodes, rather than `{method, params}` calls:
                // the phone's RPC client drops messages with no message `type`,
                // and the gateway tags a topic payload as an event.
                if method == "ota.request_check" || method == "ota.request_install" {
                    info!("{method} from UI; forwarding to companion over existing app path");
                    let app_msg = AppMessage {
                        id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: 1,
                        priority: AppMessagePriority::Normal,
                        data: Bytes::from(serde_json::to_vec(&serde_json::json!({
                            "topic": method.as_str(),
                            "data": params
                        }))?),
                    };
                    if let Err(e) = self.app_manager_tx.send(app_msg) {
                        error!("Failed to forward {method} to app manager: {}", e);
                    }
                    return Ok(());
                }

                if method == "reset_boot_counter" {
                    info!("Received reset_boot_counter command, marking active slot successful");

                    let result = match slots::active_slot().and_then(slots::mark_slot_ok) {
                        Ok(()) => serde_json::json!({ "success": true }),
                        Err(e) => {
                            warn!("Failed to mark active slot successful: {}", e);
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

                if matches!(
                    method.as_str(),
                    "phone.calls.get" | "phone.call.accept" | "phone.call.decline"
                ) {
                    let device = params
                        .get("device")
                        .and_then(serde_json::Value::as_str)
                        .filter(|device| !device.is_empty());
                    let Some(device) = device else {
                        self.send_error(id, "Missing phone device".to_string())
                            .await;
                        return Ok(());
                    };
                    let active_app = self.app_ready_registry.read().await.active();
                    let target_connection = phone_request_route(device, active_app.as_ref());
                    let app_request = serde_json::json!({
                        "method": method,
                        "params": params,
                        "_targetConnection": target_connection,
                    });
                    let app_msg = AppMessage {
                        id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: 1,
                        priority: AppMessagePriority::Normal,
                        data: Bytes::from(serde_json::to_vec(&app_request)?),
                    };
                    if let Err(error) = self.app_manager_tx.send(app_msg) {
                        error!(%error, "Failed to route native phone request");
                    }
                    return Ok(());
                }

                let Some(active_app) = self.app_ready_registry.read().await.active() else {
                    self.send_error(id, "No active app session".to_string())
                        .await;
                    return Ok(());
                };
                let companion_platform = active_app
                    .data
                    .get("platform")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned);
                let (method, params) = match companion_music_request(
                    &method,
                    params.clone(),
                    companion_platform.as_deref(),
                ) {
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

                let mut app_request = serde_json::json!({
                    "method": method,
                    "params": params,
                });
                if let Some(route) = active_app.route {
                    app_request["_targetConnection"] = serde_json::json!(route);
                }

                let app_msg = AppMessage {
                    id,
                    protocol: "com.usenocturne.daemon".to_string(),
                    session_id: 1,
                    priority: AppMessagePriority::Normal,
                    data: Bytes::from(serde_json::to_vec(&app_request)?),
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

    pub async fn clear_app_ready_for_route(&self, route: &str) {
        let (was_active, promoted) = {
            let mut registry = self.app_ready_registry.write().await;
            let was_active = registry.is_active(route);
            let promoted = registry.remove(route);
            (was_active, promoted)
        };
        if !was_active {
            return;
        }
        self.last_playback_active.store(false, Ordering::Relaxed);

        if let Some(active_app) = promoted {
            info!(
                route = active_app.route.as_deref().unwrap_or("unscoped"),
                "Promoted surviving app connection after active route closed"
            );
            self.send_event_to_clients("app.ready".to_string(), active_app.data)
                .await;
        }
    }

    pub async fn has_ready_app_session(&self) -> bool {
        self.app_ready_registry.read().await.active().is_some()
    }

    pub fn playback_active_flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.last_playback_active)
    }

    pub async fn broadcast_event(&self, topic: String, data: serde_json::Value) {
        self.broadcast_event_from_route(topic, data, None, None)
            .await;
    }

    pub async fn broadcast_event_from_route(
        &self,
        topic: String,
        data: serde_json::Value,
        route: Option<&str>,
        source_peer: Option<&str>,
    ) {
        if topic == "app.ready" {
            self.app_ready_registry
                .write()
                .await
                .register(route, source_peer, data.clone());
        } else if let Some(route) = route {
            let registry = self.app_ready_registry.read().await;
            if registry.active_route.is_some() && !registry.is_active(route) {
                debug!(route, %topic, "Ignoring event from inactive app connection");
                return;
            }
        }

        if topic == "subscription.updated" {
            self.app_ready_registry.write().await.update_active(&data);
        } else if topic == "media.now_playing.update" || topic == "media.nowPlaying.update" {
            if let Some(active) = playback_active_from_now_playing(&data) {
                self.last_playback_active.store(active, Ordering::Relaxed);
            }
        }

        self.send_event_to_clients(topic, data).await;
    }

    async fn send_event_to_clients(&self, topic: String, data: serde_json::Value) {
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

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_CONNECTOR_METHODS: [(&str, &str); 6] = [
        ("spotify.artist.topTracks", "spotify.artist.top_tracks"),
        ("spotify.auth.getStatus", "spotify.auth.get_status"),
        ("spotify.me.recentlyPlayed", "spotify.me.recently_played"),
        ("spotify.me.topArtists", "spotify.me.top_artists"),
        ("spotify.me.topTracks", "spotify.me.top_tracks"),
        ("spotify.radio.topMix", "spotify.radio.top_mix"),
    ];

    fn valid_music_params(method: &str) -> serde_json::Value {
        if matches!(
            method,
            "spotify.artist.topTracks" | "spotify.artist.top_tracks"
        ) {
            serde_json::json!({ "content_id": "artist-id" })
        } else {
            serde_json::json!({})
        }
    }

    #[test]
    fn canonical_music_request_normalizes_legacy_connector_methods() {
        for (legacy, canonical) in LEGACY_CONNECTOR_METHODS {
            let (method, _) = canonical_music_request(legacy, valid_music_params(legacy))
                .expect("legacy method should decode")
                .expect("legacy method should be recognized");

            assert_eq!(method, canonical);
        }
    }

    #[test]
    fn companion_music_request_preserves_mockingbird_artist_metadata_flag() {
        for platform in [None, Some("ios"), Some("android"), Some("web")] {
            let (_, params) = companion_music_request(
                "spotify.artist.top_tracks",
                serde_json::json!({
                    "contentId": "artist-id",
                    "mockingbird": true,
                }),
                platform,
            )
            .expect("artist top tracks request should decode")
            .expect("artist top tracks request should be recognized");

            assert_eq!(params["content_id"], "artist-id");
            assert_eq!(params["mockingbird"], true);
        }
    }

    #[test]
    fn companion_music_request_preserves_canonical_methods_for_native_apps() {
        for (_, canonical) in LEGACY_CONNECTOR_METHODS {
            for platform in [None, Some("ios"), Some("android")] {
                let (method, _) =
                    companion_music_request(canonical, valid_music_params(canonical), platform)
                        .expect("canonical method should decode")
                        .expect("canonical method should be recognized");

                assert_eq!(method, canonical);
            }
        }
    }

    #[test]
    fn companion_music_request_uses_legacy_methods_for_web_connector() {
        for (legacy, canonical) in LEGACY_CONNECTOR_METHODS {
            let (method, _) =
                companion_music_request(canonical, valid_music_params(canonical), Some("web"))
                    .expect("canonical method should decode")
                    .expect("canonical method should be recognized");

            assert_eq!(method, legacy);
        }
    }

    #[test]
    fn companion_music_request_adds_legacy_content_id_for_connector_track_lists() {
        for method in ["spotify.album.tracks", "spotify.playlist.tracks"] {
            let (_, params) = companion_music_request(
                method,
                serde_json::json!({ "contentId": "spotify-id" }),
                Some("web"),
            )
            .expect("track-list method should decode")
            .expect("track-list method should be recognized");

            assert_eq!(params["content_id"], "spotify-id");
            assert_eq!(params["id"], "spotify-id");
        }
    }

    #[test]
    fn app_ready_registry_applies_canonical_subscription_update_to_replay() {
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("spp:phone"),
            Some("D8:3A:DD:31:B0:49"),
            serde_json::json!({
                "platform": "android",
                "subscribed": false,
                "subscription_status": "none",
                "has_lifetime": true,
                "is_admin": false,
                "entitlements_verified": false,
            }),
        );

        registry.update_active(&serde_json::json!({
            "subscribed": true,
            "subscription_status": "active",
            "has_lifetime": false,
            "is_admin": true,
            "entitlements_verified": true,
        }));

        let replay = registry.active().expect("active phone route").data;
        assert_eq!(replay["subscribed"], true);
        assert_eq!(replay["subscription_status"], "active");
        assert_eq!(replay["has_lifetime"], false);
        assert_eq!(replay["is_admin"], true);
        assert_eq!(replay["entitlements_verified"], true);
        assert_eq!(replay["platform"], "android");
        assert!(replay.get("subscriptionStatus").is_none());
        assert!(replay.get("hasLifetime").is_none());
        assert!(replay.get("isAdmin").is_none());
        assert!(replay.get("entitlementsVerified").is_none());
    }

    #[test]
    fn app_ready_registry_preserves_camel_case_subscription_compatibility() {
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("iap2:phone"),
            Some("A8:AB:B5:AB:02:ED"),
            serde_json::json!({
                "platform": "ios",
                "subscribed": false,
                "subscriptionStatus": "none",
                "hasLifetime": true,
                "isAdmin": false,
                "entitlementsVerified": false,
            }),
        );

        registry.update_active(&serde_json::json!({
            "subscribed": true,
            "subscriptionStatus": "trialing",
            "hasLifetime": false,
            "isAdmin": true,
            "entitlementsVerified": true,
        }));

        let replay = registry.active().expect("active phone route").data;
        assert_eq!(replay["subscribed"], true);
        assert_eq!(replay["subscriptionStatus"], "trialing");
        assert_eq!(replay["hasLifetime"], false);
        assert_eq!(replay["isAdmin"], true);
        assert_eq!(replay["entitlementsVerified"], true);
        assert_eq!(replay["platform"], "ios");
        assert!(replay.get("subscription_status").is_none());
        assert!(replay.get("has_lifetime").is_none());
        assert!(replay.get("is_admin").is_none());
        assert!(replay.get("entitlements_verified").is_none());
    }

    #[test]
    fn app_ready_registry_promotes_most_recent_surviving_route() {
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("spp:pi"),
            Some("D8:3A:DD:31:B0:49"),
            serde_json::json!({ "platform": "web" }),
        );
        registry.register(
            Some("spp:mac"),
            Some("50:F2:65:EB:36:E1"),
            serde_json::json!({ "platform": "ios" }),
        );

        let active = registry.active().expect("active Mac route");
        assert_eq!(active.route.as_deref(), Some("spp:mac"));
        assert_eq!(active.source_peer.as_deref(), Some("50:F2:65:EB:36:E1"));
        assert_eq!(active.data["platform"], "ios");

        let promoted = registry
            .remove("spp:mac")
            .expect("Pi route should be promoted");
        assert_eq!(promoted.route.as_deref(), Some("spp:pi"));
        assert_eq!(promoted.source_peer.as_deref(), Some("D8:3A:DD:31:B0:49"));
        assert_eq!(promoted.data["platform"], "web");
    }

    #[test]
    fn app_ready_registry_ignores_non_owner_close() {
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("spp:pi"),
            Some("D8:3A:DD:31:B0:49"),
            serde_json::json!({ "platform": "web" }),
        );
        registry.register(
            Some("spp:mac"),
            Some("50:F2:65:EB:36:E1"),
            serde_json::json!({ "platform": "ios" }),
        );

        assert!(registry.remove("spp:pi").is_none());
        let active = registry.active().expect("Mac route should remain active");
        assert_eq!(active.route.as_deref(), Some("spp:mac"));
        assert_eq!(active.data["platform"], "ios");
    }

    #[test]
    fn active_route_platform_drives_matching_method_adapter() {
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("spp:pi"),
            Some("D8:3A:DD:31:B0:49"),
            serde_json::json!({ "platform": "web" }),
        );
        registry.register(
            Some("spp:mac"),
            Some("50:F2:65:EB:36:E1"),
            serde_json::json!({ "platform": "ios" }),
        );

        let active = registry.active().expect("active Mac route");
        let platform = active.data["platform"].as_str();
        let (native_method, _) =
            companion_music_request("spotify.auth.getStatus", serde_json::json!({}), platform)
                .expect("native request should decode")
                .expect("native request should be recognized");
        assert_eq!(native_method, "spotify.auth.get_status");

        let promoted = registry
            .remove("spp:mac")
            .expect("Pi route should be promoted");
        let platform = promoted.data["platform"].as_str();
        let (connector_method, _) =
            companion_music_request("spotify.auth.getStatus", serde_json::json!({}), platform)
                .expect("connector request should decode")
                .expect("connector request should be recognized");
        assert_eq!(connector_method, "spotify.auth.getStatus");
    }

    #[test]
    fn android_phone_request_targets_latest_exact_spp_route() {
        let peer = "D8:3A:DD:31:B0:49";
        let mut registry = AppReadyRegistry::default();
        registry.register(
            Some("spp:stale"),
            Some(peer),
            serde_json::json!({ "platform": "android" }),
        );
        registry.register(
            Some("spp:current"),
            Some(peer),
            serde_json::json!({ "platform": "android" }),
        );

        let active = registry.active().expect("active Android route");
        assert_eq!(phone_request_route(peer, Some(&active)), "spp:current");

        assert!(registry.remove("spp:stale").is_none());
        let active = registry.active().expect("current route remains active");
        assert_eq!(phone_request_route(peer, Some(&active)), "spp:current");
    }

    #[test]
    fn phone_request_preserves_iap2_routing_for_ios_and_other_peers() {
        let android = ActiveAppReady {
            data: serde_json::json!({ "platform": "android" }),
            route: Some("spp:android".to_string()),
            source_peer: Some("D8:3A:DD:31:B0:49".to_string()),
        };
        assert_eq!(
            phone_request_route("A8:AB:B5:AB:02:ED", Some(&android)),
            "iap2:A8:AB:B5:AB:02:ED"
        );

        let ios = ActiveAppReady {
            data: serde_json::json!({ "platform": "ios" }),
            route: Some("iap2:A8:AB:B5:AB:02:ED".to_string()),
            source_peer: Some("A8:AB:B5:AB:02:ED".to_string()),
        };
        assert_eq!(
            phone_request_route("A8:AB:B5:AB:02:ED", Some(&ios)),
            "iap2:A8:AB:B5:AB:02:ED"
        );
    }

    #[test]
    fn playback_active_from_now_playing_detects_playing_case_insensitively() {
        let data = serde_json::json!({
            "playback_attributes": {
                "PlaybackStatus": "Playing"
            }
        });

        assert_eq!(playback_active_from_now_playing(&data), Some(true));
    }

    #[test]
    fn playback_active_from_now_playing_detects_paused() {
        let data = serde_json::json!({
            "playback_attributes": {
                "PlaybackStatus": "paused"
            }
        });

        assert_eq!(playback_active_from_now_playing(&data), Some(false));
    }

    #[test]
    fn playback_active_from_now_playing_accepts_canonical_status_casing() {
        let data = serde_json::json!({
            "playback_attributes": {
                "playback_status": "playing"
            }
        });

        assert_eq!(playback_active_from_now_playing(&data), Some(true));
    }

    #[test]
    fn playback_active_from_now_playing_accepts_companion_status_casing() {
        let data = serde_json::json!({
            "playback_attributes": {
                "playbackStatus": "playing"
            }
        });

        assert_eq!(playback_active_from_now_playing(&data), Some(true));
    }
}
