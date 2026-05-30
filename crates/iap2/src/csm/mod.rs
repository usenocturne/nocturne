//! Control Session Message (CSM) codec.
//!
//! A CSM is the unit of conversation on the iAP2 control session
//! (session id 0). The wire format is a 6-byte outer header (start
//! marker `0x4040`, big-endian u16 length covering the whole CSM, and
//! a u16 message id) followed by zero or more parameter TLVs. Each
//! parameter is its own length-prefixed block keyed by a u16 param id;
//! repeated ids encode lists, empty payloads encode "presence" markers.
//!
//! [`CsmCodec`] implements `tokio_util::codec::{Decoder, Encoder}`. A
//! session task drives a `BytesMut` from inbound link DATA chunks and
//! drains complete CSMs out of it.
//!
//! Typed CSMs are flat structs annotated with `#[derive(Csm)]` (from
//! `iap2-macros`). The macro generates `From<X> for
//! CsmFrame` and `TryFrom<CsmFrame> for X`, dispatching field encoding
//! through the [`CsmParamFieldEncode`] / [`CsmParamFieldDecode`] traits
//! defined here. Field encoding is type-driven: `Bytes` rides as raw,
//! `u16` rides BE, `String` rides UTF-8 + NUL, `()` rides as a
//! presence marker, `Option<T>` is skipped when `None`, `Vec<T>`
//! repeats the same param id.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use thiserror::Error;
use tokio_util::codec::{Decoder, Encoder};

pub mod auth;
pub mod device;
pub mod external_accessory;
pub mod generated;
pub mod hid;
pub mod identification;
pub mod now_playing;
pub mod telephony;

pub use iap2_macros::Csm;

pub const CSM_START_MARKER: u16 = 0x4040;
pub const CSM_OUTER_HEADER_LEN: usize = 6;
pub const CSM_PARAM_HEADER_LEN: usize = 4;

/// A decoded CSM: the message id plus its parameter TLVs in wire order.
/// Receivers index by [`CsmParam::id`]; sender ordering is free.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsmFrame {
    pub msg_id: u16,
    pub params: Vec<CsmParam>,
}

/// One parameter inside a CSM. Payload is the raw bytes after the
/// 4-byte parameter header; per-type interpretation is the consumer's job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CsmParam {
    pub id: u16,
    pub payload: Bytes,
}

impl CsmFrame {
    pub fn empty(msg_id: u16) -> Self {
        Self {
            msg_id,
            params: Vec::new(),
        }
    }

    pub fn find(&self, param_id: u16) -> Option<&CsmParam> {
        self.params.iter().find(|p| p.id == param_id)
    }

    pub fn into_bytes(self) -> Bytes {
        let mut out = BytesMut::with_capacity(
            CSM_OUTER_HEADER_LEN
                + self
                    .params
                    .iter()
                    .map(|p| CSM_PARAM_HEADER_LEN + p.payload.len())
                    .sum::<usize>(),
        );
        encode_into(self, &mut out);
        out.freeze()
    }
}

