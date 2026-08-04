use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use bluer::Address;
use libnocturne::{
    gateway::{
        OtaAssetRange, OtaAssetRangeAbandon, OtaAssetRangeChunk, OtaAssetRangeRejected,
        OtaAssetRangeReply,
    },
    OtaPhase, OtaProgress, RangePart, RangeSpec,
};
use tokio::{
    io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::{mpsc, oneshot},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::ota::{OtaEvent, OtaEventTx};

pub const DEFAULT_SOCKET_PATH: &str = "/run/nocturne/ota-range.sock";

const BROKER_MAILBOX: usize = 64;
const CHUNK_QUEUE: usize = 16;
const FRAME_DATA_MAX: usize = 16 * 1024;
const MULTIPART_BOUNDARY: &str = "nocturne-ota-range-boundary";
const REPLY_TIMEOUT: Duration = Duration::from_secs(60);
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(60);

const FRAME_HEADER: u8 = b'H';
const FRAME_DATA: u8 = b'D';
const FRAME_COMPLETE: u8 = b'C';
const FRAME_ERROR: u8 = b'E';

#[derive(Clone)]
pub struct DeltaSource {
    cmd_tx: mpsc::Sender<BrokerCmd>,
}

impl std::fmt::Debug for DeltaSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeltaSource").finish_non_exhaustive()
    }
}

pub struct DeltaSourceHandle {
    pub source: DeltaSource,
    _cancel: CancellationToken,
    _broker: JoinHandle<()>,
    _server: Option<JoinHandle<()>>,
}

impl DeltaSource {
    pub async fn spawn(
        events_tx: OtaEventTx,
        socket_path: impl Into<PathBuf>,
    ) -> DeltaSourceHandle {
        let (cmd_tx, cmd_rx) = mpsc::channel(BROKER_MAILBOX);
        let cancel = CancellationToken::new();
        let socket_path = socket_path.into();

        let broker = BrokerActor {
            cmd_rx,
            active: None,
            inflight: Default::default(),
            events_tx,
        };
        let _broker = tokio::spawn(broker.run());

        let source = DeltaSource { cmd_tx };
        let _server = match spawn_socket_server(source.clone(), socket_path.clone(), cancel.clone())
            .await
        {
            Ok(handle) => Some(handle),
            Err(err) => {
                tracing::error!(
                    ?err,
                    path = %socket_path.display(),
                    "ota delta source failed to bind Unix socket; image delta OTA unavailable until restart",
                );
                None
            }
        };

        DeltaSourceHandle {
            source,
            _cancel: cancel,
            _broker,
            _server,
        }
    }

    pub async fn activate(&self, update_id: String, peer: Option<Address>, route: Option<String>) {
        if let Err(err) = self
            .cmd_tx
            .send(BrokerCmd::Activate {
                update_id,
                peer,
                route,
            })
            .await
        {
            tracing::error!(?err, "delta source mailbox closed; activate dropped");
        }
    }

    pub async fn deactivate(&self) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::Deactivate).await {
            tracing::error!(?err, "delta source mailbox closed; deactivate dropped");
        }
    }

    pub async fn route_chunk(&self, chunk: OtaAssetRangeChunk) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::RouteChunk(chunk)).await {
            tracing::error!(?err, "delta source mailbox closed; chunk dropped");
        }
    }

    pub async fn route_reply(&self, reply: OtaAssetRangeReply) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::RouteReply(reply)).await {
            tracing::error!(?err, "delta source mailbox closed; reply dropped");
        }
    }

    pub async fn route_rejected(&self, rejected: OtaAssetRangeRejected) {
        if let Err(err) = self.cmd_tx.send(BrokerCmd::RouteRejected(rejected)).await {
            tracing::error!(?err, "delta source mailbox closed; rejection dropped");
        }
    }

    async fn begin_range_active(
        &self,
        request_id: Uuid,
        chunk_tx: mpsc::Sender<OtaAssetRangeChunk>,
    ) -> Result<RangeBegin, BeginRangeError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        let (asset_reply_tx, asset_reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(BrokerCmd::BeginRange {
                request_id,
                chunk_tx,
                asset_reply_tx,
                reply: reply_tx,
            })
            .await
            .map_err(|_| BeginRangeError::SourceDown)?;
        let update_id = reply_rx.await.map_err(|_| BeginRangeError::SourceDown)??;
        Ok(RangeBegin {
            update_id,
            reply_rx: asset_reply_rx,
        })
    }

    async fn end_range(&self, request_id: Uuid) {
        let _ = self.cmd_tx.send(BrokerCmd::EndRange { request_id }).await;
    }

    async fn send_asset_range(&self, request_id: Uuid, req: OtaAssetRange) {
        let _ = self
            .cmd_tx
            .send(BrokerCmd::SendAssetRange { request_id, req })
            .await;
    }

    async fn emit_progress(&self, progress: OtaProgress) {
        let _ = self.cmd_tx.send(BrokerCmd::EmitProgress(progress)).await;
    }

    async fn abandon_range(&self, request_id: Uuid) {
        let _ = self
            .cmd_tx
            .send(BrokerCmd::SendAssetRangeAbandon(OtaAssetRangeAbandon {
                request_id,
            }))
            .await;
    }
}

