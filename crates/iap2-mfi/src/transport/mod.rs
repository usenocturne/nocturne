//! Transport abstraction over the chip's I²C interface.
//!
//! The chip is a SMBus-style device: each transaction is a single
//! command byte followed by a payload. Some reads (cert, response,
//! serial) are larger than one SMBus block and must be done as raw I²C
//! reads after a separate command-byte write to wake the chip and
//! select the register.
//!
//! The chip enters a low-power state when idle and NAKs the first
//! transaction after waking. The transport layer absorbs that with a
//! short retry loop so callers see a clean API.

use std::time::Duration;

use crate::error::TransportError;

#[cfg(target_os = "linux")]
mod linux;

pub mod mock;
pub mod remote;

#[cfg(target_os = "linux")]
pub use linux::{LinuxI2c, LinuxI2cConfig};

pub(crate) const RETRY_LIMIT: u8 = 3;
#[cfg(target_os = "linux")]
pub(crate) const RETRY_DELAY: Duration = Duration::from_micros(860);
pub(crate) const CERT_SETTLE: Duration = Duration::from_millis(10);

/// I²C transport for the MFi chip.
///
/// The methods correspond to the four shapes the chip needs:
/// 1. A bare command-byte write (`prepare`) used to wake the chip and
///    point it at a register.
/// 2. SMBus block read of a known-length register (`smbus_read_block`).
/// 3. SMBus block write of a payload to a register (`smbus_write_block`).
/// 4. Raw I²C read after a `prepare`, used for payloads larger than
///    32 bytes (`raw_read`).
///
/// Implementations are responsible for the retry-on-NAK behavior - the
/// chip is asleep most of the time and the first transaction in a burst
/// will frequently fail.
pub trait Transport {
    fn prepare(&mut self, cmd: u8) -> Result<(), TransportError>;

    fn smbus_read_block(&mut self, cmd: u8, out: &mut [u8]) -> Result<(), TransportError>;

    fn smbus_write_block(&mut self, cmd: u8, data: &[u8]) -> Result<(), TransportError>;

    fn raw_read(&mut self, out: &mut [u8]) -> Result<(), TransportError>;

    /// Sleep for the given duration. Implementations may override this
    /// (e.g. to compress time in tests).
    fn sleep(&mut self, dur: Duration) {
        std::thread::sleep(dur);
    }
}
