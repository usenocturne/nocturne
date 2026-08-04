//! Established-phase state machine for the iAP2 link layer.
//!
//! Owns sequence-number tracking, the unacked-packet queue, the
//! out-of-order receive buffer, and the timing decisions that drive
//! retransmit + standalone ACK emission. Stateless byte-level helpers
//! (codec encode, raw socket write) live in the parent module; this
//! module reaches up via `super::` for them.

use std::{
    collections::{BTreeMap, VecDeque},
    time::Duration,
};

use bytes::{Bytes, BytesMut};
use tokio::{
    io::{AsyncWrite, AsyncWriteExt},
    time::Instant,
};

use super::{encode_packet, tap_outbound_wire, write_packet};
use crate::{
    error::Result,
    frame::{ControlBits, LinkCodec, LinkPacket, Lsp, LINK_FRAME_OVERHEAD},
};

#[derive(Debug, Clone, Copy)]
struct LinkParams {
    max_outgoing: u8,
    max_payload_len: u16,
    retransmission_timeout: Duration,
    ack_timeout: Duration,
    max_retransmissions: u8,
    max_ack: u8,
}

impl LinkParams {
    fn from_peer_lsp(lsp: &Lsp) -> Self {
        Self {
            max_outgoing: lsp.max_outgoing.max(1),
            max_payload_len: lsp
                .max_len
                .saturating_sub(LINK_FRAME_OVERHEAD as u16)
                .max(1),
            retransmission_timeout: Duration::from_millis(lsp.retransmission_timeout_ms as u64),
            ack_timeout: Duration::from_millis(lsp.ack_timeout_ms as u64),
            max_retransmissions: lsp.max_retransmissions.max(1),
            max_ack: lsp.max_ack.max(1),
        }
    }
}

#[derive(Debug)]
struct UnackedPacket {
    seq: u8,
    wire: Bytes,
    deadline: Instant,
    retry_count: u8,
}

#[derive(Debug)]
pub(super) struct DeliveredData {
    pub(super) session_id: u8,
    pub(super) payload: Bytes,
}

#[derive(Debug)]
pub(super) struct EstablishedState {
    params: LinkParams,

    last_sent_psn: u8,
    last_acked_psn: u8,
    unacked: VecDeque<UnackedPacket>,
    pending_send: VecDeque<(u8, Bytes)>,

    last_received_in_sequence_psn: u8,
    out_of_order: BTreeMap<u8, LinkPacket>,
    cumulative_received: u8,
    must_send_ack: bool,
    ack_delay_deadline: Option<Instant>,
}

impl EstablishedState {
    pub(super) fn new(initial_psn: u8, peer_initial_psn: u8, peer_lsp: &Lsp) -> Self {
        Self {
            params: LinkParams::from_peer_lsp(peer_lsp),
            last_sent_psn: initial_psn,
            last_acked_psn: initial_psn,
            unacked: VecDeque::new(),
            pending_send: VecDeque::new(),
            last_received_in_sequence_psn: peer_initial_psn,
            out_of_order: BTreeMap::new(),
            cumulative_received: 0,
            must_send_ack: false,
            ack_delay_deadline: None,
        }
    }

    pub(super) fn last_sent_psn(&self) -> u8 {
        self.last_sent_psn
    }

    pub(super) fn next_retransmit_deadline(&self) -> Option<Instant> {
        self.unacked.front().map(|p| p.deadline)
    }

    pub(super) fn ack_delay_deadline(&self) -> Option<Instant> {
        self.ack_delay_deadline
    }

    pub(super) fn has_buffered_out_of_order(&self) -> bool {
        !self.out_of_order.is_empty()
    }

    pub(super) fn should_send_ack_now(&self) -> bool {
        self.must_send_ack || self.cumulative_received >= self.params.max_ack
    }

