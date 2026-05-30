//! Typed CSMs for the iAP2 telephony surface.
//!
//! Two paired Start/Update/Stop families plus a set of accessory-driven
//! action CSMs:
//!
//! - Call-state subscription pair (`0x4154`/`0x4156`) and the inbound
//!   `CallStateUpdate` (`0x4155`).
//! - Communications subscription pair (`0x4157`/`0x4159`) and the
//!   inbound `CommunicationsUpdate` (`0x4158`).
//! - Action CSMs: `InitiateCall` (`0x415A`), `AcceptCall` (`0x415B`),
//!   `EndCall` (`0x415C`), `SwapCalls` (`0x415D`), `MergeCalls`
//!   (`0x415E`), `HoldStatusUpdate` (`0x415F`), `MuteStatusUpdate`
//!   (`0x4160`), `SendDTMF` (`0x4161`).
//!
//! Subscribe-by-presence pattern: the accessory sends `Start*` carrying
//! one empty-payload TLV per param-id it wants the iPhone to push back.
//! Stop family ends the subscription. Inbound `*Update` CSMs are
//! delta-shaped - every field optional, iOS sends only what changed.
//!
//! Enum-valued params are decoded as `u8` here; the daemon's
//! translation layer maps them to the `libbridgething` typed enums so
//! downstream consumers don't need to keep two parallel enum
//! declarations in sync.

use bytes::Bytes;

use super::{encode_param_block, Csm, CsmFrame, CsmParam};

pub const SENT_BY_ACCESSORY: &[u16] = &[
    StartCallStateUpdates::CSM_MSG_ID,
    StopCallStateUpdates::CSM_MSG_ID,
    StartCommunicationsUpdates::CSM_MSG_ID,
    StopCommunicationsUpdates::CSM_MSG_ID,
    InitiateCall::CSM_MSG_ID,
    AcceptCall::CSM_MSG_ID,
    EndCall::CSM_MSG_ID,
    SwapCalls::CSM_MSG_ID,
    MergeCalls::CSM_MSG_ID,
    HoldStatusUpdate::CSM_MSG_ID,
    MuteStatusUpdate::CSM_MSG_ID,
    SendDtmf::CSM_MSG_ID,
];

pub const RECEIVED_BY_ACCESSORY: &[u16] = &[
    CallStateUpdate::CSM_MSG_ID,
    CommunicationsUpdate::CSM_MSG_ID,
];

/// Param IDs the accessory subscribes to inside `StartCallStateUpdates`,
/// one empty-payload TLV per id. Slot 5 is unused.
pub const CALL_STATE_SUBSCRIBE: &[u16] = &[0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12];

/// Param IDs the accessory subscribes to inside
/// `StartCommunicationsUpdates`. Slot 3 is unused.
pub const COMMUNICATIONS_SUBSCRIBE: &[u16] =
    &[0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

/// `0x4154` accessory -> device. Subscribes to one or more
/// `CallStateUpdate` params; the iPhone only pushes the listed fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartCallStateUpdates {
    pub params: Vec<u16>,
}

impl StartCallStateUpdates {
    pub const CSM_MSG_ID: u16 = 0x4154;

    pub fn standard() -> Self {
        Self {
            params: CALL_STATE_SUBSCRIBE.to_vec(),
        }
    }
}

impl From<StartCallStateUpdates> for CsmFrame {
    fn from(value: StartCallStateUpdates) -> Self {
        CsmFrame {
            msg_id: StartCallStateUpdates::CSM_MSG_ID,
            params: value
                .params
                .into_iter()
                .map(|id| CsmParam {
                    id,
                    payload: Bytes::new(),
                })
                .collect(),
        }
    }
}

/// `0x4156` accessory -> device. Tears down the call-state subscription.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4156)]
pub struct StopCallStateUpdates;

/// `0x4157` accessory -> device. Subscribes to one or more
/// `CommunicationsUpdate` params.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StartCommunicationsUpdates {
    pub params: Vec<u16>,
}

impl StartCommunicationsUpdates {
    pub const CSM_MSG_ID: u16 = 0x4157;

    pub fn standard() -> Self {
        Self {
            params: COMMUNICATIONS_SUBSCRIBE.to_vec(),
        }
    }
}

