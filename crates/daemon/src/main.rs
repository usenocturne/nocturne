mod app;
mod audio;
mod bluetooth;
mod error;
mod hardware;
mod http;
mod iap2;
mod ota;
mod system;

use anyhow::Result;
use bytes::Bytes;
use libnocturne::generated::audio::{AudioLevelEvent, WindLevelEvent};
use libnocturne::generated::voice::VoiceWakewordEvent;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nocturned=debug,iap2_rs=debug,bluer=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("nocturned - written by the Nocturne team");

    let config = system::Config::load()?;
    info!("Configuration loaded");

    if let Err(e) = hardware::init_brightness().await {
        warn!("Failed to initialize brightness: {}, continuing anyway", e);
    } else {
        info!("Brightness initialized");
    }

    let image_cache = match hardware::ImageCache::new().await {
        Ok(cache) => Arc::new(Mutex::new(cache)),
        Err(e) => {
            warn!(
                error = %e,
                "image cache disk init failed even after tmpfs fallback; continuing with a \
                 fresh in-memory directory and degraded artwork caching",
            );
            let scratch = std::env::temp_dir().join("nocturned-image-cache-fallback");
            let _ = tokio::fs::create_dir_all(&scratch).await;
            let cache = hardware::ImageCache::with_dir(scratch);
            Arc::new(Mutex::new(cache))
        }
    };
    info!("Image cache initialized");

    let (ws_to_app_tx, ws_to_app_rx) = mpsc::unbounded_channel();

    let app_manager_tx_for_ota = ws_to_app_tx.clone();

    let websocket_server = Arc::new(http::WebSocketServer::new(
        ws_to_app_tx,
        5000,
        Arc::clone(&image_cache),
    ));
    let ws_server_clone = Arc::clone(&websocket_server);

    tokio::spawn(async move {
        if let Err(e) = ws_server_clone.start().await {
            error!("WebSocket server error: {}", e);
        }
    });

    info!("WebSocket server started on port 5000");

    let webapps_dir: PathBuf = std::env::var("NOCTURNE_WEBAPPS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(http::DEFAULT_WEBAPPS_DIR));
    let webapp_addr: SocketAddr = http::DEFAULT_LISTEN.parse()?;
    tokio::spawn(async move {
        if let Err(e) = http::run(webapp_addr, webapps_dir).await {
            error!("Webapp HTTP server error: {}", e);
        }
    });
    info!("Webapp HTTP server task spawned (port 8080)");

    let (ota_events_tx, mut ota_events_rx) = mpsc::channel(64);
    let delta_source_handle = ota::DeltaSource::spawn(
        ota_events_tx.clone(),
        ota::delta_source::DEFAULT_SOCKET_PATH,
    )
    .await;
    let transfers_dir = PathBuf::from("/var/lib/nocturne/transfers");
    let transfers = ota::transfer::ChunkedTransfer::new(transfers_dir.clone());
    let _transfer_reaper_cancel = CancellationToken::new();
    let _transfer_reaper =
        ota::transfer::spawn_reaper(transfers_dir, _transfer_reaper_cancel.clone());
    let ota_handle = ota::OtaActor::spawn(
        transfers,
        ota_events_tx.clone(),
        delta_source_handle.source.clone(),
        PathBuf::from("/var/lib/nocturne"),
    );
    let ws_for_ota = Arc::clone(&websocket_server);
    tokio::spawn(async move {
        while let Some(event) = ota_events_rx.recv().await {
            let (topic, data, forward_to_mobile, target_peer, target_route) = match event {
                ota::OtaEvent::Begin {
                    update_id,
                    kind,
                    version,
                } => (
                    "ota.begin".to_string(),
                    serde_json::json!({
                        "updateId": update_id,
                        "kind": kind,
                        "version": version,
                    }),
                    false,
                    None,
                    None,
                ),
                ota::OtaEvent::Progress(progress) => (
                    "ota.progress".to_string(),
                    serde_json::to_value(progress).unwrap_or_else(|_| serde_json::json!({})),
                    false,
                    None,
                    None,
                ),
                ota::OtaEvent::Error(error) => (
                    "ota.error".to_string(),
                    serde_json::to_value(error).unwrap_or_else(|_| serde_json::json!({})),
                    true,
                    None,
                    None,
                ),
                ota::OtaEvent::Complete { update_id } => (
                    "ota.complete".to_string(),
                    serde_json::json!({ "updateId": update_id }),
                    true,
                    None,
                    None,
                ),
                ota::OtaEvent::AssetRange {
                    peer,
                    route,
                    request_id,
                    req,
                } => (
                    "ota.asset_range".to_string(),
                    serde_json::json!({
                        "request_id": request_id,
                        "requestId": request_id,
                        "updateId": req.update_id,
                        "asset": req.asset,
                        "ranges": req.ranges,
                    }),
                    true,
                    peer.map(|peer| peer.to_string()),
                    route,
                ),
                ota::OtaEvent::AssetRangeAbandon {
                    peer,
                    route,
                    abandon,
                } => (
                    "ota.asset_range_abandon".to_string(),
                    serde_json::json!({
                        "request_id": abandon.request_id,
                        "requestId": abandon.request_id,
                    }),
                    true,
                    peer.map(|peer| peer.to_string()),
                    route,
                ),
            };
            ws_for_ota
                .broadcast_event(topic.clone(), data.clone())
                .await;

            if forward_to_mobile {
                let mut mobile_payload = serde_json::json!({
                    "topic": topic,
                    "data": data,
                });
                if let Some(peer) = target_peer {
                    mobile_payload["_targetPeer"] = serde_json::json!(peer);
                }
                if let Some(route) = target_route {
                    mobile_payload["_targetConnection"] = serde_json::json!(route);
                }
                if let Ok(payload) = serde_json::to_vec(&mobile_payload) {
                    let _ = app_manager_tx_for_ota.send(app::AppMessage {
                        id: uuid::Uuid::new_v4().to_string(),
                        protocol: "com.usenocturne.daemon".to_string(),
                        session_id: 1,
                        priority: app::AppMessagePriority::Bulk,
                        data: Bytes::from(payload),
                    });
                }
            }
        }
    });
    info!("OTA actor and delta source started");

    hardware::start_ambient_light_task(Arc::clone(&websocket_server));
    info!("Ambient light sensor polling started");

    let (wind_frame_tx, mut wind_event_rx) = audio::start_wind_detector();
    let (audio_capture, audio_event_rx) = audio::AudioCapture::new(wind_frame_tx.clone());
    let mut audio_events_for_wakeword = audio_capture.subscribe();
    let mut audio_events_for_mic_level = audio_capture.subscribe();
    let (audio_cmd_tx, audio_cmd_rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(audio_capture.run(audio_cmd_rx));
    info!("Audio capture initialized");

    let models_dir =
        std::env::var("WAKEWORD_MODELS_DIR").unwrap_or_else(|_| "/etc/nocturne/models".to_string());
    let threshold = audio::threshold_from_env("WAKEWORD_THRESHOLD", 0.65);
    let support_threshold =
        audio::threshold_from_env("WAKEWORD_SUPPORT_THRESHOLD", threshold.min(0.5));
    let default_playback_threshold = threshold.max(0.9);
    let configured_playback_threshold =
        audio::threshold_from_env("WAKEWORD_PLAYBACK_THRESHOLD", default_playback_threshold);
    let playback_threshold = if configured_playback_threshold < threshold {
        warn!(
            configured_playback_threshold,
            activation_threshold = threshold,
            "Playback wake word threshold is below the activation threshold; using the activation threshold"
        );
        threshold
    } else {
        configured_playback_threshold
    };
    info!(
        activation_threshold = threshold,
        support_threshold, playback_threshold, "Wake word sensitivity configured"
    );

    let (wakeword_detector, mut wakeword_event_rx) = audio::WakeWordDetector::new(
        models_dir,
        threshold,
        support_threshold,
        playback_threshold,
        websocket_server.playback_active_flag(),
        wind_frame_tx,
    );
    let (wakeword_pause_tx, wakeword_pause_rx) =
        mpsc::unbounded_channel::<audio::WakeWordCommand>();
    tokio::spawn(async move {
        if let Err(err) = wakeword_detector.run(wakeword_pause_rx).await {
            error!("Wake word detector error: {}", err);
        }
    });
    info!("Wake word detector initialized");

    let ws_for_wind = Arc::clone(&websocket_server);
    tokio::spawn(async move {
        loop {
            match wind_event_rx.recv().await {
                Ok(reading) => {
                    ws_for_wind
                        .broadcast_event(
                            "wind_level".to_string(),
                            serde_json::to_value(WindLevelEvent {
                                level: reading.level,
                                stat: f64::from(reading.stat),
                            })
                            .expect("generated wind level event should serialize"),
                        )
                        .await;
                }
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(skipped, "wind detector event receiver lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let ws_for_wakeword = Arc::clone(&websocket_server);
    let audio_cmd_for_wakeword = audio_cmd_tx.clone();
    let wakeword_pause_for_handler = wakeword_pause_tx.clone();
    tokio::spawn(async move {
        loop {
            match wakeword_event_rx.recv().await {
                Ok(event) => match event {
                    audio::WakeWordEvent::Detected {
                        ref keyword,
                        confidence,
                    } => {
                        if !ws_for_wakeword.has_ready_app_session().await {
                            warn!(
                                "Ignoring wake word '{}' because no companion app session is ready",
                                keyword
                            );
                            let _ = wakeword_pause_for_handler
                                .send(audio::WakeWordCommand::RejectDetection);
                            continue;
                        }
                        info!(
                            "Wake word detected: {} (confidence: {:.2})",
                            keyword, confidence
                        );
                        ws_for_wakeword
                            .broadcast_event(
                                "voice.wakeword".to_string(),
                                serde_json::to_value(VoiceWakewordEvent {
                                    keyword: keyword.to_string(),
                                    confidence: f64::from(confidence),
                                })
                                .expect("generated voice wakeword event should serialize"),
                            )
                            .await;
                        let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
                        let _ = wakeword_pause_for_handler.send(audio::WakeWordCommand::Pause {
                            ack: Some(ack_tx),
                            persist: false,
                        });
                        match tokio::time::timeout(std::time::Duration::from_secs(1), ack_rx).await
                        {
                            Ok(Ok(())) => {}
                            _ => warn!("Wakeword pause ack timed out, proceeding anyway"),
                        }
                        let _ = audio_cmd_for_wakeword.send(audio::AudioCommand::Start);
                    }
                    audio::WakeWordEvent::StateChanged { muted } => {
                        ws_for_wakeword.update_last_wakeword_state(muted).await;
                    }
                },
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        skipped,
                        "wakeword event receiver lagged; continuing with future events"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let wakeword_pause_for_audio = wakeword_pause_tx.clone();
    tokio::spawn(async move {
        loop {
            match audio_events_for_wakeword.recv().await {
                Ok(event) => match event {
                    audio::AudioEvent::Started { .. } => {
                        let _ = wakeword_pause_for_audio.send(audio::WakeWordCommand::Pause {
                            ack: None,
                            persist: false,
                        });
                    }
                    audio::AudioEvent::Stopped { .. } => {
                        let _ = wakeword_pause_for_audio
                            .send(audio::WakeWordCommand::Resume { persist: false });
                    }
                    audio::AudioEvent::Data { .. } => {}
                    audio::AudioEvent::MicLevel { .. } => {}
                },
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        skipped,
                        "audio wakeword bridge lagged; continuing with future events"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let ws_for_mic_level = Arc::clone(&websocket_server);
    tokio::spawn(async move {
        loop {
            match audio_events_for_mic_level.recv().await {
                Ok(audio::AudioEvent::MicLevel { level }) => {
                    ws_for_mic_level
                        .broadcast_event(
                            "audio.level".to_string(),
                            serde_json::to_value(AudioLevelEvent {
                                level: level.into(),
                            })
                            .expect("generated audio event should serialize"),
                        )
                        .await;
                }
                Ok(_) => {}
                Err(broadcast::error::RecvError::Lagged(skipped)) => {
                    warn!(
                        skipped,
                        "audio mic-level bridge lagged; continuing with future events"
                    );
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut daemon = bluetooth::BluetoothDaemon::new(
        config,
        Some(ws_to_app_rx),
        Some(websocket_server),
        audio_event_rx,
        audio_cmd_tx,
        wakeword_pause_tx,
        Some(ota_handle.cmd_tx.clone()),
    )
    .await?;

    info!("Starting Bluetooth daemon");
    match daemon.run().await {
        Ok(_) => info!("Daemon stopped normally"),
        Err(e) => error!("Daemon error: {}", e),
    }

    Ok(())
}
