use sonora_ns::{
    config::{NsConfig, SuppressionLevel},
    noise_suppressor::NoiseSuppressor,
};

pub(super) const FRAME_SAMPLES: usize = 160;

pub(super) struct NoiseSuppressor16k {
    inner: NoiseSuppressor,
}

impl NoiseSuppressor16k {
    pub(super) fn new() -> Self {
        Self {
            inner: NoiseSuppressor::new(NsConfig {
                target_level: SuppressionLevel::K12dB,
            }),
        }
    }

    pub(super) fn reset(&mut self) {
        *self = Self::new();
    }

    // FloatS16 input/output; retain the PCM16 rounding used in the recorded-input screen.
    pub(super) fn process(&mut self, frame: &mut [f32; FRAME_SAMPLES]) {
        self.inner.analyze(frame);
        self.inner.process(frame);
        for sample in frame {
            *sample = f32::from(sample.round().clamp(-32768.0, 32767.0) as i16);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_remains_finite_and_zero_through_startup() {
        let mut suppressor = NoiseSuppressor16k::new();
        for _ in 0..250 {
            let mut frame = [0.0; FRAME_SAMPLES];
            suppressor.process(&mut frame);
            assert!(frame
                .iter()
                .all(|sample| sample.is_finite() && *sample == 0.0));
        }
    }

    #[test]
    fn impulse_survives_frame_boundary_with_96_sample_delay() {
        let mut suppressor = NoiseSuppressor16k::new();
        let mut output = Vec::new();
        for index in 0..3 {
            let mut frame = [0.0; FRAME_SAMPLES];
            if index == 0 {
                frame[FRAME_SAMPLES - 1] = 16_000.0;
            }
            suppressor.process(&mut frame);
            output.extend(frame);
        }
        let peak = output
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.abs().total_cmp(&right.abs()))
            .unwrap();
        assert_eq!(peak.0, FRAME_SAMPLES - 1 + 96);
        assert!(*peak.1 > 0.0);
        assert!(output.iter().all(|sample| {
            sample.is_finite() && sample.fract() == 0.0 && (-32768.0..=32767.0).contains(sample)
        }));
    }

    #[test]
    fn reset_discards_noise_estimate_and_overlap_history() {
        let mut used = NoiseSuppressor16k::new();
        let mut seed = 1_u32;
        for _ in 0..250 {
            let mut frame = std::array::from_fn(|_| {
                seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                f32::from((seed >> 16) as i16)
            });
            used.process(&mut frame);
        }
        used.reset();
        let mut fresh = NoiseSuppressor16k::new();
        for index in 0..8 {
            let mut actual = std::array::from_fn(|sample| {
                if sample == (index * 31) % FRAME_SAMPLES {
                    12_000.0
                } else {
                    0.0
                }
            });
            let mut expected = actual;
            used.process(&mut actual);
            fresh.process(&mut expected);
            assert_eq!(actual, expected);
        }
    }
}
