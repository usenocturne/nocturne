//! Role-agnostic External Accessory stream transport for iAP2 link
//! session id 3. Both roles frame EA stream data identically: a u16-BE
//! stream-id prefix per chunk, split at the negotiated link payload
//! budget, with two priority lanes (Normal preempts Bulk at chunk
//! boundaries). The accessory ([`super::external_accessory::EaFlow`])
//! and the device emulator share this; only the control-plane CSMs that
//! open and close streams differ by role.

use bytes::{Bytes, BytesMut};
use tokio::{sync::mpsc, task::JoinHandle};

use crate::link::Iap2Command;

/// Link session id used by `Lsp::accessory_default` for EA traffic. Must match the
/// `SessionTriple { session_type: 2, ... }` declared in the SYN.
pub(crate) const EA_LINK_SESSION_ID: u8 = 3;

const LANE_CAPACITY: usize = 16;
const EA_STREAM_ID_PREFIX_LEN: usize = 2;
// Negotiated max_len includes the 9-byte link header and 1-byte payload checksum.
const EA_LINK_FRAME_OVERHEAD: usize = 10;

type FramedBytes = (u16, Bytes);

struct LaneBuffer {
    rx: mpsc::Receiver<FramedBytes>,
    queue: std::collections::VecDeque<FramedBytes>,
}

impl LaneBuffer {
    fn drain_ready(&mut self) {
        while self.queue.len() < LANE_CAPACITY {
            let Ok(frame) = self.rx.try_recv() else {
                break;
            };
            self.queue.push_back(frame);
        }
    }

    fn next_packet(&mut self, max_payload: usize) -> Option<(u16, Bytes)> {
        let stream_id = self.queue.front().map(|(id, _)| *id)?;
        let mut payload = BytesMut::with_capacity(max_payload.min(u16::MAX as usize));

        while payload.len() < max_payload {
            let Some((queued_stream_id, bytes)) = self.queue.front_mut() else {
                break;
            };
            if *queued_stream_id != stream_id {
                break;
            }

            let take = (max_payload - payload.len()).min(bytes.len());
            payload.extend_from_slice(&bytes.split_to(take));
            if bytes.is_empty() {
                self.queue.pop_front();
            }
        }

        Some((stream_id, payload.freeze()))
    }
}

/// Lane priority hint a consumer attaches when sending bytes on an EA stream.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum EaPriority {
    #[default]
    Normal,
    Bulk,
}

#[derive(Debug, thiserror::Error)]
pub enum EaSendError {
    #[error("EA chunker is no longer running for this link")]
    ChannelClosed,
}

/// Outbound side of an EA stream, bound to one stream id. [`EaStreamSender::send`] tags each frame
/// with that id and posts it to the matching priority lane on the chunker's fan-in.
#[derive(Debug, Clone)]
pub struct EaStreamSender {
    stream_id: u16,
    normal_tx: mpsc::Sender<FramedBytes>,
    bulk_tx: mpsc::Sender<FramedBytes>,
}

impl EaStreamSender {
    pub fn stream_id(&self) -> u16 {
        self.stream_id
    }

    pub async fn send(
        &self,
        priority: EaPriority,
        frame: Bytes,
    ) -> std::result::Result<(), EaSendError> {
        let lane = match priority {
            EaPriority::Normal => &self.normal_tx,
            EaPriority::Bulk => &self.bulk_tx,
        };
        lane.send((self.stream_id, frame))
            .await
            .map_err(|_| EaSendError::ChannelClosed)
    }
}

/// Owns the priority-lane fan-in and the chunker task that drains it
/// onto link session 3. Hand out per-stream [`EaStreamSender`]s with
/// [`EaChunker::sender`].
pub(crate) struct EaChunker {
    normal_tx: mpsc::Sender<FramedBytes>,
    bulk_tx: mpsc::Sender<FramedBytes>,
    _handle: JoinHandle<()>,
}

impl EaChunker {
    pub(crate) fn new(link_command_tx: mpsc::Sender<Iap2Command>, peer_max_len: u16) -> Self {
        let (normal_tx, normal_rx) = mpsc::channel(LANE_CAPACITY);
        let (bulk_tx, bulk_rx) = mpsc::channel(LANE_CAPACITY);
        let max_chunk = max_chunk_payload(peer_max_len);
        let _handle = tokio::spawn(chunker_task(normal_rx, bulk_rx, link_command_tx, max_chunk));
        Self {
            normal_tx,
            bulk_tx,
            _handle,
        }
    }

    pub(crate) fn sender(&self, stream_id: u16) -> EaStreamSender {
        EaStreamSender {
            stream_id,
            normal_tx: self.normal_tx.clone(),
            bulk_tx: self.bulk_tx.clone(),
        }
    }
}

