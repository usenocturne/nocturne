use crate::http::WebSocketServer;
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
use dbus::blocking::Connection;
use dbus_crossroads::{Crossroads, IfaceBuilder};
use libnocturne::generated::bluetooth::BluetoothAgentEvent;
use serde_json as json;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

const AGENT_PATH: &str = "/org/nocturned/agent";
const PAIRING_TIMEOUT: Duration = Duration::from_secs(60);
static PENDING: Mutex<Option<PendingPairing>> = Mutex::new(None);

struct PendingPairing {
    event: BluetoothAgentEvent,
    events: mpsc::UnboundedSender<BluetoothAgentEvent>,
}

fn agent_event(event: &str) -> BluetoothAgentEvent {
    BluetoothAgentEvent {
        event: Some(event.to_string()),
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
        request_id: None,
    }
}

fn device_event(event: &str, device: &str) -> BluetoothAgentEvent {
    let mut result = agent_event(event);
    result.device = Some(device.to_string());
    if let Ok(conn) = Connection::new_system() {
        let proxy = conn.with_proxy("org.bluez", device, Duration::from_secs(1));
        result.address = proxy.get("org.bluez.Device1", "Address").ok();
        result.name = proxy.get("org.bluez.Device1", "Alias").ok();
    }
    result
}

fn matching_code_required() -> dbus::MethodErr {
    (
        "org.bluez.Error.Rejected",
        "Matching-code Bluetooth pairing is required; PIN entry is unsupported",
    )
        .into()
}

fn clear_event(pending: &PendingPairing) {
    let mut event = agent_event("cancel");
    event.request_id.clone_from(&pending.event.request_id);
    event.device.clone_from(&pending.event.device);
    let _ = pending.events.send(event);
}

fn take_pending(request_id: &str) -> Option<PendingPairing> {
    PENDING.lock().ok().and_then(|mut pending| {
        if pending.as_ref().and_then(|p| p.event.request_id.as_deref()) == Some(request_id) {
            pending.take()
        } else {
            None
        }
    })
}

fn cancel_current() {
    if let Some(pending) = PENDING.lock().ok().and_then(|mut p| p.take()) {
        clear_event(&pending);
    }
}

pub fn pending_request() -> Option<BluetoothAgentEvent> {
    PENDING
        .lock()
        .ok()
        .and_then(|p| p.as_ref().map(|p| p.event.clone()))
}

fn matches_device(event: &BluetoothAgentEvent, address: &str) -> bool {
    event
        .address
        .as_ref()
        .is_some_and(|value| value.eq_ignore_ascii_case(address))
        || event
            .device
            .as_ref()
            .and_then(|path| path.rsplit_once("/dev_"))
            .is_some_and(|(_, value)| value.replace('_', ":").eq_ignore_ascii_case(address))
}

pub fn pairing_finished(address: &str) {
    let pending = PENDING.lock().ok().and_then(|mut pending| {
        if pending
            .as_ref()
            .is_some_and(|p| matches_device(&p.event, address))
        {
            pending.take()
        } else {
            None
        }
    });
    if let Some(pending) = pending {
        clear_event(&pending);
    }
}

fn comparison_event(device: &str, passkey: u32) -> Result<BluetoothAgentEvent, dbus::MethodErr> {
    if passkey > 999_999 {
        return Err(matching_code_required());
    }
    let mut event = device_event("request_confirmation", device);
    event.r#type = Some("bluetooth_pin".to_string());
    event.pin = Some(format!("{passkey:06}"));
    event.request_id = Some(Uuid::new_v4().to_string());
    Ok(event)
}

pub fn start_agent_thread(websocket_server: Option<Arc<WebSocketServer>>) -> anyhow::Result<()> {
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<BluetoothAgentEvent>();
    if let Some(ws_server) = websocket_server {
        tokio::spawn(async move {
            while let Some(event) = event_rx.recv().await {
                match json::to_value(event) {
                    Ok(value) => {
                        ws_server
                            .broadcast_event("bluetooth.agent".to_string(), value)
                            .await
                    }
                    Err(error) => warn!("Unable to serialize pairing event: {error}"),
                }
            }
        });
    }
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        if let Err(error) = run_agent(event_tx, runtime) {
            cancel_current();
            warn!("Bluetooth agent exited with error: {error}");
        }
    });
    Ok(())
}