/// Errors from decoding a CSM frame or converting one into a typed struct.
#[derive(Debug, Clone, Error, PartialEq, Eq)]
pub enum CsmDecodeError {
    #[error(
        "CSM start marker mismatch: got {got:#06x}, expected {:#06x}",
        CSM_START_MARKER
    )]
    BadStartMarker { got: u16 },
    #[error("CSM length {length} smaller than outer header ({CSM_OUTER_HEADER_LEN})")]
    LengthTooSmall { length: u16 },
    #[error("CSM length {length} overruns frame: claimed {claimed} bytes, {available} available")]
    LengthOverrun {
        length: u16,
        claimed: usize,
        available: usize,
    },
    #[error("CSM param length {length} smaller than param header ({CSM_PARAM_HEADER_LEN})")]
    ParamLengthTooSmall { length: u16 },
    #[error("CSM param at offset {offset} declares length {length} but {available} bytes remain")]
    ParamLengthOverrun {
        offset: usize,
        length: u16,
        available: usize,
    },
    #[error("CSM msg id mismatch: got {got:#06x}, expected {expected:#06x}")]
    WrongMsgId { got: u16, expected: u16 },
    #[error("CSM missing required parameter id {0:#06x}")]
    MissingParam(u16),
    #[error("CSM duplicate parameter id {0:#06x} where a single value was expected")]
    DuplicateParam(u16),
    #[error("CSM parameter id {param_id:#06x} payload had unexpected length {got} (expected {expected})")]
    ParamLength {
        param_id: u16,
        expected: usize,
        got: usize,
    },
    #[error("CSM parameter id {param_id:#06x} payload failed type-specific decode: {detail}")]
    ParamDecode { param_id: u16, detail: &'static str },
    #[error("CSM parameter id {param_id:#06x} expected NUL-terminated UTF-8 string")]
    StringNotTerminated { param_id: u16 },
    #[error("CSM parameter id {param_id:#06x} string was not valid UTF-8")]
    StringNotUtf8 { param_id: u16 },
}

impl From<CsmDecodeError> for std::io::Error {
    fn from(e: CsmDecodeError) -> Self {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    }
}

/// Streaming codec for a CSM byte stream. `decode` returns `Ok(None)`
/// until a complete frame is buffered; a malformed frame returns `Err`
/// rather than resyncing, since a corrupted CSM above the link layer is
/// a protocol violation, not noise.
pub struct CsmCodec;

impl Decoder for CsmCodec {
    type Item = CsmFrame;
    type Error = std::io::Error;

    fn decode(&mut self, src: &mut BytesMut) -> std::io::Result<Option<CsmFrame>> {
        if src.len() < CSM_OUTER_HEADER_LEN {
            return Ok(None);
        }
        let start = u16::from_be_bytes([src[0], src[1]]);
        if start != CSM_START_MARKER {
            return Err(CsmDecodeError::BadStartMarker { got: start }.into());
        }
        let length = u16::from_be_bytes([src[2], src[3]]);
        if (length as usize) < CSM_OUTER_HEADER_LEN {
            return Err(CsmDecodeError::LengthTooSmall { length }.into());
        }
        if src.len() < length as usize {
            return Ok(None);
        }
        let msg_id = u16::from_be_bytes([src[4], src[5]]);
        let mut frame_bytes = src.split_to(length as usize);
        frame_bytes.advance(CSM_OUTER_HEADER_LEN);
        let params = decode_params(frame_bytes.freeze())?;
        Ok(Some(CsmFrame { msg_id, params }))
    }
}

impl Encoder<CsmFrame> for CsmCodec {
    type Error = std::io::Error;

    fn encode(&mut self, item: CsmFrame, dst: &mut BytesMut) -> std::io::Result<()> {
        encode_into(item, dst);
        Ok(())
    }
}

fn encode_into(frame: CsmFrame, dst: &mut BytesMut) {
    let body_len: usize = frame
        .params
        .iter()
        .map(|p| CSM_PARAM_HEADER_LEN + p.payload.len())
        .sum();
    let total = CSM_OUTER_HEADER_LEN + body_len;
    dst.reserve(total);
    dst.put_u16(CSM_START_MARKER);
    dst.put_u16(total as u16);
    dst.put_u16(frame.msg_id);
    encode_params_into(frame.params, dst);
}

fn encode_params_into(params: Vec<CsmParam>, dst: &mut BytesMut) {
    for p in params {
        let plen = CSM_PARAM_HEADER_LEN + p.payload.len();
        dst.put_u16(plen as u16);
        dst.put_u16(p.id);
        dst.put_slice(&p.payload);
    }
}

/// Encode a list of parameters as a group payload: the same TLV shape
/// as the outer CSM body, minus the 6-byte outer header.
pub fn encode_param_block(params: Vec<CsmParam>) -> Bytes {
    let body_len: usize = params
        .iter()
        .map(|p| CSM_PARAM_HEADER_LEN + p.payload.len())
        .sum();
    let mut out = BytesMut::with_capacity(body_len);
    encode_params_into(params, &mut out);
    out.freeze()
}

