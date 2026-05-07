use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use bluer::{rfcomm::Stream, Address};
use bytes::Bytes;
use iap2_rs::{
    connect, ConnectionConfig, ConnectionEvent, DeviceIdentification, FileTransferConfig,
    HidCommand, HidComponent, HidConfig, HidFunction, Iap2Config, Iap2Connection as LibConnection,
    LinkConfig, NowPlayingConfig, PowerConfig,
};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, error, info, warn};

use crate::app::{
    msgpack::{create_audio_data_event, create_audio_lifecycle_event, MsgPackProtocolHandler},
    websocket_handler::WebSocketProtocolHandler,
    AppCommunicationManager, AppMessage, AppProtocolHandlerEnum,
};
use crate::audio::{AudioCommand, AudioEvent};
use crate::error::{NocturnedError, Result};
use crate::mfi_impl::HardwareMfiProvider;
use crate::websocket::WebSocketServer;

#[derive(Default, Clone)]
struct NowPlayingState {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
    status: Option<String>,
    elapsed_ms: Option<u64>,
    shuffle_mode: Option<String>,
    repeat_mode: Option<String>,
    app_name: Option<String>,
}

impl NowPlayingState {
    fn to_json(&self) -> serde_json::Value {
        let mut json = serde_json::json!({});

        let mut media_json = serde_json::json!({});
        let mut has_media = false;
        if let Some(ref title) = self.title {
            media_json["MediaItemTitle"] = serde_json::json!(title);
            has_media = true;
        }
        if let Some(ref artist) = self.artist {
            let cleaned = artist
                .replace(" • Video Available", "")
                .replace("Video Available • ", "")
                .replace("Video Available", "")
                .replace(" • Lossless", "")
                .replace("Lossless • ", "")
                .replace("Lossless", "");
            media_json["MediaItemArtist"] = serde_json::json!(cleaned);
            has_media = true;
        }
        if let Some(ref album) = self.album {
            media_json["MediaItemAlbum"] = serde_json::json!(album);
            has_media = true;
        }
        if let Some(duration) = self.duration_ms {
            media_json["MediaItemDuration"] = serde_json::json!(duration);
            has_media = true;
        }
        if has_media {
            json["MediaItemAttributes"] = media_json;
        }

        let mut pb_json = serde_json::json!({});
        let mut has_playback = false;
        if let Some(ref status) = self.status {
            pb_json["PlaybackStatus"] = serde_json::json!(status);
            has_playback = true;
        }
        if let Some(elapsed) = self.elapsed_ms {
            pb_json["PlaybackElapsedTime"] = serde_json::json!(elapsed);
            has_playback = true;
        }
        if let Some(ref shuffle) = self.shuffle_mode {
            pb_json["PlaybackShuffleMode"] = serde_json::json!(shuffle);
            has_playback = true;
        }
        if let Some(ref repeat) = self.repeat_mode {
            pb_json["PlaybackRepeatMode"] = serde_json::json!(repeat);
            has_playback = true;
        }
        if let Some(ref app) = self.app_name {
            pb_json["PlaybackAppName"] = serde_json::json!(app);
            has_playback = true;
        }
        if has_playback {
            json["PlaybackAttributes"] = pb_json;
        }

        json
    }

    fn clear(&mut self) {
        *self = Self::default();
    }
}

#[derive(Clone)]
pub struct Iap2Connection {
    device_address: Address,
    running: Arc<Mutex<bool>>,
    user_initiated_disconnect: Arc<Mutex<bool>>,
    websocket_tx: mpsc::UnboundedSender<AppMessage>,
}

impl Iap2Connection {
    pub fn address(&self) -> Address {
        self.device_address
    }

    pub fn user_disconnect_flag(&self) -> Arc<Mutex<bool>> {
        self.user_initiated_disconnect.clone()
    }