struct RangeBegin {
    update_id: String,
    reply_rx: oneshot::Receiver<Result<OtaAssetRangeReply, String>>,
}

#[derive(Debug)]
enum BeginRangeError {
    NoActiveOta,
    SourceDown,
}

enum BrokerCmd {
    Activate {
        update_id: String,
        peer: Option<Address>,
        route: Option<String>,
    },
    Deactivate,
    BeginRange {
        request_id: Uuid,
        chunk_tx: mpsc::Sender<OtaAssetRangeChunk>,
        asset_reply_tx: oneshot::Sender<Result<OtaAssetRangeReply, String>>,
        reply: oneshot::Sender<Result<String, BeginRangeError>>,
    },
    RouteChunk(OtaAssetRangeChunk),
    RouteReply(OtaAssetRangeReply),
    RouteRejected(OtaAssetRangeRejected),
    EndRange {
        request_id: Uuid,
    },
    SendAssetRange {
        request_id: Uuid,
        req: OtaAssetRange,
    },
    EmitProgress(OtaProgress),
    SendAssetRangeAbandon(OtaAssetRangeAbandon),
}

#[derive(Debug, Clone)]
struct ActiveOta {
    update_id: String,
    peer: Option<Address>,
    route: Option<String>,
}

struct InflightRange {
    chunk_tx: mpsc::Sender<OtaAssetRangeChunk>,
    reply_tx: Option<oneshot::Sender<Result<OtaAssetRangeReply, String>>>,
}

struct BrokerActor {
    cmd_rx: mpsc::Receiver<BrokerCmd>,
    active: Option<ActiveOta>,
    inflight: std::collections::HashMap<Uuid, InflightRange>,
    events_tx: OtaEventTx,
}

impl BrokerActor {
    async fn run(mut self) {
        tracing::info!("ota delta source broker started");
        while let Some(cmd) = self.cmd_rx.recv().await {
            match cmd {
                BrokerCmd::Activate {
                    update_id,
                    peer,
                    route,
                } => {
                    tracing::info!(%update_id, ?peer, ?route, "ota delta source activated");
                    self.active = Some(ActiveOta {
                        update_id,
                        peer,
                        route,
                    });
                }
                BrokerCmd::Deactivate => {
                    if let Some(active) = self.active.take() {
                        tracing::info!(update_id = %active.update_id, "ota delta source deactivated");
                    }
                    self.inflight.clear();
                }
                BrokerCmd::BeginRange {
                    request_id,
                    chunk_tx,
                    asset_reply_tx,
                    reply,
                } => {
                    let result = match &self.active {
                        None => Err(BeginRangeError::NoActiveOta),
                        Some(active) => {
                            self.inflight.insert(
                                request_id,
                                InflightRange {
                                    chunk_tx,
                                    reply_tx: Some(asset_reply_tx),
                                },
                            );
                            Ok(active.update_id.clone())
                        }
                    };
                    let _ = reply.send(result);
                }
                BrokerCmd::RouteChunk(chunk) => {
                    let request_id = chunk.request_id;
                    if let Some(inflight) = self.inflight.get(&request_id) {
                        if inflight.chunk_tx.send(chunk).await.is_err() {
                            tracing::debug!(%request_id, "inflight delta range channel closed; evicting");
                            self.inflight.remove(&request_id);
                        }
                    } else {
                        tracing::debug!(
                            %request_id,
                            "OtaAssetRangeChunk for unknown delta range request",
                        );
                    }
                }
                BrokerCmd::RouteReply(reply) => {
                    let request_id = reply.request_id;
                    if let Some(inflight) = self.inflight.get_mut(&request_id) {
                        if let Some(tx) = inflight.reply_tx.take() {
                            let _ = tx.send(Ok(reply));
                        }
                    } else {
                        tracing::debug!(%request_id, "OtaAssetRangeReply for unknown request_id");
                    }
                }
                BrokerCmd::RouteRejected(rejected) => {
                    let request_id = rejected.request_id;
                    if let Some(mut inflight) = self.inflight.remove(&request_id) {
                        if let Some(tx) = inflight.reply_tx.take() {
                            let _ = tx.send(Err(rejected.reason));
                        }
                    } else {
                        tracing::debug!(%request_id, "OtaAssetRangeRejected for unknown request_id");
                    }
                }
                BrokerCmd::EndRange { request_id } => {
                    self.inflight.remove(&request_id);
                }
                BrokerCmd::SendAssetRange { request_id, req } => {
                    let peer = self.active.as_ref().and_then(|active| active.peer);
                    let route = self.active.as_ref().and_then(|active| active.route.clone());
                    let _ = self
                        .events_tx
                        .send(OtaEvent::AssetRange {
                            peer,
                            route,
                            request_id,
                            req,
                        })
                        .await;
                }
                BrokerCmd::EmitProgress(progress) => {
                    let _ = self.events_tx.send(OtaEvent::Progress(progress)).await;
                }
                BrokerCmd::SendAssetRangeAbandon(abandon) => {
                    self.inflight.remove(&abandon.request_id);
                    let peer = self.active.as_ref().and_then(|active| active.peer);
                    let route = self.active.as_ref().and_then(|active| active.route.clone());
                    let _ = self
                        .events_tx
                        .send(OtaEvent::AssetRangeAbandon {
                            peer,
                            route,
                            abandon,
                        })
                        .await;
                }
            }
        }
        tracing::info!("ota delta source broker exiting");
    }
}