/// Decode a group-typed param payload (CSM-format params, no outer
/// 6-byte header) back into a `Vec<CsmParam>`. Inverse of [`encode_param_block`].
pub fn decode_param_block(body: Bytes) -> Result<Vec<CsmParam>, CsmDecodeError> {
    decode_params(body)
}

fn decode_params(mut body: Bytes) -> Result<Vec<CsmParam>, CsmDecodeError> {
    let mut params = Vec::with_capacity(body.remaining() / CSM_PARAM_HEADER_LEN);
    let mut offset_in_body = 0usize;
    while body.has_remaining() {
        if body.remaining() < CSM_PARAM_HEADER_LEN {
            return Err(CsmDecodeError::ParamLengthOverrun {
                offset: offset_in_body,
                length: body.remaining() as u16,
                available: body.remaining(),
            });
        }
        let length = u16::from_be_bytes([body[0], body[1]]);
        let id = u16::from_be_bytes([body[2], body[3]]);
        if (length as usize) < CSM_PARAM_HEADER_LEN {
            return Err(CsmDecodeError::ParamLengthTooSmall { length });
        }
        if body.remaining() < length as usize {
            return Err(CsmDecodeError::ParamLengthOverrun {
                offset: offset_in_body,
                length,
                available: body.remaining(),
            });
        }
        let payload_len = length as usize - CSM_PARAM_HEADER_LEN;
        body.advance(CSM_PARAM_HEADER_LEN);
        let payload = body.split_to(payload_len);
        params.push(CsmParam { id, payload });
        offset_in_body += length as usize;
    }
    Ok(params)
}

/// Type-driven encode hook for the `Csm` derive: push 0..N param TLVs
/// for the given param id. `Bytes` pushes one, `Option<T>` 0 or 1,
/// `Vec<T>` 0..N, `()` one with empty payload (presence marker).
pub trait CsmParamFieldEncode: Sized {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>);
}

/// Type-driven decode hook for the `Csm` derive: remove 0..N params
/// matching the param id and assemble the field value.
pub trait CsmParamFieldDecode: Sized {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError>;
}

fn take_one(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Bytes, CsmDecodeError> {
    let pos = params
        .iter()
        .position(|p| p.id == param_id)
        .ok_or(CsmDecodeError::MissingParam(param_id))?;
    let CsmParam { payload, .. } = params.remove(pos);
    if params.iter().any(|p| p.id == param_id) {
        return Err(CsmDecodeError::DuplicateParam(param_id));
    }
    Ok(payload)
}

fn take_optional(
    param_id: u16,
    params: &mut Vec<CsmParam>,
) -> Result<Option<Bytes>, CsmDecodeError> {
    let pos = match params.iter().position(|p| p.id == param_id) {
        Some(p) => p,
        None => return Ok(None),
    };
    let CsmParam { payload, .. } = params.remove(pos);
    if params.iter().any(|p| p.id == param_id) {
        return Err(CsmDecodeError::DuplicateParam(param_id));
    }
    Ok(Some(payload))
}

fn drain_all(param_id: u16, params: &mut Vec<CsmParam>) -> Vec<Bytes> {
    let mut out = Vec::with_capacity(params.iter().filter(|p| p.id == param_id).count());
    let mut i = 0;
    while i < params.len() {
        if params[i].id == param_id {
            out.push(params.remove(i).payload);
        } else {
            i += 1;
        }
    }
    out
}

impl CsmParamFieldEncode for Bytes {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        out.push(CsmParam {
            id: param_id,
            payload: self,
        });
    }
}

impl CsmParamFieldDecode for Bytes {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        take_one(param_id, params)
    }
}

impl CsmParamFieldEncode for () {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        out.push(CsmParam {
            id: param_id,
            payload: Bytes::new(),
        });
    }
}

