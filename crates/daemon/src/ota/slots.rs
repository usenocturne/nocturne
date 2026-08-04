use std::{
    io,
    process::{Command, ExitStatus},
};

const TRY_MAX: &str = "3";
const CMDLINE_PATH: &str = "/proc/cmdline";

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
    inactive_from_running_slot(running_slot()?)
}

fn inactive_from_running_slot(running: char) -> Result<char, SlotsError> {
    match running {
        'a' => Ok('b'),
        'b' => Ok('a'),
        value => Err(SlotsError::BadValue(value.to_string())),
    }
}

fn running_slot() -> Result<char, SlotsError> {
    if host_stub_enabled() {
        tracing::warn!("NOCTURNE_SLOTS_STUB=1; defaulting running slot to a");
        return Ok('a');
    }

    let cmdline = std::fs::read_to_string(CMDLINE_PATH)?;
    parse_running_slot(&cmdline)
}

fn parse_running_slot(cmdline: &str) -> Result<char, SlotsError> {
    let mut parsed = None;
    for value in cmdline
        .split_ascii_whitespace()
        .filter_map(|arg| arg.strip_prefix("superbird.slot="))
    {
        if parsed.is_some() {
            return Err(SlotsError::BadValue(
                "multiple superbird.slot values in kernel cmdline".into(),
            ));
        }
        parsed = Some(match value {
            "a" => 'a',
            "b" => 'b',
            value => return Err(SlotsError::BadValue(value.to_string())),
        });
    }
    parsed.ok_or_else(|| SlotsError::BadValue("missing superbird.slot in kernel cmdline".into()))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_actual_running_slot_from_kernel_cmdline() {
        assert_eq!(
            parse_running_slot("root=PARTLABEL=root_a superbird.slot=a ro").unwrap(),
            'a'
        );
        assert_eq!(
            parse_running_slot("root=PARTLABEL=root_b ro superbird.slot=b").unwrap(),
            'b'
        );
    }

    #[test]
    fn rejects_missing_or_invalid_running_slot() {
        assert!(parse_running_slot("root=PARTLABEL=root_a ro").is_err());
        assert!(parse_running_slot("root=PARTLABEL=root_c superbird.slot=c").is_err());
        assert!(parse_running_slot("superbird.slot=a superbird.slot=b").is_err());
        assert!(parse_running_slot("superbird.slot=a superbird.slot=a").is_err());
    }

    #[test]
    fn staged_next_boot_selection_cannot_change_the_running_slot_target() {
        let running =
            parse_running_slot("root=PARTLABEL=root_b superbird.slot=b slot_active=a ro rootwait")
                .unwrap();

        assert_eq!(running, 'b');
        assert_eq!(inactive_from_running_slot(running).unwrap(), 'a');
    }
}