    pub(super) fn enqueue_send(&mut self, session_id: u8, payload: Bytes) {
        if payload.is_empty() {
            return;
        }
        let max = self.params.max_payload_len as usize;
        if payload.len() <= max {
            self.pending_send.push_back((session_id, payload));
            return;
        }
        let mut remaining = payload;
        while remaining.len() > max {
            let chunk = remaining.split_to(max);
            self.pending_send.push_back((session_id, chunk));
        }
        if !remaining.is_empty() {
            self.pending_send.push_back((session_id, remaining));
        }
    }

    pub(super) async fn drain_pending_send<W>(
        &mut self,
        writer: &mut W,
        codec: &mut LinkCodec,
    ) -> Result<()>
    where
        W: AsyncWrite + Unpin,
    {
        while self.window_has_room() {
            let Some((session_id, payload)) = self.pending_send.pop_front() else {
                break;
            };
            self.send_data_packet(session_id, payload, writer, codec)
                .await?;
        }
        Ok(())
    }

    pub(super) async fn send_standalone_ack<W>(
        &mut self,
        writer: &mut W,
        codec: &mut LinkCodec,
    ) -> Result<()>
    where
        W: AsyncWrite + Unpin,
    {
        let packet = LinkPacket::header_only(
            ControlBits::ACK,
            self.last_sent_psn,
            self.last_received_in_sequence_psn,
        );
        write_packet(writer, codec, packet).await?;
        self.cumulative_received = 0;
        self.must_send_ack = false;
        self.ack_delay_deadline = None;
        Ok(())
    }

    pub(super) async fn send_eak<W>(&mut self, writer: &mut W, codec: &mut LinkCodec) -> Result<()>
    where
        W: AsyncWrite + Unpin,
    {
        let Some(&furthest_buffered) = self.out_of_order.keys().last() else {
            return Ok(());
        };
        let total = furthest_buffered.wrapping_sub(self.last_received_in_sequence_psn);
        let mut payload = BytesMut::with_capacity(total as usize);
        let mut probe = self.last_received_in_sequence_psn.wrapping_add(1);
        for _ in 0..total {
            if !self.out_of_order.contains_key(&probe) {
                payload.extend_from_slice(&[probe]);
            }
            probe = probe.wrapping_add(1);
        }
        if payload.is_empty() {
            return Ok(());
        }
        let packet = LinkPacket::with_payload(
            ControlBits::EAK | ControlBits::ACK,
            self.last_sent_psn,
            self.last_received_in_sequence_psn,
            0,
            payload.freeze(),
        );
        write_packet(writer, codec, packet).await?;
        self.cumulative_received = 0;
        self.must_send_ack = false;
        self.ack_delay_deadline = None;
        Ok(())
    }

    pub(super) async fn handle_inbound_eak<W>(
        &mut self,
        payload: &[u8],
        writer: &mut W,
        codec: &mut LinkCodec,
    ) -> Result<()>
    where
        W: AsyncWrite + Unpin,
    {
        for &missing_seq in payload {
            if let Some(packet) = self.unacked.iter().find(|p| p.seq == missing_seq) {
                let wire = packet.wire.clone();
                tap_outbound_wire(codec, &wire);
                writer.write_all(&wire).await?;
            }
        }
        writer.flush().await?;
        Ok(())
    }

    pub(super) fn handle_inbound_ack(&mut self, ack_value: u8) {
        while let Some(front) = self.unacked.front() {
            let dist = ack_value.wrapping_sub(front.seq);
            // ack is last-received-in-sequence psn; dist 0..=127 acks this entry, 128..=255 stays queued.
            if dist <= 127 {
                let p = self.unacked.pop_front().unwrap();
                self.last_acked_psn = p.seq;
            } else {
                break;
            }
        }
    }