impl From<StartCommunicationsUpdates> for CsmFrame {
    fn from(value: StartCommunicationsUpdates) -> Self {
        CsmFrame {
            msg_id: StartCommunicationsUpdates::CSM_MSG_ID,
            params: value
                .params
                .into_iter()
                .map(|id| CsmParam {
                    id,
                    payload: Bytes::new(),
                })
                .collect(),
        }
    }
}

/// `0x4159` accessory -> device. Tears down the communications subscription.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4159)]
pub struct StopCommunicationsUpdates;

/// `0x4155` device -> accessory. Push of one call's current state. All
/// fields optional and delta-shaped. `status` and `direction` decode as
/// raw `u8`.
#[derive(Csm, Debug, Clone, Default, PartialEq, Eq)]
#[csm(id = 0x4155)]
pub struct CallStateUpdate {
    #[csm(param = 0)]
    pub remote_id: Option<String>,
    #[csm(param = 1)]
    pub display_name: Option<String>,
    #[csm(param = 2)]
    pub status: Option<u8>,
    #[csm(param = 3)]
    pub direction: Option<u8>,
    #[csm(param = 4)]
    pub call_uuid: Option<String>,
    #[csm(param = 6)]
    pub address_book_id: Option<String>,
    #[csm(param = 7)]
    pub label: Option<String>,
    #[csm(param = 8)]
    pub service: Option<u8>,
    #[csm(param = 9)]
    pub is_conferenced: Option<bool>,
    #[csm(param = 10)]
    pub conference_group: Option<u8>,
    #[csm(param = 11)]
    pub disconnect_reason: Option<u8>,
    #[csm(param = 12)]
    pub start_timestamp_unix_s: Option<i64>,
}

/// `0x4158` device -> accessory. Push of cellular / call-control state.
/// All fields optional and delta-shaped.
#[derive(Csm, Debug, Clone, Default, PartialEq, Eq)]
#[csm(id = 0x4158)]
pub struct CommunicationsUpdate {
    #[csm(param = 0)]
    pub signal_strength: Option<u8>,
    #[csm(param = 1)]
    pub registration_status: Option<u8>,
    #[csm(param = 2)]
    pub airplane_mode: Option<bool>,
    #[csm(param = 4)]
    pub carrier_name: Option<String>,
    #[csm(param = 5)]
    pub cellular_supported: Option<bool>,
    #[csm(param = 6)]
    pub telephony_enabled: Option<bool>,
    #[csm(param = 7)]
    pub face_time_audio_enabled: Option<bool>,
    #[csm(param = 8)]
    pub face_time_video_enabled: Option<bool>,
    #[csm(param = 9)]
    pub mute_status: Option<bool>,
    #[csm(param = 10)]
    pub current_call_count: Option<u8>,
    #[csm(param = 11)]
    pub new_voicemail_count: Option<u8>,
    #[csm(param = 12)]
    pub initiate_call_available: Option<bool>,
    #[csm(param = 13)]
    pub end_and_accept_available: Option<bool>,
    #[csm(param = 14)]
    pub hold_and_accept_available: Option<bool>,
    #[csm(param = 15)]
    pub swap_available: Option<bool>,
    #[csm(param = 16)]
    pub merge_available: Option<bool>,
    #[csm(param = 17)]
    pub hold_available: Option<bool>,
}

/// `0x415A` accessory -> device. Place an outbound call.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415A)]
pub struct InitiateCall {
    #[csm(param = 0)]
    pub kind: u8,
    #[csm(param = 1)]
    pub destination_id: Option<String>,
    #[csm(param = 2)]
    pub service: Option<u8>,
    #[csm(param = 3)]
    pub address_book_id: Option<String>,
}

/// `0x415B` accessory -> device. Accept the named call (or default to
/// the only ringing one when `call_uuid` is None). `accept_action` is
/// 0=Accept (default) / 1=EndAndAccept.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415B)]
pub struct AcceptCall {
    #[csm(param = 0)]
    pub accept_action: u8,
    #[csm(param = 1)]
    pub call_uuid: Option<String>,
}

/// `0x415C` accessory -> device. End the named call. `end_action` is
/// 0=End / 1=EndAll.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415C)]
pub struct EndCall {
    #[csm(param = 0)]
    pub end_action: u8,
    #[csm(param = 1)]
    pub call_uuid: Option<String>,
}

