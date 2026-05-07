use crate::app::msgpack::{
    create_audio_data_event, create_audio_lifecycle_event, MsgPackProtocolHandler,
};
use crate::audio::{AudioCommand, AudioEvent};
use crate::bluetooth_agent;
use crate::image_cache::ImageCache;
use crate::{
    app::AppMessage, config::Config, error::Result, iap2_wrapper::Iap2Connection,
    websocket::WebSocketServer,
};
use base64::Engine;
use bluer::{
    rfcomm::{Profile, ReqError, Role, SocketAddr, Stream},
    Adapter, AdapterEvent, Address, Device, DeviceEvent, DeviceProperty, Session, Uuid,
};
use bytes::BytesMut;
use dbus::blocking::Connection;
use dbus::Path;
use futures::StreamExt;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{broadcast, mpsc, Mutex};
use tracing::{debug, error, info, warn};

pub struct GenericConnection {
    pub device_address: Address,
    pub tx: mpsc::UnboundedSender<AppMessage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConnectionOutcome {
    Connected,
    WaitingForAndroid,
}

pub struct BluetoothDaemon {
    session: Session,
    adapter: Adapter,
    connections: Arc<Mutex<Vec<Iap2Connection>>>,
    generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
    android_wake_armed: Arc<Mutex<bool>>,
    pairing_mode: Arc<Mutex<bool>>,
    ws_to_app_rx: Option<mpsc::UnboundedReceiver<AppMessage>>,
    websocket_server: Option<Arc<WebSocketServer>>,
    audio_event_rx: broadcast::Receiver<AudioEvent>,
    audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
    wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
}

impl BluetoothDaemon {
    pub async fn new(
        _config: Config,
        ws_to_app_rx: Option<mpsc::UnboundedReceiver<AppMessage>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) -> Result<Self> {
        let session = Session::new().await?;

        let adapter = session.default_adapter().await?;

        info!("Using Bluetooth adapter: {}", adapter.name());

        adapter.set_powered(true).await?;
        adapter.set_discoverable(true).await?;
        adapter.set_pairable(true).await?;

        let device_name = crate::config::get_bluetooth_device_name().unwrap_or_else(|e| {
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

        if let Err(e) = bluetooth_agent::start_agent_thread(websocket_server.clone()) {
            warn!("Failed to start Bluetooth pairing agent: {}", e);
        }

        Ok(BluetoothDaemon {
            session,
            adapter,
            connections: Arc::new(Mutex::new(Vec::new())),
            generic_connections: Arc::new(Mutex::new(Vec::new())),
            android_wake_armed: Arc::new(Mutex::new(false)),
            pairing_mode: Arc::new(Mutex::new(true)),
            ws_to_app_rx,
            websocket_server,
            audio_event_rx,
            audio_cmd_tx,
            wakeword_pause_tx,
        })
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

        info!("Bluetooth daemon running, waiting for connections...");

        if let Some(mut ws_rx) = self.ws_to_app_rx.take() {
            let connections = Arc::clone(&self.connections);
            let generic_connections = Arc::clone(&self.generic_connections);
            let websocket_server = self.websocket_server.clone();
            let adapter = self.adapter.clone();
            let android_wake_armed = self.android_wake_armed.clone();
            let audio_cmd_tx = self.audio_cmd_tx.clone();
            let wakeword_pause_tx = self.wakeword_pause_tx.clone();
            let audio_event_rx_for_connect = self.audio_event_rx.resubscribe();
            tokio::spawn(async move {
                while let Some(ws_message) = ws_rx.recv().await {
                    debug!("Received WebSocket message: {:?}", ws_message);

                    if ws_message.protocol == "bluetooth.control" {
                        debug!("Processing bluetooth control message");

                        if let Ok(data) =
                            serde_json::from_slice::<serde_json::Value>(&ws_message.data)
                        {
                            if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
                                match method {
                                    "bluetooth.device.connect" => {
                                        let params =
                                            data.get("params").unwrap_or(&serde_json::Value::Null);

                                        let address_str = params
                                            .get("address")
                                            .and_then(|a| a.as_str())
                                            .map(|s| s.to_string());

                                        if let Some(address_str) = address_str {
                                            if let Ok(address) = Address::from_str(&address_str) {
                                                let connections_clone = Arc::clone(&connections);
                                                let generic_connections_clone =
                                                    Arc::clone(&generic_connections);
                                                let ws_server_clone = websocket_server.clone();
                                                let msg_id = ws_message.id.clone();
                                                let address_str_clone = address_str.clone();
                                                let adapter_clone = adapter.clone();
                                                let android_wake_armed_clone =
                                                    android_wake_armed.clone();
                                                let audio_rx =
                                                    audio_event_rx_for_connect.resubscribe();
                                                let audio_tx = audio_cmd_tx.clone();
                                                let wakeword_pause = wakeword_pause_tx.clone();

                                                tokio::spawn(async move {
                                                    {
                                                        let mut armed =
                                                            android_wake_armed_clone.lock().await;
                                                        *armed = true;
                                                    }
                                                    match BluetoothDaemon::connect_to_device(
                                                    address,
                                                    0,
                                                    "",
                                                    connections_clone,
                                                    generic_connections_clone,
                                                    ws_server_clone.clone(),
                                                    adapter_clone,
                                                    android_wake_armed_clone.clone(),
                                                    audio_rx,
                                                    audio_tx,
                                                    wakeword_pause,
                                                )
                                                .await {
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
                                                                    serde_json::json!({
                                                                        "status": "connected",
                                                                        "device": address_str_clone
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
                                                                    serde_json::json!({
                                                                        "status": "waiting_for_android",
                                                                        "device": address_str_clone
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
                                        }
                                    }
                                    "bluetooth.device.disconnect" => {
                                        let params =
                                            data.get("params").unwrap_or(&serde_json::Value::Null);

                                        let address_str = params
                                            .get("address")
                                            .and_then(|a| a.as_str())
                                            .map(|s| s.to_string());

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
                                                                            serde_json::json!({
                                                                                "status": "disconnected",
                                                                                "device": addr
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
                                        let params =
                                            data.get("params").unwrap_or(&serde_json::Value::Null);

                                        let address_str = params
                                            .get("address")
                                            .and_then(|a| a.as_str())
                                            .map(|s| s.to_string());

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
                                                                            serde_json::json!({
                                                                                "status": "unpaired",
                                                                                "device": addr
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

                    if let Ok(data) = serde_json::from_slice::<serde_json::Value>(&ws_message.data)
                    {
                        if let Some(method) = data.get("method").and_then(|m| m.as_str()) {
                            if method == "audio.record.start" {
                                let (ack_tx, ack_rx) = tokio::sync::oneshot::channel();
                                let _ = wakeword_pause_tx.send(
                                    crate::wakeword::WakeWordCommand::Pause {
                                        ack: Some(ack_tx),
                                        persist: false,
                                    },
                                );
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
                                let _ = wakeword_pause_tx.send(
                                    crate::wakeword::WakeWordCommand::Pause {
                                        ack: None,
                                        persist: true,
                                    },
                                );
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
                                let _ = wakeword_pause_tx.send(
                                    crate::wakeword::WakeWordCommand::Resume { persist: true },
                                );
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

    async fn start_listener(&mut self) -> Result<()> {
        let accessory_uuid = "00000000-deca-fade-deca-deafdecacaff";

        info!("Registering iAP2 profile");
        self.register_iap2_profile(accessory_uuid).await?;
        info!("iAP2 Service UUID: {}", accessory_uuid);

        info!("Registering SPP profile for generic devices");
        self.register_spp_profile().await?;
        info!("SPP Service UUID: 00001101-0000-1000-8000-00805f9b34fb");

        self.register_bluetooth_agent().await?;

        Ok(())
    }

    async fn start_device_monitor(&self) {
        let adapter = self.adapter.clone();
        let websocket_server = self.websocket_server.clone();

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
                                    tokio::spawn(async move {
                                        Self::monitor_device_events(device, address, ws).await;
                                    });
                                }
                            }
                            AdapterEvent::DeviceRemoved(address) => {
                                info!("Device removed: {}", address);
                                if let Some(ws) = &websocket_server {
                                    ws.broadcast_event(
                                        "bluetooth.device".to_string(),
                                        serde_json::json!({
                                            "event": "removed",
                                            "device": address.to_string()
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
    ) {
        match device.events().await {
            Ok(mut events) => {
                if let Ok(paired) = device.is_paired().await {
                    if paired {
                        info!("Device {} is already paired", address);
                        if let Some(ws) = &websocket_server {
                            ws.broadcast_event(
                                "bluetooth.pairing".to_string(),
                                serde_json::json!({
                                    "event": "paired",
                                    "device": address.to_string()
                                }),
                            )
                            .await;
                        }
                    }
                }

                while let Some(event) = events.next().await {
                    match event {
                        DeviceEvent::PropertyChanged(DeviceProperty::Paired(paired)) => {
                            info!("Device {} paired status changed: {}", address, paired);
                            if let Some(ws) = &websocket_server {
                                ws.broadcast_event(
                                    "bluetooth.pairing".to_string(),
                                    serde_json::json!({
                                        "event": if paired { "paired" } else { "unpaired" },
                                        "device": address.to_string()
                                    }),
                                )
                                .await;
                            }
                        }
                        DeviceEvent::PropertyChanged(DeviceProperty::Connected(connected)) => {
                            info!("Device {} connected status changed: {}", address, connected);
                            if let Some(ws) = &websocket_server {
                                ws.broadcast_event(
                                    "bluetooth.device".to_string(),
                                    serde_json::json!({
                                        "event": if connected { "connected" } else { "disconnected" },
                                        "device": address.to_string()
                                    }),
                                ).await;
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

    async fn register_iap2_profile(&self, accessory_uuid: &str) -> Result<()> {
        let uuid = Uuid::from_str(accessory_uuid).map_err(|e| {
            crate::error::NocturnedError::Config(format!("Invalid iAP2 UUID: {}", e))
        })?;

        let profile = Profile {
            uuid,
            service: Some(uuid),
            name: Some("iAP2".to_string()),
            role: Some(Role::Server),
            channel: Some(1),
            require_authentication: Some(true),
            require_authorization: Some(false),
            auto_connect: Some(true),
            service_record: Some(self.create_sdp_record_xml(accessory_uuid)),
            version: Some(0x0102),
            ..Default::default()
        };

        let session = self.session.clone();
        let connections = self.connections.clone();
        let websocket_server = self.websocket_server.clone();
        let audio_event_rx = self.audio_event_rx.resubscribe();
        let audio_cmd_tx = self.audio_cmd_tx.clone();
        let wakeword_pause_tx = self.wakeword_pause_tx.clone();

        let handle = session.register_profile(profile).await?;

        tokio::spawn(async move {
            futures::pin_mut!(handle);
            while let Some(req) = handle.next().await {
                let device = req.device();
                match req.accept() {
                    Ok(stream) => {
                        info!("New RFCOMM connection from: {}", device);

                        if let Some(ws_server) = &websocket_server {
                            ws_server
                                .broadcast_event(
                                    "bluetooth.connection".to_string(),
                                    serde_json::json!({
                                        "event": "connection_established",
                                        "device": device.to_string(),
                                        "connection_type": "rfcomm"
                                    }),
                                )
                                .await;
                        }

                        if let Err(e) = Self::handle_new_connection(
                            device,
                            stream,
                            connections.clone(),
                            websocket_server.clone(),
                            audio_event_rx.resubscribe(),
                            audio_cmd_tx.clone(),
                            wakeword_pause_tx.clone(),
                        )
                        .await
                        {
                            error!("Failed to handle connection: {}", e);
                        }
                    }
                    Err(e) => {
                        error!("Failed to accept RFCOMM connection: {}", e);
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
        let android_wake_armed = self.android_wake_armed.clone();
        let pairing_mode = self.pairing_mode.clone();
        let audio_event_rx = self.audio_event_rx.resubscribe();

        let handle = session.register_profile(profile).await?;

        tokio::spawn(async move {
            futures::pin_mut!(handle);
            while let Some(req) = handle.next().await {
                let device = req.device();
                let pairing_allowed = { *pairing_mode.lock().await };
                let wake_armed = { *android_wake_armed.lock().await };
                if !pairing_allowed && !wake_armed {
                    info!(
                        "Rejecting SPP connection from {} because neither pairing mode nor Android wake is armed",
                        device
                    );
                    req.reject(ReqError::Rejected);
                    continue;
                }

                if pairing_allowed {
                    info!("Accepting SPP connection from {} (pairing mode)", device);
                } else {
                    info!("Accepting SPP connection from {} (wake armed)", device);
                }

                match req.accept() {
                    Ok(stream) => {
                        info!("New SPP connection from generic device: {}", device);

                        {
                            let mut armed = android_wake_armed.lock().await;
                            *armed = false;
                        }

                        let ws_server = websocket_server.clone();
                        if let Some(ws) = &ws_server {
                            ws.broadcast_event(
                                "bluetooth.connection".to_string(),
                                serde_json::json!({
                                    "event": "connection_established",
                                    "device": device.to_string(),
                                    "connection_type": "generic"
                                }),
                            )
                            .await;
                        }

                        let (app_tx, app_rx) = mpsc::unbounded_channel::<AppMessage>();

                        {
                            let mut conns = generic_connections.lock().await;
                            conns.push(GenericConnection {
                                device_address: device,
                                tx: app_tx,
                            });
                        }

                        let generic_conns = generic_connections.clone();
                        let ws_clone = ws_server.clone();
                        let audio_rx = audio_event_rx.resubscribe();
                        tokio::spawn(async move {
                            Self::run_spp_msgpack_handler(
                                device,
                                stream,
                                generic_conns,
                                ws_clone,
                                app_rx,
                                audio_rx,
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
        device: Address,
        mut stream: Stream,
        generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        mut app_rx: mpsc::UnboundedReceiver<AppMessage>,
        mut audio_event_rx: broadcast::Receiver<AudioEvent>,
    ) {
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

        let (session_tx, mut session_rx) = mpsc::unbounded_channel::<AppMessage>();
        handler.set_session_info(session_tx, 0);

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

                    handler.mark_as_websocket_message(msg.id.clone());

                    if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&msg.data) {
                        if let Some(method) = parsed.get("method").and_then(|m| m.as_str()) {
                            handler.mark_method_for_message(msg.id.clone(), method.to_string());

                            if method == "spotify.image.fetch" {
                                if let Some(url) = parsed.get("params")
                                    .and_then(|p| p.get("url"))
                                    .and_then(|u| u.as_str())
                                {
                                    handler.mark_as_image_request(msg.id.clone(), url.to_string());
                                }
                            }
                        }
                    }

                    let json_data: serde_json::Value = serde_json::from_slice(&msg.data).unwrap_or_default();
                    let method = json_data.get("method").and_then(|m| m.as_str()).unwrap_or("unknown");
                    let params = json_data.get("params").cloned().unwrap_or(serde_json::json!({}));

                    if let Ok(msgpack_data) = rmp_serde::to_vec_named(&serde_json::json!({
                        "type": "call",
                        "id": msg.id,
                        "method": method,
                        "params": params
                    })) {
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

        {
            let mut conns = generic_connections.lock().await;
            conns.retain(|c| c.device_address != device);
        }

        if let Some(ws_server) = &websocket_server {
            ws_server.clear_app_ready().await;
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    serde_json::json!({
                        "event": "connection_closed",
                        "device": device.to_string(),
                        "connection_type": "android"
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
        let event = crate::app::msgpack::MsgPackMessage::Event {
            topic: "daemon.ready".to_string(),
            data: serde_json::json!({}),
        };

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

    fn create_sdp_record_xml(&self, uuid: &str) -> String {
        let device_name = crate::config::get_bluetooth_device_name().unwrap_or_else(|e| {
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
            <uuid value="{}" />
        </sequence>
    </attribute>
    <attribute id="0x0004">
        <sequence>
            <sequence>
                <uuid value="0x0100" />
            </sequence>
            <sequence>
                <uuid value="0x0003" />
                <uint8 value="0x{:02x}" />
            </sequence>
        </sequence>
    </attribute>
    <attribute id="0x0009">
        <sequence>
            <sequence>
                <uuid value="{}" />
                <uint16 value="0x0102" />
            </sequence>
        </sequence>
    </attribute>
    <attribute id="0x0005">
        <sequence>
            <uuid value="0x1002" />
        </sequence>
    </attribute>
    <attribute id="0x0100">
        <text value="iAP2" />
    </attribute>
    <attribute id="0x0101">
        <text value="iPod Accessory Protocol v2" />
    </attribute>
    <attribute id="0x0102">
        <text value="{}" />
    </attribute>
</record>"#,
            uuid, 1, uuid, device_name
        )
    }

    fn create_spp_record_xml(&self) -> String {
        let device_name = crate::config::get_bluetooth_device_name().unwrap_or_else(|e| {
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

    async fn handle_new_connection(
        device: Address,
        stream: Stream,
        connections: Arc<Mutex<Vec<Iap2Connection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) -> Result<()> {
        info!("Establishing iAP2 connection with {}", device);

        let websocket_server_clone = websocket_server.clone();
        let connection = Iap2Connection::new(
            device,
            stream,
            websocket_server,
            audio_event_rx,
            audio_cmd_tx,
            wakeword_pause_tx,
        )
        .await?;

        let conn_clone = connection.clone();
        let user_flag = conn_clone.user_disconnect_flag();
        tokio::spawn(async move {
            if let Err(e) = conn_clone.run().await {
                error!("iAP2 connection error: {}", e);
            }
            info!("iAP2 connection closed for {}", device);

            if let Some(ws_server) = &websocket_server_clone {
                ws_server.clear_app_ready().await;

                let user = *user_flag.lock().await;
                let mut payload = serde_json::json!({
                    "event": "connection_closed",
                    "device": device.to_string(),
                    "connection_type": "rfcomm"
                });
                if user {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("initiated_by".to_string(), serde_json::json!("user"));
                    }
                }
                ws_server
                    .broadcast_event("bluetooth.connection".to_string(), payload)
                    .await;
            }
        });

        let mut conns = connections.lock().await;
        conns.push(connection);

        Ok(())
    }

    const IAP2_LINK_TIMEOUT: Duration = Duration::from_secs(5);

    #[allow(clippy::too_many_arguments)]
    async fn connect_to_device(
        address: Address,
        _channel: u8,
        _device_type: &str,
        connections: Arc<Mutex<Vec<Iap2Connection>>>,
        _generic_connections: Arc<Mutex<Vec<GenericConnection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        _adapter: Adapter,
        android_wake_armed: Arc<Mutex<bool>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) -> Result<ConnectionOutcome> {
        info!("Connecting to device {} (auto-detecting protocol)", address);

        if let Some(ws_server) = &websocket_server {
            ws_server
                .broadcast_event(
                    "bluetooth.connection".to_string(),
                    serde_json::json!({
                        "event": "connecting",
                        "device": address.to_string(),
                        "connection_type": "auto",
                    }),
                )
                .await;
        }

        info!("Attempting iAP2 connection on channel 1 for {}", address);
        let iap2_socket_addr = SocketAddr::new(address, 1);

        match tokio::time::timeout(
            Self::IAP2_LINK_TIMEOUT,
            Self::try_iap2_connection(
                address,
                iap2_socket_addr,
                connections.clone(),
                websocket_server.clone(),
                audio_event_rx,
                audio_cmd_tx,
                wakeword_pause_tx,
            ),
        )
        .await
        {
            Ok(Ok(())) => {
                info!("iAP2 connection established with {} (iPhone)", address);
                if let Some(ws_server) = &websocket_server {
                    ws_server
                        .broadcast_event(
                            "bluetooth.connection".to_string(),
                            serde_json::json!({
                                "event": "connection_established",
                                "device": address.to_string(),
                                "connection_type": "iap2",
                                "device_type": "iphone",
                                "channel": 1,
                                "initiated_by": "daemon"
                            }),
                        )
                        .await;
                }
                return Ok(ConnectionOutcome::Connected);
            }
            Ok(Err(e)) => {
                info!(
                    "iAP2 connection failed for {}: {}, falling back to SPP",
                    address, e
                );
            }
            Err(_) => {
                info!(
                    "iAP2 connection timed out for {}, falling back to SPP",
                    address
                );
            }
        }

        let armed = { *android_wake_armed.lock().await };
        if !armed {
            warn!(
                "Skipping Android wake for {} because wake is not armed",
                address
            );
            return Err(crate::error::NocturnedError::General(anyhow::anyhow!(
                "Android wake not armed"
            )));
        }

        info!(
            "Waiting for Android app to wake via CompanionDeviceManager and connect back over SPP"
        );
        Ok(ConnectionOutcome::WaitingForAndroid)
    }

    async fn try_iap2_connection(
        address: Address,
        socket_addr: SocketAddr,
        connections: Arc<Mutex<Vec<Iap2Connection>>>,
        websocket_server: Option<Arc<WebSocketServer>>,
        audio_event_rx: broadcast::Receiver<AudioEvent>,
        audio_cmd_tx: mpsc::UnboundedSender<AudioCommand>,
        wakeword_pause_tx: mpsc::UnboundedSender<crate::wakeword::WakeWordCommand>,
    ) -> Result<()> {
        let stream = Stream::connect(socket_addr).await?;

        info!(
            "RFCOMM connected on channel 1, attempting iAP2 link negotiation for {}",
            address
        );

        let connection = Iap2Connection::new(
            address,
            stream,
            websocket_server.clone(),
            audio_event_rx,
            audio_cmd_tx,
            wakeword_pause_tx,
        )
        .await?;

        let conn_clone = connection.clone();
        let user_flag = conn_clone.user_disconnect_flag();
        let connections_clone = connections.clone();
        let ws_server_clone = websocket_server.clone();

        tokio::spawn(async move {
            match conn_clone.run().await {
                Err(e) => {
                    error!("iAP2 connection error for {}: {}", address, e);
                }
                Ok(()) => {
                    info!("iAP2 connection closed normally for {}", address);
                }
            }

            {
                let mut conns = connections_clone.lock().await;
                conns.retain(|c| c.address() != address);
            }

            if let Some(ws_server) = &ws_server_clone {
                ws_server.clear_app_ready().await;

                let user = *user_flag.lock().await;
                let mut payload = serde_json::json!({
                    "event": "connection_closed",
                    "device": address.to_string(),
                    "connection_type": "rfcomm"
                });
                if user {
                    if let Some(obj) = payload.as_object_mut() {
                        obj.insert("initiated_by".to_string(), serde_json::json!("user"));
                    }
                }
                ws_server
                    .broadcast_event("bluetooth.connection".to_string(), payload)
                    .await;
            }
        });

        let mut conns = connections.lock().await;
        conns.push(connection);

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
                    ws_server.clear_app_ready().await;
                    ws_server
                        .broadcast_event(
                            "bluetooth.connection".to_string(),
                            serde_json::json!({
                                "event": "connection_closed",
                                "device": address.to_string(),
                                "connection_type": "rfcomm",
                                "initiated_by": "user"
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
                            serde_json::json!({
                                "event": "unpaired",
                                "device": address.to_string()
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

        self.adapter.set_discoverable(false).await?;
        self.adapter.set_pairable(false).await?;

        info!("Bluetooth daemon cleaned up");
        Ok(())
    }
}