async fn spawn_socket_server(
    source: DeltaSource,
    socket_path: PathBuf,
    cancel: CancellationToken,
) -> std::io::Result<JoinHandle<()>> {
    prepare_socket_path(&socket_path).await?;
    let listener = UnixListener::bind(&socket_path)?;
    set_socket_permissions(&socket_path)?;
    tracing::info!(path = %socket_path.display(), "ota delta source listening");

    let handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                incoming = listener.accept() => {
                    match incoming {
                        Ok((stream, _addr)) => {
                            let source = source.clone();
                            tokio::spawn(async move {
                                if let Err(err) = handle_socket_client(source, stream).await {
                                    tracing::warn!(?err, "ota delta source request failed");
                                }
                            });
                        }
                        Err(err) => {
                            tracing::error!(?err, "ota delta source accept failed");
                            break;
                        }
                    }
                }
                _ = cancel.cancelled() => {
                    tracing::debug!("ota delta source server shutting down");
                    break;
                }
            }
        }
        let _ = tokio::fs::remove_file(&socket_path).await;
    });

    Ok(handle)
}

async fn prepare_socket_path(path: &Path) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    match tokio::fs::remove_file(path).await {
        Ok(()) => {}
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
        Err(err) => return Err(err),
    }
    Ok(())
}

#[cfg(unix)]
fn set_socket_permissions(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666))
}

async fn handle_socket_client(source: DeltaSource, stream: UnixStream) -> Result<(), String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .await
        .map_err(|err| format!("failed to read delta source request: {err}"))?;
    if bytes == 0 {
        return Err("delta source client disconnected before request".into());
    }

    let request = parse_request_line(&line)?;
    let stream = reader.into_inner();
    stream_delta_range(source, stream, request).await
}

#[derive(Debug, Clone)]
struct DeltaSocketRequest {
    asset: String,
    ranges: Vec<RangeSpec>,
}

fn parse_request_line(line: &str) -> Result<DeltaSocketRequest, String> {
    let mut parts = line.trim_end_matches(['\r', '\n']).split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "delta source request is empty".to_string())?;
    if method != "GET" {
        return Err(format!("unsupported delta source method {method}"));
    }

    let asset = parts
        .next()
        .filter(|asset| !asset.is_empty())
        .ok_or_else(|| "delta source request missing asset".to_string())?;
    let ranges = parts
        .next()
        .ok_or_else(|| "delta source request missing range list".to_string())?;
    if parts.next().is_some() {
        return Err("delta source request has extra fields".into());
    }

    Ok(DeltaSocketRequest {
        asset: asset.to_string(),
        ranges: parse_range_list(ranges)?,
    })
}

fn parse_range_list(value: &str) -> Result<Vec<RangeSpec>, String> {
    let mut out = Vec::new();
    for piece in value.split(',').map(str::trim) {
        if piece.is_empty() {
            return Err("range list contains an empty range".into());
        }
        let (start, end) = piece
            .split_once('-')
            .ok_or_else(|| format!("range {piece} is missing '-'"))?;
        if start.is_empty() || end.is_empty() {
            return Err(format!("range {piece} must be fully bounded"));
        }
        let start: u32 = start
            .parse()
            .map_err(|_| format!("range {piece} start is invalid"))?;
        let end: u32 = end
            .parse()
            .map_err(|_| format!("range {piece} end is invalid"))?;
        if end < start {
            return Err(format!("range {piece} has end before start"));
        }
        let length = end
            .checked_sub(start)
            .and_then(|delta| delta.checked_add(1))
            .ok_or_else(|| format!("range {piece} length overflowed"))?;
        out.push(RangeSpec { start, length });
    }
    if out.is_empty() {
        return Err("range list is empty".into());
    }
    Ok(out)
}

