//! Apple Notification Center Service client for the bonded iPhone LE link.

use bluer::{
    gatt::{
        remote::{Characteristic, CharacteristicWriteRequest, Service},
        WriteOp,
    },
    Adapter, AdapterEvent, Address, Uuid,
};
use futures::{Stream, StreamExt};
use libnocturne::generated::device::{NotificationRemoveEvent, NotificationShowEvent};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    pin::Pin,
    sync::Arc,
    time::Duration,
};
use tokio::{sync::mpsc, task::JoinHandle, time::Instant};
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use crate::http::WebSocketServer;

const ANCS_SERVICE: Uuid = Uuid::from_u128(0x7905F431_B5CE_4E99_A40F_4B1E122D00D0);
const NOTIFICATION_SOURCE: Uuid = Uuid::from_u128(0x9FBF120D_6301_42D9_8C58_25E699A21DBD);
const CONTROL_POINT: Uuid = Uuid::from_u128(0x69D1D8F3_45E1_49A8_9821_9BBDFDAAD9D9);
const DATA_SOURCE: Uuid = Uuid::from_u128(0x22EAC6E9_24D6_4BB5_BE44_B36ACE7C7BFB);

const COMMAND_GET_NOTIFICATION_ATTRIBUTES: u8 = 0;
const COMMAND_GET_APP_ATTRIBUTES: u8 = 1;

const ATTR_APP_IDENTIFIER: u8 = 0;
const ATTR_TITLE: u8 = 1;
const ATTR_SUBTITLE: u8 = 2;
const ATTR_MESSAGE: u8 = 3;
const ATTR_DATE: u8 = 5;
const ATTR_POSITIVE_ACTION_LABEL: u8 = 6;
const ATTR_NEGATIVE_ACTION_LABEL: u8 = 7;
const APP_ATTR_DISPLAY_NAME: u8 = 0;

const EVENT_ADDED: u8 = 0;
const EVENT_MODIFIED: u8 = 1;
const EVENT_REMOVED: u8 = 2;

const FLAG_SILENT: u8 = 1 << 0;
const FLAG_IMPORTANT: u8 = 1 << 1;
const FLAG_PRE_EXISTING: u8 = 1 << 2;

const TITLE_MAX: u16 = 256;
const SUBTITLE_MAX: u16 = 256;
const MESSAGE_MAX: u16 = 1024;
const PENDING_QUEUE_CAP: usize = 64;
const DATA_BUFFER_CAP: usize = 8192;
const FETCH_ATTEMPTS: u8 = 3;
const FETCH_TIMEOUT: Duration = Duration::from_secs(5);
const CONTROL_POINT_WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const SUBSCRIBE_TIMEOUT: Duration = Duration::from_secs(10);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);
const LE_PROBE_INTERVAL: Duration = Duration::from_secs(5);
const AUTO_DISCOVERY_INTERVAL: Duration = Duration::from_secs(5);
const MONITOR_RETRY_INITIAL: Duration = Duration::from_secs(2);
const MONITOR_RETRY_MAX: Duration = Duration::from_secs(30);
const MONITOR_COMMAND_CAP: usize = 8;
const NOTIFICATION_ID_PREFIX: &str = "ancs:";

type NotifyStream = Pin<Box<dyn Stream<Item = Vec<u8>> + Send>>;

pub struct AncsMonitor {
    shutdown: CancellationToken,
    task: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct AncsManager {
    commands: mpsc::Sender<MonitorCommand>,
}

impl AncsManager {
    pub async fn attach(&self, address: Address, connection_id: String) {
        if self
            .commands
            .send(MonitorCommand::Attach {
                address,
                connection_id,
            })
            .await
            .is_err()
        {
            debug!(%address, "ANCS monitor closed before iAP2 attach");
        }
    }

    pub async fn detach(&self, connection_id: String) {
        if self
            .commands
            .send(MonitorCommand::Detach { connection_id })
            .await
            .is_err()
        {
            debug!("ANCS monitor closed before iAP2 detach");
        }
    }
}

enum MonitorCommand {
    Attach {
        address: Address,
        connection_id: String,
    },
    Detach {
        connection_id: String,
    },
}

struct ActiveMonitorSession {
    address: Address,
    owner: SessionOwner,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

enum SessionOwner {
    Autonomous,
    Explicit(String),
}

#[derive(Clone)]
struct AttachedMonitorSession {
    address: Address,
    connection_id: String,
}

impl AncsMonitor {
    pub fn start(adapter: Adapter, websocket: Arc<WebSocketServer>) -> (AncsManager, Self) {
        let shutdown = CancellationToken::new();
        let task_shutdown = shutdown.clone();
        let (commands, command_rx) = mpsc::channel(MONITOR_COMMAND_CAP);
        let task = tokio::spawn(async move {
            run_monitor(adapter, websocket, task_shutdown, command_rx).await;
        });
        (
            AncsManager { commands },
            Self {
                shutdown,
                task: Some(task),
            },
        )
    }

