//! Chip-side register / command bytes.

pub const VERSION: u8 = 0x00;
pub const ERROR: u8 = 0x05;
pub const STATUS: u8 = 0x10;
pub const START_RESPONSE: u8 = 0x10;
pub const RESPONSE: u8 = 0x12;
pub const CHALLENGE_LEN: u8 = 0x20;
pub const CHALLENGE: u8 = 0x21;
pub const CERT_LEN: u8 = 0x30;
pub const CERT: u8 = 0x31;
pub const SERIAL: u8 = 0x4E;

/// Status byte the chip returns once a sign request has completed and
/// the response register can be read.
pub const STATUS_READY: u8 = 0x10;

/// Value written to `START_RESPONSE` to kick off signing.
pub const START_RESPONSE_TRIGGER: u8 = 0x01;

/// Length the chip echoes back through `CHALLENGE_LEN` after accepting a
/// challenge. Anything else means the chip rejected the data.
pub const EXPECTED_CHALLENGE_LEN: u16 = 32;
