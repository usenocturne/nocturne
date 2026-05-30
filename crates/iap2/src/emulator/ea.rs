//! Device-half External Accessory flow: the inverse of
//! [`crate::session::external_accessory::EaFlow`]. The device opens
//! streams (the accessory only ever receives `StartES`), so this drives
//! `StartExternalAccessoryProtocolSession` outbound and consumes the
//! accessory's `StatusES` reply. The session-3 byte transport (chunking
//! outbound, reassembling inbound by stream-id prefix) is the shared
//! [`crate::session::EaChunker`] / [`crate::session::split_stream_frame`],
//! so only the control-plane role differs.

use std::collections::HashMap;

use bytes::Bytes;
use tokio::sync::mpsc;

use crate::{
    csm::external_accessory::{
        EaSessionStatus, StartExternalAccessoryProtocolSession,
        StatusExternalAccessoryProtocolSession,
    },
    link::Iap2Command,
    session::{split_stream_frame, EaChunker, EaStreamSender},
};

const STREAM_INBOUND_CAPACITY: usize = 32;

/// First EA stream id the device allocates, opaque beyond uniqueness
/// within a link; mirrors the real iPhone's 0x0100-range ids.
const FIRST_STREAM_ID: u16 = 0x0100;

/// An opened device-side EA stream surfaced to the consumer.
/// `inbound_rx` yields reassembled bytes the accessory sent on this
/// stream; `outbound` chunks bytes back onto link session 3.
#[derive(Debug)]
pub struct DeviceEaStream {
    pub stream_id: u16,
    pub protocol_id: u8,
    pub inbound_rx: mpsc::Receiver<Bytes>,
    pub outbound: EaStreamSender,
}

pub(crate) struct DeviceEaFlow {
    chunker: EaChunker,
    streams: HashMap<u16, mpsc::Sender<Bytes>>,
    next_session_id: u16,
}

impl DeviceEaFlow {
    pub(crate) fn new(link_command_tx: mpsc::Sender<Iap2Command>, peer_max_len: u16) -> Self {
        Self {
            chunker: EaChunker::new(link_command_tx, peer_max_len),
            streams: HashMap::new(),
            next_session_id: FIRST_STREAM_ID,
        }
    }

    /// Allocate a stream id and set up its inbound routing, returning the
    /// `StartES` CSM to send on the control session plus the stream's channels.
    pub(crate) fn open(
        &mut self,
        protocol_id: u8,
    ) -> (StartExternalAccessoryProtocolSession, DeviceEaStream) {
        let session_id = self.next_session_id;
        self.next_session_id = self.next_session_id.wrapping_add(1);
        let (inbound_tx, inbound_rx) = mpsc::channel(STREAM_INBOUND_CAPACITY);
        self.streams.insert(session_id, inbound_tx);
        let stream = DeviceEaStream {
            stream_id: session_id,
            protocol_id,
            inbound_rx,
            outbound: self.chunker.sender(session_id),
        };
        (
            StartExternalAccessoryProtocolSession {
                protocol_id,
                session_id,
            },
            stream,
        )
    }

    pub(crate) fn handle_status(&mut self, status: StatusExternalAccessoryProtocolSession) {
        match status.status {
            EaSessionStatus::Ok => {
                tracing::debug!(
                    stream_id = status.session_id,
                    "emulator ea: stream confirmed"
                );
            }
            EaSessionStatus::Close => {
                tracing::warn!(
                    stream_id = status.session_id,
                    "emulator ea: accessory refused stream"
                );
                self.streams.remove(&status.session_id);
            }
        }
    }

    /// Route an inbound session-3 link payload to the matching stream's
    /// reassembly channel.
    pub(crate) async fn dispatch_link_data(&mut self, payload: Bytes) {
        let Some((stream_id, chunk)) = split_stream_frame(&payload) else {
            tracing::warn!(
                len = payload.len(),
                "emulator ea: link payload too short for stream-id prefix"
            );
            return;
        };
        let Some(tx) = self.streams.get(&stream_id) else {
            tracing::trace!(stream_id, "emulator ea: link payload for unknown stream");
            return;
        };
        if tx.send(chunk).await.is_err() {
            tracing::debug!(stream_id, "emulator ea: inbound consumer dropped");
            self.streams.remove(&stream_id);
        }
    }
}
