pub mod daemon_swap;
pub mod manifest;
pub mod range_proxy;
pub mod slots;
pub mod swupdate;
pub mod transfer;
pub mod webapp_swap;

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};

use bluer::Address;
use libnocturne::{
    gateway::{
        OtaAssetRange, OtaAssetRangeAbandon, OtaAssetRangeChunk, OtaBegin, OtaBeginAck,
        OtaBeginRejected, OtaChunk,
    },
    OtaError, OtaErrorCode, OtaKind, OtaPhase, OtaProgress,
};
pub use range_proxy::RangeProxy;
use serde::Serialize;
use tokio::{
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tracing::{debug, error, info, warn};

use self::{
    manifest::PersistedState,
    transfer::{ChunkOutcome, ChunkedTransfer, TransferError},
};

const STREAMING_PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(100);
const BANDAID_ROOT: &str = "/var/lib/nocturne/bandaid";

pub type OtaEventTx = mpsc::Sender<OtaEvent>;
pub type TerminatorFn = Arc<dyn Fn() + Send + Sync + 'static>;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum OtaEvent {
    Begin {
        update_id: String,
        kind: OtaKind,
        version: Option<String>,
    },
    Progress(OtaProgress),
    Error(OtaError),
    Complete {
        update_id: String,
    },
    AssetRange {
        #[serde(skip)]
        peer: Option<Address>,
        request_id: uuid::Uuid,
        req: OtaAssetRange,
    },
    AssetRangeAbandon {
        #[serde(skip)]
        peer: Option<Address>,
        abandon: OtaAssetRangeAbandon,
    },
}

#[derive(Clone)]
pub struct OtaTerminators {
    pub reboot: TerminatorFn,
    pub restart_self: TerminatorFn,
}

impl OtaTerminators {
    fn for_kind(&self, kind: OtaKind) -> TerminatorFn {
        match kind {
            OtaKind::Image => self.reboot.clone(),
            OtaKind::Daemon | OtaKind::BuiltinWebapp => self.restart_self.clone(),
        }
    }
}

#[derive(Debug)]
pub enum Command {
    Begin {
        req: OtaBegin,
        peer: Option<Address>,
        ack: oneshot::Sender<Result<OtaBeginAck, OtaBeginRejected>>,
    },
    Chunk(OtaChunk),
    AssetRangeChunk(OtaAssetRangeChunk),
    Abandon {
        update_id: String,
    },
    Cancel,
    WriteFinished,
}

pub struct OtaHandle {
    pub cmd_tx: mpsc::Sender<Command>,
    _join: JoinHandle<()>,
}

pub enum OtaState {
    Idle,
    Streaming {
        kind: OtaKind,
        update_id: String,
        expected_size: u64,
        peer: Option<Address>,
    },
    Writing {
        kind: OtaKind,
        update_id: String,
        peer: Option<Address>,
    },
}

impl OtaState {
    fn pinned_peer(&self) -> Option<Option<Address>> {
        match self {
            Self::Idle => None,
            Self::Streaming { peer, .. } | Self::Writing { peer, .. } => Some(*peer),
        }
    }
}

pub struct OtaActor {
    transfers: ChunkedTransfer,
    events_tx: OtaEventTx,
    terminators: OtaTerminators,
    range_proxy: RangeProxy,
    persist_dir: PathBuf,
    self_tx: mpsc::Sender<Command>,
    cmd_rx: mpsc::Receiver<Command>,
    state: OtaState,
    last_streaming_emit_at: Option<Instant>,
}

