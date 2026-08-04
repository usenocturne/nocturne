use libnocturne::generated::audio::*;
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
fn audio_wire_snapshots_round_trip() {
    let raw = include_str!("audio.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("audio snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("audio snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "audio snapshot must stay byte-stable canonical JSON"
    );

    assert_round_trip::<AudioLevelEvent>(&snapshot, "audio.level", "event");
    assert_round_trip::<WindLevelEvent>(&snapshot, "wind_level", "event");
    assert_empty_request::<AudioRecordStartRequest>(&snapshot, "audio.record.start");
    assert_round_trip::<AudioRecordStartResponse>(&snapshot, "audio.record.start", "response");
    assert_empty_request::<AudioRecordStopRequest>(&snapshot, "audio.record.stop");
    assert_round_trip::<AudioRecordStopResponse>(&snapshot, "audio.record.stop", "response");
}
