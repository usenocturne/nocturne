//! iAP2 protocol stack for iap2-rs.
//!
//! This crate is transport-agnostic: it consumes any
//! `AsyncRead + AsyncWrite + Unpin` byte stream (in production this is the
//! RFCOMM socket BlueZ hands the daemon when an iPhone connects). The
//! crate is also runtime-agnostic with respect to the MFi coprocessor:
//! it consumes anything that satisfies the [`iap2_mfi::Transport`]
//! trait, so tests can run against `MockTransport` and dev iteration can
//! run against `RemoteI2c` while production runs against `LinuxI2c`.

pub mod csm;
#[cfg(feature = "emulator")]
pub mod emulator;
mod error;
mod frame;
#[cfg(feature = "frame-tap")]
mod frame_tap;
mod link;
pub mod session;

#[cfg(feature = "emulator")]
pub use emulator::{DeviceEaStream, DeviceEmulator, DeviceEmulatorHandle, EmulatorEvent};
pub use error::{Error, Result};
pub use frame::{
    ControlBits, LinkCodec, LinkHeader, LinkPacket, Lsp, SessionTriple, SessionType, DETECT_MARKER,
    LINK_HEADER_LEN, LINK_MAGIC,
};
#[cfg(feature = "frame-tap")]
pub use frame_tap::*;
pub use iap2_mfi::{
    Error as MfiError, MfiAuth, Transport, TransportError, CHALLENGE_LEN, RESPONSE_LEN,
};
pub use link::{Iap2Command, Iap2Event, Link, LinkConfig};
pub use session::{
    EaPriority, EaSendError, EaStreamSender, HidCommand, Iap2Session, MfiAccess, MfiHandle,
    NowPlayingCommand, SessionEvent, WorkerMfiAccess,
};

/// SDP service-class UUID the accessory advertises for its iAP2-over-RFCOMM
/// listener. iPhones scan for it and open RFCOMM on the channel from the
/// matching SDP record.
pub const IAP2_ACCESSORY_UUID: uuid::Uuid =
    uuid::Uuid::from_u128(0x00000000_DECA_FADE_DECA_DEAFDECACAFF);

/// SDP service-class UUID iOS devices advertise for inbound iAP2-over-RFCOMM.
/// Trailing nibble `E` is the only difference from the accessory's `F`.
pub const IAP2_DEVICE_UUID: uuid::Uuid =
    uuid::Uuid::from_u128(0x00000000_DECA_FADE_DECA_DEAFDECACAFE);

/// RFCOMM channel the accessory binds for iAP2. Channel 1 is the
/// bridgething-native gateway, so iAP2 lives on 2.
pub const IAP2_RFCOMM_CHANNEL: u8 = 2;
