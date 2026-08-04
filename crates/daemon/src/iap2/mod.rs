use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::Engine;
use bluer::{rfcomm::Stream, Address};
use bytes::Bytes;
use iap2_rs::session::TelephonyCommand;
use iap2_rs::{
    csm::{
        external_accessory::{AppLaunchMethod, RequestAppLaunch},
        identification::{
            CarthingIdentification, EaProtocol, EaProtocolMatchAction, HidComponentFunction,
            IdentificationConfig,
        },
        now_playing::{NowPlayingUpdate, PlaybackState, RepeatMode, ShuffleMode},
        telephony::{AcceptCall, EndCall},
        CsmFrame,
    },
    EaPriority, EaStreamSender, HidCommand, Iap2Command, Iap2Session, Link, LinkConfig, Lsp,
    SessionEvent,
};
use libnocturne::generated::bt_only::{AudioRecordingStartedEvent, AudioRecordingStoppedEvent};
use libnocturne::generated::device::{DeviceLaunchAppRequest, DeviceLaunchAppResponse};
use libnocturne::generated::iap2 as nocturne_iap2;
use libnocturne::generated::media_control::{
    MediaControlNextResponse, MediaControlPauseResponse, MediaControlPlayResponse,
    MediaControlPreviousResponse, MediaControlRepeatResponse, MediaControlShuffleResponse,
    MediaControlVolumeDownResponse, MediaControlVolumeUpResponse, MediaNowPlayingArtworkEvent,
    MediaNowPlayingUpdateEvent,
};
use libnocturne::generated::phone::{
    PhoneCallAcceptResponse, PhoneCallDeclineResponse, PhoneCallsGetResponse,
};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, error, info, trace, warn};

use crate::app::{
    msgpack::{
        create_audio_data_event, create_audio_recording_started_event,
        create_audio_recording_stopped_event, create_daemon_heartbeat_event,
        create_daemon_ready_event, MsgPackProtocolHandler,
    },
    websocket_handler::WebSocketProtocolHandler,
    AppCommunicationManager, AppMessage, AppMessagePriority, AppProtocolHandlerEnum,
};
use crate::audio;
use crate::error::{NocturnedError, Result};
use crate::http::WebSocketServer;
use audio::{AudioCommand, AudioEvent, WakeWordCommand};

mod telephony;

use telephony::{CallLifecycleEvent, CallTracker};

const NOCTURNE_EA_PROTOCOL: &str = "com.usenocturne.daemon";
const DEFAULT_APP_BUNDLE_ID: &str = "com.usenocturne.nocturne";
// iOS ignores RequestAppLaunch for an app that is already running, and it
// background-launches the app itself shortly after the accessory connects.
// The visible (foreground) launch therefore only happens when this fires
// before the app's background EA session forms — keep the window tight so
// the cold-start launch wins that race.
const APP_LAUNCH_INITIAL_DELAY: Duration = Duration::from_millis(2_500);
/// Used instead of [`APP_LAUNCH_INITIAL_DELAY`] when the phone paired moments
/// ago (the Settings > Bluetooth setup flow): fire on the first tick so the
/// launch request beats iOS's background spawn of the app.
const APP_LAUNCH_FRESH_PAIR_DELAY: Duration = Duration::from_millis(250);
const APP_LAUNCH_RETRY_INTERVAL: Duration = Duration::from_secs(15);
const APP_LAUNCH_MAX_ATTEMPTS: u32 = 5;

#[derive(Default, Clone)]
struct NowPlayingState {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: Option<u64>,
    status: Option<String>,
    shuffle_mode: Option<String>,
    repeat_mode: Option<String>,
    app_name: Option<String>,
}