    pub async fn shutdown(mut self) {
        self.shutdown.cancel();
        if let Some(task) = self.task.take() {
            if let Err(error) = task.await {
                warn!(%error, "ANCS monitor task failed during shutdown");
            }
        }
    }
}

impl Drop for AncsMonitor {
    fn drop(&mut self) {
        self.shutdown.cancel();
    }
}

async fn run_monitor(
    adapter: Adapter,
    websocket: Arc<WebSocketServer>,
    shutdown: CancellationToken,
    mut commands: mpsc::Receiver<MonitorCommand>,
) {
    let mut active: Option<ActiveMonitorSession> = None;
    let mut attached = Vec::<AttachedMonitorSession>::new();
    let mut auto_discovery = tokio::time::interval(AUTO_DISCOVERY_INTERVAL);
    auto_discovery.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let (auto_result_tx, mut auto_result_rx) = mpsc::channel(1);
    let mut auto_discovery_task: Option<JoinHandle<()>> = None;
    let mut auto_discovery_generation = 0_u64;
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            _ = auto_discovery.tick(), if attached.is_empty() && auto_discovery_task.is_none() => {
                let task_adapter = adapter.clone();
                let task_result_tx = auto_result_tx.clone();
                auto_discovery_generation = auto_discovery_generation.wrapping_add(1);
                let generation = auto_discovery_generation;
                auto_discovery_task = Some(tokio::spawn(async move {
                    let candidate = find_autonomous_ancs_address(&task_adapter).await;
                    let _ = task_result_tx.send((generation, candidate)).await;
                }));
            }
            result = auto_result_rx.recv() => {
                let Some((generation, candidate)) = result else { break };
                if !is_current_discovery_result(
                    generation,
                    auto_discovery_generation,
                    auto_discovery_task.is_some(),
                ) {
                    continue;
                }
                auto_discovery_task = None;
                if !attached.is_empty() {
                    continue;
                }
                let current = active.as_ref().map(|session| session.address);
                if candidate != current {
                    stop_monitor_session(&mut active).await;
                    if let Some(address) = candidate {
                        info!(%address, "Starting ANCS monitor for connected iPhone LE link");
                        active = Some(spawn_monitor_session(
                            &adapter,
                            &websocket,
                            address,
                            SessionOwner::Autonomous,
                        ));
                    }
                }
            }
            command = commands.recv() => match command {
                Some(MonitorCommand::Attach { address, connection_id }) => {
                    if let Some(task) = auto_discovery_task.take() {
                        task.abort();
                    }
                    auto_discovery_generation = auto_discovery_generation.wrapping_add(1);
                    attached.retain(|session| session.connection_id != connection_id);
                    attached.push(AttachedMonitorSession {
                        address,
                        connection_id: connection_id.clone(),
                    });
                    if let Some(session) = active.as_mut() {
                        if session.address == address {
                            session.owner = SessionOwner::Explicit(connection_id);
                            continue;
                        }
                    }
                    stop_monitor_session(&mut active).await;
                    active = Some(spawn_monitor_session(
                        &adapter,
                        &websocket,
                        address,
                        SessionOwner::Explicit(connection_id),
                    ));
                }
                Some(MonitorCommand::Detach { connection_id }) => {
                    attached.retain(|session| session.connection_id != connection_id);
                    let owns_active = active.as_ref().is_some_and(|session| {
                        matches!(&session.owner, SessionOwner::Explicit(id) if id == &connection_id)
                    });
                    if owns_active {
                        if let Some(fallback) = attached.last().cloned() {
                            if let Some(session) = active.as_mut() {
                                if session.address == fallback.address {
                                    session.owner = SessionOwner::Explicit(fallback.connection_id);
                                    continue;
                                }
                            }
                            stop_monitor_session(&mut active).await;
                            active = Some(spawn_monitor_session(
                                &adapter,
                                &websocket,
                                fallback.address,
                                SessionOwner::Explicit(fallback.connection_id),
                            ));
                        } else if let Some(session) = active.as_mut() {
                            session.owner = SessionOwner::Autonomous;
                            auto_discovery.reset_immediately();
                        }
                    }
                }
                None => break,
            }
        }
    }
    if let Some(task) = auto_discovery_task.take() {
        task.abort();
    }
    stop_monitor_session(&mut active).await;
}

fn spawn_monitor_session(
    adapter: &Adapter,
    websocket: &Arc<WebSocketServer>,
    address: Address,
    owner: SessionOwner,
) -> ActiveMonitorSession {
    let cancel = CancellationToken::new();
    let session_cancel = cancel.clone();
    let session_adapter = adapter.clone();
    let session_websocket = Arc::clone(websocket);
    let task = tokio::spawn(async move {
        run_for_address(session_adapter, address, session_websocket, session_cancel).await;
    });
    ActiveMonitorSession {
        address,
        owner,
        cancel,
        task,
    }
}

async fn find_autonomous_ancs_address(adapter: &Adapter) -> Option<Address> {
    let object_addresses = adapter.device_addresses().await.ok()?;
    let mut candidates = Vec::new();
    for object_address in object_addresses {
        let device = match adapter.device(object_address) {
            Ok(device) => device,
            Err(_) => continue,
        };
        if device.is_paired().await.ok() != Some(true)
            || device.is_connected().await.ok() != Some(true)
        {
            continue;
        }
        candidates.push(device.remote_address().await.ok().unwrap_or(object_address));
    }
    candidates.sort_by_key(ToString::to_string);
    candidates.dedup();
    let mut matching = Vec::new();
    for address in candidates {
        if find_ancs_service(adapter, address).await.is_some() {
            matching.push(address);
        }
    }
    match unique_autonomous_candidate(matching) {
        Ok(candidate) => candidate,
        Err(count) => {
            warn!(
                count,
                "Multiple connected iPhones expose ANCS; waiting for an explicit iAP2 session"
            );
            None
        }
    }
}

fn unique_autonomous_candidate(candidates: Vec<Address>) -> Result<Option<Address>, usize> {
    match candidates.as_slice() {
        [] => Ok(None),
        [address] => Ok(Some(*address)),
        addresses => Err(addresses.len()),
    }
}

fn is_current_discovery_result(
    result_generation: u64,
    current_generation: u64,
    discovery_in_flight: bool,
) -> bool {
    discovery_in_flight && result_generation == current_generation
}

