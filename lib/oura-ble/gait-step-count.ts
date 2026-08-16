/**
 * Gait-gated step counting over a captured accelerometer-magnitude chunk (Tier 2, the
 * accurate ring step path). This is the ONE place walking is separated from non-walk
 * hand motion — the rollup, the live tester, and any future native counter share it.
 *
 * Why gating: a naive peak counter over the ring's 0x33 accel stream counts real walking
 * accurately (owner capture 2026-07-13: 30 real → 31 counted) but ALSO counts irregular
 * hand motion — cooking/gesturing peak-counted 114 "steps" over 61 s of zero real steps.
 * That is the same false-positive class that made the col14 gate and the naive peak
 * counter unusable for a daily total.
 *
 * The discriminator is PERIODICITY, not peak height. Walking is a sustained rhythm in the
 * 1.4–2.8 steps/s band; hand motion is irregular and cannot hold one. Per ~2.5 s window we
 * take the strongest normalized autocorrelation in that lag band ("rhythm strength" r):
 *   - walk-30 capture: r mean 0.53, max 0.67, 74% of windows ≥ 0.5
 *   - handwave-0 capture: r mean 0.17, max 0.42, 0% of windows ≥ 0.5
 * Gating the peak count to windows above r ≥ 0.45 (with a ramp-up back-fill + short
 * hysteresis) reproduces walk-30 → 31 and handwave-0 → 0 (see the unit test's real fixtures).
 *
 * Under-counts, if anything, are the safe direction (a missed start/stop ramp), never the
 * runaway over-count the old estimate produced. Constants are calibrated to those two real
 * captures — retune here (One-Formula-One-Place) as more labelled captures accrue.
 */
import { BASELINE_ALPHA, PEAK_RATIO, MIN_STEP_GAP_SEC, MIN_STEP_GAP_SAMPLES } from './accel'
import { bandAutocorrPeak } from '@trainingai/shared/health/cadence'

/** Walking cadence band (steps/s) the rhythm gate searches. */
export const GAIT_CADENCE_MIN_HZ = 1.4
export const GAIT_CADENCE_MAX_HZ = 2.8
/** Analysis window (~2.5 s @ 50 Hz) and hop (~0.5 s). Long enough to resolve a ~2 Hz
 *  rhythm, short enough to localise a bout's start/end. */
export const GAIT_WINDOW_SAMPLES = 125
export const GAIT_HOP_SAMPLES = 25
/** Rhythm-strength gate: walking sustains ≥ ~0.5, hand motion tops out ~0.42. */
export const GAIT_AUTOCORR_GATE = 0.45
/** Consecutive non-periodic hops that end a walking bout (bridges brief dips at a turn). */
export const GAIT_END_MISS_BLOCKS = 2

/**
 * Strongest normalized autocorrelation of a detrended window within the gait cadence band.
 * ~1.0 for a clean rhythm at a lag in-band, ~0 for irregular/aperiodic motion.
 *
 * Delegates to the shared band-autocorrelation primitive in lib/health/cadence.ts so there is
 * one implementation for both the gait gate and cadence. The primitive's interpolation and
 * octave correction are deliberately DISABLED here: this function's output feeds
 * `GAIT_AUTOCORR_GATE`, whose value is calibrated against real walk-30/handwave-0 captures,
 * and those refinements would shift the returned strength. Cadence wants them; a gate that
 * only asks "is there a rhythm" does not.
 */
export function gaitBandAutocorr(window: number[], sampleRate: number): number {
  const peak = bandAutocorrPeak(window, sampleRate, GAIT_CADENCE_MIN_HZ, GAIT_CADENCE_MAX_HZ, {
    interpolate: false,
    octaveCorrect: false,
    roundLagBounds: true,
  })
  return peak ? Math.max(0, peak.strength) : 0
}

/** Per-sample "is walking" mask: true only inside a sustained-rhythm bout. */
function walkingMask(magnitudes: number[], sampleRate: number): boolean[] {
  const n = magnitudes.length
  const mask = new Array<boolean>(n).fill(false)
  const win = GAIT_WINDOW_SAMPLES
  const hop = GAIT_HOP_SAMPLES
  let inBout = false
  let miss = 0
  for (let s = 0; s + win <= n; s += hop) {
    const periodic = gaitBandAutocorr(magnitudes.slice(s, s + win), sampleRate) >= GAIT_AUTOCORR_GATE
    if (periodic) {
      // Rhythm just locked — the window before the lock was the walk's ramp-up (real
      // steps whose rhythm hadn't accrued yet), so back-fill it as walking.
      if (!inBout) for (let i = Math.max(0, s - win); i < s + win && i < n; i++) mask[i] = true
      inBout = true
      miss = 0
    } else if (inBout && ++miss >= GAIT_END_MISS_BLOCKS) {
      inBout = false
    }
    for (let i = s + win - hop; i < s + win && i < n; i++) mask[i] = inBout
  }
  return mask
}

/**
 * Count steps from a captured accel-magnitude chunk, counting peaks only while a walking
 * rhythm is present. Same peak detector as `StepPeakCounter` (EMA baseline, relative-
 * threshold turning point, refractory), gated by {@link walkingMask}.
 */
export function countGaitGatedSteps(magnitudes: number[], sampleRate: number): number {
  const n = magnitudes.length
  if (n === 0) return 0
  const mask = walkingMask(magnitudes, sampleRate)
  const refractory =
    Number.isFinite(sampleRate) && sampleRate > 0
      ? Math.max(MIN_STEP_GAP_SAMPLES, Math.round(sampleRate * MIN_STEP_GAP_SEC))
      : MIN_STEP_GAP_SAMPLES
  let baseline = 0
  let prevDeviation = 0
  let rising = false
  let lastPeakAt = -Infinity
  let count = 0
  for (let i = 0; i < n; i++) {
    const m = magnitudes[i]
    if (baseline === 0) {
      baseline = m
      continue
    }
    baseline += BASELINE_ALPHA * (m - baseline)
    const deviation = m - baseline
    if (deviation > prevDeviation) {
      rising = deviation > baseline * PEAK_RATIO
    } else if (rising) {
      rising = false
      if (mask[i] && i - lastPeakAt >= refractory) {
        count++
        lastPeakAt = i
      }
    }
    prevDeviation = deviation
  }
  return count
}
