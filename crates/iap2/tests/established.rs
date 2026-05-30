//! Integration tests for the iAP2 link's Established phase: DATA send +
//! recv, ACK piggyback, retransmit, EAK, window backpressure, ack-delay.
//! Drives a hand-rolled fake peer over `tokio::io::duplex` with short
//! timing values so retransmit + ack-delay fire within a few hundred ms.

mod common;

use std::time::Duration;

use bytes::{Bytes, BytesMut};
use common::{
    drive_peer_handshake, fast_link_config, read_link, recv_with_timeout, spawn_link, write_link,
    LspBuilder, PEER_INITIAL_PSN,
};
use iap2_rs::{ControlBits, Error, Iap2Command, Iap2Event, LinkCodec, LinkPacket, LINK_HEADER_LEN};
use tokio::{io::DuplexStream, sync::mpsc, task::JoinHandle};

const SESSION_ID: u8 = 1;

fn accessory_lsp() -> iap2_rs::Lsp {
    LspBuilder {
        session_ids: vec![SESSION_ID],
        ..LspBuilder::default()
    }
    .build()
}

#[derive(Debug, Clone)]
struct PeerProposal {
    max_outgoing: u8,
    max_len: u16,
    retransmission_timeout_ms: u16,
    ack_timeout_ms: u16,
    max_retransmissions: u8,
    max_ack: u8,
}

impl Default for PeerProposal {
    fn default() -> Self {
        Self {
            max_outgoing: 5,
            max_len: 2048,
            retransmission_timeout_ms: 6000,
            ack_timeout_ms: 3000,
            max_retransmissions: 30,
            max_ack: 3,
        }
    }
}

impl PeerProposal {
    fn into_lsp(self) -> iap2_rs::Lsp {
        LspBuilder {
            max_outgoing: self.max_outgoing,
            max_len: self.max_len,
            retransmission_timeout_ms: self.retransmission_timeout_ms,
            ack_timeout_ms: self.ack_timeout_ms,
            max_retransmissions: self.max_retransmissions,
            max_ack: self.max_ack,
            session_ids: vec![SESSION_ID],
        }
        .build()
    }
}

struct Established {
    events_rx: mpsc::Receiver<Iap2Event>,
    cmd_tx: mpsc::Sender<Iap2Command>,
    peer: DuplexStream,
    peer_buf: BytesMut,
    peer_codec: LinkCodec,
    link: JoinHandle<iap2_rs::Result<()>>,
    our_initial_psn: u8,
}

async fn establish(peer: PeerProposal) -> Established {
    let (mut peer_stream, cmd_tx, mut events_rx, link) =
        spawn_link(fast_link_config(accessory_lsp()));
    let (peer_buf, peer_codec, our_initial_psn) =
        drive_peer_handshake(&mut peer_stream, peer.into_lsp()).await;

    let event = recv_with_timeout(&mut events_rx, Duration::from_secs(2))
        .await
        .expect("Established");
    assert!(matches!(event, Iap2Event::Established(_)));

    Established {
        events_rx,
        cmd_tx,
        peer: peer_stream,
        peer_buf,
        peer_codec,
        link,
        our_initial_psn,
    }
}

#[tokio::test(flavor = "current_thread")]
async fn send_command_data_round_trips_to_peer() {
    let mut e = establish(PeerProposal::default()).await;
    let our_psn = e.our_initial_psn;

    e.cmd_tx
        .send(Iap2Command::Send {
            session_id: SESSION_ID,
            payload: Bytes::from_static(b"hello"),
        })
        .await
        .unwrap();

    let pkt = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert!(pkt.header.control.contains(ControlBits::ACK));
    assert!(!pkt.header.control.contains(ControlBits::SYN));
    assert_eq!(pkt.header.seq, our_psn.wrapping_add(1));
    assert_eq!(pkt.header.ack, PEER_INITIAL_PSN);
    assert_eq!(pkt.header.session_id, SESSION_ID);
    assert_eq!(pkt.payload.as_ref(), b"hello");
}

