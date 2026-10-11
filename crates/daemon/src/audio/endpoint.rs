use super::direction::{FrameDirection, PAIR_COUNT};

const FRAME_MS: u32 = 60;
const SILENCE_THRESHOLD_RMS: f32 = 200.0;
const VAD_ACTIVITY_MIN: f32 = 0.15;
const VAD_CONFIDENT_SPEECH: f32 = 0.75;
const GRACE_FRAMES: u32 = 1500 / FRAME_MS;
const SILENCE_FRAMES: u32 = 1500 / FRAME_MS;
const MAX_FRAMES: u32 = 12_000 / FRAME_MS;
const NOISE_FLOOR_INITIAL_RMS: f32 = 50.0;
const NOISE_FLOOR_MIN_RMS: f32 = 16.0;
const NOISE_FLOOR_MARGIN: f32 = 2.0;
const NOISE_FLOOR_RISE_PER_FRAME: f32 = 1.042;
const NOISE_FLOOR_FALL: f32 = 0.5;
const SPEAKER_DROP_RATIO: f32 = 0.178;
const SPEAKER_REFERENCE_SKIP_FRAMES: u32 = 300 / FRAME_MS;
const SPEAKER_REFERENCE_FRAMES: u32 = 2000 / FRAME_MS;
const SPEAKER_REFERENCE_SMOOTHING_FRAMES: usize = 3;
const LEVEL_WINDOW_FRAMES: usize = 8;
const DIRECTION_REFERENCE_PEAK: f32 = 0.4;
const DIRECTION_FRAME_PEAK: f32 = 0.2;
const DIRECTION_REJECT_BELOW: f32 = 0.5;
const DIRECTION_MIN_REFERENCE_LAG: f32 = 1.0;
const DIRECTION_MIN_REFERENCE_FRAMES: usize = 4;
const DIRECTION_MAX_REFERENCE_FRAMES: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EndpointStop {
    Silence,
    MaxDuration,
}

impl EndpointStop {
    pub(crate) fn reason(self) -> &'static str {
        match self {
            Self::Silence => "silence",
            Self::MaxDuration => "max_duration",
        }
    }
}

pub(crate) struct Endpointer {
    frames: u32,
    silent_frames: u32,
    noise_floor: f32,
    recent_rms: [f32; LEVEL_WINDOW_FRAMES],
    speaker_level: f32,
    speaker_frames: Option<u32>,
    direction_samples: Vec<[f32; PAIR_COUNT]>,
    direction_reference: Option<[f32; PAIR_COUNT]>,
}

impl Default for Endpointer {
    fn default() -> Self {
        Self {
            frames: 0,
            silent_frames: 0,
            noise_floor: NOISE_FLOOR_INITIAL_RMS,
            recent_rms: [0.0; LEVEL_WINDOW_FRAMES],
            speaker_level: 0.0,
            speaker_frames: None,
            direction_samples: Vec::with_capacity(DIRECTION_MAX_REFERENCE_FRAMES),
            direction_reference: None,
        }
    }
}

impl Endpointer {
    pub(crate) fn observe(
        &mut self,
        rms: f32,
        vad: Option<f32>,
        direction: Option<FrameDirection>,
    ) -> Option<EndpointStop> {
        if self.frames >= MAX_FRAMES {
            return Some(EndpointStop::MaxDuration);
        }
        let confident = vad.is_some_and(|vad| vad >= VAD_CONFIDENT_SPEECH);
        let elsewhere =
            direction.is_some_and(|direction| self.arrives_elsewhere(direction, confident));
        self.frames += 1;
        self.recent_rms.rotate_left(1);
        self.recent_rms[LEVEL_WINDOW_FRAMES - 1] = rms;

        let speech = !elsewhere && self.is_speech(rms, vad);
        self.track_noise_floor(rms);
        self.track_speaker(confident && !elsewhere);

        if self.frames <= GRACE_FRAMES || speech {
            self.silent_frames = 0;
            return None;
        }
        self.silent_frames += 1;
        (self.silent_frames > SILENCE_FRAMES).then_some(EndpointStop::Silence)
    }

    fn is_speech(&self, rms: f32, vad: Option<f32>) -> bool {
        let energy = self.recent_rms.iter().map(|rms| rms * rms).sum::<f32>();
        let level = (energy / LEVEL_WINDOW_FRAMES as f32).sqrt();
        let above_background = rms >= self.noise_floor * NOISE_FLOOR_MARGIN
            && level >= self.speaker_level * SPEAKER_DROP_RATIO;
        let loud = rms >= SILENCE_THRESHOLD_RMS && vad.is_none_or(|vad| vad >= VAD_ACTIVITY_MIN);
        let confident = vad.is_some_and(|vad| vad >= VAD_CONFIDENT_SPEECH);
        above_background && (loud || confident)
    }

    fn track_noise_floor(&mut self, rms: f32) {
        self.noise_floor = if rms < self.noise_floor {
            self.noise_floor + NOISE_FLOOR_FALL * (rms - self.noise_floor)
        } else {
            (self.noise_floor * NOISE_FLOOR_RISE_PER_FRAME).min(rms)
        }
        .max(NOISE_FLOOR_MIN_RMS);
    }