    pub async fn new(
        device_address: Address,
        stream: Stream,
        websocket_server: Option<Arc<WebSocketServer>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) -> Result<Self> {
        let (websocket_tx, websocket_rx) = mpsc::unbounded_channel();
        let (hid_tx, hid_rx) = mpsc::unbounded_channel();

        let running = Arc::new(Mutex::new(false));
        let user_initiated_disconnect = Arc::new(Mutex::new(false));

        let conn = Iap2Connection {
            device_address,
            running,
            user_initiated_disconnect,
            websocket_tx,
        };

        let running_clone = conn.running.clone();
        let address = device_address;
        let ws_server = websocket_server.clone();

        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();

        tokio::spawn(async move {
            let result = run_iap2_connection(
                address,
                stream,
                ws_server,
                websocket_rx,
                hid_tx,
                hid_rx,
                running_clone.clone(),
                ready_tx,
                audio_event_rx,
                audio_cmd_tx,
                wakeword_pause_tx,
            )
            .await;

            if let Err(e) = result {
                error!("iAP2 connection error for {}: {}", address, e);
            }

            *running_clone.lock().await = false;
        });

        match ready_rx.await {
            Ok(Ok(())) => Ok(conn),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(NocturnedError::Iap2Protocol(
                "Connection task terminated unexpectedly".to_string(),
            )),
        }
    }

    pub async fn run(self) -> Result<()> {
        loop {
            if !*self.running.lock().await {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
        Ok(())
    }

    pub async fn send_websocket_message(&self, message: AppMessage) -> Result<()> {
        self.websocket_tx.send(message).map_err(|e| {
            NocturnedError::Iap2Protocol(format!("Failed to send WebSocket message: {}", e))
        })
    }

    pub async fn close(&mut self) {
        *self.running.lock().await = false;
        info!("Closing iAP2 connection for {}", self.device_address);
    }

    pub async fn mark_user_initiated_disconnect(&self) {
        *self.user_initiated_disconnect.lock().await = true;
    }
}

async fn run_iap2_connection(
    device_address: Address,
    stream: Stream,
    websocket_server: Option<Arc<WebSocketServer>>,
    mut websocket_rx: mpsc::UnboundedReceiver<AppMessage>,
    hid_tx: mpsc::UnboundedSender<HidCommand>,
    mut hid_rx: mpsc::UnboundedReceiver<HidCommand>,
    running: Arc<Mutex<bool>>,
    ready_tx: tokio::sync::oneshot::Sender<Result<()>>,
    mut audio_event_rx: broadcast::Receiver<AudioEvent>,
    audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
) -> Result<()> {
    info!("Starting iAP2 connection handler for {}", device_address);

    let identification = build_device_identification()?;
    let mfi_provider = Arc::new(HardwareMfiProvider::new());

    let config = Iap2Config {
        identification,
        mfi_provider,
        enable_now_playing: true,
        enable_hid: true,
        link_config: LinkConfig::default(),
        now_playing_config: NowPlayingConfig {
            media_item_attributes: vec![
                0x0001, // MediaItemTitle
                0x0004, // MediaItemPlaybackDurationInMilliseconds
                0x000C, // MediaItemArtist
                0x001A, // MediaItemArtworkFileTransferIdentifier
            ],
            playback_attributes: vec![
                0x0000, // PlaybackStatus
                0x0005, // PlaybackShuffleMode
                0x0006, // PlaybackRepeatMode
                0x0007, // PlaybackAppName
            ],
        },
        hid_config: HidConfig::default(),
        file_transfer_config: FileTransferConfig::default(),
        connection_config: ConnectionConfig::default(),
        power_config: PowerConfig::default(),
    };

    let mut lib_conn = match connect(stream, config).await {
        Ok(c) => c,
        Err(e) => {
            let err_msg = e.to_string();
            let _ = ready_tx.send(Err(NocturnedError::Iap2Protocol(err_msg.clone())));
            return Err(NocturnedError::Iap2Protocol(err_msg));
        }
    };

    *running.lock().await = true;

    let _ = ready_tx.send(Ok(()));

    let (ea_data_tx, mut ea_data_rx) = mpsc::unbounded_channel();
    let mut app_manager = AppCommunicationManager::new(ea_data_tx);

    if let Some(ref ws_server) = websocket_server {
        let image_cache = ws_server.image_cache();

        let mut ws_handler = WebSocketProtocolHandler::new_with_cache(
            Some(Arc::clone(ws_server)),
            Arc::clone(&image_cache),
        );
        ws_handler.set_audio_cmd_tx(audio_cmd_tx);
        ws_handler.set_wakeword_pause_tx(wakeword_pause_tx.clone());
        app_manager.register_handler(AppProtocolHandlerEnum::WebSocket(ws_handler));

        let mut mp_handler = MsgPackProtocolHandler::with_image_cache(
            Some(Arc::clone(ws_server)),
            Arc::clone(&image_cache),
        );
        mp_handler.set_hid_tx(hid_tx.clone());
        app_manager.register_handler(AppProtocolHandlerEnum::MsgPack(Box::new(mp_handler)));
    }

    let mut ea_session_id: Option<u8> = None;
    let mut ea_session_rx: Option<mpsc::UnboundedReceiver<Bytes>> = None;
    let mut ea_session_tx: Option<mpsc::UnboundedSender<(u8, Bytes)>> = None;

    let app_ready_received = app_manager
        .app_ready_flag()
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));