/// Strip the leading u16-BE stream-id prefix from a session-3 link
/// payload, returning `(stream_id, rest)`. `None` if the payload is too
/// short to carry a prefix.
pub(crate) fn split_stream_frame(payload: &Bytes) -> Option<(u16, Bytes)> {
    if payload.len() < 2 {
        return None;
    }
    let stream_id = u16::from_be_bytes([payload[0], payload[1]]);
    Some((stream_id, payload.slice(2..)))
}

const fn max_chunk_payload(peer_max_len: u16) -> usize {
    let overhead = EA_LINK_FRAME_OVERHEAD + EA_STREAM_ID_PREFIX_LEN;
    let total = peer_max_len as usize;
    if total <= overhead {
        1
    } else {
        total - overhead
    }
}

async fn chunker_task(
    normal_rx: mpsc::Receiver<FramedBytes>,
    bulk_rx: mpsc::Receiver<FramedBytes>,
    link_tx: mpsc::Sender<Iap2Command>,
    max_chunk_payload: usize,
) {
    let lane = |rx| LaneBuffer {
        rx,
        queue: std::collections::VecDeque::new(),
    };
    let mut normal = lane(normal_rx);
    let mut bulk = lane(bulk_rx);

    loop {
        normal.drain_ready();
        bulk.drain_ready();

        let next = if !normal.queue.is_empty() {
            normal.next_packet(max_chunk_payload)
        } else {
            bulk.next_packet(max_chunk_payload)
        };
        if let Some((stream_id, payload)) = next {
            if !send_packet(&link_tx, stream_id, payload).await {
                return;
            }
            continue;
        }

        tokio::select! {
          biased;
          Some(frame) = normal.rx.recv() => normal.queue.push_back(frame),
          Some(frame) = bulk.rx.recv() => bulk.queue.push_back(frame),
          else => return,
        }
    }
}