async fn stream_delta_range(
    source: DeltaSource,
    mut stream: UnixStream,
    request: DeltaSocketRequest,
) -> Result<(), String> {
    let (request_id, reply, chunk_rx) =
        match begin_and_request_range(&source, &request.asset, request.ranges).await {
            Ok(v) => v,
            Err(err) => {
                write_error_frame(&mut stream, &err).await?;
                return Err(err);
            }
        };

    let plan = match ResponsePlan::from_reply(&reply) {
        Ok(plan) => plan,
        Err(reason) => {
            source.abandon_range(request_id).await;
            write_error_frame(&mut stream, &reason).await?;
            return Err(reason);
        }
    };

    if let Err(err) = stream_plan(
        &source,
        &mut stream,
        request_id,
        &request.asset,
        plan,
        chunk_rx,
    )
    .await
    {
        write_error_frame(&mut stream, &err).await?;
        return Err(err);
    }

    Ok(())
}

async fn begin_and_request_range(
    source: &DeltaSource,
    asset: &str,
    ranges: Vec<RangeSpec>,
) -> Result<(Uuid, OtaAssetRangeReply, mpsc::Receiver<OtaAssetRangeChunk>), String> {
    let request_id = Uuid::new_v4();
    let requested_ranges = ranges.clone();
    let (chunk_tx, chunk_rx) = mpsc::channel::<OtaAssetRangeChunk>(CHUNK_QUEUE);
    let begin = match source.begin_range_active(request_id, chunk_tx).await {
        Ok(begin) => begin,
        Err(BeginRangeError::NoActiveOta) => {
            return Err("no image OTA write is active".into());
        }
        Err(BeginRangeError::SourceDown) => {
            return Err("delta source broker unavailable".into());
        }
    };

    source
        .send_asset_range(
            request_id,
            OtaAssetRange {
                update_id: begin.update_id.clone(),
                asset: asset.to_string(),
                ranges,
            },
        )
        .await;

    match tokio::time::timeout(REPLY_TIMEOUT, begin.reply_rx).await {
        Ok(Ok(Ok(reply))) => {
            if let Err(reason) = validate_reply_matches_request(&reply, &requested_ranges) {
                source.abandon_range(request_id).await;
                return Err(reason);
            }
            Ok((request_id, reply, chunk_rx))
        }
        Ok(Ok(Err(reason))) => {
            source.end_range(request_id).await;
            Err(format!("companion rejected range request: {reason}"))
        }
        Ok(Err(_)) => {
            source.end_range(request_id).await;
            Err("companion range reply dropped".into())
        }
        Err(_) => {
            source.abandon_range(request_id).await;
            Err("companion range reply timed out".into())
        }
    }
}

#[derive(Clone, Debug)]
struct ResponsePlan {
    asset_total_size: u32,
    multipart: bool,
    segments: Vec<BodySegment>,
}

impl ResponsePlan {
    fn from_reply(reply: &OtaAssetRangeReply) -> Result<Self, String> {
        validate_reply_parts(reply)?;

        let multipart = reply.parts.len() > 1;
        let mut segments = Vec::new();
        if multipart {
            for part in &reply.parts {
                segments.push(BodySegment::Fixed(multipart_part_header(
                    *part,
                    reply.total_size,
                )));
                segments.push(BodySegment::Data {
                    source_start: part.start,
                    length: part.length,
                });
            }
            segments.push(BodySegment::Fixed(multipart_final_boundary()));
        } else {
            let part = reply.parts[0];
            segments.push(BodySegment::Data {
                source_start: part.start,
                length: part.length,
            });
        }

        Ok(Self {
            asset_total_size: reply.total_size,
            multipart,
            segments,
        })
    }

    fn data_ranges(&self) -> Vec<RangeSpec> {
        self.segments
            .iter()
            .filter_map(|segment| match segment {
                BodySegment::Data {
                    source_start,
                    length,
                } => Some(RangeSpec {
                    start: *source_start,
                    length: *length,
                }),
                BodySegment::Fixed(_) => None,
            })
            .collect()
    }

    fn data_len(&self) -> u64 {
        self.data_ranges()
            .iter()
            .map(|range| u64::from(range.length))
            .sum()
    }

