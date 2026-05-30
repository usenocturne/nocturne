//! Typed CSMs for the iAP2 identification handshake.
//!
//! After authentication, iPhone sends `StartIdentification` (0x1D00)
//! and the accessory replies with `IdentificationInformation`
//! (0x1D01) - a large CSM declaring our name, model, supported
//! messages, transport components, language preferences, and any EA
//! protocols we'll consume. iPhone responds with either
//! `IdentificationAccepted` (0x1D02) or `IdentificationRejected`
//! (0x1D03), the latter carrying a presence-only param for each
//! `IdentificationInformation` param it took issue with.
//!
//! `IdentificationInformation` is hand-rolled rather than macro-derived
//! because of its shape: 17+ params, optionals, lists, group-typed
//! sub-blocks, and a non-contiguous param-id space (values jump from
//! 17 to 20 to skip vehicle/CarPlay components we don't use).

use bytes::Bytes;
use serde::{Deserialize, Serialize};

use super::{encode_param_block, Csm, CsmDecodeError, CsmFrame, CsmParam, CsmParamFieldEncode};

/// CSMs the accessory sends in this layer. Empty: identification is a
/// framework message and listing it makes the iPhone reject params 6/7.
/// Only app-level CSMs belong in the messages_sent list.
pub const SENT_BY_ACCESSORY: &[u16] = &[];

/// CSMs the accessory accepts in this layer. Empty for the same
/// reason as `SENT_BY_ACCESSORY`.
pub const RECEIVED_BY_ACCESSORY: &[u16] = &[];

/// `0x1D00` iPhone -> accessory. Begins identification; accessory
/// replies with `IdentificationInformation`.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x1D00)]
pub struct StartIdentification;

/// `0x1D02` iPhone -> accessory. Identification succeeded; the link
/// is fully open for steady-state CSMs.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x1D02)]
pub struct IdentificationAccepted;

/// `0x1D03` iPhone -> accessory. Each present param's id matches an
/// `IdentificationInformation` param the iPhone rejected. The accessory
/// should RST and not retry on the same RFCOMM connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentificationRejected {
    pub rejected_params: Vec<u16>,
}

impl IdentificationRejected {
    pub const CSM_MSG_ID: u16 = 0x1D03;
}

impl From<IdentificationRejected> for CsmFrame {
    fn from(value: IdentificationRejected) -> Self {
        let params = value
            .rejected_params
            .into_iter()
            .map(|id| CsmParam {
                id,
                payload: Bytes::new(),
            })
            .collect();
        Self {
            msg_id: IdentificationRejected::CSM_MSG_ID,
            params,
        }
    }
}

impl TryFrom<CsmFrame> for IdentificationRejected {
    type Error = CsmDecodeError;

    fn try_from(frame: CsmFrame) -> Result<Self, Self::Error> {
        if frame.msg_id != Self::CSM_MSG_ID {
            return Err(CsmDecodeError::WrongMsgId {
                got: frame.msg_id,
                expected: Self::CSM_MSG_ID,
            });
        }
        let rejected_params = frame.params.into_iter().map(|p| p.id).collect();
        Ok(Self { rejected_params })
    }
}

/// Power-providing capability declared in `IdentificationInformation`
/// param 8. Production always sets `None`: the Car Thing never sources
/// power to the iPhone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PowerProvidingCapability {
    None = 0,
    Reserved = 1,
    Advanced = 2,
}

/// `MatchAction` for an EA protocol entry. Controls the iOS App
/// Discovery flow when no app declaring this protocol is installed; the
/// per-app launch prompt is `RequestAppLaunch.launch_method` instead.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum EaProtocolMatchAction {
    NoAction = 0,
    OptionalAction = 1,
    NoAlertAction = 2,
}

/// One supported External Accessory protocol entry. Encoded as a
/// group-typed param 10 inside `IdentificationInformation`, one
/// occurrence per entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EaProtocol {
    pub id: u8,
    pub name: String,
    pub match_action: EaProtocolMatchAction,
    pub native_transport_component_identifier: Option<u16>,
}