impl NowPlayingState {
    fn to_event(&self) -> MediaNowPlayingUpdateEvent {
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

        let mut playback_json = serde_json::json!({});
        let mut has_playback = false;
        if let Some(ref status) = self.status {
            playback_json["PlaybackStatus"] = serde_json::json!(status);
            has_playback = true;
        }
        if let Some(ref shuffle) = self.shuffle_mode {
            playback_json["PlaybackShuffleMode"] = serde_json::json!(shuffle);
            has_playback = true;
        }
        if let Some(ref repeat) = self.repeat_mode {
            playback_json["PlaybackRepeatMode"] = serde_json::json!(repeat);
            has_playback = true;
        }
        if let Some(ref app) = self.app_name {
            playback_json["PlaybackAppName"] = serde_json::json!(app);
            has_playback = true;
        }
        if has_playback {
            json["PlaybackAttributes"] = playback_json;
        }

        MediaNowPlayingUpdateEvent {
            media_item_attributes: json.get("MediaItemAttributes").cloned(),
            playback_attributes: json.get("PlaybackAttributes").cloned(),
            media_generation: None,
        }
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

pub struct Iap2ConnectionOptions {
    pub websocket_server: Option<Arc<WebSocketServer>>,
    pub audio_event_rx: broadcast::Receiver<AudioEvent>,
    pub audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    pub wakeword_pause_tx: mpsc::UnboundedSender<WakeWordCommand>,
    pub ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    pub fast_app_launch: bool,
}

struct Iap2TaskInputs {
    websocket_server: Option<Arc<WebSocketServer>>,
    websocket_rx: mpsc::UnboundedReceiver<AppMessage>,
    hid_tx: mpsc::UnboundedSender<HidCommand>,
    hid_rx: mpsc::UnboundedReceiver<HidCommand>,
    running: Arc<Mutex<bool>>,
    ready_tx: tokio::sync::oneshot::Sender<Result<()>>,
    audio_event_rx: broadcast::Receiver<AudioEvent>,
    audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    wakeword_pause_tx: mpsc::UnboundedSender<WakeWordCommand>,
    ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    fast_app_launch: bool,
}

struct ActiveEaStream {
    local_session_id: u8,
    stream_id: u16,
    outbound: EaStreamSender,
}

fn ea_priority(priority: AppMessagePriority) -> EaPriority {
    match priority {
        AppMessagePriority::Normal => EaPriority::Normal,
        AppMessagePriority::Bulk => EaPriority::Bulk,
    }
}

struct SessionEventContext<'a> {
    websocket_server: &'a Option<Arc<WebSocketServer>>,
    device_address: &'a Address,
    now_playing_state: &'a mut NowPlayingState,
    call_tracker: &'a mut CallTracker,
    app_manager: &'a mut AppCommunicationManager,
    active_ea: &'a mut Option<ActiveEaStream>,
    ea_inbound_rx: &'a mut Option<mpsc::Receiver<Bytes>>,
    next_local_session_id: &'a mut u8,
}

struct WebSocketMessageContext<'a> {
    app_manager: &'a mut AppCommunicationManager,
    active_ea: Option<&'a ActiveEaStream>,
    websocket_server: &'a Option<Arc<WebSocketServer>>,
    hid_tx: &'a mpsc::Sender<HidCommand>,
    telephony_tx: &'a mpsc::Sender<TelephonyCommand>,
    call_tracker: &'a CallTracker,
    link_command_tx: &'a mpsc::Sender<Iap2Command>,
}

impl Iap2Connection {
    pub fn address(&self) -> Address {
        self.device_address
    }

    pub fn route_id(&self) -> String {
        format!("iap2:{}", self.device_address)
    }

    pub fn user_disconnect_flag(&self) -> Arc<Mutex<bool>> {
        self.user_initiated_disconnect.clone()
    }

    pub async fn new(
        device_address: Address,
        stream: Stream,
        options: Iap2ConnectionOptions,
    ) -> Result<Self> {
        let Iap2ConnectionOptions {
            websocket_server,
            audio_event_rx,
            audio_cmd_tx,
            wakeword_pause_tx,
            ota_cmd_tx,
            fast_app_launch,
        } = options;
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
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let result = run_iap2_connection(
                device_address,
                stream,
                Iap2TaskInputs {
                    websocket_server,
                    websocket_rx,
                    hid_tx,
                    hid_rx,
                    running: running_clone.clone(),
                    ready_tx,
                    audio_event_rx,
                    audio_cmd_tx,
                    wakeword_pause_tx,
                    ota_cmd_tx,
                    fast_app_launch,
                },
            )
            .await;

            if let Err(err) = result {
                error!(%device_address, %err, "iAP2 connection error");
            }
            *running_clone.lock().await = false;
        });

        match ready_rx.await {
            Ok(Ok(())) => Ok(conn),
            Ok(Err(err)) => Err(err),
            Err(_) => Err(NocturnedError::Iap2Protocol(
                "Connection task terminated unexpectedly".to_string(),
            )),
        }
    }

    pub async fn run(self) -> Result<()> {
        while *self.running.lock().await {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }

    pub async fn send_websocket_message(&self, message: AppMessage) -> Result<()> {
        self.websocket_tx.send(message).map_err(|err| {
            NocturnedError::Iap2Protocol(format!("Failed to send WebSocket message: {err}"))
        })
    }

    pub fn device_address(&self) -> Address {
        self.device_address
    }

    pub async fn is_running(&self) -> bool {
        *self.running.lock().await
    }

    pub async fn close(&mut self) {
        *self.running.lock().await = false;
        info!(%self.device_address, "Closing iAP2 connection");
    }

    pub async fn mark_user_initiated_disconnect(&self) {
        *self.user_initiated_disconnect.lock().await = true;
    }
}

