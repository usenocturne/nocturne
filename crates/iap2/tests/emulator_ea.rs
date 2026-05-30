//! Slice (EA) proof: configured like the production daemon (declares the
//! gateway EA protocol + requests app launch), the accessory triggers the
//! emulator to open an External Accessory stream. The emulator discovers
//! the protocol id from the wire (identification param 10), opens the
//! stream, and raw bytes round-trip both directions through the real
//! accessory `EaFlow` chunker and the device-side transport - the byte
//! pipe a real gateway client rides on hardware.

#![cfg(feature = "emulator")]

mod emu;

use std::time::Duration;

use bytes::Bytes;
use emu::recv_with_timeout;
use iap2_rs::{
    csm::identification::{EaProtocol, EaProtocolMatchAction, IdentificationConfig},
    session::EaPriority,
    EmulatorEvent, SessionEvent,
};

const GATEWAY_BUNDLE: &str = "com.iap2-rs.gateway";
const GATEWAY_EA_PROTOCOL_ID: u8 = 1;

fn gateway_identification() -> IdentificationConfig {
    let mut ident = emu::identification_config();
    ident.supported_external_accessory_protocols = vec![EaProtocol {
        id: GATEWAY_EA_PROTOCOL_ID,
        name: GATEWAY_BUNDLE.into(),
        match_action: EaProtocolMatchAction::NoAlertAction,
        native_transport_component_identifier: None,
    }];
    ident
}

#[tokio::test]
async fn emulator_opens_ea_gateway_stream_and_round_trips_bytes() {
    let (mut harness, mut emu_events, _emu_handle) =
        emu::spawn(gateway_identification(), Some(GATEWAY_BUNDLE.into()), |e| e);

    // Accessory side of the stream, from the real EaFlow's own event.
    let (mut acc_inbound, acc_outbound) = loop {
        match recv_with_timeout(&mut harness.acc_events, Duration::from_secs(10))
            .await
            .expect("accessory event timed out before the EA stream opened")
        {
            SessionEvent::EaStreamOpened {
                protocol_id,
                inbound_rx,
                outbound,
                ..
            } => {
                assert_eq!(
                    protocol_id, GATEWAY_EA_PROTOCOL_ID,
                    "accessory opens the gateway protocol"
                );
                break (inbound_rx, outbound);
            }
            _ => continue,
        }
    };

    // Device side of the stream, surfaced by the emulator.
    let mut dev_stream = loop {
        match recv_with_timeout(&mut emu_events, Duration::from_secs(10))
            .await
            .expect("emulator event timed out before the EA stream opened")
        {
            EmulatorEvent::EaStreamOpened(stream) => break stream,
            _ => continue,
        }
    };
    assert_eq!(
        dev_stream.protocol_id, GATEWAY_EA_PROTOCOL_ID,
        "emulator discovered the protocol id from identification"
    );

    // Device -> accessory: rides the device chunker, the real link, and the
    // accessory's EaFlow reassembly.
    dev_stream
        .outbound
        .send(EaPriority::Normal, Bytes::from_static(b"hello accessory"))
        .await
        .unwrap();
    let got = recv_with_timeout(&mut acc_inbound, Duration::from_secs(5))
        .await
        .expect("accessory never received the device's gateway bytes");
    assert_eq!(&got[..], b"hello accessory");

    // Accessory -> device: the inverse path.
    acc_outbound
        .send(EaPriority::Normal, Bytes::from_static(b"hello device"))
        .await
        .unwrap();
    let got = recv_with_timeout(&mut dev_stream.inbound_rx, Duration::from_secs(5))
        .await
        .expect("device never received the accessory's gateway bytes");
    assert_eq!(&got[..], b"hello device");
}
