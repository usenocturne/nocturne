//! Audio capture and wake word detection.

pub mod capture;
pub mod wakeword;

pub use capture::{AudioCapture, AudioCommand, AudioEvent};
pub use wakeword::{WakeWordCommand, WakeWordDetector, WakeWordEvent};