impl EaProtocol {
    fn into_group(self) -> Bytes {
        let mut params: Vec<CsmParam> = Vec::with_capacity(4);
        self.id.encode_field(0, &mut params);
        self.name.encode_field(1, &mut params);
        (self.match_action as u8).encode_field(2, &mut params);
        self.native_transport_component_identifier
            .encode_field(3, &mut params);
        encode_param_block(params)
    }
}

/// `HIDComponentFunction` enum values for the function field in an
/// `iAP2HIDComponent` group. Bridgething only emits `MediaPlaybackRemote`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum HidComponentFunction {
    Keyboard = 0,
    MediaPlaybackRemote = 1,
    AssistiveTouch = 2,
    GamepadDeviceHolding = 4,
    Gamepad = 6,
    AssistiveSwitchControl = 7,
    Headset = 8,
    BrailleDisplayKeyboard = 10,
}

/// One iAP2 HID component entry. Encoded as a group-typed param 18
/// inside `IdentificationInformation`. Without this declaration iOS
/// parses the descriptor but silently drops every report sent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HidComponent {
    pub id: u16,
    pub name: String,
    pub function: HidComponentFunction,
}

impl HidComponent {
    fn into_group(self) -> Bytes {
        let mut params: Vec<CsmParam> = Vec::with_capacity(3);
        self.id.encode_field(0, &mut params);
        self.name.encode_field(1, &mut params);
        (self.function as u8).encode_field(2, &mut params);
        encode_param_block(params)
    }
}

/// One Bluetooth transport component entry. Encoded as a group-typed
/// param 17 inside `IdentificationInformation`.
///
/// `supports_iap2_connection` is presence-only: emitted as field 2 with
/// an empty payload when true, omitted when false. A 1-byte `[0x01]`
/// (the default `bool` impl) makes the iPhone reject the whole group.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BluetoothTransportComponent {
    pub id: u16,
    pub name: String,
    pub supports_iap2_connection: bool,
    /// Six-byte BT MAC, big-endian (the same byte order BlueZ prints).
    pub mac: [u8; 6],
}

impl BluetoothTransportComponent {
    fn into_group(self) -> Bytes {
        let mut params: Vec<CsmParam> = Vec::with_capacity(4);
        self.id.encode_field(0, &mut params);
        self.name.encode_field(1, &mut params);
        if self.supports_iap2_connection {
            ().encode_field(2, &mut params);
        }
        Bytes::copy_from_slice(&self.mac).encode_field(3, &mut params);
        encode_param_block(params)
    }
}

/// All caller-supplied fields for the `IdentificationInformation` CSM.
///
/// `additional_messages_*` lets higher layers add their own CSM ids;
/// the always-present layer ids are merged in by
/// [`IdentificationInformation`] at encode time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentificationConfig {
    pub name: String,
    pub model_identifier: String,
    pub manufacturer: String,
    pub serial_number: String,
    pub firmware_version: String,
    pub hardware_version: String,
    pub power_providing_capability: PowerProvidingCapability,
    pub maximum_current_drawn_from_device_ma: u16,
    pub supported_external_accessory_protocols: Vec<EaProtocol>,
    pub app_match_team_id: Option<String>,
    pub current_language: String,
    pub supported_languages: Vec<String>,
    pub bluetooth_transport_components: Vec<BluetoothTransportComponent>,
    pub hid_components: Vec<HidComponent>,
    pub additional_messages_sent_by_accessory: Vec<u16>,
    pub additional_messages_received_from_accessory: Vec<u16>,
}

/// Per-device fields that vary between Car Things; everything else in
/// `IdentificationConfig` is locked to product-level constants. Pass to
/// [`IdentificationConfig::for_carthing`] to build a populated config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarthingIdentification {
    pub serial_number: String,
    pub firmware_version: String,
    pub bt_mac: [u8; 6],
}

