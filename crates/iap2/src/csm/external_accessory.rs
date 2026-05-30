//! Typed CSMs for the iAP2 External Accessory bring-up surface.
//!
//! Four messages live here:
//!
//! - [`StartExternalAccessoryProtocolSession`] (`0xEA00`) - iPhone to
//!   accessory. iOS opens an EA session for a protocol string the
//!   accessory declared in `IdentificationInformation` param 10 (one
//!   `EaProtocol` entry). Carries the matching `protocol_id` plus the
//!   iOS-allocated `session_id` (the EA stream id, opaque u16).
//! - [`StopExternalAccessoryProtocolSession`] (`0xEA01`) - iPhone to
//!   accessory. Tears down a previously-opened stream. Reused
//!   `session_id` values are allowed afterwards.
//! - [`RequestAppLaunch`] (`0xEA02`) - accessory to iPhone. Asks iOS
//!   to foreground the app with the given bundle id. The call is
//!   silently ignored if the app isn't installed or doesn't list the
//!   matching EA protocol in `UISupportedExternalAccessoryProtocols`.
//!   The [`AppLaunchMethod`] param is the only iAP2-side knob that
//!   controls whether iOS shows the per-app "would like to communicate
//!   with" permission prompt; we always send `WithoutUserAlert` so iOS
//!   wakes the companion silently (background-mode if the device is
//!   locked or another app is foreground).
//! - [`StatusExternalAccessoryProtocolSession`] (`0xEA03`) - accessory
//!   to iPhone. Reply to `StartES`. `Ok` (`0`) opens the stream;
//!   `Close` (`1`) refuses (unknown `protocol_id`, capacity exhausted,
//!   etc.).
//!
//! Stream payloads themselves do not ride on the control session;
//! they ride on iAP2 link session id 3 (declared as
//! `SessionType::ExternalAccessory` in `Lsp::accessory_default`) with
//! a u16 BE EA-stream-id prefix per chunk. The session id picked here
//! is what tags those chunks.

use bytes::Bytes;

use super::{Csm, CsmDecodeError, CsmFrame, CsmParam, CsmParamFieldDecode, CsmParamFieldEncode};

pub const SENT_BY_ACCESSORY: &[u16] = &[
    RequestAppLaunch::CSM_MSG_ID,
    StatusExternalAccessoryProtocolSession::CSM_MSG_ID,
];

pub const RECEIVED_BY_ACCESSORY: &[u16] = &[
    StartExternalAccessoryProtocolSession::CSM_MSG_ID,
    StopExternalAccessoryProtocolSession::CSM_MSG_ID,
];

/// `0xEA00` iPhone -> accessory. `protocol_id` matches an `EaProtocol::id`
/// declared in `IdentificationInformation` param 10; `session_id` is
/// iOS's opaque stream key, unique within an iAP2 link.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0xEA00)]
pub struct StartExternalAccessoryProtocolSession {
    #[csm(param = 0)]
    pub protocol_id: u8,
    #[csm(param = 1)]
    pub session_id: u16,
}

/// `0xEA01` iPhone -> accessory. Tears down a stream previously
/// opened by `StartExternalAccessoryProtocolSession`.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0xEA01)]
pub struct StopExternalAccessoryProtocolSession {
    #[csm(param = 0)]
    pub session_id: u16,
}

/// `AppLaunchMethod` enum (param 1 of `RequestAppLaunch`). Selects
/// whether iOS shows the per-app permission prompt or launches silently.
/// Defaults to [`WithUserAlert`] when the param is absent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AppLaunchMethod {
    WithUserAlert = 0,
    WithoutUserAlert = 1,
}

impl AppLaunchMethod {
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    pub const fn from_u8(byte: u8) -> Option<Self> {
        match byte {
            0 => Some(Self::WithUserAlert),
            1 => Some(Self::WithoutUserAlert),
            _ => None,
        }
    }
}

/// `0xEA02` accessory -> iPhone. `bundle_id` is a UTF-8 + NUL string
/// matching the iOS app's `CFBundleIdentifier`. `launch_method` gates
/// the per-app permission prompt; pass
/// [`AppLaunchMethod::WithoutUserAlert`] to suppress it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestAppLaunch {
    pub bundle_id: String,
    pub launch_method: AppLaunchMethod,
}

impl RequestAppLaunch {
    pub const CSM_MSG_ID: u16 = 0xEA02;
}

impl From<RequestAppLaunch> for CsmFrame {
    fn from(value: RequestAppLaunch) -> Self {
        let mut params: Vec<CsmParam> = Vec::with_capacity(2);
        value.bundle_id.encode_field(0, &mut params);
        value.launch_method.as_u8().encode_field(1, &mut params);
        Self {
            msg_id: RequestAppLaunch::CSM_MSG_ID,
            params,
        }
    }
}