async fn stop_monitor_session(active: &mut Option<ActiveMonitorSession>) {
    if let Some(session) = active.take() {
        session.cancel.cancel();
        let _ = session.task.await;
    }
}

async fn run_for_address(
    adapter: Adapter,
    address: Address,
    websocket: Arc<WebSocketServer>,
    cancel: CancellationToken,
) {
    let mut retry_delay = MONITOR_RETRY_INITIAL;
    loop {
        if cancel.is_cancelled() {
            return;
        }
        let started_at = Instant::now();
        let discovered = tokio::select! {
            _ = cancel.cancelled() => return,
            result = tokio::time::timeout(
                DISCOVERY_TIMEOUT,
                find_ancs_service(&adapter, address),
            ) => match result {
                Ok(service) => service,
                Err(_) => {
                    debug!(%address, "ANCS service discovery timed out");
                    None
                }
            },
        };
        match discovered {
            Some((service, le_address, object_address)) => {
                match run_session(
                    &adapter,
                    address,
                    le_address,
                    object_address,
                    &service,
                    &websocket,
                    &cancel,
                )
                .await
                {
                    Ok(()) if cancel.is_cancelled() => return,
                    Ok(()) => debug!(%address, "ANCS session ended; retrying"),
                    Err(error) => warn!(%address, %error, "ANCS session ended; retrying"),
                }
            }
            None => debug!(%address, "ANCS service is not available on the active iPhone"),
        }
        if started_at.elapsed() >= MONITOR_RETRY_MAX {
            retry_delay = MONITOR_RETRY_INITIAL;
        }
        let delay = retry_delay;
        retry_delay = retry_delay.saturating_mul(2).min(MONITOR_RETRY_MAX);
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(delay) => {}
        }
    }
}

async fn find_ancs_service(
    adapter: &Adapter,
    address: Address,
) -> Option<(Service, Address, Address)> {
    let object_addresses = match adapter.device_addresses().await {
        Ok(addresses) => addresses,
        Err(error) => {
            debug!(%address, %error, "Failed to enumerate iPhone devices while probing ANCS");
            return None;
        }
    };
    for object_address in object_addresses {
        let device = match adapter.device(object_address) {
            Ok(device) => device,
            Err(_) => continue,
        };
        // BlueZ keeps an LE device's object path keyed by the resolvable
        // private address first seen during discovery, then exposes its stable
        // identity in Device1.Address after bonding. iAP2 reports that stable
        // identity, so compare the property rather than the object path.
        let remote_address = device.remote_address().await.ok();
        if object_address != address && remote_address != Some(address) {
            continue;
        }
        let le_address = [Some(object_address), remote_address, Some(address)]
            .into_iter()
            .flatten()
            .find(|candidate| super::hci::le_acl_connected(adapter, *candidate).unwrap_or(false));
        let Some(le_address) = le_address else {
            continue;
        };
        let service_ids = match enumerate_gatt_services(adapter.name(), object_address).await {
            Ok(service_ids) => service_ids,
            Err(error) => {
                debug!(%address, %error, "Failed to enumerate active iPhone GATT services for ANCS");
                continue;
            }
        };
        for service_id in service_ids {
            let service = match device.service(service_id).await {
                Ok(service) => service,
                Err(_) => continue,
            };
            if service.uuid().await.ok() == Some(ANCS_SERVICE) {
                return Some((service, le_address, object_address));
            }
        }
    }
    None
}

async fn enumerate_gatt_services(adapter_name: &str, address: Address) -> anyhow::Result<Vec<u16>> {
    let prefix = format!(
        "/org/bluez/{adapter_name}/dev_{}/service",
        address.to_string().replace(':', "_")
    );
    tokio::task::spawn_blocking(move || {
        use dbus::blocking::{stdintf::org_freedesktop_dbus::ObjectManager, Connection};

        let connection = Connection::new_system()?;
        let proxy = connection.with_proxy("org.bluez", "/", Duration::from_secs(2));
        let objects = proxy.get_managed_objects()?;
        let mut service_ids = Vec::new();
        for (path, interfaces) in objects {
            let path = path.to_string();
            let Some(suffix) = path.strip_prefix(&prefix) else {
                continue;
            };
            if suffix.contains('/') || !interfaces.contains_key("org.bluez.GattService1") {
                continue;
            }
            if let Ok(service_id) = u16::from_str_radix(suffix, 16) {
                service_ids.push(service_id);
            }
        }
        Ok::<_, anyhow::Error>(service_ids)
    })
    .await?
}

