//! HID flow: declares the accessory's virtual HID device once
//! identification reaches Accepted, then translates inbound transport
//! commands into press/release `AccessoryHIDReport` pairs on the iAP2
//! control session.
//!
//! Bridgething uses HID exclusively as the **outbound** path for media
//! intents when the companion has not claimed `NowPlayingPlayback`
//! authority. Hardware events (wheel rotation, presets, back/settings)
//! are captured by the on-device webapp; HID never carries them.
//!
//! Each transport tap fires two `AccessoryHIDReport`s back-to-back: a
//! press frame with the chosen bit(s) set, then a release frame with all
//! bits cleared. iOS treats a missing release as a held button. The
//! release is delayed by [`TAP_RELEASE_DELAY`] to give iOS a clean edge.

use std::time::Duration;

use bytes::Bytes;
use tokio::sync::mpsc;

use super::{send_csm, SessionEvent};
use crate::{
    csm::{
        hid::{
            transport_report, DeviceHIDReport, HIDComponentUpdate, StartHID, StartNativeHID,
            StopHID, PRODUCT_ID, TRANSPORT_COMPONENT_ID, TRANSPORT_DESCRIPTOR, VENDOR_ID,
        },
        CsmFrame,
    },
    error::Result,
    link::Iap2Command,
};

/// Edge gap between the press frame and the release frame for one tap.
const TAP_RELEASE_DELAY: Duration = Duration::from_millis(10);

/// Inter-tap gap when the controller asks for multiple sequential toggles. Long enough that iOS
/// registers each as a discrete press, not a held-button repeat.
const INTER_TAP_DELAY: Duration = Duration::from_millis(60);

/// One outbound HID command; the flow expands it into the right number of HID press frames.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HidCommand {
    /// Single press+release pulse with `mask` held during the press frame. `mask` is any combination
    /// of [`super::super::csm::hid::report_bit`] flags; the all-zero mask is a no-op.
    Pulse(u8),
    /// `count` sequential pulses of `mask`, separated by [`INTER_TAP_DELAY`].
    Sequence { mask: u8, count: u8 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HidState {
    /// Identification has not yet been Accepted; StartHID has not been sent.
    Idle,
    /// StartHID has been sent and acknowledged by iOS reaching Accepted.
    Started,
    /// StopHID has been sent (session teardown).
    Stopped,
}

pub(super) struct HidFlow {
    state: HidState,
    rx: mpsc::Receiver<HidCommand>,
}

impl HidFlow {
    pub(super) fn new(rx: mpsc::Receiver<HidCommand>) -> Self {
        Self {
            state: HidState::Idle,
            rx,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        matches!(msg_id, 0x6801 | 0x6806 | 0x6807)
    }

    /// Process one inbound HID-range CSM. The HID surface is outbound-only; these are decoded
    /// (which still validates the wire shape) and logged, never acted on.
    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        _session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        match frame.msg_id {
            0x6801 => {
                let report = DeviceHIDReport::try_from(frame)?;
                tracing::trace!(
                    component_id = report.component_id,
                    bytes = report.report.len(),
                    "iap2 hid: inbound DeviceHIDReport (logged, not dispatched)"
                );
            }
            0x6806 => {
                let _ = StartNativeHID::try_from(frame)?;
                tracing::debug!("iap2 hid: inbound StartNativeHID");
            }
            0x6807 => {
                let update = HIDComponentUpdate::try_from(frame)?;
                tracing::debug!(
                    component_id = update.component_id,
                    enabled = update.component_enabled,
                    "iap2 hid: inbound HIDComponentUpdate"
                );
            }
            _ => {}
        }
        Ok(None)
    }

    /// Send `StartHID` if we haven't yet. Idempotent.
    pub(super) async fn ensure_started(
        &mut self,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if matches!(self.state, HidState::Idle) {
            tracing::debug!("iap2 hid: sending StartHID");
            let start = StartHID {
                component_id: TRANSPORT_COMPONENT_ID,
                vendor_id: VENDOR_ID,
                product_id: PRODUCT_ID,
                descriptor: Bytes::from_static(TRANSPORT_DESCRIPTOR),
            };
            send_csm(start, link_command_tx).await?;
            self.state = HidState::Started;
        }
        Ok(())
    }

    /// Pull the next command from the controller. `None` means the controller's sender was dropped.
    pub(super) async fn recv(&mut self) -> Option<HidCommand> {
        self.rx.recv().await
    }

    /// Translate a controller command into one or more press+release HID report pairs. No-op (logged
    /// at warn) if `StartHID` has not been sent.
    pub(super) async fn handle_command(
        &mut self,
        cmd: HidCommand,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if !matches!(self.state, HidState::Started) {
            tracing::warn!(?cmd, state = ?self.state, "iap2 hid: command before StartHID; dropping");
            return Ok(());
        }

        match cmd {
            HidCommand::Pulse(0) => {
                tracing::trace!("iap2 hid: ignoring zero-mask pulse");
                Ok(())
            }
            HidCommand::Pulse(mask) => self.send_pulse(mask, link_command_tx).await,
            HidCommand::Sequence { mask: 0, .. } => {
                tracing::trace!("iap2 hid: ignoring zero-mask sequence");
                Ok(())
            }
            HidCommand::Sequence { mask, count } => {
                for i in 0..count {
                    self.send_pulse(mask, link_command_tx).await?;
                    if i + 1 < count {
                        tokio::time::sleep(INTER_TAP_DELAY).await;
                    }
                }
                Ok(())
            }
        }
    }

    /// Send `StopHID` for the transport component. Best-effort; called
    /// during session teardown.
    pub(super) async fn shutdown(
        &mut self,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if matches!(self.state, HidState::Started) {
            let stop = StopHID {
                component_id: TRANSPORT_COMPONENT_ID,
            };
            send_csm(stop, link_command_tx).await?;
        }
        self.state = HidState::Stopped;
        Ok(())
    }

    async fn send_pulse(
        &self,
        mask: u8,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        tracing::trace!(mask, "iap2 hid: pulse");
        send_csm(transport_report(mask), link_command_tx).await?;
        tokio::time::sleep(TAP_RELEASE_DELAY).await;
        send_csm(transport_report(0), link_command_tx).await?;
        Ok(())
    }
}