impl OtaActor {
    pub fn spawn(
        transfers: ChunkedTransfer,
        events_tx: OtaEventTx,
        terminators: OtaTerminators,
        range_proxy: RangeProxy,
        persist_dir: PathBuf,
    ) -> OtaHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(64);
        let actor = Self {
            transfers,
            events_tx,
            terminators,
            range_proxy,
            persist_dir,
            self_tx: cmd_tx.clone(),
            cmd_rx,
            state: OtaState::Idle,
            last_streaming_emit_at: None,
        };
        let _join = tokio::spawn(actor.run());
        OtaHandle { cmd_tx, _join }
    }

    async fn recover_from_persisted_manifest(&self) {
        match manifest::load(&self.persist_dir).await {
            Ok(Some(state)) => {
                tracing::warn!(
                    update_id = %state.update_id,
                    expected_size = state.expected_size,
                    "recovered persisted OTA manifest from previous run; clearing stale state",
                );
                let path = self.transfers.path(&state.update_id);
                let meta = self.transfers.meta_path(&state.update_id);
                let _ = tokio::fs::remove_file(&path).await;
                let _ = tokio::fs::remove_file(&meta).await;
                clear_manifest(&self.persist_dir).await;
            }
            Ok(None) => {}
            Err(err) => {
                tracing::error!(?err, "failed to read persisted OTA manifest; ignoring");
            }
        }
    }

    async fn run(mut self) {
        info!("ota actor started");
        self.recover_from_persisted_manifest().await;
        while let Some(cmd) = self.cmd_rx.recv().await {
            match cmd {
                Command::Begin { req, peer, ack } => self.handle_begin(req, peer, ack).await,
                Command::Chunk(chunk) => self.handle_chunk(chunk).await,
                Command::AssetRangeChunk(chunk) => self.handle_asset_range_chunk(chunk).await,
                Command::Abandon { update_id } => self.handle_abandon(update_id).await,
                Command::Cancel => self.handle_cancel().await,
                Command::WriteFinished => self.handle_write_finished().await,
            }
        }
        info!("ota actor exiting");
    }

    async fn handle_begin(
        &mut self,
        req: OtaBegin,
        peer: Option<Address>,
        ack: oneshot::Sender<Result<OtaBeginAck, OtaBeginRejected>>,
    ) {
        if let Err(reason) = validate_begin(&req) {
            let _ = ack.send(Err(OtaBeginRejected { reason }));
            return;
        }

        if let OtaState::Writing { update_id, .. } = &self.state {
            let _ = ack.send(Err(OtaBeginRejected {
                reason: format!("ota write of {update_id} in progress; wait or cancel first"),
            }));
            return;
        }

        if let Some(pinned) = self.state.pinned_peer() {
            if pinned != peer {
                let _ = ack.send(Err(OtaBeginRejected {
                    reason: "ota in progress, pinned to a different companion".into(),
                }));
                return;
            }
        }

        if let OtaState::Streaming { update_id, .. } = &self.state {
            if update_id != &req.update_id {
                info!(prior = %update_id, new = %req.update_id, "new OtaBegin during streaming; abandoning prior update");
                if let Err(err) = self.transfers.abandon(update_id).await {
                    warn!(?err, prior = %update_id, "failed to abandon prior OTA partial");
                }
                self.state = OtaState::Idle;
                self.range_proxy.deactivate().await;
            }
        }

        let kind = req.kind;
        let target_dir = match kind {
            OtaKind::Image => None,
            OtaKind::Daemon | OtaKind::BuiltinWebapp => {
                Some(Path::new(BANDAID_ROOT).join("transfers"))
            }
        };

        let begin = self
            .transfers
            .begin(
                &req.update_id,
                req.expected_size as u64,
                &req.expected_sha256,
                target_dir.as_deref(),
            )
            .await;

        let resume_from_offset = match begin {
            Ok(offset) => offset,
            Err(err) => {
                warn!(?err, update_id = %req.update_id, "ota transfer begin failed");
                let _ = ack.send(Err(OtaBeginRejected {
                    reason: format!("transfer begin failed: {err}"),
                }));
                return;
            }
        };

        let persisted = PersistedState {
            update_id: req.update_id.clone(),
            kind,
            expected_size: req.expected_size as u64,
            expected_sha256: req.expected_sha256.clone(),
            peer: peer.map(|addr| addr.to_string()),
        };
        if let Err(err) = manifest::save(&self.persist_dir, &persisted).await {
            error!(?err, update_id = %req.update_id, "failed to persist OTA state before ack");
            let _ = ack.send(Err(OtaBeginRejected {
                reason: format!("failed to persist ota state: {err}"),
            }));
            return;
        }

        if matches!(kind, OtaKind::Image) {
            self.range_proxy.activate(req.update_id.clone(), peer).await;
        }

        self.state = OtaState::Streaming {
            kind,
            update_id: req.update_id.clone(),
            expected_size: req.expected_size as u64,
            peer,
        };
        emit_begin(&self.events_tx, &req).await;
        emit_progress(
            &self.events_tx,
            OtaPhase::Streaming,
            phase_percent(resume_from_offset, req.expected_size as u64),
            None,
        )
        .await;
        self.last_streaming_emit_at = Some(Instant::now());
        debug!(update_id = %req.update_id, ?kind, resume_from_offset, "ota streaming begun");

        let _ = ack.send(Ok(OtaBeginAck {
            resume_from_offset: resume_from_offset as u32,
        }));
    }

    async fn handle_chunk(&mut self, chunk: OtaChunk) {
        let (kind, current_id, expected_size, peer) = match &self.state {
            OtaState::Streaming {
                kind,
                update_id,
                expected_size,
                peer,
            } => (*kind, update_id.clone(), *expected_size, *peer),
            _ => {
                warn!(update_id = %chunk.update_id, "OtaChunk outside Streaming state");
                emit_error(
                    &self.events_tx,
                    OtaErrorCode::UnknownUpdate,
                    format!("no active OTA for {}", chunk.update_id),
                )
                .await;
                return;
            }
        };

        if current_id != chunk.update_id {
            emit_error(
                &self.events_tx,
                OtaErrorCode::UnknownUpdate,
                format!("expected chunks for {current_id}, got {}", chunk.update_id),
            )
            .await;
            return;
        }

        let outcome = self
            .transfers
            .write_chunk(
                &chunk.update_id,
                chunk.offset as u64,
                &chunk.bytes,
                chunk.last,
            )
            .await;
        match outcome {
            Ok(ChunkOutcome::More(received)) => {
                let should_emit = self
                    .last_streaming_emit_at
                    .map(|last| last.elapsed() >= STREAMING_PROGRESS_MIN_INTERVAL)
                    .unwrap_or(true);
                if should_emit {
                    emit_progress(
                        &self.events_tx,
                        OtaPhase::Streaming,
                        phase_percent(received, expected_size),
                        None,
                    )
                    .await;
                    self.last_streaming_emit_at = Some(Instant::now());
                }
            }
            Ok(ChunkOutcome::Done) => {
                emit_progress(&self.events_tx, OtaPhase::Streaming, 100, None).await;
                emit_progress(&self.events_tx, OtaPhase::Verifying, 100, None).await;
                self.last_streaming_emit_at = None;
                let transfer_path = self.transfers.path(&current_id);
                self.spawn_writing(kind, current_id, peer, transfer_path)
                    .await;
            }
            Err(err) => {
                let code = transfer_error_code(&err);
                warn!(?err, update_id = %current_id, "ota chunk failed");
                emit_error(&self.events_tx, code, format!("ota chunk: {err}")).await;
                if let Err(abandon_err) = self.transfers.abandon(&current_id).await {
                    warn!(?abandon_err, update_id = %current_id, "failed to abandon failed OTA partial");
                }
                self.state = OtaState::Idle;
                self.range_proxy.deactivate().await;
                clear_manifest(&self.persist_dir).await;
            }
        }
    }

    async fn handle_asset_range_chunk(&self, chunk: OtaAssetRangeChunk) {
        self.range_proxy.route_chunk(chunk).await;
    }

    async fn handle_abandon(&mut self, update_id: String) {
        info!(%update_id, "abandoning OTA update");
        if let Err(err) = self.transfers.abandon(&update_id).await {
            warn!(?err, %update_id, "failed to drop OTA partial during abandon");
        }
        let active = match &self.state {
            OtaState::Streaming {
                update_id: active, ..
            }
            | OtaState::Writing {
                update_id: active, ..
            } => active == &update_id,
            OtaState::Idle => false,
        };
        if active {
            self.state = OtaState::Idle;
            self.range_proxy.deactivate().await;
            clear_manifest(&self.persist_dir).await;
        }
    }

    async fn handle_cancel(&mut self) {
        let update_id = match &self.state {
            OtaState::Idle => {
                debug!("ota cancel requested while idle");
                return;
            }
            OtaState::Streaming { update_id, .. } | OtaState::Writing { update_id, .. } => {
                update_id.clone()
            }
        };
        info!(%update_id, "cancelling OTA update and dropping partial");
        if let Err(err) = self.transfers.abandon(&update_id).await {
            warn!(?err, %update_id, "failed to drop OTA partial during cancel");
        }
        self.state = OtaState::Idle;
        self.range_proxy.deactivate().await;
        clear_manifest(&self.persist_dir).await;
        emit_error(
            &self.events_tx,
            OtaErrorCode::Cancelled,
            format!("ota {update_id} cancelled"),
        )
        .await;
    }

    async fn spawn_writing(
        &mut self,
        kind: OtaKind,
        update_id: String,
        peer: Option<Address>,
        transfer_path: PathBuf,
    ) {
        debug!(%update_id, ?kind, "transitioning OTA Streaming -> Writing");
        self.state = OtaState::Writing {
            kind,
            update_id: update_id.clone(),
            peer,
        };

        let events_tx = self.events_tx.clone();
        let self_tx = self.self_tx.clone();
        let transfers = self.transfers.clone();
        tokio::spawn(async move {
            match run_writing(kind, &transfer_path, &events_tx).await {
                Ok(()) => {
                    let _ = tokio::fs::remove_file(&transfer_path).await;
                    if self_tx.send(Command::WriteFinished).await.is_err() {
                        error!(%update_id, "ota actor mailbox closed after write success");
                    }
                }
                Err(err) => {
                    warn!(?err, %update_id, ?kind, "ota writing failed");
                    emit_error(&events_tx, err.code, err.msg).await;
                    if let Err(abandon_err) = transfers.abandon(&update_id).await {
                        warn!(?abandon_err, %update_id, "failed to abandon failed write payload");
                    }
                    let _ = self_tx.send(Command::Abandon { update_id }).await;
                }
            }
        });
    }

    async fn handle_write_finished(&mut self) {
        let (kind, update_id, peer) = match &self.state {
            OtaState::Writing {
                kind,
                update_id,
                peer,
            } => (*kind, update_id.clone(), *peer),
            _ => {
                warn!("WriteFinished received outside Writing state");
                return;
            }
        };
        debug!(%update_id, ?kind, ?peer, "ota write finished");
        self.range_proxy.deactivate().await;
        clear_manifest(&self.persist_dir).await;

        if let Err(err) = run_confirming(kind, &self.events_tx).await {
            emit_error(&self.events_tx, err.code, err.msg).await;
            self.state = OtaState::Idle;
            return;
        }

        emit_complete(&self.events_tx, update_id.clone()).await;
        (self.terminators.for_kind(kind))();
        self.state = OtaState::Idle;
    }
}

