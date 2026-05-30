use crate::error::{NocturnedError, Result};
use std::fs::OpenOptions;
use std::os::unix::io::AsRawFd;
use tracing::{error, info, warn};

const MFI_DEVICE_PATH: &str = "/dev/apple_mfi";

const MFI_IOCTL_GET_CERT_LEN: u32 = 0x80107704;
const MFI_IOCTL_GET_CERT: u32 = 0x80107705;
const MFI_IOCTL_GET_RESPONSE: u32 = 0x80107707;
const MFI_IOCTL_SET_CHALLENGE: u32 = 0x40107706;

const MFI_CHALLENGE_SIZE: usize = 32;

pub struct MfiChip;

impl MfiChip {
    pub fn new() -> Self {
        Self
    }

    pub fn read_certificate(&self) -> Result<Vec<u8>> {
        info!("Reading MFi certificate from hardware chip");

        let cert_len = {
            let file = match OpenOptions::new()
                .read(true)
                .write(true)
                .open(MFI_DEVICE_PATH)
            {
                Ok(file) => file,
                Err(e) => {
                    warn!("Failed to open MFi device at {}: {}.", MFI_DEVICE_PATH, e);
                    return Err(NocturnedError::MfiDevice(format!(
                        "Cannot open MFi device: {}.",
                        e
                    )));
                }
            };

            let fd = file.as_raw_fd();

            unsafe {
                let mut len_buf = vec![0u8; 3];

                let param = MfiIoctlParam {
                    size: 2,
                    pad: 0,
                    buf_ptr: len_buf.as_mut_ptr() as u64,
                };

                let result = libc::ioctl(
                    fd,
                    MFI_IOCTL_GET_CERT_LEN as libc::c_ulong,
                    &param as *const MfiIoctlParam,
                );

                if result < 0 {
                    let errno = std::io::Error::last_os_error();
                    return Err(NocturnedError::MfiDevice(format!(
                        "ioctl get cert length failed: {}",
                        errno
                    )));
                }

                let cert_len = u16::from_be_bytes([len_buf[0], len_buf[1]]) as usize;
                if cert_len == 0 || cert_len > 1024 {
                    return Err(NocturnedError::MfiDevice(format!(
                        "Invalid certificate length: {}",
                        cert_len
                    )));
                }

                cert_len
            }
        };

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(MFI_DEVICE_PATH)
            .map_err(|e| {
                NocturnedError::MfiDevice(format!("Failed to open MFi device for data: {}", e))
            })?;

        let fd = file.as_raw_fd();

        unsafe {
            let mut cert_buf = vec![0u8; cert_len + 1];

            let cert_param = MfiIoctlParam {
                size: cert_len as u32,
                pad: 0,
                buf_ptr: cert_buf.as_mut_ptr() as u64,
            };

            let result = libc::ioctl(
                fd,
                MFI_IOCTL_GET_CERT as libc::c_ulong,
                &cert_param as *const MfiIoctlParam,
            );

            if result < 0 {
                let errno = std::io::Error::last_os_error();
                return Err(NocturnedError::MfiDevice(format!(
                    "ioctl get cert data failed: {}",
                    errno
                )));
            }

            cert_buf.truncate(cert_len);

            let all_zeros = cert_buf.iter().all(|&b| b == 0x00);
            let all_ff = cert_buf.iter().all(|&b| b == 0xFF);

            if all_zeros {
                return Err(NocturnedError::MfiDevice(
                    "Certificate is all zeros".to_string(),
                ));
            }
            if all_ff {
                return Err(NocturnedError::MfiDevice(
                    "Certificate is all 0xFF".to_string(),
                ));
            }

            info!("Successfully read MFi certificate: {} bytes", cert_len);

            Ok(cert_buf)
        }
    }