async fn run_iap2_connection(
    device_address: Address,
    stream: Stream,
    inputs: Iap2TaskInputs,
) -> Result<()> {
    info!(%device_address, "Starting iAP2 connection handler");

    let Iap2TaskInputs {
        websocket_server,
        mut websocket_rx,
        hid_tx,
        mut hid_rx,
        running,
        ready_tx,
        mut audio_event_rx,
        audio_cmd_tx,
        wakeword_pause_tx,
        ota_cmd_tx,
        fast_app_launch,
    } = inputs;

    let identification = build_identification_config()?;
    let mfi_auth = tokio::task::spawn_blocking(iap2_rs::MfiAuth::open_default)
        .await
        .map_err(|err| NocturnedError::MfiDevice(format!("MFi open task panicked: {err}")))?
        .map_err(|err| {
            NocturnedError::MfiDevice(format!("Cannot open MFi coprocessor on /dev/i2c-3: {err}"))
        })?;
    let mfi_worker = iap2_rs::WorkerMfiAccess::spawn(mfi_auth);
    let mfi = mfi_worker.handle();
    let (link_command_tx, link_command_rx) = mpsc::channel(64);
    let (link_event_tx, link_event_rx) = mpsc::channel(64);
    let (session_event_tx, mut session_event_rx) = mpsc::channel(64);
    let (session_hid_tx, session_hid_rx) = mpsc::channel(16);
    let (_now_playing_tx, now_playing_rx) = mpsc::channel(16);
    let (telephony_tx, telephony_rx) = mpsc::channel(16);

    let link_config = LinkConfig::new(Lsp::accessory_default());
    // Follow-up: when `debug-iap2-frame-tap` is enabled, construct an iap2_rs::FrameTap,
    // pass it through Link::run_with_frame_tap, and drain/forward events on a debug WS channel.
    let link_handle = tokio::spawn(Link::run(
        stream,
        link_config,
        link_event_tx,
        link_command_rx,
    ));
    let session = Iap2Session::new(
        identification,
        mfi,
        link_command_tx.clone(),
        link_event_rx,
        session_event_tx,
        session_hid_rx,
        now_playing_rx,
        telephony_rx,
    );
    let session_handle = tokio::spawn(session.run());

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
        if let Some(ota_cmd_tx) = ota_cmd_tx.clone() {
            mp_handler.set_ota_cmd_tx(ota_cmd_tx);
        }
        mp_handler.set_connection_peer(device_address);
        mp_handler.set_connection_route(format!("iap2:{device_address}"));
        app_manager.register_handler(AppProtocolHandlerEnum::MsgPack(Box::new(mp_handler)));
    }

    let app_ready_received = app_manager
        .app_ready_flag()
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let mut now_playing_state = NowPlayingState::default();
    let mut call_tracker = CallTracker::new(device_address.to_string());
    let mut active_ea: Option<ActiveEaStream> = None;
    let mut ea_inbound_rx: Option<mpsc::Receiver<Bytes>> = None;
    let mut next_local_session_id: u8 = 1;

    let heartbeat_interval = Duration::from_secs(10);
    let daemon_ready_interval = Duration::from_secs(3);
    let mut last_heartbeat = Instant::now();
    let mut last_daemon_ready = Instant::now();
    let mut audio_events_closed = false;

    let mut ea_session_waiting_since = Instant::now();
    let mut app_launch_attempts: u32 = 0;
    let mut last_app_launch_attempt: Option<Instant> = None;
    let mut ea_session_ever_established = false;
    let app_launch_initial_delay = if fast_app_launch {
        APP_LAUNCH_FRESH_PAIR_DELAY
    } else {
        APP_LAUNCH_INITIAL_DELAY
    };

    while *running.lock().await {
        let ea_inbound = async {
            match &mut ea_inbound_rx {
                Some(rx) => rx.recv().await,
                None => std::future::pending::<Option<Bytes>>().await,
            }
        };

        tokio::select! {
            session_event = session_event_rx.recv() => {
                match session_event {
                    Some(event) => {
                        match &event {
                            SessionEvent::EaStreamOpened { .. } => {
                                app_launch_attempts = 0;
                                last_app_launch_attempt = None;
                                ea_session_ever_established = true;
                            }
                            SessionEvent::EaStreamClosed { .. } => {
                                ea_session_waiting_since = Instant::now();
                                app_launch_attempts = 0;
                                last_app_launch_attempt = None;
                            }
                            _ => {}
                        }
                        let context = SessionEventContext {
                            websocket_server: &websocket_server,
                            device_address: &device_address,
                            now_playing_state: &mut now_playing_state,
                            call_tracker: &mut call_tracker,
                            app_manager: &mut app_manager,
                            active_ea: &mut active_ea,
                            ea_inbound_rx: &mut ea_inbound_rx,
                            next_local_session_id: &mut next_local_session_id,
                        };
                        if handle_session_event(event, context).await? {
                            break;
                        }
                        if let Some(active) = active_ea.as_ref() {
                            if active.local_session_id != 0 && last_daemon_ready.elapsed() >= daemon_ready_interval {
                                send_daemon_ready(active.local_session_id, Some(&active.outbound)).await;
                                last_daemon_ready = Instant::now();
                            }
                        }
                    }
                    None => break,
                }
            }

            ea_data = ea_inbound => {
                if let Some(data) = ea_data {
                    if let Some(active) = active_ea.as_ref() {
                        trace!(bytes = data.len(), session = active.local_session_id, "FROM_IPHONE: Received EA data");
                        if let Err(err) = app_manager.handle_incoming_data(active.local_session_id, data).await {
                            error!(%err, "Failed to handle EA data");
                        }
                    }
                } else if ea_inbound_rx.is_some() {
                    info!("EA stream channel closed");
                    ea_inbound_rx = None;
                    active_ea = None;
                }
            }

            ea_out = ea_data_rx.recv() => {
                if let Some((session_id, priority, data)) = ea_out {
                    if let Some(active) = active_ea.as_ref().filter(|active| active.local_session_id == session_id) {
                        trace!(bytes = data.len(), session = session_id, stream = active.stream_id, ?priority, "TO_IPHONE: Sending EA data");
                        if let Err(err) = active.outbound.send(ea_priority(priority), data).await {
                            error!(%err, "Failed to send EA data");
                        }
                    } else {
                        warn!(session = session_id, "No active EA stream to send data to");
                    }
                }
            }

            ws_msg = websocket_rx.recv() => {
                if let Some(message) = ws_msg {
                    info!(id = %message.id, "WebSocket message received");
                    if let Err(err) = handle_websocket_message_new(
                        &message,
                        WebSocketMessageContext {
                            app_manager: &mut app_manager,
                            active_ea: active_ea.as_ref(),
                            websocket_server: &websocket_server,
                            hid_tx: &session_hid_tx,
                            telephony_tx: &telephony_tx,
                            call_tracker: &call_tracker,
                            link_command_tx: &link_command_tx,
                        },
                    ).await {
                        error!(%err, "Failed to handle WebSocket message");
                    }
                }
            }

            hid_cmd = hid_rx.recv() => {
                if let Some(cmd) = hid_cmd {
                    info!(?cmd, "Sending HID command");
                    if let Err(err) = session_hid_tx.send(cmd).await {
                        error!(%err, "Failed to queue HID command");
                    }
                }
            }

            audio_event = audio_event_rx.recv(), if !audio_events_closed => {
                match audio_event {
                    Ok(event) => {
                        if let Some(active) = active_ea.as_ref() {
                            send_audio_event(active.local_session_id, &active.outbound, &event).await;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => warn!(messages = n, "iAP2 audio event receiver lagged"),
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Audio event channel closed for iAP2 handler");
                        audio_events_closed = true;
                    }
                }
            }

            _ = tokio::time::sleep(Duration::from_millis(500)) => {
                if let Some(active) = active_ea.as_ref() {
                    if !app_ready_received.load(Ordering::Relaxed)
                        && last_daemon_ready.elapsed() >= daemon_ready_interval
                    {
                        send_daemon_ready(active.local_session_id, Some(&active.outbound)).await;
                        last_daemon_ready = Instant::now();
                    }
                    if last_heartbeat.elapsed() >= heartbeat_interval {
                        send_heartbeat(active.local_session_id, &active.outbound).await;
                        last_heartbeat = Instant::now();
                    }
                } else if !ea_session_ever_established
                    && app_launch_attempts < APP_LAUNCH_MAX_ATTEMPTS
                    && ea_session_waiting_since.elapsed() >= app_launch_initial_delay
                    && last_app_launch_attempt
                        .map(|at| at.elapsed() >= APP_LAUNCH_RETRY_INTERVAL)
                        .unwrap_or(true)
                {
                    app_launch_attempts += 1;
                    last_app_launch_attempt = Some(Instant::now());
                    info!(
                        "No EA session with {} yet, sending RequestAppLaunch for {} (attempt {}/{})",
                        device_address,
                        DEFAULT_APP_BUNDLE_ID,
                        app_launch_attempts,
                        APP_LAUNCH_MAX_ATTEMPTS
                    );
                    if let Err(e) = send_app_launch(&link_command_tx, DEFAULT_APP_BUNDLE_ID).await {
                        warn!("Failed to send RequestAppLaunch: {}", e);
                    }
                }
            }
        }
    }

    broadcast_phone_call_events(&websocket_server, call_tracker.drain("connection_lost")).await;
    let _ = link_command_tx.send(Iap2Command::Disconnect).await;
    link_handle.abort();
    session_handle.abort();
    info!(%device_address, "iAP2 connection handler stopped");
    Ok(())
}