#[derive(Debug)]
struct OtaWriteError {
    code: OtaErrorCode,
    msg: String,
}

async fn run_writing(
    kind: OtaKind,
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    match kind {
        OtaKind::Image => run_image_write(transfer_path, events_tx).await,
        OtaKind::Daemon => run_daemon_write(transfer_path, events_tx).await,
        OtaKind::BuiltinWebapp => run_webapp_write(transfer_path, events_tx).await,
    }
}

async fn run_image_write(
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    let slot = slots::inactive_slot().map_err(|err| OtaWriteError {
        code: OtaErrorCode::Internal,
        msg: format!("failed to resolve inactive slot: {err}"),
    })?;
    let selector = format!("stable,slot_{slot}");
    let (progress_tx, mut progress_rx) = mpsc::channel(32);
    let install = swupdate::Swupdate::run(transfer_path, &selector, progress_tx);
    tokio::pin!(install);

    loop {
        tokio::select! {
            Some(event) = progress_rx.recv() => {
                emit_progress(events_tx, event.phase, event.percent, None).await;
            }
            result = &mut install => {
                return result.map_err(|err| OtaWriteError {
                    code: OtaErrorCode::WriteFailed,
                    msg: format!("swupdate failed: {err}"),
                });
            }
        }
    }
}