    pub fn challenge_response(&self, challenge: &[u8]) -> Result<Vec<u8>> {
        if challenge.len() != MFI_CHALLENGE_SIZE {
            return Err(NocturnedError::MfiDevice(format!(
                "Challenge must be 32 bytes, got {}",
                challenge.len()
            )));
        }

        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(MFI_DEVICE_PATH)
            .map_err(|e| NocturnedError::MfiDevice(format!("Failed to open MFi device: {}", e)))?;

        let fd = file.as_raw_fd();

        let mut chal_buf: [u8; 32] = [0; 32];
        chal_buf.copy_from_slice(&challenge[..32]);

        unsafe {
            let write_param = MfiIoctlParam {
                size: 32,
                pad: 0,
                buf_ptr: chal_buf.as_ptr() as u64,
            };

            let result = libc::ioctl(
                fd,
                MFI_IOCTL_SET_CHALLENGE as libc::c_ulong,
                &write_param as *const MfiIoctlParam,
            );

            if result < 0 {
                let errno = std::io::Error::last_os_error();
                return Err(NocturnedError::MfiDevice(format!(
                    "Failed to send challenge (ioctl returned {}): {}",
                    result, errno
                )));
            }

            info!("Challenge sent to MFi chip (ioctl returned {})", result);
        }

        std::thread::sleep(std::time::Duration::from_millis(100));

        unsafe {
            let mut resp_buf = vec![0u8; 64];

            let resp_param = MfiIoctlParam {
                size: 64,
                pad: 0,
                buf_ptr: resp_buf.as_mut_ptr() as u64,
            };

            let result = libc::ioctl(
                fd,
                MFI_IOCTL_GET_RESPONSE as libc::c_ulong,
                &resp_param as *const MfiIoctlParam,
            );

            if result < 0 {
                let errno = std::io::Error::last_os_error();
                return Err(NocturnedError::MfiDevice(format!(
                    "Failed to read response (ioctl returned {}): {}",
                    result, errno
                )));
            }

            if resp_buf.iter().all(|&b| b == 0x00) {
                return Err(NocturnedError::MfiDevice(
                    "MFi chip returned all-zero signature - hardware error".to_string(),
                ));
            }

            if resp_buf.iter().all(|&b| b == 0xFF) {
                return Err(NocturnedError::MfiDevice(
                    "MFi chip returned all-FF signature - hardware error".to_string(),
                ));
            }

            let ascii_count = resp_buf
                .iter()
                .filter(|&&b| (0x20..=0x7E).contains(&b))
                .count();

            if ascii_count > 32 {
                let ascii_str = String::from_utf8_lossy(&resp_buf);
                error!(
                    "MFi chip returned ASCII data: '{}' (hex: {})",
                    ascii_str,
                    hex::encode(&resp_buf)
                );

                if resp_buf.iter().take(32).all(|&b| {
                    b.is_ascii_digit() || (b'A'..=b'F').contains(&b) || (b'a'..=b'f').contains(&b)
                }) {
                    error!("Response appears to be the MFi serial number, not a signature!");
                    error!("This suggests the challenge was never processed or the wrong register was read");
                }

                return Err(NocturnedError::MfiDevice(format!(
                    "Response appears to be ASCII (serial number?), expected binary signature. Got: {}",
                    ascii_str
                )));
            }

            info!("Got 64-byte ECDSA signature from MFi chip");

            let r_component = &resp_buf[0..32];
            let s_component = &resp_buf[32..64];

            if r_component.iter().all(|&b| b == 0x00) {
                return Err(NocturnedError::MfiDevice(
                    "ECDSA signature r-component is zero - invalid signature".to_string(),
                ));
            }

            if s_component.iter().all(|&b| b == 0x00) {
                return Err(NocturnedError::MfiDevice(
                    "ECDSA signature s-component is zero - invalid signature".to_string(),
                ));
            }

            Ok(resp_buf)
        }
    }
}

#[repr(C)]
struct MfiIoctlParam {
    size: u32,
    pad: u32,
    buf_ptr: u64,
}
