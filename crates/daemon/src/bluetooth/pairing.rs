use crate::http::WebSocketServer;
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use dbus::blocking::Connection;
use dbus_crossroads::{Crossroads, IfaceBuilder};
use libnocturne::generated::bluetooth::{BluetoothAgentEvent, BluetoothPairingEvent};
use serde_json as json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};

const AGENT_PATH: &str = "/org/nocturned/agent";

enum AgentBroadcast {
    Agent(BluetoothAgentEvent),
    Pairing(BluetoothPairingEvent),
}

impl AgentBroadcast {
    fn topic(&self) -> &'static str {
        match self {
            Self::Agent(_) => "bluetooth.agent",
            Self::Pairing(_) => "bluetooth.pairing",
        }
    }

    fn into_data(self) -> json::Value {
        match self {
            Self::Agent(event) => json::to_value(event),
            Self::Pairing(event) => json::to_value(event),
        }
        .unwrap_or_else(|_| json::json!({}))
    }
}

pub fn start_agent_thread(websocket_server: Option<Arc<WebSocketServer>>) -> anyhow::Result<()> {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<AgentBroadcast>();

    if let Some(ws_server) = websocket_server.clone() {
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                ws_server
                    .broadcast_event(event.topic().to_string(), event.into_data())
                    .await;
            }
        });
    }

    std::thread::spawn(move || {
        if let Err(e) = run_agent(event_tx) {
            warn!("Bluetooth agent exited with error: {}", e);
        }
    });
    Ok(())
}