async fn run_daemon_write(
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    emit_progress(events_tx, OtaPhase::Writing, 0, None).await;
    daemon_swap::DaemonSwap::new(PathBuf::from(BANDAID_ROOT))
        .install(transfer_path)
        .await
        .map_err(|err| OtaWriteError {
            code: OtaErrorCode::WriteFailed,
            msg: format!("daemon swap failed: {err}"),
        })?;
    emit_progress(events_tx, OtaPhase::Writing, 100, None).await;
    Ok(())
}

async fn run_webapp_write(
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    emit_progress(events_tx, OtaPhase::Writing, 0, None).await;
    webapp_swap::WebappSwap::new(PathBuf::from(BANDAID_ROOT))
        .install(transfer_path)
        .await
        .map_err(|err| OtaWriteError {
            code: OtaErrorCode::WriteFailed,
            msg: format!("builtin webapp swap failed: {err}"),
        })?;
    emit_progress(events_tx, OtaPhase::Writing, 100, None).await;
    Ok(())
}

async fn run_confirming(kind: OtaKind, events_tx: &OtaEventTx) -> Result<(), OtaWriteError> {
    if matches!(kind, OtaKind::Image) {
        let slot = slots::inactive_slot().map_err(|err| OtaWriteError {
            code: OtaErrorCode::ConfirmFailed,
            msg: format!("failed to resolve inactive slot for confirmation: {err}"),
        })?;
        emit_progress(events_tx, OtaPhase::Confirming, 0, None).await;
        slots::mark_slot_ok(slot).map_err(|err| OtaWriteError {
            code: OtaErrorCode::ConfirmFailed,
            msg: format!("failed to mark slot {slot} ok: {err}"),
        })?;
        emit_progress(events_tx, OtaPhase::Confirming, 100, None).await;
    }
    emit_progress(events_tx, OtaPhase::Reboot, 0, None).await;
    Ok(())
}

