//! Dedicated worker that owns the MFi coprocessor handle.
//!
//! `MfiAuth::cert` and `MfiAuth::sign` are blocking I²C ops; sign in
//! particular sleeps ~500 ms inside the chip's signing window. The
//! session task can't call them inline without stalling the runtime.
//! [`WorkerMfiAccess`] owns the chip on a dedicated thread; per-iPhone
//! sessions hold a [`MfiHandle`] - a cheap clone of the request
//! channel that implements [`MfiAccess`]. The worker exits when the
//! last `MfiHandle` (and the parent `WorkerMfiAccess`) drops, closing
//! the request channel.

use std::thread::JoinHandle;

use async_trait::async_trait;
use bytes::Bytes;
use iap2_mfi::{Error as MfiError, MfiAuth, Transport, CHALLENGE_LEN, RESPONSE_LEN};
use tokio::sync::{mpsc, oneshot};

use super::{MfiAccess, MfiResult};

enum MfiRequest {
    Cert(oneshot::Sender<Result<Bytes, MfiError>>),
    Sign {
        challenge: [u8; CHALLENGE_LEN],
        reply: oneshot::Sender<Result<[u8; RESPONSE_LEN], MfiError>>,
    },
}

/// Lifecycle owner for the MFi worker thread. [`Self::handle`] hands out a cloneable
/// [`MfiHandle`] per [`crate::Iap2Session`]; the thread runs until every handle and this owner drop.
#[derive(Debug)]
pub struct WorkerMfiAccess {
    tx: mpsc::Sender<MfiRequest>,
    _join: JoinHandle<()>,
}

impl WorkerMfiAccess {
    pub fn spawn<T>(mfi: MfiAuth<T>) -> Self
    where
        T: Transport + Send + 'static,
    {
        let (tx, rx) = mpsc::channel(8);
        let join = std::thread::Builder::new()
            .name("iap2-mfi-worker".into())
            .spawn(move || worker_loop(mfi, rx))
            .expect("spawn iap2-mfi-worker thread");
        Self { tx, _join: join }
    }

    /// Cheap clone of the request channel. Hand one of these to each
    /// `Iap2Session`; they all funnel through the single worker thread.
    pub fn handle(&self) -> MfiHandle {
        MfiHandle {
            tx: self.tx.clone(),
        }
    }
}

/// Cloneable [`MfiAccess`] handle backed by a [`WorkerMfiAccess`] thread. Requests from every
/// clone serialize through the single mpsc to the worker.
#[derive(Clone, Debug)]
pub struct MfiHandle {
    tx: mpsc::Sender<MfiRequest>,
}

#[async_trait]
impl MfiAccess for MfiHandle {
    async fn cert(&mut self) -> MfiResult<Bytes> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(MfiRequest::Cert(reply_tx))
            .await
            .map_err(|_| {
                MfiError::Transport(iap2_mfi::TransportError::Other("mfi worker gone".into()))
            })?;
        reply_rx.await.map_err(|_| {
            MfiError::Transport(iap2_mfi::TransportError::Other(
                "mfi worker dropped reply".into(),
            ))
        })?
    }

    async fn sign(&mut self, challenge: [u8; CHALLENGE_LEN]) -> MfiResult<[u8; RESPONSE_LEN]> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(MfiRequest::Sign {
                challenge,
                reply: reply_tx,
            })
            .await
            .map_err(|_| {
                MfiError::Transport(iap2_mfi::TransportError::Other("mfi worker gone".into()))
            })?;
        reply_rx.await.map_err(|_| {
            MfiError::Transport(iap2_mfi::TransportError::Other(
                "mfi worker dropped reply".into(),
            ))
        })?
    }
}

fn worker_loop<T: Transport>(mut mfi: MfiAuth<T>, mut rx: mpsc::Receiver<MfiRequest>) {
    while let Some(req) = rx.blocking_recv() {
        match req {
            MfiRequest::Cert(reply) => {
                let r = mfi.cert().map(Bytes::from);
                let _ = reply.send(r);
            }
            MfiRequest::Sign { challenge, reply } => {
                let r = mfi.sign(&challenge);
                let _ = reply.send(r);
            }
        }
    }
}