fn run_agent(event_tx: mpsc::UnboundedSender<AgentBroadcast>) -> anyhow::Result<()> {
    let conn = Connection::new_system()?;

    let mut cr = Crossroads::new();

    let event_tx_for_iface = event_tx.clone();
    let iface_token = cr.register("org.bluez.Agent1", move |b: &mut IfaceBuilder<_>| {
        let tx1 = event_tx_for_iface.clone();
        b.method("Release", (), (), move |_, _, ()| {
            info!("Agent Release called");
            let _ = tx1.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                event: Some("release".to_string()),
                device: None,
                address: None,
                name: None,
                pin: None,
                pincode: None,
                r#type: None,
                passkey: None,
                entered: None,
                uuid: None,
                accepted: None,
            }));
            Ok(())
        });

        let tx2 = event_tx_for_iface.clone();
        b.method(
            "RequestPinCode",
            ("device",),
            ("pincode",),
            move |_, _, (dev_path,): (dbus::Path<'_>,)| {
                let device = dev_path.to_string();
                info!("Agent RequestPinCode for device: {}", device);
                let _ = tx2.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                    event: Some("request_pin_code".to_string()),
                    device: Some(device),
                    address: None,
                    name: None,
                    pin: None,
                    pincode: Some("0000".to_string()),
                    r#type: None,
                    passkey: None,
                    entered: None,
                    uuid: None,
                    accepted: None,
                }));
                Ok((String::from("0000"),))
            },
        );

        let tx3 = event_tx_for_iface.clone();
        b.method(
            "DisplayPinCode",
            ("device", "pincode"),
            (),
            move |_, _, (dev_path, pincode): (dbus::Path<'_>, String)| {
                let device = dev_path.to_string();
                info!("Agent DisplayPinCode: {} for device: {}", pincode, device);

                if let Ok(conn) = Connection::new_system() {
                    let proxy = conn.with_proxy("org.bluez", &dev_path, Duration::from_secs(1));

                    let address: String = proxy
                        .get("org.bluez.Device1", "Address")
                        .unwrap_or_else(|_| "unknown".to_string());

                    let name: String =
                        proxy.get("org.bluez.Device1", "Name").unwrap_or_else(|_| {
                            proxy
                                .get("org.bluez.Device1", "Alias")
                                .unwrap_or_else(|_| "Unknown Device".to_string())
                        });

                    let _ = tx3.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                        event: None,
                        device: None,
                        address: Some(address),
                        name: Some(name),
                        pin: Some(pincode),
                        pincode: None,
                        r#type: Some("bluetooth_pin".to_string()),
                        passkey: None,
                        entered: None,
                        uuid: None,
                        accepted: None,
                    }));
                }
                Ok(())
            },
        );

        let tx4 = event_tx_for_iface.clone();
        b.method(
            "RequestPasskey",
            ("device",),
            ("passkey",),
            move |_, _, (dev_path,): (dbus::Path<'_>,)| {
                let device = dev_path.to_string();
                info!("Agent RequestPasskey for device: {}", device);
                let _ = tx4.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                    event: Some("request_passkey".to_string()),
                    device: Some(device),
                    address: None,
                    name: None,
                    pin: None,
                    pincode: None,
                    r#type: None,
                    passkey: Some(0),
                    entered: None,
                    uuid: None,
                    accepted: None,
                }));
                Ok((0u32,))
            },
        );

        let tx5 = event_tx_for_iface.clone();
        b.method(
            "DisplayPasskey",
            ("device", "passkey", "entered"),
            (),
            move |_, _, (dev_path, passkey, entered): (dbus::Path<'_>, u32, u16)| {
                let device = dev_path.to_string();
                info!(
                    "Agent DisplayPasskey: {} entered {} for device: {}",
                    passkey, entered, device
                );

                if let Ok(conn) = Connection::new_system() {
                    let proxy = conn.with_proxy("org.bluez", &dev_path, Duration::from_secs(1));

                    let address: String = proxy
                        .get("org.bluez.Device1", "Address")
                        .unwrap_or_else(|_| "unknown".to_string());

                    let name: String =
                        proxy.get("org.bluez.Device1", "Name").unwrap_or_else(|_| {
                            proxy
                                .get("org.bluez.Device1", "Alias")
                                .unwrap_or_else(|_| "Unknown Device".to_string())
                        });

                    let _ = tx5.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                        event: None,
                        device: None,
                        address: Some(address),
                        name: Some(name),
                        pin: Some(format!("{:06}", passkey)),
                        pincode: None,
                        r#type: Some("bluetooth_pin".to_string()),
                        passkey: None,
                        entered: Some(entered),
                        uuid: None,
                        accepted: None,
                    }));
                }
                Ok(())
            },
        );

        let tx6 = event_tx_for_iface.clone();
        b.method(
            "RequestConfirmation",
            ("device", "passkey"),
            (),
            move |_, _, (dev_path, passkey): (dbus::Path<'_>, u32)| {
                let device = dev_path.to_string();
                info!(
                    "Agent RequestConfirmation: {} (auto-accept) for device: {}",
                    passkey, device
                );

                if let Ok(conn) = Connection::new_system() {
                    let proxy = conn.with_proxy("org.bluez", &dev_path, Duration::from_secs(1));

                    let address: String = proxy
                        .get("org.bluez.Device1", "Address")
                        .unwrap_or_else(|_| "unknown".to_string());

                    let name: String =
                        proxy.get("org.bluez.Device1", "Name").unwrap_or_else(|_| {
                            proxy
                                .get("org.bluez.Device1", "Alias")
                                .unwrap_or_else(|_| "Unknown Device".to_string())
                        });

                    let _ = tx6.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                        event: None,
                        device: None,
                        address: Some(address),
                        name: Some(name),
                        pin: Some(format!("{:06}", passkey)),
                        pincode: None,
                        r#type: Some("bluetooth_pin".to_string()),
                        passkey: None,
                        entered: None,
                        uuid: None,
                        accepted: None,
                    }));
                }
                Ok(())
            },
        );

        let tx7 = event_tx_for_iface.clone();
        b.method(
            "RequestAuthorization",
            ("device",),
            (),
            move |_, _, (dev_path,): (dbus::Path<'_>,)| {
                let device = dev_path.to_string();
                info!(
                    "Agent RequestAuthorization (auto-accept) for device: {}",
                    device
                );

                let _ = tx7.send(AgentBroadcast::Pairing(BluetoothPairingEvent {
                    event: None,
                    r#type: Some("pairing_succeeded".to_string()),
                    device: device.clone(),
                }));

                let _ = tx7.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                    event: Some("request_authorization".to_string()),
                    device: Some(device),
                    address: None,
                    name: None,
                    pin: None,
                    pincode: None,
                    r#type: None,
                    passkey: None,
                    entered: None,
                    uuid: None,
                    accepted: Some(true),
                }));
                Ok(())
            },
        );

        let tx8 = event_tx_for_iface.clone();
        b.method(
            "AuthorizeService",
            ("device", "uuid"),
            (),
            move |_, _, (dev_path, uuid): (dbus::Path<'_>, String)| {
                let device = dev_path.to_string();
                info!(
                    "Agent AuthorizeService for {} (auto-accept) for device: {}",
                    uuid, device
                );

                let _ = tx8.send(AgentBroadcast::Pairing(BluetoothPairingEvent {
                    event: None,
                    r#type: Some("pairing_succeeded".to_string()),
                    device: device.clone(),
                }));

                let _ = tx8.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                    event: Some("authorize_service".to_string()),
                    device: Some(device),
                    address: None,
                    name: None,
                    pin: None,
                    pincode: None,
                    r#type: None,
                    passkey: None,
                    entered: None,
                    uuid: Some(uuid),
                    accepted: Some(true),
                }));
                Ok(())
            },
        );

        let tx9 = event_tx_for_iface.clone();
        b.method("Cancel", (), (), move |_, _, ()| {
            info!("Agent Cancel");
            let _ = tx9.send(AgentBroadcast::Agent(BluetoothAgentEvent {
                event: Some("cancel".to_string()),
                device: None,
                address: None,
                name: None,
                pin: None,
                pincode: None,
                r#type: None,
                passkey: None,
                entered: None,
                uuid: None,
                accepted: None,
            }));
            Ok(())
        });
    });

    cr.insert(dbus::Path::new(AGENT_PATH).unwrap(), &[iface_token], ());

    let proxy = conn.with_proxy("org.bluez", "/org/bluez", Duration::from_secs(10));
    let res: Result<(), dbus::Error> = proxy.method_call(
        "org.bluez.AgentManager1",
        "RegisterAgent",
        (dbus::Path::new(AGENT_PATH).unwrap(), "KeyboardDisplay"),
    );
    match res {
        Ok(()) => info!("Bluetooth agent registered (KeyboardDisplay)"),
        Err(e) => warn!("Failed to register agent: {}", e),
    }
    let res: Result<(), dbus::Error> = proxy.method_call(
        "org.bluez.AgentManager1",
        "RequestDefaultAgent",
        (dbus::Path::new(AGENT_PATH).unwrap(),),
    );
    match res {
        Ok(()) => info!("Bluetooth agent set as default"),
        Err(e) => warn!("Failed to set default agent: {}", e),
    }

    info!("Bluetooth pairing agent running");
    cr.serve(&conn)?;
    Ok(())
}
