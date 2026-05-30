use libnocturne::generated::media_control::*;
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
fn media_control_wire_snapshots_round_trip() {
    let raw = include_str!("media_control.json").trim_end();
    let snapshot: Value =
        serde_json::from_str(raw).expect("media_control snapshot JSON must parse");
    let canonical = serde_json::to_string(&snapshot)
        .expect("media_control snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "media_control snapshot must stay byte-stable canonical JSON"
    );

    assert_empty_request::<MediaControlNextRequest>(&snapshot, "media.control.next");
    assert_round_trip::<MediaControlNextResponse>(&snapshot, "media.control.next", "response");
    assert_empty_request::<MediaControlPauseRequest>(&snapshot, "media.control.pause");
    assert_round_trip::<MediaControlPauseResponse>(&snapshot, "media.control.pause", "response");
    assert_empty_request::<MediaControlPlayRequest>(&snapshot, "media.control.play");
    assert_round_trip::<MediaControlPlayResponse>(&snapshot, "media.control.play", "response");
    assert_empty_request::<MediaControlPreviousRequest>(&snapshot, "media.control.previous");
    assert_round_trip::<MediaControlPreviousResponse>(
        &snapshot,
        "media.control.previous",
        "response",
    );
    assert_empty_request::<MediaControlRepeatRequest>(&snapshot, "media.control.repeat");
    assert_round_trip::<MediaControlRepeatResponse>(&snapshot, "media.control.repeat", "response");
    assert_empty_request::<MediaControlShuffleRequest>(&snapshot, "media.control.shuffle");
    assert_round_trip::<MediaControlShuffleResponse>(
        &snapshot,
        "media.control.shuffle",
        "response",
    );
    assert_empty_request::<MediaControlVolumeDownRequest>(&snapshot, "media.control.volume_down");
    assert_round_trip::<MediaControlVolumeDownResponse>(
        &snapshot,
        "media.control.volume_down",
        "response",
    );
    assert_empty_request::<MediaControlVolumeUpRequest>(&snapshot, "media.control.volume_up");
    assert_round_trip::<MediaControlVolumeUpResponse>(
        &snapshot,
        "media.control.volume_up",
        "response",
    );

    assert_round_trip::<MediaNowPlayingArtworkEvent>(
        &snapshot,
        "media.now_playing.artwork",
        "event",
    );
    assert_round_trip::<MediaNowPlayingArtworkFailedEvent>(
        &snapshot,
        "media.now_playing.artwork.failed",
        "event",
    );
    assert_round_trip::<MediaNowPlayingUpdateEvent>(&snapshot, "media.now_playing.update", "event");
    assert_round_trip::<PhoneVolumeUpdateEvent>(&snapshot, "phone.volume.update", "event");
}
