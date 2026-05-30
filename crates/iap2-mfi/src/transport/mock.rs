//! In-memory mock transport for tests.
//!
//! Models the chip's "first transaction wakes me up, NAKs while asleep"
//! behavior - set `asleep = N` and the next N transactions will NAK
//! before the chip "wakes" and replies. The retry loop inside each
//! method matches `LinuxI2c`'s contract.

use std::{cell::RefCell, collections::HashMap, rc::Rc, time::Duration};

use super::{Transport, RETRY_LIMIT};
use crate::{cmd, error::TransportError};

/// Shared state between a [`MockTransport`] and the test that drives it.
#[derive(Debug)]
pub struct MockTransportState {
    /// Registers indexed by command byte. SMBus reads return the entry;
    /// SMBus writes overwrite it. Raw reads return the entry whose key
    /// matches the most recent successful `prepare()`.
    pub registers: HashMap<u8, Vec<u8>>,
    /// The cmd byte the last successful `prepare()` selected.
    pub last_prepared: Option<u8>,
    /// Number of upcoming i²c attempts to fail with `ChipUnresponsive`
    /// before the chip "wakes". Decremented on every attempt (whether
    /// the attempt is a successful prepare or a real op).
    pub asleep: u8,
    /// Total i²c attempts (NAKs + successes). Useful to assert retry
    /// behavior fired.
    pub attempt_count: u32,
    /// Sleep durations recorded; lets tests assert delays without
    /// actually waiting.
    pub sleeps: Vec<Duration>,
    /// What `STATUS` returns on the NEXT read after a sign trigger has
    /// been observed. Defaults to `STATUS_READY` so the happy path
    /// works without configuration.
    pub status_after_trigger: u8,
    /// What `CHALLENGE_LEN` returns. Defaults to the expected value so
    /// the happy path works without configuration.
    pub challenge_echo: u16,
    /// Set internally when a `START_RESPONSE` trigger is observed. The
    /// next `STATUS` read consumes it and returns `status_after_trigger`.
    triggered: bool,
}

impl Default for MockTransportState {
    fn default() -> Self {
        Self {
            registers: HashMap::new(),
            last_prepared: None,
            asleep: 0,
            attempt_count: 0,
            sleeps: Vec::new(),
            status_after_trigger: cmd::STATUS_READY,
            challenge_echo: cmd::EXPECTED_CHALLENGE_LEN,
            triggered: false,
        }
    }
}

#[derive(Clone)]
pub struct MockTransport {
    state: Rc<RefCell<MockTransportState>>,
}

impl MockTransport {
    pub fn new() -> Self {
        Self {
            state: Rc::new(RefCell::new(MockTransportState::default())),
        }
    }

    pub fn shared(&self) -> Rc<RefCell<MockTransportState>> {
        self.state.clone()
    }

    pub fn set_register(&self, cmd: u8, data: impl Into<Vec<u8>>) {
        self.state.borrow_mut().registers.insert(cmd, data.into());
    }

    pub fn set_cert(&self, cert: impl Into<Vec<u8>>) {
        let cert = cert.into();
        let len = u16::try_from(cert.len()).expect("cert len fits u16");
        self.set_register(cmd::CERT_LEN, len.to_be_bytes().to_vec());
        self.set_register(cmd::CERT, cert);
    }

    pub fn set_response(&self, response: impl Into<Vec<u8>>) {
        self.set_register(cmd::RESPONSE, response.into());
    }

    pub fn set_serial(&self, serial: impl Into<Vec<u8>>) {
        self.set_register(cmd::SERIAL, serial.into());
    }

    pub fn set_asleep(&self, n: u8) {
        self.state.borrow_mut().asleep = n;
    }

    pub fn set_challenge_echo(&self, value: u16) {
        self.state.borrow_mut().challenge_echo = value;
    }

    pub fn set_status_after_trigger(&self, status: u8) {
        self.state.borrow_mut().status_after_trigger = status;
    }

    /// Run an op with retry-on-asleep semantics matching `LinuxI2c`.
    /// Each attempt counts toward `attempt_count`; if `asleep > 0` the
    /// attempt NAKs and decrements asleep. After `RETRY_LIMIT` consecutive
    /// NAKs the call returns `ChipUnresponsive`.
    fn with_retry<F, T>(&mut self, mut op: F) -> Result<T, TransportError>
    where
        F: FnMut(&mut MockTransportState) -> Result<T, TransportError>,
    {
        for attempt in 0..RETRY_LIMIT {
            let mut s = self.state.borrow_mut();
            s.attempt_count += 1;
            if s.asleep > 0 {
                s.asleep -= 1;
                if attempt + 1 == RETRY_LIMIT {
                    return Err(TransportError::ChipUnresponsive);
                }
                continue;
            }
            return op(&mut s);
        }
        Err(TransportError::ChipUnresponsive)
    }
}

impl Default for MockTransport {
    fn default() -> Self {
        Self::new()
    }
}

impl Transport for MockTransport {
    fn prepare(&mut self, cmd: u8) -> Result<(), TransportError> {
        self.with_retry(|s| {
            s.last_prepared = Some(cmd);
            Ok(())
        })
    }

    fn smbus_read_block(&mut self, cmd_byte: u8, out: &mut [u8]) -> Result<(), TransportError> {
        self.prepare(cmd_byte)?;
        self.with_retry(|s| {
            let data = match cmd_byte {
                cmd::CHALLENGE_LEN => s.challenge_echo.to_be_bytes().to_vec(),
                cmd::STATUS if s.triggered => {
                    s.triggered = false;
                    vec![s.status_after_trigger]
                }
                _ => s.registers.get(&cmd_byte).cloned().ok_or_else(|| {
                    TransportError::Other(format!(
                        "mock: no register set for cmd 0x{:02x}",
                        cmd_byte
                    ))
                })?,
            };

            if data.len() < out.len() {
                return Err(TransportError::Other(format!(
                    "mock: register 0x{:02x} has {} bytes, requested {}",
                    cmd_byte,
                    data.len(),
                    out.len()
                )));
            }
            out.copy_from_slice(&data[..out.len()]);
            Ok(())
        })
    }

    fn smbus_write_block(&mut self, cmd_byte: u8, data: &[u8]) -> Result<(), TransportError> {
        self.with_retry(|s| {
            s.registers.insert(cmd_byte, data.to_vec());
            if cmd_byte == cmd::START_RESPONSE && data == [cmd::START_RESPONSE_TRIGGER] {
                s.triggered = true;
            }
            Ok(())
        })
    }

    fn raw_read(&mut self, out: &mut [u8]) -> Result<(), TransportError> {
        self.with_retry(|s| {
            let prepared = s.last_prepared.ok_or_else(|| {
                TransportError::Other("mock: raw_read with no preceding prepare".into())
            })?;
            let data = s.registers.get(&prepared).cloned().ok_or_else(|| {
                TransportError::Other(format!("mock: no register set for cmd 0x{:02x}", prepared))
            })?;
            if data.len() < out.len() {
                return Err(TransportError::Other(format!(
                    "mock: register 0x{:02x} has {} bytes, requested {}",
                    prepared,
                    data.len(),
                    out.len()
                )));
            }
            out.copy_from_slice(&data[..out.len()]);
            Ok(())
        })
    }

    fn sleep(&mut self, dur: Duration) {
        self.state.borrow_mut().sleeps.push(dur);
    }
}