impl TryFrom<CsmFrame> for RequestAppLaunch {
    type Error = CsmDecodeError;

    fn try_from(mut frame: CsmFrame) -> Result<Self, Self::Error> {
        if frame.msg_id != Self::CSM_MSG_ID {
            return Err(CsmDecodeError::WrongMsgId {
                got: frame.msg_id,
                expected: Self::CSM_MSG_ID,
            });
        }
        let bundle_id = String::decode_field(0, &mut frame.params)?;
        let method_byte = u8::decode_field(1, &mut frame.params)?;
        let launch_method =
            AppLaunchMethod::from_u8(method_byte).ok_or(CsmDecodeError::ParamDecode {
                param_id: 1,
                detail: "AppLaunchMethod must be 0 (WithUserAlert) or 1 (WithoutUserAlert)",
            })?;
        Ok(Self {
            bundle_id,
            launch_method,
        })
    }
}

/// Status field of [`StatusExternalAccessoryProtocolSession`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EaSessionStatus {
    Ok = 0,
    Close = 1,
}

impl EaSessionStatus {
    pub const fn as_u8(self) -> u8 {
        self as u8
    }

    pub const fn from_u8(byte: u8) -> Option<Self> {
        match byte {
            0 => Some(Self::Ok),
            1 => Some(Self::Close),
            _ => None,
        }
    }
}

/// `0xEA03` accessory -> iPhone. Reply to
/// `StartExternalAccessoryProtocolSession` with the same `session_id`
/// the iPhone used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusExternalAccessoryProtocolSession {
    pub session_id: u16,
    pub status: EaSessionStatus,
}

impl StatusExternalAccessoryProtocolSession {
    pub const CSM_MSG_ID: u16 = 0xEA03;
}

impl From<StatusExternalAccessoryProtocolSession> for CsmFrame {
    fn from(value: StatusExternalAccessoryProtocolSession) -> Self {
        Self {
            msg_id: StatusExternalAccessoryProtocolSession::CSM_MSG_ID,
            params: vec![
                CsmParam {
                    id: 0,
                    payload: Bytes::copy_from_slice(&value.session_id.to_be_bytes()),
                },
                CsmParam {
                    id: 1,
                    payload: Bytes::copy_from_slice(&[value.status.as_u8()]),
                },
            ],
        }
    }
}

impl TryFrom<CsmFrame> for StatusExternalAccessoryProtocolSession {
    type Error = CsmDecodeError;

    fn try_from(frame: CsmFrame) -> Result<Self, Self::Error> {
        if frame.msg_id != Self::CSM_MSG_ID {
            return Err(CsmDecodeError::WrongMsgId {
                got: frame.msg_id,
                expected: Self::CSM_MSG_ID,
            });
        }
        let session = frame.find(0).ok_or(CsmDecodeError::MissingParam(0))?;
        if session.payload.len() != 2 {
            return Err(CsmDecodeError::ParamLength {
                param_id: 0,
                expected: 2,
                got: session.payload.len(),
            });
        }
        let session_id = u16::from_be_bytes([session.payload[0], session.payload[1]]);
        let status = frame.find(1).ok_or(CsmDecodeError::MissingParam(1))?;
        if status.payload.len() != 1 {
            return Err(CsmDecodeError::ParamLength {
                param_id: 1,
                expected: 1,
                got: status.payload.len(),
            });
        }
        let status =
            EaSessionStatus::from_u8(status.payload[0]).ok_or(CsmDecodeError::ParamDecode {
                param_id: 1,
                detail: "EA session status must be 0 (Ok) or 1 (Close)",
            })?;
        Ok(Self { session_id, status })
    }
}

#[cfg(test)]
mod tests {
    use bytes::BytesMut;
    use tokio_util::codec::{Decoder, Encoder};

    use super::*;
    use crate::csm::CsmCodec;

