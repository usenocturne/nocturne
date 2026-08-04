pub mod accessory_setup;
pub mod ancs;
mod hci;
pub mod pairing;

use crate::app::msgpack::{
    create_audio_data_event, create_audio_recording_started_event,
    create_audio_recording_stopped_event, create_daemon_ready_event, MsgPackMessage,
    MsgPackProtocolHandler,
};
use crate::audio;
use crate::hardware::ImageCache;
use crate::{
    app::{AppMessage, AppMessagePriority},
    error::Result,
    http::WebSocketServer,
    iap2::{Iap2Connection, Iap2ConnectionOptions},
    system::config::Config,
};
use audio::{AudioCommand, AudioEvent, WakeWordCommand};
use base64::Engine;
use bluer::{
    rfcomm::{Profile, ReqError, Role, SocketAddr, Stream},
    Adapter, AdapterEvent, Address, Device, DeviceEvent, DeviceProperty, ErrorKind,
    InternalErrorKind, Session, Uuid,
};
use bytes::BytesMut;
use dbus::blocking::Connection;
use dbus::Path;
use futures::StreamExt;
use libnocturne::generated::bluetooth::{
    BluetoothConnectionEvent, BluetoothDeviceConnectRequest, BluetoothDeviceConnectResponse,
    BluetoothDeviceDisconnectRequest, BluetoothDeviceDisconnectResponse, BluetoothDeviceEvent,
    BluetoothDeviceUnpairRequest, BluetoothDeviceUnpairResponse, BluetoothPairingEvent,
};
use libnocturne::generated::bt_only::{AudioRecordingStartedEvent, AudioRecordingStoppedEvent};
use serde::{Deserialize, Serialize};
use serde_json as json;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

pub struct GenericConnection {
    pub connection_id: String,
    pub device_address: Address,
    pub tx: mpsc::UnboundedSender<AppMessage>,
}

struct GenericConnectionIdentity {
    connection_id: String,
    device: Address,
}
const IAP2_RFCOMM_CHANNEL: u8 = 1;
const ANCS_SERVICE_UUID: Uuid = Uuid::from_u128(0x7905F431_B5CE_4E99_A40F_4B1E122D00D0);

const IAP2_RECONNECT_INITIAL_DELAY: Duration = Duration::from_secs(2);
const IAP2_RECONNECT_MAX_DELAY: Duration = Duration::from_secs(30);
const IAP2_CLASSIFICATION_RETRY_ATTEMPTS: usize = 3;
const DEFAULT_ADAPTER_RETRY_INTERVAL: Duration = Duration::from_millis(250);
const MAX_ADAPTER_RETRY_INTERVAL: Duration = Duration::from_secs(5);
const ANDROID_WAKE_GRANT_TTL: Duration = Duration::from_secs(30);
const KNOWN_MACOS_CONNECTORS_PATH: &str = "/var/lib/nocturne/known-macos-connectors.json";

