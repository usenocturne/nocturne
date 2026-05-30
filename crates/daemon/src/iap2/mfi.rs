use std::sync::mpsc;
use std::thread::JoinHandle;

use async_trait::async_trait;
use bytes::Bytes;
use iap2_rs::{MfiAccess, MfiError, TransportError, CHALLENGE_LEN, RESPONSE_LEN};
use tokio::sync::oneshot;

use crate::hardware::MfiChip;

enum MfiRequest {
    Cert(oneshot::Sender<Result<Bytes, MfiError>>),
    Sign {
        challenge: [u8; CHALLENGE_LEN],
        reply: oneshot::Sender<Result<[u8; RESPONSE_LEN], MfiError>>,
    },
}

pub struct HardwareMfiProvider {
    tx: mpsc::Sender<MfiRequest>,
    _worker: JoinHandle<()>,
}

impl HardwareMfiProvider {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("nocturned-mfi-worker".to_string())
            .spawn(move || worker_loop(MfiChip::new(), rx))
            .expect("spawn nocturned-mfi-worker thread");
        Self {
            tx,
            _worker: worker,
        }
    }
}

#[async_trait]
impl MfiAccess for HardwareMfiProvider {
    async fn cert(&mut self) -> Result<Bytes, MfiError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(MfiRequest::Cert(reply_tx))
            .map_err(|_| mfi_error("mfi worker gone"))?;
        reply_rx
            .await
            .map_err(|_| mfi_error("mfi worker dropped certificate reply"))?
    }

    async fn sign(
        &mut self,
        challenge: [u8; CHALLENGE_LEN],
    ) -> Result<[u8; RESPONSE_LEN], MfiError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(MfiRequest::Sign {
                challenge,
                reply: reply_tx,
            })
            .map_err(|_| mfi_error("mfi worker gone"))?;
        reply_rx
            .await
            .map_err(|_| mfi_error("mfi worker dropped signature reply"))?
    }
}

fn worker_loop(chip: MfiChip, rx: mpsc::Receiver<MfiRequest>) {
    while let Ok(req) = rx.recv() {
        match req {
            MfiRequest::Cert(reply) => {
                let result = chip
                    .read_certificate()
                    .map(Bytes::from)
                    .map_err(|err| mfi_error(err.to_string()));
                let _ = reply.send(result);
            }
            MfiRequest::Sign { challenge, reply } => {
                let result = chip.challenge_response(&challenge).and_then(|bytes| {
                    bytes.try_into().map_err(|bytes: Vec<u8>| {
                        crate::error::NocturnedError::MfiDevice(format!(
                            "MFi signature must be {RESPONSE_LEN} bytes, got {}",
                            bytes.len()
                        ))
                    })
                });
                let _ = reply.send(result.map_err(|err| mfi_error(err.to_string())));
            }
        }
    }
}

fn mfi_error(message: impl Into<String>) -> MfiError {
    MfiError::Transport(TransportError::Other(message.into()))
}
