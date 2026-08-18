use iap2_rs::{csm::hid::report_bit, HidCommand};

pub fn method_to_hid_command(method: &str) -> Option<HidCommand> {
    match method {
        "media.control.play"
        | "media.control.pause"
        | "media.control.playPause"
        | "media.control.togglePlayPause" => Some(HidCommand::Pulse(report_bit::PLAY_PAUSE)),
        "media.control.next" => Some(HidCommand::Pulse(report_bit::NEXT)),
        "media.control.previous" | "media.control.prev" => {
            Some(HidCommand::Pulse(report_bit::PREV))
        }
        "media.control.shuffle" => Some(HidCommand::Pulse(report_bit::SHUFFLE)),
        "media.control.repeat" => Some(HidCommand::Pulse(report_bit::REPEAT)),
        "media.control.like" => Some(HidCommand::Pulse(report_bit::PROMOTE)),
        "media.control.unlike" => Some(HidCommand::Pulse(report_bit::DEMOTE)),
        "media.control.volumeUp" | "media.control.volume_up" => {
            Some(HidCommand::Pulse(report_bit::VOLUME_UP))
        }
        "media.control.volumeDown" | "media.control.volume_down" => {
            Some(HidCommand::Pulse(report_bit::VOLUME_DOWN))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_like_feedback_to_distinct_high_byte_hid_controls() {
        assert_eq!(
            method_to_hid_command("media.control.like"),
            Some(HidCommand::Pulse(report_bit::PROMOTE))
        );
        assert_eq!(
            method_to_hid_command("media.control.unlike"),
            Some(HidCommand::Pulse(report_bit::DEMOTE))
        );
        assert_ne!(report_bit::PROMOTE, report_bit::SHUFFLE);
        assert_ne!(report_bit::DEMOTE, report_bit::REPEAT);
    }
}
