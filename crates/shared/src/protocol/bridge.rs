use std::io::Read;

use flate2::read::GzDecoder;
use tokio_util::{
    bytes::{Buf, BufMut, Bytes, BytesMut},
    codec::{Decoder, Encoder},
};

use super::{
    EndecError, EndecState, TypedDecodeError, COMPRESSION_NONE, ENCODING_MSGPACK, HEADER_LEN,
    MAGIC, VERSION,
};
use crate::{
    gateway::{GatewayToNocturneMsg, NocturneToGatewayMsg},
    protocol::{
        mbps, try_probe_envelope_json, try_probe_envelope_msgpack, Compression, Encoding,
        PrioritizedFrame,
    },
    Priority,
};

// Headroom above the companions' 2 MB chunk-envelope limit, bounded for device memory.
pub const MAX_FRAME_PAYLOAD_LEN: usize = 16 * 1024 * 1024;

pub fn parse_nocturne_frame(
    src: &mut Bytes,
) -> Result<Option<PrioritizedFrame<GatewayToNocturneMsg>>, EndecError> {
    if src.len() < HEADER_LEN {
        return Ok(None);
    }

    let header = &src[..HEADER_LEN];
    let magic = u16::from_be_bytes([header[0], header[1]]);
    if magic != MAGIC {
        src.clear();
        return Err(EndecError::InvalidMagic);
    }
    let version = header[2];
    if version != VERSION {
        src.clear();
        return Err(EndecError::UnsupportedVersion(version));
    }
    let compression: Compression = header[3].into();
    let encoding: Encoding = header[4].into();
    let priority = Priority::from_byte(header[5]);
    let total_length = frame_length(u64::from_be_bytes(
        header[8..16].try_into().expect("16-byte slice"),
    ))?;
    let length = total_length - HEADER_LEN;

    if src.len() < total_length {
        return Ok(None);
    }

    src.advance(HEADER_LEN);
    let body = src.split_to(length);

    let decompressed;
    let payload: &[u8] = if compression == Compression::Gzip {
        decompressed = decompress_payload(&body)?;
        &decompressed
    } else {
        &body
    };

    let msg: GatewayToNocturneMsg = match encoding {
        Encoding::Msgpack => match rmp_serde::from_slice(payload) {
            Ok(m) => m,
            Err(err) => {
                return Err(EndecError::TypedDecode {
                    error: TypedDecodeError::Rmp(err),
                    probe: Box::new(try_probe_envelope_msgpack(payload)),
                });
            }
        },
        Encoding::Json => match serde_json::from_slice(payload) {
            Ok(m) => m,
            Err(err) => {
                return Err(EndecError::TypedDecode {
                    error: TypedDecodeError::Json(err),
                    probe: Box::new(try_probe_envelope_json(payload)),
                });
            }
        },
    };

    Ok(Some(PrioritizedFrame { priority, msg }))
}

fn frame_length(payload_length: u64) -> Result<usize, EndecError> {
    if payload_length > MAX_FRAME_PAYLOAD_LEN as u64 {
        return Err(payload_too_large());
    }
    usize::try_from(payload_length)
        .ok()
        .and_then(|length| HEADER_LEN.checked_add(length))
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "frame length overflows usize",
            )
            .into()
        })
}

fn payload_too_large() -> EndecError {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        "frame payload exceeds 16 MiB",
    )
    .into()
}

fn decompress_payload(body: &[u8]) -> Result<Vec<u8>, EndecError> {
    let mut decompressed = Vec::new();
    GzDecoder::new(body)
        .take(MAX_FRAME_PAYLOAD_LEN as u64 + 1)
        .read_to_end(&mut decompressed)?;
    if decompressed.len() > MAX_FRAME_PAYLOAD_LEN {
        return Err(payload_too_large());
    }
    Ok(decompressed)
}

#[derive(Debug, Default)]
pub struct NocturneEndec {
    state: Option<EndecState>,
}

