use libnocturne::generated::bt_only::*;
use libnocturne::generated::device::{
    AppReadyEvent, NetworkStatusEvent, NotificationShowEvent, SubscriptionUpdatedEvent,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};

fn payload<'a>(snapshot: &'a Value, key: &str) -> &'a Value {
    snapshot
        .get(key)
        .and_then(|entry| entry.get("event"))
        .unwrap_or_else(|| panic!("missing {key}.event"))
}

fn assert_round_trip<T>(snapshot: &Value, key: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key).clone();
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.event failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.event failed to serialize: {error}"));
    assert_eq!(encoded, source, "{key}.event changed during round-trip");
}

fn assert_empty_event<T>(snapshot: &Value, key: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key);
    assert_eq!(
        source,
        &json!(null),
        "{key}.event must stay generated-unit null"
    );
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.event failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.event failed to serialize: {error}"));
    assert_eq!(encoded, *source, "{key}.event changed during round-trip");
}

#[test]
fn bt_only_wire_snapshots_round_trip() {
    let raw = include_str!("bt_only.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("bt_only snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("bt_only snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "bt_only snapshot must stay byte-stable canonical JSON"
    );

    assert_empty_event::<DaemonReadyEvent>(&snapshot, "daemon.ready");
    assert_round_trip::<DaemonHeartbeatEvent>(&snapshot, "daemon.heartbeat");
    assert_round_trip::<ChunkRetransmitRequestEvent>(&snapshot, "chunk.retransmit_request");
    assert_round_trip::<AppReadyEvent>(&snapshot, "app.ready");
    assert_round_trip::<SubscriptionUpdatedEvent>(&snapshot, "subscription.updated");
    assert_round_trip::<NetworkStatusEvent>(&snapshot, "network.status");
    assert_round_trip::<NotificationShowEvent>(&snapshot, "notification.show");
    assert_round_trip::<AudioRecordingStartedEvent>(&snapshot, "audio.recording.started");
    assert_round_trip::<AudioDataEvent>(&snapshot, "audio.data");
    assert_round_trip::<AudioRecordingStoppedEvent>(&snapshot, "audio.recording.stopped");
    assert_round_trip::<KeepaliveEvent>(&snapshot, "keepalive");
}
