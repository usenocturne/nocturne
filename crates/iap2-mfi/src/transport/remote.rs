//! TCP transport for talking to the chip from a remote host.
//!
//! On the device, run [`serve`] against a [`LinuxI2c`] transport. On
//! the dev host, [`RemoteI2c`] connects to that listener and looks
//! exactly like any other [`Transport`] to [`MfiAuth`]. The wire format
//! is sync-only and single-client; the chip is a single-resource so
//! there's no concurrency to gain.
//!
//! Wire format (both directions):
//!
//! ```text
//! [u8 tag][u32 length BE][N bytes payload]
//! ```
//!
//! Request tags (host -> device):
//! - `0x01 PREPARE`     - payload `[cmd: u8]`
//! - `0x02 SMBUS_READ`  - payload `[cmd: u8, len: u8]`
//! - `0x03 SMBUS_WRITE` - payload `[cmd: u8, data...]`
//! - `0x04 RAW_READ`    - payload `[len: u32 BE]`
//!
//! Response tags (device -> host):
//! - `0x80 OK`  - payload is response bytes (empty for prepare/write,
//!   the requested bytes for reads)
//! - `0x81 ERR` - payload is a UTF-8 error message
//!
//! [`LinuxI2c`]: super::LinuxI2c
//! [`Transport`]: super::Transport
//! [`MfiAuth`]: crate::MfiAuth

use std::{
    io::{self, Read, Write},
    net::{TcpStream, ToSocketAddrs},
};

use super::Transport;
use crate::error::TransportError;

pub mod tag {
    pub const PREPARE: u8 = 0x01;
    pub const SMBUS_READ: u8 = 0x02;
    pub const SMBUS_WRITE: u8 = 0x03;
    pub const RAW_READ: u8 = 0x04;

    pub const RESP_OK: u8 = 0x80;
    pub const RESP_ERR: u8 = 0x81;
}

/// Hard cap on payload size to keep a malformed peer from making the
/// other side allocate gigabytes. The chip's largest legal payload is
/// the X.509 cert (a few KB); 1 MiB is comfortable headroom.
pub const MAX_PAYLOAD: u32 = 1 << 20;

/// Read one frame from the stream. Returns `(tag, payload)`.
pub fn read_frame<R: Read>(r: &mut R) -> io::Result<(u8, Vec<u8>)> {
    let mut header = [0u8; 5];
    r.read_exact(&mut header)?;
    let tag = header[0];
    let len = u32::from_be_bytes([header[1], header[2], header[3], header[4]]);
    if len > MAX_PAYLOAD {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("frame payload too large: {len}"),
        ));
    }
    let mut payload = vec![0u8; len as usize];
    r.read_exact(&mut payload)?;
    Ok((tag, payload))
}

/// Write one frame to the stream.
pub fn write_frame<W: Write>(w: &mut W, tag: u8, payload: &[u8]) -> io::Result<()> {
    let len = u32::try_from(payload.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "payload too large"))?;
    if len > MAX_PAYLOAD {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("payload too large: {len}"),
        ));
    }
    let mut header = [0u8; 5];
    header[0] = tag;
    header[1..5].copy_from_slice(&len.to_be_bytes());
    w.write_all(&header)?;
    w.write_all(payload)?;
    w.flush()
}

/// Host-side transport that proxies each call over TCP to a [`serve`]
/// loop running on the device.
pub struct RemoteI2c {
    stream: TcpStream,
}

impl RemoteI2c {
    pub fn connect(addr: impl ToSocketAddrs) -> Result<Self, TransportError> {
        let stream = TcpStream::connect(addr).map_err(TransportError::Io)?;
        stream.set_nodelay(true).map_err(TransportError::Io)?;
        Ok(Self { stream })
    }

    fn round_trip(&mut self, tag: u8, payload: &[u8]) -> Result<Vec<u8>, TransportError> {
        write_frame(&mut self.stream, tag, payload).map_err(TransportError::Io)?;
        let (resp_tag, resp_payload) = read_frame(&mut self.stream).map_err(TransportError::Io)?;
        match resp_tag {
            tag::RESP_OK => Ok(resp_payload),
            tag::RESP_ERR => {
                let msg = String::from_utf8_lossy(&resp_payload).into_owned();
                Err(TransportError::Other(format!("remote: {msg}")))
            }
            other => Err(TransportError::Other(format!(
                "remote: unexpected response tag 0x{other:02x}"
            ))),
        }
    }
}

impl Transport for RemoteI2c {
    fn prepare(&mut self, cmd: u8) -> Result<(), TransportError> {
        self.round_trip(tag::PREPARE, &[cmd])?;
        Ok(())
    }

