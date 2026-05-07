mod ab;
mod app;
pub mod audio;
mod bluetooth;
mod bluetooth_agent;
mod brightness;
mod config;
mod error;
mod iap2_wrapper;
mod image_cache;
mod mfi;
mod mfi_impl;
mod wakeword;
mod websocket;

use anyhow::Result;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
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

    let config = config::Config::load()?;
    info!("Configuration loaded");

    if let Err(e) = brightness::init_brightness().await {
        warn!("Failed to initialize brightness: {}, continuing anyway", e);
    } else {
        info!("Brightness initialized");
    }

    let image_cache = match image_cache::ImageCache::new().await {
        Ok(cache) => Arc::new(Mutex::new(cache)),
        Err(e) => {
            warn!(
                "Failed to create image cache: {}, continuing without cache",
                e
            );
            return Ok(());
        }
    };
    info!("Image cache initialized");

    let (ws_to_app_tx, ws_to_app_rx) = mpsc::unbounded_channel();

    let websocket_server = Arc::new(websocket::WebSocketServer::new(
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

    brightness::start_ambient_light_task(Arc::clone(&websocket_server));
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
        wakeword::WakeWordDetector::new(models_dir, threshold);
    let (wakeword_pause_tx, wakeword_pause_rx) =
        mpsc::unbounded_channel::<wakeword::WakeWordCommand>();
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
                wakeword::WakeWordEvent::Detected {
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
                            serde_json::json!({
                                "keyword": keyword,
                                "confidence": confidence,
                            }),
                        )
                        .await;
                    let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
                    let _ = wakeword_pause_for_handler.send(wakeword::WakeWordCommand::Pause {
                        ack: Some(ack_tx),
                        persist: false,
                    });
                    match tokio::time::timeout(std::time::Duration::from_secs(1), ack_rx).await {
                        Ok(Ok(())) => {}
                        _ => warn!("Wakeword pause ack timed out, proceeding anyway"),
                    }
                    let _ = audio_cmd_for_wakeword.send(audio::AudioCommand::Start);
                }
                wakeword::WakeWordEvent::StateChanged { muted } => {
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
                    let _ = wakeword_pause_for_audio.send(wakeword::WakeWordCommand::Pause {
                        ack: None,
                        persist: false,
                    });
                }
                audio::AudioEvent::Stopped { .. } => {
                    let _ = wakeword_pause_for_audio
                        .send(wakeword::WakeWordCommand::Resume { persist: false });
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
                        serde_json::json!({ "level": level }),
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
    )
    .await?;

    info!("Starting Bluetooth daemon");
    match daemon.run().await {
        Ok(_) => info!("Daemon stopped normally"),
        Err(e) => error!("Daemon error: {}", e),
    }

    Ok(())
}
