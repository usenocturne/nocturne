//! Slice 4 proof: after identification the emulator pushes a NowPlaying
//! delta and an artwork blob over File Transfer, and enables HID. The
//! accessory's own `SessionEvent` stream must emit `NowPlayingUpdate`
//! (carrying the paired artwork id) and `ArtworkBytes` with the exact
//! blob - proving the device-side NowPlaying encoder and the File
//! Transfer sender (including multi-packet chunking) are wire-correct.

#![cfg(feature = "emulator")]

mod emu;

use std::time::Duration;

use bytes::Bytes;
use emu::recv_with_timeout;
use iap2_rs::SessionEvent;

#[tokio::test]
async fn emulator_pushes_now_playing_and_artwork() {
    // Larger than one link packet (accessory max_len 2048) so the file
    // transfer must chunk into FirstData/Data/LastData.
    let artwork = Bytes::from(vec![0x7Au8; 5000]);
    let (mut harness, _emu_events, _emu_handle) = emu::spawn(emu::identification_config(), None, {
        let artwork = artwork.clone();
        move |emulator| emulator.with_artwork(129, artwork)
    });

    let mut saw_now_playing = false;
    let mut saw_device_time = false;
    loop {
        let evt = recv_with_timeout(&mut harness.acc_events, Duration::from_secs(10))
            .await
            .expect("accessory event timed out before artwork");
        match evt {
            SessionEvent::DeviceTime(_) => saw_device_time = true,
            SessionEvent::NowPlayingUpdate(update) => {
                let media = update.media_item.expect("media_item group present");
                assert_eq!(media.title.as_deref(), Some("Side of Town"));
                assert_eq!(
                    media.artwork_id,
                    Some(129),
                    "NowPlaying art id pairs with the transfer id"
                );
                saw_now_playing = true;
            }
            SessionEvent::ArtworkBytes { transfer_id, bytes } => {
                assert!(
                    saw_now_playing,
                    "NowPlaying delta must precede the artwork bytes"
                );
                assert!(
                    saw_device_time,
                    "device metadata (DeviceTime) pushed after identification"
                );
                assert_eq!(transfer_id, 129);
                assert_eq!(bytes.len(), artwork.len());
                assert!(
                    bytes.iter().all(|&b| b == 0x7A),
                    "artwork bytes round-trip intact"
                );
                return;
            }
            _ => continue,
        }
    }
}