async fn run_session(
    adapter: &Adapter,
    address: Address,
    le_address: Address,
    object_address: Address,
    service: &Service,
    websocket: &Arc<WebSocketServer>,
    shutdown: &CancellationToken,
) -> Result<(), AncsError> {
    let mut adapter_events = adapter.events().await?;
    let (mut client, mut streams) = tokio::select! {
        _ = shutdown.cancelled() => return Ok(()),
        result = tokio::time::timeout(SUBSCRIBE_TIMEOUT, AncsClient::subscribe(service)) => {
            result.map_err(|_| AncsError::SubscribeTimeout)??
        }
    };
    info!(%address, "Subscribed to iPhone notifications over ANCS");
    let mut link_probe =
        tokio::time::interval_at(Instant::now() + LE_PROBE_INTERVAL, LE_PROBE_INTERVAL);
    link_probe.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let result = loop {
        if client.can_pump() {
            match client.pump(shutdown).await {
                PumpOutcome::Continue => continue,
                PumpOutcome::Waiting => {}
                PumpOutcome::Cancelled => break Ok(()),
            }
        }
        let fetch_deadline = client.fetch_deadline();
        let fetch_timeout = tokio::time::sleep_until(
            fetch_deadline.unwrap_or_else(|| Instant::now() + Duration::from_secs(3600)),
        );
        tokio::pin!(fetch_timeout);

        tokio::select! {
            _ = shutdown.cancelled() => break Ok(()),
            _ = link_probe.tick() => {
                if !super::hci::le_acl_connected(adapter, le_address).unwrap_or(false) {
                    debug!(%address, "ANCS LE link dropped");
                    break Ok(());
                }
            }
            event = adapter_events.next() => match event {
                Some(AdapterEvent::DeviceRemoved(removed_address))
                    if removed_device_matches_session(
                        removed_address,
                        address,
                        le_address,
                        object_address,
                    ) =>
                {
                    debug!(%address, "ANCS BlueZ device was removed; rebuilding the session");
                    break Ok(());
                }
                Some(_) => {}
                None => {
                    debug!(%address, "ANCS adapter event stream ended; rebuilding the session");
                    break Ok(());
                }
            },
            item = streams.notification_source.next() => match item {
                Some(frame) => client.on_notification_source(&frame, websocket).await,
                None => break Ok(()),
            },
            item = streams.data_source.next() => match item {
                Some(fragment) => client.on_data_source(&fragment, websocket).await,
                None => break Ok(()),
            },
            _ = &mut fetch_timeout, if fetch_deadline.is_some() => {
                client.on_fetch_timeout().await;
            }
        }
    };

    client.clear_active(websocket).await;
    result
}

fn removed_device_matches_session(
    removed_address: Address,
    address: Address,
    le_address: Address,
    object_address: Address,
) -> bool {
    removed_address == address || removed_address == le_address || removed_address == object_address
}

struct AncsStreams {
    notification_source: NotifyStream,
    data_source: NotifyStream,
}

struct AncsClient {
    control_point: Characteristic,
    pending: VecDeque<PendingRequest>,
    in_flight: Option<PendingRequest>,
    fetch_deadline: Option<Instant>,
    data_buffer: Vec<u8>,
    app_names: HashMap<String, String>,
    app_requests: HashSet<String>,
    active_notifications: HashMap<String, ActiveNotification>,
    active_ids: HashSet<String>,
    tombstoned_uids: HashSet<u32>,
}

enum PumpOutcome {
    Continue,
    Waiting,
    Cancelled,
}

impl AncsClient {
    async fn subscribe(service: &Service) -> Result<(Self, AncsStreams), AncsError> {
        let mut notification_source = None;
        let mut control_point = None;
        let mut data_source = None;
        for characteristic in service.characteristics().await? {
            match characteristic.uuid().await {
                Ok(uuid) if uuid == NOTIFICATION_SOURCE => {
                    notification_source = Some(characteristic)
                }
                Ok(uuid) if uuid == CONTROL_POINT => control_point = Some(characteristic),
                Ok(uuid) if uuid == DATA_SOURCE => data_source = Some(characteristic),
                Ok(_) => {}
                Err(error) => debug!(%error, "Failed to read ANCS characteristic UUID"),
            }
        }

        let notification_source =
            notification_source.ok_or(AncsError::CharacteristicMissing(NOTIFICATION_SOURCE))?;
        let control_point = control_point.ok_or(AncsError::CharacteristicMissing(CONTROL_POINT))?;
        let data_source = data_source.ok_or(AncsError::CharacteristicMissing(DATA_SOURCE))?;
        let notification_stream = notification_source.notify().await?;
        let data_stream = data_source.notify().await?;

        Ok((
            Self {
                control_point,
                pending: VecDeque::with_capacity(PENDING_QUEUE_CAP),
                in_flight: None,
                fetch_deadline: None,
                data_buffer: Vec::with_capacity(2048),
                app_names: HashMap::new(),
                app_requests: HashSet::new(),
                active_notifications: HashMap::new(),
                active_ids: HashSet::new(),
                tombstoned_uids: HashSet::new(),
            },
            AncsStreams {
                notification_source: Box::pin(notification_stream),
                data_source: Box::pin(data_stream),
            },
        ))
    }

    fn fetch_deadline(&self) -> Option<Instant> {
        self.fetch_deadline
    }

    fn can_pump(&self) -> bool {
        self.in_flight.is_none() && !self.pending.is_empty()
    }

    async fn pump(&mut self, shutdown: &CancellationToken) -> PumpOutcome {
        let Some(request) = self.pending.pop_front() else {
            return PumpOutcome::Waiting;
        };
        let command = match &request {
            PendingRequest::Notification { meta, .. } => {
                build_get_notification_attributes(meta.uid)
            }
            PendingRequest::App { bundle_id, .. } => build_get_app_attributes(bundle_id),
        };
        let write_options = write_request();
        let write = self.control_point.write_ext(&command, &write_options);
        let result = tokio::select! {
            _ = shutdown.cancelled() => return PumpOutcome::Cancelled,
            result = tokio::time::timeout(CONTROL_POINT_WRITE_TIMEOUT, write) => result,
        };
        match result {
            Ok(Ok(())) => {
                self.in_flight = Some(request);
                self.fetch_deadline = Some(Instant::now() + FETCH_TIMEOUT);
                PumpOutcome::Waiting
            }
            Ok(Err(error)) => {
                debug!(%error, "ANCS Control Point write failed");
                self.retry_or_drop(request).await;
                if self.can_pump() {
                    PumpOutcome::Continue
                } else {
                    PumpOutcome::Waiting
                }
            }
            Err(_) => {
                debug!("ANCS Control Point write timed out");
                self.retry_or_drop(request).await;
                if self.can_pump() {
                    PumpOutcome::Continue
                } else {
                    PumpOutcome::Waiting
                }
            }
        }
    }

