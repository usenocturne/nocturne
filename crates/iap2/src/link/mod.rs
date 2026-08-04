//! iAP2 link-layer state machine: drives the byte stream from initial
//! detect handshake through SYN negotiation into Established, then runs
//! the reliable-delivery state machine (sequence numbers, retransmit,
//! ACK piggyback / standalone, EAK, send-window backpressure) until
//! either side disconnects.
//!
//! CSM-level handlers (auth, identification, NowPlaying, EA dispatch)
//! sit on top: they consume `Iap2Event::DataReceived` and produce
//! `Iap2Command::Send`. The link layer is session-id-agnostic; chunking
//! and reassembly are this layer's job, byte-content interpretation is
//! the consumer's.

mod established;

use std::time::Duration;

use bytes::{Bytes, BytesMut};
use established::EstablishedState;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::mpsc,
    time::Instant,
};
use tokio_util::codec::{Decoder, Encoder};

use crate::{
    error::{Error, Result},
    frame::{ControlBits, LinkCodec, LinkPacket, Lsp, DETECT_MARKER, LINK_MAGIC},
};

#[cfg(feature = "frame-tap")]
use crate::frame_tap::{FrameTap, FrameTapDirection};

const READ_CAPACITY: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct LinkConfig {
    /// First sequence number we'll stamp on outbound packets. SYN consumes
    /// this PSN; the first DATA send increments and uses `initial_psn + 1`.
    pub initial_psn: u8,
    /// What we propose in our SYN. The peer's proposal replaces this on receipt.
    pub our_lsp: Lsp,
    /// How often to retransmit the detect marker until the peer responds.
    pub detect_interval: Duration,
    /// Total budget for each handshake stage (Detecting, Negotiating).
    pub handshake_timeout: Duration,
}

impl LinkConfig {
    pub fn new(our_lsp: Lsp) -> Self {
        Self {
            initial_psn: 99,
            our_lsp,
            detect_interval: Duration::from_secs(1),
            handshake_timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone)]
pub enum Iap2Event {
    /// Link reached Established. Carries the peer's negotiated LSP.
    Established(Lsp),
    /// Link is going down for the reason given.
    LinkDown(String),
    /// One DATA chunk for `session_id` was delivered in-sequence. Sessions
    /// reassemble across chunks using their own framing.
    DataReceived { session_id: u8, payload: Bytes },
}

#[derive(Debug, Clone)]
pub enum Iap2Command {
    /// Send a tear-down RST and exit cleanly.
    Disconnect,
    /// Enqueue `payload` for transmission on `session_id`. Payloads larger
    /// than the negotiated `max_len` are chunked across multiple link packets.
    Send { session_id: u8, payload: Bytes },
}

pub struct Link;

impl Link {
    pub async fn run<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        commands_rx: mpsc::Receiver<Iap2Command>,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        Self::run_inner(
            stream,
            config,
            events_tx,
            commands_rx,
            #[cfg(feature = "frame-tap")]
            None,
        )
        .await
    }

