//! Controller queries that BlueZ does not expose with transport-level detail.
//! These distinguish LE links from simultaneous classic links so ANCS and the
//! legacy advertiser can coordinate their lifetimes.
//! Adapted from Bridgething under the MIT notice in `../../THIRD_PARTY_NOTICES.md`.

use std::{
    io,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
};

use bluer::{Adapter, Address};

const AF_BLUETOOTH: libc::c_int = 31;
const BTPROTO_HCI: libc::c_int = 1;
const HCI_CHANNEL_RAW: u16 = 0;
const HCIGETCONNLIST: libc::c_ulong = 0x800448d4;
const LE_LINK: u8 = 0x80;
const CONN_LIST_MAX: usize = 16;
const CONN_INFO_SIZE: usize = 16;
const CONN_INFO_BDADDR_OFFSET: usize = 2;
const CONN_INFO_TYPE_OFFSET: usize = 8;

pub fn le_acl_connected(adapter: &Adapter, address: Address) -> io::Result<bool> {
    let connections = connection_list(adapter)?;
    let mut wire_address = address.0;
    wire_address.reverse();
    Ok(connections.iter().any(|connection| {
        connection.link_type == LE_LINK && connection.wire_address == wire_address
    }))
}

pub fn any_le_acl_connected(adapter: &Adapter) -> io::Result<bool> {
    Ok(connection_list(adapter)?
        .iter()
        .any(|connection| connection.link_type == LE_LINK))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct HciConnection {
    wire_address: [u8; 6],
    link_type: u8,
}

fn connection_list(adapter: &Adapter) -> io::Result<Vec<HciConnection>> {
    let device_id = adapter
        .name()
        .strip_prefix("hci")
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "adapter is not hciN"))?;
    let socket = open_raw_hci(device_id)?;

    let mut buffer = [0_u8; 4 + CONN_LIST_MAX * CONN_INFO_SIZE];
    buffer[0..2].copy_from_slice(&device_id.to_ne_bytes());
    buffer[2..4].copy_from_slice(&(CONN_LIST_MAX as u16).to_ne_bytes());

    // SAFETY: HCIGETCONNLIST reads the header and writes at most the number
    // of fixed-size entries represented by this owned buffer.
    let result = unsafe { libc::ioctl(socket.as_raw_fd(), HCIGETCONNLIST, buffer.as_mut_ptr()) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }

    parse_connection_list(&buffer)
}

fn parse_connection_list(buffer: &[u8]) -> io::Result<Vec<HciConnection>> {
    if buffer.len() < 4 {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "HCI connection list header is truncated",
        ));
    }
    let count = u16::from_ne_bytes([buffer[2], buffer[3]]) as usize;
    let available = (buffer.len() - 4) / CONN_INFO_SIZE;
    if count > available {
        return Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "HCI connection list entries are truncated",
        ));
    }

    let mut connections = Vec::with_capacity(count);
    for index in 0..count {
        let start = 4 + index * CONN_INFO_SIZE;
        let entry = &buffer[start..start + CONN_INFO_SIZE];
        let mut wire_address = [0_u8; 6];
        wire_address.copy_from_slice(&entry[CONN_INFO_BDADDR_OFFSET..CONN_INFO_BDADDR_OFFSET + 6]);
        connections.push(HciConnection {
            wire_address,
            link_type: entry[CONN_INFO_TYPE_OFFSET],
        });
    }
    Ok(connections)
}

fn open_raw_hci(device_id: u16) -> io::Result<OwnedFd> {
    let mut address = [0_u8; 6];
    address[0..2].copy_from_slice(&(AF_BLUETOOTH as u16).to_ne_bytes());
    address[2..4].copy_from_slice(&device_id.to_ne_bytes());
    address[4..6].copy_from_slice(&HCI_CHANNEL_RAW.to_ne_bytes());

    // SAFETY: the raw HCI socket is immediately wrapped in OwnedFd, and bind
    // only reads the initialized sockaddr bytes for their declared length.
    unsafe {
        let fd = libc::socket(
            AF_BLUETOOTH,
            libc::SOCK_RAW | libc::SOCK_CLOEXEC,
            BTPROTO_HCI,
        );
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        let socket = OwnedFd::from_raw_fd(fd);
        if libc::bind(
            fd,
            address.as_ptr() as *const libc::sockaddr,
            address.len() as libc::socklen_t,
        ) < 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(socket)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_list_distinguishes_classic_and_le_links() {
        let mut buffer = vec![0_u8; 4 + 2 * CONN_INFO_SIZE];
        buffer[2..4].copy_from_slice(&2_u16.to_ne_bytes());

        let classic = 4;
        buffer[classic + CONN_INFO_BDADDR_OFFSET..classic + CONN_INFO_BDADDR_OFFSET + 6]
            .copy_from_slice(&[1, 2, 3, 4, 5, 6]);
        buffer[classic + CONN_INFO_TYPE_OFFSET] = 0x01;

        let le = 4 + CONN_INFO_SIZE;
        buffer[le + CONN_INFO_BDADDR_OFFSET..le + CONN_INFO_BDADDR_OFFSET + 6]
            .copy_from_slice(&[6, 5, 4, 3, 2, 1]);
        buffer[le + CONN_INFO_TYPE_OFFSET] = LE_LINK;

        let connections = parse_connection_list(&buffer).unwrap();
        assert_eq!(connections.len(), 2);
        assert_ne!(connections[0].link_type, LE_LINK);
        assert_eq!(connections[1].link_type, LE_LINK);
        assert!(connections
            .iter()
            .any(|connection| connection.link_type == LE_LINK));
    }

    #[test]
    fn connection_list_rejects_truncated_entries() {
        let mut buffer = vec![0_u8; 4 + CONN_INFO_SIZE];
        buffer[2..4].copy_from_slice(&2_u16.to_ne_bytes());

        assert_eq!(
            parse_connection_list(&buffer).unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
    }
}
