//! Telephony flow: subscribes to call-state and communications updates
//! after identification reaches Accepted, decodes inbound updates, and
//! turns outbound action commands from the daemon into the right CSMs
//! on the wire.
//!
//! Subscribe-by-listing: `StartCallStateUpdates` and
//! `StartCommunicationsUpdates` carry one empty-payload TLV per
//! attribute id; iPhone only pushes the listed fields. No special
//! per-message-id gating beyond what the standard CSMs already encode.

use tokio::sync::mpsc;

use super::{emit, send_csm, SessionEvent};
use crate::{
    csm::{
        telephony::{
            AcceptCall, CallStateUpdate, CommunicationsUpdate, EndCall, HoldStatusUpdate,
            InitiateCall, MergeCalls, MuteStatusUpdate, SendDtmf, StartCallStateUpdates,
            StartCommunicationsUpdates, SwapCalls,
        },
        CsmFrame,
    },
    error::Result,
    link::Iap2Command,
};

/// Outbound telephony actions the daemon can request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TelephonyCommand {
    Initiate(InitiateCall),
    Accept(AcceptCall),
    End(EndCall),
    Swap,
    Merge,
    Hold(HoldStatusUpdate),
    Mute(MuteStatusUpdate),
    Dtmf(SendDtmf),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SubscriptionState {
    Idle,
    Subscribed,
}

pub(super) struct TelephonyFlow {
    state: SubscriptionState,
    rx: mpsc::Receiver<TelephonyCommand>,
}

impl TelephonyFlow {
    pub(super) fn new(rx: mpsc::Receiver<TelephonyCommand>) -> Self {
        Self {
            state: SubscriptionState::Idle,
            rx,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        msg_id == CallStateUpdate::CSM_MSG_ID || msg_id == CommunicationsUpdate::CSM_MSG_ID
    }

    /// Send `StartCallStateUpdates` and `StartCommunicationsUpdates`
    /// once per session. Idempotent.
    pub(super) async fn ensure_subscribed(
        &mut self,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if matches!(self.state, SubscriptionState::Idle) {
            tracing::debug!("iap2 telephony: sending Start*Updates pair");
            send_csm(StartCallStateUpdates::standard(), link_command_tx).await?;
            send_csm(StartCommunicationsUpdates::standard(), link_command_tx).await?;
            self.state = SubscriptionState::Subscribed;
        }
        Ok(())
    }

    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        let event = match frame.msg_id {
            CallStateUpdate::CSM_MSG_ID => {
                SessionEvent::CallStateUpdate(CallStateUpdate::try_from(frame)?)
            }
            CommunicationsUpdate::CSM_MSG_ID => {
                SessionEvent::CommunicationsUpdate(CommunicationsUpdate::try_from(frame)?)
            }
            _ => return Ok(None),
        };
        emit(session_events_tx, event).await;
        Ok(None)
    }

    pub(super) async fn recv(&mut self) -> Option<TelephonyCommand> {
        self.rx.recv().await
    }

    pub(super) async fn handle_command(
        &mut self,
        cmd: TelephonyCommand,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if !matches!(self.state, SubscriptionState::Subscribed) {
            tracing::warn!(
                ?cmd,
                "iap2 telephony: command before subscription; dropping"
            );
            return Ok(());
        }
        tracing::debug!(?cmd, "iap2 telephony: dispatching action");
        match cmd {
            TelephonyCommand::Initiate(c) => send_csm(c, link_command_tx).await,
            TelephonyCommand::Accept(c) => send_csm(c, link_command_tx).await,
            TelephonyCommand::End(c) => send_csm(c, link_command_tx).await,
            TelephonyCommand::Swap => send_csm(SwapCalls, link_command_tx).await,
            TelephonyCommand::Merge => send_csm(MergeCalls, link_command_tx).await,
            TelephonyCommand::Hold(c) => send_csm(c, link_command_tx).await,
            TelephonyCommand::Mute(c) => send_csm(c, link_command_tx).await,
            TelephonyCommand::Dtmf(c) => send_csm(c, link_command_tx).await,
        }
    }
}
