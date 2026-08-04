pub mod bandaid_swap;
pub mod daemon_swap;
pub mod delta_source;
pub mod manifest;
pub mod slots;
pub mod swupdate;
pub mod transfer;
pub mod webapp_swap;

use std::{
    cmp::Ordering,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use bluer::Address;
pub use delta_source::DeltaSource;
use libnocturne::{
    gateway::{
        OtaAssetRange, OtaAssetRangeAbandon, OtaAssetRangeChunk, OtaAssetRangeRejected,
        OtaAssetRangeReply, OtaBegin, OtaBeginAck, OtaBeginRejected, OtaChunk, OtaPackageReady,
    },
    OtaError, OtaErrorCode, OtaKind, OtaPhase, OtaProgress,
};
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
const UPDATE_ID_MAX_LEN: usize = 128;
const TARGET_VERSION_MAX_LEN: usize = 128;
/// The bandaid overlay partition root. `/var/lib/bandaid/nocturne` is the ext4
/// bandaid partition's `nocturne/` dir, bind-mounted at `/opt/nocturne` (the
/// path the daemon serves + runs from). Bandaid swaps MUST land here so they
/// take effect via the bind mount; the deploy tooling (`just daemon-install`)
/// targets the same path.
const BANDAID_ROOT: &str = "/var/lib/bandaid/nocturne";
pub(crate) const BANDAID_VERSION_PATH: &str = "/var/lib/bandaid/nocturne/.floor-version";

pub type OtaEventTx = mpsc::Sender<OtaEvent>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OtaPullAuthorization {
    pub resume_from_offset: u32,
    pub transfer_window_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OtaSource {
    pub peer: Option<Address>,
    pub route: Option<String>,
}

impl OtaSource {
    pub fn new(peer: Option<Address>, route: Option<String>) -> Self {
        Self { peer, route }
    }

    fn restored(peer: Option<Address>) -> Self {
        Self { peer, route: None }
    }

    fn same_peer(&self, other: &Self) -> bool {
        self.peer == other.peer
    }

    fn accepts(&self, other: &Self) -> bool {
        self.same_peer(other)
            && match (&self.route, &other.route) {
                (Some(expected), Some(actual)) => expected == actual,
                (Some(_), None) => false,
                (None, None) => true,
                (None, Some(_)) => false,
            }
    }
}

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
        #[serde(skip)]
        route: Option<String>,
        request_id: uuid::Uuid,
        req: OtaAssetRange,
    },
    AssetRangeAbandon {
        #[serde(skip)]
        peer: Option<Address>,
        #[serde(skip)]
        route: Option<String>,
        abandon: OtaAssetRangeAbandon,
    },
}

#[derive(Debug)]
pub enum Command {
    Begin {
        req: OtaBegin,
        source: OtaSource,
        ack: oneshot::Sender<Result<OtaBeginAck, OtaBeginRejected>>,
    },
    Chunk {
        chunk: OtaChunk,
        source: OtaSource,
    },
    PulledChunk {
        chunk: OtaChunk,
        source: OtaSource,
        ack: oneshot::Sender<Result<(), String>>,
    },
    AuthorizePull {
        ready: OtaPackageReady,
        transfer_window_size: u32,
        source: OtaSource,
        ack: oneshot::Sender<Result<OtaPullAuthorization, String>>,
    },
    TransferPaused {
        update_id: String,
        source: OtaSource,
        message: String,
    },
    AssetRangeReply {
        reply: OtaAssetRangeReply,
        source: OtaSource,
    },
    AssetRangeRejected {
        rejected: OtaAssetRangeRejected,
        source: OtaSource,
    },
    AssetRangeChunk {
        chunk: OtaAssetRangeChunk,
        source: OtaSource,
    },
    Abandon {
        update_id: String,
        source: OtaSource,
    },
    /// Companion-reported download progress (server -> phone), re-emitted as an
    /// `OtaPhase::Downloading` progress event for the device webapp.
    DownloadProgress {
        update_id: String,
        percent: u8,
        source: OtaSource,
    },
    Cancel {
        source: OtaSource,
        ack: oneshot::Sender<Result<(), String>>,
    },
    WriteFinished {
        update_id: String,
        write_id: uuid::Uuid,
        target_slot: Option<char>,
    },
    WriteFailed {
        update_id: String,
        write_id: uuid::Uuid,
        code: OtaErrorCode,
        message: String,
    },
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
        expected_sha256: String,
        target_version: Option<String>,
        transfer_window_size: Option<u32>,
        source: OtaSource,
    },
    Writing {
        kind: OtaKind,
        update_id: String,
        expected_size: u64,
        expected_sha256: String,
        target_version: Option<String>,
        transfer_window_size: Option<u32>,
        source: OtaSource,
        write_id: uuid::Uuid,
        target_slot: Option<char>,
    },
}

impl OtaState {
    fn source(&self) -> Option<&OtaSource> {
        match self {
            Self::Idle => None,
            Self::Streaming { source, .. } | Self::Writing { source, .. } => Some(source),
        }
    }
}

struct WriteRequest {
    kind: OtaKind,
    update_id: String,
    expected_size: u64,
    expected_sha256: String,
    target_version: Option<String>,
    transfer_window_size: Option<u32>,
    source: OtaSource,
}

#[derive(Debug, Clone)]
struct InstalledVersions {
    image: Result<String, String>,
    bandaid: Result<String, String>,
}

impl InstalledVersions {
    fn load() -> Self {
        match crate::system::config::get_installed_ota_versions() {
            Ok(versions) => Self {
                image: Ok(versions.image),
                bandaid: Ok(versions.bandaid),
            },
            Err(err) => {
                let reason = err.to_string();
                Self {
                    image: Err(reason.clone()),
                    bandaid: Err(reason),
                }
            }
        }
    }

    fn for_kind(&self, kind: OtaKind) -> Result<&str, &str> {
        let installed = if matches!(kind, OtaKind::Image) {
            &self.image
        } else {
            &self.bandaid
        };
        installed
            .as_ref()
            .map(String::as_str)
            .map_err(String::as_str)
    }
}

pub struct OtaActor {
    transfers: ChunkedTransfer,
    events_tx: OtaEventTx,
    delta_source: DeltaSource,
    persist_dir: PathBuf,
    self_tx: mpsc::Sender<Command>,
    cmd_rx: mpsc::Receiver<Command>,
    state: OtaState,
    installed_versions: InstalledVersions,
    last_streaming_emit_at: Option<Instant>,
    last_streaming_percent: Option<u8>,
}

impl OtaActor {
    pub fn spawn(
        transfers: ChunkedTransfer,
        events_tx: OtaEventTx,
        delta_source: DeltaSource,
        persist_dir: PathBuf,
    ) -> OtaHandle {
        Self::spawn_with_installed_versions(
            transfers,
            events_tx,
            delta_source,
            persist_dir,
            InstalledVersions::load(),
        )
    }

    fn spawn_with_installed_versions(
        transfers: ChunkedTransfer,
        events_tx: OtaEventTx,
        delta_source: DeltaSource,
        persist_dir: PathBuf,
        installed_versions: InstalledVersions,
    ) -> OtaHandle {
        // Generous bound so a fast .swu push rarely hits the "busy" backpressure
        // path; on overflow, ota.chunk ingest acks "busy" (never blocks the iAP2
        // read loop) and the phone re-sends.
        let (cmd_tx, cmd_rx) = mpsc::channel(256);
        let actor = Self {
            transfers,
            events_tx,
            delta_source,
            persist_dir,
            self_tx: cmd_tx.clone(),
            cmd_rx,
            state: OtaState::Idle,
            installed_versions,
            last_streaming_emit_at: None,
            last_streaming_percent: None,
        };
        let _join = tokio::spawn(actor.run());
        OtaHandle { cmd_tx, _join }
    }

