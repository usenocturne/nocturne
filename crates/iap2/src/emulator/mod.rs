//! Device-half (iPhone-side) iAP2 emulator for over-air testing.
//!
//! Drives a real accessory through the iAP2 lifecycle the way an iPhone
//! does: the device-role link ([`Link::run_device`]) completes the
//! handshake, then this scripted session driver walks authentication,
//! identification, the NowPlaying / artwork pushes, HID enablement, and
//! the External Accessory gateway stream. It consumes [`Iap2Event`] from
//! the link and emits [`Iap2Command::Send`] back, exactly mirroring
//! [`crate::session::Iap2Session`] one role over.
//!
//! No MFi anywhere: the emulator issues the auth challenge and accepts
//! whatever the accessory's real coprocessor signs without validating
//! against Apple's CA (it is the device side, and cannot validate). This
//! matches the test-harness "no MFi stubbing" posture - real chip on the
//! accessory, no fake on either side.
//!
//! [`Link::run_device`]: crate::Link::run_device

mod ea;

use bytes::{Bytes, BytesMut};
use ea::DeviceEaFlow;
pub use ea::DeviceEaStream;
use tokio::sync::mpsc;
use tokio_util::codec::{Decoder, Encoder};

use crate::{
    csm::{
        auth::{
            AuthenticationCertificate, AuthenticationResponse, AuthenticationSucceeded,
            RequestAuthenticationCertificate, RequestAuthenticationChallengeResponse,
        },
        device::{
            DeviceInformationUpdate, DeviceLanguageUpdate, DeviceTimeUpdate, DeviceUUIDUpdate,
        },
        external_accessory::{RequestAppLaunch, StatusExternalAccessoryProtocolSession},
        hid::{HIDComponentUpdate, StartHID, StartNativeHID},
        identification::{
            parse_ea_protocols, EaProtocol, IdentificationAccepted, IdentificationInformation,
            StartIdentification,
        },
        now_playing::{
            MediaItemAttributes, NowPlayingUpdate, PlaybackAttributes, PlaybackState,
            StartNowPlayingUpdates,
        },
        CsmCodec, CsmFrame,
    },
    error::{Error, Result},
    link::{Iap2Command, Iap2Event},
    session::{DeviceFileTransfer, EA_LINK_SESSION_ID},
};

/// iAP2 control-session id, matching [`crate::session`]'s constant and
/// the session triple the accessory declares in its LSP.
const CONTROL_SESSION_ID: u8 = 1;

/// File Transfer link session id, matching the accessory's LSP triple
/// `{ id: 2, type: 1 }`. Outbound artwork SetupAck / CompleteAck land here.
const FILE_TRANSFER_SESSION_ID: u8 = 2;

/// Challenge length the emulator issues in
/// `RequestAuthenticationChallengeResponse`. Arbitrary bytes; the
/// accessory's CP3.0 chip signs whatever we send and we never validate it.
const CHALLENGE_LEN: usize = 32;

/// Device-side milestones the emulator surfaces for tests and logging,
/// mirroring the accessory's [`crate::SessionEvent`] stream from the
/// device side.
#[derive(Debug)]
pub enum EmulatorEvent {
    LinkEstablished,
    Authenticated,
    Identified,
    ArtworkSent(u8),
    /// An EA gateway stream opened, carrying the byte channels a consumer
    /// drives on top.
    EaStreamOpened(DeviceEaStream),
    LinkDown(String),
}

/// Runtime drive commands the emulator's control session applies as they
/// arrive, the way an iPhone pushes a track change then its cover art a
/// beat later. Delivered through [`DeviceEmulatorHandle`].
#[derive(Debug)]
enum EmulatorCommand {
    PushNowPlaying(Box<NowPlayingUpdate>),
    PushArtwork { transfer_id: u8, bytes: Bytes },
}

/// Drives the emulator's control session at runtime: push NowPlaying
/// deltas and artwork transfers on demand, sequenced by a scenario the
/// same way it sequences `inject_iap2` events in-process. Obtained from
/// [`DeviceEmulator::handle`] before `run` consumes the emulator.
#[derive(Clone)]
pub struct DeviceEmulatorHandle {
    commands: mpsc::Sender<EmulatorCommand>,
}

impl DeviceEmulatorHandle {
    /// Push a NowPlaying delta to the subscribed accessory.
    pub async fn push_now_playing(&self, update: NowPlayingUpdate) -> Result<()> {
        self.commands
            .send(EmulatorCommand::PushNowPlaying(Box::new(update)))
            .await
            .map_err(|_| Error::LinkClosed)
    }