async fn handle_session_event(
    event: SessionEvent,
    context: SessionEventContext<'_>,
) -> Result<bool> {
    let SessionEventContext {
        websocket_server,
        device_address,
        now_playing_state,
        call_tracker,
        app_manager,
        active_ea,
        ea_inbound_rx,
        next_local_session_id,
    } = context;
    match event {
        SessionEvent::LinkEstablished(lsp) => info!(
            %device_address,
            version = lsp.version,
            max_outgoing = lsp.max_outgoing,
            max_len = lsp.max_len,
            retransmission_timeout_ms = lsp.retransmission_timeout_ms,
            ack_timeout_ms = lsp.ack_timeout_ms,
            max_retransmissions = lsp.max_retransmissions,
            max_ack = lsp.max_ack,
            sessions = ?lsp.sessions,
            "Link established"
        ),
        SessionEvent::Authenticated => {
            info!(%device_address, "Authentication succeeded");
            broadcast_mfi(
                websocket_server,
                device_address,
                "authentication_succeeded",
                None,
            )
            .await;
        }
        SessionEvent::AuthFailed => {
            error!(%device_address, "Authentication failed");
            broadcast_mfi(
                websocket_server,
                device_address,
                "authentication_failed",
                Some("iPhone rejected authentication"),
            )
            .await;
        }
        SessionEvent::Identified => info!(%device_address, "Identification accepted"),
        SessionEvent::IdentificationRejected { rejected_params } => {
            warn!(?rejected_params, %device_address, "Identification rejected");
        }
        SessionEvent::NowPlayingUpdate(update) => {
            handle_now_playing_update(update, websocket_server, now_playing_state).await;
        }
        SessionEvent::EaStreamOpened {
            stream_id,
            protocol_id,
            inbound_rx,
            outbound,
        } => {
            let local_session_id = allocate_local_session_id(next_local_session_id);
            info!(stream_id, protocol_id, local_session_id, "EA stream opened");
            app_manager.create_session(local_session_id, NOCTURNE_EA_PROTOCOL.to_string())?;
            send_daemon_ready(local_session_id, Some(&outbound)).await;
            *active_ea = Some(ActiveEaStream {
                local_session_id,
                stream_id,
                outbound,
            });
            *ea_inbound_rx = Some(inbound_rx);
        }
        SessionEvent::EaStreamClosed { stream_id } => {
            info!(stream_id, "EA stream closed");
            if active_ea
                .as_ref()
                .is_some_and(|active| active.stream_id == stream_id)
            {
                *active_ea = None;
                *ea_inbound_rx = None;
            }
        }
        SessionEvent::ArtworkBytes { transfer_id, bytes } => {
            info!(
                transfer_id,
                bytes = bytes.len(),
                "Artwork transfer complete"
            );
            if let Some(ws_server) = websocket_server {
                ws_server.cancel_all_pending_image_fetches().await;
                let event = MediaNowPlayingArtworkEvent {
                    data: base64::engine::general_purpose::STANDARD.encode(bytes),
                    content_type: "image/jpeg".to_string(),
                    media_generation: None,
                };
                ws_server
                    .broadcast_event(
                        "media.now_playing.artwork".to_string(),
                        media_control_payload(event),
                    )
                    .await;
            }
        }
        SessionEvent::QueueSnapshotBytes { transfer_id, bytes } => {
            debug!(
                transfer_id,
                bytes = bytes.len(),
                "Queue snapshot transfer complete"
            );
        }
        SessionEvent::CallStateUpdate(update) => {
            debug!(?update, "Telephony call state update");
            let events = call_tracker.apply(update);
            broadcast_phone_call_events(websocket_server, events).await;
        }
        SessionEvent::CommunicationsUpdate(update) => {
            debug!(?update, "Telephony communications update")
        }
        SessionEvent::DeviceName(update) => debug!(
            update = ?nocturne_iap2::DeviceInformationUpdate::from(update),
            "Device name update"
        ),
        SessionEvent::DeviceLanguage(update) => debug!(
            update = ?nocturne_iap2::DeviceLanguageUpdate::from(update),
            "Device language update"
        ),
        SessionEvent::DeviceTime(update) => debug!(
            update = ?nocturne_iap2::DeviceTimeUpdate::from(update),
            "Device time update"
        ),
        SessionEvent::DeviceUuid(update) => debug!(
            update = ?nocturne_iap2::DeviceUUIDUpdate::from(update),
            "Device UUID update"
        ),
        SessionEvent::LinkDown(reason) => {
            info!(%device_address, %reason, "Disconnected");
            return Ok(true);
        }
    }
    Ok(false)
}