impl IdentificationConfig {
    /// Build a config from the per-device fields, with all other fields
    /// at their production defaults; mutate the result to extend them.
    pub fn for_carthing(args: CarthingIdentification) -> Self {
        Self {
            name: "Bridgething".into(),
            model_identifier: "Carthing".into(),
            manufacturer: "ThingLabs".into(),
            serial_number: args.serial_number,
            firmware_version: args.firmware_version,
            hardware_version: "Spotify Car Thing".into(),
            power_providing_capability: PowerProvidingCapability::None,
            maximum_current_drawn_from_device_ma: 0,
            supported_external_accessory_protocols: vec![],
            app_match_team_id: None,
            current_language: "en".into(),
            supported_languages: vec!["en".into()],
            bluetooth_transport_components: vec![BluetoothTransportComponent {
                id: super::hid::TRANSPORT_COMPONENT_ID,
                name: "Bridgething BT".into(),
                supports_iap2_connection: true,
                mac: args.bt_mac,
            }],
            hid_components: vec![HidComponent {
                id: super::hid::TRANSPORT_COMPONENT_ID,
                name: "Bridgething Transport".into(),
                function: HidComponentFunction::MediaPlaybackRemote,
            }],
            additional_messages_sent_by_accessory: vec![],
            additional_messages_received_from_accessory: vec![],
        }
    }
}

/// `0x1D01` accessory -> iPhone. Wraps an [`IdentificationConfig`]; the
/// `From` impl serializes every field into its param id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IdentificationInformation {
    pub config: IdentificationConfig,
}

impl IdentificationInformation {
    pub const CSM_MSG_ID: u16 = 0x1D01;
}

impl From<IdentificationInformation> for CsmFrame {
    fn from(value: IdentificationInformation) -> Self {
        let cfg = value.config;
        let mut params: Vec<CsmParam> = Vec::with_capacity(20);

        cfg.name.encode_field(0, &mut params);
        cfg.model_identifier.encode_field(1, &mut params);
        cfg.manufacturer.encode_field(2, &mut params);
        cfg.serial_number.encode_field(3, &mut params);
        cfg.firmware_version.encode_field(4, &mut params);
        cfg.hardware_version.encode_field(5, &mut params);

        let sent = merge_messages(
            &[
                super::auth::SENT_BY_ACCESSORY,
                SENT_BY_ACCESSORY,
                super::now_playing::SENT_BY_ACCESSORY,
                super::external_accessory::SENT_BY_ACCESSORY,
                super::hid::SENT_BY_ACCESSORY,
                super::device::SENT_BY_ACCESSORY,
                super::telephony::SENT_BY_ACCESSORY,
            ],
            &cfg.additional_messages_sent_by_accessory,
        );
        encode_messages_list(sent).encode_field(6, &mut params);
        let received = merge_messages(
            &[
                super::auth::RECEIVED_BY_ACCESSORY,
                RECEIVED_BY_ACCESSORY,
                super::now_playing::RECEIVED_BY_ACCESSORY,
                super::external_accessory::RECEIVED_BY_ACCESSORY,
                super::hid::RECEIVED_BY_ACCESSORY,
                super::device::RECEIVED_BY_ACCESSORY,
                super::telephony::RECEIVED_BY_ACCESSORY,
            ],
            &cfg.additional_messages_received_from_accessory,
        );
        encode_messages_list(received).encode_field(7, &mut params);

        (cfg.power_providing_capability as u8).encode_field(8, &mut params);
        cfg.maximum_current_drawn_from_device_ma
            .encode_field(9, &mut params);

        for ea in cfg.supported_external_accessory_protocols {
            ea.into_group().encode_field(10, &mut params);
        }

        cfg.app_match_team_id.encode_field(11, &mut params);
        cfg.current_language.encode_field(12, &mut params);
        cfg.supported_languages.encode_field(13, &mut params);

        for bt in cfg.bluetooth_transport_components {
            bt.into_group().encode_field(17, &mut params);
        }

        for hid in cfg.hid_components {
            hid.into_group().encode_field(18, &mut params);
        }

        Self {
            msg_id: IdentificationInformation::CSM_MSG_ID,
            params,
        }
    }
}