    /// Deliver artwork bytes over File Transfer for `transfer_id`, as the
    /// iPhone does after a NowPlaying delta carrying that id.
    pub async fn push_artwork(&self, transfer_id: u8, bytes: Bytes) -> Result<()> {
        self.commands
            .send(EmulatorCommand::PushArtwork { transfer_id, bytes })
            .await
            .map_err(|_| Error::LinkClosed)
    }
}

/// Scripted device-half session. Construct with the device-role link's
/// command/event channels plus an observation channel, then `run()`.
/// [`DeviceEmulator::with_now_playing`] / [`DeviceEmulator::with_artwork`]
/// script the media surface the accessory observes.
pub struct DeviceEmulator {
    link_command_tx: mpsc::Sender<Iap2Command>,
    link_events_rx: mpsc::Receiver<Iap2Event>,
    events_tx: mpsc::Sender<EmulatorEvent>,
    challenge: Bytes,
    now_playing: Option<NowPlayingUpdate>,
    artwork: Option<(u8, Bytes)>,
    file_transfer: Option<DeviceFileTransfer>,
    ea: Option<DeviceEaFlow>,
    ea_protocols: Vec<EaProtocol>,
    now_playing_pushed: bool,
    command_tx: mpsc::Sender<EmulatorCommand>,
    command_rx: mpsc::Receiver<EmulatorCommand>,
}

impl DeviceEmulator {
    pub fn new(
        link_command_tx: mpsc::Sender<Iap2Command>,
        link_events_rx: mpsc::Receiver<Iap2Event>,
        events_tx: mpsc::Sender<EmulatorEvent>,
    ) -> Self {
        let (command_tx, command_rx) = mpsc::channel(32);
        Self {
            link_command_tx,
            link_events_rx,
            events_tx,
            challenge: Bytes::from_static(&[0x5A; CHALLENGE_LEN]),
            now_playing: Some(default_now_playing()),
            artwork: None,
            file_transfer: None,
            ea: None,
            ea_protocols: Vec::new(),
            now_playing_pushed: false,
            command_tx,
            command_rx,
        }
    }

    /// A runtime drive handle for this emulator. Clone-able; sends keep
    /// working until the link drops. Take it before `run` consumes self.
    pub fn handle(&self) -> DeviceEmulatorHandle {
        DeviceEmulatorHandle {
            commands: self.command_tx.clone(),
        }
    }

    /// Replace the canned NowPlaying delta the emulator pushes when the
    /// accessory subscribes.
    pub fn with_now_playing(mut self, update: NowPlayingUpdate) -> Self {
        self.now_playing = Some(update);
        self
    }

    /// Suppress the subscribe-time canned push so a scenario drives every
    /// delta through [`DeviceEmulatorHandle`], matching in-process
    /// `inject_iap2` semantics where nothing arrives unsolicited.
    pub fn without_now_playing(mut self) -> Self {
        self.now_playing = None;
        self
    }

    /// Script an artwork blob delivered over File Transfer once the
    /// accessory subscribes. Patches the canned NowPlaying delta so its
    /// `artwork_id` references the same transfer id, as the real iPhone does.
    pub fn with_artwork(mut self, transfer_id: u8, bytes: Bytes) -> Self {
        self.artwork = Some((transfer_id, bytes));
        let media = self
            .now_playing
            .get_or_insert_with(default_now_playing)
            .media_item
            .get_or_insert_with(MediaItemAttributes::default);
        media.artwork_id = Some(transfer_id);
        self
    }

    pub async fn run(mut self) -> Result<()> {
        let mut control_buf = BytesMut::new();

        loop {
            while let Some(frame) = CsmCodec.decode(&mut control_buf)? {
                self.handle_csm(frame).await?;
            }

            // The command channel never closes (the emulator holds a sender for
            // `handle`), so its arm only fires on an actual drive command; field
            // borrows are scoped to the select so the arms can reborrow self.
            let wake = {
                let link_events = &mut self.link_events_rx;
                let commands = &mut self.command_rx;
                tokio::select! {
                  event = link_events.recv() => Wake::Link(event),
                  command = commands.recv() => Wake::Command(command),
                }
            };

            match wake {
                Wake::Link(Some(Iap2Event::Established(lsp))) => {
                    tracing::info!("emulator: link established; requesting accessory certificate");
                    self.file_transfer = Some(DeviceFileTransfer::new(
                        self.link_command_tx.clone(),
                        lsp.max_len,
                    ));
                    self.ea = Some(DeviceEaFlow::new(self.link_command_tx.clone(), lsp.max_len));
                    emit(&self.events_tx, EmulatorEvent::LinkEstablished).await;
                    self.send_csm(RequestAuthenticationCertificate).await?;
                }
                Wake::Link(Some(Iap2Event::DataReceived {
                    session_id,
                    payload,
                })) => match session_id {
                    CONTROL_SESSION_ID => control_buf.extend_from_slice(&payload),
                    FILE_TRANSFER_SESSION_ID => self.handle_file_transfer_data(payload).await?,
                    EA_LINK_SESSION_ID => {
                        if let Some(ea) = self.ea.as_mut() {
                            ea.dispatch_link_data(payload).await;
                        }
                    }
                    other => tracing::trace!(
                        session_id = other,
                        "emulator: ignoring data on unhandled session"
                    ),
                },
                Wake::Link(Some(Iap2Event::LinkDown(reason))) => {
                    tracing::info!(reason = %reason, "emulator: link down");
                    emit(&self.events_tx, EmulatorEvent::LinkDown(reason)).await;
                    return Ok(());
                }
                Wake::Link(None) => {
                    tracing::debug!("emulator: link events channel closed");
                    return Ok(());
                }
                Wake::Command(Some(command)) => self.handle_command(command).await?,
                Wake::Command(None) => unreachable!("emulator retains a command sender via handle"),
            }
        }
    }

