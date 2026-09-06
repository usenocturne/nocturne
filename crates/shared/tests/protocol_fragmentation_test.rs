use libnocturne::{
    gateway::GatewayToNocturneMsg,
    protocol::{parse_nocturne_frame, EndecError, NocturneEndec},
};
use serde_json::json;
use tokio_util::{bytes::BytesMut, codec::Decoder};

fn frame(json_encoding: bool) -> Vec<u8> {
    let message: GatewayToNocturneMsg = serde_json::from_value(json!({
        "id": "00000000-0000-0000-0000-000000000001",
        "meta": {"kind": "event"},
        "data": {"type": "system", "data": {
            "event": "otaAbandon", "data": {"updateId": "fragmented-update"}
        }}
    }))
    .unwrap();
    let body = if json_encoding {
        serde_json::to_vec(&message).unwrap()
    } else {
        rmp_serde::to_vec_named(&message).unwrap()
    };
    let mut wire = vec![0xde, 0xad, 2, 0, u8::from(json_encoding), 0, 0, 0];
    wire.extend_from_slice(&(body.len() as u64).to_be_bytes());
    wire.extend(body);
    wire
}

#[test]
fn decodes_frames_at_every_transport_split() {
    for json_encoding in [false, true] {
        let wire = frame(json_encoding);
        let expected = parse_nocturne_frame(&mut wire.clone().into())
            .unwrap()
            .unwrap();
        for split in 1..wire.len() {
            let mut decoder = NocturneEndec::default();
            let mut buffer = BytesMut::from(&wire[..split]);
            assert!(decoder.decode(&mut buffer).unwrap().is_none());
            buffer.extend_from_slice(&wire[split..]);
            buffer.extend_from_slice(&wire);
            assert_eq!(decoder.decode(&mut buffer).unwrap().unwrap(), expected);
            assert_eq!(decoder.decode(&mut buffer).unwrap().unwrap(), expected);
            assert!(buffer.is_empty());
        }
    }
}

#[test]
fn retains_header_validation_after_a_partial_read() {
    let mut wire = frame(false);
    wire[0] = 0;
    let mut decoder = NocturneEndec::default();
    let mut buffer = BytesMut::from(&wire[..1]);
    assert!(decoder.decode(&mut buffer).unwrap().is_none());
    buffer.extend_from_slice(&wire[1..]);
    assert!(matches!(
        decoder.decode(&mut buffer),
        Err(EndecError::InvalidMagic)
    ));
}

#[test]
fn rejects_lengths_that_cannot_fit_a_frame() {
    let mut wire = frame(false);
    wire[8..16].copy_from_slice(&u64::MAX.to_be_bytes());
    assert!(matches!(
        parse_nocturne_frame(&mut wire.clone().into()),
        Err(EndecError::Io(_))
    ));
    assert!(matches!(
        NocturneEndec::default().decode(&mut wire.as_slice().into()),
        Err(EndecError::Io(_))
    ));
}

fn gzip_frame(payload: &[u8]) -> Vec<u8> {
    use std::io::Write;

    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    encoder.write_all(payload).unwrap();
    let compressed = encoder.finish().unwrap();
    let mut wire = vec![0xde, 0xad, 2, 1, 1, 0, 0, 0];
    wire.extend_from_slice(&(compressed.len() as u64).to_be_bytes());
    wire.extend(compressed);
    wire
}

#[test]
fn caps_compressed_expansion_and_advertised_payloads() {
    let limit = 16 * 1024 * 1024;
    let mut payload = frame(true).split_off(16);
    payload.resize(limit + 1, b' ');
    let wire = gzip_frame(&payload);
    assert!(matches!(
        parse_nocturne_frame(&mut wire.clone().into()),
        Err(EndecError::Io(_))
    ));
    assert!(matches!(
        NocturneEndec::default().decode(&mut wire.as_slice().into()),
        Err(EndecError::Io(_))
    ));

    let mut header = frame(false);
    header.truncate(16);
    header[8..16].copy_from_slice(&((limit + 1) as u64).to_be_bytes());
    assert!(matches!(
        parse_nocturne_frame(&mut header.clone().into()),
        Err(EndecError::Io(_))
    ));
    assert!(matches!(
        NocturneEndec::default().decode(&mut header.as_slice().into()),
        Err(EndecError::Io(_))
    ));
}

#[test]
fn accepts_gzip_at_the_limit_and_validates_its_checksum() {
    let normal = frame(true);
    let expected = parse_nocturne_frame(&mut normal.clone().into())
        .unwrap()
        .unwrap();
    let mut payload = normal[16..].to_vec();
    payload.resize(16 * 1024 * 1024, b' ');
    let wire = gzip_frame(&payload);
    assert_eq!(
        parse_nocturne_frame(&mut wire.clone().into())
            .unwrap()
            .unwrap(),
        expected
    );
    assert_eq!(
        NocturneEndec::default()
            .decode(&mut wire.as_slice().into())
            .unwrap()
            .unwrap(),
        expected
    );
    let mut corrupt = gzip_frame(&normal[16..]);
    let footer = corrupt.len() - 8;
    corrupt[footer] ^= 1;
    assert!(matches!(
        parse_nocturne_frame(&mut corrupt.into()),
        Err(EndecError::Io(_))
    ));
}