    async fn on_notification_source(&mut self, frame: &[u8], websocket: &WebSocketServer) {
        let Some(meta) = NotificationMeta::parse(frame) else {
            debug!(
                bytes = frame.len(),
                "Ignoring malformed ANCS Notification Source frame"
            );
            return;
        };
        let id = notification_id(meta.uid);
        if meta.event_id == EVENT_REMOVED {
            if matches!(
                self.in_flight.as_ref(),
                Some(PendingRequest::Notification { meta: queued, .. }) if queued.uid == meta.uid
            ) {
                self.tombstoned_uids.insert(meta.uid);
            }
            self.remove_queued_uid(meta.uid);
            self.active_ids.remove(&id);
            self.active_notifications.remove(&id);
            broadcast_remove(websocket, id).await;
            return;
        }
        if meta.event_id != EVENT_ADDED && meta.event_id != EVENT_MODIFIED {
            debug!(
                event_id = meta.event_id,
                "Ignoring unknown ANCS notification event"
            );
            return;
        }
        self.tombstoned_uids.remove(&meta.uid);
        self.pending.retain(|request| {
            !matches!(request, PendingRequest::Notification { meta: queued, .. } if queued.uid == meta.uid)
        });
        if self.pending.len() >= PENDING_QUEUE_CAP {
            if let Some(index) = self
                .pending
                .iter()
                .position(|request| matches!(request, PendingRequest::Notification { .. }))
            {
                if let Some(PendingRequest::Notification { meta, .. }) = self.pending.remove(index)
                {
                    debug!(
                        uid = meta.uid,
                        "ANCS queue full; dropped oldest notification fetch"
                    );
                }
            }
        }
        self.pending
            .push_back(PendingRequest::Notification { meta, attempts: 0 });
    }

    async fn on_data_source(&mut self, fragment: &[u8], websocket: &WebSocketServer) {
        self.data_buffer.extend_from_slice(fragment);
        let Some(request) = self.in_flight.as_ref() else {
            debug!(
                bytes = fragment.len(),
                "Ignoring unsolicited ANCS Data Source fragment"
            );
            self.data_buffer.clear();
            return;
        };

        if self.data_buffer.len() > DATA_BUFFER_CAP
            || response_header_matches(request, &self.data_buffer) == Some(false)
        {
            warn!(
                bytes = self.data_buffer.len(),
                "Discarding invalid ANCS Data Source response"
            );
            self.data_buffer.clear();
            self.fetch_deadline = None;
            let request = self
                .in_flight
                .take()
                .expect("in-flight request disappeared");
            self.retry_or_drop(request).await;
            return;
        }

        let parsed = match request {
            PendingRequest::Notification { meta, .. } => {
                parse_notification_response(&self.data_buffer, meta.uid)
                    .map(ParsedResponse::Notification)
            }
            PendingRequest::App { bundle_id, .. } => {
                parse_app_response(&self.data_buffer, bundle_id).map(ParsedResponse::App)
            }
        };
        let Some(parsed) = parsed else {
            return;
        };
        let request = self
            .in_flight
            .take()
            .expect("in-flight request disappeared");
        self.fetch_deadline = None;
        match parsed {
            ParsedResponse::Notification((fields, consumed)) => {
                self.data_buffer.drain(..consumed);
                if let PendingRequest::Notification { meta, .. } = request {
                    self.handle_notification_fields(meta, fields, websocket)
                        .await;
                }
            }
            ParsedResponse::App((display_name, consumed)) => {
                self.data_buffer.drain(..consumed);
                if let PendingRequest::App { bundle_id, .. } = request {
                    self.handle_app_name(bundle_id, display_name, websocket)
                        .await;
                }
            }
        }
        if !self.data_buffer.is_empty() {
            warn!(
                bytes = self.data_buffer.len(),
                "Discarding trailing ANCS Data Source bytes"
            );
            self.data_buffer.clear();
        }
    }

    async fn on_fetch_timeout(&mut self) {
        let Some(request) = self.in_flight.take() else {
            return;
        };
        self.fetch_deadline = None;
        self.data_buffer.clear();
        self.retry_or_drop(request).await;
    }

    async fn retry_or_drop(&mut self, request: PendingRequest) {
        let request = request.increment_attempts();
        if let PendingRequest::Notification { meta, .. } = &request {
            if self.tombstoned_uids.remove(&meta.uid) {
                return;
            }
        }
        if request.attempts() < FETCH_ATTEMPTS {
            self.pending.push_front(request);
            return;
        }

        match request {
            PendingRequest::Notification { meta, .. } => {
                debug!(
                    uid = meta.uid,
                    "Dropping ANCS attribute fetch after retries"
                );
            }
            PendingRequest::App { bundle_id, .. } => {
                self.app_requests.remove(&bundle_id);
                debug!(%bundle_id, "Dropping ANCS app-name fetch after retries");
            }
        }
    }

    async fn handle_notification_fields(
        &mut self,
        meta: NotificationMeta,
        fields: NotificationFields,
        websocket: &WebSocketServer,
    ) {
        if self.tombstoned_uids.remove(&meta.uid) {
            return;
        }
        let bundle_id = fields
            .app_identifier
            .as_deref()
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown")
            .to_string();
        let notification = ReadyNotification { meta, fields };
        let id = notification_id(notification.meta.uid);
        let app_name = self.app_names.get(&bundle_id).cloned();
        self.emit(
            notification.clone(),
            &bundle_id,
            app_name.as_deref(),
            websocket,
        )
        .await;
        self.active_notifications.insert(
            id,
            ActiveNotification {
                bundle_id: bundle_id.clone(),
                notification,
            },
        );

        if app_name.is_none() && self.app_requests.insert(bundle_id.clone()) {
            self.pending.push_front(PendingRequest::App {
                bundle_id,
                attempts: 0,
            });
        }
    }