impl CsmParamFieldDecode for () {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let payload = take_one(param_id, params)?;
        if !payload.is_empty() {
            return Err(CsmDecodeError::ParamLength {
                param_id,
                expected: 0,
                got: payload.len(),
            });
        }
        Ok(())
    }
}

impl CsmParamFieldEncode for bool {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        out.push(CsmParam {
            id: param_id,
            payload: Bytes::from_static(if self { &[1] } else { &[0] }),
        });
    }
}

impl CsmParamFieldDecode for bool {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let payload = take_one(param_id, params)?;
        if payload.len() != 1 {
            return Err(CsmDecodeError::ParamLength {
                param_id,
                expected: 1,
                got: payload.len(),
            });
        }
        Ok(payload[0] != 0)
    }
}

macro_rules! csm_param_be_int {
    ($t:ty, $bytes:expr) => {
        impl CsmParamFieldEncode for $t {
            fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
                let mut b = BytesMut::with_capacity($bytes);
                b.extend_from_slice(&self.to_be_bytes());
                out.push(CsmParam {
                    id: param_id,
                    payload: b.freeze(),
                });
            }
        }

        impl CsmParamFieldDecode for $t {
            fn decode_field(
                param_id: u16,
                params: &mut Vec<CsmParam>,
            ) -> Result<Self, CsmDecodeError> {
                let payload = take_one(param_id, params)?;
                if payload.len() != $bytes {
                    return Err(CsmDecodeError::ParamLength {
                        param_id,
                        expected: $bytes,
                        got: payload.len(),
                    });
                }
                let mut buf = [0u8; $bytes];
                buf.copy_from_slice(&payload);
                Ok(<$t>::from_be_bytes(buf))
            }
        }

        impl CsmParamFieldDecode for Option<$t> {
            fn decode_field(
                param_id: u16,
                params: &mut Vec<CsmParam>,
            ) -> Result<Self, CsmDecodeError> {
                let Some(payload) = take_optional(param_id, params)? else {
                    return Ok(None);
                };
                if payload.len() != $bytes {
                    return Err(CsmDecodeError::ParamLength {
                        param_id,
                        expected: $bytes,
                        got: payload.len(),
                    });
                }
                let mut buf = [0u8; $bytes];
                buf.copy_from_slice(&payload);
                Ok(Some(<$t>::from_be_bytes(buf)))
            }
        }
    };
}

csm_param_be_int!(u8, 1);
csm_param_be_int!(i8, 1);
csm_param_be_int!(u16, 2);
csm_param_be_int!(i16, 2);
csm_param_be_int!(u32, 4);
csm_param_be_int!(i32, 4);
csm_param_be_int!(u64, 8);
csm_param_be_int!(i64, 8);

impl CsmParamFieldEncode for String {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        let mut b = BytesMut::with_capacity(self.len() + 1);
        b.extend_from_slice(self.as_bytes());
        b.put_u8(0);
        out.push(CsmParam {
            id: param_id,
            payload: b.freeze(),
        });
    }
}

impl CsmParamFieldDecode for String {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let payload = take_one(param_id, params)?;
        if payload.last() != Some(&0) {
            return Err(CsmDecodeError::StringNotTerminated { param_id });
        }
        let bytes = &payload[..payload.len() - 1];
        String::from_utf8(bytes.to_vec()).map_err(|_| CsmDecodeError::StringNotUtf8 { param_id })
    }
}

impl<T: CsmParamFieldEncode> CsmParamFieldEncode for Option<T> {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        if let Some(v) = self {
            v.encode_field(param_id, out);
        }
    }
}

impl CsmParamFieldDecode for Option<Bytes> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        take_optional(param_id, params)
    }
}