    pub(super) fn handle_inbound_data(&mut self, packet: LinkPacket, out: &mut Vec<DeliveredData>) {
        out.clear();
        let recv_seq = packet.header.seq;
        let delta = recv_seq.wrapping_sub(self.last_received_in_sequence_psn);

        if delta == 0 {
            tracing::trace!(
                "iap2 received duplicate of last delivered seq {}; re-acking",
                recv_seq
            );
            self.must_send_ack = true;
            return;
        }

        if delta == 1 {
            out.push(DeliveredData {
                session_id: packet.header.session_id,
                payload: packet.payload,
            });
            self.last_received_in_sequence_psn = recv_seq;
            self.bump_cumulative();

            loop {
                let next = self.last_received_in_sequence_psn.wrapping_add(1);
                let Some(buffered) = self.out_of_order.remove(&next) else {
                    break;
                };
                out.push(DeliveredData {
                    session_id: buffered.header.session_id,
                    payload: buffered.payload,
                });
                self.last_received_in_sequence_psn = next;
                self.bump_cumulative();
            }
            return;
        }

        if (delta as usize) < self.params.max_outgoing as usize {
            tracing::trace!(
                "iap2 buffering out-of-order seq {} (delta {})",
                recv_seq,
                delta
            );
            self.out_of_order.insert(recv_seq, packet);
            return;
        }

        tracing::trace!(
            "iap2 dropping seq {} (delta {} beyond window)",
            recv_seq,
            delta
        );
        self.must_send_ack = true;
    }

    pub(super) async fn handle_retransmit_fire<W>(
        &mut self,
        writer: &mut W,
        codec: &LinkCodec,
    ) -> Result<bool>
    where
        W: AsyncWrite + Unpin,
    {
        let Some(front) = self.unacked.front_mut() else {
            return Ok(false);
        };
        if front.deadline > Instant::now() {
            return Ok(false);
        }
        if front.retry_count >= self.params.max_retransmissions {
            tracing::warn!("iap2 retransmit limit reached for seq {}", front.seq);
            return Ok(true);
        }
        front.retry_count += 1;
        front.deadline = Instant::now() + self.params.retransmission_timeout;
        let wire = front.wire.clone();
        let seq = front.seq;
        let retry = front.retry_count;
        tracing::debug!("iap2 retransmitting seq {} (attempt {})", seq, retry);
        tap_outbound_wire(codec, &wire);
        writer.write_all(&wire).await?;
        writer.flush().await?;
        Ok(false)
    }

    fn window_has_room(&self) -> bool {
        self.unacked.len() < self.params.max_outgoing as usize
    }

    fn bump_cumulative(&mut self) {
        self.cumulative_received = self.cumulative_received.saturating_add(1);
        if self.ack_delay_deadline.is_none() {
            self.ack_delay_deadline = Some(Instant::now() + self.params.ack_timeout);
        }
    }

