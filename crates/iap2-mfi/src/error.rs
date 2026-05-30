use std::io;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("i2c transport: {0}")]
    Transport(#[from] TransportError),

    #[error("chip echoed unexpected challenge length: got {got}, expected {expected}")]
    UnexpectedChallengeLen { got: u16, expected: u16 },

    #[error("chip did not become ready after sign request (status=0x{status:02x})")]
    SignNotReady { status: u8 },

    #[error("buffer too small: need {need} bytes, got {got}")]
    BufferTooSmall { need: usize, got: usize },

    #[error("chip returned wrong number of bytes for command 0x{cmd:02x}: expected {expected}, got {got}")]
    ShortRead {
        cmd: u8,
        expected: usize,
        got: usize,
    },
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("i2c io: {0}")]
    Io(#[from] io::Error),

    #[error("chip remained unresponsive after retries")]
    ChipUnresponsive,

    #[error("{0}")]
    Other(String),
}
