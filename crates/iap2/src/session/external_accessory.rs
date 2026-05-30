//! External Accessory flow: bridges iAP2 link session_id 3 (the
//! ExternalAccessory link session declared in
//! `Lsp::accessory_default`) plus the four `0xEA0x` control-session
//! CSMs into a clean per-EA-stream byte-channel surface for upstream
//! consumers.
//!
//! Inbound `StartExternalAccessoryProtocolSession` opens a per-stream
//! state, replies with a `StatusExternalAccessoryProtocolSession::Ok`,
//! and emits `SessionEvent::EaStreamOpened` carrying the byte
//! channels the consumer will read/write. Inbound link DATA on
//! session_id 3 is split by the leading u16-BE EA-stream-id and
//! forwarded into the matching per-stream inbound channel. Outbound
//! traffic rides the shared [`EaChunker`], which drains Normal-first
//! and splits each frame at the link payload budget.
//!
//! Stream close (peer Stop, link tear-down, or the consumer dropping the
//! channel ends) tears down the per-stream state and emits
//! `SessionEvent::EaStreamClosed`.
//!
//! `ensure_app_launch_requested` is the post-Identified hook the
//! session calls once: it dispatches `RequestAppLaunch` with the
//! configured bundle id (typically `com.iap2-rs.gateway`). iOS
//! either foregrounds the matching app, opens a Settings deeplink, or
//! silently no-ops if the app isn't installed. Idempotent; subsequent
//! calls are no-ops.

use std::collections::HashMap;

use bytes::Bytes;
use tokio::sync::mpsc;

use super::{
    ea_transport::{split_stream_frame, EaChunker},
    emit, send_csm, SessionEvent,
};
use crate::{
    csm::{
        external_accessory::{
            AppLaunchMethod, EaSessionStatus, RequestAppLaunch,
            StartExternalAccessoryProtocolSession, StatusExternalAccessoryProtocolSession,
            StopExternalAccessoryProtocolSession,
        },
        CsmFrame,
    },
    error::Result,
    link::Iap2Command,
};

const STREAM_INBOUND_CAPACITY: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppLaunchState {
    Idle,
    Requested,
}

pub(super) struct EaFlow {
    streams: HashMap<u16, mpsc::Sender<Bytes>>,
    chunker: EaChunker,
    app_launch: AppLaunchState,
}

impl std::fmt::Debug for EaFlow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EaFlow")
            .field("streams", &self.streams.keys().collect::<Vec<_>>())
            .field("app_launch", &self.app_launch)
            .finish()
    }
}

impl EaFlow {
    pub(super) fn new(link_command_tx: mpsc::Sender<Iap2Command>, peer_max_len: u16) -> Self {
        Self {
            streams: HashMap::new(),
            chunker: EaChunker::new(link_command_tx, peer_max_len),
            app_launch: AppLaunchState::Idle,
        }
    }

    pub(super) fn handles(msg_id: u16) -> bool {
        msg_id == StartExternalAccessoryProtocolSession::CSM_MSG_ID
            || msg_id == StopExternalAccessoryProtocolSession::CSM_MSG_ID
    }

    /// Idempotent post-Identified kick: sends `RequestAppLaunch` once per session. iOS silently
    /// ignores it unless the bundle id names an installed app declaring our EA protocol string in
    /// its `UISupportedExternalAccessoryProtocols` Info.plist key.
    pub(super) async fn ensure_app_launch_requested(
        &mut self,
        bundle_id: &str,
        link_command_tx: &mpsc::Sender<Iap2Command>,
    ) -> Result<()> {
        if matches!(self.app_launch, AppLaunchState::Idle) {
            tracing::debug!(bundle_id, "iap2 ea: sending RequestAppLaunch");
            send_csm(
                RequestAppLaunch {
                    bundle_id: bundle_id.to_string(),
                    launch_method: AppLaunchMethod::WithoutUserAlert,
                },
                link_command_tx,
            )
            .await?;
            self.app_launch = AppLaunchState::Requested;
        }
        Ok(())
    }