    async fn send_data_packet<W>(
        &mut self,
        session_id: u8,
        payload: Bytes,
        writer: &mut W,
        codec: &mut LinkCodec,
    ) -> Result<()>
    where
        W: AsyncWrite + Unpin,
    {
        let seq = self.last_sent_psn.wrapping_add(1);
        let packet = LinkPacket::with_payload(
            ControlBits::ACK,
            seq,
            self.last_received_in_sequence_psn,
            session_id,
            payload,
        );
        let wire = encode_packet(codec, packet)?;
        writer.write_all(&wire).await?;
        writer.flush().await?;

        self.last_sent_psn = seq;
        self.cumulative_received = 0;
        self.must_send_ack = false;
        self.ack_delay_deadline = None;
        self.unacked.push_back(UnackedPacket {
            seq,
            wire,
            deadline: Instant::now() + self.params.retransmission_timeout,
            retry_count: 0,
        });
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::SessionTriple;

    fn test_lsp(max_outgoing: u8, max_len: u16, max_ack: u8) -> Lsp {
        Lsp {
            version: 1,
            max_outgoing,
            max_len,
            retransmission_timeout_ms: 6000,
            ack_timeout_ms: 3000,
            max_retransmissions: 30,
            max_ack,
            sessions: vec![SessionTriple {
                id: 1,
                session_type: 0,
                version: 1,
            }],
        }
    }

    fn data_packet(seq: u8, ack: u8, session_id: u8, payload: &[u8]) -> LinkPacket {
        LinkPacket::with_payload(
            ControlBits::ACK,
            seq,
            ack,
            session_id,
            Bytes::copy_from_slice(payload),
        )
    }

    #[test]
    fn enqueue_send_chunks_at_max_payload_len() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 60, 3));
        let max_payload = state.params.max_payload_len as usize;
        assert_eq!(max_payload, 60 - LINK_FRAME_OVERHEAD);
        let total = max_payload * 2 + 5;
        let payload = Bytes::from(vec![0xABu8; total]);
        state.enqueue_send(1, payload);
        assert_eq!(state.pending_send.len(), 3);
        let chunks: Vec<usize> = state.pending_send.iter().map(|(_, b)| b.len()).collect();
        assert_eq!(chunks, vec![max_payload, max_payload, 5]);
    }

    #[test]
    fn handle_inbound_data_in_sequence_delivers_and_drains_buffered() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        let buffered = data_packet(52, 100, 1, b"two");
        state.out_of_order.insert(52, buffered);
        let next = data_packet(51, 100, 1, b"one");
        let mut delivered = Vec::new();
        state.handle_inbound_data(next, &mut delivered);
        assert_eq!(delivered.len(), 2);
        assert_eq!(delivered[0].payload.as_ref(), b"one");
        assert_eq!(delivered[1].payload.as_ref(), b"two");
        assert_eq!(state.last_received_in_sequence_psn, 52);
        assert!(state.out_of_order.is_empty());
    }

    #[test]
    fn handle_inbound_data_buffers_out_of_order() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        let pkt = data_packet(52, 100, 1, b"hello");
        let mut delivered = Vec::new();
        state.handle_inbound_data(pkt, &mut delivered);
        assert!(delivered.is_empty());
        assert!(state.out_of_order.contains_key(&52));
        assert_eq!(state.last_received_in_sequence_psn, 50);
    }

    #[test]
    fn handle_inbound_data_duplicate_forces_ack() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        let pkt = data_packet(50, 100, 1, b"dup");
        let mut delivered = Vec::new();
        state.handle_inbound_data(pkt, &mut delivered);
        assert!(delivered.is_empty());
        assert!(state.must_send_ack);
    }

    #[test]
    fn handle_inbound_ack_drains_unacked() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        state.unacked.push_back(UnackedPacket {
            seq: 100,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.unacked.push_back(UnackedPacket {
            seq: 101,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.handle_inbound_ack(102);
        assert!(state.unacked.is_empty());
        assert_eq!(state.last_acked_psn, 101);
    }

    #[test]
    fn handle_inbound_ack_partial_drains() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        state.unacked.push_back(UnackedPacket {
            seq: 100,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.unacked.push_back(UnackedPacket {
            seq: 101,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.handle_inbound_ack(101);
        assert!(state.unacked.is_empty());
        assert_eq!(state.last_acked_psn, 101);
    }

    #[test]
    fn handle_inbound_ack_handles_psn_wrap() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(127, 65535, 3));
        state.unacked.push_back(UnackedPacket {
            seq: 254,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.unacked.push_back(UnackedPacket {
            seq: 255,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.unacked.push_back(UnackedPacket {
            seq: 0,
            wire: Bytes::new(),
            deadline: Instant::now(),
            retry_count: 0,
        });
        state.handle_inbound_ack(1);
        assert!(state.unacked.is_empty());
        assert_eq!(state.last_acked_psn, 0);
    }

    #[test]
    fn window_has_room_respects_max_outgoing() {
        let mut state = EstablishedState::new(99, 50, &test_lsp(2, 65535, 3));
        assert!(state.window_has_room());
        for seq in 100..102 {
            state.unacked.push_back(UnackedPacket {
                seq,
                wire: Bytes::new(),
                deadline: Instant::now(),
                retry_count: 0,
            });
        }
        assert!(!state.window_has_room());
    }
}