    fn headers(&self) -> Vec<Vec<u8>> {
        if self.multipart {
            vec![
                format!("Content-Type: multipart/byteranges; boundary={MULTIPART_BOUNDARY}\r\n")
                    .into_bytes(),
            ]
        } else {
            let Some((start, length)) = self.single_data_range() else {
                return Vec::new();
            };
            let end = range_end_inclusive(start, length);
            vec![format!(
                "Content-Range: bytes {start}-{end}/{total}\r\n",
                total = self.asset_total_size
            )
            .into_bytes()]
        }
    }

    fn single_data_range(&self) -> Option<(u32, u32)> {
        let mut data = self.segments.iter().filter_map(|segment| match segment {
            BodySegment::Data {
                source_start,
                length,
            } => Some((*source_start, *length)),
            BodySegment::Fixed(_) => None,
        });
        let first = data.next()?;
        if data.next().is_some() {
            return None;
        }
        Some(first)
    }
}

fn validate_reply_matches_request(
    reply: &OtaAssetRangeReply,
    requested: &[RangeSpec],
) -> Result<(), String> {
    validate_reply_parts(reply)?;
    if reply.parts.len() != requested.len() {
        return Err(format!(
            "companion returned {} range parts for {} requested ranges",
            reply.parts.len(),
            requested.len()
        ));
    }

    for (index, (part, request)) in reply.parts.iter().zip(requested).enumerate() {
        if part.start != request.start || part.length != request.length {
            return Err(format!(
                "companion range part {index} did not match request: got {}, expected {}",
                format_range(part.start, part.length),
                format_range(request.start, request.length)
            ));
        }
    }

    Ok(())
}

fn validate_reply_parts(reply: &OtaAssetRangeReply) -> Result<(), String> {
    if reply.parts.is_empty() {
        return Err("companion returned 0 range parts".into());
    }

    for (index, part) in reply.parts.iter().enumerate() {
        validate_range_bounds(index, part.start, part.length, reply.total_size)?;
    }

    Ok(())
}

fn validate_range_bounds(
    index: usize,
    start: u32,
    length: u32,
    total_size: u32,
) -> Result<(), String> {
    if length == 0 {
        return Err(format!("companion range part {index} has zero length"));
    }

    let end_exclusive = u64::from(start) + u64::from(length);
    if end_exclusive > u64::from(total_size) {
        return Err(format!(
            "companion range part {index} is outside the asset bounds: {} of total {total_size}",
            format_range(start, length)
        ));
    }

    Ok(())
}

fn format_range(start: u32, length: u32) -> String {
    format!("{}-{}", start, range_end_inclusive(start, length))
}

fn range_end_inclusive(start: u32, length: u32) -> u64 {
    u64::from(start) + u64::from(length.saturating_sub(1))
}

#[derive(Clone, Debug)]
enum BodySegment {
    Fixed(Vec<u8>),
    Data { source_start: u32, length: u32 },
}

fn multipart_part_header(part: RangePart, total_size: u32) -> Vec<u8> {
    format!(
        "\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes {start}-{end}/{total}\r\n\r\n",
        boundary = MULTIPART_BOUNDARY,
        start = part.start,
        end = range_end_inclusive(part.start, part.length),
        total = total_size,
    )
    .into_bytes()
}

fn multipart_final_boundary() -> Vec<u8> {
    format!("\r\n--{MULTIPART_BOUNDARY}--\r\n").into_bytes()
}

async fn stream_plan<W>(
    source: &DeltaSource,
    stream: &mut W,
    request_id: Uuid,
    asset: &str,
    plan: ResponsePlan,
    chunk_rx: mpsc::Receiver<OtaAssetRangeChunk>,
) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    stream_plan_with_timeout(
        source,
        stream,
        request_id,
        asset,
        plan,
        chunk_rx,
        CHUNK_IDLE_TIMEOUT,
    )
    .await
}

