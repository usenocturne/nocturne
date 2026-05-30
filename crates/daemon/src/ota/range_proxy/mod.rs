use bluer::Address;
use libnocturne::gateway::{OtaAssetRange, OtaAssetRangeAbandon, OtaAssetRangeChunk};
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::ota::{OtaEvent, OtaEventTx};

mod server;

const BROKER_MAILBOX: usize = 64;
const CHUNK_QUEUE: usize = 16;

#[derive(Clone)]
pub struct RangeProxy {
    cmd_tx: mpsc::Sender<BrokerCmd>,
}

impl std::fmt::Debug for RangeProxy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RangeProxy").finish_non_exhaustive()
    }
}

pub struct RangeProxyHandle {
    pub proxy: RangeProxy,
    _cancel: CancellationToken,
    _broker: JoinHandle<()>,
    _server: Option<JoinHandle<()>>,
}

impl RangeProxy {
    pub async fn spawn(events_tx: OtaEventTx, port: u16) -> RangeProxyHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(BROKER_MAILBOX);
        let cancel = CancellationToken::new();

        let broker = BrokerActor {
            cmd_rx,
            active: None,
            inflight: Default::default(),
            events_tx,
        };
        let _broker = tokio::spawn(broker.run());

        let proxy = RangeProxy { cmd_tx };
        let _server = match server::spawn(proxy.clone(), port, cancel.clone()).await {
            Ok(handle) => Some(handle),
            Err(err) => {
                tracing::error!(
                    ?err,
                    "ota range proxy failed to bind 127.0.0.1:{port}; delta OTA over wire unavailable until restart",
                );
                None
            }
        };