impl CsmParamFieldDecode for Option<bool> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let Some(payload) = take_optional(param_id, params)? else {
            return Ok(None);
        };
        // empty payload (presence-only) decodes true.
        if payload.is_empty() {
            Ok(Some(true))
        } else if payload.len() == 1 {
            Ok(Some(payload[0] != 0))
        } else {
            Err(CsmDecodeError::ParamLength {
                param_id,
                expected: 1,
                got: payload.len(),
            })
        }
    }
}

impl CsmParamFieldDecode for Option<()> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let Some(payload) = take_optional(param_id, params)? else {
            return Ok(None);
        };
        if !payload.is_empty() {
            return Err(CsmDecodeError::ParamLength {
                param_id,
                expected: 0,
                got: payload.len(),
            });
        }
        Ok(Some(()))
    }
}

impl CsmParamFieldDecode for Option<String> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let Some(payload) = take_optional(param_id, params)? else {
            return Ok(None);
        };
        if payload.last() != Some(&0) {
            return Err(CsmDecodeError::StringNotTerminated { param_id });
        }
        let bytes = &payload[..payload.len() - 1];
        String::from_utf8(bytes.to_vec())
            .map(Some)
            .map_err(|_| CsmDecodeError::StringNotUtf8 { param_id })
    }
}

impl CsmParamFieldEncode for Vec<Bytes> {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        for v in self {
            out.push(CsmParam {
                id: param_id,
                payload: v,
            });
        }
    }
}

impl CsmParamFieldDecode for Vec<Bytes> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        Ok(drain_all(param_id, params))
    }
}

impl CsmParamFieldEncode for Vec<String> {
    fn encode_field(self, param_id: u16, out: &mut Vec<CsmParam>) {
        for s in self {
            s.encode_field(param_id, out);
        }
    }
}

