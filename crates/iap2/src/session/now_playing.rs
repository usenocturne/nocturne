//! NowPlaying flow: subscribes to the iPhone's NowPlaying surface
//! after identification reaches Accepted, then translates each
//! inbound `NowPlayingUpdate` (CSM `0x5001`) into a session event.
//! Also handles outbound `SetNowPlayingInformation` (CSM `0x5003`)
//! commands that the daemon's `TransportController` issues for scrub
//! and queue-jump verbs.
//!
//! `ensure_subscribed` sends `StartNowPlayingUpdates` exactly once per
//! session - the iPhone keeps the subscription for the life of the
//! link. Subsequent calls are no-ops, so the session is free to call
//! it after every CSM dispatch as a "kick if needed" check.

use tokio::sync::mpsc;

use super::{emit, send_csm, SessionEvent};
use crate::{
    csm::{
        now_playing::{NowPlayingUpdate, SetNowPlayingInformation, StartNowPlayingUpdates},
        CsmFrame,
    },
    error::Result,
    link::Iap2Command,
};

/// One outbound NowPlaying control message; the flow turns it into a `SetNowPlayingInformation`
/// CSM. The `set_elapsed_time_available` gate is enforced upstream; this flow trusts callers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct NowPlayingCommand {
    pub elapsed_time_ms: Option<u32>,
    pub queue_index: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NowPlayingState {
    /// Identification has not yet reached Accepted; nothing to do.
    Idle,
    /// `StartNowPlayingUpdates` has been sent; deltas may arrive at any time.
    Subscribed,
}

pub(super) struct NowPlayingFlow {
    state: NowPlayingState,
    rx: mpsc::Receiver<NowPlayingCommand>,
}

impl NowPlayingFlow {
    pub(super) fn new(rx: mpsc::Receiver<NowPlayingCommand>) -> Self {
        Self {
            state: NowPlayingState::Idle,
            rx,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        msg_id == NowPlayingUpdate::CSM_MSG_ID
    }

    /// Send `StartNowPlayingUpdates` if we haven't yet. Idempotent.
    pub(super) async fn ensure_subscribed(
        &mut self,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if matches!(self.state, NowPlayingState::Idle) {
            tracing::debug!("iap2 now-playing: sending StartNowPlayingUpdates");
            send_csm(StartNowPlayingUpdates::standard(), link_command_tx).await?;
            self.state = NowPlayingState::Subscribed;
        }
        Ok(())
    }

    /// Process one NowPlaying-range CSM. Always returns `Ok(None)`; NowPlaying has no terminal
    /// failure state of its own.
    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        if frame.msg_id != NowPlayingUpdate::CSM_MSG_ID {
            return Ok(None);
        }
        let update: NowPlayingUpdate = frame.try_into()?;
        if matches!(self.state, NowPlayingState::Idle) {
            tracing::warn!(
                "iap2 now-playing: received update before subscribing; surfacing anyway"
            );
        }
        tracing::trace!(?update, "iap2 now-playing: delta received");
        emit(session_events_tx, SessionEvent::NowPlayingUpdate(update)).await;
        Ok(None)
    }

    /// Pull the next outbound command from the controller. `None` means the sender was dropped.
    pub(super) async fn recv(&mut self) -> Option<NowPlayingCommand> {
        self.rx.recv().await
    }

    /// Translate an outbound command into a `SetNowPlayingInformation`
    /// CSM. No-op when neither `elapsed_time_ms` nor `queue_index` is
    /// set (the `Default` value).
    pub(super) async fn handle_command(
        &mut self,
        cmd: NowPlayingCommand,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if !matches!(self.state, NowPlayingState::Subscribed) {
            tracing::warn!(
                ?cmd,
                "iap2 now-playing: command before StartNowPlayingUpdates; dropping"
            );
            return Ok(());
        }
        if cmd.elapsed_time_ms.is_none() && cmd.queue_index.is_none() {
            tracing::trace!("iap2 now-playing: empty NowPlayingCommand; ignoring");
            return Ok(());
        }
        let csm = SetNowPlayingInformation {
            elapsed_time_ms: cmd.elapsed_time_ms,
            queue_index: cmd.queue_index,
            queue_list_content_transfer_start_index: None,
        };
        tracing::debug!(?csm, "iap2 now-playing: sending SetNowPlayingInformation");
        send_csm(csm, link_command_tx).await
    }
}
