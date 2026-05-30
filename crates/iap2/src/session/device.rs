//! Device-metadata flow: receives `DeviceInformationUpdate`,
//! `DeviceLanguageUpdate`, `DeviceTimeUpdate`, and `DeviceUUIDUpdate`
//! pushes from the iPhone and re-emits each as its own `SessionEvent`.
//!
//! The accessory subscribes by listing each CSM ID in
//! `IdentificationInformation.MessagesReceivedFromDevice`; iOS sends an
//! initial push after `IdentificationAccepted` and again on change. No
//! `Start*` / `Stop*` pair to drive - purely passive on the wire.

use tokio::sync::mpsc;

use super::{emit, SessionEvent};
use crate::{
    csm::{
        device::{
            DeviceInformationUpdate, DeviceLanguageUpdate, DeviceTimeUpdate, DeviceUUIDUpdate,
        },
        CsmFrame,
    },
    error::Result,
};

pub(super) struct DeviceFlow;

impl DeviceFlow {
    pub(super) fn new() -> Self {
        Self
    }

    #[allow(clippy::manual_range_patterns)]
    pub(super) fn handles(msg_id: u16) -> bool {
        matches!(msg_id, 0x4E09 | 0x4E0A | 0x4E0B | 0x4E0C)
    }

    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        let event = match frame.msg_id {
            0x4E09 => SessionEvent::DeviceName(DeviceInformationUpdate::try_from(frame)?),
            0x4E0A => SessionEvent::DeviceLanguage(DeviceLanguageUpdate::try_from(frame)?),
            0x4E0B => SessionEvent::DeviceTime(DeviceTimeUpdate::try_from(frame)?),
            0x4E0C => SessionEvent::DeviceUuid(DeviceUUIDUpdate::try_from(frame)?),
            _ => return Ok(None),
        };
        emit(session_events_tx, event).await;
        Ok(None)
    }
}