impl CsmParamFieldDecode for Vec<String> {
    fn decode_field(param_id: u16, params: &mut Vec<CsmParam>) -> Result<Self, CsmDecodeError> {
        let payloads = drain_all(param_id, params);
        let mut out = Vec::with_capacity(payloads.len());
        for payload in payloads {
            if payload.last() != Some(&0) {
                return Err(CsmDecodeError::StringNotTerminated { param_id });
            }
            let bytes = &payload[..payload.len() - 1];
            out.push(
                String::from_utf8(bytes.to_vec())
                    .map_err(|_| CsmDecodeError::StringNotUtf8 { param_id })?,
            );
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_with_one_param(msg_id: u16, param_id: u16, payload: &[u8]) -> CsmFrame {
        CsmFrame {
            msg_id,
            params: vec![CsmParam {
                id: param_id,
                payload: Bytes::copy_from_slice(payload),
            }],
        }
    }

    #[test]
    fn empty_frame_roundtrips() {
        let frame = CsmFrame::empty(0xAA00);
        let bytes = frame.clone().into_bytes();
        assert_eq!(&bytes[..], &[0x40, 0x40, 0x00, 0x06, 0xAA, 0x00]);
        let mut buf = BytesMut::from(&bytes[..]);
        let decoded = CsmCodec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(decoded, frame);
        assert!(buf.is_empty());
    }

    #[test]
    fn one_param_frame_roundtrips() {
        let frame = frame_with_one_param(0xAA01, 0, &[0xDE, 0xAD, 0xBE, 0xEF]);
        let bytes = frame.clone().into_bytes();
        let expected: &[u8] = &[
            0x40, 0x40, 0x00, 0x0E, 0xAA, 0x01, 0x00, 0x08, 0x00, 0x00, 0xDE, 0xAD, 0xBE, 0xEF,
        ];
        assert_eq!(&bytes[..], expected);
        let mut buf = BytesMut::from(&bytes[..]);
        let decoded = CsmCodec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(decoded, frame);
    }

    #[test]
    fn decoder_returns_none_when_short() {
        let mut buf = BytesMut::from(&[0x40, 0x40, 0x00][..]);
        assert!(CsmCodec.decode(&mut buf).unwrap().is_none());
        buf.extend_from_slice(&[0x06, 0xAA, 0x00]);
        let decoded = CsmCodec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(decoded.msg_id, 0xAA00);
    }

    #[test]
    fn decoder_rejects_bad_start_marker() {
        let mut buf = BytesMut::from(&[0xFF, 0xFF, 0x00, 0x06, 0xAA, 0x00][..]);
        let err = CsmCodec.decode(&mut buf).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn decoder_rejects_length_too_small() {
        let mut buf = BytesMut::from(&[0x40, 0x40, 0x00, 0x05, 0xAA, 0x00][..]);
        let err = CsmCodec.decode(&mut buf).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn decoder_handles_two_back_to_back_csms() {
        let a = CsmFrame::empty(0xAA00);
        let b = frame_with_one_param(0xAA01, 0, &[1, 2, 3]);
        let mut buf = BytesMut::new();
        buf.extend_from_slice(&a.clone().into_bytes());
        buf.extend_from_slice(&b.clone().into_bytes());
        let got_a = CsmCodec.decode(&mut buf).unwrap().unwrap();
        let got_b = CsmCodec.decode(&mut buf).unwrap().unwrap();
        assert_eq!(got_a, a);
        assert_eq!(got_b, b);
        assert!(buf.is_empty());
    }

    #[test]
    fn presence_param_encodes_with_empty_payload() {
        let mut out = Vec::new();
        ().encode_field(7, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, 7);
        assert!(out[0].payload.is_empty());

        let mut params = out;
        let _: () = <() as CsmParamFieldDecode>::decode_field(7, &mut params).unwrap();
        assert!(params.is_empty());
    }

    #[test]
    fn u16_be_param_roundtrips() {
        let mut out = Vec::new();
        0xCAFEu16.encode_field(3, &mut out);
        assert_eq!(out[0].payload, Bytes::from_static(&[0xCA, 0xFE]));
        let mut params = out;
        let v: u16 = u16::decode_field(3, &mut params).unwrap();
        assert_eq!(v, 0xCAFE);
    }

    #[test]
    fn string_param_includes_nul_terminator_and_strips_on_decode() {
        let mut out = Vec::new();
        "hi".to_string().encode_field(0, &mut out);
        assert_eq!(out[0].payload, Bytes::from_static(b"hi\0"));
        let mut params = out;
        let s: String = String::decode_field(0, &mut params).unwrap();
        assert_eq!(s, "hi");
    }

    #[test]
    fn missing_required_param_errors() {
        let mut params: Vec<CsmParam> = Vec::new();
        let err = <Bytes as CsmParamFieldDecode>::decode_field(0, &mut params).unwrap_err();
        assert!(matches!(err, CsmDecodeError::MissingParam(0)));
    }

    #[test]
    fn duplicate_param_errors_for_single_typed() {
        let mut params = vec![
            CsmParam {
                id: 0,
                payload: Bytes::from_static(&[1]),
            },
            CsmParam {
                id: 0,
                payload: Bytes::from_static(&[2]),
            },
        ];
        let err = <Bytes as CsmParamFieldDecode>::decode_field(0, &mut params).unwrap_err();
        assert!(matches!(err, CsmDecodeError::DuplicateParam(0)));
    }

    #[test]
    fn list_typed_drains_all_matching_ids() {
        let mut params = vec![
            CsmParam {
                id: 5,
                payload: Bytes::from_static(b"a\0"),
            },
            CsmParam {
                id: 5,
                payload: Bytes::from_static(b"b\0"),
            },
            CsmParam {
                id: 6,
                payload: Bytes::from_static(b"x\0"),
            },
        ];
        let v: Vec<String> = Vec::<String>::decode_field(5, &mut params).unwrap();
        assert_eq!(v, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].id, 6);
    }

    #[test]
    fn optional_string_decodes_none_when_absent() {
        let mut params: Vec<CsmParam> = Vec::new();
        let v: Option<String> = Option::<String>::decode_field(11, &mut params).unwrap();
        assert!(v.is_none());
    }
}
