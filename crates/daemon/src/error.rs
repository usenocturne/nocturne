use thiserror::Error;

#[derive(Error, Debug)]
pub enum NocturnedError {
    #[error("Bluetooth error: {0}")]
    Bluetooth(#[from] bluer::Error),

    #[error("iAP2 protocol error: {0}")]
    Iap2Protocol(String),

    #[error("MFi device error: {0}")]
    MfiDevice(String),

    #[allow(dead_code)]
    #[error("Connection lost")]
    ConnectionLost,

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("WebSocket error: {0}")]
    WebSocket(Box<tokio_tungstenite::tungstenite::Error>),

    #[error("JSON serialization error: {0}")]
    JsonSerialization(#[from] serde_json::Error),

    #[error("MessagePack serialization error: {0}")]
    MessagePackSerialization(#[from] rmp_serde::encode::Error),

    #[error("MessagePack deserialization error: {0}")]
    MessagePackDeserialization(#[from] rmp_serde::decode::Error),

    #[error("General error: {0}")]
    General(#[from] anyhow::Error),
}

impl From<tokio_tungstenite::tungstenite::Error> for NocturnedError {
    fn from(e: tokio_tungstenite::tungstenite::Error) -> Self {
        NocturnedError::WebSocket(Box::new(e))
    }
}

pub type Result<T> = std::result::Result<T, NocturnedError>;