    async fn recover_from_persisted_manifest(&mut self) {
        match manifest::load(&self.persist_dir).await {
            Ok(Some(state)) => {
                let peer = state.peer.as_deref().map(str::parse::<Address>).transpose();
                let recovery = validate_update_id(&state.update_id)
                    .map_err(|reason| format!("invalid persisted update id: {reason}"))
                    .and_then(|_| {
                        state
                            .target_version
                            .as_deref()
                            .map(validate_target_version)
                            .transpose()
                            .map_err(|reason| format!("invalid persisted target version: {reason}"))
                    })
                    .and_then(|_| peer.map_err(|err| format!("invalid persisted peer: {err}")));
                let peer = match recovery {
                    Ok(peer) => peer,
                    Err(reason) => {
                        warn!(%reason, "ignoring invalid persisted OTA manifest");
                        clear_manifest(&self.persist_dir).await;
                        return;
                    }
                };

                if let Some(target_version) = state.target_version.as_deref() {
                    match self.installed_versions.for_kind(state.kind) {
                        Ok(installed_version) => {
                            match version_is_strictly_newer(target_version, installed_version) {
                                Ok(true) => {}
                                Ok(false) => {
                                    info!(
                                        update_id = %state.update_id,
                                        target_version,
                                        installed_version,
                                        "discarding OTA state that is already installed or superseded",
                                    );
                                    if let Err(err) = self.transfers.abandon(&state.update_id).await
                                    {
                                        warn!(?err, update_id = %state.update_id, "failed to remove stale OTA transfer");
                                    }
                                    clear_manifest(&self.persist_dir).await;
                                    return;
                                }
                                Err(reason) => {
                                    warn!(%reason, "ignoring OTA manifest with incomparable version state");
                                    clear_manifest(&self.persist_dir).await;
                                    return;
                                }
                            }
                        }
                        Err(reason) => {
                            warn!(
                                update_id = %state.update_id,
                                ?state.kind,
                                %reason,
                                "cannot validate persisted OTA target against installed version",
                            );
                        }
                    }
                }

                match self
                    .transfers
                    .resume_offset(
                        &state.update_id,
                        state.expected_size,
                        &state.expected_sha256,
                    )
                    .await
                {
                    Ok(resume_from_offset) => {
                        warn!(
                            update_id = %state.update_id,
                            expected_size = state.expected_size,
                            resume_from_offset,
                            "recovered resumable OTA transfer from previous daemon run",
                        );
                        self.state = OtaState::Streaming {
                            kind: state.kind,
                            update_id: state.update_id,
                            expected_size: state.expected_size,
                            expected_sha256: state.expected_sha256,
                            target_version: state.target_version,
                            transfer_window_size: state.transfer_window_size,
                            source: OtaSource::restored(peer),
                        };
                    }
                    Err(err) => {
                        warn!(?err, update_id = %state.update_id, "persisted OTA transfer is not resumable");
                        clear_manifest(&self.persist_dir).await;
                    }
                }
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
                Command::Begin { req, source, ack } => self.handle_begin(req, source, ack).await,
                Command::Chunk { chunk, source } => {
                    let _ = self.handle_chunk(chunk, &source).await;
                }
                Command::PulledChunk { chunk, source, ack } => {
                    let _ = ack.send(self.handle_chunk(chunk, &source).await);
                }
                Command::AuthorizePull {
                    ready,
                    transfer_window_size,
                    source,
                    ack,
                } => {
                    let _ = ack.send(
                        self.authorize_pull(&ready, transfer_window_size, &source)
                            .await,
                    );
                }
                Command::TransferPaused {
                    update_id,
                    source,
                    message,
                } => {
                    self.handle_transfer_paused(update_id, &source, message)
                        .await
                }
                Command::AssetRangeReply { reply, source } => {
                    self.handle_asset_range_reply(reply, &source).await
                }
                Command::AssetRangeRejected { rejected, source } => {
                    self.handle_asset_range_rejected(rejected, &source).await
                }
                Command::AssetRangeChunk { chunk, source } => {
                    self.handle_asset_range_chunk(chunk, &source).await
                }
                Command::Abandon { update_id, source } => {
                    self.handle_abandon(update_id, &source).await
                }
                Command::DownloadProgress {
                    update_id,
                    percent,
                    source,
                } => {
                    self.handle_download_progress(update_id, percent, &source)
                        .await
                }
                Command::Cancel { source, ack } => {
                    let _ = ack.send(self.handle_cancel(&source).await);
                }
                Command::WriteFinished {
                    update_id,
                    write_id,
                    target_slot,
                } => {
                    self.handle_write_finished(update_id, write_id, target_slot)
                        .await
                }
                Command::WriteFailed {
                    update_id,
                    write_id,
                    code,
                    message,
                } => {
                    self.handle_write_failed(update_id, write_id, code, message)
                        .await
                }
            }
        }
        info!("ota actor exiting");
    }

    async fn handle_begin(
        &mut self,
        req: OtaBegin,
        source: OtaSource,
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

        if let Some(pinned) = self.state.source() {
            if !pinned.same_peer(&source) {
                let _ = ack.send(Err(OtaBeginRejected {
                    reason: "ota in progress, pinned to a different companion".into(),
                }));
                return;
            }
        }

        if let OtaState::Streaming {
            kind, update_id, ..
        } = &self.state
        {
            if update_id == &req.update_id && kind != &req.kind {
                let _ = ack.send(Err(OtaBeginRejected {
                    reason: format!(
                        "ota {} was begun as {kind:?}, not {:?}",
                        req.update_id, req.kind
                    ),
                }));
                return;
            }
            if update_id != &req.update_id {
                info!(prior = %update_id, new = %req.update_id, "new OtaBegin during streaming; abandoning prior update");
                if let Err(err) = self.transfers.abandon(update_id).await {
                    warn!(?err, prior = %update_id, "failed to abandon prior OTA partial");
                }
                self.state = OtaState::Idle;
                self.delta_source.deactivate().await;
                clear_manifest(&self.persist_dir).await;
            }
        }

        let kind = req.kind;
        let target_version = match &self.state {
            OtaState::Streaming {
                update_id,
                target_version,
                ..
            } if update_id == &req.update_id => target_version.clone(),
            _ => None,
        };
        let transfer_window_size = match &self.state {
            OtaState::Streaming {
                update_id,
                transfer_window_size,
                ..
            } if update_id == &req.update_id => *transfer_window_size,
            _ => None,
        };

        let begin = self
            .transfers
            .begin(
                &req.update_id,
                req.expected_size as u64,
                &req.expected_sha256,
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
            target_version: target_version.clone(),
            transfer_window_size,
            peer: source.peer.map(|addr| addr.to_string()),
        };
        if let Err(err) = manifest::save(&self.persist_dir, &persisted).await {
            error!(?err, update_id = %req.update_id, "failed to persist OTA state before ack");
            let _ = ack.send(Err(OtaBeginRejected {
                reason: format!("failed to persist ota state: {err}"),
            }));
            return;
        }

        if matches!(kind, OtaKind::Image) {
            self.delta_source
                .activate(req.update_id.clone(), source.peer, source.route.clone())
                .await;
        }

        self.state = OtaState::Streaming {
            kind,
            update_id: req.update_id.clone(),
            expected_size: req.expected_size as u64,
            expected_sha256: req.expected_sha256.clone(),
            target_version,
            transfer_window_size,
            source,
        };
        emit_begin(&self.events_tx, &req).await;
        // The companion downloads the artifact (server -> phone) before streaming
        // any chunks, so the first visible phase is `downloading` (reported by the
        // phone), not `streaming`. Emit a 0% Downloading reading now for immediate
        // UI feedback; emitting Streaming here would briefly mislabel the server
        // download as "Transferring to device...". `resume_from_offset` still drives
        // the streaming resume point once chunks start arriving.
        emit_progress(&self.events_tx, OtaPhase::Downloading, 0, None).await;
        self.last_streaming_emit_at = None;
        self.last_streaming_percent = None;
        debug!(update_id = %req.update_id, ?kind, resume_from_offset, "ota streaming begun");

        let _ = ack.send(Ok(OtaBeginAck {
            resume_from_offset: resume_from_offset as u32,
        }));
    }