/// How long after a successful pairing an iAP2 connection still counts as
/// part of the setup flow, warranting an immediate foreground app launch.
const FRESH_PAIR_WINDOW: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnectionOutcome {
    Connected,
    WaitingForIos,
    WaitingForMacConnector,
    WaitingForAndroid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Iap2CandidateClassification {
    Candidate,
    Other,
    Incomplete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArmIap2ReconnectOutcome {
    Armed,
    AlreadyActive,
    NotPaired,
    Blocked,
    NotCandidate,
    IncompleteMetadata,
    Unavailable,
}

#[derive(Debug, Clone, Copy)]
struct AndroidWakeGrant {
    address: Address,
    expires_at: Instant,
}

fn typed_json<T: Serialize>(payload: T) -> json::Value {
    json::to_value(payload).unwrap_or_else(|_| json::json!({}))
}

fn remove_generic_connection(
    connections: &mut Vec<GenericConnection>,
    connection_id: &str,
    device: Address,
) -> bool {
    connections.retain(|connection| connection.connection_id != connection_id);
    connections
        .iter()
        .any(|connection| connection.device_address == device)
}

fn target_peer(message: &AppMessage) -> Option<String> {
    serde_json::from_slice::<json::Value>(&message.data)
        .ok()
        .and_then(|data| {
            data.get("_targetPeer")
                .and_then(|peer| peer.as_str())
                .map(ToOwned::to_owned)
        })
}

fn target_connection(message: &AppMessage) -> Option<String> {
    serde_json::from_slice::<json::Value>(&message.data)
        .ok()
        .and_then(|data| {
            data.get("_targetConnection")
                .and_then(|route| route.as_str())
                .map(ToOwned::to_owned)
        })
}

fn spp_connection_route(connection_id: &str) -> String {
    format!("spp:{connection_id}")
}

fn should_route_message(message: &AppMessage, route: &str, peer: Address) -> bool {
    if let Some(target) = target_connection(message) {
        return target == route;
    }

    match target_peer(message) {
        Some(target) => target == peer.to_string(),
        None => true,
    }
}

pub(crate) fn metadata_identifies_computer(
    icon: Option<&str>,
    class: Option<u32>,
    alias: Option<&str>,
    name: Option<&str>,
) -> bool {
    if icon == Some("computer") || class.map(|value| (value >> 8) & 0x1f) == Some(0x01) {
        return true;
    }

    [alias, name].into_iter().flatten().any(|value| {
        let lower = value.to_lowercase();
        lower.contains("macbook")
            || lower.contains("mac mini")
            || lower.contains("mac studio")
            || lower.contains("imac")
            || lower.contains("nocturne connector")
    })
}

struct Iap2ConnectionInputs {
    connections: Arc<Mutex<Vec<Iap2Connection>>>,
    adapter: Adapter,
    reconnects: Arc<Mutex<HashMap<Address, JoinHandle<()>>>>,
    recent_pairings: Arc<Mutex<HashMap<Address, Instant>>>,
    known_macos_connectors: KnownMacOSConnectors,
    ancs_manager: Option<ancs::AncsManager>,
    websocket_server: Option<Arc<WebSocketServer>>,
    audio_event_rx: broadcast::Receiver<AudioEvent>,
    audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    wakeword_pause_tx: mpsc::UnboundedSender<WakeWordCommand>,
    ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
}

impl Iap2ConnectionInputs {
    fn fork(&self) -> Self {
        Self {
            connections: self.connections.clone(),
            adapter: self.adapter.clone(),
            reconnects: self.reconnects.clone(),
            recent_pairings: self.recent_pairings.clone(),
            known_macos_connectors: self.known_macos_connectors.clone(),
            ancs_manager: self.ancs_manager.clone(),
            websocket_server: self.websocket_server.clone(),
            audio_event_rx: self.audio_event_rx.resubscribe(),
            audio_cmd_tx: self.audio_cmd_tx.clone(),
            wakeword_pause_tx: self.wakeword_pause_tx.clone(),
            ota_cmd_tx: self.ota_cmd_tx.clone(),
        }
    }
}

#[derive(Clone)]
struct KnownMacOSConnectors {
    peers: Arc<Mutex<HashSet<Address>>>,
    path: Arc<PathBuf>,
}

#[derive(Deserialize, Serialize)]
struct PersistedMacOSConnectors {
    addresses: Vec<String>,
}

impl KnownMacOSConnectors {
    async fn load(path: PathBuf) -> Self {
        let peers = match tokio::fs::read(&path).await {
            Ok(data) => match serde_json::from_slice::<PersistedMacOSConnectors>(&data) {
                Ok(state) => state
                    .addresses
                    .into_iter()
                    .filter_map(|value| match Address::from_str(&value) {
                        Ok(address) => Some(address),
                        Err(error) => {
                            warn!(%value, %error, "Ignoring invalid persisted macOS connector address");
                            None
                        }
                    })
                    .collect(),
                Err(error) => {
                    warn!(%error, path = %path.display(), "Ignoring malformed macOS connector registry");
                    HashSet::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashSet::new(),
            Err(error) => {
                warn!(%error, path = %path.display(), "Failed to load macOS connector registry");
                HashSet::new()
            }
        };
        Self {
            peers: Arc::new(Mutex::new(peers)),
            path: Arc::new(path),
        }
    }

    async fn contains(&self, address: Address) -> bool {
        self.peers.lock().await.contains(&address)
    }

    async fn remember(&self, address: Address) {
        let mut peers = self.peers.lock().await;
        if !peers.insert(address) {
            return;
        }
        if let Err(error) = self.persist(&peers).await {
            warn!(%address, %error, "Failed to persist learned macOS connector identity");
        } else {
            info!(%address, "Remembered macOS connector identity");
        }
    }

    async fn forget(&self, addresses: &[Address]) {
        let mut peers = self.peers.lock().await;
        let mut changed = false;
        for address in addresses {
            changed |= peers.remove(address);
        }
        if changed {
            if let Err(error) = self.persist(&peers).await {
                warn!(%error, "Failed to persist removal from macOS connector registry");
            }
        }
    }

    async fn persist(&self, peers: &HashSet<Address>) -> std::io::Result<()> {
        let Some(parent) = self.path.parent() else {
            return Err(std::io::Error::other("registry path has no parent"));
        };
        tokio::fs::create_dir_all(parent).await?;
        let mut addresses: Vec<_> = peers.iter().map(ToString::to_string).collect();
        addresses.sort_unstable();
        let data = serde_json::to_vec(&PersistedMacOSConnectors { addresses })
            .map_err(std::io::Error::other)?;
        let temporary = self.path.with_extension("json.tmp");
        tokio::fs::write(&temporary, data).await?;
        tokio::fs::rename(temporary, self.path.as_ref()).await
    }
}

struct ResolvedBluezDevice {
    device: Device,
    object_address: Address,
    canonical_address: Address,
}

fn select_device_address(
    requested: Address,
    candidates: &[(Address, Option<Address>)],
) -> Option<(Address, Address)> {
    candidates
        .iter()
        .find(|(object_address, _)| *object_address == requested)
        .or_else(|| {
            candidates
                .iter()
                .find(|(_, remote_address)| *remote_address == Some(requested))
        })
        .map(|(object_address, remote_address)| {
            (*object_address, remote_address.unwrap_or(*object_address))
        })
}

fn name_identifies_ios_device(value: Option<&str>) -> bool {
    value.is_some_and(|name| {
        let normalized = name.trim().to_ascii_lowercase();
        normalized.contains("iphone") || normalized.contains("ipad") || normalized.contains("ipod")
    })
}

fn metadata_identifies_iap2_device(
    name: Option<&str>,
    alias: Option<&str>,
    cached_apple_service: bool,
) -> bool {
    cached_apple_service || name_identifies_ios_device(name) || name_identifies_ios_device(alias)
}

fn classify_iap2_metadata(
    name: Option<&str>,
    alias: Option<&str>,
    cached_apple_service: bool,
    metadata_ready: bool,
) -> Iap2CandidateClassification {
    if metadata_identifies_iap2_device(name, alias, cached_apple_service) {
        Iap2CandidateClassification::Candidate
    } else if metadata_ready {
        Iap2CandidateClassification::Other
    } else {
        Iap2CandidateClassification::Incomplete
    }
}

fn iap2_metadata_is_ready(name: Option<&str>, cached_service_count: Option<usize>) -> bool {
    name.is_some() || cached_service_count.is_some_and(|count| count > 0)
}

fn device_type_identifies_ios(device_type: &str) -> bool {
    matches!(
        device_type.trim().to_ascii_lowercase().as_str(),
        "ios" | "iphone" | "ipad" | "ipod"
    )
}

fn iap2_reconnect_allowed(paired: bool, blocked: bool) -> bool {
    paired && !blocked
}

fn update_recent_pairing(
    recent_pairings: &mut HashMap<Address, Instant>,
    object_address: Address,
    canonical_address: Address,
    paired: bool,
    changed_at: Instant,
) -> bool {
    let was_paired = recent_pairings.contains_key(&object_address)
        || recent_pairings.contains_key(&canonical_address);
    recent_pairings.remove(&object_address);
    recent_pairings.remove(&canonical_address);
    if paired {
        recent_pairings.insert(canonical_address, changed_at);
    }
    paired && !was_paired
}

fn promote_recent_pairing(
    recent_pairings: &mut HashMap<Address, Instant>,
    old_address: Address,
    canonical_address: Address,
) {
    if old_address == canonical_address {
        return;
    }
    let Some(old_timestamp) = recent_pairings.remove(&old_address) else {
        return;
    };
    recent_pairings
        .entry(canonical_address)
        .and_modify(|timestamp| *timestamp = (*timestamp).max(old_timestamp))
        .or_insert(old_timestamp);
}

fn promote_map_key<T>(
    entries: &mut HashMap<Address, T>,
    old_address: Address,
    canonical_address: Address,
) -> bool {
    if old_address == canonical_address {
        return true;
    }
    if entries.contains_key(&canonical_address) {
        entries.remove(&old_address);
        return false;
    }
    if let Some(entry) = entries.remove(&old_address) {
        entries.insert(canonical_address, entry);
    }
    true
}

fn is_transient_adapter_startup_error(error: &bluer::Error) -> bool {
    matches!(error.kind, ErrorKind::NotFound | ErrorKind::NotReady)
        || matches!(
            &error.kind,
            ErrorKind::Internal(InternalErrorKind::DBus(name))
                if matches!(
                    name.as_str(),
                    "org.bluez.Error.Busy"
                        | "org.freedesktop.DBus.Error.ServiceUnknown"
                        | "org.freedesktop.DBus.Error.NameHasNoOwner"
                )
        )
}

async fn configure_adapter(adapter: &Adapter) -> bluer::Result<()> {
    adapter.set_powered(true).await?;
    adapter.set_discoverable(false).await?;
    adapter.set_pairable(false).await?;
    adapter.set_discoverable_timeout(0).await?;
    adapter.set_pairable_timeout(0).await?;
    Ok(())
}

async fn wait_for_ready_bluetooth() -> (Session, Adapter) {
    let mut attempts = 0_u32;
    let mut retry_interval = DEFAULT_ADAPTER_RETRY_INTERVAL;

    loop {
        let result: bluer::Result<(Session, Adapter)> = async {
            let session = Session::new().await?;
            let adapter = session.default_adapter().await?;
            configure_adapter(&adapter).await?;
            Ok((session, adapter))
        }
        .await;

        match result {
            Ok((session, adapter)) => {
                if attempts > 0 {
                    info!(attempts, "Bluetooth adapter became ready");
                }
                return (session, adapter);
            }
            Err(error) => {
                attempts += 1;
                if attempts == 1 || attempts.is_power_of_two() {
                    let retry_ms = retry_interval.as_millis();
                    if is_transient_adapter_startup_error(&error) {
                        warn!(
                            %error,
                            attempts,
                            retry_ms,
                            "Bluetooth adapter is not ready; waiting for BlueZ"
                        );
                    } else {
                        warn!(
                            %error,
                            attempts,
                            retry_ms,
                            "Bluetooth initialization failed; retrying without stopping the daemon"
                        );
                    }
                }
                tokio::time::sleep(retry_interval).await;
                retry_interval =
                    std::cmp::min(retry_interval.saturating_mul(2), MAX_ADAPTER_RETRY_INTERVAL);
            }
        }
    }
}

pub struct BluetoothDaemon {
    session: Session,
    adapter: Adapter,
    accessory_setup: Option<accessory_setup::AccessorySetupBootstrap>,
    ancs_monitor: Option<ancs::AncsMonitor>,
    ancs_manager: Option<ancs::AncsManager>,
    recent_pairings: Arc<Mutex<HashMap<Address, Instant>>>,
    known_macos_connectors: KnownMacOSConnectors,
    connections: Arc<Mutex<Vec<Iap2Connection>>>,
    iap2_reconnects: Arc<Mutex<HashMap<Address, JoinHandle<()>>>>,
    generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
    android_wake_grant: Arc<Mutex<Option<AndroidWakeGrant>>>,
    ws_to_app_rx: Option<mpsc::UnboundedReceiver<AppMessage>>,
    websocket_server: Option<Arc<WebSocketServer>>,
    audio_event_rx: broadcast::Receiver<AudioEvent>,
    audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    wakeword_pause_tx: mpsc::UnboundedSender<WakeWordCommand>,
    ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
}

impl BluetoothDaemon {
    pub async fn new(
        _config: Config,
        ws_to_app_rx: Option<mpsc::UnboundedReceiver<AppMessage>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<WakeWordCommand>,
        ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    ) -> Result<Self> {
        let (session, adapter) = wait_for_ready_bluetooth().await;

        info!("Using Bluetooth adapter: {}", adapter.name());

        let device_name = crate::system::config::get_bluetooth_device_name().unwrap_or_else(|e| {
            warn!(
                "Failed to get dynamic device name, falling back to 'Nocturne': {}",
                e
            );
            "Nocturne".to_string()
        });
        if let Err(e) = adapter.set_alias(device_name.clone()).await {
            warn!(
                "Failed to set Bluetooth device name to '{}': {}",
                device_name, e
            );
        } else {
            info!("Set Bluetooth device name to: {}", device_name);
        }

        if let Err(e) = pairing::start_agent_thread(websocket_server.clone()) {
            warn!("Failed to start Bluetooth pairing agent: {}", e);
        }

        let known_macos_connectors =
            KnownMacOSConnectors::load(PathBuf::from(KNOWN_MACOS_CONNECTORS_PATH)).await;

        Ok(BluetoothDaemon {
            session,
            adapter,
            accessory_setup: None,
            ancs_monitor: None,
            ancs_manager: None,
            recent_pairings: Arc::new(Mutex::new(HashMap::new())),
            known_macos_connectors,
            connections: Arc::new(Mutex::new(Vec::new())),
            iap2_reconnects: Arc::new(Mutex::new(HashMap::new())),
            generic_connections: Arc::new(Mutex::new(Vec::new())),
            android_wake_grant: Arc::new(Mutex::new(None)),
            ws_to_app_rx,
            websocket_server,
            audio_event_rx,
            audio_cmd_tx,
            wakeword_pause_tx,
            ota_cmd_tx,
        })
    }

    fn iap2_connection_inputs(&self) -> Iap2ConnectionInputs {
        Iap2ConnectionInputs {
            connections: self.connections.clone(),
            adapter: self.adapter.clone(),
            reconnects: self.iap2_reconnects.clone(),
            recent_pairings: self.recent_pairings.clone(),
            known_macos_connectors: self.known_macos_connectors.clone(),
            ancs_manager: self.ancs_manager.clone(),
            websocket_server: self.websocket_server.clone(),
            audio_event_rx: self.audio_event_rx.resubscribe(),
            audio_cmd_tx: self.audio_cmd_tx.clone(),
            wakeword_pause_tx: self.wakeword_pause_tx.clone(),
            ota_cmd_tx: self.ota_cmd_tx.clone(),
        }
    }

    async fn resolve_bluez_device(
        adapter: &Adapter,
        requested: Address,
    ) -> Option<ResolvedBluezDevice> {
        let object_addresses = adapter.device_addresses().await.ok()?;
        let mut candidates = Vec::with_capacity(object_addresses.len());

        for object_address in object_addresses {
            let Ok(device) = adapter.device(object_address) else {
                continue;
            };
            let remote_address = device.remote_address().await.ok();
            candidates.push((object_address, remote_address));
        }

        let (object_address, canonical_address) = select_device_address(requested, &candidates)?;
        let device = adapter.device(object_address).ok()?;

        Some(ResolvedBluezDevice {
            device,
            object_address,
            canonical_address,
        })
    }

    async fn classify_iap2_candidate(device: &Device) -> Iap2CandidateClassification {
        match device.is_paired().await {
            Ok(true) => {}
            Ok(false) => return Iap2CandidateClassification::Other,
            Err(_) => return Iap2CandidateClassification::Incomplete,
        }

        let uuids = device.uuids().await;
        let cached_apple_service = matches!(
            &uuids,
            Ok(Some(uuids))
                if uuids.contains(&iap2_rs::IAP2_DEVICE_UUID)
                    || uuids.contains(&ANCS_SERVICE_UUID)
        );
        let name = device.name().await.ok().flatten();
        let alias = device.alias().await.ok();

        classify_iap2_metadata(
            name.as_deref(),
            alias.as_deref(),
            cached_apple_service,
            iap2_metadata_is_ready(
                name.as_deref(),
                match &uuids {
                    Ok(Some(uuids)) => Some(uuids.len()),
                    _ => None,
                },
            ),
        )
    }

    async fn device_is_iap2_candidate(device: &Device) -> bool {
        Self::classify_iap2_candidate(device).await == Iap2CandidateClassification::Candidate
    }

    async fn check_stale_advertisements(&self) {
        match self.adapter.active_advertising_instances().await {
            Ok(count) if count > 0 => {
                warn!(
                    "Detected {} active advertising instance(s) from a previous run. \
                     If BLE advertising misbehaves, restart bluetooth: \
                     sudo systemctl restart bluetooth",
                    count
                );
            }
            Ok(_) => {
                debug!("No stale advertisements detected");
            }
            Err(e) => {
                debug!("Could not check active advertising instances: {}", e);
            }
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        self.check_stale_advertisements().await;

        self.start_listener().await?;

        self.start_device_monitor().await;

        self.kickoff_iap2_reconnects().await;

        info!("Bluetooth daemon running, waiting for connections...");

        if let Some(mut ws_rx) = self.ws_to_app_rx.take() {
            let connections = Arc::clone(&self.connections);
            let generic_connections = Arc::clone(&self.generic_connections);
            let websocket_server = self.websocket_server.clone();
            let adapter = self.adapter.clone();
            let reconnects = self.iap2_reconnects.clone();
            let recent_pairings = self.recent_pairings.clone();
            let known_macos_connectors = self.known_macos_connectors.clone();
            let ancs_manager = self.ancs_manager.clone();
            let android_wake_grant = self.android_wake_grant.clone();
            let audio_cmd_tx = self.audio_cmd_tx.clone();
            let wakeword_pause_tx = self.wakeword_pause_tx.clone();
            let ota_cmd_tx = self.ota_cmd_tx.clone();
            let audio_event_rx_for_connect = self.audio_event_rx.resubscribe();
            tokio::spawn(async move {
                while let Some(ws_message) = ws_rx.recv().await {
                    debug!("Received WebSocket message: {:?}", ws_message);

                    if ws_message.protocol == "bluetooth.control" {
                        debug!("Processing bluetooth control message");

                        if let Ok(data) = serde_json::from_slice::<json::Value>(&ws_message.data) {
                            if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
                                match method {
                                    "bluetooth.device.connect" => {
                                        let request = data
                                            .get("params")
                                            .cloned()
                                            .ok_or_else(|| "missing params".to_string())
                                            .and_then(|params| {
                                                serde_json::from_value::<
                                                    BluetoothDeviceConnectRequest,
                                                >(
                                                    params
                                                )
                                                .map_err(|e| e.to_string())
                                            });

                                        if let Ok(request) = request {
                                            let requested_channel = request.channel.unwrap_or(0);
                                            let requested_device_type =
                                                request.device_type.unwrap_or_default();
                                            let address_str = request.address;
                                            if let Ok(address) = Address::from_str(&address_str) {
                                                let connections_clone = Arc::clone(&connections);
                                                let generic_connections_clone =
                                                    Arc::clone(&generic_connections);
                                                let ws_server_clone = websocket_server.clone();
                                                let msg_id = ws_message.id.clone();
                                                let address_str_clone = address_str.clone();
                                                let adapter_clone = adapter.clone();
                                                let reconnects_clone = reconnects.clone();
                                                let recent_pairings_clone = recent_pairings.clone();
                                                let known_macos_connectors_clone =
                                                    known_macos_connectors.clone();
                                                let ancs_manager_clone = ancs_manager.clone();
                                                let android_wake_grant_clone =
                                                    android_wake_grant.clone();
                                                let audio_rx =
                                                    audio_event_rx_for_connect.resubscribe();
                                                let audio_tx = audio_cmd_tx.clone();
                                                let wakeword_pause = wakeword_pause_tx.clone();
                                                let ota_cmd = ota_cmd_tx.clone();

                                                tokio::spawn(async move {
                                                    let connect_result =
                                                        BluetoothDaemon::connect_to_device(
                                                            address,
                                                            requested_channel,
                                                            requested_device_type.as_str(),
                                                            Iap2ConnectionInputs {
                                                                connections: connections_clone,
                                                                adapter: adapter_clone,
                                                                reconnects: reconnects_clone,
                                                                recent_pairings:
                                                                    recent_pairings_clone,
                                                                known_macos_connectors:
                                                                    known_macos_connectors_clone,
                                                                ancs_manager: ancs_manager_clone,
                                                                websocket_server: ws_server_clone
                                                                    .clone(),
                                                                audio_event_rx: audio_rx,
                                                                audio_cmd_tx: audio_tx,
                                                                wakeword_pause_tx: wakeword_pause,
                                                                ota_cmd_tx: ota_cmd,
                                                            },
                                                            generic_connections_clone,
                                                            android_wake_grant_clone.clone(),
                                                        )
                                                        .await;

                                                    match connect_result {
                                                    Ok(outcome) => match outcome {
                                                        ConnectionOutcome::Connected => {
                                                            info!(
                                                                "Successfully connected to {}",
                                                                address
                                                            );
                                                            if let Some(ws_server) =
                                                                &ws_server_clone
                                                            {
                                                                ws_server.send_response(
                                                                    msg_id,
                                                                    typed_json(BluetoothDeviceConnectResponse {
                                                                        status: "connected".to_string(),
                                                                        device: address_str_clone,
                                                                    }),
                                                                ).await;
                                                            }
                                                        }
                                                        ConnectionOutcome::WaitingForIos => {
                                                            info!(
                                                                "Waiting for iOS device {} to open iAP2",
                                                                address
                                                            );
                                                            if let Some(ws_server) =
                                                                &ws_server_clone
                                                            {
                                                                ws_server.send_response(
                                                                    msg_id,
                                                                    typed_json(BluetoothDeviceConnectResponse {
                                                                        status: "waiting_for_ios".to_string(),
                                                                        device: address_str_clone,
                                                                    }),
                                                                ).await;
                                                            }
                                                        }
                                                        ConnectionOutcome::WaitingForMacConnector => {
                                                            info!(
                                                                "Waiting for macOS connector {} to dial back over SPP",
                                                                address
                                                            );
                                                            if let Some(ws_server) =
                                                                &ws_server_clone
                                                            {
                                                                ws_server.send_response(
                                                                    msg_id,
                                                                    typed_json(BluetoothDeviceConnectResponse {
                                                                        status: "waiting_for_macos_connector".to_string(),
                                                                        device: address_str_clone,
                                                                    }),
                                                                ).await;
                                                            }
                                                        }
                                                        ConnectionOutcome::WaitingForAndroid => {
                                                            info!(
                                                                "Waiting for Android device {} to connect back over SPP",
                                                                address
                                                            );
                                                            if let Some(ws_server) =
                                                                &ws_server_clone
                                                            {
                                                                ws_server.send_response(
                                                                    msg_id,
                                                                    typed_json(BluetoothDeviceConnectResponse {
                                                                        status: "waiting_for_android".to_string(),
                                                                        device: address_str_clone,
                                                                    }),
                                                                ).await;
                                                            }
                                                        }
                                                    },
                                                    Err(e) => {
                                                        error!(
                                                            "Failed to connect to {}: {}",
                                                            address, e
                                                        );
                                                            if let Some(ws_server) =
                                                                &ws_server_clone
                                                            {
                                                                ws_server.send_response(
                                                                    msg_id,
                                                                    serde_json::json!({
                                                                        "error": format!("Connection failed: {}", e)
                                                                    }),
                                                                ).await;
                                                            }
                                                        }
                                                    }
                                                });
                                            } else {
                                                warn!("Invalid Bluetooth address: {}", address_str);
                                                if let Some(ws_server) = &websocket_server {
                                                    ws_server
                                                        .send_response(
                                                            ws_message.id,
                                                            serde_json::json!({
                                                                "error": "Invalid Bluetooth address"
                                                            }),
                                                        )
                                                        .await;
                                                }
                                            }
                                        } else if let Some(ws_server) = &websocket_server {
                                            ws_server
                                                .send_response(
                                                    ws_message.id,
                                                    json::json!({ "error": "Missing or invalid address parameter" }),
                                                )
                                                .await;
                                        }
                                    }
                                    "bluetooth.device.disconnect" => {
                                        let address_str = data
                                            .get("params")
                                            .cloned()
                                            .and_then(|params| {
                                                serde_json::from_value::<
                                                    BluetoothDeviceDisconnectRequest,
                                                >(
                                                    params
                                                )
                                                .ok()
                                            })
                                            .map(|request| request.address);

                                        let ws_server_clone = websocket_server.clone();
                                        let msg_id = ws_message.id.clone();

                                        match address_str {
                                            None => {
                                                warn!("Missing address in bluetooth.device.disconnect");
                                                if let Some(ws_server) = &websocket_server {
                                                    ws_server
                                                        .send_response(
                                                            ws_message.id,
                                                            serde_json::json!({
                                                                "error": "Missing address parameter"
                                                            }),
                                                        )
                                                        .await;
                                                }
                                            }
                                            Some(addr) => {
                                                match Address::from_str(&addr) {
                                                    Err(_) => {
                                                        warn!(
                                                            "Invalid Bluetooth address: {}",
                                                            addr
                                                        );
                                                        if let Some(ws_server) = &websocket_server {
                                                            ws_server.send_response(
                                                                ws_message.id,
                                                                serde_json::json!({
                                                                    "error": "Invalid Bluetooth address"
                                                                }),
                                                            ).await;
                                                        }
                                                    }
                                                    Ok(address) => {
                                                        let connections_clone =
                                                            Arc::clone(&connections);

                                                        tokio::spawn(async move {
                                                            match BluetoothDaemon::disconnect_device(
                                                                address,
                                                                connections_clone,
                                                                ws_server_clone.clone(),
                                                            ).await {
                                                                Ok(()) => {
                                                                    info!("Disconnected from {}", address);
                                                                    if let Some(ws_server) = &ws_server_clone {
                                                                    ws_server.send_response(
                                                                        msg_id,
                                                                        typed_json(BluetoothDeviceDisconnectResponse {
                                                                            status: "disconnected".to_string(),
                                                                            device: addr,
                                                                        }),
                                                                    ).await;
                                                                    }
                                                                }
                                                                Err(e) => {
                                                                    error!("Failed to disconnect {}: {}", address, e);
                                                                    if let Some(ws_server) = &ws_server_clone {
                                                                        ws_server.send_response(
                                                                            msg_id,
                                                                            serde_json::json!({
                                                                                "error": e.to_string()
                                                                            }),
                                                                        ).await;
                                                                    }
                                                                }
                                                            }
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    "bluetooth.device.unpair" | "bluetooth.device.forget" => {
                                        let address_str = data
                                            .get("params")
                                            .cloned()
                                            .and_then(|params| {
                                                serde_json::from_value::<
                                                        BluetoothDeviceUnpairRequest,
                                                    >(
                                                        params
                                                    )
                                                    .ok()
                                            })
                                            .map(|request| request.address);

                                        let ws_server_clone = websocket_server.clone();
                                        let msg_id = ws_message.id.clone();

                                        match address_str {
                                            None => {
                                                warn!("Missing address in bluetooth.device.unpair");
                                                if let Some(ws_server) = &websocket_server {
                                                    ws_server
                                                        .send_response(
                                                            ws_message.id,
                                                            serde_json::json!({
                                                                "error": "Missing address parameter"
                                                            }),
                                                        )
                                                        .await;
                                                }
                                            }
                                            Some(addr) => match Address::from_str(&addr) {
                                                Err(_) => {
                                                    warn!("Invalid Bluetooth address: {}", addr);
                                                    if let Some(ws_server) = &websocket_server {
                                                        ws_server.send_response(
                                                                ws_message.id,
                                                                serde_json::json!({
                                                                    "error": "Invalid Bluetooth address"
                                                                }),
                                                            ).await;
                                                    }
                                                }
                                                Ok(address) => {
                                                    let connections_clone =
                                                        Arc::clone(&connections);

                                                    tokio::spawn(async move {
                                                        match BluetoothDaemon::unpair_device(
                                                            address,
                                                            connections_clone,
                                                            ws_server_clone.clone(),
                                                        )
                                                        .await
                                                        {
                                                            Ok(()) => {
                                                                info!("Unpaired {}", address);
                                                                if let Some(ws_server) =
                                                                    &ws_server_clone
                                                                {
                                                                    ws_server.send_response(
                                                                            msg_id,
                                                                            typed_json(BluetoothDeviceUnpairResponse {
                                                                                status: "unpaired".to_string(),
                                                                                device: addr,
                                                                            }),
                                                                        ).await;
                                                                }
                                                            }
                                                            Err(e) => {
                                                                error!(
                                                                    "Failed to unpair {}: {}",
                                                                    address, e
                                                                );
                                                                if let Some(ws_server) =
                                                                    &ws_server_clone
                                                                {
                                                                    ws_server.send_response(
                                                                            msg_id,
                                                                            serde_json::json!({
                                                                                "error": e.to_string()
                                                                            }),
                                                                        ).await;
                                                                }
                                                            }
                                                        }
                                                    });
                                                }
                                            },
                                        }
                                    }
                                    _ => {
                                        warn!("Unknown bluetooth control method: {}", method);
                                    }
                                }
                            }
                        }
                        continue;
                    }

                    if let Ok(data) = serde_json::from_slice::<json::Value>(&ws_message.data) {
                        if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
                            if method == "voice.cancel" {
                                debug!(
                                    "Voice cancel requested; stopping audio capture before routing to phone"
                                );
                                let _ = audio_cmd_tx.send(AudioCommand::Stop);
                            }
                            if method == "audio.record.start" {
                                let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
                                let _ = wakeword_pause_tx.send(WakeWordCommand::Pause {
                                    ack: Some(ack_tx),
                                    persist: false,
                                });
                                match tokio::time::timeout(
                                    std::time::Duration::from_secs(1),
                                    ack_rx,
                                )
                                .await
                                {
                                    Ok(Ok(())) => {}
                                    _ => warn!("Wakeword pause ack timed out, proceeding anyway"),
                                }
                                let _ = audio_cmd_tx.send(AudioCommand::Start);
                                if let Some(ws_server) = &websocket_server {
                                    ws_server
                                        .send_response(
                                            ws_message.id.clone(),
                                            serde_json::json!({ "status": "recording" }),
                                        )
                                        .await;
                                }
                                continue;
                            }
                            if method == "audio.record.stop" {
                                let _ = audio_cmd_tx.send(AudioCommand::Stop);
                                if let Some(ws_server) = &websocket_server {
                                    ws_server
                                        .send_response(
                                            ws_message.id.clone(),
                                            serde_json::json!({ "status": "idle" }),
                                        )
                                        .await;
                                }
                                continue;
                            }
                            if method == "wakeword.pause" {
                                let _ = wakeword_pause_tx.send(WakeWordCommand::Pause {
                                    ack: None,
                                    persist: true,
                                });
                                if let Some(ws_server) = &websocket_server {
                                    ws_server
                                        .send_response(
                                            ws_message.id.clone(),
                                            serde_json::json!({ "status": "paused" }),
                                        )
                                        .await;
                                }
                                continue;
                            }
                            if method == "wakeword.resume" {
                                let _ = wakeword_pause_tx
                                    .send(WakeWordCommand::Resume { persist: true });
                                if let Some(ws_server) = &websocket_server {
                                    ws_server
                                        .send_response(
                                            ws_message.id.clone(),
                                            serde_json::json!({ "status": "resumed" }),
                                        )
                                        .await;
                                }
                                continue;
                            }
                        }
                    }

                    let conns = connections.lock().await;
                    let mut success_count = 0;
                    for conn in conns.iter() {
                        if !should_route_message(
                            &ws_message,
                            &conn.route_id(),
                            conn.device_address(),
                        ) {
                            continue;
                        }
                        if let Err(e) = conn.send_websocket_message(ws_message.clone()).await {
                            warn!("Failed to send WebSocket message to iAP2 connection: {}", e);
                        } else {
                            debug!("Successfully routed WebSocket message to iAP2 connection");
                            success_count += 1;
                        }
                    }
                    drop(conns);

                    let generic_conns = generic_connections.lock().await;
                    for conn in generic_conns.iter() {
                        if !should_route_message(
                            &ws_message,
                            &spp_connection_route(&conn.connection_id),
                            conn.device_address,
                        ) {
                            continue;
                        }
                        if let Err(e) = conn.tx.send(ws_message.clone()) {
                            warn!("Failed to send WebSocket message to SPP connection: {}", e);
                        } else {
                            debug!("Successfully routed WebSocket message to SPP connection");
                            success_count += 1;
                        }
                    }
                    drop(generic_conns);

                    if success_count > 0 {
                        debug!(
                            "Broadcast WebSocket message to {} connection(s)",
                            success_count
                        );
                    }
                }
            });
        }
        let mut sigint =
            signal(SignalKind::interrupt()).map_err(crate::error::NocturnedError::Io)?;
        let mut sigterm =
            signal(SignalKind::terminate()).map_err(crate::error::NocturnedError::Io)?;

        tokio::select! {
            _ = sigint.recv() => {
                info!("Received SIGINT, shutting down...");
            }
            _ = sigterm.recv() => {
                info!("Received SIGTERM, shutting down...");
            }
        }

        self.cleanup().await?;

        Ok(())
    }

    async fn kickoff_iap2_reconnects(&self) {
        let addresses = match self.adapter.device_addresses().await {
            Ok(addrs) => addrs,
            Err(e) => {
                warn!(
                    "Failed to enumerate devices for iAP2 reconnect kickoff: {}",
                    e
                );
                return;
            }
        };
        for address in addresses {
            Self::arm_iap2_reconnect(self.iap2_connection_inputs(), address, false).await;
        }
    }

    async fn start_listener(&mut self) -> Result<()> {
        self.register_accessory_setup_bootstrap().await;
        self.start_ancs_monitor();

        let accessory_uuid = iap2_rs::IAP2_ACCESSORY_UUID.to_string();

        info!("Registering iAP2 accessory profile");
        self.register_iap2_profile(&accessory_uuid).await?;
        info!("iAP2 accessory service UUID: {}", accessory_uuid);

        info!("Registering iAP2 device dial-in profile");
        self.register_iap2_client_profile().await?;
        info!("iAP2 device service UUID: {}", iap2_rs::IAP2_DEVICE_UUID);

        info!("Registering SPP profile for generic devices");
        self.register_spp_profile().await?;
        info!("SPP Service UUID: 00001101-0000-1000-8000-00805f9b34fb");

        self.register_bluetooth_agent().await?;
        if let Some(websocket_server) = &self.websocket_server {
            let discoverable = websocket_server
                .restore_pairing_window(&self.adapter)
                .await?;
            info!(discoverable, "Restored requested Bluetooth pairing window");
        } else {
            self.adapter.set_discoverable(false).await?;
            self.adapter.set_pairable(false).await?;
        }

        Ok(())
    }

    fn start_ancs_monitor(&mut self) {
        let Some(websocket_server) = self.websocket_server.clone() else {
            debug!("ANCS monitor disabled because no WebSocket server is configured");
            return;
        };
        let (manager, monitor) = ancs::AncsMonitor::start(self.adapter.clone(), websocket_server);
        self.ancs_manager = Some(manager);
        self.ancs_monitor = Some(monitor);
        info!("ANCS iPhone notification monitor started");
    }

    /// Registers the AccessorySetupKit GATT pairing service and its connectable
    /// advertisement. Bonded peers keep the advertisement alive so iOS can
    /// restore the LE link used by ANCS without reopening classic discovery.
    async fn register_accessory_setup_bootstrap(&mut self) {
        let device_name = self
            .adapter
            .alias()
            .await
            .unwrap_or_else(|_| "Nocturne".to_string());
        let device_serial =
            crate::system::config::get_serial_number().unwrap_or_else(|_| device_name.clone());
        match accessory_setup::AccessorySetupBootstrap::register(
            &self.adapter,
            &device_name,
            &device_serial,
        )
        .await
        {
            Ok(bootstrap) => {
                info!(
                    service_uuid = %accessory_setup::ACCESSORY_SETUP_SERVICE,
                    characteristic_uuid = %accessory_setup::ACCESSORY_SETUP_CHARACTERISTIC,
                    "AccessorySetupKit BLE bootstrap registered"
                );
                self.accessory_setup = Some(bootstrap);
            }
            Err(e) => {
                warn!(
                    error = %e,
                    "AccessorySetupKit BLE bootstrap unavailable; continuing without it"
                );
            }
        }
    }

    async fn start_device_monitor(&self) {
        let adapter = self.adapter.clone();
        let websocket_server = self.websocket_server.clone();
        let connection_inputs = self.iap2_connection_inputs();

        tokio::spawn(async move {
            match adapter.events().await {
                Ok(mut events) => {
                    info!("Device monitor started");
                    while let Some(event) = events.next().await {
                        match event {
                            AdapterEvent::DeviceAdded(address) => {
                                info!("Device added: {}", address);

                                if let Ok(device) = adapter.device(address) {
                                    let ws = websocket_server.clone();
                                    let inputs = connection_inputs.fork();
                                    tokio::spawn(async move {
                                        Self::monitor_device_events(device, address, ws, inputs)
                                            .await;
                                    });
                                }
                            }
                            AdapterEvent::DeviceRemoved(address) => {
                                info!("Device removed: {}", address);
                                if let Some(ws) = &websocket_server {
                                    ws.broadcast_event(
                                        "bluetooth.device".to_string(),
                                        typed_json(BluetoothDeviceEvent {
                                            event: "removed".to_string(),
                                            device: address.to_string(),
                                        }),
                                    )
                                    .await;
                                }
                            }
                            _ => {}
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to start device monitor: {}", e);
                }
            }
        });
    }

    async fn monitor_device_events(
        device: Device,
        address: Address,
        websocket_server: Option<Arc<WebSocketServer>>,
        connection_inputs: Iap2ConnectionInputs,
    ) {
        match device.events().await {
            Ok(mut events) => {
                if device.is_paired().await.unwrap_or(false) {
                    Self::handle_pairing_state(
                        address,
                        true,
                        &websocket_server,
                        &connection_inputs,
                    )
                    .await;
                }

                while let Some(event) = events.next().await {
                    match event {
                        DeviceEvent::PropertyChanged(DeviceProperty::Paired(paired)) => {
                            Self::handle_pairing_state(
                                address,
                                paired,
                                &websocket_server,
                                &connection_inputs,
                            )
                            .await;
                        }
                        DeviceEvent::PropertyChanged(DeviceProperty::Connected(connected)) => {
                            info!("Device {} connected status changed: {}", address, connected);
                            if let Some(ws) = &websocket_server {
                                ws.broadcast_event(
                                    "bluetooth.device".to_string(),
                                    typed_json(BluetoothDeviceEvent {
                                        event: if connected {
                                            "connected"
                                        } else {
                                            "disconnected"
                                        }
                                        .to_string(),
                                        device: address.to_string(),
                                    }),
                                )
                                .await;
                            }
                        }
                        _ => {}
                    }
                }
            }
            Err(e) => {
                debug!("Failed to monitor device {} events: {}", address, e);
            }
        }
    }

    async fn handle_pairing_state(
        object_address: Address,
        paired: bool,
        websocket_server: &Option<Arc<WebSocketServer>>,
        connection_inputs: &Iap2ConnectionInputs,
    ) {
        let canonical_address =
            Self::resolve_bluez_device(&connection_inputs.adapter, object_address)
                .await
                .map(|resolved| resolved.canonical_address)
                .unwrap_or(object_address);
        info!(
            %object_address,
            device = %canonical_address,
            paired,
            "Device paired status observed"
        );
        let should_recover = {
            let mut recent_pairings = connection_inputs.recent_pairings.lock().await;
            update_recent_pairing(
                &mut recent_pairings,
                object_address,
                canonical_address,
                paired,
                Instant::now(),
            )
        };
        if !paired {
            connection_inputs
                .known_macos_connectors
                .forget(&[object_address, canonical_address])
                .await;
        }
        if let Some(ws) = websocket_server {
            ws.broadcast_event(
                "bluetooth.pairing".to_string(),
                typed_json(BluetoothPairingEvent {
                    event: Some(if paired { "paired" } else { "unpaired" }.to_string()),
                    r#type: None,
                    device: canonical_address.to_string(),
                }),
            )
            .await;
        }
        if should_recover {
            let recovery_inputs = connection_inputs.fork();
            tokio::spawn(async move {
                Self::arm_fresh_pair_transport(recovery_inputs, canonical_address).await;
            });
        }
    }

    async fn register_iap2_profile(&self, accessory_uuid: &str) -> Result<()> {
        let uuid = Uuid::from_str(accessory_uuid).map_err(|e| {
            crate::error::NocturnedError::Config(format!("Invalid iAP2 UUID: {}", e))
        })?;

        let profile = Profile {
            uuid,
            service: Some(uuid),
            name: Some("iAP2".to_string()),
            role: Some(Role::Server),
            channel: Some(IAP2_RFCOMM_CHANNEL as u16),
            require_authentication: Some(false),
            require_authorization: Some(false),
            auto_connect: Some(true),
            service_record: Some(Self::create_sdp_record_xml(accessory_uuid)),
            version: Some(0x0102),
            ..Default::default()
        };

        self.spawn_iap2_profile_handler(profile, "accessory").await
    }

    async fn register_iap2_client_profile(&self) -> Result<()> {
        let profile = Profile {
            uuid: iap2_rs::IAP2_DEVICE_UUID,
            name: Some("iAP2 (device dial-in)".to_string()),
            role: Some(Role::Client),
            require_authentication: Some(false),
            require_authorization: Some(false),
            auto_connect: Some(true),
            ..Default::default()
        };

        self.spawn_iap2_profile_handler(profile, "device").await
    }

    async fn spawn_iap2_profile_handler(
        &self,
        profile: Profile,
        direction: &'static str,
    ) -> Result<()> {
        let handle = self.session.register_profile(profile).await?;
        let connections = self.connections.clone();
        let adapter = self.adapter.clone();
        let reconnects = self.iap2_reconnects.clone();
        let recent_pairings = self.recent_pairings.clone();
        let known_macos_connectors = self.known_macos_connectors.clone();
        let ancs_manager = self.ancs_manager.clone();
        let websocket_server = self.websocket_server.clone();
        let audio_event_rx = self.audio_event_rx.resubscribe();
        let audio_cmd_tx = self.audio_cmd_tx.clone();
        let wakeword_pause_tx = self.wakeword_pause_tx.clone();
        let ota_cmd_tx = self.ota_cmd_tx.clone();

        tokio::spawn(async move {
            futures::pin_mut!(handle);
            while let Some(req) = handle.next().await {
                let transport_device = req.device();
                match req.accept() {
                    Ok(stream) => {
                        info!(%transport_device, direction, "New iAP2 RFCOMM connection");

                        if let Err(e) = Self::establish_iap2_stream(
                            transport_device,
                            stream,
                            Iap2ConnectionInputs {
                                connections: connections.clone(),
                                adapter: adapter.clone(),
                                reconnects: reconnects.clone(),
                                recent_pairings: recent_pairings.clone(),
                                known_macos_connectors: known_macos_connectors.clone(),
                                ancs_manager: ancs_manager.clone(),
                                websocket_server: websocket_server.clone(),
                                audio_event_rx: audio_event_rx.resubscribe(),
                                audio_cmd_tx: audio_cmd_tx.clone(),
                                wakeword_pause_tx: wakeword_pause_tx.clone(),
                                ota_cmd_tx: ota_cmd_tx.clone(),
                            },
                            true,
                        )
                        .await
                        {
                            error!("Failed to handle iAP2 connection: {}", e);
                        }
                    }
                    Err(e) => {
                        error!("Failed to accept iAP2 RFCOMM connection: {}", e);
                    }
                }
            }
        });

        Ok(())
    }

    async fn register_spp_profile(&self) -> Result<()> {
        let spp_uuid = Uuid::from_str("00001101-0000-1000-8000-00805f9b34fb").map_err(|e| {
            crate::error::NocturnedError::Config(format!("Invalid SPP UUID: {}", e))
        })?;

        let profile = Profile {
            uuid: spp_uuid,
            name: Some("Nocturne".to_string()),
            role: Some(Role::Server),
            channel: Some(2),
            require_authentication: Some(true),
            require_authorization: Some(false),
            auto_connect: Some(false),
            service_record: Some(self.create_spp_record_xml()),
            version: Some(0x0102),
            ..Default::default()
        };

        let session = self.session.clone();
        let generic_connections = self.generic_connections.clone();
        let websocket_server = self.websocket_server.clone();
        let android_wake_grant = self.android_wake_grant.clone();
        let adapter = self.adapter.clone();
        let audio_event_rx = self.audio_event_rx.resubscribe();
        let ota_cmd_tx = self.ota_cmd_tx.clone();

        let handle = session.register_profile(profile).await?;

        tokio::spawn(async move {
            futures::pin_mut!(handle);
            while let Some(req) = handle.next().await {
                let device = req.device();
                let paired = match adapter.device(device) {
                    Ok(remote) => remote.is_paired().await.unwrap_or(false),
                    Err(_) => false,
                };
                let wake_granted = {
                    let mut grant = android_wake_grant.lock().await;
                    let granted = grant.is_some_and(|grant| {
                        grant.address == device && grant.expires_at > Instant::now()
                    });
                    if grant.is_some_and(|grant| grant.expires_at <= Instant::now()) {
                        *grant = None;
                    }
                    granted
                };
                if !paired && !wake_granted {
                    info!(
                        "Rejecting SPP connection from {} because it is not paired and Android wake is not armed",
                        device
                    );
                    req.reject(ReqError::Rejected);
                    continue;
                }

                if paired {
                    info!("Accepting SPP connection from paired device {}", device);
                } else {
                    info!(
                        "Accepting SPP connection from {} (explicit wake grant)",
                        device
                    );
                }

                match req.accept() {
                    Ok(stream) => {
                        info!("New SPP connection from generic device: {}", device);

                        if wake_granted {
                            let mut grant = android_wake_grant.lock().await;
                            if grant.is_some_and(|grant| grant.address == device) {
                                *grant = None;
                            }
                        }

                        let ws_server = websocket_server.clone();
                        if let Some(ws) = &ws_server {
                            ws.broadcast_event(
                                "bluetooth.connection".to_string(),
                                typed_json(BluetoothConnectionEvent {
                                    event: "connection_established".to_string(),
                                    device: device.to_string(),
                                    connection_type: Some("generic".to_string()),
                                    device_type: None,
                                    channel: None,
                                    initiated_by: None,
                                }),
                            )
                            .await;
                        }

                        let (app_tx, app_rx) = mpsc::unbounded_channel::<AppMessage>();
                        let connection_id = uuid::Uuid::new_v4().to_string();

                        {
                            let mut conns = generic_connections.lock().await;
                            conns.push(GenericConnection {
                                connection_id: connection_id.clone(),
                                device_address: device,
                                tx: app_tx,
                            });
                        }

                        let generic_conns = generic_connections.clone();
                        let ws_clone = ws_server.clone();
                        let audio_rx = audio_event_rx.resubscribe();
                        let ota_cmd = ota_cmd_tx.clone();
                        tokio::spawn(async move {
                            Self::run_spp_msgpack_handler(
                                GenericConnectionIdentity {
                                    connection_id,
                                    device,
                                },
                                stream,
                                generic_conns,
                                ws_clone,
                                app_rx,
                                audio_rx,
                                ota_cmd,
                            )
                            .await;
                        });
                    }
                    Err(e) => {
                        error!("Failed to accept SPP connection: {}", e);
                    }
                }
            }
        });

        Ok(())
    }

    async fn run_spp_msgpack_handler(
        connection: GenericConnectionIdentity,
        mut stream: Stream,
        generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        mut app_rx: mpsc::UnboundedReceiver<AppMessage>,
        mut audio_event_rx: broadcast::Receiver<AudioEvent>,
        ota_cmd_tx: Option<mpsc::Sender<crate::ota::Command>>,
    ) {
        let GenericConnectionIdentity {
            connection_id,
            device,
        } = connection;
        info!(
            "Starting MsgPack protocol handler for SPP device: {}",
            device
        );

        let image_cache = match ImageCache::new().await {
            Ok(cache) => Arc::new(Mutex::new(cache)),
            Err(e) => {
                error!("Failed to create image cache for SPP handler: {}", e);
                return;
            }
        };
        let mut handler = if let Some(ref ws) = websocket_server {
            MsgPackProtocolHandler::with_image_cache(Some(Arc::clone(ws)), Arc::clone(&image_cache))
        } else {
            MsgPackProtocolHandler::new(None)
        };
        if let Some(ota_cmd_tx) = ota_cmd_tx {
            handler.set_ota_cmd_tx(ota_cmd_tx);
        }
        handler.set_connection_peer(device);
        let connection_route = spp_connection_route(&connection_id);
        handler.set_connection_route(connection_route.clone());

        let (session_tx, mut session_rx) = mpsc::unbounded_channel::<AppMessage>();
        handler.set_session_info(session_tx, 0).await;

        let app_ready_received = handler.app_ready_flag();
        let daemon_ready_interval = Duration::from_secs(3);
        let mut last_daemon_ready = std::time::Instant::now();

        Self::send_spp_daemon_ready(&mut stream).await;

        let mut audio_events_closed = false;

        let mut read_buf = [0u8; 4096];
        let mut input_buffer = BytesMut::new();

        loop {
            tokio::select! {
                result = stream.read(&mut read_buf) => {
                    match result {
                        Ok(0) => {
                            info!("SPP connection closed by {}", device);
                            break;
                        }
                        Ok(n) => {
                            debug!("Received {} bytes from SPP device {}", n, device);
                            input_buffer.extend_from_slice(&read_buf[..n]);

                            let mut write_error = false;
                            while let Some(newline_pos) = input_buffer.iter().position(|&b| b == b'\n') {
                                let b64_data = input_buffer[..newline_pos].to_vec();

                                let remaining = input_buffer.split_off(newline_pos + 1);
                                input_buffer.clear();
                                input_buffer = remaining;

                                let decoded = match base64::engine::general_purpose::STANDARD.decode(&b64_data) {
                                    Ok(d) => d,
                                    Err(e) => {
                                        error!("Failed to decode base64 from SPP: {}", e);
                                        continue;
                                    }
                                };

                                debug!("Decoded {} base64 bytes to {} raw bytes", b64_data.len(), decoded.len());

                                let msg = AppMessage {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    protocol: "com.usenocturne.daemon".to_string(),
                                    session_id: 0,
                                    priority: AppMessagePriority::Normal,
                                    data: bytes::Bytes::from(decoded),
                                };

                                debug!("Calling handle_message for msg_id={}", msg.id);
                                let result = handler.handle_message(msg).await;
                                debug!("handle_message returned: is_ok={}, has_some={}",
                                    result.is_ok(),
                                    result.as_ref().map(|r| r.is_some()).unwrap_or(false));

                                match result {
                                    Ok(Some(response)) => {
                                        let b64_response = base64::engine::general_purpose::STANDARD.encode(&response.data);
                                        let b64_with_newline = format!("{}\n", b64_response);
                                        debug!("Sending {} bytes response as {} base64 chars", response.data.len(), b64_response.len());
                                        if let Err(e) = stream.write_all(b64_with_newline.as_bytes()).await {
                                            error!("Failed to write response to SPP stream: {}", e);
                                            write_error = true;
                                            break;
                                        }
                                        if let Err(e) = stream.flush().await {
                                            error!("Failed to flush SPP stream: {}", e);
                                        }
                                        debug!("Response sent and flushed to SPP");
                                    }
                                    Ok(None) => {
                                        debug!("handle_message returned Ok(None) - no response needed");
                                    }
                                    Err(e) => {
                                        error!("Error handling SPP message: {}", e);
                                    }
                                }
                            }
                            if write_error {
                                break;
                            }
                        }
                        Err(e) => {
                            info!("SPP connection error for {}: {}", device, e);
                            break;
                        }
                    }
                }

                Some(msg) = session_rx.recv() => {
                    debug!("Sending {} bytes to SPP device {}", msg.data.len(), device);
                    let b64_data = base64::engine::general_purpose::STANDARD.encode(&msg.data);
                    let b64_with_newline = format!("{}\n", b64_data);
                    if let Err(e) = stream.write_all(b64_with_newline.as_bytes()).await {
                        error!("Failed to write to SPP stream: {}", e);
                        break;
                    }
                    if let Err(e) = stream.flush().await {
                        error!("Failed to flush SPP stream: {}", e);
                    }
                }

                Some(msg) = app_rx.recv() => {
                    debug!("Forwarding app message to SPP device {}: {} bytes", device, msg.data.len());

                    let msgpack_message = match MsgPackProtocolHandler::outbound_app_message(msg.id.clone(), &msg.data) {
                        Ok(message) => message,
                        Err(err) => {
                            error!(%err, "Failed to encode app message for SPP");
                            continue;
                        }
                    };
                    if let MsgPackMessage::Call { method, .. } = &msgpack_message {
                            handler.mark_as_websocket_message(msg.id.clone());
                            handler.mark_method_for_message(msg.id.clone(), method.to_string());

                            if method == "spotify.image.fetch" {
                                if let Ok(parsed) = serde_json::from_slice::<json::Value>(&msg.data) {
                                    if let Some(url) = parsed.get("params")
                                    .and_then(|p| p.get("url"))
                                    .and_then(|u| u.as_str())
                                {
                                    handler.mark_as_image_request(msg.id.clone(), url.to_string());
                                    }
                                }
                            }
                    }

                    if let Ok(msgpack_data) = rmp_serde::to_vec_named(&msgpack_message) {
                        if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&msgpack_data) {
                            for chunk in chunks {
                                let b64_chunk = base64::engine::general_purpose::STANDARD.encode(&chunk);
                                let b64_with_newline = format!("{}\n", b64_chunk);
                                if let Err(e) = stream.write_all(b64_with_newline.as_bytes()).await {
                                    error!("Failed to write chunk to SPP stream: {}", e);
                                    break;
                                }
                            }
                            if let Err(e) = stream.flush().await {
                                error!("Failed to flush SPP stream: {}", e);
                            }
                        }
                    }
                }

                audio_event = audio_event_rx.recv(), if !audio_events_closed => {
                    match audio_event {
                        Ok(event) => {
                            let msg = match &event {
                                AudioEvent::Data { seq, opus_data, timestamp_ms } => {
                                    create_audio_data_event(*seq, opus_data, *timestamp_ms)
                                }
                                AudioEvent::Started { sample_rate, channels, frame_ms } => {
                                    create_audio_recording_started_event(AudioRecordingStartedEvent {
                                        sample_rate: *sample_rate,
                                        channels: *channels,
                                        frame_ms: *frame_ms,
                                    })
                                }
                                AudioEvent::Stopped { reason, total_frames } => {
                                    create_audio_recording_stopped_event(AudioRecordingStoppedEvent {
                                        reason: reason.clone(),
                                        total_frames: *total_frames,
                                    })
                                }
                                AudioEvent::MicLevel { .. } => continue,
                            };
                            if let Ok(serialized) = rmp_serde::to_vec_named(&msg) {
                                if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) {
                                    for chunk in chunks {
                                        let b64_chunk = base64::engine::general_purpose::STANDARD.encode(&chunk);
                                        let b64_with_newline = format!("{}\n", b64_chunk);
                                        if let Err(e) = stream.write_all(b64_with_newline.as_bytes()).await {
                                            error!("Failed to write audio data to SPP stream: {}", e);
                                            break;
                                        }
                                    }
                                    let _ = stream.flush().await;
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!("SPP audio event receiver lagged by {} messages", n);
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            debug!("Audio event channel closed for SPP handler");
                            audio_events_closed = true;
                        }
                    }
                }

                _ = tokio::time::sleep(Duration::from_millis(500)) => {
                    if !app_ready_received.load(std::sync::atomic::Ordering::Relaxed)
                        && last_daemon_ready.elapsed() >= daemon_ready_interval
                    {
                        Self::send_spp_daemon_ready(&mut stream).await;
                        last_daemon_ready = std::time::Instant::now();
                    }
                }
            }
        }

        let has_remaining_connection = {
            let mut conns = generic_connections.lock().await;
            remove_generic_connection(&mut conns, &connection_id, device)
        };

        if let Some(ws_server) = &websocket_server {
            ws_server.clear_app_ready_for_route(&connection_route).await;
        }

        if has_remaining_connection {
            info!(
                "SPP connection {} for {} closed while another connection remains active",
                connection_id, device
            );
        } else if let Some(ws_server) = &websocket_server {
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    typed_json(BluetoothConnectionEvent {
                        event: "connection_closed".to_string(),
                        device: device.to_string(),
                        connection_type: Some("android".to_string()),
                        device_type: None,
                        channel: None,
                        initiated_by: None,
                    }),
                )
                .await;
        }

        info!(
            "MsgPack protocol handler stopped for SPP device: {}",
            device
        );
    }

    async fn send_spp_daemon_ready(stream: &mut Stream) {
        let event = create_daemon_ready_event();

        if let Ok(serialized) = rmp_serde::to_vec_named(&event) {
            if let Ok(chunks) = MsgPackProtocolHandler::create_chunks(&serialized) {
                for chunk in chunks {
                    let b64_chunk = base64::engine::general_purpose::STANDARD.encode(&chunk);
                    let b64_with_newline = format!("{}\n", b64_chunk);
                    if let Err(e) = stream.write_all(b64_with_newline.as_bytes()).await {
                        error!("Failed to send daemon.ready over SPP: {}", e);
                        return;
                    }
                }
                if let Err(e) = stream.flush().await {
                    error!("Failed to flush SPP stream after daemon.ready: {}", e);
                }
                info!("Sent daemon.ready to Android over SPP");
            }
        }
    }

    fn create_sdp_record_xml(uuid: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<record>
    <attribute id="0x0001"><sequence><uuid value="{uuid}" /></sequence></attribute>
    <attribute id="0x0004"><sequence>
        <sequence><uuid value="0x0100" /></sequence>
        <sequence><uuid value="0x0003" /><uint8 value="0x{channel:02x}" /></sequence>
    </sequence></attribute>
    <attribute id="0x0005"><sequence><uuid value="0x1002" /></sequence></attribute>
    <attribute id="0x0006"><sequence>
        <uint16 value="0x656e" />
        <uint16 value="0x006a" />
        <uint16 value="0x0100" />
    </sequence></attribute>
    <attribute id="0x0008"><uint8 value="0xff" /></attribute>
    <attribute id="0x0009"><sequence>
        <sequence><uuid value="0x1101" /><uint16 value="0x0100" /></sequence>
    </sequence></attribute>
    <attribute id="0x0100"><text value="Wireless iAP" /></attribute>
</record>
"#,
            uuid = uuid,
            channel = IAP2_RFCOMM_CHANNEL,
        )
    }

    fn create_spp_record_xml(&self) -> String {
        let device_name = crate::system::config::get_bluetooth_device_name().unwrap_or_else(|e| {
            warn!(
                "Failed to get dynamic device name, falling back to 'Nocturne': {}",
                e
            );
            "Nocturne".to_string()
        });

        format!(
            r#"<?xml version="1.0" encoding="UTF-8" ?>
<record>
    <attribute id="0x0001">
        <sequence>
            <uuid value="0x1101" />
        </sequence>
    </attribute>
    <attribute id="0x0004">
        <sequence>
            <sequence>
                <uuid value="0x0100" />
            </sequence>
            <sequence>
                <uuid value="0x0003" />
                <uint8 value="0x02" />
            </sequence>
        </sequence>
    </attribute>
    <attribute id="0x0009">
        <sequence>
            <sequence>
                <uuid value="0x1101" />
                <uint16 value="0x0102" />
            </sequence>
        </sequence>
    </attribute>
    <attribute id="0x0100">
        <text value="{}" />
    </attribute>
    <attribute id="0x0101">
        <text value="Serial Port" />
    </attribute>
</record>"#,
            device_name
        )
    }

    async fn register_bluetooth_agent(&self) -> Result<()> {
        let result = tokio::task::spawn_blocking(|| -> Result<()> {
            let conn = Connection::new_system().map_err(|e| {
                crate::error::NocturnedError::Config(format!(
                    "Failed to connect to D-Bus for agent: {}",
                    e
                ))
            })?;

            let agent_path = Path::new("/org/nocturned/agent").unwrap();

            let proxy = conn.with_proxy(
                "org.bluez",
                "/org/bluez",
                std::time::Duration::from_secs(10),
            );

            let result: std::result::Result<(), dbus::Error> = proxy.method_call(
                "org.bluez.AgentManager1",
                "RegisterAgent",
                (agent_path.clone(), "DisplayYesNo"),
            );

            match result {
                Ok(()) => {
                    let default_result: std::result::Result<(), dbus::Error> = proxy.method_call(
                        "org.bluez.AgentManager1",
                        "RequestDefaultAgent",
                        (agent_path,),
                    );

                    match default_result {
                        Ok(()) => {
                            info!("Successfully set as default Bluetooth agent");
                        }
                        Err(e) => {
                            warn!("Failed to set as default agent: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to register Bluetooth agent: {}", e);
                }
            }

            Ok(())
        })
        .await;

        match result {
            Ok(inner_result) => inner_result,
            Err(e) => {
                warn!(
                    "Failed to spawn blocking task for agent registration: {}",
                    e
                );
                Ok(())
            }
        }
    }

    async fn establish_iap2_stream(
        transport_device: Address,
        stream: Stream,
        inputs: Iap2ConnectionInputs,
        cancel_reconnect: bool,
    ) -> Result<()> {
        let device = Self::resolve_bluez_device(&inputs.adapter, transport_device)
            .await
            .map(|resolved| resolved.canonical_address)
            .unwrap_or(transport_device);

        if device != transport_device {
            info!(
                %transport_device,
                canonical_device = %device,
                "Resolved iAP2 transport address to the paired device identity"
            );
            let mut recent_pairings = inputs.recent_pairings.lock().await;
            promote_recent_pairing(&mut recent_pairings, transport_device, device);
        }

        if let Some(ws_server) = &inputs.websocket_server {
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    typed_json(BluetoothConnectionEvent {
                        event: "connection_established".to_string(),
                        device: device.to_string(),
                        connection_type: Some("iap2".to_string()),
                        device_type: Some("iphone".to_string()),
                        channel: Some(IAP2_RFCOMM_CHANNEL),
                        initiated_by: None,
                    }),
                )
                .await;
        }

        Self::handle_new_connection(device, stream, inputs, cancel_reconnect).await
    }

    fn handle_new_connection(
        device: Address,
        stream: Stream,
        inputs: Iap2ConnectionInputs,
        cancel_reconnect: bool,
    ) -> Pin<Box<dyn Future<Output = Result<()>> + Send>> {
        Box::pin(async move {
            info!("Establishing iAP2 connection with {}", device);

            if cancel_reconnect {
                Self::cancel_iap2_reconnect(&inputs.reconnects, device).await;
            }

            // A connection right after a pairing is the setup flow: the user just
            // paired in Settings and expects the app to open, so RequestAppLaunch
            // must beat iOS's own background launch of the app.
            let fast_app_launch = inputs
                .recent_pairings
                .lock()
                .await
                .get(&device)
                .is_some_and(|paired_at| paired_at.elapsed() < FRESH_PAIR_WINDOW);
            if fast_app_launch {
                info!(
                    "Device {} paired recently; requesting immediate app launch",
                    device
                );
            }

            let websocket_server_clone = inputs.websocket_server.clone();
            let ancs_manager = inputs.ancs_manager.clone();
            let ancs_connection_id = uuid::Uuid::new_v4().to_string();
            let connections_for_task = inputs.connections.clone();
            let reconnect_inputs = inputs.fork();
            let connection = Iap2Connection::new(
                device,
                stream,
                Iap2ConnectionOptions {
                    websocket_server: inputs.websocket_server,
                    audio_event_rx: inputs.audio_event_rx,
                    audio_cmd_tx: inputs.audio_cmd_tx,
                    wakeword_pause_tx: inputs.wakeword_pause_tx,
                    ota_cmd_tx: inputs.ota_cmd_tx,
                    fast_app_launch,
                },
            )
            .await?;

            let conn_clone = connection.clone();
            let user_flag = conn_clone.user_disconnect_flag();
            if let Some(manager) = &ancs_manager {
                manager.attach(device, ancs_connection_id.clone()).await;
            }
            tokio::spawn(async move {
                if let Err(e) = conn_clone.run().await {
                    error!("iAP2 connection error: {}", e);
                }
                info!("iAP2 connection closed for {}", device);
                if let Some(manager) = &ancs_manager {
                    manager.detach(ancs_connection_id).await;
                }

                let user = *user_flag.lock().await;
                if let Some(ws_server) = &websocket_server_clone {
                    ws_server
                        .clear_app_ready_for_route(&format!("iap2:{device}"))
                        .await;
                    let payload = BluetoothConnectionEvent {
                        event: "connection_closed".to_string(),
                        device: device.to_string(),
                        connection_type: Some("rfcomm".to_string()),
                        device_type: None,
                        channel: None,
                        initiated_by: user.then(|| "user".to_string()),
                    };
                    ws_server
                        .broadcast_event("bluetooth.connection".to_string(), typed_json(payload))
                        .await;
                }

                // Drop this now-dead handle. Unless the user asked to disconnect,
                // recover the half-open state (iAP2 down while the ACL stays up) by
                // re-dialing the iPhone instead of waiting for a manual reconnect.
                Self::prune_dead_iap2_connections(&connections_for_task).await;
                if !user {
                    Self::arm_iap2_reconnect(reconnect_inputs, device, true).await;
                }
            });

            let mut conns = inputs.connections.lock().await;
            conns.push(connection);

            Ok(())
        })
    }

    async fn cancel_iap2_reconnect(
        reconnects: &Arc<Mutex<HashMap<Address, JoinHandle<()>>>>,
        address: Address,
    ) {
        if let Some(handle) = reconnects.lock().await.remove(&address) {
            handle.abort();
        }
    }

    async fn has_live_iap2_connection(
        connections: &Arc<Mutex<Vec<Iap2Connection>>>,
        address: Address,
    ) -> bool {
        let conns = connections.lock().await;
        for conn in conns.iter() {
            if conn.address() == address && conn.is_running().await {
                return true;
            }
        }
        false
    }

    async fn prune_dead_iap2_connections(connections: &Arc<Mutex<Vec<Iap2Connection>>>) {
        let mut conns = connections.lock().await;
        let mut live = Vec::with_capacity(conns.len());
        for conn in conns.drain(..) {
            if conn.is_running().await {
                live.push(conn);
            }
        }
        *conns = live;
    }

    async fn arm_fresh_pair_transport(inputs: Iap2ConnectionInputs, address: Address) {
        let mut delay = IAP2_RECONNECT_INITIAL_DELAY;
        for attempt in 0..=IAP2_CLASSIFICATION_RETRY_ATTEMPTS {
            if inputs.known_macos_connectors.contains(address).await
                || Self::looks_like_computer(&inputs.adapter, address).await
            {
                match tokio::time::timeout(
                    Self::MACOS_CONNECTOR_PROBE_TIMEOUT,
                    Self::probe_macos_connector(address, inputs.websocket_server.clone()),
                )
                .await
                {
                    Ok(Ok(())) => {
                        inputs.known_macos_connectors.remember(address).await;
                        info!(%address, "Freshly paired macOS connector probed; waiting for channel 2 callback");
                        return;
                    }
                    Ok(Err(error)) => {
                        warn!(%address, %error, "Fresh-pair macOS connector probe failed");
                    }
                    Err(_) => {
                        warn!(%address, "Fresh-pair macOS connector probe timed out");
                    }
                }
            } else {
                match Self::arm_iap2_reconnect(inputs.fork(), address, false).await {
                    ArmIap2ReconnectOutcome::Armed
                    | ArmIap2ReconnectOutcome::AlreadyActive
                    | ArmIap2ReconnectOutcome::NotPaired
                    | ArmIap2ReconnectOutcome::Blocked
                    | ArmIap2ReconnectOutcome::NotCandidate => return,
                    ArmIap2ReconnectOutcome::IncompleteMetadata
                    | ArmIap2ReconnectOutcome::Unavailable => {}
                }
            }

            if attempt == IAP2_CLASSIFICATION_RETRY_ATTEMPTS {
                debug!(%address, "Fresh-pair transport recovery exhausted its retries");
                return;
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(IAP2_RECONNECT_MAX_DELAY);
        }
    }

    async fn arm_iap2_reconnect(
        inputs: Iap2ConnectionInputs,
        requested_address: Address,
        known_iap2_peer: bool,
    ) -> ArmIap2ReconnectOutcome {
        let resolved = Self::resolve_bluez_device(&inputs.adapter, requested_address).await;
        let address = resolved
            .as_ref()
            .map(|device| device.canonical_address)
            .unwrap_or(requested_address);
        let object_address = resolved
            .as_ref()
            .map(|device| device.object_address)
            .unwrap_or(requested_address);

        {
            let mut recent_pairings = inputs.recent_pairings.lock().await;
            promote_recent_pairing(&mut recent_pairings, requested_address, address);
            promote_recent_pairing(&mut recent_pairings, object_address, address);
        }

        if !known_iap2_peer {
            let Some(resolved) = resolved.as_ref() else {
                return ArmIap2ReconnectOutcome::Unavailable;
            };
            let paired = match resolved.device.is_paired().await {
                Ok(paired) => paired,
                Err(_) => return ArmIap2ReconnectOutcome::Unavailable,
            };
            let blocked = match resolved.device.is_blocked().await {
                Ok(blocked) => blocked,
                Err(_) => return ArmIap2ReconnectOutcome::Unavailable,
            };
            if !iap2_reconnect_allowed(paired, blocked) {
                return if blocked {
                    ArmIap2ReconnectOutcome::Blocked
                } else {
                    ArmIap2ReconnectOutcome::NotPaired
                };
            }
            match Self::classify_iap2_candidate(&resolved.device).await {
                Iap2CandidateClassification::Candidate => {}
                Iap2CandidateClassification::Other => {
                    return ArmIap2ReconnectOutcome::NotCandidate;
                }
                Iap2CandidateClassification::Incomplete => {
                    return ArmIap2ReconnectOutcome::IncompleteMetadata;
                }
            }
        } else if let Some(resolved) = resolved.as_ref() {
            if matches!(resolved.device.is_blocked().await, Ok(true)) {
                info!(%address, "Not arming iAP2 recovery for a blocked device");
                return ArmIap2ReconnectOutcome::Blocked;
            }
        }

        for candidate_address in [address, requested_address, object_address] {
            if Self::has_live_iap2_connection(&inputs.connections, candidate_address).await {
                return ArmIap2ReconnectOutcome::AlreadyActive;
            }
        }

        let task_inputs = inputs.fork();
        let mut guard = inputs.reconnects.lock().await;
        if [address, requested_address, object_address]
            .into_iter()
            .any(|candidate_address| {
                guard
                    .get(&candidate_address)
                    .is_some_and(|handle| !handle.is_finished())
            })
        {
            return ArmIap2ReconnectOutcome::AlreadyActive;
        }
        info!(%address, "Arming iAP2 reconnect (session down, recovering)");
        let task = tokio::spawn(Self::iap2_reconnect_loop(task_inputs, address));
        guard.insert(address, task);
        ArmIap2ReconnectOutcome::Armed
    }

    async fn iap2_reconnect_loop(inputs: Iap2ConnectionInputs, mut address: Address) {
        let mut delay = IAP2_RECONNECT_INITIAL_DELAY;
        loop {
            tokio::time::sleep(delay).await;

            if Self::has_live_iap2_connection(&inputs.connections, address).await {
                return;
            }

            let Some(resolved) = Self::resolve_bluez_device(&inputs.adapter, address).await else {
                debug!(%address, "iAP2 peer is temporarily absent from BlueZ; backing off");
                delay = (delay * 2).min(IAP2_RECONNECT_MAX_DELAY);
                continue;
            };
            let canonical_address = resolved.canonical_address;
            if canonical_address != address {
                {
                    let mut recent_pairings = inputs.recent_pairings.lock().await;
                    promote_recent_pairing(&mut recent_pairings, address, canonical_address);
                    promote_recent_pairing(
                        &mut recent_pairings,
                        resolved.object_address,
                        canonical_address,
                    );
                }
                let owns_reconnect = {
                    let mut reconnects = inputs.reconnects.lock().await;
                    if reconnects
                        .get(&canonical_address)
                        .is_some_and(JoinHandle::is_finished)
                    {
                        reconnects.remove(&canonical_address);
                    }
                    promote_map_key(&mut reconnects, address, canonical_address)
                };
                if !owns_reconnect {
                    debug!(
                        old_address = %address,
                        device = %canonical_address,
                        "Canonical iAP2 reconnect is already active; stopping duplicate task"
                    );
                    return;
                }
                info!(
                    old_address = %address,
                    device = %canonical_address,
                    "Promoted iAP2 reconnect to the stable device identity"
                );
                address = canonical_address;
                if Self::has_live_iap2_connection(&inputs.connections, address).await {
                    return;
                }
            }
            let paired = match resolved.device.is_paired().await {
                Ok(paired) => paired,
                Err(error) => {
                    debug!(%address, %error, "Failed to read iAP2 peer pairing state; backing off");
                    delay = (delay * 2).min(IAP2_RECONNECT_MAX_DELAY);
                    continue;
                }
            };
            let blocked = match resolved.device.is_blocked().await {
                Ok(blocked) => blocked,
                Err(error) => {
                    debug!(%address, %error, "Failed to read iAP2 peer blocked state; backing off");
                    delay = (delay * 2).min(IAP2_RECONNECT_MAX_DELAY);
                    continue;
                }
            };
            if !iap2_reconnect_allowed(paired, blocked) {
                if blocked {
                    info!(%address, "Stopping iAP2 recovery for a blocked device");
                }
                return;
            }

            info!(%address, ?delay, "Re-dialing iAP2 RFCOMM channel directly");
            match tokio::time::timeout(
                Self::IAP2_LINK_TIMEOUT,
                Stream::connect(SocketAddr::new(address, IAP2_RFCOMM_CHANNEL)),
            )
            .await
            {
                Ok(Ok(stream)) => {
                    info!(%address, "Direct iAP2 RFCOMM re-dial connected");
                    match Box::pin(Self::establish_iap2_stream(
                        address,
                        stream,
                        inputs.fork(),
                        false,
                    ))
                    .await
                    {
                        Ok(()) => return,
                        Err(error) => {
                            warn!(%address, %error, "Direct iAP2 stream setup failed; retrying")
                        }
                    }
                }
                Ok(Err(error)) => {
                    debug!(%address, %error, "Direct iAP2 RFCOMM re-dial failed")
                }
                Err(_) => debug!(%address, "Direct iAP2 RFCOMM re-dial timed out"),
            }

            match tokio::time::timeout(
                Self::IAP2_LINK_TIMEOUT,
                resolved.device.connect_profile(&iap2_rs::IAP2_DEVICE_UUID),
            )
            .await
            {
                Ok(Ok(())) => info!(
                    %address,
                    object_address = %resolved.object_address,
                    "BlueZ iAP2 profile re-dial requested; awaiting NewConnection"
                ),
                Ok(Err(error)) => {
                    debug!(%address, %error, "BlueZ iAP2 profile re-dial failed; backing off")
                }
                Err(_) => debug!(%address, "BlueZ iAP2 profile re-dial timed out; backing off"),
            }
            delay = (delay * 2).min(IAP2_RECONNECT_MAX_DELAY);
        }
    }

    const IAP2_LINK_TIMEOUT: Duration = Duration::from_secs(5);
    pub const MACOS_CONNECTOR_PROBE_CHANNEL: u8 = 3;
    const MACOS_CONNECTOR_PROBE_TIMEOUT: Duration = Duration::from_secs(4);
    const MACOS_CONNECTOR_PROBE_HOLD: Duration = Duration::from_millis(750);

    async fn connect_to_device(
        requested_address: Address,
        channel: u8,
        device_type: &str,
        inputs: Iap2ConnectionInputs,
        generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
        android_wake_grant: Arc<Mutex<Option<AndroidWakeGrant>>>,
    ) -> Result<ConnectionOutcome> {
        info!(
            "Connecting to device {} (auto-detecting protocol, requested_channel={}, device_type={:?})",
            requested_address, channel, device_type
        );

        let resolved = Self::resolve_bluez_device(&inputs.adapter, requested_address).await;
        let address = resolved
            .as_ref()
            .map(|device| device.canonical_address)
            .unwrap_or(requested_address);
        if let Some(resolved) = resolved.as_ref() {
            if resolved.object_address != address {
                debug!(
                    requested_address = %requested_address,
                    object_address = %resolved.object_address,
                    canonical_address = %address,
                    "Resolved Bluetooth identity to its live BlueZ object"
                );
            }
        }

        if inputs.connections.lock().await.iter().any(|connection| {
            connection.address() == address || connection.address() == requested_address
        }) {
            info!("Device {} already has an active iAP2 session", address);
            return Ok(ConnectionOutcome::Connected);
        }
        if generic_connections.lock().await.iter().any(|connection| {
            connection.device_address == address || connection.device_address == requested_address
        }) {
            info!("Device {} already has an active SPP session", address);
            return Ok(ConnectionOutcome::Connected);
        }

        if inputs
            .reconnects
            .lock()
            .await
            .get(&address)
            .is_some_and(|handle| !handle.is_finished())
        {
            info!(%address, "iAP2 recovery dial is already in progress");
            return Ok(ConnectionOutcome::WaitingForIos);
        }

        if let Some(ws_server) = &inputs.websocket_server {
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    typed_json(BluetoothConnectionEvent {
                        event: "connecting".to_string(),
                        device: address.to_string(),
                        connection_type: Some("auto".to_string()),
                        device_type: None,
                        channel: None,
                        initiated_by: None,
                    }),
                )
                .await;
        }

        let explicit_macos_connector = Self::is_macos_connector_hint(channel, device_type);
        if explicit_macos_connector
            || inputs.known_macos_connectors.contains(address).await
            || Self::looks_like_computer(&inputs.adapter, address).await
        {
            info!(
                "Attempting macOS connector probe on channel {} for {}",
                Self::MACOS_CONNECTOR_PROBE_CHANNEL,
                address
            );
            match tokio::time::timeout(
                Self::MACOS_CONNECTOR_PROBE_TIMEOUT,
                Self::probe_macos_connector(address, inputs.websocket_server.clone()),
            )
            .await
            {
                Ok(Ok(())) => {
                    inputs.known_macos_connectors.remember(address).await;
                    info!(
                        "macOS connector probe sent to {}; waiting for channel 2 callback",
                        address
                    );
                    return Ok(ConnectionOutcome::WaitingForMacConnector);
                }
                Ok(Err(e)) => {
                    warn!("macOS connector probe failed for {}: {}", address, e);
                    return Err(e);
                }
                Err(_) => {
                    warn!("macOS connector probe timed out for {}", address);
                    return Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                        "macOS connector probe timed out"
                    )));
                }
            }
        }

        let iap2_candidate = if device_type_identifies_ios(device_type) {
            true
        } else if let Some(resolved) = resolved.as_ref() {
            Self::device_is_iap2_candidate(&resolved.device).await
        } else {
            false
        };

        if iap2_candidate {
            info!(%address, "Opening iOS iAP2 RFCOMM channel directly");
            match tokio::time::timeout(
                Self::IAP2_LINK_TIMEOUT,
                Stream::connect(SocketAddr::new(address, IAP2_RFCOMM_CHANNEL)),
            )
            .await
            {
                Ok(Ok(stream)) => {
                    info!(%address, "Direct iAP2 RFCOMM connection established");
                    Self::establish_iap2_stream(address, stream, inputs.fork(), true).await?;
                    return Ok(ConnectionOutcome::Connected);
                }
                Ok(Err(error)) => {
                    info!(%address, %error, "Direct iAP2 RFCOMM connection failed; trying BlueZ profile")
                }
                Err(_) => {
                    info!(%address, "Direct iAP2 RFCOMM connection timed out; trying BlueZ profile")
                }
            }
        }

        if let Some(resolved) = resolved.as_ref() {
            info!(
                %address,
                object_address = %resolved.object_address,
                "Requesting iOS iAP2 profile connection via BlueZ ConnectProfile"
            );
            match tokio::time::timeout(
                Self::IAP2_LINK_TIMEOUT,
                resolved.device.connect_profile(&iap2_rs::IAP2_DEVICE_UUID),
            )
            .await
            {
                Ok(Ok(())) => {
                    info!(
                        %address,
                        "iAP2 ConnectProfile requested; waiting for BlueZ NewConnection"
                    );
                    return Ok(ConnectionOutcome::WaitingForIos);
                }
                Ok(Err(error)) => {
                    info!(%address, %error, "iAP2 ConnectProfile failed; falling back to Android SPP wake")
                }
                Err(_) => {
                    info!(%address, "iAP2 ConnectProfile timed out; falling back to Android SPP wake")
                }
            }
        } else {
            info!(
                %address,
                "Bluetooth device is not present in BlueZ; falling back to Android SPP wake"
            );
        }

        {
            let mut grant = android_wake_grant.lock().await;
            *grant = Some(AndroidWakeGrant {
                address,
                expires_at: Instant::now() + ANDROID_WAKE_GRANT_TTL,
            });
        }

        info!(
            "Waiting up to {} seconds for Android {} to connect back over SPP",
            ANDROID_WAKE_GRANT_TTL.as_secs(),
            address
        );
        Ok(ConnectionOutcome::WaitingForAndroid)
    }

    fn is_macos_connector_hint(channel: u8, device_type: &str) -> bool {
        if channel == Self::MACOS_CONNECTOR_PROBE_CHANNEL {
            return true;
        }

        let normalized = device_type.trim().to_ascii_lowercase();
        matches!(
            normalized.as_str(),
            "computer" | "mac" | "macos" | "macos_connector" | "macos-connector"
        )
    }

    async fn looks_like_computer(adapter: &Adapter, address: Address) -> bool {
        let Some(resolved) = Self::resolve_bluez_device(adapter, address).await else {
            info!("Bluetooth device {} classification unavailable", address);
            return false;
        };
        let device = resolved.device;

        let icon = device.icon().await.ok().flatten();
        let class = device.class().await.ok().flatten();
        let alias = device.alias().await.ok();
        let name = device.name().await.ok().flatten();

        let looks_like_computer =
            metadata_identifies_computer(icon.as_deref(), class, alias.as_deref(), name.as_deref());

        info!(
            "Bluetooth device {} classification: icon={:?}, class={:?}, alias={:?}, name={:?}, computer={}",
            address, icon, class, alias, name, looks_like_computer
        );

        looks_like_computer
    }

    async fn probe_macos_connector(
        address: Address,
        websocket_server: Option<Arc<WebSocketServer>>,
    ) -> Result<()> {
        if let Some(ws_server) = &websocket_server {
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    typed_json(BluetoothConnectionEvent {
                        event: "connector_probe".to_string(),
                        device: address.to_string(),
                        connection_type: Some("macos_connector".to_string()),
                        device_type: None,
                        channel: Some(Self::MACOS_CONNECTOR_PROBE_CHANNEL),
                        initiated_by: Some("daemon".to_string()),
                    }),
                )
                .await;
        }

        let socket_addr = SocketAddr::new(address, Self::MACOS_CONNECTOR_PROBE_CHANNEL);
        let mut stream = Stream::connect(socket_addr).await?;
        info!(
            "macOS connector probe opened for {} on channel {}",
            address,
            Self::MACOS_CONNECTOR_PROBE_CHANNEL
        );
        tokio::time::sleep(Self::MACOS_CONNECTOR_PROBE_HOLD).await;
        let _ = stream.shutdown().await;
        Ok(())
    }

    pub async fn disconnect_device(
        address: Address,
        connections: Arc<Mutex<Vec<Iap2Connection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
    ) -> Result<()> {
        info!("Disconnecting device {}", address);

        {
            let conns = connections.lock().await;
            if let Some(conn) = conns.iter().find(|c| c.address() == address) {
                conn.mark_user_initiated_disconnect().await;
            }
        }

        let addr_str = address.to_string();
        let result = tokio::task::spawn_blocking(move || -> Result<()> {
            use dbus::blocking::stdintf::org_freedesktop_dbus::ObjectManager;
            use std::time::Duration;

            let conn = Connection::new_system().map_err(|e| {
                crate::error::NocturnedError::Config(format!("Failed to connect to D-Bus: {}", e))
            })?;
            let proxy = conn.with_proxy("org.bluez", "/", Duration::from_secs(2));
            let objects = proxy
                .get_managed_objects()
                .map_err(|e| crate::error::NocturnedError::General(anyhow::anyhow!(e)))?;

            let mut device_path: Option<dbus::Path<'static>> = None;
            for (path, ifaces) in objects {
                if let Some(props) = ifaces.get("org.bluez.Device1") {
                    if let Some(addr) = props
                        .get("Address")
                        .and_then(|v| v.0.as_str())
                        .map(|s| s.to_string())
                    {
                        if addr == addr_str {
                            device_path = Some(path);
                            break;
                        }
                    }
                }
            }

            let device_path = device_path.ok_or_else(|| {
                crate::error::NocturnedError::General(anyhow::anyhow!("Device not found in BlueZ"))
            })?;

            let dev_proxy = conn.with_proxy("org.bluez", device_path, Duration::from_secs(4));
            let call_res: std::result::Result<(), dbus::Error> =
                dev_proxy.method_call("org.bluez.Device1", "Disconnect", ());
            match call_res {
                Ok(()) => Ok(()),
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("NotConnected") || msg.contains("not connected") {
                        Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                            "Device not connected"
                        )))
                    } else {
                        Err(crate::error::NocturnedError::General(anyhow::anyhow!(msg)))
                    }
                }
            }
        })
        .await;

        match result {
            Ok(inner) => {
                inner?;

                let mut conns = connections.lock().await;
                conns.retain(|c| c.address() != address);

                if let Some(ws_server) = &websocket_server {
                    ws_server
                        .clear_app_ready_for_route(&format!("iap2:{address}"))
                        .await;
                    ws_server
                        .broadcast_event(
                            "bluetooth.connection".to_string(),
                            typed_json(BluetoothConnectionEvent {
                                event: "connection_closed".to_string(),
                                device: address.to_string(),
                                connection_type: Some("rfcomm".to_string()),
                                device_type: None,
                                channel: None,
                                initiated_by: Some("user".to_string()),
                            }),
                        )
                        .await;
                }

                Ok(())
            }
            Err(e) => {
                warn!("Failed to run disconnect in blocking task: {}", e);
                Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                    e.to_string()
                )))
            }
        }
    }

    pub async fn unpair_device(
        address: Address,
        connections: Arc<Mutex<Vec<Iap2Connection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
    ) -> Result<()> {
        info!("Unpairing device {}", address);

        let _ =
            Self::disconnect_device(address, Arc::clone(&connections), websocket_server.clone())
                .await;

        let addr_str = address.to_string();
        let result = tokio::task::spawn_blocking(move || -> Result<()> {
            use dbus::blocking::stdintf::org_freedesktop_dbus::ObjectManager;
            use std::time::Duration;

            let conn = Connection::new_system().map_err(|e| {
                crate::error::NocturnedError::Config(format!("Failed to connect to D-Bus: {}", e))
            })?;
            let objmgr = conn.with_proxy("org.bluez", "/", Duration::from_secs(2));
            let objects = objmgr
                .get_managed_objects()
                .map_err(|e| crate::error::NocturnedError::General(anyhow::anyhow!(e)))?;

            let mut adapter_path: Option<dbus::Path<'static>> = None;
            let mut device_path: Option<dbus::Path<'static>> = None;

            for (path, ifaces) in &objects {
                if ifaces.contains_key("org.bluez.Adapter1") {
                    adapter_path = Some(path.clone());
                }
            }

            for (path, ifaces) in &objects {
                if let Some(props) = ifaces.get("org.bluez.Device1") {
                    if let Some(addr) = props
                        .get("Address")
                        .and_then(|v| v.0.as_str())
                        .map(|s| s.to_string())
                    {
                        if addr == addr_str {
                            device_path = Some(path.clone());
                            break;
                        }
                    }
                }
            }

            let adapter_path = adapter_path.ok_or_else(|| {
                crate::error::NocturnedError::General(anyhow::anyhow!("Adapter not found"))
            })?;
            let device_path = device_path.ok_or_else(|| {
                crate::error::NocturnedError::General(anyhow::anyhow!("Device not found in BlueZ"))
            })?;

            let adapter = conn.with_proxy("org.bluez", adapter_path, Duration::from_secs(5));
            let call_res: std::result::Result<(), dbus::Error> =
                adapter.method_call("org.bluez.Adapter1", "RemoveDevice", (device_path,));
            match call_res {
                Ok(()) => Ok(()),
                Err(e) => Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                    e.to_string()
                ))),
            }
        })
        .await;

        match result {
            Ok(inner) => {
                inner?;

                let mut conns = connections.lock().await;
                conns.retain(|c| c.address() != address);

                if let Some(ws_server) = &websocket_server {
                    ws_server
                        .broadcast_event(
                            "bluetooth.device".to_string(),
                            typed_json(BluetoothDeviceEvent {
                                event: "unpaired".to_string(),
                                device: address.to_string(),
                            }),
                        )
                        .await;
                }
                Ok(())
            }
            Err(e) => Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                e.to_string()
            ))),
        }
    }

    async fn cleanup(&mut self) -> Result<()> {
        let mut conns = self.connections.lock().await;
        for conn in conns.iter_mut() {
            conn.close().await;
        }
        conns.clear();

        self.generic_connections.lock().await.clear();

        if let Some(accessory_setup) = self.accessory_setup.take() {
            accessory_setup.shutdown().await;
        }
        if let Some(ancs_monitor) = self.ancs_monitor.take() {
            ancs_monitor.shutdown().await;
        }
        self.ancs_manager = None;

        self.adapter.set_discoverable(false).await?;
        self.adapter.set_pairable(false).await?;

        info!("Bluetooth daemon cleaned up");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn address(value: &str) -> Address {
        Address::from_str(value).expect("valid Bluetooth address")
    }

    fn generic_connection(connection_id: &str, device_address: Address) -> GenericConnection {
        let (tx, _rx) = mpsc::unbounded_channel();
        GenericConnection {
            connection_id: connection_id.to_string(),
            device_address,
            tx,
        }
    }

    fn targeted_message(route: Option<&str>, peer: Option<Address>) -> AppMessage {
        let mut payload = serde_json::json!({
            "method": "spotify.auth.get_status",
            "params": {},
        });
        if let Some(route) = route {
            payload["_targetConnection"] = serde_json::json!(route);
        }
        if let Some(peer) = peer {
            payload["_targetPeer"] = serde_json::json!(peer.to_string());
        }
        AppMessage {
            id: "request".to_string(),
            protocol: "com.usenocturne.daemon".to_string(),
            session_id: 1,
            priority: AppMessagePriority::Normal,
            data: bytes::Bytes::from(serde_json::to_vec(&payload).expect("valid payload")),
        }
    }

    #[test]
    fn removing_duplicate_generic_connection_preserves_active_peer_state() {
        let peer = Address::from_str("D8:3A:DD:31:B0:49").expect("valid peer address");
        let other = Address::from_str("30:E3:D6:00:B5:5F").expect("valid other address");
        let mut connections = vec![
            generic_connection("stale", peer),
            generic_connection("active", peer),
            generic_connection("other", other),
        ];

        assert!(remove_generic_connection(&mut connections, "stale", peer));
        assert_eq!(connections.len(), 2);
        assert!(connections
            .iter()
            .any(|connection| connection.connection_id == "active"));
        assert!(connections
            .iter()
            .any(|connection| connection.connection_id == "other"));
    }

    #[test]
    fn removing_final_generic_connection_reports_peer_disconnected() {
        let peer = Address::from_str("D8:3A:DD:31:B0:49").expect("valid peer address");
        let mut connections = vec![generic_connection("final", peer)];

        assert!(!remove_generic_connection(&mut connections, "final", peer));
        assert!(connections.is_empty());
    }

    #[test]
    fn connection_target_routes_to_exactly_one_simultaneous_spp_session() {
        let pi = Address::from_str("D8:3A:DD:31:B0:49").expect("valid Pi address");
        let mac = Address::from_str("50:F2:65:EB:36:E1").expect("valid Mac address");
        let message = targeted_message(Some("spp:pi"), None);

        let matching_routes = [("spp:pi", pi), ("spp:mac", mac)]
            .into_iter()
            .filter(|(route, peer)| should_route_message(&message, route, *peer))
            .count();

        assert_eq!(matching_routes, 1);
        assert!(should_route_message(&message, "spp:pi", pi));
        assert!(!should_route_message(&message, "spp:mac", mac));
    }

    #[test]
    fn connection_target_selects_one_overlapping_route_for_the_same_peer() {
        let peer = Address::from_str("D8:3A:DD:31:B0:49").expect("valid peer address");
        let message = targeted_message(Some("spp:current"), None);

        let matching_routes = [("spp:stale", peer), ("spp:current", peer)]
            .into_iter()
            .filter(|(route, route_peer)| should_route_message(&message, route, *route_peer))
            .count();

        assert_eq!(matching_routes, 1);
        assert!(!should_route_message(&message, "spp:stale", peer));
        assert!(should_route_message(&message, "spp:current", peer));
    }

    #[test]
    fn connection_target_takes_precedence_over_peer_target() {
        let pi = Address::from_str("D8:3A:DD:31:B0:49").expect("valid Pi address");
        let mac = Address::from_str("50:F2:65:EB:36:E1").expect("valid Mac address");
        let message = targeted_message(Some("spp:mac"), Some(pi));

        assert!(!should_route_message(&message, "spp:pi", pi));
        assert!(should_route_message(&message, "spp:mac", mac));
    }

    #[test]
    fn bluez_identity_address_resolves_to_live_private_object() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");

        assert_eq!(
            select_device_address(identity, &[(private, Some(identity))]),
            Some((private, identity))
        );
    }

    #[test]
    fn bluez_private_object_address_canonicalizes_to_identity() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");

        assert_eq!(
            select_device_address(private, &[(private, Some(identity))]),
            Some((private, identity))
        );
    }

    #[test]
    fn bluez_exact_object_address_takes_priority_over_remote_match() {
        let requested = address("61:B7:33:1C:77:95");
        let exact_identity = address("A8:AB:B5:AB:02:ED");
        let unrelated_object = address("D8:3A:DD:31:B0:49");

        assert_eq!(
            select_device_address(
                requested,
                &[
                    (unrelated_object, Some(requested)),
                    (requested, Some(exact_identity)),
                ],
            ),
            Some((requested, exact_identity))
        );
    }

    #[test]
    fn bluez_address_resolution_rejects_unrelated_device() {
        let requested = address("A8:AB:B5:AB:02:ED");
        let object = address("D8:3A:DD:31:B0:49");

        assert_eq!(select_device_address(requested, &[(object, None)]), None);
    }

    #[test]
    fn fresh_pairing_is_recorded_under_the_canonical_identity() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");
        let paired_at = Instant::now();
        let mut pairings = HashMap::from([(private, paired_at - Duration::from_secs(1))]);

        let _ = update_recent_pairing(&mut pairings, private, identity, true, paired_at);

        assert_eq!(pairings, HashMap::from([(identity, paired_at)]));
    }

    #[test]
    fn unpairing_removes_private_and_canonical_pairing_keys() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");
        let paired_at = Instant::now();
        let mut pairings = HashMap::from([(private, paired_at), (identity, paired_at)]);

        let _ = update_recent_pairing(&mut pairings, private, identity, false, paired_at);

        assert!(pairings.is_empty());
    }

    #[test]
    fn duplicate_paired_snapshots_start_one_transport_recovery() {
        let device = address("50:F2:65:EB:36:E1");
        let paired_at = Instant::now();
        let mut pairings = HashMap::new();

        assert!(update_recent_pairing(
            &mut pairings,
            device,
            device,
            true,
            paired_at
        ));
        assert!(!update_recent_pairing(
            &mut pairings,
            device,
            device,
            true,
            paired_at + Duration::from_millis(1)
        ));
    }

    #[test]
    fn address_promotion_preserves_the_newest_pairing_timestamp() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");
        let older = Instant::now() - Duration::from_secs(2);
        let newer = Instant::now();
        let mut pairings = HashMap::from([(private, newer), (identity, older)]);

        promote_recent_pairing(&mut pairings, private, identity);

        assert_eq!(pairings, HashMap::from([(identity, newer)]));
    }

    #[test]
    fn reconnect_key_promotion_yields_to_an_existing_canonical_task() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");
        let mut reconnects = HashMap::from([(private, "private"), (identity, "canonical")]);

        assert!(!promote_map_key(&mut reconnects, private, identity));
        assert_eq!(reconnects, HashMap::from([(identity, "canonical")]));
    }

    #[test]
    fn reconnect_key_follows_canonical_address_promotion() {
        let private = address("61:B7:33:1C:77:95");
        let identity = address("A8:AB:B5:AB:02:ED");
        let mut reconnects = HashMap::from([(private, "task")]);

        assert!(promote_map_key(&mut reconnects, private, identity));
        assert_eq!(reconnects, HashMap::from([(identity, "task")]));
    }

    #[test]
    fn iphone_metadata_recovers_from_stale_cached_uuids() {
        assert!(metadata_identifies_iap2_device(
            Some("Neel's iPhone"),
            Some("iPhone"),
            false
        ));
        assert!(metadata_identifies_iap2_device(None, None, true));
        assert_eq!(
            classify_iap2_metadata(None, Some("61:B7:33:1C:77:95"), false, false),
            Iap2CandidateClassification::Incomplete
        );
        assert!(!iap2_metadata_is_ready(None, None));
        assert!(!iap2_metadata_is_ready(None, Some(0)));
        assert!(iap2_metadata_is_ready(Some("Neel's iPhone"), Some(0)));
        assert!(iap2_metadata_is_ready(None, Some(1)));
    }

    #[test]
    fn android_metadata_does_not_trigger_direct_iap2_dial() {
        assert!(!metadata_identifies_iap2_device(
            Some("Pixel 10"),
            Some("Pixel 10"),
            false
        ));
        assert!(!device_type_identifies_ios("android"));
        assert!(device_type_identifies_ios("iphone"));
    }

    #[test]
    fn macos_metadata_does_not_trigger_direct_iap2_dial() {
        assert!(!metadata_identifies_iap2_device(
            Some("Neel's MacBook Pro"),
            Some("Nocturne Connector"),
            false
        ));
        assert!(!device_type_identifies_ios("macos_connector"));
    }

    #[test]
    fn macos_metadata_triggers_connector_transport_recovery() {
        assert!(metadata_identifies_computer(
            Some("computer"),
            None,
            None,
            None
        ));
        assert!(metadata_identifies_computer(None, Some(0x010c), None, None));
        assert!(metadata_identifies_computer(
            None,
            None,
            Some("Neel's MacBook Pro"),
            Some("Nocturne Connector")
        ));
        assert!(!metadata_identifies_computer(
            Some("phone"),
            Some(0x020c),
            Some("Pixel 10"),
            Some("Pixel 10")
        ));
    }

    #[test]
    fn custom_mac_name_still_uses_computer_identity() {
        assert!(metadata_identifies_computer(
            Some("computer"),
            None,
            Some("Astrid"),
            Some("Astrid")
        ));
        assert!(metadata_identifies_computer(
            None,
            Some(0x010c),
            Some("Astrid"),
            Some("Astrid")
        ));
    }

    #[tokio::test]
    async fn learned_macos_identity_survives_metadata_and_restart() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("known-macos-connectors.json");
        let astrid = address("50:F2:65:EB:36:E1");

        let registry = KnownMacOSConnectors::load(path.clone()).await;
        registry.remember(astrid).await;
        assert!(registry.contains(astrid).await);

        let reloaded = KnownMacOSConnectors::load(path).await;
        assert!(reloaded.contains(astrid).await);
        reloaded.forget(&[astrid]).await;
        assert!(!reloaded.contains(astrid).await);
    }

    #[test]
    fn iap2_recovery_requires_an_unblocked_pairing() {
        assert!(iap2_reconnect_allowed(true, false));
        assert!(!iap2_reconnect_allowed(true, true));
        assert!(!iap2_reconnect_allowed(false, false));
    }

    #[test]
    fn recognizes_transient_adapter_startup_errors() {
        let error = |kind| bluer::Error {
            kind,
            message: String::new(),
        };

        assert!(is_transient_adapter_startup_error(&error(
            ErrorKind::NotFound
        )));
        assert!(is_transient_adapter_startup_error(&error(
            ErrorKind::NotReady
        )));
        assert!(is_transient_adapter_startup_error(&error(
            ErrorKind::Internal(InternalErrorKind::DBus("org.bluez.Error.Busy".to_string()))
        )));
        assert!(is_transient_adapter_startup_error(&error(
            ErrorKind::Internal(InternalErrorKind::DBus(
                "org.freedesktop.DBus.Error.ServiceUnknown".to_string()
            ))
        )));
        assert!(is_transient_adapter_startup_error(&error(
            ErrorKind::Internal(InternalErrorKind::DBus(
                "org.freedesktop.DBus.Error.NameHasNoOwner".to_string()
            ))
        )));
        assert!(!is_transient_adapter_startup_error(&error(
            ErrorKind::Failed
        )));
    }
}