async fn emit_begin(events_tx: &OtaEventTx, req: &OtaBegin) {
    let version = req.update_url_base.as_ref().and_then(|url| {
        url.split('/')
            .rfind(|part| !part.is_empty())
            .map(ToOwned::to_owned)
    });
    let _ = events_tx
        .send(OtaEvent::Begin {
            update_id: req.update_id.clone(),
            kind: req.kind,
            version,
        })
        .await;
}

async fn emit_progress(events_tx: &OtaEventTx, phase: OtaPhase, percent: u8, eta_ms: Option<u32>) {
    let _ = events_tx
        .send(OtaEvent::Progress(OtaProgress {
            phase,
            percent,
            eta_ms,
        }))
        .await;
}

async fn emit_error(events_tx: &OtaEventTx, code: OtaErrorCode, msg: String) {
    let _ = events_tx
        .send(OtaEvent::Error(OtaError { code, msg }))
        .await;
}

async fn emit_complete(events_tx: &OtaEventTx, update_id: String) {
    let _ = events_tx.send(OtaEvent::Complete { update_id }).await;
}

async fn clear_manifest(persist_dir: &Path) {
    if let Err(err) = manifest::clear(persist_dir).await {
        warn!(?err, dir = %persist_dir.display(), "failed to clear OTA manifest");
    }
}