    async fn handle_chunk(&mut self, chunk: OtaChunk, source: &OtaSource) -> Result<(), String> {
        let (
            kind,
            current_id,
            expected_size,
            expected_sha256,
            target_version,
            transfer_window_size,
            active_source,
        ) = match &self.state {
            OtaState::Streaming {
                kind,
                update_id,
                expected_size,
                expected_sha256,
                target_version,
                transfer_window_size,
                source,
            } => (
                *kind,
                update_id.clone(),
                *expected_size,
                expected_sha256.clone(),
                target_version.clone(),
                *transfer_window_size,
                source.clone(),
            ),
            _ => {
                warn!(update_id = %chunk.update_id, "OtaChunk outside Streaming state");
                emit_error(
                    &self.events_tx,
                    OtaErrorCode::UnknownUpdate,
                    format!("no active OTA for {}", chunk.update_id),
                )
                .await;
                return Err(format!("no active OTA for {}", chunk.update_id));
            }
        };

        if !active_source.accepts(source) {
            let msg = format!("ota source route is not active for {}", chunk.update_id);
            warn!(update_id = %chunk.update_id, ?source, ?active_source, "rejecting OTA chunk from stale source");
            return Err(msg);
        }

        if current_id != chunk.update_id {
            let msg = format!("expected chunks for {current_id}, got {}", chunk.update_id);
            emit_error(&self.events_tx, OtaErrorCode::UnknownUpdate, msg.clone()).await;
            return Err(msg);
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
                let percent = phase_percent(received, expected_size);
                let should_emit = self
                    .last_streaming_emit_at
                    .map(|last| last.elapsed() >= STREAMING_PROGRESS_MIN_INTERVAL)
                    .unwrap_or(true)
                    && self.last_streaming_percent != Some(percent);
                if should_emit {
                    emit_progress(&self.events_tx, OtaPhase::Streaming, percent, None).await;
                    self.last_streaming_emit_at = Some(Instant::now());
                    self.last_streaming_percent = Some(percent);
                }
                Ok(())
            }
            Ok(ChunkOutcome::Done) => {
                emit_progress(&self.events_tx, OtaPhase::Streaming, 100, None).await;
                emit_progress(&self.events_tx, OtaPhase::Verifying, 100, None).await;
                self.last_streaming_emit_at = None;
                self.last_streaming_percent = None;
                let transfer_path = self.transfers.path(&current_id);
                self.spawn_writing(
                    WriteRequest {
                        kind,
                        update_id: current_id,
                        expected_size,
                        expected_sha256,
                        target_version,
                        transfer_window_size,
                        source: active_source,
                    },
                    transfer_path,
                )
                .await;
                Ok(())
            }
            Err(err) => {
                let code = transfer_error_code(&err);
                let msg = format!("ota chunk: {err}");
                warn!(?err, update_id = %current_id, "ota chunk failed");
                emit_error(&self.events_tx, code, msg.clone()).await;
                if let Err(abandon_err) = self.transfers.abandon(&current_id).await {
                    warn!(?abandon_err, update_id = %current_id, "failed to abandon failed OTA partial");
                }
                self.state = OtaState::Idle;
                self.delta_source.deactivate().await;
                clear_manifest(&self.persist_dir).await;
                Err(msg)
            }
        }
    }

    async fn authorize_pull(
        &mut self,
        ready: &OtaPackageReady,
        advertised_transfer_window_size: u32,
        source: &OtaSource,
    ) -> Result<OtaPullAuthorization, String> {
        validate_update_id(&ready.update_id)?;
        validate_target_version(&ready.version)?;
        let (
            kind,
            expected_size,
            expected_sha256,
            target_version,
            prior_transfer_window_size,
            active_source,
        ) = match &self.state {
            OtaState::Streaming {
                kind,
                update_id,
                expected_size,
                expected_sha256,
                target_version,
                transfer_window_size,
                source,
                ..
            } if update_id == &ready.update_id => (
                *kind,
                *expected_size,
                expected_sha256.clone(),
                target_version.clone(),
                *transfer_window_size,
                source.clone(),
            ),
            OtaState::Streaming { update_id, .. } => {
                return Err(format!(
                    "active OTA is {update_id}, not {}",
                    ready.update_id
                ));
            }
            _ => return Err(format!("no active OTA for {}", ready.update_id)),
        };

        if !active_source.accepts(source) {
            return Err(format!(
                "ota source route is not active for {}",
                ready.update_id
            ));
        }
        if u64::from(ready.size) != expected_size {
            return Err(format!(
                "ota package size {} does not match expected size {expected_size}",
                ready.size
            ));
        }
        if !ready.expected_sha256.eq_ignore_ascii_case(&expected_sha256) {
            return Err("ota package hash does not match ota.begin".into());
        }
        if let Some(target_version) = target_version {
            if target_version != ready.version {
                return Err(format!(
                    "ota target version is immutable: expected {target_version}, got {}",
                    ready.version
                ));
            }
        }
        let actual_resume_offset = self
            .transfers
            .resume_offset(&ready.update_id, expected_size, &expected_sha256)
            .await
            .map_err(|err| format!("failed to inspect OTA resume state: {err}"))?;
        let resume_from_offset = u32::try_from(actual_resume_offset)
            .map_err(|_| format!("OTA resume offset {actual_resume_offset} exceeds u32"))?;
        let installed_version = self.installed_versions.for_kind(kind).map_err(|reason| {
            format!("cannot validate OTA version against the installed {kind:?} release: {reason}")
        })?;
        if !version_is_strictly_newer(&ready.version, installed_version)? {
            return Err(format!(
                "ota target {} is not newer than installed version {installed_version}",
                ready.version
            ));
        }
        let transfer_window_size = advertised_transfer_window_size;
        if prior_transfer_window_size != Some(transfer_window_size) {
            info!(
                update_id = %ready.update_id,
                prior_transfer_window_size,
                transfer_window_size,
                resume_from_offset,
                "renegotiated OTA pull window for current companion"
            );
        }

        let persisted = PersistedState {
            update_id: ready.update_id.clone(),
            kind,
            expected_size,
            expected_sha256,
            target_version: Some(ready.version.clone()),
            transfer_window_size: Some(transfer_window_size),
            peer: active_source.peer.map(|peer| peer.to_string()),
        };
        manifest::save(&self.persist_dir, &persisted)
            .await
            .map_err(|err| format!("failed to persist OTA target version: {err}"))?;

        if let OtaState::Streaming {
            target_version,
            transfer_window_size: active_window,
            ..
        } = &mut self.state
        {
            *target_version = Some(ready.version.clone());
            *active_window = Some(transfer_window_size);
        }
        Ok(OtaPullAuthorization {
            resume_from_offset,
            transfer_window_size,
        })
    }

    async fn handle_transfer_paused(
        &mut self,
        update_id: String,
        source: &OtaSource,
        message: String,
    ) {
        let active = matches!(
            &self.state,
            OtaState::Streaming { update_id: active, source: active_source, .. }
                if active == &update_id && active_source.accepts(source)
        );
        if active {
            warn!(%update_id, %message, "ota pull transfer paused; partial retained for resume");
        } else {
            debug!(%update_id, %message, "ignoring stale OTA transfer pause");
        }
    }

    fn accepts_source(&self, source: &OtaSource) -> bool {
        self.state
            .source()
            .is_some_and(|active| active.accepts(source))
    }

    async fn handle_asset_range_chunk(&self, chunk: OtaAssetRangeChunk, source: &OtaSource) {
        if self.accepts_source(source) {
            self.delta_source.route_chunk(chunk).await;
        } else {
            warn!(?source, request_id = %chunk.request_id, "dropping delta chunk from stale OTA source");
        }
    }

    async fn handle_asset_range_reply(&self, reply: OtaAssetRangeReply, source: &OtaSource) {
        if self.accepts_source(source) {
            self.delta_source.route_reply(reply).await;
        } else {
            warn!(?source, request_id = %reply.request_id, "dropping delta reply from stale OTA source");
        }
    }

    async fn handle_asset_range_rejected(
        &self,
        rejected: OtaAssetRangeRejected,
        source: &OtaSource,
    ) {
        if self.accepts_source(source) {
            self.delta_source.route_rejected(rejected).await;
        } else {
            warn!(?source, request_id = %rejected.request_id, "dropping delta rejection from stale OTA source");
        }
    }

    async fn handle_abandon(&mut self, update_id: String, source: &OtaSource) {
        if let Err(reason) = validate_update_id(&update_id) {
            warn!(%update_id, %reason, "rejecting invalid OTA abandon id");
            return;
        }
        let (active, writing) = match &self.state {
            OtaState::Streaming {
                update_id: active,
                source: active_source,
                ..
            } => (active == &update_id && active_source.accepts(source), false),
            OtaState::Writing {
                update_id: active,
                source: active_source,
                ..
            } => (active == &update_id && active_source.accepts(source), true),
            OtaState::Idle => (false, false),
        };
        if !active {
            warn!(%update_id, ?source, "ignoring OTA abandon from a non-active source");
            return;
        }
        if writing {
            warn!(%update_id, "ignoring OTA abandon after writing has started");
            emit_error(
                &self.events_tx,
                OtaErrorCode::WriteFailed,
                format!("ota {update_id} cannot be abandoned while writing"),
            )
            .await;
            return;
        }

        info!(%update_id, "abandoning OTA update");
        if let Err(err) = self.transfers.abandon(&update_id).await {
            warn!(?err, %update_id, "failed to drop OTA partial during abandon");
        }
        self.state = OtaState::Idle;
        self.delta_source.deactivate().await;
        clear_manifest(&self.persist_dir).await;
    }

    /// Re-emits companion-reported download progress as an `OtaPhase::Downloading`
    /// event. Advisory display data: only forwarded while the matching transfer
    /// is still in `Streaming` (the phone stops reporting once it begins sending
    /// chunks), and dropped otherwise without erroring.
    async fn handle_download_progress(
        &mut self,
        update_id: String,
        percent: u8,
        source: &OtaSource,
    ) {
        let active = match &self.state {
            OtaState::Streaming {
                update_id: current_id,
                source: active_source,
                ..
            } => current_id == &update_id && active_source.accepts(source),
            _ => false,
        };
        if active {
            emit_progress(
                &self.events_tx,
                OtaPhase::Downloading,
                percent.min(100),
                None,
            )
            .await;
        }
    }

    async fn handle_cancel(&mut self, source: &OtaSource) -> Result<(), String> {
        let update_id = match &self.state {
            OtaState::Idle => {
                debug!("ota cancel requested while idle");
                return Ok(());
            }
            OtaState::Streaming {
                update_id,
                source: active_source,
                ..
            } => {
                if !active_source.accepts(source) {
                    return Err("ota is pinned to a different source route".into());
                }
                update_id.clone()
            }
            OtaState::Writing {
                update_id,
                source: active_source,
                ..
            } => {
                if !active_source.accepts(source) {
                    return Err("ota is pinned to a different source route".into());
                }
                return Err(format!(
                    "ota {update_id} cannot be cancelled after writing has started"
                ));
            }
        };
        info!(%update_id, "cancelling OTA update and dropping partial");
        if let Err(err) = self.transfers.abandon(&update_id).await {
            warn!(?err, %update_id, "failed to drop OTA partial during cancel");
        }
        self.state = OtaState::Idle;
        self.delta_source.deactivate().await;
        clear_manifest(&self.persist_dir).await;
        emit_error(
            &self.events_tx,
            OtaErrorCode::Cancelled,
            format!("ota {update_id} cancelled"),
        )
        .await;
        Ok(())
    }

    async fn spawn_writing(&mut self, request: WriteRequest, transfer_path: PathBuf) {
        let WriteRequest {
            kind,
            update_id,
            expected_size,
            expected_sha256,
            target_version,
            transfer_window_size,
            source,
        } = request;
        debug!(%update_id, ?kind, "transitioning OTA Streaming -> Writing");
        let write_id = uuid::Uuid::new_v4();
        self.state = OtaState::Writing {
            kind,
            update_id: update_id.clone(),
            expected_size,
            expected_sha256,
            target_version: target_version.clone(),
            transfer_window_size,
            source,
            write_id,
            target_slot: None,
        };

        let events_tx = self.events_tx.clone();
        let self_tx = self.self_tx.clone();
        tokio::spawn(async move {
            match run_writing(kind, &transfer_path, target_version.as_deref(), &events_tx).await {
                Ok(target_slot) => {
                    if self_tx
                        .send(Command::WriteFinished {
                            update_id: update_id.clone(),
                            write_id,
                            target_slot,
                        })
                        .await
                        .is_err()
                    {
                        error!(%update_id, "ota actor mailbox closed after write success");
                    }
                }
                Err(err) => {
                    warn!(?err, %update_id, ?kind, "ota writing failed");
                    let _ = self_tx
                        .send(Command::WriteFailed {
                            update_id,
                            write_id,
                            code: err.code,
                            message: err.msg,
                        })
                        .await;
                }
            }
        });
    }

    async fn handle_write_finished(
        &mut self,
        completed_update_id: String,
        completed_write_id: uuid::Uuid,
        target_slot: Option<char>,
    ) {
        let (
            kind,
            update_id,
            expected_size,
            expected_sha256,
            target_version,
            transfer_window_size,
            source,
            write_id,
            state_target_slot,
        ) = match &self.state {
            OtaState::Writing {
                kind,
                update_id,
                expected_size,
                expected_sha256,
                target_version,
                transfer_window_size,
                source,
                write_id,
                target_slot,
            } => (
                *kind,
                update_id.clone(),
                *expected_size,
                expected_sha256.clone(),
                target_version.clone(),
                *transfer_window_size,
                source.clone(),
                *write_id,
                *target_slot,
            ),
            _ => {
                warn!("WriteFinished received outside Writing state");
                return;
            }
        };
        if completed_update_id != update_id || completed_write_id != write_id {
            warn!(
                active_update_id = %update_id,
                completed_update_id,
                active_write_id = %write_id,
                completed_write_id = %completed_write_id,
                "ignoring stale OTA write completion",
            );
            return;
        }
        debug!(%update_id, ?kind, ?source, "ota write finished");
        self.delta_source.deactivate().await;

        if let Err(err) =
            run_confirming(kind, target_slot.or(state_target_slot), &self.events_tx).await
        {
            emit_error(&self.events_tx, err.code, err.msg).await;
            self.state = OtaState::Streaming {
                kind,
                update_id,
                expected_size,
                expected_sha256,
                target_version,
                transfer_window_size,
                source,
            };
            return;
        }

        if let Err(err) = self.transfers.abandon(&update_id).await {
            warn!(?err, %update_id, "failed to remove completed OTA transfer payload");
        }
        clear_manifest(&self.persist_dir).await;
        if !matches!(kind, OtaKind::Image) {
            if let Some(version) = target_version {
                self.installed_versions.bandaid = Ok(version);
            }
        }
        self.state = OtaState::Idle;
        emit_complete(&self.events_tx, update_id).await;
        if matches!(kind, OtaKind::Daemon | OtaKind::Bandaid) {
            schedule_daemon_activation().await;
        }
    }

    async fn handle_write_failed(
        &mut self,
        failed_update_id: String,
        failed_write_id: uuid::Uuid,
        code: OtaErrorCode,
        message: String,
    ) {
        let (
            kind,
            update_id,
            expected_size,
            expected_sha256,
            target_version,
            transfer_window_size,
            source,
            write_id,
        ) = match &self.state {
            OtaState::Writing {
                kind,
                update_id,
                expected_size,
                expected_sha256,
                target_version,
                transfer_window_size,
                source,
                write_id,
                ..
            } => (
                *kind,
                update_id.clone(),
                *expected_size,
                expected_sha256.clone(),
                target_version.clone(),
                *transfer_window_size,
                source.clone(),
                *write_id,
            ),
            _ => {
                debug!(%failed_update_id, %failed_write_id, "ignoring stale OTA write failure outside Writing state");
                return;
            }
        };
        if failed_update_id != update_id || failed_write_id != write_id {
            debug!(%failed_update_id, %failed_write_id, "ignoring stale OTA write failure");
            return;
        }

        self.delta_source.deactivate().await;
        emit_error(&self.events_tx, code, message).await;
        self.state = OtaState::Streaming {
            kind,
            update_id,
            expected_size,
            expected_sha256,
            target_version,
            transfer_window_size,
            source,
        };
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
    target_version: Option<&str>,
    events_tx: &OtaEventTx,
) -> Result<Option<char>, OtaWriteError> {
    let target_slot = match kind {
        OtaKind::Image => run_image_write(transfer_path, events_tx).await.map(Some),
        OtaKind::Daemon => run_daemon_write(transfer_path, events_tx)
            .await
            .map(|_| None),
        OtaKind::BuiltinWebapp => run_webapp_write(transfer_path, events_tx)
            .await
            .map(|_| None),
        OtaKind::Bandaid => run_bandaid_write(transfer_path, events_tx)
            .await
            .map(|_| None),
    }?;

    if !matches!(kind, OtaKind::Image) {
        if let Some(version) = target_version {
            validate_active_bandaid_overlay(Path::new(BANDAID_ROOT))
                .await
                .map_err(|err| OtaWriteError {
                    code: OtaErrorCode::WriteFailed,
                    msg: format!("installed OTA overlay is incomplete: {err}"),
                })?;
            write_installed_version_marker(Path::new(BANDAID_VERSION_PATH), version)
                .await
                .map_err(|err| OtaWriteError {
                    code: OtaErrorCode::WriteFailed,
                    msg: format!("failed to persist installed OTA version: {err}"),
                })?;
        } else {
            warn!(
                ?kind,
                "legacy OTA write completed without a target version marker"
            );
        }
    }

    Ok(target_slot)
}

