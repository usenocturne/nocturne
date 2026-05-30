//! Integration tests for the MFi auth driver against the in-memory mock.

use std::time::Duration;

use iap2_mfi::{Error, MfiAuth, MockTransport, CHALLENGE_LEN, RESPONSE_LEN, SERIAL_LEN};

const TEST_CERT: &[u8] = &[0x30, 0x82, 0x02, 0x80, 0xDE, 0xAD, 0xBE, 0xEF];
const TEST_SERIAL: [u8; SERIAL_LEN] = [
    0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF, 0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE,
    0xFE, 0xDC, 0xBA, 0x98, 0x76, 0x54, 0x32, 0x10, 0xEF, 0xCD, 0xAB, 0x89, 0x67, 0x45, 0x23, 0x01,
];
const TEST_CHALLENGE: [u8; CHALLENGE_LEN] = [0xAA; CHALLENGE_LEN];
const TEST_RESPONSE: [u8; RESPONSE_LEN] = [0xBB; RESPONSE_LEN];

fn fixture() -> (MockTransport, MfiAuth<MockTransport>) {
    let mock = MockTransport::new();
    mock.set_register(0x00, vec![0x07]); // version
    mock.set_register(0x05, vec![0x00]); // last error
    mock.set_register(0x10, vec![0x00]); // status (idle)
    mock.set_cert(TEST_CERT.to_vec());
    mock.set_serial(TEST_SERIAL.to_vec());
    mock.set_response(TEST_RESPONSE.to_vec());
    let auth = MfiAuth::with_transport(mock.clone());
    (mock, auth)
}

#[test]
fn version_round_trip() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.version().unwrap(), 0x07);
}

#[test]
fn last_error_round_trip() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.last_error().unwrap(), 0x00);
}

#[test]
fn status_idle_round_trip() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.status().unwrap(), 0x00);
}

#[test]
fn cert_len_returns_chip_value() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.cert_len().unwrap(), TEST_CERT.len() as u16);
}

#[test]
fn cert_reads_full_payload() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.cert().unwrap(), TEST_CERT);
}

#[test]
fn cert_into_writes_to_buffer() {
    let (_, mut auth) = fixture();
    let mut buf = vec![0u8; 16];
    let written = auth.cert_into(&mut buf).unwrap();
    assert_eq!(written, TEST_CERT.len());
    assert_eq!(&buf[..written], TEST_CERT);
}

#[test]
fn cert_into_errors_on_short_buffer() {
    let (_, mut auth) = fixture();
    let mut buf = vec![0u8; 2];
    match auth.cert_into(&mut buf) {
        Err(Error::BufferTooSmall { need, got }) => {
            assert_eq!(need, TEST_CERT.len());
            assert_eq!(got, 2);
        }
        other => panic!("expected BufferTooSmall, got {:?}", other),
    }
}

#[test]
fn cert_settles_before_reading_payload() {
    let (mock, mut auth) = fixture();
    let _ = auth.cert().unwrap();
    let sleeps = mock.shared().borrow().sleeps.clone();
    let settles = sleeps
        .iter()
        .filter(|d| **d == Duration::from_millis(10))
        .count();
    assert_eq!(
        settles, 2,
        "expected one 10ms settle each before cert_len and cert reads, saw {:?}",
        sleeps
    );
}

#[test]
fn serial_returns_full_register() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.serial().unwrap(), TEST_SERIAL);
}

#[test]
fn sign_happy_path_returns_response() {
    let (_, mut auth) = fixture();
    assert_eq!(auth.sign(&TEST_CHALLENGE).unwrap(), TEST_RESPONSE);
}

#[test]
fn sign_writes_challenge_to_chip() {
    let (mock, mut auth) = fixture();
    let _ = auth.sign(&TEST_CHALLENGE).unwrap();
    let stored = mock
        .shared()
        .borrow()
        .registers
        .get(&0x21)
        .cloned()
        .unwrap();
    assert_eq!(stored, TEST_CHALLENGE.to_vec());
}

#[test]
fn sign_observes_500ms_poll_delay() {
    let (mock, mut auth) = fixture();
    let _ = auth.sign(&TEST_CHALLENGE).unwrap();
    let shared = mock.shared();
    let state = shared.borrow();
    assert!(
        state
            .sleeps
            .iter()
            .any(|d| *d == Duration::from_millis(500)),
        "expected 500ms sign poll delay, saw {:?}",
        state.sleeps
    );
}

#[test]
fn sign_rejects_wrong_challenge_echo() {
    let (mock, mut auth) = fixture();
    mock.set_challenge_echo(31);
    match auth.sign(&TEST_CHALLENGE) {
        Err(Error::UnexpectedChallengeLen { got, expected }) => {
            assert_eq!(got, 31);
            assert_eq!(expected, 32);
        }
        other => panic!("expected UnexpectedChallengeLen, got {:?}", other),
    }
}

#[test]
fn sign_errors_when_status_not_ready() {
    let (mock, mut auth) = fixture();
    mock.set_status_after_trigger(0x00);
    match auth.sign(&TEST_CHALLENGE) {
        Err(Error::SignNotReady { status }) => assert_eq!(status, 0x00),
        other => panic!("expected SignNotReady, got {:?}", other),
    }
}

#[test]
fn retry_swallows_chip_asleep_naks() {
    let (mock, mut auth) = fixture();
    mock.set_asleep(2);
    assert_eq!(auth.version().unwrap(), 0x07);
}

#[test]
fn retry_gives_up_after_too_many_naks() {
    let (mock, mut auth) = fixture();
    mock.set_asleep(99);
    match auth.version() {
        Err(Error::Transport(_)) => {}
        other => panic!("expected transport error, got {:?}", other),
    }
}