async fn handle_now_playing_update(
    update: NowPlayingUpdate,
    websocket_server: &Option<Arc<WebSocketServer>>,
    state: &mut NowPlayingState,
) {
    debug!("Now Playing update received");

    if update
        .playback
        .as_ref()
        .and_then(|playback| playback.state)
        .is_some_and(|status| matches!(status, PlaybackState::Stopped))
    {
        state.clear();
    }

    let incoming_title = update
        .media_item
        .as_ref()
        .and_then(|media| media.title.as_ref())
        .map(|title| title.trim().to_string());
    let title_changed = match (&incoming_title, &state.title) {
        (Some(new_title), Some(old_title)) => {
            !new_title.is_empty() && new_title != old_title.trim()
        }
        _ => false,
    };
    if title_changed {
        state.album = None;
        state.duration_ms = None;
        state.app_name = None;
    }

    if let Some(media) = update.media_item {
        if let Some(title) = media.title {
            state.title = Some(title);
        }
        if let Some(artist) = media.artist {
            state.artist = Some(artist);
        }
        if let Some(album) = media.album {
            state.album = Some(album);
        }
        if let Some(duration) = media.duration_ms {
            state.duration_ms = Some(u64::from(duration));
        }
    }

    if let Some(playback) = update.playback {
        if let Some(status) = playback.state {
            state.status = Some(playback_status(status).to_string());
        }
        if let Some(shuffle) = playback.shuffle_mode {
            state.shuffle_mode = Some(shuffle_mode(shuffle).to_string());
        }
        if let Some(repeat) = playback.repeat {
            state.repeat_mode = Some(repeat_mode(repeat).to_string());
        }
        if let Some(app) = playback.app_display_name {
            state.app_name = Some(app);
        }
    }

    if let Some(ws_server) = websocket_server {
        ws_server
            .broadcast_event(
                "media.now_playing.update".to_string(),
                media_control_payload(state.to_event()),
            )
            .await;
    }
}

