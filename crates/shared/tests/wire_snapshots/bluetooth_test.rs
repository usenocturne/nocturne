use libnocturne::generated::bluetooth::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn payload<'a>(snapshot: &'a Value, key: &str, kind: &str) -> &'a Value {
    snapshot
        .get(key)
        .and_then(|entry| entry.get(kind))
        .unwrap_or_else(|| panic!("missing {key}.{kind}"))
}

fn typed_value<T>(value: T) -> Value
where
    T: Serialize,
{
    serde_json::to_value(value).expect("typed bluetooth fixture must serialize")
}

fn assert_round_trip<T>(snapshot: &Value, key: &str, kind: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key, kind).clone();
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to serialize: {error}"));
    assert_eq!(encoded, source, "{key}.{kind} changed during round-trip");
}

fn assert_empty_request<T>(snapshot: &Value, key: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key, "request");
    assert_eq!(
        source,
        &json!(null),
        "{key}.request must stay generated-unit null"
    );
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.request failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.request failed to serialize: {error}"));
    assert_eq!(encoded, *source, "{key}.request changed during round-trip");
}

#[test]
fn bluetooth_wire_snapshots_round_trip() {
    let raw = include_str!("bluetooth.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("bluetooth snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("bluetooth snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "bluetooth snapshot must stay byte-stable canonical JSON"
    );

    let typed_snapshot = json!({
        "bluetooth.agent": {
            "event": typed_value(BluetoothAgentEvent {
                event: Some("authorize_service".to_string()),
                device: Some("/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF".to_string()),
                address: Some("AA:BB:CC:DD:EE:FF".to_string()),
                name: Some("Nocturne Phone".to_string()),
                pin: Some("123456".to_string()),
                pincode: Some("0000".to_string()),
                r#type: Some("bluetooth_pin".to_string()),
                passkey: Some(123456),
                entered: Some(3),
                uuid: Some("00001101-0000-1000-8000-00805f9b34fb".to_string()),
                accepted: Some(true),
            }),
        },
        "bluetooth.connection": {
            "event": typed_value(BluetoothConnectionEvent {
                event: "connection_established".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
                connection_type: Some("iap2".to_string()),
                device_type: Some("iphone".to_string()),
                channel: Some(1),
                initiated_by: Some("daemon".to_string()),
            }),
        },
        "bluetooth.device": {
            "event": typed_value(BluetoothDeviceEvent {
                event: "connected".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
        },
        "bluetooth.device.connect": {
            "request": typed_value(BluetoothDeviceConnectRequest {
                address: "AA:BB:CC:DD:EE:FF".to_string(),
                channel: Some(3),
                device_type: Some("macos_connector".to_string()),
            }),
            "response": typed_value(BluetoothDeviceConnectResponse {
                status: "connected".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
        },
        "bluetooth.device.disconnect": {
            "request": typed_value(BluetoothDeviceDisconnectRequest {
                address: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
            "response": typed_value(BluetoothDeviceDisconnectResponse {
                status: "disconnected".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
        },
        "bluetooth.device.unpair": {
            "request": typed_value(BluetoothDeviceUnpairRequest {
                address: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
            "response": typed_value(BluetoothDeviceUnpairResponse {
                status: "unpaired".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
        },
        "bluetooth.devices.list": {
            "request": typed_value(BluetoothDevicesListRequest),
            "response": typed_value(BluetoothDevicesListResponse {
                payload: vec![json!({
                    "address": "AA:BB:CC:DD:EE:FF",
                    "blocked": false,
                    "connected": true,
                    "default": true,
                    "device_info": { "name": "Nocturne Phone" },
                })],
                r#type: "bluetooth_device_list".to_string(),
            }),
        },
        "bluetooth.discoverable": {
            "event": typed_value(BluetoothDiscoverableEvent { discoverable: true }),
            "request": typed_value(BluetoothDiscoverableRequest { discoverable: true }),
            "response": typed_value(BluetoothDiscoverableResponse {
                discoverable: true,
                status: "requested".to_string(),
            }),
        },
        "bluetooth.mfi": {
            "event": typed_value(BluetoothMfiEvent {
                event: "authentication_failed".to_string(),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
                reason: Some("challenge_rejected".to_string()),
            }),
        },
        "bluetooth.pairing": {
            "event": typed_value(BluetoothPairingEvent {
                event: Some("paired".to_string()),
                r#type: Some("pairing_succeeded".to_string()),
                device: "AA:BB:CC:DD:EE:FF".to_string(),
            }),
        },
    });
    assert_eq!(
        snapshot, typed_snapshot,
        "snapshot must be generated-type equivalent"
    );

    assert_round_trip::<BluetoothAgentEvent>(&snapshot, "bluetooth.agent", "event");
    assert_round_trip::<BluetoothPairingEvent>(&snapshot, "bluetooth.pairing", "event");
    assert_round_trip::<BluetoothConnectionEvent>(&snapshot, "bluetooth.connection", "event");
    assert_round_trip::<BluetoothDeviceEvent>(&snapshot, "bluetooth.device", "event");
    assert_round_trip::<BluetoothDiscoverableEvent>(&snapshot, "bluetooth.discoverable", "event");
    assert_round_trip::<BluetoothMfiEvent>(&snapshot, "bluetooth.mfi", "event");

    assert_empty_request::<BluetoothDevicesListRequest>(&snapshot, "bluetooth.devices.list");
    assert_round_trip::<BluetoothDevicesListResponse>(
        &snapshot,
        "bluetooth.devices.list",
        "response",
    );
    assert_round_trip::<BluetoothDeviceConnectRequest>(
        &snapshot,
        "bluetooth.device.connect",
        "request",
    );
    assert_round_trip::<BluetoothDeviceConnectResponse>(
        &snapshot,
        "bluetooth.device.connect",
        "response",
    );
    assert_round_trip::<BluetoothDeviceDisconnectRequest>(
        &snapshot,
        "bluetooth.device.disconnect",
        "request",
    );
    assert_round_trip::<BluetoothDeviceDisconnectResponse>(
        &snapshot,
        "bluetooth.device.disconnect",
        "response",
    );
    assert_round_trip::<BluetoothDeviceUnpairRequest>(
        &snapshot,
        "bluetooth.device.unpair",
        "request",
    );
    assert_round_trip::<BluetoothDeviceUnpairResponse>(
        &snapshot,
        "bluetooth.device.unpair",
        "response",
    );
    assert_round_trip::<BluetoothDiscoverableRequest>(
        &snapshot,
        "bluetooth.discoverable",
        "request",
    );
    assert_round_trip::<BluetoothDiscoverableResponse>(
        &snapshot,
        "bluetooth.discoverable",
        "response",
    );
}