    async fn handle_csm(&mut self, frame: CsmFrame) -> Result<()> {
        match frame.msg_id {
            AuthenticationCertificate::CSM_MSG_ID => {
                tracing::debug!(
                    "emulator: got accessory certificate; issuing challenge (no CA validation)"
                );
                self.send_csm(RequestAuthenticationChallengeResponse {
                    challenge: self.challenge.clone(),
                })
                .await?;
            }
            AuthenticationResponse::CSM_MSG_ID => {
                tracing::info!(
                    "emulator: accepting signed challenge response; authentication succeeded"
                );
                self.send_csm(AuthenticationSucceeded).await?;
                emit(&self.events_tx, EmulatorEvent::Authenticated).await;
                self.send_csm(StartIdentification).await?;
            }
            IdentificationInformation::CSM_MSG_ID => {
                match parse_ea_protocols(&frame) {
                    Ok(protocols) => self.ea_protocols = protocols,
                    Err(err) => {
                        tracing::warn!(?err, "emulator: failed to parse accessory EA protocols")
                    }
                }
                tracing::info!("emulator: accepting accessory identification");
                self.send_csm(IdentificationAccepted).await?;
                emit(&self.events_tx, EmulatorEvent::Identified).await;
                self.push_device_metadata().await?;
            }
            StartNowPlayingUpdates::CSM_MSG_ID => {
                self.push_now_playing().await?;
            }
            RequestAppLaunch::CSM_MSG_ID => {
                let request = RequestAppLaunch::try_from(frame)?;
                self.open_ea_stream(&request.bundle_id).await?;
            }
            StatusExternalAccessoryProtocolSession::CSM_MSG_ID => {
                let status = StatusExternalAccessoryProtocolSession::try_from(frame)?;
                if let Some(ea) = self.ea.as_mut() {
                    ea.handle_status(status);
                }
            }
            StartHID::CSM_MSG_ID => {
                let start = StartHID::try_from(frame)?;
                tracing::debug!(
                    component_id = start.component_id,
                    "emulator: enabling accessory HID"
                );
                self.send_csm(HIDComponentUpdate {
                    component_id: start.component_id,
                    component_enabled: true,
                })
                .await?;
                self.send_csm(StartNativeHID).await?;
            }
            other => {
                tracing::trace!(msg_id = format!("{other:#06x}"), "emulator: unhandled CSM");
            }
        }
        Ok(())
    }

    /// Push the canned NowPlaying delta once the accessory subscribes,
    /// then kick off the artwork transfer if one is scripted. A scenario in
    /// driven mode ([`DeviceEmulator::without_now_playing`]) sends nothing
    /// here and sequences deltas through [`DeviceEmulatorHandle`] instead.
    async fn push_now_playing(&mut self) -> Result<()> {
        if self.now_playing_pushed {
            return Ok(());
        }
        self.now_playing_pushed = true;
        let Some(update) = self.now_playing.clone() else {
            tracing::debug!(
                "emulator: accessory subscribed; no canned NowPlaying, awaiting driven pushes"
            );
            return Ok(());
        };
        tracing::info!("emulator: accessory subscribed; pushing NowPlaying delta");
        self.send_csm(update).await?;

        if let (Some((transfer_id, bytes)), Some(ft)) =
            (self.artwork.clone(), self.file_transfer.as_mut())
        {
            ft.begin_artwork(transfer_id, bytes).await?;
        }
        Ok(())
    }