async fn stream_plan_with_timeout<W>(
    source: &DeltaSource,
    stream: &mut W,
    request_id: Uuid,
    asset: &str,
    plan: ResponsePlan,
    mut chunk_rx: mpsc::Receiver<OtaAssetRangeChunk>,
    chunk_idle_timeout: Duration,
) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let cleanup = OnDropEnd::new(source.clone(), request_id);
    for header in plan.headers() {
        write_frame(stream, FRAME_HEADER, &header).await?;
    }

    let mut data_part_index = 0usize;
    let data_part_count = plan.data_ranges().len();
    let data_total = plan.data_len();
    let mut total_produced = 0u64;
    let mut last_percent = None;

    if data_total > 0 {
        emit_asset_transfer_progress(source, asset, total_produced, data_total, &mut last_percent)
            .await;
    }

    for segment in &plan.segments {
        match segment {
            BodySegment::Fixed(bytes) => {
                write_data_frames(stream, bytes).await?;
            }
            BodySegment::Data {
                source_start,
                length,
            } => {
                let part_total = u64::from(*length);
                let mut produced = 0u64;
                while produced < part_total {
                    let chunk = tokio::time::timeout(chunk_idle_timeout, chunk_rx.recv())
                        .await
                        .map_err(|_| {
                            format!("companion range chunk timed out for request {request_id}")
                        })?
                        .ok_or_else(|| {
                            format!(
                                "companion chunk channel closed mid-stream for request {request_id}"
                            )
                        })?;
                    if chunk.part_index as usize != data_part_index {
                        return Err(format!(
                            "companion chunk part_index out of order for request {request_id}: got {}, expected {data_part_index}",
                            chunk.part_index,
                        ));
                    }
                    if chunk.bytes.is_empty() {
                        return Err(format!(
                            "companion sent an empty range chunk for request {request_id}"
                        ));
                    }

                    let produced_offset: u32 = produced
                        .try_into()
                        .map_err(|_| format!("range offset overflow for request {request_id}"))?;
                    let expected_offset = source_start
                        .checked_add(produced_offset)
                        .ok_or_else(|| format!("range offset overflow for request {request_id}"))?;
                    if chunk.offset != expected_offset {
                        return Err(format!(
                            "companion chunk offset out of order for request {request_id}: got {}, expected {expected_offset}",
                            chunk.offset,
                        ));
                    }

                    let chunk_len = chunk.bytes.len() as u64;
                    produced += chunk_len;
                    if produced > part_total {
                        return Err(format!(
                            "companion sent more bytes than declared for request {request_id}"
                        ));
                    }
                    write_data_frames(stream, &chunk.bytes).await?;

                    total_produced += chunk_len;
                    emit_asset_transfer_progress(
                        source,
                        asset,
                        total_produced,
                        data_total,
                        &mut last_percent,
                    )
                    .await;

                    let reached_part_end = produced == part_total;
                    let is_final_data_part = data_part_index + 1 == data_part_count;
                    if chunk.last && !(is_final_data_part && reached_part_end) {
                        return Err(format!(
                            "companion set last:true before the final byte for request {request_id}"
                        ));
                    }
                    if reached_part_end && is_final_data_part && !chunk.last {
                        return Err(format!(
                            "companion completed the final data range without last:true for request {request_id}"
                        ));
                    }
                }
                data_part_index += 1;
            }
        }
    }

    write_frame(stream, FRAME_COMPLETE, &[]).await?;
    cleanup.finish();
    Ok(())
}

async fn write_error_frame<W>(writer: &mut W, message: &str) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    write_frame(writer, FRAME_ERROR, message.as_bytes()).await
}

async fn write_data_frames<W>(writer: &mut W, bytes: &[u8]) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    for chunk in bytes.chunks(FRAME_DATA_MAX) {
        write_frame(writer, FRAME_DATA, chunk).await?;
    }
    Ok(())
}

async fn write_frame<W>(writer: &mut W, kind: u8, payload: &[u8]) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let len: u32 = payload
        .len()
        .try_into()
        .map_err(|_| "delta source frame payload too large".to_string())?;
    let mut header = [0u8; 5];
    header[0] = kind;
    header[1..].copy_from_slice(&len.to_be_bytes());
    writer
        .write_all(&header)
        .await
        .map_err(|err| format!("failed to write delta source frame header: {err}"))?;
    if !payload.is_empty() {
        writer
            .write_all(payload)
            .await
            .map_err(|err| format!("failed to write delta source frame payload: {err}"))?;
    }
    Ok(())
}

async fn emit_asset_transfer_progress(
    source: &DeltaSource,
    asset: &str,
    transferred: u64,
    total: u64,
    last_percent: &mut Option<u8>,
) {
    let percent = range_transfer_percent(transferred, total);
    if matches!(*last_percent, Some(last) if last == percent) {
        return;
    }
    *last_percent = Some(percent);
    source
        .emit_progress(OtaProgress {
            phase: OtaPhase::Streaming,
            percent,
            eta_ms: None,
            asset: Some(asset.to_string()),
            transferred_bytes: Some(clamp_u32(transferred)),
            total_bytes: Some(clamp_u32(total)),
        })
        .await;
}

fn range_transfer_percent(transferred: u64, total: u64) -> u8 {
    if total == 0 {
        return 100;
    }
    ((transferred.saturating_mul(100)) / total).min(100) as u8
}

fn clamp_u32(value: u64) -> u32 {
    value.min(u64::from(u32::MAX)) as u32
}

struct OnDropEnd {
    source: DeltaSource,
    request_id: Uuid,
    finished: bool,
}

impl OnDropEnd {
    fn new(source: DeltaSource, request_id: Uuid) -> Self {
        Self {
            source,
            request_id,
            finished: false,
        }
    }

