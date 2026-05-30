//! Auth flow: drives the `0xAA00..0xAA05` exchange against the MFi
//! coprocessor. Owns its own state (`AuthState`) and reaches the chip
//! through an [`MfiAccess`] handle the parent session loans on each
//! call. `AuthFlow::handles` lets the session dispatch by msg-id range
//! without each flow having to peek at unrelated CSMs.

use bytes::Bytes;
use iap2_mfi::CHALLENGE_LEN;
use tokio::sync::mpsc;

use super::{emit, send_csm, MfiAccess, SessionEvent};
use crate::{
    csm::{
        auth::{
            AuthenticationCertificate, AuthenticationFailed, AuthenticationResponse,
            AuthenticationSucceeded, RequestAuthenticationCertificate,
            RequestAuthenticationChallengeResponse,
        },
        CsmDecodeError, CsmFrame,
    },
    error::{Error, Result},
    link::Iap2Command,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AuthState {
    AwaitingCertRequest,
    AwaitingChallenge,
    AwaitingAuthResult,
    Authenticated,
    Failed,
}

pub(super) struct AuthFlow {
    state: AuthState,
}

impl AuthFlow {
    pub(super) fn new() -> Self {
        Self {
            state: AuthState::AwaitingCertRequest,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        (0xAA00..=0xAA05).contains(&msg_id)
    }

    pub(super) fn is_authenticated(&self) -> bool {
        self.state == AuthState::Authenticated
    }

    /// Process one auth-range CSM. `Some(event)` means "emit this terminal event and disconnect
    /// the link"; `None` means handled internally (may have emitted a non-terminal event already).
    pub(super) async fn handle<M: MfiAccess>(
        &mut self,
        frame: CsmFrame,
        mfi: &mut M,
        link_command_tx: &mpsc::Sender<Iap2Command>,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        match frame.msg_id {
            RequestAuthenticationCertificate::CSM_MSG_ID => {
                let _: RequestAuthenticationCertificate = frame.try_into()?;
                if self.state != AuthState::AwaitingCertRequest {
                    tracing::warn!(?self.state, "iap2 auth: cert request out of order");
                }
                let cert = mfi.cert().await?;
                tracing::debug!(
                    cert_len = cert.len(),
                    "iap2 auth: replying AuthenticationCertificate"
                );
                send_csm(AuthenticationCertificate { cert }, link_command_tx).await?;
                self.state = AuthState::AwaitingChallenge;
                Ok(None)
            }
            RequestAuthenticationChallengeResponse::CSM_MSG_ID => {
                let req: RequestAuthenticationChallengeResponse = frame.try_into()?;
                if req.challenge.len() != CHALLENGE_LEN {
                    tracing::warn!(
                        len = req.challenge.len(),
                        "iap2 auth: unexpected challenge length"
                    );
                    return Err(Error::CsmDecode(CsmDecodeError::ParamLength {
                        param_id: 0,
                        expected: CHALLENGE_LEN,
                        got: req.challenge.len(),
                    }));
                }
                let mut challenge = [0u8; CHALLENGE_LEN];
                challenge.copy_from_slice(&req.challenge);
                let response = mfi.sign(challenge).await?;
                tracing::debug!("iap2 auth: replying AuthenticationResponse");
                send_csm(
                    AuthenticationResponse {
                        response: Bytes::copy_from_slice(&response),
                    },
                    link_command_tx,
                )
                .await?;
                self.state = AuthState::AwaitingAuthResult;
                Ok(None)
            }
            AuthenticationSucceeded::CSM_MSG_ID => {
                let _: AuthenticationSucceeded = frame.try_into()?;
                tracing::info!("iap2 auth: authentication succeeded");
                self.state = AuthState::Authenticated;
                emit(session_events_tx, SessionEvent::Authenticated).await;
                Ok(None)
            }
            AuthenticationFailed::CSM_MSG_ID => {
                let _: AuthenticationFailed = frame.try_into()?;
                tracing::warn!("iap2 auth: authentication failed");
                self.state = AuthState::Failed;
                Ok(Some(SessionEvent::AuthFailed))
            }
            other => {
                tracing::trace!(
                    msg_id = format!("{other:#06x}"),
                    "iap2 auth: ignoring CSM outside auth range"
                );
                Ok(None)
            }
        }
    }
}
