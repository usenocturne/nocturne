//! Typed CSMs for the iAP2 HID surface.
//!
//! Bridgething uses HID over iAP2 as the **outbound transport** for media
//! intents (play/pause/next/prev/volume/mute/shuffle/repeat) when the
//! companion has not claimed `NowPlayingPlayback` authority - i.e. the iPhone
//! is the sole playback driver. iOS treats Consumer Control page (`0x0C`)
//! usages as system media keys and routes them to whichever app holds the
//! `MPNowPlayingInfoCenter` focus.
//!
//! Hardware events on the Car Thing (wheel rotation, presets, back/settings
//! buttons) are captured by the on-device webapp and never enter HID. HID
//! is one-way: accessory -> iPhone, button intents only.
//!
//! Three CSMs are sent by the accessory:
//!
//! - [`StartHID`] (`0x6800`) - declare a virtual HID device with a
//!   descriptor blob. Sent once per session after Identified.
//! - [`AccessoryHIDReport`] (`0x6802`) - one button-state report per event.
//!   Press = bit set; release = bit cleared. Always send a release after a
//!   press or iOS treats the button as held.
//! - [`StopHID`] (`0x6803`) - tear down the virtual HID device. Sent on
//!   session teardown.
//!
//! `0x6804` (DeviceHIDReport, iPhone -> accessory) exists for iOS-side
//! virtual HID devices but is not consumed by iap2-rs today.

use bytes::Bytes;

use super::Csm;

pub const SENT_BY_ACCESSORY: &[u16] = &[
    StartHID::CSM_MSG_ID,
    AccessoryHIDReport::CSM_MSG_ID,
    StopHID::CSM_MSG_ID,
];

pub const RECEIVED_BY_ACCESSORY: &[u16] = &[
    DeviceHIDReport::CSM_MSG_ID,
    StartNativeHID::CSM_MSG_ID,
    HIDComponentUpdate::CSM_MSG_ID,
];

/// Identifier the accessory uses to address its virtual HID device,
/// opaque to iOS beyond uniqueness within a session. Reused as the
/// BluetoothTransportComponent identifier in `IdentificationInformation`
/// so the two components share one cid.
pub const TRANSPORT_COMPONENT_ID: u16 = 5353;

/// USB VID emitted on `StartHID` param 1. iOS silently fails HID
/// enablement when absent. `0x1D6B` is the Linux Foundation USB VID.
pub const VENDOR_ID: u16 = 0x1D6B;

/// USB PID emitted on `StartHID` param 2. iOS validates only that the
/// param is present and well-formed, not the value.
pub const PRODUCT_ID: u16 = 0xB31D;

/// USB-HID 1.11 descriptor for bridgething's outbound transport device.
/// Six Consumer Control usages packed into a single byte with two bits
/// of constant padding; no Report ID.
///
/// | Bit  | Usage               | Code |
/// | ---- | ------------------- | ---- |
/// | 0x01 | Play/Pause          | 0xCD |
/// | 0x02 | Scan Next Track     | 0xB5 |
/// | 0x04 | Scan Previous Track | 0xB6 |
/// | 0x08 | Volume Increment    | 0xE9 |
/// | 0x10 | Volume Decrement    | 0xEA |
/// | 0x20 | Mute                | 0xE2 |
/// | 0x40..0x80 | constant padding (no actuation) |
pub const TRANSPORT_DESCRIPTOR: &[u8] = &[
    0x05, 0x0C, // Usage Page (Consumer)
    0x09, 0x01, // Usage (Consumer Control)
    0xA1, 0x01, // Collection (Application)
    0x15, 0x00, //   Logical Minimum (0)
    0x25, 0x01, //   Logical Maximum (1)
    0x75, 0x01, //   Report Size (1)
    0x95, 0x06, //   Report Count (6)
    0x09, 0xCD, //   Usage (Play/Pause)
    0x09, 0xB5, //   Usage (Scan Next Track)
    0x09, 0xB6, //   Usage (Scan Previous Track)
    0x09, 0xE9, //   Usage (Volume Increment)
    0x09, 0xEA, //   Usage (Volume Decrement)
    0x09, 0xE2, //   Usage (Mute)
    0x81, 0x02, //   Input (Data,Var,Abs)
    0x75, 0x02, //   Report Size (2)
    0x95, 0x01, //   Report Count (1)
    0x81, 0x03, //   Input (Const,Var,Abs) - padding
    0xC0, // End Collection
];

/// Bit positions inside the single-byte HID report payload, a bitmap of
/// currently-held buttons. Multiple bits set in one report is legal.
pub mod report_bit {
    pub const PLAY_PAUSE: u8 = 0x01;
    pub const NEXT: u8 = 0x02;
    pub const PREV: u8 = 0x04;
    pub const VOLUME_UP: u8 = 0x08;
    pub const VOLUME_DOWN: u8 = 0x10;
    pub const MUTE: u8 = 0x20;
    /// Bits 0x40 / 0x80 fall inside the descriptor's 2-bit constant
    /// padding field and never actuate on iOS regardless of mask value.
    pub const SHUFFLE: u8 = 0x40;
    pub const REPEAT: u8 = 0x80;
}