    fn arrives_elsewhere(&mut self, direction: FrameDirection, confident: bool) -> bool {
        let forming = self
            .speaker_frames
            .is_none_or(|frames| frames < SPEAKER_REFERENCE_FRAMES);
        if forming
            && confident
            && direction.peak >= DIRECTION_REFERENCE_PEAK
            && self.direction_samples.len() < DIRECTION_MAX_REFERENCE_FRAMES
        {
            self.direction_samples.push(direction.lags);
            if self.direction_samples.len() >= DIRECTION_MIN_REFERENCE_FRAMES {
                self.direction_reference = Some(std::array::from_fn(|pair| {
                    let mut lags: Vec<f32> = self
                        .direction_samples
                        .iter()
                        .map(|lags| lags[pair])
                        .collect();
                    lags.sort_by(f32::total_cmp);
                    let middle = lags.len() / 2;
                    if lags.len().is_multiple_of(2) {
                        (lags[middle - 1] + lags[middle]) / 2.0
                    } else {
                        lags[middle]
                    }
                }));
            }
        }
        let Some(reference) = self.direction_reference else {
            return false;
        };
        let norm = reference.iter().map(|lag| lag * lag).sum::<f32>();
        if direction.peak < DIRECTION_FRAME_PEAK
            || norm < DIRECTION_MIN_REFERENCE_LAG * DIRECTION_MIN_REFERENCE_LAG
        {
            return false;
        }
        let projection = direction
            .lags
            .iter()
            .zip(reference)
            .map(|(lag, reference)| lag * reference)
            .sum::<f32>()
            / norm;
        projection < DIRECTION_REJECT_BELOW
    }

