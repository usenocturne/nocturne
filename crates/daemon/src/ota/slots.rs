use std::{
    io,
    process::{Command, ExitStatus},
};

const TRY_MAX: &str = "3";

#[derive(Debug, thiserror::Error)]
pub enum SlotsError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("bad slot value: {0}")]
    BadValue(String),
    #[error("command failed: {0}")]
    CmdFailed(ExitStatus),
}

pub fn host_stub_enabled() -> bool {
    std::env::var("NOCTURNE_SLOTS_STUB").as_deref() == Ok("1")
}

pub fn active_slot() -> Result<char, SlotsError> {
    if host_stub_enabled() {
        tracing::warn!("NOCTURNE_SLOTS_STUB=1; defaulting active slot to a");
        return Ok('a');
    }

    let out = Command::new("fw_printenv")
        .args(["-n", "slot_active"])
        .output()?;
    if !out.status.success() {
        return Err(SlotsError::CmdFailed(out.status));
    }

    match String::from_utf8_lossy(&out.stdout).trim() {
        "a" => Ok('a'),
        "b" => Ok('b'),
        value => Err(SlotsError::BadValue(value.to_string())),
    }
}

pub fn inactive_slot() -> Result<char, SlotsError> {
    match active_slot()? {
        'a' => Ok('b'),
        'b' => Ok('a'),
        value => Err(SlotsError::BadValue(value.to_string())),
    }
}

pub fn mark_slot_ok(slot: char) -> Result<(), SlotsError> {
    let slot = match slot {
        'a' | 'b' => slot,
        value => return Err(SlotsError::BadValue(value.to_string())),
    };

    if host_stub_enabled() {
        tracing::warn!(
            ?slot,
            "NOCTURNE_SLOTS_STUB=1; skipping slot try-counter update"
        );
        return Ok(());
    }

    let key = format!("slot_{slot}_tries");
    let out = Command::new("fw_setenv")
        .args([key.as_str(), TRY_MAX])
        .output()?;
    if !out.status.success() {
        return Err(SlotsError::CmdFailed(out.status));
    }

    Ok(())
}