/// `0x6800` accessory -> iPhone. Declares a virtual HID device; later
/// [`AccessoryHIDReport`]s on the same `component_id` dispatch to it.
///
/// Param layout: cid at 0, USB VID/PID at 1/2, descriptor at 4. iOS
/// silently fails to enable the component when VID/PID are missing or
/// the descriptor lands at a different param id.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6800)]
pub struct StartHID {
    #[csm(param = 0)]
    pub component_id: u16,
    #[csm(param = 1)]
    pub vendor_id: u16,
    #[csm(param = 2)]
    pub product_id: u16,
    #[csm(param = 4)]
    pub descriptor: Bytes,
}

/// `0x6802` accessory -> iPhone. One report per state change. The first
/// byte of `report` must be the Report ID byte declared in the descriptor;
/// the remaining bytes are the report payload (one byte for the transport
/// descriptor).
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6802)]
pub struct AccessoryHIDReport {
    #[csm(param = 0)]
    pub component_id: u16,
    #[csm(param = 1)]
    pub report: Bytes,
}

/// `0x6803` accessory -> iPhone. Tears down the virtual HID device
/// matching `component_id`; further reports on that id are a protocol error.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6803)]
pub struct StopHID {
    #[csm(param = 0)]
    pub component_id: u16,
}

/// `0x6801` iPhone -> accessory. Inbound HID report for a declared
/// component, same shape as outbound. Logged and dropped.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6801)]
pub struct DeviceHIDReport {
    #[csm(param = 0)]
    pub component_id: u16,
    #[csm(param = 1)]
    pub report: Bytes,
}

/// `0x6806` iPhone -> accessory. Signals iOS bringing the accessory's
/// native HID component online. No params.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6806)]
pub struct StartNativeHID;

/// `0x6807` iPhone -> accessory. Gate signalling whether the iPhone
/// will route HID reports through the named component.
#[derive(Csm, Debug, Clone, PartialEq, Eq)]
#[csm(id = 0x6807)]
pub struct HIDComponentUpdate {
    #[csm(param = 0)]
    pub component_id: u16,
    #[csm(param = 1)]
    pub component_enabled: bool,
}

/// Build an [`AccessoryHIDReport`] for the iap2-rs transport
/// component. Payload is the single byte `[mask]`, any combination of
/// [`report_bit`] flags; the all-zero mask is a release frame. No
/// leading Report ID byte (the descriptor declares none).
pub fn transport_report(mask: u8) -> AccessoryHIDReport {
    AccessoryHIDReport {
        component_id: TRANSPORT_COMPONENT_ID,
        report: match mask {
            0x00 => Bytes::from_static(&[0x00]),
            0x01 => Bytes::from_static(&[0x01]),
            0x02 => Bytes::from_static(&[0x02]),
            0x04 => Bytes::from_static(&[0x04]),
            0x08 => Bytes::from_static(&[0x08]),
            0x10 => Bytes::from_static(&[0x10]),
            0x20 => Bytes::from_static(&[0x20]),
            0x40 => Bytes::from_static(&[0x40]),
            0x80 => Bytes::from_static(&[0x80]),
            _ => Bytes::copy_from_slice(&[mask]),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{super::CsmFrame, *};

    #[test]
    fn start_hid_round_trips() {
        let original = StartHID {
            component_id: TRANSPORT_COMPONENT_ID,
            vendor_id: VENDOR_ID,
            product_id: PRODUCT_ID,
            descriptor: Bytes::copy_from_slice(TRANSPORT_DESCRIPTOR),
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x6800);
        let decoded: StartHID = frame.try_into().expect("decode");
        assert_eq!(decoded, original);
    }

    #[test]
    fn accessory_hid_report_round_trips() {
        let original = transport_report(report_bit::PLAY_PAUSE);
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x6802);
        let decoded: AccessoryHIDReport = frame.try_into().expect("decode");
        assert_eq!(decoded, original);
        assert_eq!(decoded.report.as_ref(), &[0x01]);
    }

    #[test]
    fn stop_hid_round_trips() {
        let original = StopHID {
            component_id: TRANSPORT_COMPONENT_ID,
        };
        let frame: CsmFrame = original.clone().into();
        assert_eq!(frame.msg_id, 0x6803);
        let decoded: StopHID = frame.try_into().expect("decode");
        assert_eq!(decoded, original);
    }

    #[test]
    fn release_frame_is_zero_mask() {
        let release = transport_report(0);
        assert_eq!(release.report.as_ref(), &[0x00]);
    }

    #[test]
    fn descriptor_starts_with_consumer_page() {
        assert_eq!(&TRANSPORT_DESCRIPTOR[0..2], &[0x05, 0x0C]);
        assert_eq!(*TRANSPORT_DESCRIPTOR.last().unwrap(), 0xC0);
    }
}