    async fn handle_app_name(
        &mut self,
        bundle_id: String,
        display_name: String,
        websocket: &WebSocketServer,
    ) {
        self.app_requests.remove(&bundle_id);
        let display_name = display_name.trim().to_string();
        let display_name = (!display_name.is_empty()).then_some(display_name);
        if let Some(name) = &display_name {
            self.app_names.insert(bundle_id.clone(), name.clone());
        }
        if let Some(display_name) = display_name.as_deref() {
            let updates = self
                .active_notifications
                .values()
                .filter(|active| active.bundle_id == bundle_id)
                .map(|active| active.notification.clone())
                .collect::<Vec<_>>();
            for notification in updates {
                self.emit(notification, &bundle_id, Some(display_name), websocket)
                    .await;
            }
        }
    }

    async fn emit(
        &mut self,
        notification: ReadyNotification,
        bundle_id: &str,
        app_name: Option<&str>,
        websocket: &WebSocketServer,
    ) {
        let id = notification_id(notification.meta.uid);
        let title = nonempty(notification.fields.title)
            .or_else(|| app_name.map(ToOwned::to_owned))
            .unwrap_or_else(|| bundle_fallback_name(bundle_id));
        let subtitle = nonempty(notification.fields.subtitle);
        let body = nonempty(notification.fields.message).unwrap_or_default();
        let event = NotificationShowEvent {
            id: Some(id.clone()),
            title,
            body: Some(body),
            subtitle,
            category: Some(format!("ios.{}", notification.meta.category.as_str())),
            days_until_expiry: None,
            timestamp: Some(unix_timestamp_ms()),
            app_bundle_id: Some(bundle_id.to_string()),
            app_name: app_name.map(ToOwned::to_owned),
            silent: Some(notification.meta.flags & FLAG_SILENT != 0),
            important: Some(notification.meta.flags & FLAG_IMPORTANT != 0),
            pre_existing: Some(notification.meta.flags & FLAG_PRE_EXISTING != 0),
        };
        self.active_ids.insert(id.clone());
        debug!(%id, app_bundle_id = %bundle_id, "Forwarding iPhone notification to UI");
        websocket
            .broadcast_event("notification.show".to_string(), typed_json(event))
            .await;
    }

    fn remove_queued_uid(&mut self, uid: u32) {
        self.pending.retain(|request| {
            !matches!(request, PendingRequest::Notification { meta, .. } if meta.uid == uid)
        });
        self.active_notifications.remove(&notification_id(uid));
    }

    async fn clear_active(&mut self, websocket: &WebSocketServer) {
        for id in self.active_ids.drain() {
            broadcast_remove(websocket, id).await;
        }
        self.active_notifications.clear();
    }
}

#[derive(Debug, Clone)]
enum PendingRequest {
    Notification {
        meta: NotificationMeta,
        attempts: u8,
    },
    App {
        bundle_id: String,
        attempts: u8,
    },
}

impl PendingRequest {
    fn attempts(&self) -> u8 {
        match self {
            Self::Notification { attempts, .. } | Self::App { attempts, .. } => *attempts,
        }
    }

    fn increment_attempts(mut self) -> Self {
        match &mut self {
            Self::Notification { attempts, .. } | Self::App { attempts, .. } => {
                *attempts = attempts.saturating_add(1);
            }
        }
        self
    }
}

enum ParsedResponse {
    Notification((NotificationFields, usize)),
    App((String, usize)),
}

#[derive(Debug, Clone)]
struct NotificationMeta {
    event_id: u8,
    flags: u8,
    category: NotificationCategory,
    uid: u32,
}

impl NotificationMeta {
    fn parse(frame: &[u8]) -> Option<Self> {
        (frame.len() >= 8).then(|| Self {
            event_id: frame[0],
            flags: frame[1],
            category: NotificationCategory::from(frame[2]),
            uid: u32::from_le_bytes([frame[4], frame[5], frame[6], frame[7]]),
        })
    }
}

#[derive(Debug, Clone, Copy)]
enum NotificationCategory {
    Other,
    IncomingCall,
    MissedCall,
    Voicemail,
    Social,
    Schedule,
    Email,
    News,
    HealthAndFitness,
    BusinessAndFinance,
    Location,
    Entertainment,
}

impl NotificationCategory {
    fn as_str(self) -> &'static str {
        match self {
            Self::Other => "other",
            Self::IncomingCall => "incoming_call",
            Self::MissedCall => "missed_call",
            Self::Voicemail => "voicemail",
            Self::Social => "social",
            Self::Schedule => "schedule",
            Self::Email => "email",
            Self::News => "news",
            Self::HealthAndFitness => "health_and_fitness",
            Self::BusinessAndFinance => "business_and_finance",
            Self::Location => "location",
            Self::Entertainment => "entertainment",
        }
    }
}

impl From<u8> for NotificationCategory {
    fn from(value: u8) -> Self {
        match value {
            1 => Self::IncomingCall,
            2 => Self::MissedCall,
            3 => Self::Voicemail,
            4 => Self::Social,
            5 => Self::Schedule,
            6 => Self::Email,
            7 => Self::News,
            8 => Self::HealthAndFitness,
            9 => Self::BusinessAndFinance,
            10 => Self::Location,
            11 => Self::Entertainment,
            _ => Self::Other,
        }
    }
}

#[derive(Debug, Default, Clone)]
struct NotificationFields {
    app_identifier: Option<String>,
    title: Option<String>,
    subtitle: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone)]
struct ReadyNotification {
    meta: NotificationMeta,
    fields: NotificationFields,
}

