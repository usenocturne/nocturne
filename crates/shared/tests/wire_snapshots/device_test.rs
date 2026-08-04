use libnocturne::generated::device::*;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn payload<'a>(snapshot: &'a Value, key: &str, kind: &str) -> &'a Value {
    snapshot
        .get(key)
        .and_then(|entry| entry.get(kind))
        .unwrap_or_else(|| panic!("missing {key}.{kind}"))
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
fn device_wire_snapshots_round_trip() {
    let raw = include_str!("device.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("device snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("device snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "device snapshot must stay byte-stable canonical JSON"
    );

    assert_round_trip::<AmbientLightUpdateEvent>(&snapshot, "ambient_light_update", "event");
    assert_round_trip::<AppReadyEvent>(&snapshot, "app.ready", "event");
    assert_round_trip::<NetworkStatusEvent>(&snapshot, "network.status", "event");
    assert_round_trip::<NotificationRemoveEvent>(&snapshot, "notification.remove", "event");
    assert_round_trip::<NotificationShowEvent>(&snapshot, "notification.show", "event");
    assert_round_trip::<SubscriptionUpdatedEvent>(&snapshot, "subscription.updated", "event");

    assert_empty_request::<DeviceAbFailoverRequest>(&snapshot, "device.ab.failover");
    assert_round_trip::<DeviceAbFailoverResponse>(&snapshot, "device.ab.failover", "response");
    assert_empty_request::<DeviceAbGetRequest>(&snapshot, "device.ab.get");
    assert_round_trip::<DeviceAbGetResponse>(&snapshot, "device.ab.get", "response");
    assert_empty_request::<DeviceAbResetRequest>(&snapshot, "device.ab.reset");
    assert_round_trip::<DeviceAbResetResponse>(&snapshot, "device.ab.reset", "response");
    assert_round_trip::<DeviceAbSetBootResultRequest>(
        &snapshot,
        "device.ab.set_boot_result",
        "request",
    );
    assert_round_trip::<DeviceAbSetBootResultResponse>(
        &snapshot,
        "device.ab.set_boot_result",
        "response",
    );
    assert_round_trip::<DeviceAbSetSlotRequest>(&snapshot, "device.ab.set_slot", "request");
    assert_round_trip::<DeviceAbSetSlotResponse>(&snapshot, "device.ab.set_slot", "response");

    assert_round_trip::<DeviceBrightnessAutoRequest>(
        &snapshot,
        "device.brightness.auto",
        "request",
    );
    assert_round_trip::<DeviceBrightnessAutoResponse>(
        &snapshot,
        "device.brightness.auto",
        "response",
    );
    assert_empty_request::<DeviceBrightnessGetRequest>(&snapshot, "device.brightness.get");
    assert_round_trip::<DeviceBrightnessGetResponse>(
        &snapshot,
        "device.brightness.get",
        "response",
    );
    assert_round_trip::<DeviceBrightnessSetRequest>(&snapshot, "device.brightness.set", "request");
    assert_round_trip::<DeviceBrightnessSetResponse>(
        &snapshot,
        "device.brightness.set",
        "response",
    );

    assert_empty_request::<DeviceDisplayGetRequest>(&snapshot, "device.display.get");
    assert_round_trip::<DeviceDisplayGetResponse>(&snapshot, "device.display.get", "response");
    assert_empty_request::<DeviceDisplaySleepRequest>(&snapshot, "device.display.sleep");
    assert_round_trip::<DeviceDisplaySleepResponse>(&snapshot, "device.display.sleep", "response");
    assert_empty_request::<DeviceDisplayWakeRequest>(&snapshot, "device.display.wake");
    assert_round_trip::<DeviceDisplayWakeResponse>(&snapshot, "device.display.wake", "response");

    assert_empty_request::<DeviceFactoryResetRequest>(&snapshot, "device.factory_reset");
    assert_round_trip::<DeviceFactoryResetResponse>(&snapshot, "device.factory_reset", "response");
    assert_empty_request::<DeviceInfoRequest>(&snapshot, "device.info");
    assert_round_trip::<DeviceInfoResponse>(&snapshot, "device.info", "response");
    assert_round_trip::<DeviceLaunchAppRequest>(&snapshot, "device.launch_app", "request");
    assert_round_trip::<DeviceLaunchAppResponse>(&snapshot, "device.launch_app", "response");
    assert_empty_request::<DevicePowerOffRequest>(&snapshot, "device.power.off");
    assert_round_trip::<DevicePowerOffResponse>(&snapshot, "device.power.off", "response");
    assert_empty_request::<DevicePowerRebootRequest>(&snapshot, "device.power.reboot");
    assert_round_trip::<DevicePowerRebootResponse>(&snapshot, "device.power.reboot", "response");
    assert_empty_request::<DevicePowerShutdownRequest>(&snapshot, "device.power.shutdown");
    assert_round_trip::<DevicePowerShutdownResponse>(
        &snapshot,
        "device.power.shutdown",
        "response",
    );
    assert_empty_request::<DeviceTimeGetRequest>(&snapshot, "device.time.get");
    assert_round_trip::<DeviceTimeGetResponse>(&snapshot, "device.time.get", "response");
    assert_empty_request::<DeviceTimezoneGetRequest>(&snapshot, "device.timezone.get");
    assert_round_trip::<DeviceTimezoneGetResponse>(&snapshot, "device.timezone.get", "response");
    assert_empty_request::<DeviceVersionRequest>(&snapshot, "device.version");
    assert_round_trip::<DeviceVersionResponse>(&snapshot, "device.version", "response");
    assert_empty_request::<ResetBootCounterRequest>(&snapshot, "reset_boot_counter");
    assert_round_trip::<ResetBootCounterResponse>(&snapshot, "reset_boot_counter", "response");
}
