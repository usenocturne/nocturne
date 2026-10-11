use std::collections::VecDeque;
use std::sync::Arc;

use realfft::num_complex::Complex;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};

use super::{RAW_CHANNEL_COUNT, RAW_FRAME_BYTES, RAW_SAMPLE_BYTES, RAW_SAMPLE_SCALE};

pub(crate) const BLOCK_SAMPLES: usize = 2880;
const FFT_SIZE: usize = 4096;
const MAX_LAG: usize = 24;
const BAND_LOW_HZ: f64 = 300.0;
const BAND_HIGH_HZ: f64 = 4000.0;
const PENDING_LIMIT: usize = 8;
pub(crate) const PAIR_COUNT: usize = 6;
const PAIRS: [(usize, usize); PAIR_COUNT] = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)];

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FrameDirection {
    pub(crate) lags: [f32; PAIR_COUNT],
    pub(crate) peak: f32,
}

pub(crate) struct DirectionEstimator {
    carry: Vec<u8>,
    block: Vec<[f64; RAW_CHANNEL_COUNT]>,
    window: Vec<f64>,
    forward: Arc<dyn RealToComplex<f64>>,
    inverse: Arc<dyn ComplexToReal<f64>>,
    input: Vec<f64>,
    spectra: [Vec<Complex<f64>>; RAW_CHANNEL_COUNT],
    cross: Vec<Complex<f64>>,
    correlation: Vec<f64>,
    band: std::ops::RangeInclusive<usize>,
    next_index: u64,
    pending: VecDeque<(u64, FrameDirection)>,
}

impl DirectionEstimator {
    pub(crate) fn new() -> Self {
        let mut planner = RealFftPlanner::<f64>::new();
        let forward = planner.plan_fft_forward(FFT_SIZE);
        let inverse = planner.plan_fft_inverse(FFT_SIZE);
        let bin_hz = 48_000.0 / FFT_SIZE as f64;
        let window = (0..BLOCK_SAMPLES)
            .map(|n| {
                0.5 - 0.5
                    * (2.0 * std::f64::consts::PI * n as f64 / (BLOCK_SAMPLES - 1) as f64).cos()
            })
            .collect();
        Self {
            carry: Vec::with_capacity(RAW_FRAME_BYTES),
            block: Vec::with_capacity(BLOCK_SAMPLES),
            window,
            input: forward.make_input_vec(),
            spectra: std::array::from_fn(|_| forward.make_output_vec()),
            cross: inverse.make_input_vec(),
            correlation: inverse.make_output_vec(),
            forward,
            inverse,
            band: (BAND_LOW_HZ / bin_hz).ceil() as usize..=(BAND_HIGH_HZ / bin_hz).floor() as usize,
            next_index: 0,
            pending: VecDeque::with_capacity(PENDING_LIMIT),
        }
    }

    pub(crate) fn push_raw(&mut self, raw: &[u8]) {
        let mut raw = raw;
        if !self.carry.is_empty() {
            let needed = (RAW_FRAME_BYTES - self.carry.len()).min(raw.len());
            self.carry.extend_from_slice(&raw[..needed]);
            raw = &raw[needed..];
            if self.carry.len() < RAW_FRAME_BYTES {
                return;
            }
            let frame = std::mem::take(&mut self.carry);
            self.push_frame(&frame);
            self.carry = frame;
            self.carry.clear();
        }
        let mut frames = raw.chunks_exact(RAW_FRAME_BYTES);
        for frame in &mut frames {
            self.push_frame(frame);
        }
        self.carry.extend_from_slice(frames.remainder());
    }

    pub(crate) fn take(&mut self, index: u64) -> Option<FrameDirection> {
        while let Some((pending, direction)) = self.pending.front().copied() {
            if pending > index {
                return None;
            }
            self.pending.pop_front();
            if pending == index {
                return Some(direction);
            }
        }
        None
    }

    fn push_frame(&mut self, frame: &[u8]) {
        let mut samples = [0.0f64; RAW_CHANNEL_COUNT];
        for (sample, bytes) in samples.iter_mut().zip(frame.chunks_exact(RAW_SAMPLE_BYTES)) {
            let value = i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            *sample = f64::from(value) / RAW_SAMPLE_SCALE;
        }
        self.block.push(samples);
        if self.block.len() < BLOCK_SAMPLES {
            return;
        }
        let index = self.next_index;
        self.next_index += 1;
        if let Some(direction) = self.estimate() {
            if self.pending.len() == PENDING_LIMIT {
                self.pending.pop_front();
            }
            self.pending.push_back((index, direction));
        }
        self.block.clear();
    }