async fn validate_active_bandaid_overlay(root: &Path) -> std::io::Result<()> {
    for relative in ["daemon/nocturned.current", "webapps/ui/index.html"] {
        let path = root.join(relative);
        let metadata = tokio::fs::symlink_metadata(&path).await?;
        if !metadata.file_type().is_file() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{} is not a regular file", path.display()),
            ));
        }
    }
    Ok(())
}

async fn write_installed_version_marker(path: &Path, version: &str) -> std::io::Result<()> {
    validate_target_version(version)
        .map_err(|reason| std::io::Error::new(std::io::ErrorKind::InvalidInput, reason))?;
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "installed version marker has no parent directory",
        )
    })?;
    tokio::fs::create_dir_all(parent).await?;
    let parent = parent.to_path_buf();
    let path = path.to_path_buf();
    let bytes = format!("{version}\n").into_bytes();

    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut tmp = tempfile::NamedTempFile::new_in(&parent)?;
        std::io::Write::write_all(&mut tmp, &bytes)?;
        std::io::Write::flush(&mut tmp)?;
        std::fs::set_permissions(tmp.path(), std::fs::Permissions::from_mode(0o644))?;
        tmp.as_file().sync_all()?;
        tmp.persist(&path).map_err(|err| err.error)?;
        std::fs::File::open(parent)?.sync_all()?;
        Ok(())
    })
    .await
    .map_err(std::io::Error::other)??;

    Ok(())
}

