use crate::{csm::CsmDecodeError, frame::FrameError};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("frame error: {0}")]
    Frame(#[from] FrameError),
    #[error("peer disconnected before link reached established")]
    PeerDisconnectedDuringHandshake,
    #[error("peer disconnected")]
    PeerDisconnected,
    #[error("peer sent RST")]
    PeerReset,
    #[error("handshake timed out in state {0:?}")]
    HandshakeTimeout(&'static str),
    #[error("peer sent packet with unexpected control bits during handshake: {0:?}")]
    UnexpectedHandshakePacket(crate::frame::ControlBits),
    #[error("retransmission limit reached; link declared dead")]
    RetransmitLimit,
    #[error("csm decode: {0}")]
    CsmDecode(#[from] CsmDecodeError),
    #[error("mfi: {0}")]
    Mfi(#[from] iap2_mfi::Error),
    #[error("link task closed before session could send")]
    LinkClosed,
}
