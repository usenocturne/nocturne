//! Slices 2-3 proof: the device emulator drives a real accessory
//! [`Iap2Session`] through MFi authentication and identification over an
//! in-process duplex. The assertion is on the accessory's own event
//! stream - it must emit `Authenticated` then `Identified`, proving the
//! emulator's AA00/AA02/AA05 + 1D00/1D02 sequence is wire-correct.

#![cfg(feature = "emulator")]

mod emu;

use std::time::Duration;

use emu::recv_with_timeout;
use iap2_rs::SessionEvent;

#[tokio::test]
async fn emulator_drives_accessory_to_identified() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_test_writer()
        .try_init();

    let (mut harness, _emu_events, _emu_handle) =
        emu::spawn(emu::identification_config(), None, |e| e);

    // The accessory must reach Identified (through Authenticated), driven
    // entirely by the emulator's AA00/AA02/AA05 + 1D00/1D02 sequence.
    let mut authenticated = false;
    loop {
        let evt = recv_with_timeout(&mut harness.acc_events, Duration::from_secs(10))
            .await
            .expect("accessory event timed out or closed before Identified");
        match evt {
            SessionEvent::LinkEstablished(_) => continue,
            SessionEvent::Authenticated => authenticated = true,
            SessionEvent::Identified => {
                assert!(
                    authenticated,
                    "accessory must authenticate before identifying"
                );
                return;
            }
            other => panic!("expected the auth->ident chain, got {other:?}"),
        }
    }
}