    fn track_speaker(&mut self, confident: bool) {
        let frames = match self.speaker_frames.as_mut() {
            Some(frames) => frames,
            None if confident && self.frames > SPEAKER_REFERENCE_SKIP_FRAMES => {
                self.speaker_frames.insert(0)
            }
            None => return,
        };
        *frames += 1;
        if confident && *frames <= SPEAKER_REFERENCE_FRAMES {
            let recent =
                &self.recent_rms[LEVEL_WINDOW_FRAMES - SPEAKER_REFERENCE_SMOOTHING_FRAMES..];
            let smoothed = recent.iter().sum::<f32>() / SPEAKER_REFERENCE_SMOOTHING_FRAMES as f32;
            self.speaker_level = self.speaker_level.max(smoothed);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const USER: (f32, Option<f32>) = (3000.0, Some(0.95));
    const QUIET: (f32, Option<f32>) = (8.0, Some(0.02));

    fn run(frames: impl IntoIterator<Item = (f32, Option<f32>)>) -> Option<(u32, EndpointStop)> {
        let mut endpointer = Endpointer::default();
        for (index, (rms, vad)) in frames.into_iter().enumerate() {
            if let Some(stop) = endpointer.observe(rms, vad, None) {
                return Some((index as u32, stop));
            }
        }
        None
    }

    fn repeat(frame: (f32, Option<f32>), ms: u32) -> impl Iterator<Item = (f32, Option<f32>)> {
        std::iter::repeat_n(frame, (ms / FRAME_MS) as usize)
    }

    fn speech(frame: (f32, Option<f32>), ms: u32) -> impl Iterator<Item = (f32, Option<f32>)> {
        let (rms, vad) = frame;
        (0..ms / FRAME_MS).map(move |index| {
            if index % 5 == 0 {
                (rms * 0.03, vad)
            } else {
                frame
            }
        })
    }

    fn command_then(
        tail: impl Iterator<Item = (f32, Option<f32>)>,
    ) -> impl Iterator<Item = (f32, Option<f32>)> {
        speech(USER, 2400).chain(tail)
    }

    #[test]
    fn quiet_cabin_ends_after_trailing_silence() {
        let (frame, stop) = run(command_then(repeat(QUIET, 10_000))).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        assert_eq!(frame, 40 + SILENCE_FRAMES);
    }

    #[test]
    fn pauses_inside_a_command_keep_capturing() {
        let frames = speech(USER, 1200)
            .chain(repeat(QUIET, 1200))
            .chain(speech(USER, 600))
            .chain(repeat(QUIET, 1000))
            .chain(speech(USER, 600))
            .chain(repeat(QUIET, 10_000));
        let (frame, stop) = run(frames).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        assert_eq!(frame, (4600 / FRAME_MS) + SILENCE_FRAMES);
    }

    #[test]
    fn short_reply_after_wake_word_is_held_open() {
        let frames = repeat(QUIET, 1800)
            .chain(speech(USER, 300))
            .chain(repeat(QUIET, 10_000));
        let (frame, _) = run(frames).unwrap();
        assert_eq!(frame, (2100 / FRAME_MS) + SILENCE_FRAMES);
    }

    #[test]
    fn background_conversation_after_the_command_does_not_hold_capture() {
        let passenger = (420.0, Some(0.92));
        let (frame, stop) = run(command_then(repeat(passenger, 20_000))).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        let flushed = 40 + LEVEL_WINDOW_FRAMES as u32;
        assert!(frame <= flushed + SILENCE_FRAMES, "ended at frame {frame}");
    }

    #[test]
    fn sustained_cabin_noise_without_a_speaker_ends_capture() {
        let road = (450.0, Some(0.3));
        let (frame, stop) = run(repeat(road, 20_000)).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        assert!(frame < 4500 / FRAME_MS, "ended at frame {frame}");
    }

    #[test]
    fn loud_wake_word_tail_does_not_silence_a_softer_command() {
        let soft = (300.0, Some(0.9));
        let frames = repeat(USER, 300)
            .chain(repeat(QUIET, 300))
            .chain(speech(soft, 3000))
            .chain(repeat(QUIET, 10_000));
        let (frame, stop) = run(frames).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        assert_eq!(frame, (3600 / FRAME_MS) + SILENCE_FRAMES);
    }

    const DRIVER_LAGS: [f32; PAIR_COUNT] = [-2.0, -4.0, -6.0, -2.0, -4.0, -2.0];

    fn aimed(
        frames: impl Iterator<Item = (f32, Option<f32>)>,
        lags: [f32; PAIR_COUNT],
    ) -> impl Iterator<Item = (f32, Option<f32>, Option<FrameDirection>)> {
        frames.map(move |(rms, vad)| (rms, vad, Some(FrameDirection { lags, peak: 0.6 })))
    }

    fn run_aimed(
        frames: impl IntoIterator<Item = (f32, Option<f32>, Option<FrameDirection>)>,
    ) -> Option<(u32, EndpointStop)> {
        let mut endpointer = Endpointer::default();
        for (index, (rms, vad, direction)) in frames.into_iter().enumerate() {
            if let Some(stop) = endpointer.observe(rms, vad, direction) {
                return Some((index as u32, stop));
            }
        }
        None
    }

    #[test]
    fn equally_loud_talker_from_the_other_seat_does_not_hold_capture() {
        let passenger = DRIVER_LAGS.map(|lag| -lag);
        let frames =
            aimed(speech(USER, 2400), DRIVER_LAGS).chain(aimed(speech(USER, 20_000), passenger));
        let (frame, stop) = run_aimed(frames).unwrap();
        assert_eq!(stop, EndpointStop::Silence);
        assert_eq!(frame, 40 + SILENCE_FRAMES);
    }

    #[test]
    fn wake_word_speaker_direction_keeps_capturing() {
        let nearby = DRIVER_LAGS.map(|lag| lag * 0.7);
        let frames = aimed(speech(USER, 2400), DRIVER_LAGS)
            .chain(aimed(speech(USER, 2400), nearby))
            .chain(aimed(repeat(QUIET, 10_000), [0.0; PAIR_COUNT]));
        let (frame, _) = run_aimed(frames).unwrap();
        assert_eq!(frame, 80 + SILENCE_FRAMES);
    }

    #[test]
    fn broadside_reference_disables_direction_gating() {
        let centred = [0.2, 0.3, 0.4, 0.1, 0.2, 0.1];
        let frames = aimed(speech(USER, 2400), centred)
            .chain(aimed(speech(USER, 2400), centred.map(|lag| -lag)))
            .chain(aimed(repeat(QUIET, 10_000), [0.0; PAIR_COUNT]));
        let (frame, _) = run_aimed(frames).unwrap();
        assert_eq!(frame, 80 + SILENCE_FRAMES);
    }

    #[test]
    fn direction_needs_several_confident_reference_frames() {
        let mut endpointer = Endpointer::default();
        let passenger = Some(FrameDirection {
            lags: DRIVER_LAGS.map(|lag| -lag),
            peak: 0.6,
        });
        let driver = Some(FrameDirection {
            lags: DRIVER_LAGS,
            peak: 0.6,
        });
        for _ in 0..DIRECTION_MIN_REFERENCE_FRAMES - 1 {
            endpointer.observe(USER.0, USER.1, driver);
        }
        assert!(endpointer.direction_reference.is_none());
        endpointer.observe(USER.0, USER.1, passenger);
        assert!(endpointer.direction_reference.is_some());
    }

    #[test]
    fn soft_spoken_command_still_counts_as_speech() {
        let soft = (120.0, Some(0.85));
        let frames = repeat(QUIET, 600)
            .chain(speech(soft, 3000))
            .chain(repeat(QUIET, 10_000));
        let (frame, _) = run(frames).unwrap();
        assert_eq!(frame, (3600 / FRAME_MS) + SILENCE_FRAMES);
    }

    #[test]
    fn continuous_speech_is_capped() {
        let (frame, stop) = run(speech(USER, 60_000)).unwrap();
        assert_eq!(stop, EndpointStop::MaxDuration);
        assert_eq!(frame, MAX_FRAMES);
    }

    #[test]
    fn missing_vad_falls_back_to_energy() {
        let frames = speech((3000.0, None), 2400).chain(repeat((8.0, None), 10_000));
        let (frame, _) = run(frames).unwrap();
        assert_eq!(frame, 40 + SILENCE_FRAMES);
    }
}