async fn handle_websocket_message_new(
    message: &AppMessage,
    context: WebSocketMessageContext<'_>,
) -> Result<()> {
    let WebSocketMessageContext {
        app_manager,
        active_ea,
        websocket_server,
        hid_tx,
        telephony_tx,
        call_tracker,
        link_command_tx,
    } = context;
    info!(id = %message.id, "Routing WebSocket message");
    let ws_data: serde_json::Value = serde_json::from_slice(&message.data)?;
    if ws_data
        .get("topic")
        .and_then(|topic| topic.as_str())
        .is_some()
    {
        if let Some(active) = active_ea {
            let msgpack_message =
                MsgPackProtocolHandler::outbound_app_message(message.id.clone(), &message.data)?;
            send_msgpack_chunks(
                active.local_session_id,
                Some(&active.outbound),
                msgpack_message,
                "app.event",
            )
            .await;
        } else if let Some(ws_server) = websocket_server {
            warn!("No active EA stream to route event message");
            ws_server
                .send_error(message.id.clone(), "No active EA session".to_string())
                .await;
        }
        return Ok(());
    }
    let method = ws_data
        .get("method")
        .and_then(|method| method.as_str())
        .unwrap_or("unknown");
    let params = ws_data
        .get("params")
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    if method == "phone.calls.get" {
        if let Some(ws_server) = websocket_server {
            ws_server
                .send_response(
                    message.id.clone(),
                    phone_payload(PhoneCallsGetResponse {
                        calls: call_tracker.snapshot(),
                    }),
                )
                .await;
        }
        return Ok(());
    }

    if method == "phone.call.accept" || method == "phone.call.decline" {
        let call_id = params
            .get("call_id")
            .or_else(|| params.get("callId"))
            .and_then(serde_json::Value::as_str)
            .filter(|call_id| !call_id.is_empty());
        let Some(call_id) = call_id else {
            if let Some(ws_server) = websocket_server {
                ws_server
                    .send_error(message.id.clone(), "Missing call_id".to_string())
                    .await;
            }
            return Ok(());
        };
        if !call_tracker.is_ringing_incoming(call_id) {
            if let Some(ws_server) = websocket_server {
                ws_server
                    .send_error(message.id.clone(), "Call is no longer ringing".to_string())
                    .await;
            }
            return Ok(());
        }

        let command = if method == "phone.call.accept" {
            TelephonyCommand::Accept(AcceptCall {
                accept_action: 0,
                call_uuid: Some(call_id.to_string()),
            })
        } else {
            TelephonyCommand::End(EndCall {
                end_action: 0,
                call_uuid: Some(call_id.to_string()),
            })
        };
        match telephony_tx.send(command).await {
            Ok(()) => {
                if let Some(ws_server) = websocket_server {
                    let response = if method == "phone.call.accept" {
                        phone_payload(PhoneCallAcceptResponse {
                            status: "ok".to_string(),
                        })
                    } else {
                        phone_payload(PhoneCallDeclineResponse {
                            status: "ok".to_string(),
                        })
                    };
                    ws_server.send_response(message.id.clone(), response).await;
                }
            }
            Err(err) => {
                if let Some(ws_server) = websocket_server {
                    ws_server
                        .send_error(message.id.clone(), err.to_string())
                        .await;
                }
            }
        }
        return Ok(());
    }

    if method.starts_with("media.control.") {
        if let Some(cmd) = crate::app::hid_mapping::method_to_hid_command(method) {
            match hid_tx.send(cmd).await {
                Ok(()) => {
                    if let Some(ws_server) = websocket_server {
                        let result = media_control_response_payload(method)
                            .unwrap_or_else(|| serde_json::json!({ "status": "ok" }));
                        ws_server.send_response(message.id.clone(), result).await;
                    }
                }
                Err(err) => {
                    if let Some(ws_server) = websocket_server {
                        ws_server
                            .send_error(message.id.clone(), err.to_string())
                            .await;
                    }
                }
            }
            return Ok(());
        }
    }

    if method == "device.launchApp" || method == "device.launch_app" {
        let request = DeviceLaunchAppRequest {
            bundle_id: params
                .get("bundle_id")
                .or_else(|| params.get("bundleId"))
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
        };
        let bundle_id = request
            .bundle_id
            .as_deref()
            .unwrap_or(DEFAULT_APP_BUNDLE_ID);
        match send_app_launch(link_command_tx, bundle_id).await {
            Ok(()) => {
                info!(bundle_id, "Sent RequestAppLaunch");
                if let Some(ws_server) = websocket_server {
                    ws_server
                        .send_response(
                            message.id.clone(),
                            serde_json::to_value(DeviceLaunchAppResponse {
                                status: "ok".to_string(),
                            })?,
                        )
                        .await;
                }
            }
            Err(err) => {
                if let Some(ws_server) = websocket_server {
                    ws_server
                        .send_error(message.id.clone(), err.to_string())
                        .await;
                }
            }
        }
        return Ok(());
    }

    if let Some(active) = active_ea {
        if let Some(handler) = app_manager.get_handler_mut(NOCTURNE_EA_PROTOCOL) {
            if let Some(mp_handler) = handler.as_msgpack_mut() {
                mp_handler.mark_as_websocket_message(message.id.clone());
                if method == "spotify.image.fetch" {
                    if let Some(url) = params.get("url").and_then(|url| url.as_str()) {
                        mp_handler.mark_as_image_request(message.id.clone(), url.to_string());
                    }
                }
                if method == "device.time.get" {
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
        let chunks = MsgPackProtocolHandler::create_chunks(&msgpack_data)?;
        info!(
            method,
            id = %message.id,
            session = active.local_session_id,
            chunks = chunks.len(),
            "TO_IPHONE: Sending request via EA stream"
        );
        for chunk in chunks {
            active
                .outbound
                .send(EaPriority::Normal, chunk)
                .await
                .map_err(|err| NocturnedError::Iap2Protocol(err.to_string()))?;
        }
    } else if let Some(ws_server) = websocket_server {
        warn!("No active EA stream to route WebSocket message");
        ws_server
            .send_error(message.id.clone(), "No active EA session".to_string())
            .await;
    }

    Ok(())
}

async fn send_app_launch(
    link_command_tx: &mpsc::Sender<Iap2Command>,
    bundle_id: &str,
) -> Result<()> {
    let frame: CsmFrame = RequestAppLaunch {
        bundle_id: bundle_id.to_string(),
        launch_method: AppLaunchMethod::WithoutUserAlert,
    }
    .into();
    link_command_tx
        .send(Iap2Command::Send {
            session_id: 1,
            payload: frame.into_bytes(),
        })
        .await
        .map_err(|err| NocturnedError::Iap2Protocol(err.to_string()))
}

async fn send_daemon_ready(session_id: u8, outbound: Option<&EaStreamSender>) {
    let event = create_daemon_ready_event();
    send_msgpack_chunks(session_id, outbound, event, "daemon.ready").await;
}

async fn send_heartbeat(session_id: u8, outbound: &EaStreamSender) {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    let event = create_daemon_heartbeat_event(timestamp);
    send_msgpack_chunks(session_id, Some(outbound), event, "daemon.heartbeat").await;
}

async fn send_audio_event(session_id: u8, outbound: &EaStreamSender, event: &AudioEvent) {
    match event {
        AudioEvent::Data {
            seq,
            opus_data,
            timestamp_ms,
        } => {
            send_msgpack_chunks(
                session_id,
                Some(outbound),
                create_audio_data_event(*seq, opus_data, *timestamp_ms),
                "audio.data",
            )
            .await;
        }
        AudioEvent::Started {
            sample_rate,
            channels,
            frame_ms,
        } => {
            send_msgpack_chunks(
                session_id,
                Some(outbound),
                create_audio_recording_started_event(AudioRecordingStartedEvent {
                    sample_rate: *sample_rate,
                    channels: *channels,
                    frame_ms: *frame_ms,
                }),
                "audio.recording.started",
            )
            .await;
        }
        AudioEvent::Stopped {
            reason,
            total_frames,
        } => {
            send_msgpack_chunks(
                session_id,
                Some(outbound),
                create_audio_recording_stopped_event(AudioRecordingStoppedEvent {
                    reason: reason.clone(),
                    total_frames: *total_frames,
                }),
                "audio.recording.stopped",
            )
            .await;
        }
        AudioEvent::MicLevel { .. } => {}
    }
}

async fn send_msgpack_chunks<T: serde::Serialize>(
    session_id: u8,
    outbound: Option<&EaStreamSender>,
    event: T,
    label: &str,
) {
    let Some(outbound) = outbound else {
        return;
    };
    let Ok(serialized) = rmp_serde::to_vec_named(&event) else {
        return;
    };
    let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) else {
        return;
    };
    for chunk in chunks {
        if let Err(err) = outbound.send(EaPriority::Normal, chunk).await {
            warn!(%err, session_id, label, "Failed to send msgpack chunk over EA");
            return;
        }
    }
    debug!(session_id, label, "Sent msgpack event to phone");
}

fn build_identification_config() -> Result<IdentificationConfig> {
    let serial_number = crate::system::config::get_serial_number()?;
    let last_four = if serial_number.len() >= 4 {
        &serial_number[serial_number.len() - 4..]
    } else {
        &serial_number
    };
    let name = format!("Nocturne ({last_four})");
    let firmware_version = crate::system::config::get_firmware_version()?;
    let bt_mac = crate::system::config::get_bluetooth_mac()?;

    let mut config = IdentificationConfig::for_carthing(CarthingIdentification {
        serial_number,
        firmware_version,
        bt_mac,
    });
    config.name = name;
    config.model_identifier = "YX5H6679".to_string();
    config.manufacturer = "Vanta Labs".to_string();
    config.hardware_version = "1".to_string();
    config.app_match_team_id = Some("A8CCNQDH4A".to_string());
    config.supported_external_accessory_protocols = vec![EaProtocol {
        id: 1,
        name: NOCTURNE_EA_PROTOCOL.to_string(),
        match_action: EaProtocolMatchAction::NoAlertAction,
        native_transport_component_identifier: None,
    }];
    for component in &mut config.bluetooth_transport_components {
        component.name = "Nocturne BT".to_string();
    }
    for component in &mut config.hid_components {
        component.name = "Nocturne".to_string();
        component.function = HidComponentFunction::MediaPlaybackRemote;
    }
    Ok(config)
}

async fn broadcast_mfi(
    websocket_server: &Option<Arc<WebSocketServer>>,
    device_address: &Address,
    event: &str,
    reason: Option<&str>,
) {
    if let Some(ws_server) = websocket_server {
        let mut payload = serde_json::json!({
            "event": event,
            "device": device_address.to_string(),
        });
        if let Some(reason) = reason {
            payload["reason"] = serde_json::json!(reason);
        }
        ws_server
            .broadcast_event("bluetooth.mfi".to_string(), payload)
            .await;
    }
}

fn allocate_local_session_id(next: &mut u8) -> u8 {
    let id = (*next).max(1);
    *next = next.wrapping_add(1).max(1);
    id
}

fn playback_status(status: PlaybackState) -> &'static str {
    match status {
        PlaybackState::Stopped => "stopped",
        PlaybackState::Playing => "playing",
        PlaybackState::Paused => "paused",
    }
}

fn shuffle_mode(mode: ShuffleMode) -> &'static str {
    match mode {
        ShuffleMode::Off => "off",
        ShuffleMode::Songs => "songs",
        ShuffleMode::Albums => "albums",
    }
}