/// Param id carrying one EA protocol group inside
/// `IdentificationInformation`; repeated once per declared protocol.
#[cfg(feature = "emulator")]
const EA_PROTOCOL_PARAM: u16 = 10;

#[cfg(feature = "emulator")]
impl EaProtocolMatchAction {
    fn from_u8(byte: u8) -> Option<Self> {
        match byte {
            0 => Some(Self::NoAction),
            1 => Some(Self::OptionalAction),
            2 => Some(Self::NoAlertAction),
            _ => None,
        }
    }
}

#[cfg(feature = "emulator")]
impl EaProtocol {
    /// Decode one EA protocol group (the inverse of [`EaProtocol::into_group`]).
    fn from_group(payload: Bytes) -> Result<Self, CsmDecodeError> {
        use super::CsmParamFieldDecode;
        let mut params = super::decode_param_block(payload)?;
        let id = u8::decode_field(0, &mut params)?;
        let name = String::decode_field(1, &mut params)?;
        let match_action_byte = u8::decode_field(2, &mut params)?;
        let match_action = EaProtocolMatchAction::from_u8(match_action_byte).ok_or(
            CsmDecodeError::ParamDecode {
                param_id: 2,
                detail: "EA protocol match action must be 0, 1, or 2",
            },
        )?;
        let native_transport_component_identifier = Option::<u16>::decode_field(3, &mut params)?;
        Ok(Self {
            id,
            name,
            match_action,
            native_transport_component_identifier,
        })
    }
}

/// Device-side: extract the EA protocols the accessory declared in a
/// received `IdentificationInformation`, so the emulator learns the
/// gateway protocol id from the wire rather than hardcoding it.
#[cfg(feature = "emulator")]
pub(crate) fn parse_ea_protocols(frame: &CsmFrame) -> Result<Vec<EaProtocol>, CsmDecodeError> {
    let mut out = Vec::new();
    for param in &frame.params {
        if param.id == EA_PROTOCOL_PARAM {
            out.push(EaProtocol::from_group(param.payload.clone())?);
        }
    }
    Ok(out)
}

fn merge_messages(builtin_groups: &[&[u16]], extra: &[u16]) -> Vec<u16> {
    let mut out: Vec<u16> =
        Vec::with_capacity(builtin_groups.iter().map(|g| g.len()).sum::<usize>() + extra.len());
    for g in builtin_groups {
        out.extend_from_slice(g);
    }
    out.extend_from_slice(extra);
    out
}

