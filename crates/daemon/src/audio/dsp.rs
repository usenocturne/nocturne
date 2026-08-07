use nnnoiseless::DenoiseState;

pub(crate) const RAW_CHANNELS: usize = 4;
const SAMPLE_RATE_HZ: f64 = 48_000.0;

const HPF_CUTOFF_HZ: f64 = 100.0;
const BUTTERWORTH4_SECTION_Q: [f64; 2] = [0.541_196_100_146_197, 1.306_562_964_876_377];

const MIX_LOW_CUTOFF_HZ: f64 = 20.0;
const MIX_HIGH_CUTOFF_HZ: f64 = 250.0;
const MIX_ENERGY_TIME_CONSTANT_S: f64 = 0.15;
const MIX_TURBULENCE_FLOOR: f64 = 50_000.0;
const MIX_MIN_WEIGHT: f64 = 0.03;
const MIX_MAX_WEIGHT: f64 = 0.70;

pub(crate) const DECIMATION_RATIO: usize = 3;
const DECIM_FIR_LEN: usize = 165;

#[allow(clippy::excessive_precision)]
#[rustfmt::skip]
const DECIM_FIR_TAPS: [f32; DECIM_FIR_LEN] = [
    -5.9594965022e-06, -2.8421554181e-05, -3.4405783761e-05, -6.5309446928e-06, 4.3702803887e-05, 7.4520595458e-05,
    4.5121878191e-05, -4.1017681532e-05, -1.2183289018e-04, -1.1680888039e-04, 0.0, 1.5593604201e-04,
    2.1743411517e-04, 9.8152836340e-05, -1.4544120191e-04, -3.2567646889e-04, -2.6127468192e-04, 5.4053998968e-05,
    4.0060425678e-04, 4.7587470348e-04, 1.4801072446e-04, -3.8545319203e-04, -6.9925032502e-04, -4.6895865057e-04,
    2.1915188283e-04, 8.5800121193e-04, 8.8031820545e-04, 1.4494500443e-04, -8.5623106897e-04, -1.3068320257e-03,
    -7.1622537956e-04, 5.9479512523e-04, 1.6265725896e-03, 1.4453893471e-03, 0.0, -1.6851770248e-03,
    -2.2113315933e-03, -9.4316147430e-04, 1.3252116535e-03, 2.8230082458e-03, 2.1609413091e-03, -4.2774251049e-04,
    -3.0407506054e-03, -3.4729292080e-03, -1.0408755244e-03, 2.6175212598e-03, 4.5944095633e-03, 2.9870181150e-03,
    -1.3556627358e-03, -5.1638023571e-03, -5.1635664332e-03, -8.3000617273e-04, 4.7947775092e-03, 7.1684482593e-03,
    3.8549070467e-03, -3.1465108855e-03, -8.4719901162e-03, -7.4253930544e-03, 0.0, 8.4694919969e-03,
    1.1025485137e-02, 4.6751056386e-03, -6.5455515631e-03, -1.3928398434e-02, -1.0678919413e-02, 2.1234612851e-03,
    1.5213970338e-02, 1.7577250996e-02, 5.3512043234e-03, -1.3734339425e-02, -2.4740590876e-02, -1.6615062468e-02,
    7.8500235047e-03, 3.1422995870e-02, 3.3411035260e-02, 5.7969486598e-03, -3.6869005526e-02, -6.2363792308e-02,
    -3.9484772284e-02, 4.0430011266e-02, 1.5344255926e-01, 2.5242158607e-01, 2.9167938865e-01, 2.5242158607e-01,
    1.5344255926e-01, 4.0430011266e-02, -3.9484772284e-02, -6.2363792308e-02, -3.6869005526e-02, 5.7969486598e-03,
    3.3411035260e-02, 3.1422995870e-02, 7.8500235047e-03, -1.6615062468e-02, -2.4740590876e-02, -1.3734339425e-02,
    5.3512043234e-03, 1.7577250996e-02, 1.5213970338e-02, 2.1234612851e-03, -1.0678919413e-02, -1.3928398434e-02,
    -6.5455515631e-03, 4.6751056386e-03, 1.1025485137e-02, 8.4694919969e-03, 0.0, -7.4253930544e-03,
    -8.4719901162e-03, -3.1465108855e-03, 3.8549070467e-03, 7.1684482593e-03, 4.7947775092e-03, -8.3000617273e-04,
    -5.1635664332e-03, -5.1638023571e-03, -1.3556627358e-03, 2.9870181150e-03, 4.5944095633e-03, 2.6175212598e-03,
    -1.0408755244e-03, -3.4729292080e-03, -3.0407506054e-03, -4.2774251049e-04, 2.1609413091e-03, 2.8230082458e-03,
    1.3252116535e-03, -9.4316147430e-04, -2.2113315933e-03, -1.6851770248e-03, 0.0, 1.4453893471e-03,
    1.6265725896e-03, 5.9479512523e-04, -7.1622537956e-04, -1.3068320257e-03, -8.5623106897e-04, 1.4494500443e-04,
    8.8031820545e-04, 8.5800121193e-04, 2.1915188283e-04, -4.6895865057e-04, -6.9925032502e-04, -3.8545319203e-04,
    1.4801072446e-04, 4.7587470348e-04, 4.0060425678e-04, 5.4053998968e-05, -2.6127468192e-04, -3.2567646889e-04,
    -1.4544120191e-04, 9.8152836340e-05, 2.1743411517e-04, 1.5593604201e-04, 0.0, -1.1680888039e-04,
    -1.2183289018e-04, -4.1017681532e-05, 4.5121878191e-05, 7.4520595458e-05, 4.3702803887e-05, -6.5309446928e-06,
    -3.4405783761e-05, -2.8421554181e-05, -5.9594965022e-06,
];

struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn high_pass(sample_rate: f64, cutoff: f64, q: f64) -> Self {
        let w0 = 2.0 * std::f64::consts::PI * cutoff / sample_rate;
        let (sin_w0, cos_w0) = w0.sin_cos();
        let alpha = sin_w0 / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self {
            b0: ((1.0 + cos_w0) / 2.0) / a0,
            b1: (-(1.0 + cos_w0)) / a0,
            b2: ((1.0 + cos_w0) / 2.0) / a0,
            a1: (-2.0 * cos_w0) / a0,
            a2: (1.0 - alpha) / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

pub(crate) struct HighPass4 {
    sections: [Biquad; 2],
}

impl HighPass4 {
    pub(crate) fn new() -> Self {
        Self {
            sections: BUTTERWORTH4_SECTION_Q
                .map(|q| Biquad::high_pass(SAMPLE_RATE_HZ, HPF_CUTOFF_HZ, q)),
        }
    }

    #[inline]
    pub(crate) fn process(&mut self, x: f64) -> f64 {
        self.sections
            .iter_mut()
            .fold(x, |acc, section| section.process(acc))
    }
}

pub(crate) struct WindAwareMixer {
    low_pass_low: [f64; RAW_CHANNELS],
    low_pass_high: [f64; RAW_CHANNELS],
    turbulence: [f64; RAW_CHANNELS],
    alpha_low: f64,
    alpha_high: f64,
    alpha_energy: f64,
}

impl WindAwareMixer {
    pub(crate) fn new() -> Self {
        let one_pole =
            |cutoff: f64| 1.0 - (-2.0 * std::f64::consts::PI * cutoff / SAMPLE_RATE_HZ).exp();
        Self {
            low_pass_low: [0.0; RAW_CHANNELS],
            low_pass_high: [0.0; RAW_CHANNELS],
            turbulence: [0.0; RAW_CHANNELS],
            alpha_low: one_pole(MIX_LOW_CUTOFF_HZ),
            alpha_high: one_pole(MIX_HIGH_CUTOFF_HZ),
            alpha_energy: 1.0 - (-1.0 / (MIX_ENERGY_TIME_CONSTANT_S * SAMPLE_RATE_HZ)).exp(),
        }
    }

    #[inline]
    pub(crate) fn weights(&mut self, samples: &[f64; RAW_CHANNELS]) -> [f64; RAW_CHANNELS] {
        let mut low_band = [0.0; RAW_CHANNELS];
        for ch in 0..RAW_CHANNELS {
            let x = samples[ch];
            self.low_pass_low[ch] += self.alpha_low * (x - self.low_pass_low[ch]);
            self.low_pass_high[ch] += self.alpha_high * (x - self.low_pass_high[ch]);
            low_band[ch] = self.low_pass_high[ch] - self.low_pass_low[ch];
        }
        let mean = low_band.iter().sum::<f64>() / RAW_CHANNELS as f64;
        for (band, turbulence) in low_band.iter().zip(&mut self.turbulence) {
            let deviation = band - mean;
            *turbulence += self.alpha_energy * (deviation * deviation - *turbulence);
        }

        bounded_normalize(
            self.turbulence
                .map(|energy| 1.0 / (energy + MIX_TURBULENCE_FLOOR)),
        )
    }
}

fn bounded_normalize(raw: [f64; RAW_CHANNELS]) -> [f64; RAW_CHANNELS] {
    let mut weights = raw;
    let mut pinned = [false; RAW_CHANNELS];
    loop {
        let pinned_mass: f64 = weights
            .iter()
            .zip(&pinned)
            .filter(|(_, &p)| p)
            .map(|(w, _)| w)
            .sum();
        let free_mass: f64 = weights
            .iter()
            .zip(&pinned)
            .filter(|(_, &p)| !p)
            .map(|(w, _)| w)
            .sum();
        if free_mass <= 0.0 {
            return weights;
        }
        let scale = (1.0 - pinned_mass) / free_mass;

        let mut capped = false;
        for (w, p) in weights.iter_mut().zip(&mut pinned) {
            if !*p && *w * scale > MIX_MAX_WEIGHT {
                *w = MIX_MAX_WEIGHT;
                *p = true;
                capped = true;
            }
        }
        if capped {
            continue;
        }

        let mut floored = false;
        for (w, p) in weights.iter_mut().zip(&mut pinned) {
            if !*p && *w * scale < MIX_MIN_WEIGHT {
                *w = MIX_MIN_WEIGHT;
                *p = true;
                floored = true;
            }
        }
        if floored {
            continue;
        }

        for (w, p) in weights.iter_mut().zip(&pinned) {
            if !*p {
                *w *= scale;
            }
        }
        return weights;
    }
}

pub(crate) struct FirDecimator {
    history: [f32; DECIM_FIR_LEN * 2],
    position: usize,
    phase: usize,
}

impl FirDecimator {
    pub(crate) fn new() -> Self {
        Self {
            history: [0.0; DECIM_FIR_LEN * 2],
            position: 0,
            phase: 0,
        }
    }

    #[inline]
    pub(crate) fn push(&mut self, sample: f32) -> Option<f32> {
        self.history[self.position] = sample;
        self.history[self.position + DECIM_FIR_LEN] = sample;
        let window_start = self.position + 1;
        self.position = (self.position + 1) % DECIM_FIR_LEN;

        self.phase = (self.phase + 1) % DECIMATION_RATIO;
        if self.phase != 0 {
            return None;
        }

        let window = &self.history[window_start..window_start + DECIM_FIR_LEN];
        let mut acc = 0.0f32;
        for (tap, value) in DECIM_FIR_TAPS.iter().zip(window) {
            acc += tap * value;
        }
        Some(acc)
    }
}

pub(crate) struct Denoiser {
    state: Box<DenoiseState<'static>>,
    input: [f32; DenoiseState::FRAME_SIZE],
    output: [f32; DenoiseState::FRAME_SIZE],
    filled: usize,
    vad_peak: f32,
}

impl Denoiser {
    pub(crate) fn new() -> Self {
        let mut state = DenoiseState::new();
        let silence = [0.0f32; DenoiseState::FRAME_SIZE];
        let mut discard = [0.0f32; DenoiseState::FRAME_SIZE];
        state.process_frame(&mut discard, &silence);
        Self {
            state,
            input: [0.0; DenoiseState::FRAME_SIZE],
            output: [0.0; DenoiseState::FRAME_SIZE],
            filled: 0,
            vad_peak: 0.0,
        }
    }

    #[inline]
    pub(crate) fn push(&mut self, sample: f32) -> Option<&[f32]> {
        self.input[self.filled] = sample;
        self.filled += 1;
        if self.filled < DenoiseState::FRAME_SIZE {
            return None;
        }
        self.filled = 0;
        let vad = self.state.process_frame(&mut self.output, &self.input);
        self.vad_peak = self.vad_peak.max(vad);
        Some(&self.output)
    }

    pub(crate) fn take_vad_peak(&mut self) -> f32 {
        std::mem::take(&mut self.vad_peak)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn goertzel_power(samples: &[f32], sample_rate: f64, frequency: f64) -> f64 {
        let k = 2.0 * std::f64::consts::PI * frequency / sample_rate;
        let coeff = 2.0 * k.cos();
        let (mut s1, mut s2) = (0.0f64, 0.0f64);
        for &x in samples {
            let s0 = f64::from(x) + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (samples.len() as f64 * samples.len() as f64 / 4.0)
    }

    fn sine(frequency: f64, amplitude: f64, length: usize) -> Vec<f64> {
        (0..length)
            .map(|i| {
                amplitude
                    * (2.0 * std::f64::consts::PI * frequency * i as f64 / SAMPLE_RATE_HZ).sin()
            })
            .collect()
    }

    #[test]
    fn high_pass_kills_rumble_and_passes_speech_band() {
        let mut hpf = HighPass4::new();
        let input = sine(50.0, 10_000.0, 96_000);
        let out: Vec<f64> = input.iter().map(|&x| hpf.process(x)).collect();
        let rms = |x: &[f64]| (x.iter().map(|v| v * v).sum::<f64>() / x.len() as f64).sqrt();
        let attenuation_db = 20.0 * (rms(&out[48_000..]) / rms(&input[48_000..])).log10();
        assert!(
            attenuation_db < -22.0,
            "50 Hz attenuation {attenuation_db:.1} dB"
        );

        let mut hpf = HighPass4::new();
        let input = sine(1_000.0, 10_000.0, 96_000);
        let out: Vec<f64> = input.iter().map(|&x| hpf.process(x)).collect();
        let gain_db = 20.0 * (rms(&out[48_000..]) / rms(&input[48_000..])).log10();
        assert!(gain_db.abs() < 0.2, "1 kHz gain {gain_db:.2} dB");
    }

    #[test]
    fn decimator_passes_speech_and_rejects_aliasing_band() {
        let mut decimator = FirDecimator::new();
        let out: Vec<f32> = sine(1_000.0, 10_000.0, 96_000)
            .iter()
            .filter_map(|&x| decimator.push(x as f32))
            .collect();
        let passband = goertzel_power(&out[8_000..24_000], 16_000.0, 1_000.0);

        let mut decimator = FirDecimator::new();
        // 10 kHz at 48 kHz would fold to 6 kHz after naive decimation.
        let out: Vec<f32> = sine(10_000.0, 10_000.0, 96_000)
            .iter()
            .filter_map(|&x| decimator.push(x as f32))
            .collect();
        let alias = goertzel_power(&out[8_000..24_000], 16_000.0, 6_000.0);

        let rejection_db = 10.0 * (alias / passband).log10();
        assert!(rejection_db < -60.0, "alias rejection {rejection_db:.1} dB");
        let passband_db = 10.0 * (passband / (10_000.0f64 * 10_000.0)).log10();
        assert!(passband_db.abs() < 0.5, "passband gain {passband_db:.2} dB");
    }

    #[test]
    fn mixer_keeps_coherent_speech_at_equal_weights() {
        let mut mixer = WindAwareMixer::new();
        let speech = sine(150.0, 3_000.0, 96_000);
        let mut weights = [0.0; RAW_CHANNELS];
        for &s in &speech {
            weights = mixer.weights(&[s, s, s, s]);
        }
        for w in weights {
            assert!((w - 0.25).abs() < 0.02, "weights {weights:?}");
        }
    }

    #[test]
    fn mixer_downweights_wind_channel_and_suppresses_turbulence() {
        let mut mixer = WindAwareMixer::new();
        let speech = sine(150.0, 3_000.0, 144_000);
        let wind = sine(70.0, 12_000.0, 144_000);
        let mut mixed = Vec::with_capacity(speech.len());
        let mut naive = Vec::with_capacity(speech.len());
        let mut weights = [0.0; RAW_CHANNELS];
        for i in 0..speech.len() {
            let mut frame = [speech[i]; RAW_CHANNELS];
            frame[2] += wind[i];
            weights = mixer.weights(&frame);
            let mix: f64 = frame.iter().zip(weights).map(|(s, w)| s * w).sum();
            mixed.push(mix as f32);
            naive.push((frame.iter().sum::<f64>() / RAW_CHANNELS as f64) as f32);
        }
        assert!(weights[2] < 0.08, "wind channel weight {weights:?}");
        let tail = mixed.len() / 2..;
        let wind_mixed = goertzel_power(&mixed[tail.clone()], SAMPLE_RATE_HZ, 70.0);
        let wind_naive = goertzel_power(&naive[tail.clone()], SAMPLE_RATE_HZ, 70.0);
        let suppression_db = 10.0 * (wind_mixed / wind_naive).log10();
        assert!(
            suppression_db < -12.0,
            "wind suppression {suppression_db:.1} dB"
        );
        let speech_mixed = goertzel_power(&mixed[tail.clone()], SAMPLE_RATE_HZ, 150.0);
        let speech_naive = goertzel_power(&naive[tail], SAMPLE_RATE_HZ, 150.0);
        let speech_delta_db = 10.0 * (speech_mixed / speech_naive).log10();
        assert!(
            speech_delta_db.abs() < 1.0,
            "speech level shift {speech_delta_db:.2} dB"
        );
    }

    #[test]
    fn bounded_normalize_enforces_bounds_and_unit_sum() {
        let raw = [1e7f64, 1e3, 1e3, 1e3].map(|energy| 1.0 / (energy + MIX_TURBULENCE_FLOOR));
        let clean_dominant = bounded_normalize([raw[1], raw[0], raw[0], raw[0]]);
        assert!((clean_dominant.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        assert!(
            clean_dominant[0] <= MIX_MAX_WEIGHT + 1e-12,
            "{clean_dominant:?}"
        );

        let two_windy = bounded_normalize([raw[1], raw[1], raw[0], raw[0]]);
        assert!((two_windy.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        for w in two_windy {
            assert!(
                (MIX_MIN_WEIGHT - 1e-12..=MIX_MAX_WEIGHT + 1e-12).contains(&w),
                "{two_windy:?}"
            );
        }

        let equal = bounded_normalize([0.5; RAW_CHANNELS]);
        for w in equal {
            assert!((w - 0.25).abs() < 1e-12);
        }
    }

    #[test]
    fn denoiser_emits_full_frames_without_artifacts() {
        let mut denoiser = Denoiser::new();
        let input = sine(440.0, 8_000.0, DenoiseState::FRAME_SIZE * 10);
        let mut emitted = 0;
        for &s in &input {
            if let Some(block) = denoiser.push(s as f32) {
                emitted += block.len();
                assert!(block.iter().all(|v| v.is_finite()));
            }
        }
        assert_eq!(emitted, DenoiseState::FRAME_SIZE * 10);
    }
}
