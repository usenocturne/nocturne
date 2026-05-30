use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, HeaderValue, Response, StatusCode},
    routing::get,
    Router,
};
use libnocturne::{
    gateway::{OtaAssetRange, OtaAssetRangeChunk, OtaAssetRangeReply},
    RangePart, RangeSpec,
};
use tokio::{net::TcpListener, sync::mpsc, task::JoinHandle};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{BeginRangeError, RangeProxy};

const MULTIPART_BOUNDARY: &str = "nocturne-ota-range-boundary";

#[derive(Clone)]
struct AxumState {
    proxy: RangeProxy,
}

pub(super) async fn spawn(
    proxy: RangeProxy,
    port: u16,
    cancel: CancellationToken,
) -> std::io::Result<JoinHandle<()>> {
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await?;
    tracing::info!("ota range proxy listening on 127.0.0.1:{port}");

    let app = Router::new()
        .route("/{asset}", get(handle_range))
        .with_state(AxumState { proxy });

    let handle = tokio::spawn(async move {
        tokio::select! {
            res = axum::serve(listener, app) => {
                if let Err(err) = res {
                    tracing::error!("FATAL: ota range proxy server stopped: {err:?}");
                } else {
                    tracing::warn!("ota range proxy server exited cleanly");
                }
            }
            _ = cancel.cancelled() => {
                tracing::debug!("ota range proxy server shutting down");
            }
        }
    });
    Ok(handle)
}

async fn handle_range(
    State(state): State<AxumState>,
    Path(asset): Path<String>,
    headers: HeaderMap,
) -> Response<Body> {
    let range_header = match headers.get(header::RANGE).and_then(|v| v.to_str().ok()) {
        Some(v) => v,
        None => {
            return error_response(
                StatusCode::RANGE_NOT_SATISFIABLE,
                "Range header is required for OTA delta fetch",
            );
        }
    };
    let ranges = match parse_range_header(range_header) {
        Ok(r) => r,
        Err(reason) => return error_response(StatusCode::RANGE_NOT_SATISFIABLE, reason),
    };
    if ranges.is_empty() {
        return error_response(
            StatusCode::RANGE_NOT_SATISFIABLE,
            "Range header parsed to 0 ranges",
        );
    }

    tracing::debug!(%asset, range_count = ranges.len(), "handling OTA range request");

    let request_id = Uuid::new_v4();
    let (chunk_tx, chunk_rx) = mpsc::channel::<OtaAssetRangeChunk>(super::CHUNK_QUEUE);
    let begin = match state.proxy.begin_range_active(request_id, chunk_tx).await {
        Ok(begin) => begin,
        Err(BeginRangeError::NoActiveOta) => {
            return error_response(StatusCode::CONFLICT, "no OTA in flight");
        }
        Err(BeginRangeError::ProxyDown) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, "range proxy unavailable");
        }
    };

    let requested_ranges = ranges;
    let reply = request_range(
        &state.proxy,
        request_id,
        asset.clone(),
        begin.update_id.clone(),
        requested_ranges,
    )
    .await;

    build_response(state.proxy, request_id, reply, chunk_rx)
}

async fn request_range(
    proxy: &RangeProxy,
    request_id: Uuid,
    asset: String,
    update_id: String,
    ranges: Vec<RangeSpec>,
) -> OtaAssetRangeReply {
    let req = OtaAssetRange {
        update_id,
        asset,
        ranges: ranges.clone(),
    };
    proxy.send_asset_range(request_id, req).await;
    let total_size = ranges.iter().map(|r| r.start + r.length).max().unwrap_or(0);
    let parts = ranges
        .iter()
        .map(|r| RangePart {
            start: r.start,
            length: r.length,
        })
        .collect();
    OtaAssetRangeReply { total_size, parts }
}

fn build_response(
    proxy: RangeProxy,
    request_id: Uuid,
    reply: OtaAssetRangeReply,
    chunk_rx: mpsc::Receiver<OtaAssetRangeChunk>,
) -> Response<Body> {
    let total = reply.total_size;
    let parts = reply.parts;
    if parts.is_empty() {
        let proxy = proxy.clone();
        tokio::spawn(async move { proxy.end_range(request_id).await });
        return error_response(StatusCode::BAD_GATEWAY, "companion returned 0 parts");
    }

    if parts.len() == 1 {
        let p = parts[0];
        let (start, end_inclusive) = (p.start, p.start + p.length - 1);
        let stream = body_stream_single_part(p, chunk_rx, proxy, request_id);
        let body = Body::from_stream(stream);
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, "application/octet-stream")
            .header(header::CONTENT_LENGTH, p.length.to_string())
            .header(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{end_inclusive}/{total}")).unwrap(),
            )
            .body(body)
            .unwrap()
    } else {
        let stream = body_stream_multipart(parts.clone(), total, chunk_rx, proxy, request_id);
        let body = Body::from_stream(stream);
        Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(
                header::CONTENT_TYPE,
                HeaderValue::from_str(&format!(
                    "multipart/byteranges; boundary={MULTIPART_BOUNDARY}"
                ))
                .unwrap(),
            )
            .body(body)
            .unwrap()
    }
}

