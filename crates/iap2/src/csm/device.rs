//! Typed CSMs for the iAP2 device-metadata surface.
//!
//! Four inbound CSMs the iPhone pushes after subscription. The accessory
//! subscribes by listing each ID in `IdentificationInformation.MessagesReceivedFromDevice`
//! (param 7) - there is no `Start*` / `Stop*` pair for these. iOS sends
//! one initial push after `IdentificationAccepted` and again on change.
//!
//! - [`DeviceInformationUpdate`] (`0x4E09`) - the user-set device name
//!   shown in iOS Settings (e.g. `"Joey's iPhone"`).
//! - [`DeviceLanguageUpdate`] (`0x4E0A`) - ISO 639 language code (e.g.
//!   `"en"`).
//! - [`DeviceTimeUpdate`] (`0x4E0B`) - wall clock as epoch seconds plus
//!   timezone offset minutes plus DST offset minutes. There is no IANA
//!   zone identifier on this path; build a clock display from the
//!   numeric offsets.
//! - [`DeviceUUIDUpdate`] (`0x4E0C`) - a stable per-device UUID iOS
//!   keeps consistent across BR/EDR and BLE addresses for the same
//!   physical device.

use super::Csm;

/// The accessory does not send any CSMs in this layer; everything is
/// inbound subscribe-by-listing on param 7.
pub const SENT_BY_ACCESSORY: &[u16] = &[];

/// CSMs the accessory accepts in this layer.
pub const RECEIVED_BY_ACCESSORY: &[u16] = &[
    DeviceInformationUpdate::CSM_MSG_ID,
    DeviceLanguageUpdate::CSM_MSG_ID,
    DeviceTimeUpdate::CSM_MSG_ID,
    DeviceUUIDUpdate::CSM_MSG_ID,
];

/// `0x4E09` device -> accessory. Carries the user-set device name as a
/// NUL-terminated UTF-8 string.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4E09)]
pub struct DeviceInformationUpdate {
    #[csm(param = 0)]
    pub device_name: String,
}

/// `0x4E0A` device -> accessory. ISO 639 language code (e.g. `"en"`).
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4E0A)]
pub struct DeviceLanguageUpdate {
    #[csm(param = 0)]
    pub language: String,
}

/// `0x4E0B` device -> accessory. Wall clock plus zone offsets.
/// `seconds_since_reference_date` is unix-epoch seconds (1970-01-01 GMT
/// on the wire, despite the name). `tz_offset_minutes` is signed minutes
/// from GMT; `dst_offset_minutes` is the DST adjustment in minutes.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4E0B)]
pub struct DeviceTimeUpdate {
    #[csm(param = 0)]
    pub seconds_since_reference_date: i64,
    #[csm(param = 1)]
    pub tz_offset_minutes: i16,
    #[csm(param = 2)]
    pub dst_offset_minutes: i8,
}

/// `0x4E0C` device -> accessory. Stable per-device UUID consistent
/// across BR/EDR and BLE addresses for the same physical device.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x4E0C)]
pub struct DeviceUUIDUpdate {
    #[csm(param = 0)]
    pub uuid: String,
}

#[cfg(test)]
mod tests {
    use super::{super::CsmFrame, *};

    #[test]
    fn device_name_round_trips() {
        let original = DeviceInformationUpdate {
            device_name: "Joey's iPhone".into(),
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x4E09);
        let decoded: DeviceInformationUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn device_language_round_trips() {
        let original = DeviceLanguageUpdate {
            language: "en".into(),
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x4E0A);
        let decoded: DeviceLanguageUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn device_time_round_trips() {
        let original = DeviceTimeUpdate {
            seconds_since_reference_date: 1_777_777_777,
            tz_offset_minutes: -360,
            dst_offset_minutes: 60,
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x4E0B);
        let decoded: DeviceTimeUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn device_uuid_round_trips() {
        let original = DeviceUUIDUpdate {
            uuid: "550e8400-e29b-41d4-a716-446655440000".into(),
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x4E0C);
        let decoded: DeviceUUIDUpdate = frame.try_into().unwrap();
        assert_eq!(decoded, original);
    }
}