struct ActiveNotification {
    bundle_id: String,
    notification: ReadyNotification,
}

fn build_get_notification_attributes(uid: u32) -> Vec<u8> {
    let mut command = Vec::with_capacity(20);
    command.push(COMMAND_GET_NOTIFICATION_ATTRIBUTES);
    command.extend_from_slice(&uid.to_le_bytes());
    command.push(ATTR_APP_IDENTIFIER);
    command.push(ATTR_TITLE);
    command.extend_from_slice(&TITLE_MAX.to_le_bytes());
    command.push(ATTR_SUBTITLE);
    command.extend_from_slice(&SUBTITLE_MAX.to_le_bytes());
    command.push(ATTR_MESSAGE);
    command.extend_from_slice(&MESSAGE_MAX.to_le_bytes());
    command.push(ATTR_POSITIVE_ACTION_LABEL);
    command.push(ATTR_NEGATIVE_ACTION_LABEL);
    command.push(ATTR_DATE);
    command
}

fn build_get_app_attributes(bundle_id: &str) -> Vec<u8> {
    let mut command = Vec::with_capacity(bundle_id.len() + 3);
    command.push(COMMAND_GET_APP_ATTRIBUTES);
    command.extend_from_slice(bundle_id.as_bytes());
    command.push(0);
    command.push(APP_ATTR_DISPLAY_NAME);
    command
}

fn write_request() -> CharacteristicWriteRequest {
    CharacteristicWriteRequest {
        op_type: WriteOp::Request,
        ..Default::default()
    }
}

fn parse_notification_response(
    buffer: &[u8],
    expected_uid: u32,
) -> Option<(NotificationFields, usize)> {
    if buffer.len() < 5 || buffer[0] != COMMAND_GET_NOTIFICATION_ATTRIBUTES {
        return None;
    }
    let uid = u32::from_le_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]);
    if uid != expected_uid {
        return None;
    }

    let mut fields = NotificationFields::default();
    let mut index = 5;
    while index < buffer.len() {
        let (attribute, value, next) = parse_attribute(buffer, index)?;
        let text = String::from_utf8_lossy(value).into_owned();
        match attribute {
            ATTR_APP_IDENTIFIER => fields.app_identifier = Some(text),
            ATTR_TITLE => fields.title = Some(text),
            ATTR_SUBTITLE => fields.subtitle = Some(text),
            ATTR_MESSAGE => fields.message = Some(text),
            ATTR_DATE => return Some((fields, next)),
            ATTR_POSITIVE_ACTION_LABEL | ATTR_NEGATIVE_ACTION_LABEL => {}
            _ => {}
        }
        index = next;
    }
    None
}

fn parse_app_response(buffer: &[u8], expected_bundle_id: &str) -> Option<(String, usize)> {
    if buffer.first().copied()? != COMMAND_GET_APP_ATTRIBUTES {
        return None;
    }
    let terminator = buffer[1..].iter().position(|byte| *byte == 0)? + 1;
    let bundle_id = std::str::from_utf8(&buffer[1..terminator]).ok()?;
    if bundle_id != expected_bundle_id {
        return None;
    }
    let (attribute, value, next) = parse_attribute(buffer, terminator + 1)?;
    if attribute != APP_ATTR_DISPLAY_NAME {
        return None;
    }
    Some((String::from_utf8_lossy(value).into_owned(), next))
}

fn parse_attribute(buffer: &[u8], index: usize) -> Option<(u8, &[u8], usize)> {
    if index.checked_add(3)? > buffer.len() {
        return None;
    }
    let attribute = buffer[index];
    let length = u16::from_le_bytes([buffer[index + 1], buffer[index + 2]]) as usize;
    let value_start = index + 3;
    let value_end = value_start.checked_add(length)?;
    if value_end > buffer.len() {
        return None;
    }
    Some((attribute, &buffer[value_start..value_end], value_end))
}

fn response_header_matches(request: &PendingRequest, buffer: &[u8]) -> Option<bool> {
    match request {
        PendingRequest::Notification { meta, .. } => {
            if buffer.len() < 5 {
                return None;
            }
            let uid = u32::from_le_bytes([buffer[1], buffer[2], buffer[3], buffer[4]]);
            Some(buffer[0] == COMMAND_GET_NOTIFICATION_ATTRIBUTES && uid == meta.uid)
        }
        PendingRequest::App { bundle_id, .. } => {
            let command = *buffer.first()?;
            if command != COMMAND_GET_APP_ATTRIBUTES {
                return Some(false);
            }
            let terminator = buffer[1..].iter().position(|byte| *byte == 0)? + 1;
            Some(std::str::from_utf8(&buffer[1..terminator]).ok() == Some(bundle_id.as_str()))
        }
    }
}