fn parse_range_header(header_value: &str) -> Result<Vec<RangeSpec>, &'static str> {
    let trimmed = header_value.trim();
    let payload = trimmed
        .strip_prefix("bytes=")
        .ok_or("Range must start with bytes=")?;
    let mut out = Vec::new();
    for piece in payload.split(',') {
        let piece = piece.trim();
        let (start, end) = piece.split_once('-').ok_or("range piece missing '-'")?;
        let start = start.trim();
        let end = end.trim();
        if start.is_empty() || end.is_empty() {
            return Err("only fully-bounded ranges 'a-b' are supported");
        }
        let start: u32 = start.parse().map_err(|_| "range start parse failed")?;
        let end: u32 = end.parse().map_err(|_| "range end parse failed")?;
        if end < start {
            return Err("range end < start");
        }
        let length = end
            .checked_sub(start)
            .and_then(|d| d.checked_add(1))
            .ok_or("range length overflow")?;
        out.push(RangeSpec { start, length });
    }
    Ok(out)
}

fn body_stream_single_part(
    part: RangePart,
    chunk_rx: mpsc::Receiver<OtaAssetRangeChunk>,
    proxy: RangeProxy,
    request_id: Uuid,
) -> impl futures::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    let total = part.length as u64;
    let cleanup = OnDropEnd::new(proxy, request_id);
    async_stream::try_stream! {
        let mut produced: u64 = 0;
        let mut rx = chunk_rx;
        while produced < total {
            let chunk = match rx.recv().await {
                Some(c) => c,
                None => {
                    Err(io_err("companion chunk channel closed mid-stream"))?;
                    unreachable!();
                }
            };
            let bytes = bytes::Bytes::from(chunk.bytes);
            produced += bytes.len() as u64;
            if produced > total {
                Err(io_err("companion sent more bytes than the part declared"))?;
                unreachable!();
            }
            yield bytes;
            if chunk.last {
                break;
            }
        }
        if produced != total {
            Err(io_err("companion stream ended before declared length"))?;
        }
        cleanup.finish();
    }
}

fn body_stream_multipart(
    parts: Vec<RangePart>,
    total_size: u32,
    chunk_rx: mpsc::Receiver<OtaAssetRangeChunk>,
    proxy: RangeProxy,
    request_id: Uuid,
) -> impl futures::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send + 'static {
    let cleanup = OnDropEnd::new(proxy, request_id);
    async_stream::try_stream! {
        let mut rx = chunk_rx;
        for (idx, part) in parts.iter().enumerate() {
            let header = format!(
                "\r\n--{boundary}\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes {start}-{end}/{total}\r\n\r\n",
                boundary = MULTIPART_BOUNDARY,
                start = part.start,
                end = part.start + part.length - 1,
                total = total_size,
            );
            yield bytes::Bytes::from(header);

            let part_total = part.length as u64;
            let mut produced: u64 = 0;
            while produced < part_total {
                let chunk = match rx.recv().await {
                    Some(c) => c,
                    None => {
                        Err(io_err("companion chunk channel closed mid-stream"))?;
                        unreachable!();
                    }
                };
                if chunk.part_index as usize != idx {
                    Err(io_err("companion chunk part_index out of order"))?;
                    unreachable!();
                }
                let bytes = bytes::Bytes::from(chunk.bytes);
                produced += bytes.len() as u64;
                if produced > part_total {
                    Err(io_err("companion sent more bytes than the part declared"))?;
                    unreachable!();
                }
                yield bytes;
                if chunk.last && idx + 1 < parts.len() {
                    Err(io_err("companion set last:true mid-multipart"))?;
                    unreachable!();
                }
            }
            if produced != part_total {
                Err(io_err("companion stream ended before declared part length"))?;
            }
        }
        yield bytes::Bytes::from(format!("\r\n--{MULTIPART_BOUNDARY}--\r\n"));
        cleanup.finish();
    }
}

struct OnDropEnd {
    proxy: RangeProxy,
    request_id: Uuid,
    finished: bool,
}

impl OnDropEnd {
    fn new(proxy: RangeProxy, request_id: Uuid) -> Self {
        Self {
            proxy,
            request_id,
            finished: false,
        }
    }

    fn finish(mut self) {
        self.finished = true;
        let proxy = self.proxy.clone();
        let request_id = self.request_id;
        tokio::spawn(async move { proxy.end_range(request_id).await });
    }
}

impl Drop for OnDropEnd {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        let proxy = self.proxy.clone();
        let request_id = self.request_id;
        tokio::spawn(async move { proxy.abandon_range(request_id).await });
    }
}

fn io_err(msg: &'static str) -> std::io::Error {
    std::io::Error::other(msg)
}

fn error_response(status: StatusCode, body: impl Into<String>) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(body.into()))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_range() {
        let r = parse_range_header("bytes=0-99").unwrap();
        assert_eq!(
            r,
            vec![RangeSpec {
                start: 0,
                length: 100
            }]
        );
    }

    #[test]
    fn parses_multi_range() {
        let r = parse_range_header("bytes=0-99,200-299").unwrap();
        assert_eq!(
            r,
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
        assert!(parse_range_header("bytes=0-").is_err());
        assert!(parse_range_header("bytes=-100").is_err());
    }

    #[test]
    fn rejects_inverted_range() {
        assert!(parse_range_header("bytes=10-5").is_err());
    }

    #[test]
    fn rejects_missing_prefix() {
        assert!(parse_range_header("0-99").is_err());
    }

    #[tokio::test]
    async fn range_header_missing_returns_416() {
        use super::super::noop_proxy;
        let state = State(AxumState {
            proxy: noop_proxy(),
        });
        let path = Path("firmware.swu".to_string());
        let headers = HeaderMap::new(); // no Range header
        let response = handle_range(state, path, headers).await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }
}