#[tokio::test(flavor = "current_thread")]
async fn large_payload_fragments_into_chunks() {
    let mut e = establish(PeerProposal {
        max_len: 60,
        ..PeerProposal::default()
    })
    .await;
    let our_psn = e.our_initial_psn;

    let total = Bytes::from(vec![0xAB; 50 + 50 + 5]);
    e.cmd_tx
        .send(Iap2Command::Send {
            session_id: SESSION_ID,
            payload: total,
        })
        .await
        .unwrap();

    let p1 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let p2 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let p3 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;

    assert_eq!(p1.payload.len(), 50);
    assert_eq!(p2.payload.len(), 50);
    assert_eq!(p3.payload.len(), 5);
    assert_eq!(p1.header.seq, our_psn.wrapping_add(1));
    assert_eq!(p2.header.seq, our_psn.wrapping_add(2));
    assert_eq!(p3.header.seq, our_psn.wrapping_add(3));
}

#[tokio::test(flavor = "current_thread")]
async fn inbound_data_delivers_to_events_channel() {
    let mut e = establish(PeerProposal::default()).await;

    let pkt = LinkPacket::with_payload(
        ControlBits::ACK,
        PEER_INITIAL_PSN.wrapping_add(1),
        e.our_initial_psn.wrapping_add(1),
        SESSION_ID,
        Bytes::from_static(b"ping"),
    );
    write_link(&mut e.peer, &mut e.peer_codec, pkt).await;

    let event = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
        .await
        .unwrap();
    match event {
        Iap2Event::DataReceived {
            session_id,
            payload,
        } => {
            assert_eq!(session_id, SESSION_ID);
            assert_eq!(payload.as_ref(), b"ping");
        }
        other => panic!("expected DataReceived, got {:?}", other),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn window_backpressures_on_unacked_max_outgoing() {
    let mut e = establish(PeerProposal {
        max_outgoing: 2,
        ..PeerProposal::default()
    })
    .await;
    let our_psn = e.our_initial_psn;

    for c in [b"a", b"b", b"c"] {
        e.cmd_tx
            .send(Iap2Command::Send {
                session_id: SESSION_ID,
                payload: Bytes::copy_from_slice(c),
            })
            .await
            .unwrap();
    }

    let p1 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let p2 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert_eq!(p1.payload.as_ref(), b"a");
    assert_eq!(p2.payload.as_ref(), b"b");

    let timeout = tokio::time::timeout(
        Duration::from_millis(75),
        read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec),
    )
    .await;
    assert!(
        timeout.is_err(),
        "third packet leaked through closed window"
    );

    let ack = LinkPacket::header_only(ControlBits::ACK, PEER_INITIAL_PSN, our_psn.wrapping_add(2));
    write_link(&mut e.peer, &mut e.peer_codec, ack).await;

    let p3 = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert_eq!(p3.payload.as_ref(), b"c");
    assert_eq!(p3.header.seq, our_psn.wrapping_add(3));
}

#[tokio::test(flavor = "current_thread")]
async fn retransmit_resends_unacked_packet_after_timeout() {
    let mut e = establish(PeerProposal {
        retransmission_timeout_ms: 100,
        max_retransmissions: 5,
        ..PeerProposal::default()
    })
    .await;

    e.cmd_tx
        .send(Iap2Command::Send {
            session_id: SESSION_ID,
            payload: Bytes::from_static(b"ouch"),
        })
        .await
        .unwrap();

    let first = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let resend = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;

    assert_eq!(first.header.seq, resend.header.seq);
    assert_eq!(first.payload, resend.payload);
}

#[tokio::test(flavor = "current_thread")]
async fn max_retransmissions_drives_link_down() {
    let mut e = establish(PeerProposal {
        retransmission_timeout_ms: 30,
        max_retransmissions: 2,
        ..PeerProposal::default()
    })
    .await;

    e.cmd_tx
        .send(Iap2Command::Send {
            session_id: SESSION_ID,
            payload: Bytes::from_static(b"doomed"),
        })
        .await
        .unwrap();

    let _ = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let _ = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    let _ = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;

    let event = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
        .await
        .unwrap();
    match event {
        Iap2Event::LinkDown(reason) => {
            assert!(reason.contains("retransmit"), "got reason {:?}", reason)
        }
        other => panic!("expected LinkDown, got {:?}", other),
    }

    let result = tokio::time::timeout(Duration::from_secs(2), e.link)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(result, Err(Error::RetransmitLimit)));
}