fn encode_messages_list(ids: Vec<u16>) -> Bytes {
    let mut buf = bytes::BytesMut::with_capacity(ids.len() * 2);
    for id in ids {
        buf.extend_from_slice(&id.to_be_bytes());
    }
    buf.freeze()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_config() -> IdentificationConfig {
        IdentificationConfig {
            name: "Bridgething".into(),
            model_identifier: "Carthing".into(),
            manufacturer: "ThingLabs".into(),
            serial_number: "BT0001".into(),
            firmware_version: "v0.1.0".into(),
            hardware_version: "Spotify Car Thing".into(),
            power_providing_capability: PowerProvidingCapability::None,
            maximum_current_drawn_from_device_ma: 0,
            supported_external_accessory_protocols: vec![],
            app_match_team_id: None,
            current_language: "en".into(),
            supported_languages: vec!["en".into()],
            bluetooth_transport_components: vec![BluetoothTransportComponent {
                id: 1,
                name: "Bridgething BT".into(),
                supports_iap2_connection: true,
                mac: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66],
            }],
            hid_components: vec![HidComponent {
                id: crate::csm::hid::TRANSPORT_COMPONENT_ID,
                name: "Bridgething Transport".into(),
                function: HidComponentFunction::MediaPlaybackRemote,
            }],
            additional_messages_sent_by_accessory: vec![],
            additional_messages_received_from_accessory: vec![],
        }
    }

    #[test]
    fn start_identification_roundtrips() {
        let frame: CsmFrame = StartIdentification.into();
        assert_eq!(frame.msg_id, 0x1D00);
        assert!(frame.params.is_empty());
        let back: StartIdentification = frame.try_into().unwrap();
        assert_eq!(back, StartIdentification);
    }

    #[test]
    fn identification_accepted_roundtrips() {
        let frame: CsmFrame = IdentificationAccepted.into();
        assert_eq!(frame.msg_id, 0x1D02);
        let back: IdentificationAccepted = frame.try_into().unwrap();
        assert_eq!(back, IdentificationAccepted);
    }

    #[test]
    fn identification_rejected_extracts_param_ids() {
        let frame = CsmFrame {
            msg_id: 0x1D03,
            params: vec![
                CsmParam {
                    id: 3,
                    payload: Bytes::new(),
                },
                CsmParam {
                    id: 7,
                    payload: Bytes::new(),
                },
            ],
        };
        let rejected: IdentificationRejected = frame.try_into().unwrap();
        assert_eq!(rejected.rejected_params, vec![3, 7]);
    }

    #[test]
    fn identification_information_emits_required_params() {
        let info = IdentificationInformation {
            config: minimal_config(),
        };
        let frame: CsmFrame = info.into();
        assert_eq!(frame.msg_id, 0x1D01);
        let ids: Vec<u16> = frame.params.iter().map(|p| p.id).collect();
        assert!(ids.contains(&0));
        assert!(ids.contains(&1));
        assert!(ids.contains(&2));
        assert!(ids.contains(&3));
        assert!(ids.contains(&4));
        assert!(ids.contains(&5));
        assert!(ids.contains(&6));
        assert!(ids.contains(&7));
        assert!(ids.contains(&8));
        assert!(ids.contains(&9));
        assert!(ids.contains(&12));
        assert!(ids.contains(&13));
        assert!(ids.contains(&17));
        assert!(ids.contains(&18));
        assert!(!ids.contains(&10));
        assert!(!ids.contains(&11));
    }

    #[test]
    fn messages_lists_merge_builtin_layers_and_extras() {
        let mut cfg = minimal_config();
        cfg.additional_messages_sent_by_accessory = vec![0xC8AA];
        cfg.additional_messages_received_from_accessory = vec![0xC8BB];
        let info = IdentificationInformation { config: cfg };
        let frame: CsmFrame = info.into();

        let sent_param = frame.find(6).expect("messages_sent_by_accessory");
        let sent_ids: Vec<u16> = sent_param
            .payload
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(
            sent_ids,
            vec![
                0x5000, 0x5002, 0x5003, 0xEA02, 0xEA03, 0x6800, 0x6802, 0x6803, 0x4154, 0x4156,
                0x4157, 0x4159, 0x415A, 0x415B, 0x415C, 0x415D, 0x415E, 0x415F, 0x4160, 0x4161,
                0xC8AA,
            ]
        );

        let recv_param = frame.find(7).unwrap();
        let recv_ids: Vec<u16> = recv_param
            .payload
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(
            recv_ids,
            vec![
                0x5001, 0xEA00, 0xEA01, 0x6801, 0x6806, 0x6807, 0x4E09, 0x4E0A, 0x4E0B, 0x4E0C,
                0x4155, 0x4158, 0xC8BB
            ]
        );
    }

    #[test]
    fn bluetooth_transport_component_encodes_as_group() {
        let info = IdentificationInformation {
            config: minimal_config(),
        };
        let frame: CsmFrame = info.into();
        let bt = frame.find(17).expect("bluetooth_transport_component");
        let mut group = bt.payload.clone();
        let mut got_id: Option<u16> = None;
        let mut got_name: Option<String> = None;
        let mut got_supports: Option<bool> = None;
        let mut got_mac: Option<[u8; 6]> = None;
        while !group.is_empty() {
            let length = u16::from_be_bytes([group[0], group[1]]) as usize;
            let pid = u16::from_be_bytes([group[2], group[3]]);
            let payload = &group[4..length];
            match pid {
                0 => got_id = Some(u16::from_be_bytes([payload[0], payload[1]])),
                1 => {
                    got_name =
                        Some(String::from_utf8_lossy(&payload[..payload.len() - 1]).into_owned())
                }
                2 => got_supports = Some(payload.is_empty()),
                3 => {
                    let mut mac = [0u8; 6];
                    mac.copy_from_slice(&payload[..6]);
                    got_mac = Some(mac);
                }
                _ => panic!("unexpected sub-param {pid}"),
            }
            group = group.split_off(length);
        }
        assert_eq!(got_id, Some(1));
        assert_eq!(got_name.as_deref(), Some("Bridgething BT"));
        assert_eq!(got_supports, Some(true));
        assert_eq!(got_mac, Some([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]));
    }

    #[test]
    fn ea_protocol_emits_one_param_10_per_entry() {
        let mut cfg = minimal_config();
        cfg.supported_external_accessory_protocols = vec![
            EaProtocol {
                id: 1,
                name: "com.iap2-rs.gateway.v1".into(),
                match_action: EaProtocolMatchAction::NoAction,
                native_transport_component_identifier: None,
            },
            EaProtocol {
                id: 2,
                name: "com.iap2-rs.companion.v1".into(),
                match_action: EaProtocolMatchAction::OptionalAction,
                native_transport_component_identifier: Some(1),
            },
        ];
        let info = IdentificationInformation { config: cfg };
        let frame: CsmFrame = info.into();
        let count = frame.params.iter().filter(|p| p.id == 10).count();
        assert_eq!(count, 2);
    }

    #[test]
    fn app_match_team_id_omitted_when_none() {
        let info = IdentificationInformation {
            config: minimal_config(),
        };
        let frame: CsmFrame = info.into();
        assert!(frame.find(11).is_none());
    }
}

