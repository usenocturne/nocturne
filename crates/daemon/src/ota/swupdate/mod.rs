#[cfg(feature = "device")]
mod ffi;
#[cfg(not(feature = "device"))]
mod stub;

#[cfg(feature = "device")]
pub use ffi::Swupdate;
pub use libnocturne::OtaPhase;
#[cfg(not(feature = "device"))]
pub use stub::Swupdate;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SwupdateEvent {
    pub phase: OtaPhase,
    pub percent: u8,
}

#[derive(Debug, thiserror::Error)]
pub enum SwupdateError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[cfg(feature = "device")]
    #[error("swupdate ipc error: {0}")]
    Ipc(String),
    #[cfg(feature = "device")]
    #[error("swupdate write failed: {msg}")]
    WriteFailed { msg: String },
}