fn nonempty(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

fn notification_id(uid: u32) -> String {
    format!("{NOTIFICATION_ID_PREFIX}{uid}")
}

fn bundle_fallback_name(bundle_id: &str) -> String {
    bundle_id
        .rsplit('.')
        .next()
        .filter(|part| !part.is_empty())
        .unwrap_or("iPhone")
        .to_string()
}

fn unix_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn typed_json<T: Serialize>(payload: T) -> serde_json::Value {
    serde_json::to_value(payload).unwrap_or_else(|_| serde_json::json!({}))
}

async fn broadcast_remove(websocket: &WebSocketServer, id: String) {
    websocket
        .broadcast_event(
            "notification.remove".to_string(),
            typed_json(NotificationRemoveEvent { id }),
        )
        .await;
}

#[derive(Debug, thiserror::Error)]
enum AncsError {
    #[error("ANCS characteristic {0} not found")]
    CharacteristicMissing(Uuid),
    #[error(transparent)]
    Bluetooth(#[from] bluer::Error),
    #[error("ANCS subscription timed out")]
    SubscribeTimeout,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autonomous_monitor_requires_a_unique_iphone() {
        let first: Address = "A8:AB:B5:AB:02:ED".parse().expect("first address");
        let second: Address = "A8:AB:B5:AB:02:EE".parse().expect("second address");

        assert_eq!(unique_autonomous_candidate(vec![]), Ok(None));
        assert_eq!(unique_autonomous_candidate(vec![first]), Ok(Some(first)));
        assert_eq!(unique_autonomous_candidate(vec![first, second]), Err(2));
    }

    #[test]
    fn autonomous_monitor_ignores_stale_discovery_results() {
        assert!(is_current_discovery_result(4, 4, true));
        assert!(!is_current_discovery_result(3, 4, true));
        assert!(!is_current_discovery_result(4, 4, false));
    }

    #[test]
    fn ancs_session_matches_all_bluez_address_forms_on_removal() {
        let stable: Address = "A8:AB:B5:AB:02:ED".parse().expect("stable address");
        let le: Address = "41:42:43:44:45:46".parse().expect("LE address");
        let object: Address = "51:52:53:54:55:56".parse().expect("object address");
        let unrelated: Address = "61:62:63:64:65:66".parse().expect("unrelated address");

        assert!(removed_device_matches_session(stable, stable, le, object));
        assert!(removed_device_matches_session(le, stable, le, object));
        assert!(removed_device_matches_session(object, stable, le, object));
        assert!(!removed_device_matches_session(
            unrelated, stable, le, object
        ));
    }

    fn attribute(id: u8, value: &[u8]) -> Vec<u8> {
        let mut bytes = vec![id];
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend_from_slice(value);
        bytes
    }

    fn notification_response(uid: u32) -> Vec<u8> {
        let mut bytes = vec![COMMAND_GET_NOTIFICATION_ATTRIBUTES];
        bytes.extend_from_slice(&uid.to_le_bytes());
        bytes.extend(attribute(ATTR_APP_IDENTIFIER, b"com.apple.MobileSMS"));
        bytes.extend(attribute(ATTR_TITLE, b"Alex"));
        bytes.extend(attribute(ATTR_SUBTITLE, b"Messages"));
        bytes.extend(attribute(ATTR_MESSAGE, b"On my way"));
        bytes.extend(attribute(ATTR_POSITIVE_ACTION_LABEL, b"Reply"));
        bytes.extend(attribute(ATTR_NEGATIVE_ACTION_LABEL, b"Dismiss"));
        bytes.extend(attribute(ATTR_DATE, b"20260715T171500"));
        bytes
    }

    #[test]
    fn notification_source_frame_is_little_endian() {
        let meta = NotificationMeta::parse(&[EVENT_ADDED, 0x07, 4, 2, 0x78, 0x56, 0x34, 0x12])
            .expect("valid source frame");
        assert_eq!(meta.event_id, EVENT_ADDED);
        assert_eq!(meta.flags, 0x07);
        assert!(matches!(meta.category, NotificationCategory::Social));
        assert_eq!(meta.uid, 0x1234_5678);
    }

    #[test]
    fn notification_request_asks_for_date_last() {
        let command = build_get_notification_attributes(7);
        assert_eq!(command.last(), Some(&ATTR_DATE));
        assert_eq!(&command[1..5], &7_u32.to_le_bytes());
    }

    #[test]
    fn notification_response_waits_for_all_fragments() {
        let response = notification_response(42);
        let split = response.len() - 5;
        assert!(parse_notification_response(&response[..split], 42).is_none());
        let (fields, consumed) =
            parse_notification_response(&response, 42).expect("complete response");
        assert_eq!(consumed, response.len());
        assert_eq!(
            fields.app_identifier.as_deref(),
            Some("com.apple.MobileSMS")
        );
        assert_eq!(fields.title.as_deref(), Some("Alex"));
        assert_eq!(fields.subtitle.as_deref(), Some("Messages"));
        assert_eq!(fields.message.as_deref(), Some("On my way"));
    }

    #[test]
    fn notification_response_rejects_wrong_uid() {
        assert!(parse_notification_response(&notification_response(42), 7).is_none());
    }

    #[test]
    fn back_to_back_notification_responses_preserve_boundary() {
        let first = notification_response(1);
        let mut combined = first.clone();
        combined.extend(notification_response(2));
        let (_, consumed) =
            parse_notification_response(&combined, 1).expect("first response parses");
        assert_eq!(consumed, first.len());
        assert!(parse_notification_response(&combined[consumed..], 2).is_some());
    }

    #[test]
    fn app_response_parses_display_name_and_fragmentation() {
        let bundle_id = "com.apple.MobileSMS";
        let mut response = vec![COMMAND_GET_APP_ATTRIBUTES];
        response.extend_from_slice(bundle_id.as_bytes());
        response.push(0);
        response.extend(attribute(APP_ATTR_DISPLAY_NAME, b"Messages"));
        assert!(parse_app_response(&response[..response.len() - 1], bundle_id).is_none());
        let (name, consumed) = parse_app_response(&response, bundle_id).expect("app response");
        assert_eq!(name, "Messages");
        assert_eq!(consumed, response.len());
    }

    #[test]
    fn app_request_is_nul_terminated() {
        let command = build_get_app_attributes("com.spotify.client");
        assert_eq!(command[0], COMMAND_GET_APP_ATTRIBUTES);
        assert_eq!(command[command.len() - 2], 0);
        assert_eq!(command.last(), Some(&APP_ATTR_DISPLAY_NAME));
    }
}