    /// Apply a runtime drive command from [`DeviceEmulatorHandle`].
    async fn handle_command(&mut self, command: EmulatorCommand) -> Result<()> {
        match command {
            EmulatorCommand::PushNowPlaying(update) => {
                tracing::info!("emulator: driving NowPlaying delta");
                self.send_csm(*update).await?;
            }
            EmulatorCommand::PushArtwork { transfer_id, bytes } => {
                match self.file_transfer.as_mut() {
                    Some(ft) => {
                        tracing::info!(transfer_id, "emulator: driving artwork transfer");
                        ft.begin_artwork(transfer_id, bytes).await?;
                    }
                    None => {
                        tracing::warn!("emulator: artwork push before link established; dropping")
                    }
                }
            }
        }
        Ok(())
    }

    /// Push the device-metadata CSMs an iPhone sends unsolicited right
    /// after `IdentificationAccepted` (subscribe-by-listing on param 7):
    /// device name, language, wall clock (host's current time), stable UUID.
    async fn push_device_metadata(&self) -> Result<()> {
        self.send_csm(DeviceInformationUpdate {
            device_name: "Emulated iPhone".into(),
        })
        .await?;
        self.send_csm(DeviceLanguageUpdate {
            language: "en".into(),
        })
        .await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        self.send_csm(DeviceTimeUpdate {
            seconds_since_reference_date: now,
            tz_offset_minutes: 0,
            dst_offset_minutes: 0,
        })
        .await?;
        self.send_csm(DeviceUUIDUpdate {
            uuid: "00000000-0000-4000-8000-000000000000".into(),
        })
        .await?;
        Ok(())
    }

    /// Emulate the companion app opening its EA session: map the bundle id
    /// to the protocol the accessory declared, send
    /// `StartExternalAccessoryProtocolSession`, surface the stream's channels.
    async fn open_ea_stream(&mut self, bundle_id: &str) -> Result<()> {
        let Some(protocol_id) = self
            .ea_protocols
            .iter()
            .find(|p| p.name == bundle_id)
            .map(|p| p.id)
        else {
            tracing::warn!(bundle = %bundle_id, "emulator: RequestAppLaunch for an undeclared EA protocol; ignoring");
            return Ok(());
        };
        let Some(ea) = self.ea.as_mut() else {
            return Ok(());
        };
        let (start, stream) = ea.open(protocol_id);
        tracing::info!(bundle = %bundle_id, protocol_id, stream_id = stream.stream_id, "emulator: opening EA gateway stream");
        self.send_csm(start).await?;
        emit(&self.events_tx, EmulatorEvent::EaStreamOpened(stream)).await;
        Ok(())
    }

    async fn handle_file_transfer_data(&mut self, payload: Bytes) -> Result<()> {
        let Some(ft) = self.file_transfer.as_mut() else {
            return Ok(());
        };
        if let Some(transfer_id) = ft.on_link_data(payload).await? {
            emit(&self.events_tx, EmulatorEvent::ArtworkSent(transfer_id)).await;
        }
        Ok(())
    }

    async fn send_csm<F: Into<CsmFrame>>(&self, csm: F) -> Result<()> {
        let mut buf = BytesMut::new();
        CsmCodec.encode(csm.into(), &mut buf)?;
        self.link_command_tx
            .send(Iap2Command::Send {
                session_id: CONTROL_SESSION_ID,
                payload: buf.freeze(),
            })
            .await
            .map_err(|_| Error::LinkClosed)?;
        Ok(())
    }
}

/// Canned NowPlaying delta so a default emulator drives a realistic
/// subscribe response. Override via [`DeviceEmulator::with_now_playing`].
fn default_now_playing() -> NowPlayingUpdate {
    NowPlayingUpdate {
        media_item: Some(MediaItemAttributes {
            persistent_id: Some(0x0A0B_0C0D_0E0F_1011),
            title: Some("Side of Town".into()),
            album: Some("Capital Soiree".into()),
            artist: Some("Saint Blonde".into()),
            duration_ms: Some(212_000),
            ..MediaItemAttributes::default()
        }),
        playback: Some(PlaybackAttributes {
            state: Some(PlaybackState::Playing),
            position_ms: Some(41_250),
            set_elapsed_time_available: Some(true),
            app_bundle: Some("com.spotify.client".into()),
            ..PlaybackAttributes::default()
        }),
    }
}

/// One iteration's wake source: a link event or a runtime drive command.
enum Wake {
    Link(Option<Iap2Event>),
    Command(Option<EmulatorCommand>),
}

async fn emit(tx: &mpsc::Sender<EmulatorEvent>, event: EmulatorEvent) {
    if tx.send(event).await.is_err() {
        tracing::debug!("emulator: events receiver dropped");
    }
}
