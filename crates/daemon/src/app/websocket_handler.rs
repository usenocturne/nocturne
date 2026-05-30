use super::AppMessage;
use crate::audio;
use crate::error::Result;
use crate::hardware::ImageCache;
use crate::http::{canonical_music_request, WebSocketServer};
use audio::{AudioCommand, WakeWordCommand};
use bytes::Bytes;
use libnocturne::generated::audio::{AudioRecordStartResponse, AudioRecordStopResponse};
use libnocturne::generated::device::OnboardingSetStateRequest;
use libnocturne::generated::spotify::{SpotifyImageFetchRequest, SpotifyImageFetchResponse};
use libnocturne::generated::voice::{
    TtsSpeakRequest, TtsStopRequest, WakewordPauseRequest, WakewordPauseResponse,
    WakewordResumeRequest, WakewordResumeResponse,
};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, info, warn};

pub struct WebSocketProtocolHandler {
    websocket_server: Option<Arc<WebSocketServer>>,
    image_cache: Arc<Mutex<ImageCache>>,
    audio_cmd_tx: Option<mpsc::UnboundedSender<AudioCommand>>,
    wakeword_pause_tx: Option<mpsc::UnboundedSender<WakeWordCommand>>,
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

    pub fn set_wakeword_pause_tx(&mut self, tx: mpsc::UnboundedSender<WakeWordCommand>) {
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
            match canonical_music_request(
                method,
                data.get("params")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
            ) {
                Ok(Some((canonical_method, params))) => {
                    if canonical_method == "spotify.image.fetch" {
                        let request: SpotifyImageFetchRequest =
                            serde_json::from_value(params.clone())?;
                        debug!("Image fetch request for URL: {}", request.url);
                        let cache = self.image_cache.lock().await;

                        if let Some(base64_data) = cache.get(&request.url).await {
                            debug!(
                                "CACHE HIT - Returning cached image for URL: {}",
                                request.url
                            );
                            let response = serde_json::to_value(SpotifyImageFetchResponse {
                                url: request.url,
                                data: base64_data,
                                content_type: "image/jpeg".to_string(),
                            })?;

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

                        info!(
                            "CACHE MISS - Forwarding image fetch to iPhone for URL: {}",
                            request.url
                        );
                    }

                    let request = serde_json::json!({
                        "method": canonical_method,
                        "params": params
                    });

                    info!(
                        "Routing WebSocket Spotify request to iPhone: {}",
                        canonical_method
                    );

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                Ok(None) => {}
                Err(error) => {
                    warn!("Invalid WebSocket Spotify request {}: {}", method, error);
                    if let Some(ws_server) = &self.websocket_server {
                        let ws_server = Arc::clone(ws_server);
                        let id = message.id.clone();
                        tokio::spawn(async move {
                            ws_server.send_error(id, error).await;
                        });
                    }
                    return Ok(None);
                }
            }

            match method {
                "device.timezone.get" | "device.time.get" => {
                    let request = serde_json::json!({
                        "method": method,
                        "params": data.get("params").unwrap_or(&serde_json::Value::Null)
                    });

                    info!("Routing WebSocket request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                "tts.speak" => {
                    let params = data
                        .get("params")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let typed: TtsSpeakRequest = serde_json::from_value(params)?;
                    let request = serde_json::json!({
                        "method": method,
                        "params": serde_json::to_value(typed)?
                    });

                    info!("Routing WebSocket request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                "tts.stop" => {
                    let typed = TtsStopRequest;
                    let request = serde_json::json!({
                        "method": method,
                        "params": serde_json::to_value(typed)?
                    });

                    info!("Routing WebSocket request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                "onboarding.set_state" => {
                    let params = data
                        .get("params")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let typed: OnboardingSetStateRequest = serde_json::from_value(params)?;
                    let request = serde_json::json!({
                        "method": method,
                        "params": serde_json::to_value(typed)?
                    });

                    info!("Routing WebSocket request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        data: Bytes::from(serde_json::to_vec(&request)?),
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
                                        serde_json::to_value(AudioRecordStartResponse {
                                            status: "recording".to_string(),
                                        })
                                        .expect("generated audio response should serialize"),
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
                                        serde_json::to_value(AudioRecordStopResponse {
                                            status: "idle".to_string(),
                                        })
                                        .expect("generated audio response should serialize"),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                "wakeword.pause" => {
                    debug!("Wakeword pause requested");
                    let _typed = WakewordPauseRequest;
                    if let Some(tx) = &self.wakeword_pause_tx {
                        let _ = tx.send(WakeWordCommand::Pause {
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
                                        serde_json::to_value(WakewordPauseResponse {
                                            status: "paused".to_string(),
                                        })
                                        .expect("generated wakeword response should serialize"),
                                    )
                                    .await;
                            }
                        });
                    }

                    return Ok(None);
                }
                "wakeword.resume" => {
                    debug!("Wakeword resume requested");
                    let _typed = WakewordResumeRequest;
                    if let Some(tx) = &self.wakeword_pause_tx {
                        let _ = tx.send(WakeWordCommand::Resume { persist: true });
                    }

                    if let Some(ws_server) = &self.websocket_server {
                        tokio::spawn({
                            let ws_server = Arc::clone(ws_server);
                            let id = message.id.clone();
                            async move {
                                ws_server
                                    .send_response(
                                        id,
                                        serde_json::to_value(WakewordResumeResponse {
                                            status: "resumed".to_string(),
                                        })
                                        .expect("generated wakeword response should serialize"),
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
