//! High-level driver for the MFi authentication coprocessor.

use std::time::Duration;

use crate::{
    cmd,
    error::{Error, Result},
    transport::{Transport, CERT_SETTLE},
    CHALLENGE_LEN, RESPONSE_LEN, SERIAL_LEN,
};

const SIGN_POLL_DELAY: Duration = Duration::from_millis(500);

/// MFi authentication coprocessor.
///
/// Generic over the transport so callers can swap in a [`MockTransport`]
/// for unit tests. The default transport is [`LinuxI2c`]; use
/// [`MfiAuth::open_default`] / [`MfiAuth::with_transport`] to construct.
///
/// The chip is single-resource on a shared I²C bus and the operations
/// here cannot interleave safely. `&mut self` enforces that at compile
/// time; for cross-task use, wrap in `tokio::sync::Mutex` (or run on a
/// dedicated blocking thread).
///
/// [`MockTransport`]: crate::MockTransport
/// [`LinuxI2c`]: crate::LinuxI2c
pub struct MfiAuth<T: Transport> {
    transport: T,
}

impl<T: Transport> MfiAuth<T> {
    pub fn with_transport(transport: T) -> Self {
        Self { transport }
    }

    pub fn into_transport(self) -> T {
        self.transport
    }

    pub fn transport_mut(&mut self) -> &mut T {
        &mut self.transport
    }

    /// Read the chip's firmware version byte.
    pub fn version(&mut self) -> Result<u8> {
        self.read_byte(cmd::VERSION)
    }

    /// Read the chip's last error code.
    pub fn last_error(&mut self) -> Result<u8> {
        self.read_byte(cmd::ERROR)
    }

    /// Read the chip's status byte. `STATUS_READY` (0x10) means a sign
    /// request has completed and the response register can be read.
    pub fn status(&mut self) -> Result<u8> {
        self.read_byte(cmd::STATUS)
    }

    /// Read the X.509 certificate length (bytes) from the chip.
    ///
    /// The chip needs the same prepare-then-settle-then-raw-read shape
    /// `cert()` uses: it NAKs the next command-byte write while it is
    /// still readying the response, so the SMBus block-read path (which
    /// would re-issue the register byte) cannot be used here.
    pub fn cert_len(&mut self) -> Result<u16> {
        self.transport
            .prepare(cmd::CERT_LEN)
            .map_err(Error::Transport)?;
        self.transport.sleep(CERT_SETTLE);
        let mut buf = [0u8; 2];
        self.transport
            .raw_read(&mut buf)
            .map_err(Error::Transport)?;
        Ok(u16::from_be_bytes(buf))
    }

    /// Read the X.509 certificate into the provided buffer. Returns the
    /// number of bytes written. Errors with [`Error::BufferTooSmall`] if
    /// the buffer is shorter than the chip's reported certificate length.
    pub fn cert_into(&mut self, out: &mut [u8]) -> Result<usize> {
        let len = usize::from(self.cert_len()?);
        if out.len() < len {
            return Err(Error::BufferTooSmall {
                need: len,
                got: out.len(),
            });
        }
        self.transport
            .prepare(cmd::CERT)
            .map_err(Error::Transport)?;
        self.transport.sleep(CERT_SETTLE);
        self.transport
            .raw_read(&mut out[..len])
            .map_err(Error::Transport)?;
        Ok(len)
    }

    /// Read the X.509 certificate. Allocates a `Vec<u8>` of the exact
    /// length reported by the chip.
    pub fn cert(&mut self) -> Result<Vec<u8>> {
        let len = usize::from(self.cert_len()?);
        let mut out = vec![0u8; len];
        self.transport
            .prepare(cmd::CERT)
            .map_err(Error::Transport)?;
        self.transport.sleep(CERT_SETTLE);
        self.transport
            .raw_read(&mut out)
            .map_err(Error::Transport)?;
        Ok(out)
    }

    /// Read the chip's serial / unique-identifier register.
    pub fn serial(&mut self) -> Result<[u8; SERIAL_LEN]> {
        self.transport
            .prepare(cmd::SERIAL)
            .map_err(Error::Transport)?;
        let mut out = [0u8; SERIAL_LEN];
        self.transport
            .raw_read(&mut out)
            .map_err(Error::Transport)?;
        Ok(out)
    }

    /// Run the chip's challenge-response signing flow.
    ///
    /// Writes the 32-byte challenge, verifies the chip echoes back the
    /// expected length, kicks off signing, sleeps ~500ms, polls status,
    /// and reads the 64-byte response. Blocking; the iAP2 layer is
    /// expected to call this from a blocking task.
    pub fn sign(&mut self, challenge: &[u8; CHALLENGE_LEN]) -> Result<[u8; RESPONSE_LEN]> {
        self.transport
            .smbus_write_block(cmd::CHALLENGE, challenge)
            .map_err(Error::Transport)?;

        let mut len_buf = [0u8; 2];
        self.transport
            .smbus_read_block(cmd::CHALLENGE_LEN, &mut len_buf)
            .map_err(Error::Transport)?;
        let echoed = u16::from_be_bytes(len_buf);
        if echoed != cmd::EXPECTED_CHALLENGE_LEN {
            return Err(Error::UnexpectedChallengeLen {
                got: echoed,
                expected: cmd::EXPECTED_CHALLENGE_LEN,
            });
        }

        self.transport
            .smbus_write_block(cmd::START_RESPONSE, &[cmd::START_RESPONSE_TRIGGER])
            .map_err(Error::Transport)?;

        self.transport.sleep(SIGN_POLL_DELAY);

        let status = self.read_byte(cmd::STATUS)?;
        if status != cmd::STATUS_READY {
            return Err(Error::SignNotReady { status });
        }

        self.transport
            .prepare(cmd::RESPONSE)
            .map_err(Error::Transport)?;
        let mut response = [0u8; RESPONSE_LEN];
        self.transport
            .raw_read(&mut response)
            .map_err(Error::Transport)?;
        Ok(response)
    }

    fn read_byte(&mut self, cmd: u8) -> Result<u8> {
        let mut buf = [0u8; 1];
        self.transport
            .smbus_read_block(cmd, &mut buf)
            .map_err(Error::Transport)?;
        Ok(buf[0])
    }
}

#[cfg(target_os = "linux")]
impl MfiAuth<crate::LinuxI2c> {
    /// Open the chip with the default `/dev/i2c-3` config.
    pub fn open_default() -> Result<Self> {
        Self::open(&crate::LinuxI2cConfig::default())
    }

    /// Open the chip with the given linux i2c-dev config.
    pub fn open(config: &crate::LinuxI2cConfig) -> Result<Self> {
        let t = crate::LinuxI2c::open(config).map_err(Error::Transport)?;
        Ok(Self::with_transport(t))
    }
}