fn repeat_mode(mode: RepeatMode) -> &'static str {
    match mode {
        RepeatMode::Off => "off",
        RepeatMode::Track => "track",
        RepeatMode::All => "all",
    }
}

fn media_control_payload<T: serde::Serialize>(payload: T) -> serde_json::Value {
    let mut value =
        serde_json::to_value(payload).expect("generated media_control payload must serialize");
    if value
        .get("media_generation")
        .is_some_and(serde_json::Value::is_null)
    {
        value
            .as_object_mut()
            .expect("generated media_control payload must be an object")
            .remove("media_generation");
    }
    value
}

fn phone_payload<T: serde::Serialize>(payload: T) -> serde_json::Value {
    serde_json::to_value(payload).expect("generated phone payload must serialize")
}

async fn broadcast_phone_call_events(
    websocket_server: &Option<Arc<WebSocketServer>>,
    events: Vec<CallLifecycleEvent>,
) {
    let Some(websocket_server) = websocket_server else {
        return;
    };
    for event in events {
        let (topic, payload) = match event {
            CallLifecycleEvent::Started(event) => ("phone.call.started", phone_payload(event)),
            CallLifecycleEvent::Updated(event) => ("phone.call.updated", phone_payload(event)),
            CallLifecycleEvent::Ended(event) => ("phone.call.ended", phone_payload(event)),
        };
        websocket_server
            .broadcast_event(topic.to_string(), payload)
            .await;
    }
}

fn media_control_response_payload(method: &str) -> Option<serde_json::Value> {
    let status = "ok".to_string();
    match method {
        "media.control.play" => Some(media_control_payload(MediaControlPlayResponse { status })),
        "media.control.pause" => Some(media_control_payload(MediaControlPauseResponse { status })),
        "media.control.next" => Some(media_control_payload(MediaControlNextResponse { status })),
        "media.control.previous" | "media.control.prev" => {
            Some(media_control_payload(MediaControlPreviousResponse {
                status,
            }))
        }
        "media.control.shuffle" => Some(media_control_payload(MediaControlShuffleResponse {
            status,
        })),
        "media.control.repeat" => {
            Some(media_control_payload(MediaControlRepeatResponse { status }))
        }
        "media.control.volumeUp" | "media.control.volume_up" => {
            Some(media_control_payload(MediaControlVolumeUpResponse {
                status,
            }))
        }
        "media.control.volumeDown" | "media.control.volume_down" => {
            Some(media_control_payload(MediaControlVolumeDownResponse {
                status,
            }))
        }
        _ => None,
    }
}
