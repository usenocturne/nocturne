use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use tokio::sync::broadcast;

use crate::frame::{FrameError, LinkHeader};

pub const DEFAULT_FRAME_TAP_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameTapDirection {
    Inbound,
    Outbound,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameTapEvent {
    InboundFrame {
        raw_bytes: Bytes,
        parsed_header: Option<LinkHeader>,
        timestamp_ms: u64,
    },
    OutboundFrame {
        raw_bytes: Bytes,
        parsed_header: Option<LinkHeader>,
        timestamp_ms: u64,
    },
    Detect {
        direction: FrameTapDirection,
        timestamp_ms: u64,
    },
    ParseError {
        partial_bytes: Bytes,
        error: FrameError,
        timestamp_ms: u64,
    },
}

#[derive(Debug, Clone)]
pub struct FrameTap {
    inner: Arc<FrameTapInner>,
}

#[derive(Debug)]
struct FrameTapInner {
    capacity: usize,
    events: Mutex<VecDeque<FrameTapEvent>>,
    tx: broadcast::Sender<FrameTapEvent>,
}

impl Default for FrameTap {
    fn default() -> Self {
        Self::new(DEFAULT_FRAME_TAP_CAPACITY)
    }
}

impl FrameTap {
    pub fn new(capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let (tx, _) = broadcast::channel(capacity);
        Self {
            inner: Arc::new(FrameTapInner {
                capacity,
                events: Mutex::new(VecDeque::with_capacity(capacity)),
                tx,
            }),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FrameTapEvent> {
        self.inner.tx.subscribe()
    }

    pub fn snapshot(&self) -> Vec<FrameTapEvent> {
        self.inner
            .events
            .lock()
            .expect("frame tap ring poisoned")
            .iter()
            .cloned()
            .collect()
    }

    pub fn drain(&self) -> Vec<FrameTapEvent> {
        self.inner
            .events
            .lock()
            .expect("frame tap ring poisoned")
            .drain(..)
            .collect()
    }

    pub(crate) fn inbound_frame(&self, raw_bytes: Bytes) {
        self.push(FrameTapEvent::InboundFrame {
            parsed_header: LinkHeader::decode(&raw_bytes).ok(),
            raw_bytes,
            timestamp_ms: timestamp_ms(),
        });
    }

    pub(crate) fn outbound_frame(&self, raw_bytes: Bytes) {
        self.push(FrameTapEvent::OutboundFrame {
            parsed_header: LinkHeader::decode(&raw_bytes).ok(),
            raw_bytes,
            timestamp_ms: timestamp_ms(),
        });
    }

    pub(crate) fn detect(&self, direction: FrameTapDirection) {
        self.push(FrameTapEvent::Detect {
            direction,
            timestamp_ms: timestamp_ms(),
        });
    }

    pub(crate) fn parse_error(&self, partial_bytes: Bytes, error: FrameError) {
        self.push(FrameTapEvent::ParseError {
            partial_bytes,
            error,
            timestamp_ms: timestamp_ms(),
        });
    }

    fn push(&self, event: FrameTapEvent) {
        {
            let mut events = self.inner.events.lock().expect("frame tap ring poisoned");
            if events.len() == self.inner.capacity {
                events.pop_front();
            }
            events.push_back(event.clone());
        }
        let _ = self.inner.tx.send(event);
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
