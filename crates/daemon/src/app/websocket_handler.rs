use super::{AppMessage, AppMessagePriority};
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
    TtsSpeakRequest, TtsStopRequest, VoiceCancelRequest, WakewordPauseRequest,
    WakewordPauseResponse, WakewordResumeRequest, WakewordResumeResponse,
};
use std::{sync::Arc, time::Duration};
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;
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

    async fn pause_wakeword_for_recording(&self) {
        let Some(tx) = &self.wakeword_pause_tx else {
            return;
        };
        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
        if tx
            .send(WakeWordCommand::Pause {
                ack: Some(ack_tx),
                persist: false,
            })
            .is_err()
        {
            warn!("Failed to pause wakeword before starting audio recording");
            return;
        }

        match timeout(Duration::from_secs(1), ack_rx).await {
            Ok(Ok(())) => {}
            _ => warn!("Wakeword pause ack timed out, proceeding with audio recording"),
        }
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
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                "voice.cancel" => {
                    debug!(
                        "Voice cancel requested; stopping audio capture before routing to phone"
                    );
                    if let Some(tx) = &self.audio_cmd_tx {
                        let _ = tx.send(AudioCommand::Stop);
                    }

                    let typed = VoiceCancelRequest;
                    let request = serde_json::json!({
                        "method": method,
                        "params": serde_json::to_value(typed)?
                    });

                    info!("Routing WebSocket request to iPhone: {}", method);

                    return Ok(Some(AppMessage {
                        id: message.id,
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: message.session_id,
                        priority: AppMessagePriority::Normal,
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
                        priority: AppMessagePriority::Normal,
                        data: Bytes::from(serde_json::to_vec(&request)?),
                    }));
                }
                "audio.record.start" => {
                    debug!("Audio record start requested");
                    self.pause_wakeword_for_recording().await;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn websocket_message(method: &str) -> AppMessage {
        AppMessage {
            id: "request-1".to_string(),
            protocol: "websocket.message".to_string(),
            session_id: 1,
            priority: AppMessagePriority::Normal,
            data: Bytes::from(
                serde_json::to_vec(&serde_json::json!({
                    "method": method,
                    "params": {}
                }))
                .expect("test message should serialize"),
            ),
        }
    }

    #[tokio::test]
    async fn audio_start_pauses_wakeword_before_recording() {
        let image_cache = Arc::new(Mutex::new(ImageCache::with_dir(std::env::temp_dir())));
        let mut handler = WebSocketProtocolHandler::new_with_cache(None, image_cache);
        let (audio_tx, mut audio_rx) = mpsc::unbounded_channel();
        let (wakeword_tx, mut wakeword_rx) = mpsc::unbounded_channel();
        handler.set_audio_cmd_tx(audio_tx);
        handler.set_wakeword_pause_tx(wakeword_tx);

        let handle = tokio::spawn(async move {
            handler
                .handle_message(websocket_message("audio.record.start"))
                .await
        });

        let command = wakeword_rx
            .recv()
            .await
            .expect("audio start should pause wakeword first");
        let WakeWordCommand::Pause { ack, persist } = command else {
            panic!("audio start should pause wakeword");
        };
        assert!(!persist);
        assert!(audio_rx.try_recv().is_err());

        ack.expect("pause command should include ack")
            .send(())
            .expect("handler should wait for wakeword ack");

        assert_eq!(audio_rx.recv().await, Some(AudioCommand::Start));
        assert!(handle.await.expect("handler task should complete").is_ok());
    }
}
