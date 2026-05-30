//! Linux i2c-dev transport for the MFi chip.

use std::{
    io,
    path::{Path, PathBuf},
    thread,
};

use i2cdev::{core::I2CDevice, linux::LinuxI2CDevice};

use super::{Transport, RETRY_DELAY, RETRY_LIMIT};
use crate::error::TransportError;

/// Configuration for a [`LinuxI2c`] transport.
#[derive(Debug, Clone)]
pub struct LinuxI2cConfig {
    /// Path to the i2c bus device, e.g. `/dev/i2c-3`.
    pub device: PathBuf,
    /// 7-bit follower address of the chip on the bus.
    pub address: u16,
}

impl LinuxI2cConfig {
    pub const DEFAULT_ADDRESS: u16 = 0x10;

    pub fn new(device: impl Into<PathBuf>, address: u16) -> Self {
        Self {
            device: device.into(),
            address,
        }
    }

    pub fn at(device: impl Into<PathBuf>) -> Self {
        Self::new(device, Self::DEFAULT_ADDRESS)
    }
}

/// Linux i2c-dev transport.
pub struct LinuxI2c {
    dev: LinuxI2CDevice,
}

impl LinuxI2c {
    pub fn open(config: &LinuxI2cConfig) -> Result<Self, TransportError> {
        let dev = LinuxI2CDevice::new(&config.device, config.address).map_err(map_i2c_err)?;
        Ok(Self { dev })
    }

    pub fn open_path(path: impl AsRef<Path>) -> Result<Self, TransportError> {
        let cfg = LinuxI2cConfig::at(path.as_ref().to_path_buf());
        Self::open(&cfg)
    }
}

impl Transport for LinuxI2c {
    fn prepare(&mut self, cmd: u8) -> Result<(), TransportError> {
        retry(|| self.dev.smbus_write_byte(cmd).map_err(map_i2c_err))
    }

    fn smbus_read_block(&mut self, cmd: u8, out: &mut [u8]) -> Result<(), TransportError> {
        self.prepare(cmd)?;
        retry(|| {
            let bytes = self
                .dev
                .smbus_read_i2c_block_data(cmd, out.len() as u8)
                .map_err(map_i2c_err)?;
            if bytes.len() != out.len() {
                return Err(TransportError::Other(format!(
                    "smbus block read: requested {} bytes, got {}",
                    out.len(),
                    bytes.len()
                )));
            }
            out.copy_from_slice(&bytes);
            Ok(())
        })
    }

    fn smbus_write_block(&mut self, cmd: u8, data: &[u8]) -> Result<(), TransportError> {
        retry(|| {
            self.dev
                .smbus_write_i2c_block_data(cmd, data)
                .map_err(map_i2c_err)
        })
    }

    fn raw_read(&mut self, out: &mut [u8]) -> Result<(), TransportError> {
        retry(|| self.dev.read(out).map_err(map_i2c_err))
    }
}

fn retry<F, T>(mut op: F) -> Result<T, TransportError>
where
    F: FnMut() -> Result<T, TransportError>,
{
    let mut attempt = 0u8;
    let mut last_err = None;
    while attempt < RETRY_LIMIT {
        match op() {
            Ok(v) => return Ok(v),
            Err(e) => {
                last_err = Some(e);
                attempt += 1;
                if attempt < RETRY_LIMIT {
                    thread::sleep(RETRY_DELAY);
                }
            }
        }
    }
    Err(last_err.unwrap_or(TransportError::ChipUnresponsive))
}

fn map_i2c_err(err: i2cdev::linux::LinuxI2CError) -> TransportError {
    match err {
        i2cdev::linux::LinuxI2CError::Errno(n) => {
            TransportError::Io(io::Error::from_raw_os_error(n))
        }
        i2cdev::linux::LinuxI2CError::Io(e) => TransportError::Io(e),
    }
}

impl Default for LinuxI2cConfig {
    fn default() -> Self {
        Self::at("/dev/i2c-3")
    }
}
