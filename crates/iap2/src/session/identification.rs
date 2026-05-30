//! Identification flow: drives the `0x1D00..0x1D03` exchange.
//! Receives `StartIdentification`, replies with the
//! `IdentificationInformation` that wraps the caller's
//! [`IdentificationConfig`], then waits for accept-or-reject.

use tokio::sync::mpsc;

use super::{emit, send_csm, SessionEvent};
use crate::{
    csm::{
        identification::{
            IdentificationAccepted, IdentificationConfig, IdentificationInformation,
            IdentificationRejected, StartIdentification,
        },
        CsmFrame,
    },
    error::Result,
    link::Iap2Command,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum IdentState {
    AwaitingStart,
    AwaitingResult,
    Accepted,
    Rejected,
}

pub(super) struct IdentificationFlow {
    state: IdentState,
}

impl IdentificationFlow {
    pub(super) fn new() -> Self {
        Self {
            state: IdentState::AwaitingStart,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        (0x1D00..=0x1D03).contains(&msg_id)
    }

    pub(super) fn is_accepted(&self) -> bool {
        self.state == IdentState::Accepted
    }

    /// Process one identification-range CSM. `Some` means "terminal,
    /// emit + tear down."
    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        identification: &IdentificationConfig,
        link_command_tx: &mpsc::Sender<Iap2Command>,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        match frame.msg_id {
            StartIdentification::CSM_MSG_ID => {
                let _: StartIdentification = frame.try_into()?;
                tracing::debug!("iap2 ident: replying IdentificationInformation");
                send_csm(
                    IdentificationInformation {
                        config: identification.clone(),
                    },
                    link_command_tx,
                )
                .await?;
                self.state = IdentState::AwaitingResult;
                Ok(None)
            }
            IdentificationAccepted::CSM_MSG_ID => {
                let _: IdentificationAccepted = frame.try_into()?;
                tracing::info!("iap2 ident: accepted");
                self.state = IdentState::Accepted;
                emit(session_events_tx, SessionEvent::Identified).await;
                Ok(None)
            }
            IdentificationRejected::CSM_MSG_ID => {
                let rejected: IdentificationRejected = frame.try_into()?;
                tracing::warn!(?rejected.rejected_params, "iap2 ident: rejected");
                self.state = IdentState::Rejected;
                Ok(Some(SessionEvent::IdentificationRejected {
                    rejected_params: rejected.rejected_params,
                }))
            }
            other => {
                tracing::trace!(
                    msg_id = format!("{other:#06x}"),
                    "iap2 ident: ignoring CSM outside ident range"
                );
                Ok(None)
            }
        }
    }
}