    #[cfg(feature = "frame-tap")]
    pub async fn run_with_frame_tap<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        commands_rx: mpsc::Receiver<Iap2Command>,
        frame_tap: FrameTap,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        Self::run_inner(stream, config, events_tx, commands_rx, Some(frame_tap)).await
    }

    async fn run_inner<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        mut commands_rx: mpsc::Receiver<Iap2Command>,
        #[cfg(feature = "frame-tap")] frame_tap: Option<FrameTap>,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let (mut reader, mut writer) = tokio::io::split(stream);
        let mut buf = BytesMut::with_capacity(READ_CAPACITY);
        let mut codec = new_codec(
            #[cfg(feature = "frame-tap")]
            frame_tap,
        );

        Self::detect_phase(&mut reader, &mut writer, &mut buf, &mut codec, &config).await?;
        let (peer_lsp, peer_initial_psn) =
            Self::negotiate_phase(&mut reader, &mut writer, &mut buf, &mut codec, &config).await?;

        if events_tx
            .send(Iap2Event::Established(peer_lsp.clone()))
            .await
            .is_err()
        {
            tracing::debug!("iap2 events receiver dropped before Established could be delivered");
        }
        tracing::info!("iap2 link Established");

        let mut state = EstablishedState::new(config.initial_psn, peer_initial_psn, &peer_lsp);
        Self::established_phase(
            &mut reader,
            &mut writer,
            &mut buf,
            &mut codec,
            &mut state,
            &events_tx,
            &mut commands_rx,
        )
        .await
    }

    /// Device-half (iPhone-side) role for the emulator. The accessory
    /// initiates the SYN, so here we wait for it and reply SYN|ACK.
    #[cfg(feature = "emulator")]
    pub async fn run_device<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        commands_rx: mpsc::Receiver<Iap2Command>,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        Self::run_device_inner(
            stream,
            config,
            events_tx,
            commands_rx,
            #[cfg(feature = "frame-tap")]
            None,
        )
        .await
    }

    #[cfg(all(feature = "emulator", feature = "frame-tap"))]
    pub async fn run_device_with_frame_tap<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        commands_rx: mpsc::Receiver<Iap2Command>,
        frame_tap: FrameTap,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        Self::run_device_inner(stream, config, events_tx, commands_rx, Some(frame_tap)).await
    }

    #[cfg(feature = "emulator")]
    async fn run_device_inner<S>(
        stream: S,
        config: LinkConfig,
        events_tx: mpsc::Sender<Iap2Event>,
        mut commands_rx: mpsc::Receiver<Iap2Command>,
        #[cfg(feature = "frame-tap")] frame_tap: Option<FrameTap>,
    ) -> Result<()>
    where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let (mut reader, mut writer) = tokio::io::split(stream);
        let mut buf = BytesMut::with_capacity(READ_CAPACITY);
        let mut codec = new_codec(
            #[cfg(feature = "frame-tap")]
            frame_tap,
        );

        let (peer_lsp, peer_initial_psn) = Self::detect_and_negotiate_device(
            &mut reader,
            &mut writer,
            &mut buf,
            &mut codec,
            &config,
        )
        .await?;

        if events_tx
            .send(Iap2Event::Established(peer_lsp.clone()))
            .await
            .is_err()
        {
            tracing::debug!("iap2 events receiver dropped before Established could be delivered");
        }
        tracing::info!("iap2 device link Established");

        let mut state = EstablishedState::new(config.initial_psn, peer_initial_psn, &peer_lsp);
        Self::established_phase(
            &mut reader,
            &mut writer,
            &mut buf,
            &mut codec,
            &mut state,
            &events_tx,
            &mut commands_rx,
        )
        .await
    }

    async fn detect_phase<R, W>(
        reader: &mut R,
        writer: &mut W,
        buf: &mut BytesMut,
        codec: &mut LinkCodec,
        config: &LinkConfig,
    ) -> Result<()>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        tracing::debug!("iap2 link entering Detecting state");
        let mut detect_interval = tokio::time::interval(config.detect_interval);
        detect_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let deadline = tokio::time::sleep(config.handshake_timeout);
        tokio::pin!(deadline);

        loop {
            tokio::select! {
              _ = detect_interval.tick() => {
                tracing::trace!("iap2 sending detect marker");
                #[cfg(feature = "frame-tap")]
                tap_detect(codec, FrameTapDirection::Outbound);
                writer.write_all(&DETECT_MARKER).await?;
                writer.flush().await?;
              }
              read = reader.read_buf(buf) => {
                let n = read?;
                if n == 0 {
                  return Err(Error::PeerDisconnectedDuringHandshake);
                }
                if drain_detect_or_link_start(buf, codec) {
                  tracing::debug!("iap2 link detected peer; entering Negotiating");
                  return Ok(());
                }
              }
              _ = &mut deadline => {
                return Err(Error::HandshakeTimeout("Detecting"));
              }
            }
        }
    }

    async fn negotiate_phase<R, W>(
        reader: &mut R,
        writer: &mut W,
        buf: &mut BytesMut,
        codec: &mut LinkCodec,
        config: &LinkConfig,
    ) -> Result<(Lsp, u8)>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let our_seq = config.initial_psn;
        let syn =
            LinkPacket::with_payload(ControlBits::SYN, our_seq, 0, 0, config.our_lsp.encode());
        write_packet(writer, codec, syn).await?;
        tracing::trace!("iap2 sent SYN");

        let deadline = tokio::time::sleep(config.handshake_timeout);
        tokio::pin!(deadline);

        loop {
            drain_detect_markers(buf, codec);
            if let Some(pkt) = codec.decode(buf)? {
                tracing::trace!("iap2 negotiating: received {:?}", pkt.header);
                if pkt.header.control.contains(ControlBits::RST) {
                    return Err(Error::PeerReset);
                }
                if pkt.header.control.contains(ControlBits::SYN) {
                    let lsp = Lsp::decode(&pkt.payload)?;
                    let peer_initial_psn = pkt.header.seq;
                    let standalone_ack =
                        LinkPacket::header_only(ControlBits::ACK, our_seq, peer_initial_psn);
                    write_packet(writer, codec, standalone_ack).await?;
                    return Ok((lsp, peer_initial_psn));
                }
                return Err(Error::UnexpectedHandshakePacket(pkt.header.control));
            }

            tokio::select! {
              read = reader.read_buf(buf) => {
                let n = read?;
                if n == 0 {
                  return Err(Error::PeerDisconnectedDuringHandshake);
                }
              }
              _ = &mut deadline => {
                return Err(Error::HandshakeTimeout("Negotiating"));
              }
            }
        }
    }

    /// Device-role detect + negotiate, combined. Keeps emitting detect
    /// markers on the interval until the SYN arrives (the accessory must
    /// drain at least one of ours first). The codec skips the accessory's
    /// detect markers via bad-magic resync and surfaces only the SYN. We
    /// reply SYN|ACK (seq = our PSN, ack = the accessory's PSN). Returns
    /// the peer LSP and the accessory's PSN.
    #[cfg(feature = "emulator")]
    async fn detect_and_negotiate_device<R, W>(
        reader: &mut R,
        writer: &mut W,
        buf: &mut BytesMut,
        codec: &mut LinkCodec,
        config: &LinkConfig,
    ) -> Result<(Lsp, u8)>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        tracing::debug!("iap2 device link entering Detecting state");
        let mut detect_interval = tokio::time::interval(config.detect_interval);
        detect_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let deadline = tokio::time::sleep(config.handshake_timeout);
        tokio::pin!(deadline);

        loop {
            if let Some(pkt) = codec.decode(buf)? {
                tracing::trace!("iap2 device negotiating: received {:?}", pkt.header);
                if pkt.header.control.contains(ControlBits::RST) {
                    return Err(Error::PeerReset);
                }
                if pkt.header.control.contains(ControlBits::SYN) {
                    let lsp = Lsp::decode(&pkt.payload)?;
                    let peer_initial_psn = pkt.header.seq;
                    let syn_ack = LinkPacket::with_payload(
                        ControlBits::SYN | ControlBits::ACK,
                        config.initial_psn,
                        peer_initial_psn,
                        0,
                        config.our_lsp.encode(),
                    );
                    write_packet(writer, codec, syn_ack).await?;
                    tracing::trace!("iap2 device sent SYN|ACK");
                    return Ok((lsp, peer_initial_psn));
                }
                return Err(Error::UnexpectedHandshakePacket(pkt.header.control));
            }

            tokio::select! {
              _ = detect_interval.tick() => {
                tracing::trace!("iap2 device sending detect marker");
                #[cfg(feature = "frame-tap")]
                tap_detect(codec, FrameTapDirection::Outbound);
                writer.write_all(&DETECT_MARKER).await?;
                writer.flush().await?;
              }
              read = reader.read_buf(buf) => {
                let n = read?;
                if n == 0 {
                  return Err(Error::PeerDisconnectedDuringHandshake);
                }
              }
              _ = &mut deadline => {
                return Err(Error::HandshakeTimeout("Negotiating"));
              }
            }
        }
    }

    async fn established_phase<R, W>(
        reader: &mut R,
        writer: &mut W,
        buf: &mut BytesMut,
        codec: &mut LinkCodec,
        state: &mut EstablishedState,
        events_tx: &mpsc::Sender<Iap2Event>,
        commands_rx: &mut mpsc::Receiver<Iap2Command>,
    ) -> Result<()>
    where
        R: AsyncRead + Unpin,
        W: AsyncWrite + Unpin,
    {
        let mut delivered = Vec::new();
        loop {
            while let Some(pkt) = codec.decode(buf)? {
                if pkt.header.control.contains(ControlBits::RST) {
                    let _ = events_tx.send(Iap2Event::LinkDown("peer RST".into())).await;
                    return Err(Error::PeerReset);
                }

                if pkt.header.control.contains(ControlBits::ACK) {
                    state.handle_inbound_ack(pkt.header.ack);
                }

                if pkt.header.control.contains(ControlBits::EAK) {
                    state
                        .handle_inbound_eak(&pkt.payload, writer, codec)
                        .await?;
                    continue;
                }

                if pkt.header.has_payload() && !pkt.header.control.contains(ControlBits::SYN) {
                    state.handle_inbound_data(pkt, &mut delivered);
                    for d in delivered.drain(..) {
                        let _ = events_tx
                            .send(Iap2Event::DataReceived {
                                session_id: d.session_id,
                                payload: d.payload,
                            })
                            .await;
                    }
                    if state.has_buffered_out_of_order() {
                        state.send_eak(writer, codec).await?;
                    }
                }
            }

            if state.should_send_ack_now() {
                state.send_standalone_ack(writer, codec).await?;
            }

            state.drain_pending_send(writer, codec).await?;

            let retransmit_deadline = state.next_retransmit_deadline();
            let ack_delay_deadline = state.ack_delay_deadline();

            tokio::select! {
              read = reader.read_buf(buf) => {
                let n = read?;
                if n == 0 {
                  let _ = events_tx.send(Iap2Event::LinkDown("peer disconnected".into())).await;
                  return Err(Error::PeerDisconnected);
                }
              }
              cmd = commands_rx.recv() => {
                match cmd {
                  Some(Iap2Command::Disconnect) | None => {
                    let rst = LinkPacket::header_only(ControlBits::RST, state.last_sent_psn(), 0);
                    if let Err(err) = write_packet(writer, codec, rst).await {
                      tracing::warn!("iap2 failed to send RST on disconnect: {:?}", err);
                    }
                    let _ = events_tx.send(Iap2Event::LinkDown("local disconnect".into())).await;
                    return Ok(());
                  }
                  Some(Iap2Command::Send { session_id, payload }) => {
                    state.enqueue_send(session_id, payload);
                  }
                }
              }
              _ = sleep_until_or_pending(retransmit_deadline) => {
                if state.handle_retransmit_fire(writer, codec).await? {
                  let _ = events_tx.send(Iap2Event::LinkDown("retransmit limit".into())).await;
                  return Err(Error::RetransmitLimit);
                }
              }
              _ = sleep_until_or_pending(ack_delay_deadline) => {
                state.send_standalone_ack(writer, codec).await?;
              }
            }
        }
    }
}

