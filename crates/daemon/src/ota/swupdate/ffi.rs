use std::{
    ffi::CString,
    io::Read,
    os::raw::{c_char, c_int, c_uint, c_void},
    path::{Path, PathBuf},
    sync::Once,
    time::{Duration, Instant},
};

use nocturne_swupdate_sys as _;
use tokio::{sync::mpsc, task};

use super::{OtaPhase, SwupdateError, SwupdateEvent};

const CHUNK_SIZE: usize = 64 * 1024;
const PROGRESS_MIN_INTERVAL: Duration = Duration::from_millis(100);
const SWUPDATE_CTRL_SOCKET: &str = "/tmp/sockinstctrl";
const SWUPDATE_PROGRESS_SOCKET: &str = "/tmp/swupdateprog";

unsafe extern "C" {
    static mut SOCKET_CTRL_PATH: *mut c_char;
    static mut SOCKET_PROGRESS_PATH: *mut c_char;
    fn swupdate_prepare_req(req: *mut SwupdateRequest);
    fn ipc_inst_start_ext(priv_: *mut c_void, size: isize) -> c_int;
    fn ipc_send_data(connfd: c_int, buf: *mut c_char, size: c_int) -> c_int;
    fn ipc_end(connfd: c_int);
    fn ipc_wait_for_complete(callback: GetStatusCallback) -> c_int;
    fn progress_ipc_connect(reconnect: bool) -> c_int;
    fn progress_ipc_receive(connfd: *mut c_int, msg: *mut ProgressMsg) -> c_int;
}

type GetStatusCallback = Option<unsafe extern "C" fn(*mut c_void) -> c_int>;

const SWUPDATE_API_VERSION: c_uint = 0x1;
const SOURCE_LOCAL: c_uint = 4;
const RUN_INSTALL: c_uint = 2;
const RECOVERY_STATUS_SUCCESS: c_uint = 3;
const RECOVERY_STATUS_FAILURE: c_uint = 4;
const PRINFOSIZE: usize = 2048;

#[repr(C)]
struct SwupdateRequest {
    apiversion: c_uint,
    source: c_uint,
    dry_run: c_uint,
    len: usize,
    info: [c_char; 512],
    software_set: [c_char; 256],
    running_mode: [c_char; 256],
    disable_store_swu: bool,
}

#[repr(C, packed)]
struct ProgressMsg {
    apiversion: u32,
    status: u32,
    dwl_percent: u32,
    dwl_bytes: u64,
    nsteps: u32,
    cur_step: u32,
    cur_percent: u32,
    cur_image: [c_char; 256],
    hnd_name: [c_char; 64],
    source: u32,
    infolen: u32,
    info: [c_char; PRINFOSIZE],
}

pub struct Swupdate;

