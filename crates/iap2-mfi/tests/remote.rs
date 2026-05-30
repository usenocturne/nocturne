//! End-to-end test of the remote-i²c wire protocol.
//!
//! Spins up a TCP listener on a loopback port, runs `serve` against a
//! seeded [`MockTransport`] in a worker thread, and drives an
//! [`MfiAuth<RemoteI2c>`] from the main thread. Exercises the full
//! request/response shape for every wire op.

use std::{net::TcpListener, thread};

use iap2_mfi::{
    serve_remote, Error, MfiAuth, MockTransport, RemoteI2c, CHALLENGE_LEN, RESPONSE_LEN, SERIAL_LEN,
};

const TEST_CERT: &[u8] = &[
    0x30, 0x82, 0x02, 0x80, 0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE,
];
const TEST_SERIAL: [u8; SERIAL_LEN] = [
    0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE,
    0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10, 0xEF, 0xCD, 0xAB, 0x89, 0x67, 0x45, 0x23, 0x01,
];
const TEST_CHALLENGE: [u8; CHALLENGE_LEN] = [0xCC; CHALLENGE_LEN];
const TEST_RESPONSE: [u8; RESPONSE_LEN] = [0xDD; RESPONSE_LEN];

/// Spin up a single-shot proxy server bound to a loopback port. Returns
/// `(port, join_handle)`. The server seeds the mock with the standard
/// fixture and serves exactly one client.
fn spawn_proxy() -> (u16, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let mut mock = MockTransport::new();
        mock.set_register(0x00, vec![0x07]);
        mock.set_register(0x05, vec![0x00]);
        mock.set_register(0x10, vec![0x00]);
        mock.set_cert(TEST_CERT.to_vec());
        mock.set_serial(TEST_SERIAL.to_vec());
        mock.set_response(TEST_RESPONSE.to_vec());
        let (stream, _) = listener.accept().expect("accept loopback");
        serve_remote(stream, &mut mock).expect("serve");
    });
    (port, handle)
}

fn client(port: u16) -> MfiAuth<RemoteI2c> {
    let transport = RemoteI2c::connect(("127.0.0.1", port)).expect("connect");
    MfiAuth::with_transport(transport)
}

#[test]
fn version_round_trips_over_tcp() {
    let (port, handle) = spawn_proxy();
    let mut auth = client(port);
    assert_eq!(auth.version().unwrap(), 0x07);
    drop(auth);
    handle.join().unwrap();
}

#[test]
fn cert_read_round_trips_over_tcp() {
    let (port, handle) = spawn_proxy();
    let mut auth = client(port);
    assert_eq!(auth.cert().unwrap(), TEST_CERT);
    drop(auth);
    handle.join().unwrap();
}

#[test]
fn cert_into_round_trips_over_tcp() {
    let (port, handle) = spawn_proxy();
    let mut auth = client(port);
    let mut buf = vec![0u8; 64];
    let n = auth.cert_into(&mut buf).unwrap();
    assert_eq!(n, TEST_CERT.len());
    assert_eq!(&buf[..n], TEST_CERT);
    drop(auth);
    handle.join().unwrap();
}

#[test]
fn serial_round_trips_over_tcp() {
    let (port, handle) = spawn_proxy();
    let mut auth = client(port);
    assert_eq!(auth.serial().unwrap(), TEST_SERIAL);
    drop(auth);
    handle.join().unwrap();
}

#[test]
fn sign_round_trips_over_tcp() {
    let (port, handle) = spawn_proxy();
    let mut auth = client(port);
    assert_eq!(auth.sign(&TEST_CHALLENGE).unwrap(), TEST_RESPONSE);
    drop(auth);
    handle.join().unwrap();
}

#[test]
fn server_propagates_chip_errors() {
    // Build a server with no cert seeded so the cert read fails on the
    // device side; the client should see the error string surfaced as a
    // transport error.
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let mut mock = MockTransport::new();
        // No registers seeded - any read attempt errors at the mock level.
        let (stream, _) = listener.accept().expect("accept loopback");
        let _ = serve_remote(stream, &mut mock);
    });

    let mut auth = client(port);
    match auth.cert_len() {
        Err(Error::Transport(_)) => {}
        other => panic!("expected transport error, got {:?}", other),
    }
    drop(auth);
    handle.join().unwrap();
}
