// Breathing-rate irregularity from inter-beat intervals (IBI) — a REM-vs-deep discriminator.
//
// Physiology: respiratory sinus arrhythmia (RSA) modulates heart rate with the breath — HR speeds
// up on inhale, slows on exhale — so the IBI "tachogram" (IBI value vs beat time) oscillates once
// per breath. In deep sleep breathing is slow and metronome-regular → a clean periodic tachogram;
// in REM (and wake) breathing rate wanders → a jittery one. We quantify that irregularity.
//
// We deliberately do NOT try to reproduce Oura's exact breaths-per-minute: their ecore port needs a
// resample kernel the reverse-engineering never recovered (`docs/algorithms/README.md`). We only
// need a *discriminative* signal, so this stays a self-contained, well-behaved estimator that
// returns null when the beat stream is too sparse/short to trust (neutral in the stager).

import { resampleTachogram } from './tachogram'

const FS = 2 // Hz — tachogram resample rate
const DT_MS = 1000 / FS
const DETREND_WIN = 20 // samples (10 s at 2 Hz) — removes drift slower than a breath (~3–6 s period)
const MIN_BREATH_S = 2 // ≥ 2 s between breaths (≤ 30 breaths/min) — rejects noise wiggles as breaths
const MIN_BEATS = 40 // fewer than this in an epoch → not enough to see several breaths
const MIN_BREATHS = 4 // need a few inter-breath intervals to measure their variability

export interface BreathingResult {
  /** Breaths per minute (rough — for display/debug only, not calibrated to Oura). */
  rateBrpm: number | null
  /** Irregularity of the breath-to-breath timing (coefficient of variation). Higher = more
   *  irregular breathing = REM/wake; lower = regular = deep. null when not derivable. */
  variability: number | null
}

const NULL_RESULT: BreathingResult = { rateBrpm: null, variability: null }

/**
 * Estimate breathing rate and its irregularity from an ordered sequence of IBI values (ms) within
 * one epoch. Resamples the tachogram to an even grid, detrends to isolate the respiratory band,
 * peak-picks the breaths, and reports the coefficient of variation of the inter-breath intervals.
 */
export function breathingFromIbi(ibiMs: number[]): BreathingResult {
  const tacho = resampleTachogram(ibiMs, FS)
  if (!tacho || tacho.beatCount < MIN_BEATS) return NULL_RESULT

  const { grid } = tacho
  const nGrid = grid.length
  if (nGrid < DETREND_WIN * 2) return NULL_RESULT

  // Detrend: subtract a centred moving average (window > one breath) to isolate the RSA oscillation.
  const half = Math.floor(DETREND_WIN / 2)
  const detr = new Array<number>(nGrid)
  for (let g = 0; g < nGrid; g++) {
    let sum = 0, cnt = 0
    for (let j = Math.max(0, g - half); j <= Math.min(nGrid - 1, g + half); j++) { sum += grid[j]; cnt++ }
    detr[g] = grid[g] - sum / cnt
  }

  // Signal amplitude — the peak threshold scales with it so noise wiggles aren't counted as breaths.
  const sd = Math.sqrt(detr.reduce((a, b) => a + b * b, 0) / nGrid)
  if (sd <= 0) return NULL_RESULT
  const thresh = 0.25 * sd
  const minGap = Math.round(MIN_BREATH_S * FS)

  // Peak-pick: local maxima above threshold, enforcing a minimum spacing (keep the higher of two
  // peaks that fall within minGap of each other).
  const peaks: number[] = []
  for (let g = 1; g < nGrid - 1; g++) {
    if (detr[g] <= thresh) continue
    if (detr[g] < detr[g - 1] || detr[g] < detr[g + 1]) continue
    const last = peaks[peaks.length - 1]
    if (last != null && g - last < minGap) {
      if (detr[g] > detr[last]) peaks[peaks.length - 1] = g
    } else {
      peaks.push(g)
    }
  }
  if (peaks.length < MIN_BREATHS) return NULL_RESULT

  // Inter-breath intervals (seconds) → rate + irregularity.
  const ibis: number[] = []
  for (let i = 1; i < peaks.length; i++) ibis.push(((peaks[i] - peaks[i - 1]) * DT_MS) / 1000)
  const m = ibis.reduce((a, b) => a + b, 0) / ibis.length
  if (m <= 0) return NULL_RESULT
  const variance = ibis.reduce((a, b) => a + (b - m) ** 2, 0) / ibis.length
  const cv = Math.sqrt(variance) / m

  return { rateBrpm: Math.round((60 / m) * 10) / 10, variability: Math.round(cv * 1000) / 1000 }
}