#[cfg(all(test, feature = "emulator"))]
mod device_decode_tests {
    use super::*;

    #[test]
    fn parse_ea_protocols_round_trips_each_entry() {
        let mut cfg = IdentificationConfig::for_carthing(CarthingIdentification {
            serial_number: "BT0001".into(),
            firmware_version: "v0.1.0".into(),
            bt_mac: [1, 2, 3, 4, 5, 6],
        });
        cfg.supported_external_accessory_protocols = vec![
            EaProtocol {
                id: 1,
                name: "com.iap2-rs.gateway".into(),
                match_action: EaProtocolMatchAction::NoAlertAction,
                native_transport_component_identifier: None,
            },
            EaProtocol {
                id: 2,
                name: "com.iap2-rs.companion".into(),
                match_action: EaProtocolMatchAction::OptionalAction,
                native_transport_component_identifier: Some(5353),
            },
        ];
        let frame: CsmFrame = IdentificationInformation { config: cfg }.into();
        let parsed = parse_ea_protocols(&frame).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, 1);
        assert_eq!(parsed[0].name, "com.iap2-rs.gateway");
        assert_eq!(parsed[0].match_action, EaProtocolMatchAction::NoAlertAction);
        assert_eq!(parsed[0].native_transport_component_identifier, None);
        assert_eq!(parsed[1].id, 2);
        assert_eq!(parsed[1].name, "com.iap2-rs.companion");
        assert_eq!(parsed[1].native_transport_component_identifier, Some(5353));
    }

    #[test]
    fn parse_ea_protocols_empty_when_none_declared() {
        let cfg = IdentificationConfig::for_carthing(CarthingIdentification {
            serial_number: "BT0001".into(),
            firmware_version: "v0.1.0".into(),
            bt_mac: [1, 2, 3, 4, 5, 6],
        });
        let frame: CsmFrame = IdentificationInformation { config: cfg }.into();
        assert!(parse_ea_protocols(&frame).unwrap().is_empty());
    }
}