#[tokio::test(flavor = "current_thread")]
async fn ack_delay_fires_standalone_ack_when_no_outbound_to_piggyback() {
    let mut e = establish(PeerProposal {
        ack_timeout_ms: 100,
        max_ack: 100,
        ..PeerProposal::default()
    })
    .await;

    let inbound = LinkPacket::with_payload(
        ControlBits::ACK,
        PEER_INITIAL_PSN.wrapping_add(1),
        e.our_initial_psn.wrapping_add(1),
        SESSION_ID,
        Bytes::from_static(b"ping"),
    );
    write_link(&mut e.peer, &mut e.peer_codec, inbound).await;

    let _ = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
        .await
        .unwrap();

    let ack = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert!(ack.header.control.contains(ControlBits::ACK));
    assert!(!ack.header.has_payload());
    assert_eq!(ack.header.length as usize, LINK_HEADER_LEN);
    assert_eq!(ack.header.ack, PEER_INITIAL_PSN.wrapping_add(1));
}

#[tokio::test(flavor = "current_thread")]
async fn cumulative_max_ack_threshold_fires_standalone_ack() {
    let mut e = establish(PeerProposal {
        ack_timeout_ms: 5000,
        max_ack: 2,
        ..PeerProposal::default()
    })
    .await;

    for i in 1..=2u8 {
        let pkt = LinkPacket::with_payload(
            ControlBits::ACK,
            PEER_INITIAL_PSN.wrapping_add(i),
            e.our_initial_psn.wrapping_add(1),
            SESSION_ID,
            Bytes::from_static(b"x"),
        );
        write_link(&mut e.peer, &mut e.peer_codec, pkt).await;
    }

    for _ in 0..2 {
        let _ = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
            .await
            .unwrap();
    }

    let ack = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert!(ack.header.control.contains(ControlBits::ACK));
    assert!(!ack.header.has_payload());
    assert_eq!(ack.header.ack, PEER_INITIAL_PSN.wrapping_add(2));
}

#[tokio::test(flavor = "current_thread")]
async fn out_of_order_inbound_triggers_eak_listing_missing_psns() {
    let mut e = establish(PeerProposal::default()).await;

    let gap = LinkPacket::with_payload(
        ControlBits::ACK,
        PEER_INITIAL_PSN.wrapping_add(2),
        e.our_initial_psn.wrapping_add(1),
        SESSION_ID,
        Bytes::from_static(b"future"),
    );
    write_link(&mut e.peer, &mut e.peer_codec, gap).await;

    let eak = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert!(eak.header.control.contains(ControlBits::EAK));
    assert_eq!(eak.payload.as_ref(), &[PEER_INITIAL_PSN.wrapping_add(1)]);
}

#[tokio::test(flavor = "current_thread")]
async fn out_of_order_drains_in_order_when_gap_arrives() {
    let mut e = establish(PeerProposal::default()).await;
    let our_psn = e.our_initial_psn;

    let p2 = LinkPacket::with_payload(
        ControlBits::ACK,
        PEER_INITIAL_PSN.wrapping_add(2),
        our_psn.wrapping_add(1),
        SESSION_ID,
        Bytes::from_static(b"two"),
    );
    write_link(&mut e.peer, &mut e.peer_codec, p2).await;

    let eak = read_link(&mut e.peer, &mut e.peer_buf, &mut e.peer_codec).await;
    assert!(eak.header.control.contains(ControlBits::EAK));

    let p1 = LinkPacket::with_payload(
        ControlBits::ACK,
        PEER_INITIAL_PSN.wrapping_add(1),
        our_psn.wrapping_add(1),
        SESSION_ID,
        Bytes::from_static(b"one"),
    );
    write_link(&mut e.peer, &mut e.peer_codec, p1).await;

    let first = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
        .await
        .unwrap();
    match first {
        Iap2Event::DataReceived { payload, .. } => assert_eq!(payload.as_ref(), b"one"),
        other => panic!("expected DataReceived 'one', got {:?}", other),
    }
    let second = recv_with_timeout(&mut e.events_rx, Duration::from_secs(2))
        .await
        .unwrap();
    match second {
        Iap2Event::DataReceived { payload, .. } => assert_eq!(payload.as_ref(), b"two"),
        other => panic!("expected DataReceived 'two', got {:?}", other),
    }
}
