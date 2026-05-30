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
use libnocturne::generated::audio::AudioLevelEvent;
use libnocturne::generated::voice::VoiceWakewordEvent;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
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
    let range_proxy_handle = ota::RangeProxy::spawn(
        ota_events_tx.clone(),
        libnocturne::NOCTURNE_OTA_RANGE_PROXY_PORT,
    )
    .await;
    let transfers_dir = PathBuf::from("/var/lib/nocturne/transfers");
    let transfers = ota::transfer::ChunkedTransfer::new(transfers_dir.clone());
    let _transfer_reaper_cancel = CancellationToken::new();
    let _transfer_reaper =
        ota::transfer::spawn_reaper(transfers_dir, _transfer_reaper_cancel.clone());
    let terminators = ota::OtaTerminators {
        reboot: Arc::new(|| {
            #[cfg(feature = "device")]
            {
                if let Err(err) = std::process::Command::new("systemctl")
                    .arg("reboot")
                    .spawn()
                {
                    tracing::error!(?err, "failed to invoke systemctl reboot after OTA");
                }
            }
            #[cfg(not(feature = "device"))]
            tracing::info!("host OTA reboot terminator invoked (no-op)");
        }),
        restart_self: Arc::new(|| {
            #[cfg(feature = "device")]
            {
                if let Err(err) = std::process::Command::new("systemctl")
                    .args(["restart", "nocturned"])
                    .spawn()
                {
                    tracing::error!(
                        ?err,
                        "failed to invoke systemctl restart nocturned after OTA"
                    );
                }
            }
            #[cfg(not(feature = "device"))]
            tracing::info!("host OTA restart-self terminator invoked (no-op)");
        }),
    };
    let ota_handle = ota::OtaActor::spawn(
        transfers,
        ota_events_tx.clone(),
        terminators,
        range_proxy_handle.proxy.clone(),
        PathBuf::from("/var/lib/nocturne"),
    );
    let ws_for_ota = Arc::clone(&websocket_server);
    tokio::spawn(async move {
        while let Some(event) = ota_events_rx.recv().await {
            let (topic, data, target_peer) = match event {
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
                    None,
                ),
                ota::OtaEvent::Progress(progress) => (
                    "ota.progress".to_string(),
                    serde_json::to_value(progress).unwrap_or_else(|_| serde_json::json!({})),
                    None,
                ),
                ota::OtaEvent::Error(error) => (
                    "ota.error".to_string(),
                    serde_json::to_value(error).unwrap_or_else(|_| serde_json::json!({})),
                    None,
                ),
                ota::OtaEvent::Complete { update_id } => (
                    "ota.complete".to_string(),
                    serde_json::json!({ "updateId": update_id }),
                    None,
                ),
                ota::OtaEvent::AssetRange {
                    peer,
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
                    peer.map(|peer| peer.to_string()),
                ),
                ota::OtaEvent::AssetRangeAbandon { peer, abandon } => (
                    "ota.asset_range_abandon".to_string(),
                    serde_json::json!({
                        "request_id": abandon.request_id,
                        "requestId": abandon.request_id,
                    }),
                    peer.map(|peer| peer.to_string()),
                ),
            };
            ws_for_ota
                .broadcast_event(topic.clone(), data.clone())
                .await;

            let mut mobile_payload = serde_json::json!({
                "topic": topic,
                "data": data,
            });
            if let Some(peer) = target_peer {
                mobile_payload["_targetPeer"] = serde_json::json!(peer);
            }
            if let Ok(payload) = serde_json::to_vec(&mobile_payload) {
                let _ = app_manager_tx_for_ota.send(app::AppMessage {
                    id: uuid::Uuid::new_v4().to_string(),
                    protocol: "com.usenocturne.daemon".to_string(),
                    session_id: 1,
                    data: Bytes::from(payload),
                });
            }
        }
    });
    info!("OTA actor and range proxy started");

    hardware::start_ambient_light_task(Arc::clone(&websocket_server));
    info!("Ambient light sensor polling started");

    let (audio_capture, audio_event_rx) = audio::AudioCapture::new();
    let mut audio_events_for_wakeword = audio_capture.subscribe();
    let mut audio_events_for_mic_level = audio_capture.subscribe();
    let (audio_cmd_tx, audio_cmd_rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(audio_capture.run(audio_cmd_rx));
    info!("Audio capture initialized");

    let models_dir =
        std::env::var("WAKEWORD_MODELS_DIR").unwrap_or_else(|_| "/etc/nocturne/models".to_string());
    let threshold = std::env::var("WAKEWORD_THRESHOLD")
        .ok()
        .and_then(|s| s.parse::<f32>().ok())
        .unwrap_or(0.5);

    let (wakeword_detector, mut wakeword_event_rx) =
        audio::WakeWordDetector::new(models_dir, threshold);
    let (wakeword_pause_tx, wakeword_pause_rx) =
        mpsc::unbounded_channel::<audio::WakeWordCommand>();
    tokio::spawn(async move {
        if let Err(err) = wakeword_detector.run(wakeword_pause_rx).await {
            error!("Wake word detector error: {}", err);
        }
    });
    info!("Wake word detector initialized");

    let ws_for_wakeword = Arc::clone(&websocket_server);
    let audio_cmd_for_wakeword = audio_cmd_tx.clone();
    let wakeword_pause_for_handler = wakeword_pause_tx.clone();
    tokio::spawn(async move {
        while let Ok(event) = wakeword_event_rx.recv().await {
            match event {
                audio::WakeWordEvent::Detected {
                    ref keyword,
                    confidence,
                } => {
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
                    match tokio::time::timeout(std::time::Duration::from_secs(1), ack_rx).await {
                        Ok(Ok(())) => {}
                        _ => warn!("Wakeword pause ack timed out, proceeding anyway"),
                    }
                    let _ = audio_cmd_for_wakeword.send(audio::AudioCommand::Start);
                }
                audio::WakeWordEvent::StateChanged { muted } => {
                    ws_for_wakeword.update_last_wakeword_state(muted).await;
                }
            }
        }
    });

    let wakeword_pause_for_audio = wakeword_pause_tx.clone();
    tokio::spawn(async move {
        while let Ok(event) = audio_events_for_wakeword.recv().await {
            match event {
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
            }
        }
    });

    let ws_for_mic_level = Arc::clone(&websocket_server);
    tokio::spawn(async move {
        while let Ok(event) = audio_events_for_mic_level.recv().await {
            if let audio::AudioEvent::MicLevel { level } = event {
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