    fn estimate(&mut self) -> Option<FrameDirection> {
        for channel in 0..RAW_CHANNEL_COUNT {
            let mean = self
                .block
                .iter()
                .map(|samples| samples[channel])
                .sum::<f64>()
                / BLOCK_SAMPLES as f64;
            self.input.fill(0.0);
            for ((input, samples), weight) in
                self.input.iter_mut().zip(&self.block).zip(&self.window)
            {
                *input = (samples[channel] - mean) * weight;
            }
            self.forward
                .process(&mut self.input, &mut self.spectra[channel])
                .ok()?;
        }

        let bins = (self.band.end() - self.band.start() + 1) as f64;
        let mut lags = [0.0f32; PAIR_COUNT];
        let mut peak_sum = 0.0f64;
        for (pair, (left, right)) in PAIRS.into_iter().enumerate() {
            self.cross.fill(Complex::new(0.0, 0.0));
            for bin in self.band.clone() {
                let cross = self.spectra[left][bin] * self.spectra[right][bin].conj();
                self.cross[bin] = cross / (cross.norm() + 1e-9);
            }
            self.inverse
                .process(&mut self.cross, &mut self.correlation)
                .ok()?;
            let at = |offset: usize| {
                let index = (FFT_SIZE - MAX_LAG + offset) % FFT_SIZE;
                self.correlation[index] / (2.0 * bins)
            };
            let mut best = 0;
            for offset in 1..=2 * MAX_LAG {
                if at(offset) > at(best) {
                    best = offset;
                }
            }
            let mut refined = 0.0;
            if best > 0 && best < 2 * MAX_LAG {
                let (before, center, after) = (at(best - 1), at(best), at(best + 1));
                let denominator = before - 2.0 * center + after;
                if denominator != 0.0 {
                    refined = 0.5 * (before - after) / denominator;
                }
            }
            lags[pair] = (best as f64 - MAX_LAG as f64 + refined) as f32;
            peak_sum += at(best);
        }
        Some(FrameDirection {
            lags,
            peak: (peak_sum / PAIR_COUNT as f64) as f32,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_with_delays(delays: [usize; RAW_CHANNEL_COUNT], frames: usize) -> Vec<u8> {
        let mut state = 0x2545_f491_u64;
        let source: Vec<f64> = (0..frames * BLOCK_SAMPLES + 64)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                (state % 20_000) as f64 - 10_000.0
            })
            .collect();
        (0..frames * BLOCK_SAMPLES)
            .flat_map(|n| {
                delays
                    .map(|delay| ((source[n + 64 - delay] * RAW_SAMPLE_SCALE) as i32).to_le_bytes())
            })
            .flatten()
            .collect()
    }

    #[test]
    fn recovers_pair_delays_independent_of_chunking() {
        let raw = raw_with_delays([0, 3, 7, 12], 3);
        for chunk in [1, 17, 4096, raw.len()] {
            let mut estimator = DirectionEstimator::new();
            for part in raw.chunks(chunk) {
                estimator.push_raw(part);
            }
            for index in 0..3 {
                let direction = estimator.take(index).unwrap();
                let expected = [-3.0, -7.0, -12.0, -4.0, -9.0, -5.0];
                for (lag, expected) in direction.lags.iter().zip(expected) {
                    assert!((lag - expected).abs() < 0.25, "{:?}", direction.lags);
                }
                assert!(direction.peak > 0.5, "peak {}", direction.peak);
            }
            assert!(estimator.take(3).is_none());
        }
    }

    #[test]
    fn take_skips_stale_estimates_and_never_returns_future_ones() {
        let mut estimator = DirectionEstimator::new();
        estimator.push_raw(&raw_with_delays([0; RAW_CHANNEL_COUNT], 3));
        assert!(estimator.take(1).is_some());
        assert!(estimator.take(0).is_none());
        assert!(estimator.take(5).is_none());
        assert!(estimator.take(2).is_none());
    }
}
