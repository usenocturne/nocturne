use crate::websocket::WebSocketServer;
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use dbus::blocking::Connection;
use dbus_crossroads::{Crossroads, IfaceBuilder};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};

const AGENT_PATH: &str = "/org/nocturned/agent";

pub fn start_agent_thread(websocket_server: Option<Arc<WebSocketServer>>) -> anyhow::Result<()> {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<(String, serde_json::Value)>();

    if let Some(ws_server) = websocket_server.clone() {
        tokio::spawn(async move {
            while let Some((topic, data)) = event_rx.recv().await {
                ws_server.broadcast_event(topic, data).await;
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

fn run_agent(event_tx: mpsc::UnboundedSender<(String, serde_json::Value)>) -> anyhow::Result<()> {
    let conn = Connection::new_system()?;

    let mut cr = Crossroads::new();

    let event_tx_for_iface = event_tx.clone();
    let iface_token = cr.register("org.bluez.Agent1", move |b: &mut IfaceBuilder<_>| {
        let tx1 = event_tx_for_iface.clone();
        b.method("Release", (), (), move |_, _, ()| {
            info!("Agent Release called");
            let _ = tx1.send((
                "bluetooth.agent".to_string(),
                serde_json::json!({
                    "event": "release"
                }),
            ));
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
                let _ = tx2.send((
                    "bluetooth.agent".to_string(),
                    serde_json::json!({
                        "event": "request_pin_code",
                        "device": device,
                        "pincode": "0000"
                    }),
                ));
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

                    let _ = tx3.send((
                        "bluetooth.agent".to_string(),
                        serde_json::json!({
                            "address": address,
                            "name": name,
                            "pin": pincode,
                            "type": "bluetooth_pin"
                        }),
                    ));
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
                let _ = tx4.send((
                    "bluetooth.agent".to_string(),
                    serde_json::json!({
                        "event": "request_passkey",
                        "device": device,
                        "passkey": 0
                    }),
                ));
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

                    let _ = tx5.send((
                        "bluetooth.agent".to_string(),
                        serde_json::json!({
                            "address": address,
                            "name": name,
                            "pin": format!("{:06}", passkey),
                            "type": "bluetooth_pin",
                            "entered": entered
                        }),
                    ));
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

                    let _ = tx6.send((
                        "bluetooth.agent".to_string(),
                        serde_json::json!({
                            "address": address,
                            "name": name,
                            "pin": format!("{:06}", passkey),
                            "type": "bluetooth_pin"
                        }),
                    ));
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

                let _ = tx7.send((
                    "bluetooth.pairing".to_string(),
                    serde_json::json!({
                        "type": "pairing_succeeded",
                        "device": device.clone()
                    }),
                ));

                let _ = tx7.send((
                    "bluetooth.agent".to_string(),
                    serde_json::json!({
                        "event": "request_authorization",
                        "device": device,
                        "accepted": true
                    }),
                ));
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

                let _ = tx8.send((
                    "bluetooth.pairing".to_string(),
                    serde_json::json!({
                        "type": "pairing_succeeded",
                        "device": device.clone()
                    }),
                ));

                let _ = tx8.send((
                    "bluetooth.agent".to_string(),
                    serde_json::json!({
                        "event": "authorize_service",
                        "device": device,
                        "uuid": uuid,
                        "accepted": true
                    }),
                ));
                Ok(())
            },
        );

        let tx9 = event_tx_for_iface.clone();
        b.method("Cancel", (), (), move |_, _, ()| {
            info!("Agent Cancel");
            let _ = tx9.send((
                "bluetooth.agent".to_string(),
                serde_json::json!({
                    "event": "cancel"
                }),
            ));
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