    let mut now_playing_state = NowPlayingState::default();

    let heartbeat_interval = Duration::from_secs(10);
    let daemon_ready_interval = Duration::from_secs(3);
    let mut last_heartbeat = Instant::now();
    let mut last_daemon_ready = Instant::now();
    let mut audio_events_closed = false;

    while *running.lock().await {
        let ea_data_future = async {
            match &mut ea_session_rx {
                Some(rx) => rx.recv().await,
                None => std::future::pending::<Option<Bytes>>().await,
            }
        };

        tokio::select! {
            event = lib_conn.events.recv() => {
                match event {
                    Some(event) => {
                        info!("Connection event: {:?}", std::mem::discriminant(&event));
                        handle_connection_event(
                            &event,
                            &websocket_server,
                            &device_address,
                            &mut now_playing_state,
                        ).await;

                        if matches!(event, ConnectionEvent::Disconnected) {
                            break;
                        }
                    }
                    None => {
                        info!("Event channel closed");
                        break;
                    }
                }
            }

            ea_session = lib_conn.ea_sessions.recv() => {
                if let Some(session) = ea_session {
                    info!("New EA session received: id={}, protocol={}", session.session_id, session.protocol);

                    if let Err(e) = app_manager.create_session(
                        session.session_id,
                        session.protocol.clone(),
                    ) {
                        error!("Failed to create app session: {}", e);
                    }

                    ea_session_id = Some(session.session_id);
                    ea_session_rx = Some(session.rx);
                    ea_session_tx = Some(session.tx_to_iphone);

                    send_daemon_ready(session.session_id, &ea_session_tx);
                    last_daemon_ready = Instant::now();
                }
            }

            ea_data = ea_data_future => {
                if let Some(data) = ea_data {
                    if let Some(session_id) = ea_session_id {
                        info!("FROM_IPHONE: Received EA data: {} bytes for session {}", data.len(), session_id);
                        if let Err(e) = app_manager
                            .handle_incoming_data(session_id, data)
                            .await
                        {
                            error!("Failed to handle EA data: {}", e);
                        }
                    }
                } else if ea_session_rx.is_some() {
                    info!("EA session channel closed");
                    ea_session_id = None;
                    ea_session_rx = None;
                    ea_session_tx = None;
                }
            }

            ea_out = ea_data_rx.recv() => {
                if let Some((session_id, data)) = ea_out {
                    info!("TO_IPHONE: Sending EA data: {} bytes for session {}", data.len(), session_id);
                    if let Some(ref tx) = ea_session_tx {
                        if let Err(e) = tx.send((session_id, data)) {
                            error!("Failed to send EA data: {}", e);
                        }
                    } else {
                        warn!("No active EA session to send data to");
                    }
                }
            }

            ws_msg = websocket_rx.recv() => {
                if let Some(message) = ws_msg {
                    info!("WebSocket message received: {}", message.id);
                    if let Err(e) = handle_websocket_message_new(
                        &message,
                        &mut app_manager,
                        ea_session_id,
                        &ea_session_tx,
                        &websocket_server,
                        &lib_conn,
                    ).await {
                        error!("Failed to handle WebSocket message: {}", e);
                    }
                }
            }

            hid_cmd = hid_rx.recv() => {
                if let Some(cmd) = hid_cmd {
                    info!("Sending HID command: {:?}", cmd);
                    if let Err(e) = lib_conn.send_hid_command(cmd) {
                        error!("Failed to send HID command: {}", e);
                    }
                }
            }

            audio_event = audio_event_rx.recv(), if !audio_events_closed => {
                match audio_event {
                    Ok(event) => {
                        if let Some(session_id) = ea_session_id {
                            let msg = match &event {
                                AudioEvent::Data { seq, opus_data, timestamp_ms } => {
                                    create_audio_data_event(*seq, opus_data, *timestamp_ms)
                                }
                                AudioEvent::Started { sample_rate, channels, frame_ms } => {
                                    create_audio_lifecycle_event("audio.recording.started", serde_json::json!({
                                        "sampleRate": sample_rate,
                                        "channels": channels,
                                        "frameMs": frame_ms,
                                    }))
                                }
                                AudioEvent::Stopped { reason, total_frames } => {
                                    create_audio_lifecycle_event("audio.recording.stopped", serde_json::json!({
                                        "reason": reason,
                                        "totalFrames": total_frames,
                                    }))
                                }
                                AudioEvent::MicLevel { .. } => continue,
                            };
                            if let Ok(serialized) = rmp_serde::to_vec_named(&msg) {
                                if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) {
                                    for chunk in chunks {
                                        if let Some(ref tx) = ea_session_tx {
                                            let _ = tx.send((session_id, chunk));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        warn!("iAP2 audio event receiver lagged by {} messages", n);
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Audio event channel closed for iAP2 handler");
                        audio_events_closed = true;
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_millis(500)) => {
                if let Some(session_id) = ea_session_id {
                    if !app_ready_received.load(Ordering::Relaxed)
                        && last_daemon_ready.elapsed() >= daemon_ready_interval
                    {
                        send_daemon_ready(session_id, &ea_session_tx);
                        last_daemon_ready = Instant::now();
                    }
                }

                if last_heartbeat.elapsed() >= heartbeat_interval {
                    if let Some(session_id) = ea_session_id {
                        let timestamp = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);

                        let event = crate::app::msgpack::MsgPackMessage::Event {
                            topic: "daemon.heartbeat".to_string(),
                            data: serde_json::json!({ "timestamp": timestamp }),
                        };

                        if let Ok(serialized) = rmp_serde::to_vec_named(&event) {
                            if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) {
                                for chunk in chunks {
                                    if let Some(ref tx) = ea_session_tx {
                                        let _ = tx.send((session_id, chunk));
                                    }
                                }
                                debug!("Sent heartbeat to iOS app (session {})", session_id);
                            }
                        }
                    }
                    last_heartbeat = Instant::now();
                }
            }
        }
    }

    info!("iAP2 connection handler stopped for {}", device_address);
    Ok(())
}

fn send_daemon_ready(session_id: u8, ea_session_tx: &Option<mpsc::UnboundedSender<(u8, Bytes)>>) {
    let event = crate::app::msgpack::MsgPackMessage::Event {
        topic: "daemon.ready".to_string(),
        data: serde_json::json!({}),
    };

    if let Ok(serialized) = rmp_serde::to_vec_named(&event) {
        if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) {
            for chunk in chunks {
                if let Some(ref tx) = ea_session_tx {
                    let _ = tx.send((session_id, chunk));
                }
            }
            info!("Sent daemon.ready to phone (session {})", session_id);
        }
    }
}

fn build_device_identification() -> Result<DeviceIdentification> {
    let serial_number = crate::config::get_serial_number()?;
    let last_four = if serial_number.len() >= 4 {
        &serial_number[serial_number.len() - 4..]
    } else {
        &serial_number
    };
    let name = format!("Nocturne ({})", last_four);
    let firmware_version = crate::config::get_firmware_version()?;

    Ok(DeviceIdentification {
        name,
        model_identifier: "YX5H6679".to_string(),
        manufacturer: "Vanta Labs".to_string(),
        serial_number,
        firmware_version,
        hardware_version: "1".to_string(),
        messages_sent: vec![
            0xEA02, 0xEA03, 0x6800, 0x6802, 0x6803, 0x5000, 0x5002, 0x4157, 0x4159, 0x4154, 0x4156,
            0x415B, 0x415C,
        ],
        messages_received: vec![0xEA00, 0xEA01, 0x6801, 0x5001, 0x4158, 0x4155],
        ea_protocol_name: "com.usenocturne.daemon".to_string(),
        bundle_seed_id: Some("A8CCNQDH4A".to_string()),
        current_language: "en".to_string(),
        supported_languages: vec!["en".to_string()],
        hid_components: vec![
            HidComponent {
                id: 0x1092,
                name: "Nocturne".to_string(),
                function: HidFunction::None,
                extra_data: Some(vec![0x30, 0xE3, 0xD6, 0x05, 0x9A, 0x7D]),
            },
            HidComponent {
                id: 0x14E9,
                name: "Nocturne".to_string(),
                function: HidFunction::MediaPlaybackRemote,
                extra_data: None,
            },
        ],
    })
}

async fn handle_connection_event(
    event: &ConnectionEvent,
    websocket_server: &Option<Arc<WebSocketServer>>,
    device_address: &Address,
    now_playing_state: &mut NowPlayingState,
) {
    match event {
        ConnectionEvent::LinkEstablished => {
            info!("Link established with {}", device_address);
        }
        ConnectionEvent::AuthenticationStarted => {
            info!("Authentication started with {}", device_address);
            if let Some(ws_server) = websocket_server {
                ws_server
                    .broadcast_event(
                        "bluetooth.mfi".to_string(),
                        serde_json::json!({
                            "event": "authentication_started",
                            "device": device_address.to_string()
                        }),
                    )
                    .await;
            }
        }
        ConnectionEvent::AuthenticationSucceeded => {
            info!("Authentication succeeded with {}", device_address);
            if let Some(ws_server) = websocket_server {
                ws_server
                    .broadcast_event(
                        "bluetooth.mfi".to_string(),
                        serde_json::json!({
                            "event": "authentication_succeeded",
                            "device": device_address.to_string()
                        }),
                    )
                    .await;
            }
        }
        ConnectionEvent::AuthenticationFailed { reason } => {
            error!("Authentication failed with {}: {}", device_address, reason);
            if let Some(ws_server) = websocket_server {
                ws_server
                    .broadcast_event(
                        "bluetooth.mfi".to_string(),
                        serde_json::json!({
                            "event": "authentication_failed",
                            "device": device_address.to_string(),
                            "reason": reason
                        }),
                    )
                    .await;
            }
        }
        ConnectionEvent::IdentificationAccepted => {
            info!("Identification accepted by {}", device_address);
        }
        ConnectionEvent::IdentificationRejected => {
            warn!("Identification rejected by {}", device_address);
        }
        ConnectionEvent::EaSessionStarted { session_id } => {
            info!("EA session {} started", session_id);
        }
        ConnectionEvent::EaSessionStopped { session_id } => {
            info!("EA session {} stopped", session_id);
        }
        ConnectionEvent::NowPlayingUpdate { update } => {
            debug!("Now playing update received");

            if let Some(ref playback) = update.playback {
                if let Some(ref status) = playback.status {
                    if status.as_str() == "stopped" {
                        now_playing_state.clear();
                    }
                }
            }

            if let Some(ref media) = update.media_item {
                if let Some(ref title) = media.title {
                    now_playing_state.title = Some(title.clone());
                }
                if let Some(ref artist) = media.artist {
                    now_playing_state.artist = Some(artist.clone());
                }
                if let Some(ref album) = media.album {
                    now_playing_state.album = Some(album.clone());
                }
                if let Some(duration) = media.duration_ms {
                    now_playing_state.duration_ms = Some(duration as u64);
                }
            }
            if let Some(ref playback) = update.playback {
                if let Some(ref status) = playback.status {
                    now_playing_state.status = Some(status.as_str().to_string());
                }
                if let Some(elapsed) = playback.elapsed_ms {
                    now_playing_state.elapsed_ms = Some(elapsed as u64);
                }
                if let Some(ref shuffle) = playback.shuffle_mode {
                    now_playing_state.shuffle_mode = Some(shuffle.as_str().to_string());
                }
                if let Some(ref repeat) = playback.repeat_mode {
                    now_playing_state.repeat_mode = Some(repeat.as_str().to_string());
                }
                if let Some(ref app) = playback.app_name {
                    now_playing_state.app_name = Some(app.clone());
                }
            }

            if let Some(ws_server) = websocket_server {
                let json = now_playing_state.to_json();
                ws_server
                    .broadcast_event("media.nowPlaying.update".to_string(), json)
                    .await;
            }
        }
        ConnectionEvent::HidRemoteStarted => {
            info!("HID remote started");
        }
        ConnectionEvent::HidRemoteStopped => {
            info!("HID remote stopped");
        }
        ConnectionEvent::FileTransferComplete {
            transfer_id,
            file_type,
            data,
        } => {
            info!(
                "File transfer complete: id=0x{:02X}, type=0x{:04X}, {} bytes",
                transfer_id,
                file_type,
                data.len()
            );
            if let Some(ws_server) = websocket_server {
                ws_server.cancel_all_pending_image_fetches().await;

                let base64_data = base64::engine::general_purpose::STANDARD.encode(data);
                ws_server
                    .broadcast_event(
                        "media.nowPlaying.artwork".to_string(),
                        serde_json::json!({
                            "data": base64_data,
                            "contentType": "image/jpeg"
                        }),
                    )
                    .await;
            }
        }
        ConnectionEvent::FileTransferCorrupted { transfer_id } => {
            warn!(
                "File transfer corrupted: id=0x{:02X}, notifying UI to fetch artwork via Spotify",
                transfer_id
            );
            if let Some(ws_server) = websocket_server {
                ws_server
                    .broadcast_event(
                        "media.nowPlaying.artwork.failed".to_string(),
                        serde_json::json!({
                            "transfer_id": transfer_id
                        }),
                    )
                    .await;
            }
        }
        ConnectionEvent::Error { error } => {
            error!("Connection error: {}", error);
        }
        ConnectionEvent::Disconnected => {
            info!("Disconnected from {}", device_address);
        }
    }
}

async fn handle_websocket_message_new(
    message: &AppMessage,
    app_manager: &mut AppCommunicationManager,
    ea_session_id: Option<u8>,
    ea_session_tx: &Option<mpsc::UnboundedSender<(u8, Bytes)>>,
    websocket_server: &Option<Arc<WebSocketServer>>,
    lib_conn: &LibConnection,
) -> Result<()> {
    info!("Routing WebSocket message: {} ", message.id);

    let ws_data: serde_json::Value = serde_json::from_slice(&message.data)?;
    let method = ws_data
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or("unknown");
    let params = ws_data
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    info!("WebSocket method: {}", method);

    if method.starts_with("media.control.") {
        let cmd = crate::app::hid_mapping::method_to_hid_command(method);

        if let Some(cmd) = cmd {
            info!("Sending HID command for {}", method);
            match lib_conn.send_hid_command(cmd) {
                Ok(()) => {
                    if let Some(ws_server) = websocket_server {
                        ws_server
                            .send_response(
                                message.id.clone(),
                                serde_json::json!({ "status": "ok" }),
                            )
                            .await;
                    }
                }
                Err(e) => {
                    error!("Failed to send HID command: {}", e);
                    if let Some(ws_server) = websocket_server {
                        ws_server
                            .send_error(message.id.clone(), e.to_string())
                            .await;
                    }
                }
            }
            return Ok(());
        }
    }

    if method == "device.launchApp" {
        let bundle_id = params
            .get("bundleId")
            .and_then(|v| v.as_str())
            .unwrap_or("com.usenocturne.nocturne");

        match lib_conn.request_app_launch(bundle_id.to_string()) {
            Ok(()) => {
                info!("Sent RequestAppLaunch for {}", bundle_id);
                if let Some(ws_server) = websocket_server {
                    ws_server
                        .send_response(message.id.clone(), serde_json::json!({ "status": "ok" }))
                        .await;
                }
            }
            Err(e) => {
                error!("Failed to send RequestAppLaunch: {}", e);
                if let Some(ws_server) = websocket_server {
                    ws_server
                        .send_error(message.id.clone(), e.to_string())
                        .await;
                }
            }
        }
        return Ok(());
    }

    if let (Some(session_id), Some(tx)) = (ea_session_id, ea_session_tx) {
        if let Some(handler) = app_manager.get_handler_mut("com.usenocturne.daemon") {
            if let Some(mp_handler) = handler.as_msgpack_mut() {
                mp_handler.mark_as_websocket_message(message.id.clone());

                if method == "spotify.image.fetch" {
                    if let Some(url) = params.get("url").and_then(|u| u.as_str()) {
                        mp_handler.mark_as_image_request(message.id.clone(), url.to_string());
                    }
                }

                if method == "device.time.get" || method == "device.ota.download" {
                    mp_handler.mark_method_for_message(message.id.clone(), method.to_string());
                }
            }
        }

        let json_message = crate::app::msgpack::MsgPackMessage::Call {
            id: message.id.clone(),
            method: method.to_string(),
            params,
        };

        let msgpack_data = rmp_serde::to_vec_named(&json_message)?;
        let chunks = crate::app::msgpack::MsgPackProtocolHandler::create_chunks(&msgpack_data)?;

        info!(
            "TO_IPHONE: Sending {} request {} via EA session {} ({} chunks)",
            method,
            message.id,
            session_id,
            chunks.len()
        );

        for chunk in chunks {
            tx.send((session_id, chunk))
                .map_err(|e| NocturnedError::Iap2Protocol(e.to_string()))?;
        }
    } else {
        warn!(
            "No active EA session to route WebSocket message (session_id={:?}, tx={:?})",
            ea_session_id,
            ea_session_tx.is_some()
        );
        if let Some(ws_server) = websocket_server {
            ws_server
                .send_error(message.id.clone(), "No active EA session".to_string())
                .await;
        }
    }

    Ok(())
}