impl Decoder for NocturneEndec {
    type Item = PrioritizedFrame<GatewayToNocturneMsg>;
    type Error = EndecError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Self::Item>, Self::Error> {
        if src.is_empty() {
            return Ok(None);
        }

        let state = self.state.get_or_insert_default();

        if state.packet == 0 {
            if src.len() < HEADER_LEN {
                tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "not enough bytes for header (need {}, have {})", HEADER_LEN, src.len());
                return Ok(None);
            }

            let magic = u16::from_be_bytes([src[0], src[1]]);
            if magic != MAGIC {
                tracing::error!(target: "libnocturne::protocol::bridge::decoder", "invalid magic: {:#x}", magic);
                src.clear();
                return Err(EndecError::InvalidMagic);
            }

            state.version = src[2];
            if state.version != VERSION {
                tracing::error!(target: "libnocturne::protocol::bridge::decoder", "unsupported version: {}", state.version);
                src.clear();
                return Err(EndecError::UnsupportedVersion(state.version));
            }

            state.compression = src[3].into();
            state.encoding = src[4].into();
            state.priority = Priority::from_byte(src[5]);
            state.length = u64::from_be_bytes(src[8..16].try_into().unwrap());
            state.total_length = frame_length(state.length)?;
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "message length {}, compression {:?}, encoding {:?}, priority {:?}", state.length, state.compression, state.encoding, state.priority);
        }

        if src.len() < state.total_length {
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "message not complete ({}/{} bytes)", src.len(), state.total_length);
            state.packet += 1;
            return Ok(None);
        }

        src.advance(HEADER_LEN);
        let body = src.split_to(state.length as usize);

        let decompressed;
        let payload: &[u8] = if state.compression == Compression::Gzip {
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "decompressing gzip data");
            decompressed = decompress_payload(&body)?;
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "decompressed {} bytes", decompressed.len());
            &decompressed
        } else {
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "using uncompressed data");
            &body
        };

        tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "deserializing message with {} bytes", payload.len());

        if state.packet != 0 {
            let elapsed_time = state.message_start.elapsed();
            tracing::debug!(target: "libnocturne::protocol::bridge::decoder", "network bytes: {}, total bytes: {}, elapsed {:?}", state.length, payload.len(), elapsed_time);
            tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "transfer rate: {:.2}mbps, effective rate: {:.2}mbps", mbps(elapsed_time, state.total_length as f64), mbps(elapsed_time, (HEADER_LEN + payload.len()) as f64));
        }

        let priority = state.priority;
        let encoding = state.encoding;
        self.state = None;

        let msg: GatewayToNocturneMsg = match encoding {
            Encoding::Msgpack => match rmp_serde::from_slice(payload) {
                Ok(m) => m,
                Err(err) => {
                    return Err(EndecError::TypedDecode {
                        error: TypedDecodeError::Rmp(err),
                        probe: Box::new(try_probe_envelope_msgpack(payload)),
                    });
                }
            },
            Encoding::Json => match serde_json::from_slice(payload) {
                Ok(m) => m,
                Err(err) => {
                    return Err(EndecError::TypedDecode {
                        error: TypedDecodeError::Json(err),
                        probe: Box::new(try_probe_envelope_json(payload)),
                    });
                }
            },
        };
        tracing::trace!(target: "libnocturne::protocol::bridge::decoder", "successfully decoded message");

        Ok(Some(PrioritizedFrame { priority, msg }))
    }
}

impl Encoder<NocturneToGatewayMsg> for NocturneEndec {
    type Error = EndecError;

    fn encode(
        &mut self,
        item: NocturneToGatewayMsg,
        dst: &mut BytesMut,
    ) -> Result<(), Self::Error> {
        encode_nocturne_frame(Priority::Normal, &item, dst)
    }
}

impl Encoder<PrioritizedFrame<NocturneToGatewayMsg>> for NocturneEndec {
    type Error = EndecError;

    fn encode(
        &mut self,
        item: PrioritizedFrame<NocturneToGatewayMsg>,
        dst: &mut BytesMut,
    ) -> Result<(), Self::Error> {
        encode_nocturne_frame(item.priority, &item.msg, dst)
    }
}

pub fn encode_nocturne_frame(
    priority: Priority,
    msg: &NocturneToGatewayMsg,
    dst: &mut BytesMut,
) -> Result<(), EndecError> {
    tracing::trace!(target: "libnocturne::protocol::bridge::encode", "serializing message");
    let packed = rmp_serde::to_vec_named(msg).map_err(EndecError::RmpSerialization)?;
    let len = packed.len() as u64;
    frame_length(len)?;
    tracing::trace!(target: "libnocturne::protocol::bridge::encode", "serialized to {len} bytes, priority {priority:?}");

    dst.put_u16(MAGIC);
    dst.put_u8(VERSION);
    dst.put_u8(COMPRESSION_NONE);
    dst.put_u8(ENCODING_MSGPACK);
    dst.put_u8(priority.as_byte());
    dst.put_bytes(0, 2);
    dst.put_u64(len);

    dst.extend_from_slice(&packed);
    Ok(())
}