async fn sleep_until_or_pending(deadline: Option<Instant>) {
    match deadline {
        Some(d) => tokio::time::sleep_until(d).await,
        None => std::future::pending::<()>().await,
    }
}

fn drain_detect_or_link_start(buf: &mut BytesMut, codec: &LinkCodec) -> bool {
    let drained_any = drain_detect_markers(buf, codec);
    drained_any || (buf.len() >= 2 && buf[0..2] == LINK_MAGIC)
}

fn drain_detect_markers(buf: &mut BytesMut, _codec: &LinkCodec) -> bool {
    use bytes::Buf;
    let mut drained_any = false;
    while buf.starts_with(&DETECT_MARKER) {
        #[cfg(feature = "frame-tap")]
        tap_detect(_codec, FrameTapDirection::Inbound);
        buf.advance(DETECT_MARKER.len());
        drained_any = true;
    }
    drained_any
}

fn encode_packet(codec: &mut LinkCodec, packet: LinkPacket) -> Result<Bytes> {
    let mut wire = BytesMut::new();
    codec.encode(packet, &mut wire)?;
    let wire = wire.freeze();
    tap_outbound_wire(codec, &wire);
    Ok(wire)
}

async fn write_packet<W: AsyncWrite + Unpin>(
    writer: &mut W,
    codec: &mut LinkCodec,
    packet: LinkPacket,
) -> Result<()> {
    let wire = encode_packet(codec, packet)?;
    writer.write_all(&wire).await?;
    writer.flush().await?;
    Ok(())
}

fn new_codec(#[cfg(feature = "frame-tap")] frame_tap: Option<FrameTap>) -> LinkCodec {
    #[cfg(feature = "frame-tap")]
    {
        frame_tap.map_or_else(LinkCodec::new, LinkCodec::with_frame_tap)
    }
    #[cfg(not(feature = "frame-tap"))]
    {
        LinkCodec::new()
    }
}

pub(super) fn tap_outbound_wire(_codec: &LinkCodec, _wire: &Bytes) {
    #[cfg(feature = "frame-tap")]
    if let Some(tap) = _codec.frame_tap() {
        tap.outbound_frame(_wire.clone());
    }
}

#[cfg(feature = "frame-tap")]
fn tap_detect(codec: &LinkCodec, direction: FrameTapDirection) {
    if let Some(tap) = codec.frame_tap() {
        tap.detect(direction);
    }
}

#[cfg(test)]
mod tests {
    use super::READ_CAPACITY;
    use crate::frame::Lsp;

    #[test]
    fn read_buffer_holds_four_default_maximum_frames() {
        let maximum_frame_len = usize::from(Lsp::accessory_default().max_len);
        assert!(READ_CAPACITY >= maximum_frame_len * 4);
    }
}
