//! The runtime drive surface: with the subscribe-time canned push
//! suppressed (`without_now_playing`), a `DeviceEmulatorHandle` sequences
//! a NowPlaying delta and an artwork transfer on demand. The accessory's
//! own `SessionEvent` stream must emit exactly the driven delta (carrying
//! the paired artwork id) and the artwork bytes, in order - proving the
//! handle drives the control session the same way `inject_iap2` does
//! in-process.

#![cfg(feature = "emulator")]

mod emu;

use std::time::Duration;

use bytes::Bytes;
use emu::recv_with_timeout;
use iap2_rs::{
    csm::now_playing::{MediaItemAttributes, NowPlayingUpdate},
    EmulatorEvent, SessionEvent,
};

#[tokio::test]
async fn emulator_handle_drives_now_playing_and_artwork() {
    // Larger than one accessory link packet (max_len 2048) so the transfer
    // chunks into FirstData/Data/LastData.
    let artwork = Bytes::from(vec![0x5Eu8; 5000]);
    let (mut harness, mut emu_events, handle) =
        emu::spawn(emu::identification_config(), None, |emulator| {
            emulator.without_now_playing()
        });

    // Drive only after identification so the control session and file
    // transfer are up; nothing was pushed unsolicited.
    loop {
        match recv_with_timeout(&mut emu_events, Duration::from_secs(10)).await {
            Some(EmulatorEvent::Identified) => break,
            Some(_) => continue,
            None => panic!("emulator exited before identification"),
        }
    }

    handle
        .push_now_playing(NowPlayingUpdate {
            media_item: Some(MediaItemAttributes {
                persistent_id: Some(0xBEEF),
                title: Some("Driven Track".into()),
                artwork_id: Some(200),
                ..Default::default()
            }),
            playback: None,
        })
        .await
        .expect("drive now-playing");
    handle
        .push_artwork(200, artwork.clone())
        .await
        .expect("drive artwork");

    let mut saw_now_playing = false;
    loop {
        let evt = recv_with_timeout(&mut harness.acc_events, Duration::from_secs(10))
            .await
            .expect("accessory event timed out before driven artwork");
        match evt {
            SessionEvent::NowPlayingUpdate(update) => {
                let media = update.media_item.expect("media_item group present");
                if media.title.as_deref() == Some("Driven Track") {
                    assert_eq!(
                        media.artwork_id,
                        Some(200),
                        "driven art id pairs with the transfer id"
                    );
                    saw_now_playing = true;
                }
            }
            SessionEvent::ArtworkBytes { transfer_id, bytes } => {
                assert!(
                    saw_now_playing,
                    "driven NowPlaying delta must precede the artwork bytes"
                );
                assert_eq!(transfer_id, 200);
                assert_eq!(bytes.len(), artwork.len());
                assert!(
                    bytes.iter().all(|&b| b == 0x5E),
                    "driven artwork bytes round-trip intact"
                );
                return;
            }
            _ => continue,
        }
    }
}