    #[test]
    fn start_es_round_trips() {
        let csm = StartExternalAccessoryProtocolSession {
            protocol_id: 1,
            session_id: 0x0100,
        };
        let frame: CsmFrame = csm.clone().into();
        assert_eq!(frame.msg_id, 0xEA00);
        assert_eq!(frame.params.len(), 2);
        assert_eq!(frame.params[0].id, 0);
        assert_eq!(&frame.params[0].payload[..], &[0x01]);
        assert_eq!(frame.params[1].id, 1);
        assert_eq!(&frame.params[1].payload[..], &[0x01, 0x00]);
        let back: StartExternalAccessoryProtocolSession = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn stop_es_round_trips() {
        let csm = StopExternalAccessoryProtocolSession { session_id: 0x0100 };
        let frame: CsmFrame = csm.clone().into();
        assert_eq!(frame.msg_id, 0xEA01);
        assert_eq!(frame.params.len(), 1);
        assert_eq!(&frame.params[0].payload[..], &[0x01, 0x00]);
        let back: StopExternalAccessoryProtocolSession = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn request_app_launch_round_trips() {
        let csm = RequestAppLaunch {
            bundle_id: "com.iap2-rs.gateway".into(),
            launch_method: AppLaunchMethod::WithoutUserAlert,
        };
        let frame: CsmFrame = csm.clone().into();
        assert_eq!(frame.msg_id, 0xEA02);
        assert_eq!(frame.params.len(), 2);
        assert_eq!(frame.params[0].id, 0);
        assert_eq!(
            frame.params[0].payload.last(),
            Some(&0u8),
            "bundle id is NUL-terminated"
        );
        assert_eq!(frame.params[1].id, 1);
        assert_eq!(&frame.params[1].payload[..], &[0x01]);
        let back: RequestAppLaunch = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn request_app_launch_with_user_alert_round_trips() {
        let csm = RequestAppLaunch {
            bundle_id: "com.example.app".into(),
            launch_method: AppLaunchMethod::WithUserAlert,
        };
        let frame: CsmFrame = csm.clone().into();
        assert_eq!(&frame.params[1].payload[..], &[0x00]);
        let back: RequestAppLaunch = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn request_app_launch_rejects_unknown_method_byte() {
        let frame = CsmFrame {
            msg_id: 0xEA02,
            params: vec![
                CsmParam {
                    id: 0,
                    payload: Bytes::copy_from_slice(b"com.example.app\0"),
                },
                CsmParam {
                    id: 1,
                    payload: Bytes::copy_from_slice(&[0x05]),
                },
            ],
        };
        let err = RequestAppLaunch::try_from(frame).unwrap_err();
        assert!(matches!(
            err,
            CsmDecodeError::ParamDecode { param_id: 1, .. }
        ));
    }

    #[test]
    fn status_es_round_trips_ok() {
        let csm = StatusExternalAccessoryProtocolSession {
            session_id: 0x0100,
            status: EaSessionStatus::Ok,
        };
        let frame: CsmFrame = csm.clone().into();
        assert_eq!(frame.msg_id, 0xEA03);
        let back: StatusExternalAccessoryProtocolSession = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn status_es_round_trips_close() {
        let csm = StatusExternalAccessoryProtocolSession {
            session_id: 0xFEED,
            status: EaSessionStatus::Close,
        };
        let frame: CsmFrame = csm.clone().into();
        let back: StatusExternalAccessoryProtocolSession = frame.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn status_es_rejects_unknown_status_byte() {
        let frame = CsmFrame {
            msg_id: 0xEA03,
            params: vec![
                CsmParam {
                    id: 0,
                    payload: Bytes::copy_from_slice(&[0x01, 0x00]),
                },
                CsmParam {
                    id: 1,
                    payload: Bytes::copy_from_slice(&[0x05]),
                },
            ],
        };
        let err = StatusExternalAccessoryProtocolSession::try_from(frame).unwrap_err();
        assert!(matches!(
            err,
            CsmDecodeError::ParamDecode { param_id: 1, .. }
        ));
    }

    #[test]
    fn ea_csm_round_trips_through_codec() {
        let csm = StartExternalAccessoryProtocolSession {
            protocol_id: 7,
            session_id: 0xABCD,
        };
        let mut buf = BytesMut::new();
        let frame: CsmFrame = csm.clone().into();
        CsmCodec.encode(frame, &mut buf).unwrap();
        let decoded = CsmCodec.decode(&mut buf).unwrap().unwrap();
        let back: StartExternalAccessoryProtocolSession = decoded.try_into().unwrap();
        assert_eq!(back, csm);
    }

    #[test]
    fn supported_messages_lists_match_msg_ids() {
        assert_eq!(
            SENT_BY_ACCESSORY,
            &[
                RequestAppLaunch::CSM_MSG_ID,
                StatusExternalAccessoryProtocolSession::CSM_MSG_ID,
            ]
        );
        assert_eq!(
            RECEIVED_BY_ACCESSORY,
            &[
                StartExternalAccessoryProtocolSession::CSM_MSG_ID,
                StopExternalAccessoryProtocolSession::CSM_MSG_ID,
            ]
        );
    }
}