    fn finish(mut self) {
        self.finished = true;
        let source = self.source.clone();
        let request_id = self.request_id;
        tokio::spawn(async move { source.end_range(request_id).await });
    }
}

impl Drop for OnDropEnd {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let source = self.source.clone();
        let request_id = self.request_id;
        tokio::spawn(async move { source.abandon_range(request_id).await });
    }
}

#[cfg(test)]
pub fn noop_source() -> DeltaSource {
    let (cmd_tx, mut cmd_rx) = mpsc::channel::<BrokerCmd>(16);
    tokio::spawn(async move { while cmd_rx.recv().await.is_some() {} });
    DeltaSource { cmd_tx }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spawn_broker_only() -> DeltaSource {
        let (cmd_tx, cmd_rx) = mpsc::channel(16);
        let (events_tx, _events_rx) = mpsc::channel(16);
        let broker = BrokerActor {
            cmd_rx,
            active: None,
            inflight: Default::default(),
            events_tx,
        };
        tokio::spawn(broker.run());
        DeltaSource { cmd_tx }
    }

    fn spawn_broker_with_events() -> (DeltaSource, mpsc::Receiver<OtaEvent>) {
        let (cmd_tx, cmd_rx) = mpsc::channel(16);
        let (events_tx, events_rx) = mpsc::channel(16);
        let broker = BrokerActor {
            cmd_rx,
            active: None,
            inflight: Default::default(),
            events_tx,
        };
        tokio::spawn(broker.run());
        (DeltaSource { cmd_tx }, events_rx)
    }

    fn range_reply(parts: Vec<RangePart>, total_size: u32) -> OtaAssetRangeReply {
        OtaAssetRangeReply {
            request_id: Uuid::nil(),
            total_size,
            parts,
        }
    }

    #[test]
    fn parses_delta_downloader_range_list() {
        assert_eq!(
            parse_range_list("0-99,200-299").unwrap(),
            vec![
                RangeSpec {
                    start: 0,
                    length: 100
                },
                RangeSpec {
                    start: 200,
                    length: 100
                },
            ]
        );
    }

    #[test]
    fn rejects_open_ended_ranges() {
        assert!(parse_range_list("100-").is_err());
        assert!(parse_range_list("-100").is_err());
    }

    #[test]
    fn response_plan_rejects_zero_length_parts() {
        let reply = range_reply(
            vec![RangePart {
                start: 10,
                length: 0,
            }],
            100,
        );

        let err = ResponsePlan::from_reply(&reply).unwrap_err();
        assert!(err.contains("zero length"), "unexpected error: {err}");
    }

    #[test]
    fn response_plan_rejects_out_of_bounds_parts() {
        let reply = range_reply(
            vec![RangePart {
                start: 90,
                length: 20,
            }],
            100,
        );

        let err = ResponsePlan::from_reply(&reply).unwrap_err();
        assert!(err.contains("outside"), "unexpected error: {err}");
    }

    #[test]
    fn companion_reply_must_match_requested_ranges() {
        let reply = range_reply(
            vec![RangePart {
                start: 200,
                length: 50,
            }],
            500,
        );
        let requested = vec![RangeSpec {
            start: 100,
            length: 50,
        }];

        let err = validate_reply_matches_request(&reply, &requested).unwrap_err();
        assert!(err.contains("did not match"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn stream_plan_rejects_empty_companion_chunks() {
        let source = noop_source();
        let request_id = Uuid::new_v4();
        let reply = range_reply(
            vec![RangePart {
                start: 0,
                length: 4,
            }],
            4,
        );
        let plan = ResponsePlan::from_reply(&reply).unwrap();
        let (chunk_tx, chunk_rx) = mpsc::channel(4);
        chunk_tx
            .send(OtaAssetRangeChunk {
                request_id,
                part_index: 0,
                offset: 0,
                bytes: Vec::new(),
                last: true,
            })
            .await
            .unwrap();

        let mut writer = tokio::io::sink();
        let err = stream_plan(
            &source,
            &mut writer,
            request_id,
            "system.img.zck",
            plan,
            chunk_rx,
        )
        .await
        .unwrap_err();
        assert!(err.contains("empty range chunk"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn stream_plan_requires_last_on_final_chunk() {
        let source = noop_source();
        let request_id = Uuid::new_v4();
        let reply = range_reply(
            vec![RangePart {
                start: 0,
                length: 4,
            }],
            4,
        );
        let plan = ResponsePlan::from_reply(&reply).unwrap();
        let (chunk_tx, chunk_rx) = mpsc::channel(4);
        chunk_tx
            .send(OtaAssetRangeChunk {
                request_id,
                part_index: 0,
                offset: 0,
                bytes: vec![1, 2, 3, 4],
                last: false,
            })
            .await
            .unwrap();

        let mut writer = tokio::io::sink();
        let err = stream_plan(
            &source,
            &mut writer,
            request_id,
            "system.img.zck",
            plan,
            chunk_rx,
        )
        .await
        .unwrap_err();
        assert!(err.contains("without last:true"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn stream_plan_times_out_when_companion_stops_sending_chunks() {
        let source = spawn_broker_only();
        let request_id = Uuid::new_v4();
        let plan = ResponsePlan::from_reply(&OtaAssetRangeReply {
            request_id,
            total_size: 4,
            parts: vec![RangePart {
                start: 0,
                length: 4,
            }],
        })
        .unwrap();
        let (_chunk_tx, chunk_rx) = mpsc::channel(1);

        let task = tokio::spawn(async move {
            let mut sink = tokio::io::sink();
            stream_plan_with_timeout(
                &source,
                &mut sink,
                request_id,
                "rootfs.zck",
                plan,
                chunk_rx,
                Duration::from_millis(10),
            )
            .await
        });
        let error = task.await.unwrap().expect_err("idle range must time out");

        assert!(error.contains("timed out"), "unexpected error: {error}");
    }

    #[tokio::test]
    async fn route_chunk_delivers_to_inflight_request() {
        let source = spawn_broker_only();
        source.activate("active".into(), None, None).await;
        let req_id = Uuid::new_v4();
        let (chunk_tx, mut chunk_rx) = mpsc::channel(4);
        source.begin_range_active(req_id, chunk_tx).await.unwrap();

        let chunk = OtaAssetRangeChunk {
            request_id: req_id,
            part_index: 0,
            offset: 0,
            bytes: vec![1, 2, 3],
            last: true,
        };
        source.route_chunk(chunk).await;
        let received = tokio::time::timeout(Duration::from_secs(1), chunk_rx.recv())
            .await
            .expect("timed out")
            .expect("channel closed");
        assert_eq!(received.bytes, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn range_requests_and_abandons_keep_the_exact_connection_route() {
        let (source, mut events_rx) = spawn_broker_with_events();
        let peer = "00:11:22:33:44:55".parse().unwrap();
        let route = "spp:active-connection".to_string();
        source
            .activate("active".into(), Some(peer), Some(route.clone()))
            .await;
        let request_id = Uuid::new_v4();
        source
            .send_asset_range(
                request_id,
                OtaAssetRange {
                    update_id: "active".into(),
                    asset: "system.img.zck".into(),
                    ranges: vec![RangeSpec {
                        start: 0,
                        length: 4,
                    }],
                },
            )
            .await;

        match events_rx.recv().await.unwrap() {
            OtaEvent::AssetRange {
                peer: event_peer,
                route: event_route,
                ..
            } => {
                assert_eq!(event_peer, Some(peer));
                assert_eq!(event_route.as_deref(), Some(route.as_str()));
            }
            event => panic!("unexpected event: {event:?}"),
        }

        source.abandon_range(request_id).await;
        match events_rx.recv().await.unwrap() {
            OtaEvent::AssetRangeAbandon {
                peer: event_peer,
                route: event_route,
                ..
            } => {
                assert_eq!(event_peer, Some(peer));
                assert_eq!(event_route.as_deref(), Some(route.as_str()));
            }
            event => panic!("unexpected event: {event:?}"),
        }
    }

    #[tokio::test]
    async fn begin_range_with_no_active_returns_no_active_ota() {
        let source = spawn_broker_only();
        let req_id = Uuid::new_v4();
        let (chunk_tx, _chunk_rx) = mpsc::channel(4);
        let err = match source.begin_range_active(req_id, chunk_tx).await {
            Ok(_) => panic!("begin_range_active should fail without an active OTA"),
            Err(err) => err,
        };
        assert!(
            matches!(err, BeginRangeError::NoActiveOta),
            "expected NoActiveOta, got {err:?}"
        );
    }

    #[tokio::test]
    async fn deactivate_clears_inflight_so_route_chunk_drops() {
        let source = spawn_broker_only();
        source.activate("active".into(), None, None).await;
        let req_id = Uuid::new_v4();
        let (chunk_tx, mut chunk_rx) = mpsc::channel(4);
        source.begin_range_active(req_id, chunk_tx).await.unwrap();

        source.deactivate().await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let chunk = OtaAssetRangeChunk {
            request_id: req_id,
            part_index: 0,
            offset: 0,
            bytes: vec![9, 8, 7],
            last: true,
        };
        source.route_chunk(chunk).await;
        tokio::time::sleep(Duration::from_millis(50)).await;

        let result = chunk_rx.try_recv();
        assert!(
            result.is_err(),
            "chunk should have been dropped after deactivate"
        );
    }
}
