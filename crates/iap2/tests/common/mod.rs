//! Shared helpers for iap2 integration tests.
//!
//! Each test file declares `mod common;` and consumes:
//! - LSP builders (`peer_lsp_builder`, `accessory_lsp`)
//! - Wire I/O helpers (`write_link`, `read_link`)
//! - Setup primitives (`spawn_link_with`, `drive_peer_handshake`)
//! - `recv_with_timeout` for event-channel polling
//!
//! Per-test-file scaffolds (`Established`, `Harness`) compose these
//! into higher-level fixtures.

use std::time::Duration;

use bytes::BytesMut;
use iap2_rs::{
    ControlBits, Iap2Command, Iap2Event, Link, LinkCodec, LinkConfig, LinkPacket, Lsp,
    SessionTriple, DETECT_MARKER,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, DuplexStream},
    sync::mpsc,
    task::JoinHandle,
};
use tokio_util::codec::{Decoder, Encoder};

pub const PEER_INITIAL_PSN: u8 = 50;

/// Variable LSP knobs the tests tweak; everything else stays at the
/// default the fake peer would happily accept.
#[derive(Debug, Clone)]
pub struct LspBuilder {
    pub max_outgoing: u8,
    pub max_len: u16,
    pub retransmission_timeout_ms: u16,
    pub ack_timeout_ms: u16,
    pub max_retransmissions: u8,
    pub max_ack: u8,
    pub session_ids: Vec<u8>,
}

impl Default for LspBuilder {
    fn default() -> Self {
        Self {
            max_outgoing: 5,
            max_len: 2048,
            retransmission_timeout_ms: 6000,
            ack_timeout_ms: 3000,
            max_retransmissions: 30,
            max_ack: 3,
            session_ids: vec![0],
        }
    }
}

impl LspBuilder {
    pub fn build(self) -> Lsp {
        Lsp {
            version: 1,
            max_outgoing: self.max_outgoing,
            max_len: self.max_len,
            retransmission_timeout_ms: self.retransmission_timeout_ms,
            ack_timeout_ms: self.ack_timeout_ms,
            max_retransmissions: self.max_retransmissions,
            max_ack: self.max_ack,
            sessions: self
                .session_ids
                .into_iter()
                .map(|id| SessionTriple {
                    id,
                    session_type: 0,
                    version: 1,
                })
                .collect(),
        }
    }
}

/// Fast-handshake LinkConfig for tests. Detect every 50 ms, 5-second
/// handshake budget.
pub fn fast_link_config(our_lsp: Lsp) -> LinkConfig {
    let mut config = LinkConfig::new(our_lsp);
    config.detect_interval = Duration::from_millis(50);
    config.handshake_timeout = Duration::from_secs(5);
    config
}

pub async fn write_link(peer: &mut DuplexStream, codec: &mut LinkCodec, packet: LinkPacket) {
    let mut wire = BytesMut::new();
    codec.encode(packet, &mut wire).expect("link encode");
    peer.write_all(&wire).await.expect("write_all");
    peer.flush().await.expect("flush");
}

pub async fn read_link(
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

pub async fn recv_with_timeout<T>(rx: &mut mpsc::Receiver<T>, timeout: Duration) -> Option<T> {
    tokio::time::timeout(timeout, rx.recv())
        .await
        .ok()
        .flatten()
}

/// Wire up a duplex pair, spawn the link with the given config, and
/// hand back the peer end + the channels the link is using. Caller
/// drives the handshake from the peer side.
pub fn spawn_link(
    config: LinkConfig,
) -> (
    DuplexStream,
    mpsc::Sender<Iap2Command>,
    mpsc::Receiver<Iap2Event>,
    JoinHandle<iap2_rs::Result<()>>,
) {
    let (us, peer) = tokio::io::duplex(8192);
    let (events_tx, events_rx) = mpsc::channel::<Iap2Event>(32);
    let (cmd_tx, cmd_rx) = mpsc::channel::<Iap2Command>(32);
    let handle = tokio::spawn(Link::run(us, config, events_tx, cmd_rx));
    (peer, cmd_tx, events_rx, handle)
}

/// Drive the peer side of detect + SYN + read-our-SYN + read-our-ACK,
/// returning the buffer + codec the caller should keep using and the
/// PSN the accessory chose for itself.
pub async fn drive_peer_handshake(
    peer: &mut DuplexStream,
    peer_lsp: Lsp,
) -> (BytesMut, LinkCodec, u8) {
    peer.write_all(&DETECT_MARKER).await.unwrap();
    let mut codec = LinkCodec::new();
    let syn = LinkPacket::with_payload(ControlBits::SYN, PEER_INITIAL_PSN, 0, 0, peer_lsp.encode());
    write_link(peer, &mut codec, syn).await;
    let mut buf = BytesMut::with_capacity(256);
    let our_syn = read_link(peer, &mut buf, &mut codec).await;
    let _our_ack = read_link(peer, &mut buf, &mut codec).await;
    (buf, codec, our_syn.header.seq)
}
