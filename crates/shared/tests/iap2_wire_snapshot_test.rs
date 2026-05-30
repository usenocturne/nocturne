//! W-track iAP2 wire snapshot test.
//!
//! For each entry in iap2.json:
//! 1. JSON deserialize into the generated CSM struct
//! 2. CSM-encode to raw bytes
//! 3. Compare raw bytes to wire_hex (must match exactly)
//! 4. CSM-decode raw bytes back into struct
//! 5. JSON serialize and compare to original JSON (must match)
//!
//! Round-trip stability is the gate. Any wire-format drift fails this test.

use std::fmt::Debug;

use bytes::BytesMut;
use iap2_rs::csm::{
    generated, identification::IdentificationRejected, CsmCodec, CsmDecodeError, CsmFrame,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use tokio_util::codec::{Decoder, Encoder};

fn entry<'a>(snapshot: &'a Value, key: &str) -> (&'a Value, &'a str) {
    let entry = snapshot
        .get(key)
        .unwrap_or_else(|| panic!("missing iAP2 snapshot entry {key}"));
    let json = entry
        .get("json")
        .unwrap_or_else(|| panic!("missing {key}.json"));
    let wire_hex = entry
        .get("wire_hex")
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing {key}.wire_hex"));
    (json, wire_hex)
}

fn encode<T>(typed: T) -> BytesMut
where
    T: Into<CsmFrame>,
{
    let mut buf = BytesMut::new();
    CsmCodec
        .encode(typed.into(), &mut buf)
        .expect("CSM fixture must encode");
    buf
}

fn assert_snapshot<T>(snapshot: &Value, key: &str)
where
    T: DeserializeOwned
        + Serialize
        + Clone
        + Debug
        + PartialEq
        + Into<CsmFrame>
        + TryFrom<CsmFrame, Error = CsmDecodeError>,
{
    let (source, expected_wire_hex) = entry(snapshot, key);
    let typed: T = serde_json::from_value(source.clone())
        .unwrap_or_else(|error| panic!("{key}.json failed to deserialize: {error}"));

    let encoded = encode(typed.clone());
    assert_eq!(
        hex::encode(&encoded),
        expected_wire_hex,
        "{key}.wire_hex changed"
    );

    let mut decode_buf = encoded.clone();
    let frame = CsmCodec
        .decode(&mut decode_buf)
        .unwrap_or_else(|error| panic!("{key}.wire_hex failed to CSM-decode: {error}"))
        .unwrap_or_else(|| panic!("{key}.wire_hex did not contain a complete CSM"));
    let decoded: T = frame
        .try_into()
        .unwrap_or_else(|error| panic!("{key}.wire_hex failed to type-decode: {error}"));
    let round_tripped = serde_json::to_value(decoded)
        .unwrap_or_else(|error| panic!("{key}.json failed to serialize: {error}"));
    assert_eq!(
        round_tripped, *source,
        "{key}.json changed during round-trip"
    );
    assert_eq!(typed, serde_json::from_value(round_tripped).unwrap());
}

#[test]
fn iap2_wire_snapshots_round_trip() {
    let raw = include_str!("wire_snapshots/iap2.json").trim_end();
    let snapshot: Value = serde_json::from_str(raw).expect("iAP2 snapshot JSON must parse");
    let canonical =
        serde_json::to_string(&snapshot).expect("iAP2 snapshot must serialize canonically");
    assert_eq!(
        canonical, raw,
        "iAP2 snapshot must stay byte-stable canonical JSON"
    );

    assert_snapshot::<generated::AuthenticationCertificate>(&snapshot, "AuthenticationCertificate");
    assert_snapshot::<generated::AuthenticationFailed>(&snapshot, "AuthenticationFailed");
    assert_snapshot::<generated::AuthenticationResponse>(&snapshot, "AuthenticationResponse");
    assert_snapshot::<generated::AuthenticationSucceeded>(&snapshot, "AuthenticationSucceeded");
    assert_snapshot::<generated::DeviceInformationUpdate>(&snapshot, "DeviceInformationUpdate");
    assert_snapshot::<generated::DeviceLanguageUpdate>(&snapshot, "DeviceLanguageUpdate");
    assert_snapshot::<generated::DeviceTimeUpdate>(&snapshot, "DeviceTimeUpdate");
    assert_snapshot::<generated::DeviceUUIDUpdate>(&snapshot, "DeviceUUIDUpdate");
    assert_snapshot::<generated::IdentificationAccepted>(&snapshot, "IdentificationAccepted");
    assert_snapshot::<IdentificationRejected>(&snapshot, "IdentificationRejected");
    assert_snapshot::<generated::RequestAuthenticationCertificate>(
        &snapshot,
        "RequestAuthenticationCertificate",
    );
    assert_snapshot::<generated::RequestAuthenticationChallengeResponse>(
        &snapshot,
        "RequestAuthenticationChallengeResponse",
    );
    assert_snapshot::<generated::StartIdentification>(&snapshot, "StartIdentification");
}
