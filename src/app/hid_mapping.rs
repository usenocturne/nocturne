use iap2_rs::HidCommand;

pub fn method_to_hid_command(method: &str) -> Option<HidCommand> {
    match method {
        "media.control.play" => Some(HidCommand::Play),
        "media.control.pause" => Some(HidCommand::Pause),
        "media.control.playPause" | "media.control.togglePlayPause" => Some(HidCommand::PlayPause),
        "media.control.next" => Some(HidCommand::Next),
        "media.control.previous" | "media.control.prev" => Some(HidCommand::Previous),
        "media.control.shuffle" => Some(HidCommand::Shuffle),
        "media.control.repeat" => Some(HidCommand::Repeat),
        "media.control.volumeUp" => Some(HidCommand::VolumeUp),
        "media.control.volumeDown" => Some(HidCommand::VolumeDown),
        _ => None,
    }
}
