//! iAP2 File Transfer session - the iOS-proactive accessory bound stream
//! that delivers album-art bytes whenever a track changes. Sits on link
//! session id 2 (per `Lsp::accessory_default()`); not a CSM session, the
//! per-packet payload is `[u8 id][u8 op][...]`.
//!
//! State machine per `id`:
//!
//! ```text
//!   (idle)
//!     │  Setup(0x04) total=N type=2
//!     ▼                          ──── reply: SetupAck(0x01)
//!   Buffering ── FirstAndOnly(0xC0) ─── reply: CompleteAck(0x05) ──> emit
//!         │
//!         │  FirstData(0x80) | Data(0x00) ... LastData(0x40)
//!         ▼                          ──── reply: CompleteAck(0x05) ──> emit
//!   Cancel(0x02)  ──> drop buffer (no ack)
//!   Pause(0x03)   ──> log only, partial buffer retained
//! ```
//!
//! Reassembly accepts every Setup-declared file type and emits the
//! result as a generic event the daemon's observer routes by transfer
//! id (artwork vs queue-snapshot vs anything else iOS may push).
//! The reassembly buffer is pre-allocated with the Setup-declared size
//! so we don't grow as bytes arrive. Bytes that exceed the declared
//! size hard-stop the transfer (drops the buffer, drops the future
//! SetupAck).

use std::collections::HashMap;

use bytes::{Buf, Bytes, BytesMut};
use tokio::sync::mpsc;

use crate::{
    error::{Error, Result},
    link::Iap2Command,
    session::SessionEvent,
};

/// Link session id reserved for File Transfer in our LSP. Must match
/// `Lsp::accessory_default()`'s `SessionTriple { id: 2, type: 1 }`.
pub(crate) const FILE_TRANSFER_LINK_SESSION_ID: u8 = 2;

const OP_DATA: u8 = 0x00;
const OP_SETUP_ACK: u8 = 0x01;
const OP_CANCEL: u8 = 0x02;
const OP_PAUSE: u8 = 0x03;
const OP_SETUP: u8 = 0x04;
const OP_COMPLETE_ACK: u8 = 0x05;
const OP_LAST_DATA: u8 = 0x40;
const OP_FIRST_DATA: u8 = 0x80;
const OP_FIRST_AND_ONLY: u8 = 0xC0;

/// File type for `MediaItemArtwork` transfers. Other types emit a generic event upstream.
const FILE_TYPE_ARTWORK: u16 = 2;

#[derive(Debug)]
struct InFlight {
    buffer: BytesMut,
    declared_size: usize,
    file_type: u16,
}

#[derive(Debug)]
pub(crate) struct FileTransferFlow {
    link_command_tx: mpsc::Sender<Iap2Command>,
    in_flight: HashMap<u8, InFlight>,
}

impl FileTransferFlow {
    pub(crate) fn new(link_command_tx: mpsc::Sender<Iap2Command>) -> Self {
        Self {
            link_command_tx,
            in_flight: HashMap::new(),
        }
    }

