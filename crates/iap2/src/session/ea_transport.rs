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

type FramedBytes = (u16, Bytes);

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
    // 2 bytes of the link budget go to the stream-id prefix.
    let total = peer_max_len as usize;
    if total <= 2 {
        1
    } else {
        total - 2
    }
}

async fn chunker_task(
    mut normal_rx: mpsc::Receiver<FramedBytes>,
    mut bulk_rx: mpsc::Receiver<FramedBytes>,
    link_tx: mpsc::Sender<Iap2Command>,
    max_chunk_payload: usize,
) {
    let mut pending_normal: Option<FramedBytes> = None;
    let mut pending_bulk: Option<FramedBytes> = None;

    loop {
        if let Some((stream_id, mut bytes)) = pending_normal.take() {
            if !send_one_chunk(&link_tx, stream_id, &mut bytes, max_chunk_payload).await {
                return;
            }
            if !bytes.is_empty() {
                pending_normal = Some((stream_id, bytes));
            }
            continue;
        }

        if let Ok(frame) = normal_rx.try_recv() {
            pending_normal = Some(frame);
            continue;
        }

        if let Some((stream_id, mut bytes)) = pending_bulk.take() {
            if !send_one_chunk(&link_tx, stream_id, &mut bytes, max_chunk_payload).await {
                return;
            }
            if !bytes.is_empty() {
                pending_bulk = Some((stream_id, bytes));
            }
            continue;
        }

        if let Ok(frame) = bulk_rx.try_recv() {
            pending_bulk = Some(frame);
            continue;
        }

        let next = tokio::select! {
          biased;
          Some(f) = normal_rx.recv() => (Lane::Normal, f),
          Some(f) = bulk_rx.recv() => (Lane::Bulk, f),
          else => return,
        };
        match next.0 {
            Lane::Normal => pending_normal = Some(next.1),
            Lane::Bulk => pending_bulk = Some(next.1),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Lane {
    Normal,
    Bulk,
}

async fn send_one_chunk(
    link_tx: &mpsc::Sender<Iap2Command>,
    stream_id: u16,
    bytes: &mut Bytes,
    max_chunk_payload: usize,
) -> bool {
    let take = bytes.len().min(max_chunk_payload);
    let chunk = bytes.split_to(take);
    let mut wire = BytesMut::with_capacity(2 + chunk.len());
    wire.extend_from_slice(&stream_id.to_be_bytes());
    wire.extend_from_slice(&chunk);
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
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (n_tx, n_rx) = mpsc::channel(8);
        let (b_tx, b_rx) = mpsc::channel(8);
        tokio::spawn(chunker_task(n_rx, b_rx, link_tx, 4));

        b_tx.send((
            0x0200,
            Bytes::from_static(&[0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7]),
        ))
        .await
        .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        n_tx.send((0x0100, Bytes::from_static(&[0xA0, 0xA1])))
            .await
            .unwrap();

        drop(n_tx);
        drop(b_tx);
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;

        let chunks = drain_chunks(&mut link_rx);
        let stream_seq: Vec<u16> = chunks
            .iter()
            .map(|p| u16::from_be_bytes([p[0], p[1]]))
            .collect();
        assert!(
            stream_seq
                .windows(2)
                .any(|w| w[0] == 0x0200 && w[1] == 0x0100),
            "Normal stream chunk lands between Bulk chunks (got {:?})",
            stream_seq
        );
        let collected_bulk: Vec<u8> = chunks
            .iter()
            .filter(|p| u16::from_be_bytes([p[0], p[1]]) == 0x0200)
            .flat_map(|p| p[2..].to_vec())
            .collect();
        assert_eq!(
            collected_bulk,
            vec![0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7]
        );
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
}
