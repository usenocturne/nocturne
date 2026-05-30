#![cfg(feature = "frame-tap")]

use std::time::Duration;

use bytes::BytesMut;
use iap2_rs::{
    ControlBits, FrameTap, FrameTapDirection, FrameTapEvent, Iap2Command, Iap2Event, Link,
    LinkCodec, LinkConfig, LinkPacket, Lsp, DETECT_MARKER,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio_util::codec::{Decoder, Encoder};

const SESSION_ID: u8 = 1;
const PEER_INITIAL_PSN: u8 = 50;

fn fast_link_config(our_lsp: Lsp) -> LinkConfig {
    let mut config = LinkConfig::new(our_lsp);
    config.detect_interval = Duration::from_millis(50);
    config.handshake_timeout = Duration::from_secs(5);
    config
}

async fn write_link(peer: &mut DuplexStream, codec: &mut LinkCodec, packet: LinkPacket) {
    let mut wire = BytesMut::new();
    codec.encode(packet, &mut wire).expect("link encode");
    peer.write_all(&wire).await.expect("write_all");
    peer.flush().await.expect("flush");
}

async fn read_link(
    peer: &mut DuplexStream,
    buf: &mut BytesMut,
    codec: &mut LinkCodec,
) -> LinkPacket {
    loop {
        if let Some(pkt) = codec.decode(buf).expect("link decode") {
            return pkt;
        }
        let n = peer.read_buf(buf).await.expect("read_buf");
        assert!(n > 0, "stream closed before a link packet decoded");
    }
}

fn accessory_lsp() -> Lsp {
    Lsp {
        version: 1,
        max_outgoing: 5,
        max_len: 2048,
        retransmission_timeout_ms: 6000,
        ack_timeout_ms: 3000,
        max_retransmissions: 30,
        max_ack: 3,
        sessions: vec![iap2_rs::SessionTriple {
            id: SESSION_ID,
            session_type: 0,
            version: 1,
        }],
    }
}

fn peer_lsp() -> Lsp {
    Lsp {
        version: 1,
        max_outgoing: 127,
        max_len: 65535,
        retransmission_timeout_ms: 6000,
        ack_timeout_ms: 3000,
        max_retransmissions: 30,
        max_ack: 3,
        sessions: vec![iap2_rs::SessionTriple {
            id: SESSION_ID,
            session_type: 0,
            version: 1,
        }],
    }
}

async fn spawn_tapped_link(
    tap: FrameTap,
) -> (
    tokio::io::DuplexStream,
    tokio::sync::mpsc::Sender<Iap2Command>,
    tokio::sync::mpsc::Receiver<Iap2Event>,
    tokio::task::JoinHandle<iap2_rs::Result<()>>,
    u8,
) {
    let (us, mut peer) = tokio::io::duplex(8192);
    let (events_tx, events_rx) = tokio::sync::mpsc::channel(16);
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::channel(16);
    let config = fast_link_config(accessory_lsp());
    let initial_psn = config.initial_psn;
    let handle = tokio::spawn(Link::run_with_frame_tap(us, config, events_tx, cmd_rx, tap));

    peer.write_all(&DETECT_MARKER).await.unwrap();
    let mut peer_codec = LinkCodec::new();
    let syn = LinkPacket::with_payload(
        ControlBits::SYN,
        PEER_INITIAL_PSN,
        0,
        0,
        peer_lsp().encode(),
    );
    write_link(&mut peer, &mut peer_codec, syn).await;
    let mut peer_buf = BytesMut::with_capacity(256);
    let _our_syn = read_link(&mut peer, &mut peer_buf, &mut peer_codec).await;
    let _our_ack = read_link(&mut peer, &mut peer_buf, &mut peer_codec).await;

    (peer, cmd_tx, events_rx, handle, initial_psn)
}

#[tokio::test(flavor = "current_thread")]
async fn taps_inbound_detect_and_syn_during_handshake() {
    let tap = FrameTap::default();
    let (_peer, _cmd_tx, mut events_rx, _handle, _initial_psn) =
        spawn_tapped_link(tap.clone()).await;

    let established = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(established, Iap2Event::Established(_)));

    let events = tap.snapshot();
    assert!(events.iter().any(|event| matches!(
        event,
        FrameTapEvent::Detect {
            direction: FrameTapDirection::Inbound,
            ..
        }
    )));
    assert!(events.iter().any(|event| matches!(event, FrameTapEvent::InboundFrame { parsed_header: Some(header), .. } if header.control.contains(ControlBits::SYN) && header.seq == PEER_INITIAL_PSN)));
}

#[tokio::test(flavor = "current_thread")]
async fn taps_outbound_frames_and_subscribers_preserve_order() {
    let tap = FrameTap::default();
    let mut rx = tap.subscribe();
    let (mut peer, cmd_tx, mut events_rx, _handle, initial_psn) = spawn_tapped_link(tap).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .unwrap();

    cmd_tx
        .send(Iap2Command::Send {
            session_id: SESSION_ID,
            payload: b"hello"[..].into(),
        })
        .await
        .unwrap();

    let mut peer_buf = BytesMut::new();
    let mut peer_codec = LinkCodec::new();
    let _sent = read_link(&mut peer, &mut peer_buf, &mut peer_codec).await;

    let mut outbound_headers = Vec::new();
    while outbound_headers.len() < 3 {
        let event = tokio::time::timeout(Duration::from_secs(2), rx.recv())
            .await
            .unwrap()
            .unwrap();
        if let FrameTapEvent::OutboundFrame {
            parsed_header: Some(header),
            ..
        } = event
        {
            outbound_headers.push(header);
        }
    }

    assert!(outbound_headers[0].control.contains(ControlBits::SYN));
    assert!(outbound_headers[1].control.contains(ControlBits::ACK));
    assert_eq!(outbound_headers[2].seq, initial_psn.wrapping_add(1));
    assert_eq!(outbound_headers[2].session_id, SESSION_ID);
}

#[test]
fn taps_parse_errors_and_ring_buffer_drains() {
    let tap = FrameTap::new(2);
    let mut rx = tap.subscribe();
    let mut codec = LinkCodec::with_frame_tap(tap.clone());
    let mut buf = BytesMut::from(&[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A][..]);

    assert!(codec.decode(&mut buf).unwrap().is_none());

    let snapshot = tap.snapshot();
    assert_eq!(snapshot.len(), 2);
    assert!(snapshot
        .iter()
        .all(|event| matches!(event, FrameTapEvent::ParseError { .. })));

    let first = rx.try_recv().unwrap();
    let second = rx.try_recv().unwrap();
    assert!(matches!(first, FrameTapEvent::ParseError { .. }));
    assert!(matches!(second, FrameTapEvent::ParseError { .. }));

    assert_eq!(tap.drain().len(), 2);
    assert!(tap.snapshot().is_empty());
}

#[test]
fn standalone_codec_taps_successful_inbound_frame() {
    let tap = FrameTap::default();
    let mut writer = LinkCodec::new();
    let mut wire = BytesMut::new();
    tokio_util::codec::Encoder::encode(
        &mut writer,
        LinkPacket::header_only(ControlBits::ACK, 7, 8),
        &mut wire,
    )
    .unwrap();

    let mut codec = LinkCodec::with_frame_tap(tap.clone());
    assert!(codec.decode(&mut wire).unwrap().is_some());

    assert!(tap.snapshot().iter().any(|event| matches!(event, FrameTapEvent::InboundFrame { parsed_header: Some(header), .. } if header.seq == 7 && header.ack == 8)));
}