    fn smbus_read_block(&mut self, cmd: u8, out: &mut [u8]) -> Result<(), TransportError> {
        let len = u8::try_from(out.len())
            .map_err(|_| TransportError::Other(format!("smbus block len {} > 255", out.len())))?;
        let payload = self.round_trip(tag::SMBUS_READ, &[cmd, len])?;
        if payload.len() != out.len() {
            return Err(TransportError::Other(format!(
                "remote: smbus_read returned {} bytes, expected {}",
                payload.len(),
                out.len()
            )));
        }
        out.copy_from_slice(&payload);
        Ok(())
    }

    fn smbus_write_block(&mut self, cmd: u8, data: &[u8]) -> Result<(), TransportError> {
        let mut payload = Vec::with_capacity(1 + data.len());
        payload.push(cmd);
        payload.extend_from_slice(data);
        self.round_trip(tag::SMBUS_WRITE, &payload)?;
        Ok(())
    }

    fn raw_read(&mut self, out: &mut [u8]) -> Result<(), TransportError> {
        let len = u32::try_from(out.len())
            .map_err(|_| TransportError::Other(format!("raw_read len {} > u32::MAX", out.len())))?;
        let payload = self.round_trip(tag::RAW_READ, &len.to_be_bytes())?;
        if payload.len() != out.len() {
            return Err(TransportError::Other(format!(
                "remote: raw_read returned {} bytes, expected {}",
                payload.len(),
                out.len()
            )));
        }
        out.copy_from_slice(&payload);
        Ok(())
    }
}

/// Serve a single client over `stream`, dispatching each request to
/// the supplied transport. Returns when the client disconnects cleanly
/// or hits a fatal i/o error. Errors during request handling are sent
/// back as `RESP_ERR` frames; they do not terminate the loop.
pub fn serve<T, S>(mut stream: S, transport: &mut T) -> io::Result<()>
where
    T: Transport,
    S: Read + Write,
{
    loop {
        let (req_tag, req_payload) = match read_frame(&mut stream) {
            Ok(frame) => frame,
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(e) => return Err(e),
        };

        let result = handle_request(transport, req_tag, &req_payload);
        match result {
            Ok(payload) => write_frame(&mut stream, tag::RESP_OK, &payload)?,
            Err(msg) => write_frame(&mut stream, tag::RESP_ERR, msg.as_bytes())?,
        }
    }
}

fn handle_request<T: Transport>(
    transport: &mut T,
    tag_byte: u8,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    match tag_byte {
        tag::PREPARE => {
            let cmd = *payload
                .first()
                .ok_or_else(|| "PREPARE: missing cmd byte".to_string())?;
            transport.prepare(cmd).map_err(|e| e.to_string())?;
            Ok(Vec::new())
        }
        tag::SMBUS_READ => {
            if payload.len() != 2 {
                return Err(format!(
                    "SMBUS_READ: expected 2 bytes, got {}",
                    payload.len()
                ));
            }
            let cmd = payload[0];
            let len = payload[1] as usize;
            let mut buf = vec![0u8; len];
            transport
                .smbus_read_block(cmd, &mut buf)
                .map_err(|e| e.to_string())?;
            Ok(buf)
        }
        tag::SMBUS_WRITE => {
            let cmd = *payload
                .first()
                .ok_or_else(|| "SMBUS_WRITE: missing cmd byte".to_string())?;
            transport
                .smbus_write_block(cmd, &payload[1..])
                .map_err(|e| e.to_string())?;
            Ok(Vec::new())
        }
        tag::RAW_READ => {
            if payload.len() != 4 {
                return Err(format!(
                    "RAW_READ: expected 4-byte length, got {}",
                    payload.len()
                ));
            }
            let len = u32::from_be_bytes([payload[0], payload[1], payload[2], payload[3]]) as usize;
            let mut buf = vec![0u8; len];
            transport.raw_read(&mut buf).map_err(|e| e.to_string())?;
            Ok(buf)
        }
        other => Err(format!("unknown request tag 0x{other:02x}")),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[test]
    fn frame_round_trip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, tag::PREPARE, &[0x30]).unwrap();
        let mut cursor = Cursor::new(buf);
        let (got_tag, got_payload) = read_frame(&mut cursor).unwrap();
        assert_eq!(got_tag, tag::PREPARE);
        assert_eq!(got_payload, vec![0x30]);
    }

    #[test]
    fn frame_rejects_oversized_length() {
        // header claims 2 GiB; reader must refuse before allocating.
        let header = [tag::PREPARE, 0x80, 0x00, 0x00, 0x00];
        let mut cursor = Cursor::new(&header[..]);
        let err = read_frame(&mut cursor).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn write_frame_rejects_oversized_payload() {
        let payload = vec![0u8; (MAX_PAYLOAD + 1) as usize];
        let mut sink = Vec::new();
        let err = write_frame(&mut sink, tag::SMBUS_WRITE, &payload).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }
}
