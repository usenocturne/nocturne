//! End-to-end loopback test for the iAP2 link wedge: drives a hand-rolled
//! fake peer over `tokio::io::duplex` and asserts the link reaches
//! Established with the peer's LSP intact.

use std::time::Duration;

use bytes::BytesMut;
use iap2_rs::{
    ControlBits, Iap2Command, Iap2Event, Link, LinkCodec, LinkConfig, LinkPacket, Lsp,
    SessionTriple, DETECT_MARKER,
};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio_util::codec::{Decoder, Encoder};

fn our_lsp() -> Lsp {
    Lsp {
        version: 1,
        max_outgoing: 5,
        max_len: 2048,
        retransmission_timeout_ms: 6000,
        ack_timeout_ms: 3000,
        max_retransmissions: 30,
        max_ack: 3,
        sessions: vec![SessionTriple {
            id: 1,
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
        sessions: vec![SessionTriple {
            id: 1,
            session_type: 0,
            version: 1,
        }],
    }
}

fn fast_config(our_lsp: Lsp) -> LinkConfig {
    let mut config = LinkConfig::new(our_lsp);
    config.detect_interval = Duration::from_millis(50);
    config.handshake_timeout = Duration::from_secs(5);
    config
}

async fn read_one_packet<R: AsyncRead + Unpin>(
    reader: &mut R,
    buf: &mut BytesMut,
    codec: &mut LinkCodec,
) -> LinkPacket {
    loop {
        if let Some(pkt) = codec.decode(buf).expect("codec decode") {
            return pkt;
        }
        let n = reader.read_buf(buf).await.expect("read_buf");
        assert!(n > 0, "stream closed before a packet decoded");
    }
}

async fn write_packet<W: AsyncWrite + Unpin>(
    writer: &mut W,
    codec: &mut LinkCodec,
    packet: LinkPacket,
) {
    let mut wire = BytesMut::new();
    codec.encode(packet, &mut wire).expect("encode");
    writer.write_all(&wire).await.expect("write_all");
    writer.flush().await.expect("flush");
}

#[tokio::test(flavor = "current_thread", start_paused = false)]
async fn handshake_reaches_established_and_peer_lsp_propagates() {
    let (us, mut peer) = tokio::io::duplex(8192);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::channel(8);
    let (_cmd_tx, cmd_rx) = tokio::sync::mpsc::channel::<Iap2Command>(8);

    let config = fast_config(our_lsp());
    let initial_psn = config.initial_psn;
    let link_handle = tokio::spawn(Link::run(us, config, events_tx, cmd_rx));

    let peer_lsp_v = peer_lsp();
    let peer_lsp_check = peer_lsp_v.clone();
    let peer_seq: u8 = 50;

    let peer_handle = tokio::spawn(async move {
        // Send the peer's detect marker first; our side may also be sending
        // its own concurrently, which the codec will resync past.
        peer.write_all(&DETECT_MARKER).await.unwrap();

        // Send the peer's SYN.
        let mut peer_codec = LinkCodec::new();
        let syn = LinkPacket::with_payload(ControlBits::SYN, peer_seq, 0, 0, peer_lsp_v.encode());
        write_packet(&mut peer, &mut peer_codec, syn).await;

        // Read our SYN. Codec resyncs past any leading detect markers we sent.
        let mut peer_buf = BytesMut::with_capacity(256);
        let our_syn = read_one_packet(&mut peer, &mut peer_buf, &mut peer_codec).await;
        assert!(our_syn.header.control.contains(ControlBits::SYN));
        assert_eq!(our_syn.header.seq, initial_psn);
        let our_proposed_lsp = Lsp::decode(&our_syn.payload).expect("decode our LSP");
        assert_eq!(our_proposed_lsp.sessions.len(), 1);

        // Read our standalone ACK for the peer's SYN.
        let our_ack = read_one_packet(&mut peer, &mut peer_buf, &mut peer_codec).await;
        assert!(our_ack.header.control.contains(ControlBits::ACK));
        assert!(!our_ack.header.control.contains(ControlBits::SYN));
        assert_eq!(our_ack.header.ack, peer_seq);
        assert_eq!(our_ack.header.length as usize, iap2_rs::LINK_HEADER_LEN);

        peer
    });

    let event = tokio::time::timeout(Duration::from_secs(3), events_rx.recv())
        .await
        .expect("Established not received before timeout")
        .expect("events channel closed");
    match event {
        Iap2Event::Established(lsp) => assert_eq!(lsp, peer_lsp_check),
        other => panic!("expected Established, got {:?}", other),
    }

    let peer = peer_handle.await.expect("peer task panicked");
    drop(peer);

    let result = tokio::time::timeout(Duration::from_secs(2), link_handle)
        .await
        .expect("link task did not exit after peer disconnect")
        .expect("link task panicked");
    assert!(
        matches!(result, Err(iap2_rs::Error::PeerDisconnected)),
        "expected PeerDisconnected, got {:?}",
        result
    );
}

#[tokio::test(flavor = "current_thread", start_paused = false)]
async fn disconnect_command_sends_rst_and_returns_ok() {
    let (us, mut peer) = tokio::io::duplex(8192);
    let (events_tx, mut events_rx) = tokio::sync::mpsc::channel(8);
    let (cmd_tx, cmd_rx) = tokio::sync::mpsc::channel::<Iap2Command>(8);

    let config = fast_config(our_lsp());
    let link_handle = tokio::spawn(Link::run(us, config, events_tx, cmd_rx));

    let peer_seq: u8 = 50;
    let peer_lsp_v = peer_lsp();

    let peer_handshake = tokio::spawn(async move {
        let mut peer_codec = LinkCodec::new();
        peer.write_all(&DETECT_MARKER).await.unwrap();
        let syn = LinkPacket::with_payload(ControlBits::SYN, peer_seq, 0, 0, peer_lsp_v.encode());
        write_packet(&mut peer, &mut peer_codec, syn).await;
        let mut peer_buf = BytesMut::with_capacity(256);
        let _our_syn = read_one_packet(&mut peer, &mut peer_buf, &mut peer_codec).await;
        let _our_ack = read_one_packet(&mut peer, &mut peer_buf, &mut peer_codec).await;
        (peer, peer_buf, peer_codec)
    });

    // Wait until the link reports Established before issuing the disconnect.
    let event = tokio::time::timeout(Duration::from_secs(3), events_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(event, Iap2Event::Established(_)));

    let (mut peer, mut peer_buf, mut peer_codec) = peer_handshake.await.unwrap();

    cmd_tx.send(Iap2Command::Disconnect).await.unwrap();

    let rst = read_one_packet(&mut peer, &mut peer_buf, &mut peer_codec).await;
    assert!(rst.header.control.contains(ControlBits::RST));

    let down = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(down, Iap2Event::LinkDown(_)));

    let result = tokio::time::timeout(Duration::from_secs(2), link_handle)
        .await
        .expect("link task did not exit")
        .expect("link task panicked");
    assert!(
        result.is_ok(),
        "expected Ok on local disconnect, got {:?}",
        result
    );
}
