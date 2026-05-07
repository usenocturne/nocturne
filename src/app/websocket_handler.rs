use super::AppMessage;
use crate::audio::AudioCommand;
use crate::error::Result;
use crate::image_cache::ImageCache;
use crate::websocket::WebSocketServer;
use bytes::Bytes;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};

pub struct WebSocketProtocolHandler {
    websocket_server: Option<Arc<WebSocketServer>>,
    image_cache: Arc<Mutex<ImageCache>>,
    audio_cmd_tx: Option<mpsc::UnboundedSender<AudioCommand>>,
    wakeword_pause_tx: Option<mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>>,
}

impl WebSocketProtocolHandler {
    #[allow(dead_code)]
    pub async fn new(websocket_server: Option<Arc<WebSocketServer>>) -> Result<Self> {
        let image_cache = Arc::new(Mutex::new(ImageCache::new().await?));
        Ok(Self {
            websocket_server,
            image_cache,
            audio_cmd_tx: None,
            wakeword_pause_tx: None,
        })
    }

    pub fn new_with_cache(
        websocket_server: Option<Arc<WebSocketServer>>,
        image_cache: Arc<Mutex<ImageCache>>,
    ) -> Self {
        Self {
            websocket_server,
            image_cache,
            audio_cmd_tx: None,
            wakeword_pause_tx: None,
        }
    }

    pub fn set_audio_cmd_tx(&mut self, tx: mpsc::UnboundedSender<AudioCommand>) {
        self.audio_cmd_tx = Some(tx);
    }

    pub fn set_wakeword_pause_tx(
        &mut self,
        tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) {
        self.wakeword_pause_tx = Some(tx);
    }
}

impl WebSocketProtocolHandler {
    pub fn protocol_name(&self) -> &str {
        "websocket.message"
    }

    pub async fn handle_message(&mut self, message: AppMessage) -> Result<Option<AppMessage>> {
        debug!("WebSocket handler received message: {}", message.id);

        let data: serde_json::Value = serde_json::from_slice(&message.data)?;

        if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
            match method {
                "spotify.image.fetch" => {
                    let params = data.get("params").unwrap_or(&serde_json::Value::Null);

                    if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                        debug!("Image fetch request for URL: {}", url);
                        let cache = self.image_cache.lock().await;

                        if let Some(base64_data) = cache.get(url).await {
                            debug!("CACHE HIT - Returning cached image for URL: {}", url);

                            let response = serde_json::json!({
                                "url": url,
                                "data": base64_data,
                                "contentType": "image/jpeg"
                            });

                            if let Some(ws_server) = &self.websocket_server {
                                tokio::spawn({
                                    let ws_server = Arc::clone(ws_server);
                                    let id = message.id.clone();
                                    async move {
                                        ws_server.send_response(id, response).await;
                                    }
                                });
                            }

                            return Ok(None);
                        }
                    }

                    let spotify_request = serde_json::json!({
                        "method": method,
                        "params": params
                    });

                    info!(
                        "CACHE MISS - Forwarding image fetch to iPhone for URL: {:?}",
                        params.get("url")
                    );

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&spotify_request)?),
                    }));
                }
                "spotify.auth.getStatus"
                | "spotify.artist.get"
                | "spotify.artist.topTracks"
                | "spotify.album.get"
                | "spotify.album.tracks"
                | "spotify.playlist.get"
                | "spotify.playlist.tracks"
                | "spotify.show.get"
                | "spotify.show.episodes"
                | "spotify.me.profile"
                | "spotify.player.state"
                | "spotify.player.queue"
                | "spotify.player.queue.add"
                | "spotify.player.transfer"
                | "spotify.player.play"
                | "spotify.player.pause"
                | "spotify.player.next"
                | "spotify.player.previous"
                | "spotify.player.seek"
                | "spotify.player.volume"
                | "spotify.player.shuffle"
                | "spotify.player.repeat"
                | "spotify.me.tracks"
                | "spotify.me.tracks.contains"
                | "spotify.me.tracks.save"
                | "spotify.me.tracks.remove"
                | "spotify.me.playlists"
                | "spotify.me.shows"
                | "spotify.me.shows.save"
                | "spotify.me.shows.remove"
                | "spotify.me.shows.contains"
                | "spotify.me.topArtists"
                | "spotify.me.topTracks"
                | "spotify.me.recentlyPlayed"
                | "spotify.devices"
                | "spotify.radio.mixes"
                | "spotify.radio.playlist"
                | "spotify.radio.topMix"
                | "spotify.radio.discoveries"
                | "spotify.track.lyrics"
                | "spotify.player.speed"
                | "spotify.dj.start"
                | "spotify.dj.signal"
                | "device.timezone.get"
                | "device.time.get"
                | "tts.speak"
                | "tts.stop" => {
                    let spotify_request = serde_json::json!({
                        "method": method,
                        "params": data.get("params").unwrap_or(&serde_json::Value::Null)
                    });

                    info!("Routing WebSocket Spotify request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&spotify_request)?),
                    }));
                }
                "audio.record.start" => {
                    debug!("Audio record start requested");
                    if let Some(tx) = &self.audio_cmd_tx {
                        let _ = tx.send(AudioCommand::Start);
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::json!({
                                            "status": "recording"
                                        }),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                "audio.record.stop" => {
                    debug!("Audio record stop requested");
                    if let Some(tx) = &self.audio_cmd_tx {
                        let _ = tx.send(AudioCommand::Stop);
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::json!({
                                            "status": "idle"
                                        }),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                "wakeword.pause" => {
                    debug!("Wakeword pause requested");
                    if let Some(tx) = &self.wakeword_pause_tx {
                        let _ = tx.send(crate::wakeword::WakeWordCommand::Pause {
                            ack: None,
                            persist: true,
                        });
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::json!({
                                            "status": "paused"
                                        }),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                "wakeword.resume" => {
                    debug!("Wakeword resume requested");
                    if let Some(tx) = &self.wakeword_pause_tx {
                        let _ = tx.send(crate::wakeword::WakeWordCommand::Resume { persist: true });
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::json!({
                                            "status": "resumed"
                                        }),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                _ => {
                    warn!("Unknown WebSocket method: {}", method);

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            let error_msg = format!("Unknown method: {}", method);
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::json!({
                                            "error": error_msg
                                        }),
                                    )
                                    .await;
                            }
                        });
                    }
                }
            }
        }

        Ok(None)
    }
}
