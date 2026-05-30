//! HTTP and WebSocket servers exposed by the daemon.

pub mod webapp;
pub mod websocket;

pub use webapp::{run, DEFAULT_LISTEN, DEFAULT_WEBAPPS_DIR};
pub(crate) use websocket::canonical_music_request;
pub use websocket::WebSocketServer;