impl Swupdate {
    pub async fn run(
        swu_path: &Path,
        selector: &str,
        event_tx: mpsc::Sender<SwupdateEvent>,
    ) -> Result<(), SwupdateError> {
        ensure_socket_paths();

        let selector = Selector::parse(selector)?;
        let (prog_tx, mut prog_rx) = mpsc::channel::<ProgressMsg>(32);
        let _progress_handle = task::spawn_blocking(move || progress_reader(prog_tx));

        let path = swu_path.to_path_buf();
        let mut send_handle = task::spawn_blocking(move || install_blocking(path, selector));
        let mut last_emit: Option<(OtaPhase, u8, Instant)> = None;

        loop {
            tokio::select! {
                Some(msg) = prog_rx.recv() => {
                    let event = translate(&msg);
                    let status = msg.status;
                    let terminal = matches!(status, RECOVERY_STATUS_SUCCESS | RECOVERY_STATUS_FAILURE);
                    if should_emit(&mut last_emit, event.phase, event.percent, terminal)
                        && event_tx.send(event).await.is_err()
                    {
                        tracing::debug!("swupdate progress receiver dropped");
                    }
                    match status {
                        RECOVERY_STATUS_SUCCESS => {
                            tracing::info!("libswupdate reported SUCCESS");
                        }
                        RECOVERY_STATUS_FAILURE => {
                            let msg = info_str(&msg);
                            tracing::warn!(%msg, "libswupdate reported FAILURE");
                            return Err(SwupdateError::WriteFailed { msg });
                        }
                        _ => {}
                    }
                }
                res = &mut send_handle => {
                    match res {
                        Ok(Ok(())) => return Ok(()),
                        Ok(Err(err)) => return Err(err),
                        Err(err) => return Err(SwupdateError::Ipc(format!("install task panic: {err}"))),
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct Selector {
    software_set: String,
    running_mode: String,
}

impl Selector {
    fn parse(selector: &str) -> Result<Self, SwupdateError> {
        let (software_set, running_mode) = selector.split_once(',').ok_or_else(|| {
            SwupdateError::Ipc(format!(
                "invalid swupdate selector {selector:?}; expected software_set,running_mode"
            ))
        })?;
        Ok(Self {
            software_set: software_set.to_owned(),
            running_mode: running_mode.to_owned(),
        })
    }
}

fn ensure_socket_paths() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let ctrl = CString::new(SWUPDATE_CTRL_SOCKET).expect("ctrl path has no NUL");
        let prog = CString::new(SWUPDATE_PROGRESS_SOCKET).expect("progress path has no NUL");
        unsafe {
            SOCKET_CTRL_PATH = ctrl.into_raw();
            SOCKET_PROGRESS_PATH = prog.into_raw();
        }
    });
}

fn should_emit(
    last: &mut Option<(OtaPhase, u8, Instant)>,
    phase: OtaPhase,
    percent: u8,
    terminal: bool,
) -> bool {
    let now = Instant::now();
    let (phase_changed, dup, intervaled) = match last {
        Some((p, pct, t)) => (
            *p != phase,
            *p == phase && *pct == percent,
            now.duration_since(*t) < PROGRESS_MIN_INTERVAL,
        ),
        None => (true, false, false),
    };
    if !terminal && !phase_changed && (dup || intervaled) {
        return false;
    }
    *last = Some((phase, percent, now));
    true
}

fn write_cstr_field(field: &mut [c_char], value: &str) -> Result<(), SwupdateError> {
    let bytes = value.as_bytes();
    if bytes.len() + 1 > field.len() {
        return Err(SwupdateError::Ipc(format!(
            "selector field {value:?} too long for swupdate_request slot ({} bytes)",
            field.len()
        )));
    }
    for (dst, src) in field
        .iter_mut()
        .zip(bytes.iter().copied().chain(std::iter::repeat(0)))
    {
        *dst = src as c_char;
    }
    Ok(())
}

fn install_blocking(swu_path: PathBuf, selector: Selector) -> Result<(), SwupdateError> {
    let mut file = std::fs::File::open(&swu_path)?;
    let total_len = file.metadata()?.len();
    let mut buf = vec![0u8; CHUNK_SIZE];

    unsafe {
        let mut req: SwupdateRequest = std::mem::zeroed();
        swupdate_prepare_req(&mut req);
        req.apiversion = SWUPDATE_API_VERSION;
        req.source = SOURCE_LOCAL;
        req.dry_run = RUN_INSTALL;
        write_cstr_field(&mut req.software_set, &selector.software_set)?;
        write_cstr_field(&mut req.running_mode, &selector.running_mode)?;

        let fd = ipc_inst_start_ext(
            &mut req as *mut _ as *mut c_void,
            std::mem::size_of::<SwupdateRequest>() as isize,
        );
        if fd < 0 {
            return Err(SwupdateError::Ipc(format!(
                "ipc_inst_start_ext returned {fd}"
            )));
        }

        let mut sent = 0u64;
        loop {
            let n = match file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => n,
                Err(err) => {
                    ipc_end(fd);
                    return Err(SwupdateError::Io(err));
                }
            };
            let r = ipc_send_data(fd, buf.as_ptr() as *mut c_char, n as c_int);
            if r < 0 {
                ipc_end(fd);
                return Err(SwupdateError::Ipc(format!(
                    "ipc_send_data returned {r} after {sent}/{total_len}"
                )));
            }
            sent += n as u64;
        }

        ipc_end(fd);

        match ipc_wait_for_complete(None) {
            value if value == RECOVERY_STATUS_SUCCESS as c_int => Ok(()),
            value if value == RECOVERY_STATUS_FAILURE as c_int => Err(SwupdateError::WriteFailed {
                msg: "swupdate reported failure".into(),
            }),
            value => Err(SwupdateError::Ipc(format!(
                "ipc_wait_for_complete returned {value}"
            ))),
        }
    }
}

fn progress_reader(tx: mpsc::Sender<ProgressMsg>) {
    unsafe {
        let mut fd = progress_ipc_connect(true);
        if fd < 0 {
            tracing::warn!("progress_ipc_connect returned {fd}; no progress events will surface");
            return;
        }
        loop {
            let mut msg: ProgressMsg = std::mem::zeroed();
            let r = progress_ipc_receive(&mut fd, &mut msg);
            if r <= 0 {
                tracing::debug!("progress_ipc_receive returned {r}; reader exiting");
                return;
            }
            let terminal = matches!(
                msg.status,
                RECOVERY_STATUS_SUCCESS | RECOVERY_STATUS_FAILURE
            );
            if tx.blocking_send(msg).is_err() {
                return;
            }
            if terminal {
                return;
            }
        }
    }
}

fn translate(msg: &ProgressMsg) -> SwupdateEvent {
    SwupdateEvent {
        phase: OtaPhase::Writing,
        percent: msg.cur_percent.min(100) as u8,
    }
}

fn info_str(msg: &ProgressMsg) -> String {
    let infolen = msg.infolen.min(PRINFOSIZE as c_uint) as usize;
    let info = unsafe { std::ptr::addr_of!(msg.info).read_unaligned() };
    let bytes = unsafe { std::slice::from_raw_parts(info.as_ptr().cast::<u8>(), infolen) };
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}