/// `0x415D` accessory -> device. Swap calls (call-waiting parlance).
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415D)]
pub struct SwapCalls;

/// `0x415E` accessory -> device. Merge two calls into a conference.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415E)]
pub struct MergeCalls;

/// `0x415F` accessory -> device. Place a call on/off hold.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x415F)]
pub struct HoldStatusUpdate {
    #[csm(param = 0)]
    pub hold_status: bool,
    #[csm(param = 1)]
    pub call_uuid: Option<String>,
}

/// `0x4160` accessory -> device. Push mic-mute state.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4160)]
pub struct MuteStatusUpdate {
    #[csm(param = 0)]
    pub mute_status: bool,
}

/// `0x4161` accessory -> device. Play DTMF tone on the named call.
/// `tone`: 0..9 = digit, 10=`*`, 11=`#`.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4161)]
pub struct SendDtmf {
    #[csm(param = 0)]
    pub tone: u8,
    #[csm(param = 1)]
    pub call_uuid: Option<String>,
}

/// Build a subscribe-list payload from a slice of param IDs.
#[allow(dead_code)]
fn encode_subscribe_list(ids: &[u16]) -> Bytes {
    encode_param_block(
        ids.iter()
            .map(|id| CsmParam {
                id: *id,
                payload: Bytes::new(),
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_call_state_emits_one_param_per_subscribe_id() {
        let frame: CsmFrame = StartCallStateUpdates::standard().into();
        assert_eq!(frame.msg_id, 0x4154);
        assert_eq!(frame.params.len(), CALL_STATE_SUBSCRIBE.len());
        for (decoded, expected) in frame.params.iter().zip(CALL_STATE_SUBSCRIBE.iter()) {
            assert_eq!(decoded.id, *expected);
            assert!(decoded.payload.is_empty());
        }
    }

    #[test]
    fn stop_pairs_are_empty_csms() {
        let stop_call: CsmFrame = StopCallStateUpdates.into();
        assert_eq!(stop_call.msg_id, 0x4156);
        assert!(stop_call.params.is_empty());

        let stop_comm: CsmFrame = StopCommunicationsUpdates.into();
        assert_eq!(stop_comm.msg_id, 0x4159);
        assert!(stop_comm.params.is_empty());
    }

    #[test]
    fn call_state_round_trips() {
        let original = CallStateUpdate {
            remote_id: Some("+14081234567".into()),
            display_name: Some("Test".into()),
            status: Some(2),
            direction: Some(1),
            call_uuid: Some("uuid-1".into()),
            address_book_id: None,
            label: Some("mobile".into()),
            service: Some(1),
            is_conferenced: Some(false),
            conference_group: None,
            disconnect_reason: None,
            start_timestamp_unix_s: Some(1_777_777_777),
        };
        let frame: CsmFrame = original.clone().into();
        let decoded: CallStateUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn accept_call_round_trips() {
        let accept = AcceptCall {
            accept_action: 0,
            call_uuid: Some("u".into()),
        };
        let frame: CsmFrame = accept.clone().into();
        assert_eq!(frame.msg_id, 0x415B);
        let decoded: AcceptCall = frame.try_into().unwrap();
        assert_eq!(decoded, accept);
    }

    #[test]
    fn end_call_round_trips() {
        let end = EndCall {
            end_action: 1,
            call_uuid: None,
        };
        let frame: CsmFrame = end.clone().into();
        assert_eq!(frame.msg_id, 0x415C);
        let decoded: EndCall = frame.try_into().unwrap();
        assert_eq!(decoded, end);
    }

    #[test]
    fn dtmf_round_trips() {
        let dtmf = SendDtmf {
            tone: 10,
            call_uuid: Some("u".into()),
        };
        let frame: CsmFrame = dtmf.clone().into();
        let decoded: SendDtmf = frame.try_into().unwrap();
        assert_eq!(decoded, dtmf);
    }

    #[test]
    fn communications_round_trips_with_partial_set() {
        let original = CommunicationsUpdate {
            signal_strength: Some(4),
            airplane_mode: Some(false),
            cellular_supported: Some(true),
            initiate_call_available: Some(true),
            ..Default::default()
        };
        let frame: CsmFrame = original.clone().into();
        let decoded: CommunicationsUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }
}