fn run_agent(
    events: mpsc::UnboundedSender<BluetoothAgentEvent>,
    runtime: tokio::runtime::Handle,
) -> anyhow::Result<()> {
    let conn = Connection::new_system()?;
    let mut cr = Crossroads::new();
    let iface_token = cr.register("org.bluez.Agent1", move |b: &mut IfaceBuilder<_>| {
        for method in ["Release", "Cancel"] {
            b.method(method, (), (), move |_, _, ()| {
                cancel_current();
                Ok(())
            });
        }
        b.method(
            "RequestPinCode",
            ("device",),
            ("pincode",),
            move |_, _, (_device,): (dbus::Path<'_>,)| -> Result<(String,), dbus::MethodErr> {
                Err(matching_code_required())
            },
        );
        b.method(
            "RequestPasskey",
            ("device",),
            ("passkey",),
            move |_, _, (_device,): (dbus::Path<'_>,)| -> Result<(u32,), dbus::MethodErr> {
                Err(matching_code_required())
            },
        );
        b.method(
            "DisplayPinCode",
            ("device", "pincode"),
            (),
            move |_, _, (_device, _pin): (dbus::Path<'_>, String)| -> Result<(), dbus::MethodErr> {
                Err(matching_code_required())
            },
        );
        b.method(
            "DisplayPasskey",
            ("device", "passkey", "entered"),
            (),
            move |_,
                  _,
                  (_device, _passkey, _entered): (dbus::Path<'_>, u32, u16)|
                  -> Result<(), dbus::MethodErr> { Err(matching_code_required()) },
        );
        b.method(
            "RequestConfirmation",
            ("device", "passkey"),
            (),
            move |_, _, (device, passkey): (dbus::Path<'_>, u32)| {
                let event = comparison_event(&device, passkey)?;
                let id = event
                    .request_id
                    .clone()
                    .ok_or_else(matching_code_required)?;
                {
                    let mut pending = PENDING.lock().map_err(|_| matching_code_required())?;
                    if pending.is_some() {
                        return Err((
                            "org.bluez.Error.Rejected",
                            "Another pairing request is active",
                        )
                            .into());
                    }
                    *pending = Some(PendingPairing {
                        event: event.clone(),
                        events: events.clone(),
                    });
                    if events.send(event).is_err() {
                        *pending = None;
                        return Err(matching_code_required());
                    }
                }
                info!(
                    "Displaying Bluetooth comparison code for {device}; awaiting peer confirmation"
                );
                runtime.spawn(async move {
                    tokio::time::sleep(PAIRING_TIMEOUT).await;
                    if let Some(pending) = take_pending(&id) {
                        clear_event(&pending);
                    }
                });
                Ok(())
            },
        );
        b.method(
            "RequestAuthorization",
            ("device",),
            (),
            move |_, _, (device,): (dbus::Path<'_>,)| {
                info!("Bluetooth authorization requested for {device}");
                Ok(())
            },
        );
        b.method(
            "AuthorizeService",
            ("device", "uuid"),
            (),
            move |_, _, (device, uuid): (dbus::Path<'_>, String)| {
                info!("Bluetooth service authorization for {device}: {uuid}");
                Ok(())
            },
        );
    });
    let path = dbus::Path::new(AGENT_PATH).map_err(anyhow::Error::msg)?;
    cr.insert(path.clone(), &[iface_token], ());
    let proxy = conn.with_proxy("org.bluez", "/org/bluez", Duration::from_secs(10));
    let _: () = proxy.method_call(
        "org.bluez.AgentManager1",
        "RegisterAgent",
        (path.clone(), "DisplayYesNo"),
    )?;
    let _: () = proxy.method_call("org.bluez.AgentManager1", "RequestDefaultAgent", (path,))?;
    info!("Bluetooth pairing agent running (DisplayYesNo)");
    cr.serve(&conn)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn comparison_codes_preserve_leading_zeroes_and_get_unique_challenge_ids() {
        let first = comparison_event("/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF", 42).unwrap();
        let second = comparison_event("/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF", 42).unwrap();
        assert_eq!(first.pin.as_deref(), Some("000042"));
        assert_ne!(first.request_id, second.request_id);
        assert!(comparison_event("/device", 1_000_000).is_err());
    }
    #[test]
    fn completion_only_matches_the_challenged_device() {
        let mut event = agent_event("request_confirmation");
        event.device = Some("/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF".to_string());
        assert!(matches_device(&event, "aa:bb:cc:dd:ee:ff"));
        assert!(!matches_device(&event, "11:22:33:44:55:66"));
        event.address = Some("00:11:22:33:44:55".to_string());
        assert!(matches_device(&event, "00:11:22:33:44:55"));
    }
}