async fn send_packet(link_tx: &mpsc::Sender<Iap2Command>, stream_id: u16, payload: Bytes) -> bool {
    let mut wire = BytesMut::with_capacity(EA_STREAM_ID_PREFIX_LEN + payload.len());
    wire.extend_from_slice(&stream_id.to_be_bytes());
    wire.extend_from_slice(&payload);
    link_tx
        .send(Iap2Command::Send {
            session_id: EA_LINK_SESSION_ID,
            payload: wire.freeze(),
        })
        .await
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain_chunks(rx: &mut mpsc::Receiver<Iap2Command>) -> Vec<Bytes> {
        let mut out = Vec::new();
        while let Ok(cmd) = rx.try_recv() {
            if let Iap2Command::Send {
                session_id,
                payload,
            } = cmd
            {
                assert_eq!(session_id, EA_LINK_SESSION_ID);
                out.push(payload);
            }
        }
        out
    }

    fn assert_chunk(payload: &Bytes, expected_stream: u16, expected_data: &[u8]) {
        assert!(payload.len() >= 2);
        let stream = u16::from_be_bytes([payload[0], payload[1]]);
        assert_eq!(stream, expected_stream);
        assert_eq!(&payload[2..], expected_data);
    }

    #[tokio::test]
    async fn chunker_splits_large_frame() {
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (_b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, 4));

        let payload = Bytes::from_static(&[1, 2, 3, 4, 5, 6, 7, 8, 9]);
        n_tx.send((0x0100, payload)).await.unwrap();
        drop(n_tx);

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let chunks = drain_chunks(&mut link_rx);
        assert_eq!(chunks.len(), 3, "9 bytes / 4 chunk size = 3 chunks");
        assert_chunk(&chunks[0], 0x0100, &[1, 2, 3, 4]);
        assert_chunk(&chunks[1], 0x0100, &[5, 6, 7, 8]);
        assert_chunk(&chunks[2], 0x0100, &[9]);
    }

    #[tokio::test]
    async fn chunker_normal_preempts_bulk_at_chunk_boundary() {
        let (link_tx, mut link_rx) = mpsc::channel(1);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, 4));

        b_tx.send((
            0x0200,
            Bytes::from_static(&[
                0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB,
            ]),
        ))
        .await
        .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while link_rx.len() == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("first bulk chunk should reach the backpressured link channel");

        n_tx.send((0x0100, Bytes::from_static(&[0xA0, 0xA1])))
            .await
            .unwrap();

        drop(n_tx);
        drop(b_tx);

        let mut chunks = Vec::new();
        for _ in 0..4 {
            let command = tokio::time::timeout(std::time::Duration::from_secs(1), link_rx.recv())
                .await
                .expect("chunker should not stall")
                .expect("chunker should emit all queued chunks");
            let Iap2Command::Send {
                session_id,
                payload,
            } = command
            else {
                panic!("chunker emitted an unexpected disconnect");
            };
            assert_eq!(session_id, EA_LINK_SESSION_ID);
            chunks.push(payload);
        }

        let stream_seq: Vec<u16> = chunks
            .iter()
            .map(|p| u16::from_be_bytes([p[0], p[1]]))
            .collect();
        let normal_position = stream_seq
            .iter()
            .position(|stream_id| *stream_id == 0x0100)
            .expect("normal chunk should be emitted");
        assert!(normal_position > 0, "bulk must start first: {stream_seq:?}");
        assert!(
            normal_position < stream_seq.len() - 1,
            "normal must preempt before queued bulk finishes: {stream_seq:?}"
        );
        let collected_bulk: Vec<u8> = chunks
            .iter()
            .filter(|p| u16::from_be_bytes([p[0], p[1]]) == 0x0200)
            .flat_map(|p| p[2..].to_vec())
            .collect();
        assert_eq!(
            collected_bulk,
            vec![0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7, 0xB8, 0xB9, 0xBA, 0xBB,]
        );
    }

    #[tokio::test]
    async fn chunker_coalesces_same_stream_frames_into_full_packets() {
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (_b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, 4));

        n_tx.send((0x0100, Bytes::from_static(&[1, 2, 3])))
            .await
            .unwrap();
        n_tx.send((0x0100, Bytes::from_static(&[4, 5, 6])))
            .await
            .unwrap();
        drop(n_tx);
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;

        let chunks = drain_chunks(&mut link_rx);
        let sizes: Vec<usize> = chunks
            .iter()
            .map(|payload| payload.len() - EA_STREAM_ID_PREFIX_LEN)
            .collect();
        assert_eq!(sizes, vec![4, 2]);
        let collected: Vec<u8> = chunks
            .iter()
            .flat_map(|payload| payload[EA_STREAM_ID_PREFIX_LEN..].to_vec())
            .collect();
        assert_eq!(collected, vec![1, 2, 3, 4, 5, 6]);
    }

    #[tokio::test]
    async fn chunker_never_coalesces_different_streams() {
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (_b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, 8));

        n_tx.send((0x0100, Bytes::from_static(&[1, 2, 3])))
            .await
            .unwrap();
        n_tx.send((0x0200, Bytes::from_static(&[4, 5, 6])))
            .await
            .unwrap();
        drop(n_tx);
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;

        let chunks = drain_chunks(&mut link_rx);
        assert_eq!(chunks.len(), 2);
        assert_chunk(&chunks[0], 0x0100, &[1, 2, 3]);
        assert_chunk(&chunks[1], 0x0200, &[4, 5, 6]);
    }

    #[test]
    fn split_stream_frame_extracts_prefix() {
        let mut wire = BytesMut::new();
        wire.extend_from_slice(&0x0100u16.to_be_bytes());
        wire.extend_from_slice(&[0xDE, 0xAD]);
        let (id, rest) = split_stream_frame(&wire.freeze()).unwrap();
        assert_eq!(id, 0x0100);
        assert_eq!(&rest[..], &[0xDE, 0xAD]);
    }

    #[test]
    fn split_stream_frame_rejects_short() {
        assert!(split_stream_frame(&Bytes::from_static(&[0x01])).is_none());
    }

    #[test]
    fn lane_buffer_drain_remains_bounded() {
        let (tx, rx) = mpsc::channel(LANE_CAPACITY);
        for _ in 0..LANE_CAPACITY {
            tx.try_send((0x0100, Bytes::from_static(&[0xAB]))).unwrap();
        }

        let mut lane = LaneBuffer {
            rx,
            queue: std::collections::VecDeque::new(),
        };
        lane.drain_ready();
        assert_eq!(lane.queue.len(), LANE_CAPACITY);

        for _ in 0..LANE_CAPACITY {
            tx.try_send((0x0100, Bytes::from_static(&[0xCD]))).unwrap();
        }
        lane.drain_ready();
        assert_eq!(lane.queue.len(), LANE_CAPACITY);
        assert_eq!(lane.rx.len(), LANE_CAPACITY);
    }

    #[test]
    fn ea_overhead_matches_link_codec() {
        assert_eq!(EA_LINK_FRAME_OVERHEAD, crate::frame::LINK_FRAME_OVERHEAD);
    }

    #[tokio::test]
    async fn prefixed_packet_never_exceeds_link_payload_budget() {
        let peer_max_len = 4096;
        let link_payload_budget = peer_max_len as usize - EA_LINK_FRAME_OVERHEAD;
        let max_chunk = max_chunk_payload(peer_max_len);

        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (_b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, max_chunk));

        n_tx.send((0x0100, Bytes::from(vec![0xAB; max_chunk * 3 + 7])))
            .await
            .unwrap();
        drop(n_tx);
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;

        let chunks = drain_chunks(&mut link_rx);
        assert!(!chunks.is_empty());
        for chunk in chunks {
            assert!(chunk.len() <= link_payload_budget);
        }
    }
}