    /// Dispatch one EA-range control CSM. Always returns `Ok(None)`; this layer never produces a
    /// terminal `SessionEvent`, the link layer surfaces `LinkDown` if the link falls over.
    pub(super) async fn handle(
        &mut self,
        frame: CsmFrame,
        link_command_tx: &mpsc::Sender<Iap2Command>,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<Option<SessionEvent>> {
        match frame.msg_id {
            StartExternalAccessoryProtocolSession::CSM_MSG_ID => {
                let start: StartExternalAccessoryProtocolSession = frame.try_into()?;
                self.handle_start(start, link_command_tx, session_events_tx)
                    .await?;
            }
            StopExternalAccessoryProtocolSession::CSM_MSG_ID => {
                let stop: StopExternalAccessoryProtocolSession = frame.try_into()?;
                self.handle_stop(stop, session_events_tx).await;
            }
            _ => {}
        }
        Ok(None)
    }

    async fn handle_start(
        &mut self,
        start: StartExternalAccessoryProtocolSession,
        link_command_tx: &mpsc::Sender<Iap2Command>,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) -> Result<()> {
        if self.streams.contains_key(&start.session_id) {
            tracing::warn!(
        stream_id = start.session_id,
        "iap2 ea: StartExternalAccessoryProtocolSession for a stream id already open; refusing"
      );
            send_csm(
                StatusExternalAccessoryProtocolSession {
                    session_id: start.session_id,
                    status: EaSessionStatus::Close,
                },
                link_command_tx,
            )
            .await?;
            return Ok(());
        }

        let (inbound_tx, inbound_rx) = mpsc::channel(STREAM_INBOUND_CAPACITY);
        self.streams.insert(start.session_id, inbound_tx);

        send_csm(
            StatusExternalAccessoryProtocolSession {
                session_id: start.session_id,
                status: EaSessionStatus::Ok,
            },
            link_command_tx,
        )
        .await?;
        tracing::info!(
            stream_id = start.session_id,
            protocol_id = start.protocol_id,
            "iap2 ea: stream opened"
        );

        emit(
            session_events_tx,
            SessionEvent::EaStreamOpened {
                stream_id: start.session_id,
                protocol_id: start.protocol_id,
                inbound_rx,
                outbound: self.chunker.sender(start.session_id),
            },
        )
        .await;
        Ok(())
    }

    async fn handle_stop(
        &mut self,
        stop: StopExternalAccessoryProtocolSession,
        session_events_tx: &mpsc::Sender<SessionEvent>,
    ) {
        if self.streams.remove(&stop.session_id).is_some() {
            tracing::info!(
                stream_id = stop.session_id,
                "iap2 ea: stream closed by peer"
            );
            emit(
                session_events_tx,
                SessionEvent::EaStreamClosed {
                    stream_id: stop.session_id,
                },
            )
            .await;
        }
    }

    /// Strip the leading u16-BE EA-stream-id from a session_id=3 link
    /// payload and route the rest to the matching per-stream inbound
    /// channel. Drops chunks for stream ids we don't know about.
    pub(super) async fn dispatch_link_data(&mut self, payload: Bytes) {
        let Some((stream_id, chunk)) = split_stream_frame(&payload) else {
            tracing::warn!(
                len = payload.len(),
                "iap2 ea: link payload too short for stream-id prefix"
            );
            return;
        };
        let Some(state) = self.streams.get(&stream_id) else {
            tracing::trace!(stream_id, "iap2 ea: link payload for unknown stream id");
            return;
        };
        if state.send(chunk).await.is_err() {
            tracing::debug!(
                stream_id,
                "iap2 ea: inbound consumer dropped; closing stream"
            );
            self.streams.remove(&stream_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use bytes::BytesMut;

    use super::*;
    use crate::{frame::Lsp, session::ea_transport::EA_LINK_SESSION_ID};

    #[tokio::test]
    async fn flow_handles_start_stop_lifecycle() {
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let (events_tx, mut events_rx) = mpsc::channel(64);
        let lsp = Lsp::accessory_default();
        let mut flow = EaFlow::new(link_tx.clone(), lsp.max_len);

        let start_frame: CsmFrame = StartExternalAccessoryProtocolSession {
            protocol_id: 1,
            session_id: 0x0100,
        }
        .into();
        flow.handle(start_frame, &link_tx, &events_tx)
            .await
            .unwrap();

        let event = events_rx.recv().await.unwrap();
        let opened_outbound = match event {
            SessionEvent::EaStreamOpened {
                stream_id,
                protocol_id,
                outbound,
                ..
            } => {
                assert_eq!(stream_id, 0x0100);
                assert_eq!(protocol_id, 1);
                outbound
            }
            other => panic!("unexpected event: {other:?}"),
        };

        let status_cmd = link_rx.recv().await.unwrap();
        let Iap2Command::Send {
            session_id: status_session,
            ..
        } = status_cmd
        else {
            panic!("expected Send for status reply");
        };
        assert_eq!(
            status_session, 1,
            "status reply rides the control session, not the EA session"
        );

        opened_outbound
            .send(
                crate::session::EaPriority::Normal,
                Bytes::from_static(&[0xCA, 0xFE]),
            )
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        let chunk_cmd = link_rx.recv().await.unwrap();
        let Iap2Command::Send {
            session_id: ea_session,
            payload,
        } = chunk_cmd
        else {
            panic!("expected Send for EA chunk");
        };
        assert_eq!(ea_session, EA_LINK_SESSION_ID);
        assert_eq!(u16::from_be_bytes([payload[0], payload[1]]), 0x0100);
        assert_eq!(&payload[2..], &[0xCA, 0xFE]);

        let stop_frame: CsmFrame =
            StopExternalAccessoryProtocolSession { session_id: 0x0100 }.into();
        flow.handle(stop_frame, &link_tx, &events_tx).await.unwrap();
        let event = events_rx.recv().await.unwrap();
        assert!(matches!(
            event,
            SessionEvent::EaStreamClosed { stream_id: 0x0100 }
        ));
    }

    #[tokio::test]
    async fn dispatch_routes_inbound_payload_into_stream_channel() {
        let (link_tx, _link_rx) = mpsc::channel(64);
        let (events_tx, mut events_rx) = mpsc::channel(64);
        let mut flow = EaFlow::new(link_tx.clone(), Lsp::accessory_default().max_len);

        let start_frame: CsmFrame = StartExternalAccessoryProtocolSession {
            protocol_id: 1,
            session_id: 0x0100,
        }
        .into();
        flow.handle(start_frame, &link_tx, &events_tx)
            .await
            .unwrap();

        let mut inbound_rx = match events_rx.recv().await.unwrap() {
            SessionEvent::EaStreamOpened { inbound_rx, .. } => inbound_rx,
            other => panic!("unexpected event: {other:?}"),
        };

        let mut wire = BytesMut::new();
        wire.extend_from_slice(&0x0100u16.to_be_bytes());
        wire.extend_from_slice(&[0xDE, 0xAD]);
        flow.dispatch_link_data(wire.freeze()).await;

        let chunk = inbound_rx.recv().await.unwrap();
        assert_eq!(&chunk[..], &[0xDE, 0xAD]);
    }

    #[tokio::test]
    async fn ensure_app_launch_is_idempotent() {
        let (link_tx, mut link_rx) = mpsc::channel(64);
        let mut flow = EaFlow::new(link_tx.clone(), Lsp::accessory_default().max_len);

        flow.ensure_app_launch_requested("com.iap2-rs.gateway", &link_tx)
            .await
            .unwrap();
        flow.ensure_app_launch_requested("com.iap2-rs.gateway", &link_tx)
            .await
            .unwrap();

        let mut launches = 0;
        while let Ok(cmd) = link_rx.try_recv() {
            if matches!(cmd, Iap2Command::Send { session_id: 1, .. }) {
                launches += 1;
            }
        }
        assert_eq!(launches, 1, "RequestAppLaunch sent exactly once");
    }
}