async fn run_image_write(
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<char, OtaWriteError> {
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
                result.map_err(|err| OtaWriteError {
                    code: OtaErrorCode::WriteFailed,
                    msg: format!("swupdate failed: {err}"),
                })?;
                return Ok(slot);
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

async fn run_bandaid_write(
    transfer_path: &Path,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    emit_progress(events_tx, OtaPhase::Writing, 0, None).await;
    bandaid_swap::BandaidSwap::new(PathBuf::from(BANDAID_ROOT))
        .install(transfer_path)
        .await
        .map_err(|err| OtaWriteError {
            code: OtaErrorCode::WriteFailed,
            msg: format!("bandaid swap failed: {err}"),
        })?;
    emit_progress(events_tx, OtaPhase::Writing, 100, None).await;
    Ok(())
}

async fn run_confirming(
    kind: OtaKind,
    target_slot: Option<char>,
    events_tx: &OtaEventTx,
) -> Result<(), OtaWriteError> {
    if matches!(kind, OtaKind::Image) {
        let slot = target_slot.ok_or_else(|| OtaWriteError {
            code: OtaErrorCode::ConfirmFailed,
            msg: "missing image target slot for confirmation".into(),
        })?;
        emit_progress(events_tx, OtaPhase::Confirming, 0, None).await;
        slots::mark_slot_ok(slot).map_err(|err| OtaWriteError {
            code: OtaErrorCode::ConfirmFailed,
            msg: format!("failed to mark slot {slot} ok: {err}"),
        })?;
        emit_progress(events_tx, OtaPhase::Confirming, 100, None).await;
    }
    Ok(())
}

async fn emit_begin(events_tx: &OtaEventTx, req: &OtaBegin) {
    let _ = events_tx
        .send(OtaEvent::Begin {
            update_id: req.update_id.clone(),
            kind: req.kind,
            version: None,
        })
        .await;
}

async fn emit_progress(events_tx: &OtaEventTx, phase: OtaPhase, percent: u8, eta_ms: Option<u32>) {
    let _ = events_tx
        .send(OtaEvent::Progress(OtaProgress {
            phase,
            percent,
            eta_ms,
            asset: None,
            transferred_bytes: None,
            total_bytes: None,
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

#[cfg(all(feature = "device", not(test)))]
async fn schedule_daemon_activation() {
    let unit = format!("nocturned-ota-activation-{}", uuid::Uuid::new_v4().simple());
    match tokio::process::Command::new("/usr/bin/systemd-run")
        .args([
            format!("--unit={unit}"),
            "--on-active=3s".into(),
            "--collect".into(),
            "/usr/bin/systemctl".into(),
            "restart".into(),
            "nocturned.service".into(),
        ])
        .output()
        .await
    {
        Ok(output) if output.status.success() => {
            info!(%unit, "scheduled daemon activation after OTA completion");
        }
        Ok(output) => {
            error!(
                %unit,
                status = %output.status,
                stderr = %String::from_utf8_lossy(&output.stderr),
                "failed to schedule daemon activation after OTA completion"
            );
        }
        Err(err) => {
            error!(?err, %unit, "failed to launch daemon activation scheduler");
        }
    }
}

#[cfg(any(not(feature = "device"), test))]
async fn schedule_daemon_activation() {}

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
        TransferError::MetadataMismatch | TransferError::Io(_) | TransferError::Json(_) => {
            OtaErrorCode::Internal
        }
    }
}

fn validate_begin(req: &OtaBegin) -> Result<(), String> {
    validate_update_id(&req.update_id)?;
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

fn validate_update_id(update_id: &str) -> Result<(), String> {
    if update_id.is_empty() {
        return Err("update_id is required".into());
    }
    if update_id.len() > UPDATE_ID_MAX_LEN {
        return Err(format!(
            "update_id must be at most {UPDATE_ID_MAX_LEN} bytes"
        ));
    }
    if !update_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        || update_id == "."
        || update_id == ".."
    {
        return Err("update_id contains unsupported path characters".into());
    }
    Ok(())
}

#[derive(Debug)]
struct ParsedRelease<'a> {
    core: [&'a str; 3],
    prerelease: Option<Vec<&'a str>>,
    build: Option<&'a str>,
}

fn parse_version_identifiers(value: &str) -> Option<Vec<&str>> {
    let identifiers = value.split('.').collect::<Vec<_>>();
    if identifiers.iter().all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        Some(identifiers)
    } else {
        None
    }
}

fn parse_release_version(version: &str) -> Result<ParsedRelease<'_>, String> {
    if version.is_empty() {
        return Err("version is required".into());
    }
    if version.len() > TARGET_VERSION_MAX_LEN {
        return Err(format!(
            "version must be at most {TARGET_VERSION_MAX_LEN} bytes"
        ));
    }
    let version = version.strip_prefix('v').unwrap_or(version);
    let (precedence, build) = version
        .split_once('+')
        .map_or((version, None), |(precedence, build)| {
            (precedence, Some(build))
        });
    let (core, prerelease) = precedence
        .split_once('-')
        .map_or((precedence, None), |(core, prerelease)| {
            (core, Some(prerelease))
        });
    let mut core_parts = core.split('.');
    let core = [
        core_parts.next().unwrap_or_default(),
        core_parts.next().unwrap_or_default(),
        core_parts.next().unwrap_or_default(),
    ];
    if core_parts.next().is_some()
        || core
            .iter()
            .any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
    {
        return Err("version must contain a three-part numeric core".into());
    }

    let prerelease = prerelease
        .map(|value| {
            parse_version_identifiers(value)
                .ok_or_else(|| "version contains invalid prerelease identifiers".to_string())
        })
        .transpose()?;
    let build = build
        .map(|value| {
            if !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) {
                Ok(value)
            } else {
                Err("version build identifier must be a numeric timestamp".to_string())
            }
        })
        .transpose()?;

    Ok(ParsedRelease {
        core,
        prerelease,
        build,
    })
}

pub(crate) fn validate_target_version(version: &str) -> Result<(), String> {
    parse_release_version(version).map(|_| ())
}

fn compare_numeric(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    let left = if left.is_empty() { "0" } else { left };
    let right = if right.is_empty() { "0" } else { right };
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn compare_prerelease(left: Option<&[&str]>, right: Option<&[&str]>) -> Ordering {
    match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => {
            for (left, right) in left.iter().zip(right) {
                let left_numeric = left.bytes().all(|byte| byte.is_ascii_digit());
                let right_numeric = right.bytes().all(|byte| byte.is_ascii_digit());
                let ordering = match (left_numeric, right_numeric) {
                    (true, true) => compare_numeric(left, right),
                    (true, false) => Ordering::Less,
                    (false, true) => Ordering::Greater,
                    (false, false) => left.cmp(right),
                };
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            left.len().cmp(&right.len())
        }
    }
}

fn version_is_strictly_newer(candidate: &str, installed: &str) -> Result<bool, String> {
    let candidate = parse_release_version(candidate)
        .map_err(|reason| format!("invalid OTA target version: {reason}"))?;
    let installed = parse_release_version(installed)
        .map_err(|reason| format!("invalid installed version: {reason}"))?;

    for (candidate, installed) in candidate.core.iter().zip(installed.core) {
        let ordering = compare_numeric(candidate, installed);
        if ordering != Ordering::Equal {
            return Ok(ordering == Ordering::Greater);
        }
    }
    let prerelease_ordering = compare_prerelease(
        candidate.prerelease.as_deref(),
        installed.prerelease.as_deref(),
    );
    if prerelease_ordering != Ordering::Equal {
        return Ok(prerelease_ordering == Ordering::Greater);
    }

    Ok(match (candidate.build, installed.build) {
        (Some(candidate), Some(installed)) => {
            compare_numeric(candidate, installed) == Ordering::Greater
        }
        (Some(_), None) => true,
        (None, Some(_)) | (None, None) => false,
    })
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

    fn test_source() -> OtaSource {
        OtaSource::new(None, Some("test-route".into()))
    }

    fn test_installed_versions() -> InstalledVersions {
        InstalledVersions {
            image: Ok("4.1.0".into()),
            bandaid: Ok("4.1.0".into()),
        }
    }

    #[tokio::test]
    async fn begin_then_one_last_chunk_emits_progress() {
        std::env::set_var("NOCTURNE_SLOTS_STUB", "1");
        std::env::set_var("NOCTURNE_SWAP_STUB", "1");
        let root = tempfile::TempDir::new().unwrap();
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (events_tx, mut events_rx) = mpsc::channel(64);
        let handle = OtaActor::spawn(
            transfers,
            events_tx,
            delta_source::noop_source(),
            root.path().to_path_buf(),
        );
        let (bytes, sha, size) = fixture();
        let (ack_tx, ack_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::Begin {
                req: OtaBegin {
                    kind: OtaKind::Bandaid,
                    update_id: sha.clone(),
                    update_url_base: None,
                    expected_sha256: sha.clone(),
                    expected_size: size,
                },
                source: test_source(),
                ack: ack_tx,
            })
            .await
            .unwrap();
        let ack = ack_rx.await.unwrap().expect("begin should ack");
        assert_eq!(ack.resume_from_offset, 0);

        handle
            .cmd_tx
            .send(Command::Chunk {
                chunk: OtaChunk {
                    update_id: sha,
                    offset: 0,
                    bytes,
                    last: true,
                },
                source: test_source(),
            })
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

    #[tokio::test]
    async fn completion_is_emitted_after_transfer_state_is_removed() {
        let root = tempfile::TempDir::new().unwrap();
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (bytes, sha, size) = fixture();
        transfers.begin(&sha, u64::from(size), &sha).await.unwrap();
        transfers.write_chunk(&sha, 0, &bytes, true).await.unwrap();
        manifest::save(
            root.path(),
            &PersistedState {
                update_id: sha.clone(),
                kind: OtaKind::Bandaid,
                expected_size: u64::from(size),
                expected_sha256: sha.clone(),
                target_version: None,
                transfer_window_size: None,
                peer: None,
            },
        )
        .await
        .unwrap();

        let (events_tx, mut events_rx) = mpsc::channel(1);
        events_tx
            .send(OtaEvent::Complete {
                update_id: "channel-blocker".into(),
            })
            .await
            .unwrap();
        let (self_tx, cmd_rx) = mpsc::channel(1);
        let write_id = uuid::Uuid::new_v4();
        let mut actor = OtaActor {
            transfers: transfers.clone(),
            events_tx,
            delta_source: delta_source::noop_source(),
            persist_dir: root.path().to_path_buf(),
            self_tx,
            cmd_rx,
            state: OtaState::Writing {
                kind: OtaKind::Bandaid,
                update_id: sha.clone(),
                expected_size: u64::from(size),
                expected_sha256: sha.clone(),
                target_version: None,
                transfer_window_size: None,
                source: test_source(),
                write_id,
                target_slot: None,
            },
            installed_versions: test_installed_versions(),
            last_streaming_emit_at: None,
            last_streaming_percent: None,
        };
        let completed_sha = sha.clone();
        let completion = tokio::spawn(async move {
            actor
                .handle_write_finished(completed_sha, write_id, None)
                .await;
        });

        timeout(Duration::from_secs(1), async {
            while tokio::fs::try_exists(transfers.path(&sha)).await.unwrap()
                || tokio::fs::try_exists(transfers.meta_path(&sha))
                    .await
                    .unwrap()
                || manifest::load(root.path()).await.unwrap().is_some()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("cleanup must finish while the completion event is blocked");

        assert!(matches!(
            events_rx.recv().await,
            Some(OtaEvent::Complete { update_id }) if update_id == "channel-blocker"
        ));
        assert!(matches!(
            events_rx.recv().await,
            Some(OtaEvent::Complete { update_id }) if update_id == sha
        ));
        completion.await.unwrap();

        assert!(!tokio::fs::try_exists(transfers.path(&sha)).await.unwrap());
        assert!(!tokio::fs::try_exists(transfers.meta_path(&sha))
            .await
            .unwrap());
        assert!(manifest::load(root.path()).await.unwrap().is_none());
    }

    fn spawn_actor(root: &tempfile::TempDir) -> (OtaHandle, mpsc::Receiver<OtaEvent>) {
        spawn_actor_with_versions(root, test_installed_versions())
    }

    fn spawn_actor_with_versions(
        root: &tempfile::TempDir,
        installed_versions: InstalledVersions,
    ) -> (OtaHandle, mpsc::Receiver<OtaEvent>) {
        std::env::set_var("NOCTURNE_SLOTS_STUB", "1");
        std::env::set_var("NOCTURNE_SWAP_STUB", "1");
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (events_tx, events_rx) = mpsc::channel(64);
        let handle = OtaActor::spawn_with_installed_versions(
            transfers,
            events_tx,
            delta_source::noop_source(),
            root.path().to_path_buf(),
            installed_versions,
        );
        (handle, events_rx)
    }

    async fn do_begin(
        handle: &OtaHandle,
        sha: &str,
        size: u32,
    ) -> Result<OtaBeginAck, OtaBeginRejected> {
        do_begin_kind_from(handle, sha, size, OtaKind::Bandaid, test_source()).await
    }

    async fn do_begin_from(
        handle: &OtaHandle,
        sha: &str,
        size: u32,
        source: OtaSource,
    ) -> Result<OtaBeginAck, OtaBeginRejected> {
        do_begin_kind_from(handle, sha, size, OtaKind::Bandaid, source).await
    }

    async fn do_begin_kind_from(
        handle: &OtaHandle,
        sha: &str,
        size: u32,
        kind: OtaKind,
        source: OtaSource,
    ) -> Result<OtaBeginAck, OtaBeginRejected> {
        let (ack_tx, ack_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::Begin {
                req: OtaBegin {
                    kind,
                    update_id: sha.to_string(),
                    update_url_base: None,
                    expected_sha256: sha.to_string(),
                    expected_size: size,
                },
                source,
                ack: ack_tx,
            })
            .await
            .unwrap();
        ack_rx.await.unwrap()
    }

    #[tokio::test]
    async fn restart_recovers_partial_and_reports_resume_offset() {
        let root = tempfile::TempDir::new().unwrap();
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (bytes, sha, size) = fixture();
        let first = &bytes[..9];
        transfers.begin(&sha, u64::from(size), &sha).await.unwrap();
        transfers.write_chunk(&sha, 0, first, false).await.unwrap();
        manifest::save(
            root.path(),
            &PersistedState {
                update_id: sha.clone(),
                kind: OtaKind::Bandaid,
                expected_size: u64::from(size),
                expected_sha256: sha.clone(),
                target_version: None,
                transfer_window_size: None,
                peer: None,
            },
        )
        .await
        .unwrap();

        let (handle, _events_rx) = spawn_actor(&root);
        let (authorize_tx, authorize_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: OtaPackageReady {
                    update_id: sha.clone(),
                    version: "4.2.0+20260725010101".into(),
                    size,
                    expected_sha256: sha.clone(),
                    resume_from_offset: first.len() as u32,
                    max_transfer_chunk_size: None,
                    supports_chunked_transfer_response: None,
                    transfer_data_encoding: None,
                },
                transfer_window_size: 1800,
                source: test_source(),
                ack: authorize_tx,
            })
            .await
            .unwrap();
        assert_eq!(
            authorize_rx.await.unwrap().unwrap_err(),
            format!("ota source route is not active for {sha}")
        );

        let ack = do_begin(&handle, &sha, size)
            .await
            .expect("recovered transfer should resume");

        assert_eq!(ack.resume_from_offset, first.len() as u32);
        assert_eq!(tokio::fs::read(transfers.path(&sha)).await.unwrap(), first);

        let (authorize_tx, authorize_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: OtaPackageReady {
                    update_id: sha.clone(),
                    version: "4.2.0+20260725010101".into(),
                    size,
                    expected_sha256: sha,
                    resume_from_offset: first.len() as u32,
                    max_transfer_chunk_size: None,
                    supports_chunked_transfer_response: None,
                    transfer_data_encoding: None,
                },
                transfer_window_size: 1800,
                source: test_source(),
                ack: authorize_tx,
            })
            .await
            .unwrap();
        let authorization = authorize_rx
            .await
            .unwrap()
            .expect("ota.begin should bind the resumed transfer to the live route");
        assert_eq!(authorization.resume_from_offset, first.len() as u32);
        assert_eq!(authorization.transfer_window_size, 1800);
        assert_eq!(
            manifest::load(root.path())
                .await
                .unwrap()
                .unwrap()
                .target_version
                .as_deref(),
            Some("4.2.0+20260725010101")
        );
    }

    #[tokio::test]
    async fn installed_version_marker_is_atomic_and_validated() {
        let root = tempfile::TempDir::new().unwrap();
        let marker = root.path().join(".floor-version");

        write_installed_version_marker(&marker, "4.2.0+20260725010101")
            .await
            .unwrap();
        assert_eq!(
            tokio::fs::read_to_string(&marker).await.unwrap(),
            "4.2.0+20260725010101\n"
        );

        write_installed_version_marker(&marker, "4.2.1")
            .await
            .unwrap();
        assert_eq!(tokio::fs::read_to_string(&marker).await.unwrap(), "4.2.1\n");

        let error = write_installed_version_marker(&marker, "4.2.2\nmalicious")
            .await
            .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert_eq!(tokio::fs::read_to_string(&marker).await.unwrap(), "4.2.1\n");
    }

    #[tokio::test]
    async fn restart_cleans_transfer_already_committed_to_version_marker() {
        let root = tempfile::TempDir::new().unwrap();
        let transfers = ChunkedTransfer::new(root.path().join("transfers"));
        let (bytes, sha, size) = fixture();
        transfers.begin(&sha, u64::from(size), &sha).await.unwrap();
        transfers
            .write_chunk(&sha, 0, &bytes[..9], false)
            .await
            .unwrap();
        manifest::save(
            root.path(),
            &PersistedState {
                update_id: sha.clone(),
                kind: OtaKind::Bandaid,
                expected_size: u64::from(size),
                expected_sha256: sha.clone(),
                target_version: Some("4.1.0".into()),
                transfer_window_size: None,
                peer: None,
            },
        )
        .await
        .unwrap();

        let (_handle, _events_rx) = spawn_actor(&root);
        timeout(Duration::from_secs(1), async {
            while tokio::fs::try_exists(transfers.path(&sha)).await.unwrap()
                || manifest::load(root.path()).await.unwrap().is_some()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("recovery should clean an already installed transfer");

        assert!(manifest::load(root.path()).await.unwrap().is_none());
        assert!(!tokio::fs::try_exists(transfers.meta_path(&sha))
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn transient_transfer_pause_keeps_partial_for_next_begin() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (bytes, sha, size) = fixture();
        let first = bytes[..9].to_vec();
        do_begin(&handle, &sha, size).await.expect("begin ok");

        let (chunk_ack, chunk_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: sha.clone(),
                    offset: 0,
                    bytes: first.clone(),
                    last: false,
                },
                source: test_source(),
                ack: chunk_ack,
            })
            .await
            .unwrap();
        chunk_rx.await.unwrap().expect("first chunk should persist");
        handle
            .cmd_tx
            .send(Command::TransferPaused {
                update_id: sha.clone(),
                source: test_source(),
                message: "session disconnected".into(),
            })
            .await
            .unwrap();

        let ack = do_begin(&handle, &sha, size)
            .await
            .expect("retry begin should succeed");
        assert_eq!(ack.resume_from_offset, first.len() as u32);
    }

    #[tokio::test]
    async fn retry_begin_cannot_change_the_installer_kind() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");

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
                source: test_source(),
                ack: ack_tx,
            })
            .await
            .unwrap();

        assert!(ack_rx
            .await
            .unwrap()
            .unwrap_err()
            .reason
            .contains("was begun as"));
        assert_eq!(
            manifest::load(root.path()).await.unwrap().unwrap().kind,
            OtaKind::Bandaid
        );
    }

    #[tokio::test]
    async fn stale_source_route_cannot_append_to_active_transfer() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (bytes, sha, size) = fixture();
        let active = OtaSource::new(None, Some("active-route".into()));
        let stale = OtaSource::new(None, Some("stale-route".into()));
        do_begin_from(&handle, &sha, size, active)
            .await
            .expect("begin ok");

        let (ack, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: sha.clone(),
                    offset: 0,
                    bytes: bytes[..4].to_vec(),
                    last: false,
                },
                source: stale,
                ack,
            })
            .await
            .unwrap();

        assert!(rx.await.unwrap().is_err());
        assert_eq!(
            tokio::fs::metadata(root.path().join("transfers").join(format!("{sha}.partial")))
                .await
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn package_ready_must_match_begin_metadata() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");

        let (ack, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: OtaPackageReady {
                    update_id: sha.clone(),
                    version: "4.2.0".into(),
                    size: size + 1,
                    expected_sha256: sha,
                    resume_from_offset: 0,
                    max_transfer_chunk_size: None,
                    supports_chunked_transfer_response: None,
                    transfer_data_encoding: None,
                },
                transfer_window_size: 1800,
                source: test_source(),
                ack,
            })
            .await
            .unwrap();

        assert!(rx.await.unwrap().unwrap_err().contains("does not match"));
        assert_eq!(
            manifest::load(root.path())
                .await
                .unwrap()
                .unwrap()
                .target_version,
            None
        );
    }

    #[tokio::test]
    async fn package_ready_uses_the_durable_device_resume_offset() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");
        let first = bytes[..9].to_vec();
        let (chunk_ack, chunk_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: sha.clone(),
                    offset: 0,
                    bytes: first.clone(),
                    last: false,
                },
                source: test_source(),
                ack: chunk_ack,
            })
            .await
            .unwrap();
        chunk_rx.await.unwrap().unwrap();

        let (ack, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: OtaPackageReady {
                    update_id: sha.clone(),
                    version: "4.2.0".into(),
                    size,
                    expected_sha256: sha.clone(),
                    resume_from_offset: 0,
                    max_transfer_chunk_size: None,
                    supports_chunked_transfer_response: None,
                    transfer_data_encoding: None,
                },
                transfer_window_size: 1800,
                source: test_source(),
                ack,
            })
            .await
            .unwrap();

        let authorization = rx
            .await
            .unwrap()
            .expect("a stale client offset should not reject a durable partial");
        assert_eq!(authorization.resume_from_offset, first.len() as u32);
        assert_eq!(authorization.transfer_window_size, 1800);
        assert_eq!(
            tokio::fs::read(root.path().join("transfers").join(format!("{sha}.partial")))
                .await
                .unwrap(),
            first
        );
    }

    #[tokio::test]
    async fn package_ready_can_grow_the_window_without_changing_the_durable_offset() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");
        let ready = OtaPackageReady {
            update_id: sha.clone(),
            version: "4.2.0".into(),
            size,
            expected_sha256: sha.clone(),
            resume_from_offset: 0,
            max_transfer_chunk_size: None,
            supports_chunked_transfer_response: None,
            transfer_data_encoding: None,
        };

        let (legacy_ack, legacy_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: ready.clone(),
                transfer_window_size: 1800,
                source: test_source(),
                ack: legacy_ack,
            })
            .await
            .unwrap();
        assert_eq!(legacy_rx.await.unwrap().unwrap().transfer_window_size, 1800);

        let first = bytes[..9].to_vec();
        let (chunk_ack, chunk_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::PulledChunk {
                chunk: OtaChunk {
                    update_id: sha.clone(),
                    offset: 0,
                    bytes: first.clone(),
                    last: false,
                },
                source: test_source(),
                ack: chunk_ack,
            })
            .await
            .unwrap();
        chunk_rx.await.unwrap().unwrap();

        let grown_window = 256 * 1024;
        let (grown_ack, grown_rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready,
                transfer_window_size: grown_window,
                source: test_source(),
                ack: grown_ack,
            })
            .await
            .unwrap();
        let authorization = grown_rx.await.unwrap().unwrap();

        assert_eq!(authorization.resume_from_offset, first.len() as u32);
        assert_eq!(authorization.transfer_window_size, grown_window);
        assert_eq!(
            tokio::fs::read(root.path().join("transfers").join(format!("{sha}.partial")))
                .await
                .unwrap(),
            first
        );
        assert_eq!(
            manifest::load(root.path())
                .await
                .unwrap()
                .unwrap()
                .transfer_window_size,
            Some(grown_window)
        );
    }

    #[tokio::test]
    async fn package_ready_cannot_change_an_authorized_target_version() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");

        for (version, expect_ok) in [("4.2.0", true), ("4.3.0", false)] {
            let (ack, rx) = oneshot::channel();
            handle
                .cmd_tx
                .send(Command::AuthorizePull {
                    ready: OtaPackageReady {
                        update_id: sha.clone(),
                        version: version.into(),
                        size,
                        expected_sha256: sha.clone(),
                        resume_from_offset: 0,
                        max_transfer_chunk_size: None,
                        supports_chunked_transfer_response: None,
                        transfer_data_encoding: None,
                    },
                    transfer_window_size: 1800,
                    source: test_source(),
                    ack,
                })
                .await
                .unwrap();
            let result = rx.await.unwrap();
            assert_eq!(result.is_ok(), expect_ok, "unexpected result for {version}");
        }

        assert_eq!(
            manifest::load(root.path())
                .await
                .unwrap()
                .unwrap()
                .target_version
                .as_deref(),
            Some("4.2.0")
        );
    }

    #[tokio::test]
    async fn package_ready_rejects_reinstall_before_pull() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, _events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();
        do_begin(&handle, &sha, size).await.expect("begin ok");

        let (ack, rx) = oneshot::channel();
        handle
            .cmd_tx
            .send(Command::AuthorizePull {
                ready: OtaPackageReady {
                    update_id: sha.clone(),
                    version: "4.1.0".into(),
                    size,
                    expected_sha256: sha.clone(),
                    resume_from_offset: 0,
                    max_transfer_chunk_size: None,
                    supports_chunked_transfer_response: None,
                    transfer_data_encoding: None,
                },
                transfer_window_size: 1800,
                source: test_source(),
                ack,
            })
            .await
            .unwrap();

        assert!(rx.await.unwrap().unwrap_err().contains("is not newer"));
        assert_eq!(
            tokio::fs::metadata(root.path().join("transfers").join(format!("{sha}.partial")))
                .await
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn package_ready_compares_the_version_for_the_requested_kind() {
        for (kind, expect_ok) in [(OtaKind::Image, true), (OtaKind::Bandaid, false)] {
            let root = tempfile::TempDir::new().unwrap();
            let (handle, _events_rx) = spawn_actor_with_versions(
                &root,
                InstalledVersions {
                    image: Ok("4.1.0".into()),
                    bandaid: Ok("5.0.0".into()),
                },
            );
            let (_bytes, sha, size) = fixture();
            do_begin_kind_from(&handle, &sha, size, kind, test_source())
                .await
                .expect("begin ok");

            let (ack, rx) = oneshot::channel();
            handle
                .cmd_tx
                .send(Command::AuthorizePull {
                    ready: OtaPackageReady {
                        update_id: sha.clone(),
                        version: "4.2.0".into(),
                        size,
                        expected_sha256: sha,
                        resume_from_offset: 0,
                        max_transfer_chunk_size: None,
                        supports_chunked_transfer_response: None,
                        transfer_data_encoding: None,
                    },
                    transfer_window_size: 1800,
                    source: test_source(),
                    ack,
                })
                .await
                .unwrap();

            assert_eq!(
                rx.await.unwrap().is_ok(),
                expect_ok,
                "unexpected result for {kind:?}"
            );
        }
    }

    #[test]
    fn update_id_rejects_path_traversal() {
        for invalid in ["../escape", "nested/path", "nested\\path", ".", ".."] {
            assert!(validate_update_id(invalid).is_err(), "accepted {invalid:?}");
        }
        assert!(validate_update_id("release-2.1.0_abc123").is_ok());
    }

    #[test]
    fn target_version_matches_floor_sync_version_grammar() {
        for valid in [
            "4.2.0",
            "v4.2.0",
            "4.2.0-rc.1",
            "4.2.0+20260725010101",
            "4.2.0-rc.1+20260725010101",
        ] {
            assert!(validate_target_version(valid).is_ok(), "rejected {valid:?}");
        }
        for invalid in [
            "unknown",
            "4.2",
            "4.2.0_unsafe",
            "4.2.0+",
            "4.2.0-",
            "4.2.0\nunsafe",
        ] {
            assert!(
                validate_target_version(invalid).is_err(),
                "accepted {invalid:?}"
            );
        }
    }

    #[test]
    fn ota_version_policy_orders_build_timestamps_after_semver_precedence() {
        for (candidate, installed) in [
            ("4.2.1", "4.2.0+99999999999999"),
            ("4.2.0", "4.2.0-rc.9+99999999999999"),
            ("4.2.0-rc.2", "4.2.0-rc.1+99999999999999"),
            ("4.2.0+20260725010102", "4.2.0+20260725010101"),
            ("4.2.0+100000000000000", "4.2.0+99999999999999"),
        ] {
            assert!(
                version_is_strictly_newer(candidate, installed).unwrap(),
                "expected {candidate} to be newer than {installed}"
            );
        }

        for (candidate, installed) in [
            ("4.1.9+99999999999999", "4.2.0"),
            ("4.2.0-rc.1+99999999999999", "4.2.0"),
            ("4.2.0+20260725010101", "4.2.0+20260725010101"),
            ("4.2.0+20260725010100", "4.2.0+20260725010101"),
            ("4.2.0", "4.2.0+20260725010101"),
        ] {
            assert!(
                !version_is_strictly_newer(candidate, installed).unwrap(),
                "expected {candidate} not to be newer than {installed}"
            );
        }
    }

    fn actor_with_state(root: &tempfile::TempDir, state: OtaState) -> OtaActor {
        actor_with_state_and_versions(root, state, test_installed_versions())
    }

    fn actor_with_state_and_versions(
        root: &tempfile::TempDir,
        state: OtaState,
        installed_versions: InstalledVersions,
    ) -> OtaActor {
        let (events_tx, _events_rx) = mpsc::channel(16);
        let (self_tx, cmd_rx) = mpsc::channel(16);
        OtaActor {
            transfers: ChunkedTransfer::new(root.path().join("transfers")),
            events_tx,
            delta_source: delta_source::noop_source(),
            persist_dir: root.path().to_path_buf(),
            self_tx,
            cmd_rx,
            state,
            installed_versions,
            last_streaming_emit_at: None,
            last_streaming_percent: None,
        }
    }

    #[tokio::test]
    async fn recovery_compares_the_version_for_the_persisted_kind() {
        for (kind, expect_recovered) in [(OtaKind::Image, true), (OtaKind::Bandaid, false)] {
            let root = tempfile::TempDir::new().unwrap();
            let transfers = ChunkedTransfer::new(root.path().join("transfers"));
            let (bytes, sha, size) = fixture();
            transfers.begin(&sha, u64::from(size), &sha).await.unwrap();
            transfers
                .write_chunk(&sha, 0, &bytes[..9], false)
                .await
                .unwrap();
            manifest::save(
                root.path(),
                &PersistedState {
                    update_id: sha.clone(),
                    kind,
                    expected_size: u64::from(size),
                    expected_sha256: sha.clone(),
                    target_version: Some("4.2.0".into()),
                    transfer_window_size: Some(1800),
                    peer: None,
                },
            )
            .await
            .unwrap();
            let mut actor = actor_with_state_and_versions(
                &root,
                OtaState::Idle,
                InstalledVersions {
                    image: Ok("4.1.0".into()),
                    bandaid: Ok("5.0.0".into()),
                },
            );

            actor.recover_from_persisted_manifest().await;

            assert_eq!(
                matches!(actor.state, OtaState::Streaming { kind: recovered, .. } if recovered == kind),
                expect_recovered,
                "unexpected recovery state for {kind:?}",
            );
            assert_eq!(
                manifest::load(root.path()).await.unwrap().is_some(),
                expect_recovered,
                "unexpected persisted manifest state for {kind:?}",
            );
        }
    }

    #[tokio::test]
    async fn writing_cancel_is_rejected_without_changing_state() {
        let root = tempfile::TempDir::new().unwrap();
        let source = test_source();
        let write_id = uuid::Uuid::new_v4();
        let mut actor = actor_with_state(
            &root,
            OtaState::Writing {
                kind: OtaKind::Image,
                update_id: "update-1".into(),
                expected_size: 42,
                expected_sha256: "a".repeat(64),
                target_version: Some("4.2.0".into()),
                transfer_window_size: Some(1800),
                source: source.clone(),
                write_id,
                target_slot: None,
            },
        );

        let error = actor
            .handle_cancel(&source)
            .await
            .expect_err("writing cancel must be rejected");

        assert!(error.contains("cannot be cancelled"));
        assert!(matches!(
            actor.state,
            OtaState::Writing {
                write_id: active,
                ..
            } if active == write_id
        ));
    }

    #[tokio::test]
    async fn stale_write_completion_cannot_finalize_current_write() {
        let root = tempfile::TempDir::new().unwrap();
        let write_id = uuid::Uuid::new_v4();
        let mut actor = actor_with_state(
            &root,
            OtaState::Writing {
                kind: OtaKind::Bandaid,
                update_id: "current-update".into(),
                expected_size: 42,
                expected_sha256: "a".repeat(64),
                target_version: Some("4.2.0".into()),
                transfer_window_size: Some(1800),
                source: test_source(),
                write_id,
                target_slot: None,
            },
        );

        actor
            .handle_write_finished("old-update".into(), uuid::Uuid::new_v4(), None)
            .await;

        assert!(matches!(
            actor.state,
            OtaState::Writing {
                ref update_id,
                write_id: active,
                ..
            } if update_id == "current-update" && active == write_id
        ));
    }

    #[tokio::test]
    async fn begin_during_writing_is_rejected() {
        let root = tempfile::TempDir::new().unwrap();
        let (_bytes, sha, size) = fixture();
        let mut actor = actor_with_state(
            &root,
            OtaState::Writing {
                kind: OtaKind::Bandaid,
                update_id: sha.clone(),
                expected_size: u64::from(size),
                expected_sha256: sha.clone(),
                target_version: Some("4.2.0".into()),
                transfer_window_size: Some(1800),
                source: test_source(),
                write_id: uuid::Uuid::new_v4(),
                target_slot: None,
            },
        );
        let (ack, rx) = oneshot::channel();
        actor
            .handle_begin(
                OtaBegin {
                    kind: OtaKind::Bandaid,
                    update_id: sha.clone(),
                    update_url_base: None,
                    expected_sha256: sha,
                    expected_size: size,
                },
                test_source(),
                ack,
            )
            .await;

        let err = rx
            .await
            .unwrap()
            .expect_err("second begin should be rejected during Writing");
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
            .send(Command::Chunk {
                chunk: OtaChunk {
                    update_id: "wrong-update-id".to_string(),
                    offset: 0,
                    bytes: vec![1, 2, 3],
                    last: false,
                },
                source: test_source(),
            })
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
    async fn download_progress_emits_downloading_phase() {
        let root = tempfile::TempDir::new().unwrap();
        let (handle, mut events_rx) = spawn_actor(&root);
        let (_bytes, sha, size) = fixture();

        do_begin(&handle, &sha, size).await.expect("begin ok");

        // Companion-reported mid-download progress is re-emitted as a Downloading
        // progress event for the device webapp.
        handle
            .cmd_tx
            .send(Command::DownloadProgress {
                update_id: sha.clone(),
                percent: 42,
                source: test_source(),
            })
            .await
            .unwrap();

        // begin emits an initial Downloading(0); wait for our reported 42.
        let progress = timeout(Duration::from_secs(2), async {
            loop {
                match events_rx.recv().await.expect("event channel closed") {
                    OtaEvent::Progress(p)
                        if p.phase == OtaPhase::Downloading && p.percent == 42 =>
                    {
                        return p;
                    }
                    OtaEvent::Error(err) => panic!("unexpected ota error: {err:?}"),
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for downloading progress");
        assert_eq!(progress.percent, 42);
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
                source: test_source(),
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