fn phase_percent(received: u64, expected: u64) -> u8 {
    if expected == 0 {
        return 100;
    }
    ((received.saturating_mul(100)) / expected).min(100) as u8
}

fn transfer_error_code(err: &TransferError) -> OtaErrorCode {
    match err {
        TransferError::OffsetMismatch { .. } => OtaErrorCode::OffsetMismatch,
        TransferError::HashMismatch { .. } => OtaErrorCode::HashMismatch,
        TransferError::SizeMismatch { .. } => OtaErrorCode::SizeMismatch,
        TransferError::Io(_) | TransferError::Json(_) => OtaErrorCode::Internal,
    }
}

fn validate_begin(req: &OtaBegin) -> Result<(), String> {
    if req.update_id.trim().is_empty() {
        return Err("update_id is required".into());
    }
    if req.expected_size == 0 {
        return Err("expected_size must be greater than zero".into());
    }
    if req.expected_sha256.len() != 64
        || !req.expected_sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("expected_sha256 must be a 64-character hex digest".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use tokio::time::{timeout, Duration};

    fn fixture() -> (Vec<u8>, String, u32) {
        let bytes = b"nocturne ota actor smoke fixture".to_vec();
        let mut h = Sha256::new();
        h.update(&bytes);
        let sha = format!("{:x}", h.finalize());
        let size = bytes.len() as u32;
        (bytes, sha, size)
    }

    #[tokio::test]
    async fn begin_then_one_last_chunk_emits_progress() {
        std::env::set_var("NOCTURNE_SLOTS_STUB", "1");
        std::env::set_var("NOCTURNE_SWAP_STUB", "1");
        let root = tempfile::TempDir::new().unwrap();
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (events_tx, mut events_rx) = mpsc::channel(64);
        let terminators = OtaTerminators {
            reboot: Arc::new(|| {}),
            restart_self: Arc::new(|| {}),
        };
        let handle = OtaActor::spawn(
            transfers,
            events_tx,
            terminators,
            range_proxy::noop_proxy(),
            root.path().to_path_buf(),
        );
        let (bytes, sha, size) = fixture();
        let (ack_tx, ack_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::Begin {
                req: OtaBegin {
                    kind: OtaKind::Image,
                    update_id: sha.clone(),
                    update_url_base: None,
                    expected_sha256: sha.clone(),
                    expected_size: size,
                },
                peer: None,
                ack: ack_tx,
            })
            .await
            .unwrap();
        let ack = ack_rx.await.unwrap().expect("begin should ack");
        assert_eq!(ack.resume_from_offset, 0);

        handle
            .cmd_tx
            .send(Command::Chunk(OtaChunk {
                update_id: sha,
                offset: 0,
                bytes,
                last: true,
            }))
            .await
            .unwrap();

        let mut saw_streaming = false;
        let mut saw_writing = false;
        timeout(Duration::from_secs(5), async {
            while !(saw_streaming && saw_writing) {
                match events_rx.recv().await.expect("event channel closed") {
                    OtaEvent::Progress(progress) if progress.phase == OtaPhase::Streaming => {
                        saw_streaming = true;
                    }
                    OtaEvent::Progress(progress) if progress.phase == OtaPhase::Writing => {
                        saw_writing = true;
                    }
                    OtaEvent::Error(err) => panic!("unexpected ota error: {err:?}"),
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for OTA progress events");
    }

    fn spawn_actor(root: &tempfile::TempDir) -> (OtaHandle, mpsc::Receiver<OtaEvent>) {
        std::env::set_var("NOCTURNE_SLOTS_STUB", "1");
        std::env::set_var("NOCTURNE_SWAP_STUB", "1");
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (events_tx, events_rx) = mpsc::channel(64);
        let terminators = OtaTerminators {
            reboot: Arc::new(|| {}),
            restart_self: Arc::new(|| {}),
        };
        let handle = OtaActor::spawn(
            transfers,
            events_tx,
            terminators,
            range_proxy::noop_proxy(),
            root.path().to_path_buf(),
        );
        (handle, events_rx)
    }

    async fn do_begin(
        handle: &OtaHandle,
        sha: &str,
        size: u32,
    ) -> Result<OtaBeginAck, OtaBeginRejected> {
        let (ack_tx, ack_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::Begin {
                req: OtaBegin {
                    kind: OtaKind::Image,
                    update_id: sha.to_string(),
                    update_url_base: None,
                    expected_sha256: sha.to_string(),
                    expected_size: size,
                },
                peer: None,
                ack: ack_tx,
            })
            .await
            .unwrap();
        ack_rx.await.unwrap()
    }

    #[tokio::test]
    async fn begin_during_writing_is_rejected() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, mut events_rx) = spawn_actor(&root);
        let (bytes, sha, size) = fixture();

        // Begin + send the last chunk to trigger Writing state
        do_begin(&handle, &sha, size).await.expect("first begin ok");
        handle
            .cmd_tx
            .send(Command::Chunk(OtaChunk {
                update_id: sha.clone(),
                offset: 0,
                bytes: bytes.clone(),
                last: true,
            }))
            .await
            .unwrap();

        // Wait until we see Writing phase progress (actor is now in Writing state)
        timeout(Duration::from_secs(5), async {
            loop {
                match events_rx.recv().await.expect("event channel closed") {
                    OtaEvent::Progress(p) if p.phase == OtaPhase::Writing => break,
                    OtaEvent::Error(err) => panic!("unexpected error: {err:?}"),
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for Writing phase");

        // Now try a second Begin — should be rejected
        let result = do_begin(&handle, &sha, size).await;
        let err = result.expect_err("second begin should be rejected during Writing");
        assert!(
            err.reason.contains("write"),
            "rejection reason should mention 'write', got: {}",
            err.reason
        );
    }

    #[tokio::test]
    async fn chunk_for_unknown_update_id_emits_unknown_update_error() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, mut events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();

        do_begin(&handle, &sha, size).await.expect("begin ok");

        // Drain the Begin + initial Progress events
        timeout(Duration::from_secs(2), async {
            loop {
                match events_rx.recv().await.expect("event channel closed") {
                    OtaEvent::Begin { .. } | OtaEvent::Progress(_) => break,
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for Begin event");

        // Send a chunk with a different update_id
        handle
            .cmd_tx
            .send(Command::Chunk(OtaChunk {
                update_id: "wrong-update-id".to_string(),
                offset: 0,
                bytes: vec![1, 2, 3],
                last: false,
            }))
            .await
            .unwrap();

        // Expect an UnknownUpdate error event
        let err_event = timeout(Duration::from_secs(2), async {
            loop {
                if let OtaEvent::Error(e) = events_rx.recv().await.expect("event channel closed") {
                    return e;
                }
            }
        })
        .await
        .expect("timed out waiting for error event");
        assert_eq!(err_event.code, libnocturne::OtaErrorCode::UnknownUpdate);
    }

    #[tokio::test]
    async fn abandon_clears_state_back_to_idle() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();

        // First Begin
        do_begin(&handle, &sha, size).await.expect("first begin ok");

        // Abandon
        handle
            .cmd_tx
            .send(Command::Abandon {
                update_id: sha.clone(),
            })
            .await
            .unwrap();

        // Give the actor time to process the abandon
        tokio::time::sleep(Duration::from_millis(50)).await;

        // Second Begin should succeed (state is back to Idle)
        let result = do_begin(&handle, &sha, size).await;
        assert!(
            result.is_ok(),
            "second begin after abandon should succeed, got: {result:?}"
        );
    }
}