    /// Decode a session-2 link payload and dispatch to the right
    /// per-id state. Emits `SessionEvent::ArtworkBytes` upstream when
    /// a transfer completes for `file_type == 2`.
    pub(crate) async fn dispatch_link_data(
        &mut self,
        payload: Bytes,
        events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<()> {
        if payload.len() < 2 {
            tracing::warn!(len = payload.len(), "file-transfer: short packet");
            return Ok(());
        }
        let id = payload[0];
        let op = payload[1];
        let rest = payload.slice(2..);

        match op {
            OP_SETUP => self.handle_setup(id, rest).await,
            OP_FIRST_AND_ONLY => self.handle_first_and_only(id, rest, events_tx).await,
            OP_FIRST_DATA => {
                self.handle_chunk(
                    id, rest, /*first*/ true, /*last*/ false, events_tx,
                )
                .await
            }
            OP_DATA => self.handle_chunk(id, rest, false, false, events_tx).await,
            OP_LAST_DATA => self.handle_chunk(id, rest, false, true, events_tx).await,
            OP_CANCEL => {
                tracing::debug!(
                    transfer_id = id,
                    "file-transfer: peer Cancel - dropping buffer"
                );
                self.in_flight.remove(&id);
                Ok(())
            }
            OP_PAUSE => {
                tracing::trace!(
                    transfer_id = id,
                    "file-transfer: peer Pause - retaining partial buffer"
                );
                Ok(())
            }
            OP_SETUP_ACK | OP_COMPLETE_ACK => {
                tracing::warn!(
                    transfer_id = id,
                    op,
                    "file-transfer: ignoring accessory-shape op from peer"
                );
                Ok(())
            }
            _ => {
                tracing::warn!(transfer_id = id, op, "file-transfer: unknown opcode");
                Ok(())
            }
        }
    }

    async fn handle_setup(&mut self, id: u8, mut rest: Bytes) -> Result<()> {
        // two Setup shapes: 11-byte `[u64 size][u8 reserved][u16 type]` and 10-byte `[u64 size][u16 type]`.
        let declared_size = match rest.len() {
            11 => {
                let size = rest.get_u64() as usize;
                let _reserved = rest.get_u8();
                size
            }
            10 => rest.get_u64() as usize,
            _ => {
                tracing::warn!(
                    transfer_id = id,
                    len = rest.len(),
                    "file-transfer: short Setup payload"
                );
                return Ok(());
            }
        };
        let file_type = rest.get_u16();

        tracing::debug!(
            transfer_id = id,
            declared_size,
            file_type,
            "file-transfer: Setup"
        );
        self.in_flight.insert(
            id,
            InFlight {
                buffer: BytesMut::with_capacity(declared_size),
                declared_size,
                file_type,
            },
        );
        self.send_op(id, OP_SETUP_ACK).await
    }

    async fn handle_first_and_only(
        &mut self,
        id: u8,
        body: Bytes,
        events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<()> {
        let Some(state) = self.in_flight.get_mut(&id) else {
            tracing::warn!(
                transfer_id = id,
                "file-transfer: FirstAndOnly without Setup"
            );
            return Ok(());
        };
        if !state.buffer.is_empty() {
            tracing::warn!(
                transfer_id = id,
                existing = state.buffer.len(),
                "file-transfer: FirstAndOnly on partially-filled buffer; resetting"
            );
            state.buffer.clear();
        }
        state.buffer.extend_from_slice(&body);
        self.complete(id, events_tx).await
    }

    async fn handle_chunk(
        &mut self,
        id: u8,
        body: Bytes,
        first: bool,
        last: bool,
        events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<()> {
        let Some(state) = self.in_flight.get_mut(&id) else {
            tracing::warn!(transfer_id = id, "file-transfer: chunk without Setup");
            return Ok(());
        };
        if first && !state.buffer.is_empty() {
            tracing::warn!(
                transfer_id = id,
                existing = state.buffer.len(),
                "file-transfer: FirstData on partially-filled buffer; resetting"
            );
            state.buffer.clear();
        }
        if state.buffer.len() + body.len() > state.declared_size {
            tracing::warn!(
                transfer_id = id,
                accumulated = state.buffer.len() + body.len(),
                declared = state.declared_size,
                "file-transfer: payload exceeds declared size; aborting"
            );
            self.in_flight.remove(&id);
            return Ok(());
        }
        state.buffer.extend_from_slice(&body);
        if last {
            self.complete(id, events_tx).await
        } else {
            Ok(())
        }
    }

    async fn complete(&mut self, id: u8, events_tx: &mpsc::Sender<SessionEvent>) -> Result<()> {
        let Some(state) = self.in_flight.remove(&id) else {
            return Ok(());
        };
        if state.buffer.len() != state.declared_size {
            tracing::warn!(
                transfer_id = id,
                actual = state.buffer.len(),
                declared = state.declared_size,
                "file-transfer: completed transfer size mismatch (still emitting)"
            );
        }
        self.send_op(id, OP_COMPLETE_ACK).await?;

        let bytes = state.buffer.freeze();
        let event = if state.file_type == FILE_TYPE_ARTWORK {
            SessionEvent::ArtworkBytes {
                transfer_id: id,
                bytes,
            }
        } else {
            SessionEvent::QueueSnapshotBytes {
                transfer_id: id,
                bytes,
            }
        };
        let _ = events_tx.send(event).await;
        Ok(())
    }

    async fn send_op(&self, id: u8, op: u8) -> Result<()> {
        let payload = Bytes::copy_from_slice(&[id, op]);
        self.link_command_tx
            .send(Iap2Command::Send {
                session_id: FILE_TRANSFER_LINK_SESSION_ID,
                payload,
            })
            .await
            .map_err(|_| Error::LinkClosed)?;
        Ok(())
    }
}

#[cfg(feature = "emulator")]
pub(crate) use device::DeviceFileTransfer;

/// Device-half (iPhone-side) artwork sender: the inverse of [`FileTransferFlow`].
#[cfg(feature = "emulator")]
mod device {
    use std::collections::HashMap;

    use bytes::{BufMut, Bytes, BytesMut};
    use tokio::sync::mpsc;

    use super::{
        FILE_TRANSFER_LINK_SESSION_ID, FILE_TYPE_ARTWORK, OP_COMPLETE_ACK, OP_DATA,
        OP_FIRST_AND_ONLY, OP_FIRST_DATA, OP_LAST_DATA, OP_SETUP, OP_SETUP_ACK,
    };
    use crate::{
        error::{Error, Result},
        frame::LINK_HEADER_LEN,
        link::Iap2Command,
    };

    /// Per-packet overhead: link header + link payload checksum trailer + the `[id, op]` header.
    /// Bodies are chunked so each `[id, op, chunk]` stays within the negotiated link payload budget;
    /// otherwise the link re-chunks and the accessory misparses the spilled bytes as a bogus `[id, op]`.
    const PER_PACKET_OVERHEAD: usize = LINK_HEADER_LEN + 1 + 2;

    pub(crate) struct DeviceFileTransfer {
        link_command_tx: mpsc::Sender<Iap2Command>,
        chunk_budget: usize,
        pending: HashMap<u8, Bytes>,
    }

    impl DeviceFileTransfer {
        pub(crate) fn new(link_command_tx: mpsc::Sender<Iap2Command>, peer_max_len: u16) -> Self {
            let chunk_budget = (peer_max_len as usize)
                .saturating_sub(PER_PACKET_OVERHEAD)
                .max(1);
            Self {
                link_command_tx,
                chunk_budget,
                pending: HashMap::new(),
            }
        }

        /// Begin an artwork transfer: send Setup (file type 2), stash the
        /// body until the accessory's SetupAck arrives.
        pub(crate) async fn begin_artwork(&mut self, transfer_id: u8, body: Bytes) -> Result<()> {
            let mut setup = BytesMut::with_capacity(12);
            setup.put_u8(transfer_id);
            setup.put_u8(OP_SETUP);
            setup.put_u64(body.len() as u64);
            setup.put_u16(FILE_TYPE_ARTWORK);
            tracing::debug!(
                transfer_id,
                size = body.len(),
                "device file-transfer: Setup"
            );
            self.send(setup.freeze()).await?;
            self.pending.insert(transfer_id, body);
            Ok(())
        }

        /// Route an inbound session-2 link payload. On SetupAck, stream the
        /// stashed body; on CompleteAck, return the finished transfer id.
        pub(crate) async fn on_link_data(&mut self, payload: Bytes) -> Result<Option<u8>> {
            if payload.len() < 2 {
                return Ok(None);
            }
            let id = payload[0];
            match payload[1] {
                OP_SETUP_ACK => {
                    self.send_body(id).await?;
                    Ok(None)
                }
                OP_COMPLETE_ACK => {
                    tracing::debug!(transfer_id = id, "device file-transfer: CompleteAck");
                    Ok(Some(id))
                }
                other => {
                    tracing::trace!(
                        transfer_id = id,
                        op = other,
                        "device file-transfer: ignoring op"
                    );
                    Ok(None)
                }
            }
        }

        async fn send_body(&mut self, id: u8) -> Result<()> {
            let Some(body) = self.pending.remove(&id) else {
                tracing::warn!(
                    transfer_id = id,
                    "device file-transfer: SetupAck for unknown transfer"
                );
                return Ok(());
            };
            if body.len() <= self.chunk_budget {
                self.send(frame(id, OP_FIRST_AND_ONLY, &body)).await?;
                return Ok(());
            }
            let mut remaining = body;
            let first = remaining.split_to(self.chunk_budget);
            self.send(frame(id, OP_FIRST_DATA, &first)).await?;
            while remaining.len() > self.chunk_budget {
                let mid = remaining.split_to(self.chunk_budget);
                self.send(frame(id, OP_DATA, &mid)).await?;
            }
            self.send(frame(id, OP_LAST_DATA, &remaining)).await?;
            Ok(())
        }

        async fn send(&self, payload: Bytes) -> Result<()> {
            self.link_command_tx
                .send(Iap2Command::Send {
                    session_id: FILE_TRANSFER_LINK_SESSION_ID,
                    payload,
                })
                .await
                .map_err(|_| Error::LinkClosed)
        }
    }

    fn frame(id: u8, op: u8, body: &[u8]) -> Bytes {
        let mut p = BytesMut::with_capacity(2 + body.len());
        p.put_u8(id);
        p.put_u8(op);
        p.put_slice(body);
        p.freeze()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow_with_outbox() -> (
        FileTransferFlow,
        mpsc::Receiver<Iap2Command>,
        mpsc::Receiver<SessionEvent>,
        mpsc::Sender<SessionEvent>,
    ) {
        let (link_tx, link_rx) = mpsc::channel(16);
        let (evt_tx, evt_rx) = mpsc::channel(16);
        (FileTransferFlow::new(link_tx), link_rx, evt_rx, evt_tx)
    }

    fn setup_payload(id: u8, size: u64, file_type: u16) -> Bytes {
        let mut p = BytesMut::new();
        p.extend_from_slice(&[id, OP_SETUP]);
        p.extend_from_slice(&size.to_be_bytes());
        p.extend_from_slice(&[0u8]); // reserved
        p.extend_from_slice(&file_type.to_be_bytes());
        p.freeze()
    }

    fn op_only(id: u8, op: u8) -> Bytes {
        Bytes::copy_from_slice(&[id, op])
    }

    fn data_with(id: u8, op: u8, body: &[u8]) -> Bytes {
        let mut p = BytesMut::new();
        p.extend_from_slice(&[id, op]);
        p.extend_from_slice(body);
        p.freeze()
    }

    #[tokio::test]
    async fn first_and_only_round_trip() {
        let (mut flow, mut outbox, mut events, evt_tx) = flow_with_outbox();
        flow.dispatch_link_data(setup_payload(7, 5, 2), &evt_tx)
            .await
            .unwrap();
        let cmd = outbox.recv().await.unwrap();
        match cmd {
            Iap2Command::Send {
                session_id: 2,
                payload,
            } => {
                assert_eq!(&payload[..], &[7, OP_SETUP_ACK]);
            }
            _ => panic!("unexpected command"),
        }

        flow.dispatch_link_data(data_with(7, OP_FIRST_AND_ONLY, b"hello"), &evt_tx)
            .await
            .unwrap();
        let cmd = outbox.recv().await.unwrap();
        match cmd {
            Iap2Command::Send {
                session_id: 2,
                payload,
            } => {
                assert_eq!(&payload[..], &[7, OP_COMPLETE_ACK]);
            }
            _ => panic!("unexpected command"),
        }
        let evt = events.recv().await.unwrap();
        match evt {
            SessionEvent::ArtworkBytes { transfer_id, bytes } => {
                assert_eq!(transfer_id, 7);
                assert_eq!(&bytes[..], b"hello");
            }
            _ => panic!("unexpected event"),
        }
    }

    #[tokio::test]
    async fn multi_chunk_round_trip() {
        let (mut flow, _outbox, mut events, evt_tx) = flow_with_outbox();
        flow.dispatch_link_data(setup_payload(3, 6, 2), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(3, OP_FIRST_DATA, b"ab"), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(3, OP_DATA, b"cd"), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(3, OP_LAST_DATA, b"ef"), &evt_tx)
            .await
            .unwrap();
        let evt = events.recv().await.unwrap();
        match evt {
            SessionEvent::ArtworkBytes { transfer_id, bytes } => {
                assert_eq!(transfer_id, 3);
                assert_eq!(&bytes[..], b"abcdef");
            }
            _ => panic!("unexpected event"),
        }
    }

    #[tokio::test]
    async fn cancel_drops_buffer() {
        let (mut flow, _outbox, mut events, evt_tx) = flow_with_outbox();
        flow.dispatch_link_data(setup_payload(1, 4, 2), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(1, OP_FIRST_DATA, b"ab"), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(op_only(1, OP_CANCEL), &evt_tx)
            .await
            .unwrap();
        // any subsequent Data without Setup is ignored
        flow.dispatch_link_data(data_with(1, OP_LAST_DATA, b"cd"), &evt_tx)
            .await
            .unwrap();
        assert!(events.try_recv().is_err());
    }

    #[tokio::test]
    async fn non_artwork_type_lands_as_queue_snapshot() {
        let (mut flow, mut outbox, mut events, evt_tx) = flow_with_outbox();
        flow.dispatch_link_data(setup_payload(9, 4, 5), &evt_tx)
            .await
            .unwrap();
        let cmd = outbox.recv().await.unwrap();
        if let Iap2Command::Send {
            session_id: 2,
            payload,
        } = cmd
        {
            assert_eq!(&payload[..], &[9, OP_SETUP_ACK]);
        } else {
            panic!("unexpected command");
        }
        flow.dispatch_link_data(data_with(9, OP_FIRST_AND_ONLY, b"abcd"), &evt_tx)
            .await
            .unwrap();
        let _ = outbox.recv().await;
        let evt = events.recv().await.unwrap();
        match evt {
            SessionEvent::QueueSnapshotBytes { transfer_id, bytes } => {
                assert_eq!(transfer_id, 9);
                assert_eq!(&bytes[..], b"abcd");
            }
            _ => panic!("expected QueueSnapshotBytes"),
        }
    }

    #[tokio::test]
    async fn oversize_aborts() {
        let (mut flow, _outbox, mut events, evt_tx) = flow_with_outbox();
        flow.dispatch_link_data(setup_payload(2, 3, 2), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(2, OP_FIRST_DATA, b"abcdef"), &evt_tx)
            .await
            .unwrap();
        flow.dispatch_link_data(data_with(2, OP_LAST_DATA, b""), &evt_tx)
            .await
            .unwrap();
        assert!(events.try_recv().is_err());
    }
}