        RangeProxyHandle {
            proxy,
            _cancel: cancel,
            _broker,
            _server,
        }
    }

    pub async fn activate(&self, update_id: String, peer: Option<Address>) {
        if let Err(err) = self
            .cmd_tx
            .send(BrokerCmd::Activate { update_id, peer })
            .await
        {
            tracing::error!(?err, "range proxy mailbox closed; activate dropped");
        }
    }

    pub async fn deactivate(&self) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::Deactivate).await {
            tracing::error!(?err, "range proxy mailbox closed; deactivate dropped");
        }
    }

    pub async fn route_chunk(&self, chunk: OtaAssetRangeChunk) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::RouteChunk(chunk)).await {
            tracing::error!(?err, "range proxy mailbox closed; chunk dropped");
        }
    }

    pub(crate) async fn begin_range_active(
        &self,
        request_id: Uuid,
        chunk_tx: mpsc::Sender<OtaAssetRangeChunk>,
    ) -> Result<RangeBegin, BeginRangeError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(BrokerCmd::BeginRange {
                request_id,
                chunk_tx,
                reply: reply_tx,
            })
            .await
            .map_err(|_| BeginRangeError::ProxyDown)?;
        reply_rx.await.map_err(|_| BeginRangeError::ProxyDown)?
    }

    pub(crate) async fn end_range(&self, request_id: Uuid) {
        let _ = self.cmd_tx.send(BrokerCmd::EndRange { request_id }).await;
    }

    pub(crate) async fn send_asset_range(&self, request_id: Uuid, req: OtaAssetRange) {
        let _ = self
            .cmd_tx
            .send(BrokerCmd::SendAssetRange { request_id, req })
            .await;
    }

    pub(crate) async fn abandon_range(&self, request_id: Uuid) {
        let _ = self
            .cmd_tx
            .send(BrokerCmd::SendAssetRangeAbandon(OtaAssetRangeAbandon {
                request_id,
            }))
            .await;
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RangeBegin {
    pub update_id: String,
}

#[derive(Debug)]
pub(crate) enum BeginRangeError {
    NoActiveOta,
    ProxyDown,
}

#[derive(Debug)]
enum BrokerCmd {
    Activate {
        update_id: String,
        peer: Option<Address>,
    },
    Deactivate,
    BeginRange {
        request_id: Uuid,
        chunk_tx: mpsc::Sender<OtaAssetRangeChunk>,
        reply: oneshot::Sender<Result<RangeBegin, BeginRangeError>>,
    },
    RouteChunk(OtaAssetRangeChunk),
    EndRange {
        request_id: Uuid,
    },
    SendAssetRange {
        request_id: Uuid,
        req: OtaAssetRange,
    },
    SendAssetRangeAbandon(OtaAssetRangeAbandon),
}

#[derive(Debug, Clone)]
struct ActiveOta {
    update_id: String,
    peer: Option<Address>,
}

struct BrokerActor {
    cmd_rx: mpsc::Receiver<BrokerCmd>,
    active: Option<ActiveOta>,
    inflight: std::collections::HashMap<Uuid, mpsc::Sender<OtaAssetRangeChunk>>,
    events_tx: OtaEventTx,
}

impl BrokerActor {
    async fn run(mut self) {
        tracing::info!("ota range proxy broker started");
        while let Some(cmd) = self.cmd_rx.recv().await {
            match cmd {
                BrokerCmd::Activate { update_id, peer } => {
                    tracing::info!(%update_id, ?peer, "range proxy activated");
                    self.active = Some(ActiveOta { update_id, peer });
                }
                BrokerCmd::Deactivate => {
                    if let Some(active) = self.active.take() {
                        tracing::info!(update_id = %active.update_id, "range proxy deactivated");
                    }
                    self.inflight.clear();
                }
                BrokerCmd::BeginRange {
                    request_id,
                    chunk_tx,
                    reply,
                } => {
                    let result = match &self.active {
                        None => Err(BeginRangeError::NoActiveOta),
                        Some(active) => {
                            self.inflight.insert(request_id, chunk_tx);
                            Ok(RangeBegin {
                                update_id: active.update_id.clone(),
                            })
                        }
                    };
                    let _ = reply.send(result);
                }
                BrokerCmd::RouteChunk(chunk) => {
                    let request_id = chunk.request_id;
                    if let Some(tx) = self.inflight.get(&request_id) {
                        if tx.send(chunk).await.is_err() {
                            tracing::debug!(%request_id, "inflight chunk channel closed; evicting");
                            self.inflight.remove(&request_id);
                        }
                    } else {
                        tracing::debug!(
                            %request_id,
                            "OtaAssetRangeChunk for unknown request_id; libcurl probably timed out",
                        );
                    }
                }
                BrokerCmd::EndRange { request_id } => {
                    self.inflight.remove(&request_id);
                }
                BrokerCmd::SendAssetRange { request_id, req } => {
                    let peer = self.active.as_ref().and_then(|active| active.peer);
                    let _ = self
                        .events_tx
                        .send(OtaEvent::AssetRange {
                            peer,
                            request_id,
                            req,
                        })
                        .await;
                }
                BrokerCmd::SendAssetRangeAbandon(abandon) => {
                    self.inflight.remove(&abandon.request_id);
                    let peer = self.active.as_ref().and_then(|active| active.peer);
                    let _ = self
                        .events_tx
                        .send(OtaEvent::AssetRangeAbandon { peer, abandon })
                        .await;
                }
            }
        }
        tracing::info!("ota range proxy broker exiting");
    }
}

#[cfg(test)]
pub fn noop_proxy() -> RangeProxy {
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<BrokerCmd>(16);
    let (_events_tx, _events_rx) = mpsc::channel::<OtaEvent>(16);
    tokio::spawn(async move { while cmd_rx.recv().await.is_some() {} });
    RangeProxy { cmd_tx }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_broker_only() -> RangeProxy {
        let (cmd_tx, cmd_rx) = mpsc::channel(16);
        let (events_tx, _events_rx) = mpsc::channel(16);
        let broker = BrokerActor {
            cmd_rx,
            active: None,
            inflight: Default::default(),
            events_tx,
        };
        tokio::spawn(broker.run());
        RangeProxy { cmd_tx }
    }

    #[tokio::test]
    async fn route_chunk_delivers_to_inflight_request() {
        let proxy = spawn_broker_only();
        proxy.activate("active".into(), None).await;
        let req_id = Uuid::new_v4();
        let (chunk_tx, mut chunk_rx) = mpsc::channel(4);
        proxy.begin_range_active(req_id, chunk_tx).await.unwrap();

        let chunk = OtaAssetRangeChunk {
            request_id: req_id,
            part_index: 0,
            offset: 0,
            bytes: vec![1, 2, 3],
            last: true,
        };
        proxy.route_chunk(chunk).await;
        let received = tokio::time::timeout(std::time::Duration::from_secs(1), chunk_rx.recv())
            .await
            .expect("timed out")
            .expect("channel closed");
        assert_eq!(received.bytes, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn begin_range_with_no_active_returns_no_active_ota() {
        let proxy = spawn_broker_only();
        // broker starts Inactive (no activate call)
        let req_id = Uuid::new_v4();
        let (chunk_tx, _chunk_rx) = mpsc::channel(4);
        let err = proxy
            .begin_range_active(req_id, chunk_tx)
            .await
            .unwrap_err();
        assert!(
            matches!(err, BeginRangeError::NoActiveOta),
            "expected NoActiveOta, got {err:?}"
        );
    }

    #[tokio::test]
    async fn deactivate_clears_inflight_so_route_chunk_drops() {
        let proxy = spawn_broker_only();
        proxy.activate("active".into(), None).await;
        let req_id = Uuid::new_v4();
        let (chunk_tx, mut chunk_rx) = mpsc::channel(4);
        proxy.begin_range_active(req_id, chunk_tx).await.unwrap();

        // Deactivate clears inflight map
        proxy.deactivate().await;

        // Give the broker time to process the deactivate command
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let chunk = OtaAssetRangeChunk {
            request_id: req_id,
            part_index: 0,
            offset: 0,
            bytes: vec![9, 8, 7],
            last: true,
        };
        proxy.route_chunk(chunk).await;

        // Give the broker time to process the route command
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // The inflight entry was cleared by deactivate, so the chunk was dropped.
        // chunk_rx should have nothing.
        let result = chunk_rx.try_recv();
        assert!(
            result.is_err(),
            "chunk should have been dropped after deactivate"
        );
    }
}
