//! Userspace driver for the Apple MFi authentication coprocessor.
//!
//! The chip is a small ASIC that holds an X.509 certificate and an ECDSA
//! signing key. To authenticate the accessory to a connected iOS device,
//! software on the accessory reads the certificate from the chip, sends a
//! 32-byte challenge from iOS to the chip, and reads back a 64-byte
//! signature. All cryptography happens inside the chip; this crate just
//! drives its I²C command set.
//!
//! The default transport is `LinuxI2c`, which talks to a `/dev/i2c-N` node
//! via the linux i2c-dev interface. Other transports can be plugged in by
//! implementing [`Transport`] - primarily useful for tests.

mod auth;
mod cmd;
mod error;
mod transport;

pub use auth::MfiAuth;
pub use error::{Error, Result, TransportError};
pub use transport::{
    mock::{MockTransport, MockTransportState},
    remote::{serve as serve_remote, RemoteI2c},
    Transport,
};
#[cfg(target_os = "linux")]
pub use transport::{LinuxI2c, LinuxI2cConfig};

/// Length of the challenge bytes the accessory writes to the chip.
pub const CHALLENGE_LEN: usize = 32;

/// Length of the signature the chip returns after a sign request.
pub const RESPONSE_LEN: usize = 64;

/// Length of the chip's serial-number / unique-identifier register.
pub const SERIAL_LEN: usize = 32;
