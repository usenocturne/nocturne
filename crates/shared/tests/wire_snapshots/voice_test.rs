use libnocturne::generated::device::{OnboardingSetStateRequest, OnboardingSetStateResponse};
use libnocturne::generated::voice::*;
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

fn assert_empty_payload<T>(snapshot: &Value, key: &str, kind: &str)
where
    T: DeserializeOwned + Serialize,
{
    let source = payload(snapshot, key, kind);
    assert_eq!(
        source,
        &json!(null),
        "{key}.{kind} must stay generated-unit null"
    );
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to deserialize: {error}"));
    let encoded = serde_json::to_value(typed)
        .unwrap_or_else(|error| panic!("{key}.{kind} failed to serialize: {error}"));
    assert_eq!(encoded, *source, "{key}.{kind} changed during round-trip");
}

#[test]
fn voice_wire_snapshots_round_trip() {
    let raw = include_str!("voice.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("voice snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("voice snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "voice snapshot must stay byte-stable canonical JSON"
    );

    assert_empty_payload::<WakewordPauseRequest>(&snapshot, "wakeword.pause", "request");
    assert_round_trip::<WakewordPauseResponse>(&snapshot, "wakeword.pause", "response");
    assert_empty_payload::<WakewordResumeRequest>(&snapshot, "wakeword.resume", "request");
    assert_round_trip::<WakewordResumeResponse>(&snapshot, "wakeword.resume", "response");
    assert_round_trip::<TtsSpeakRequest>(&snapshot, "tts.speak", "request");
    assert_empty_payload::<TtsSpeakResponse>(&snapshot, "tts.speak", "response");
    assert_empty_payload::<TtsStopRequest>(&snapshot, "tts.stop", "request");
    assert_empty_payload::<TtsStopResponse>(&snapshot, "tts.stop", "response");
    assert_empty_payload::<VoiceCancelRequest>(&snapshot, "voice.cancel", "request");
    assert_empty_payload::<VoiceCancelResponse>(&snapshot, "voice.cancel", "response");
    assert_round_trip::<OnboardingSetStateRequest>(&snapshot, "onboarding.set_state", "request");
    assert_empty_payload::<OnboardingSetStateResponse>(
        &snapshot,
        "onboarding.set_state",
        "response",
    );

    assert_round_trip::<VoiceWakewordEvent>(&snapshot, "voice.wakeword", "event");
    assert_round_trip::<VoiceWakewordStateEvent>(&snapshot, "voice.wakeword.state", "event");
    assert_round_trip::<VoiceTranscriptionEvent>(&snapshot, "voice.transcription", "event");
    assert_round_trip::<AiStateEvent>(&snapshot, "ai.state", "event");
    assert_round_trip::<AiResponseEvent>(&snapshot, "ai.response", "event");
    assert_round_trip::<AiToolExecutedEvent>(&snapshot, "ai.tool_executed", "event");
}
