// Robust observed heart-rate profile — the real min / max / average HR from recorded
// data, NOT a single reading. A lone spike (a stray 200 bpm from a motion artefact or a
// bad PPG read) must never set the max, so the "max" is corroboration-gated: it's the
// value the HR has actually reached at least CORROBORATION times. Same idea for the min.
// This gives an honest "current max HR recorded" to compare against the age-estimated max
// and to express live effort as a % of.

export interface ObservedHrProfile {
  /** Corroboration-gated observed min (bpm), or null if too little data. */
  min: number | null
  /** Corroboration-gated observed max (bpm) — a few stray high readings can't set it. */
  max: number | null
  /** Mean of the plausible readings (bpm), or null. */
  avg: number | null
  /** Count of plausible readings that fed the profile. */
  sampleCount: number
  /** True once there's enough data for the min/max to be trustworthy. */
  isReliable: boolean
  /**
   * Readings discarded as physiologically impossible (outside the plausible band) — a
   * genuine fault signal: a healthy sensor produces none of these.
   *
   * This replaces `spikesRejected`, which counted plausible readings above the reported
   * max. Because the max IS the k-th highest reading, that count is (k−1) minus any ties
   * at the max — 3 to 4 on ordinary data — whether or not a single artefact occurred. It
   * tracked k and the tie structure, not sensor faults, while the UI reported it to the
   * user as "N stray high readings ignored".
   */
  outOfBandRejected: number
  /**
   * The single highest plausible reading, before corroboration. Null under the same
   * conditions as `max`. The gap between this and `max` is the honest read on how spiky
   * the top of the data is — an interpretation left to the caller rather than compressed
   * into a count that needed an invented threshold to mean anything.
   */
  highestPlausible: number | null
}

// A physiologically plausible HR band; readings outside it are sensor errors and dropped
// before anything else (a 0 or a 300 is never a real human HR).
export const PLAUSIBLE_MIN_BPM = 30
export const PLAUSIBLE_MAX_BPM = 220
// The max must have been reached at least this many times — tolerates up to
// (CORROBORATION − 1) false-positive spikes without inflating the max.
export const CORROBORATION = 5
// Below this many plausible readings the profile is shown but flagged not-yet-reliable.
export const MIN_RELIABLE_SAMPLES = 60

export interface ObservedHrOptions {
  corroboration?: number
  minReliableSamples?: number
}

/** Compute a robust observed HR profile from a set of bpm readings. Pure — pass any
 *  readings (Oura 5-min series, workout HR, live samples). Never throws. */
export function computeObservedHr(bpms: readonly number[], opts?: ObservedHrOptions): ObservedHrProfile {
  const k = Math.max(1, opts?.corroboration ?? CORROBORATION)
  const minSamples = opts?.minReliableSamples ?? MIN_RELIABLE_SAMPLES

  const plausible = bpms.filter((b) => Number.isFinite(b) && b >= PLAUSIBLE_MIN_BPM && b <= PLAUSIBLE_MAX_BPM)
  const sampleCount = plausible.length
  const outOfBandRejected = bpms.length - sampleCount
  if (sampleCount === 0) {
    return {
      min: null, max: null, avg: null, sampleCount: 0, isReliable: false,
      outOfBandRejected: bpms.length, highestPlausible: null,
    }
  }

  const avg = Math.round(plausible.reduce((a, b) => a + b, 0) / sampleCount)

  // Not enough readings to corroborate a max/min — report the average only.
  if (sampleCount < k) {
    return { min: null, max: null, avg, sampleCount, isReliable: false, outOfBandRejected, highestPlausible: null }
  }

  const desc = [...plausible].sort((a, b) => b - a)
  // The k-th highest, NOT the k-th distinct value: heart rate varies continuously and
  // never repeats a bpm exactly, so requiring k identical readings would never trigger.
  // An order statistic needs no equality and no tolerance band — it just means "at least
  // k readings reached this level". The cost is that the reported max sits a few bpm below
  // the true peak (~3-5 on 5-min ring bins, ~2 on 1 Hz strap data), which errs in the safe
  // direction: a slightly low ceiling makes efforts read harder, never easier.
  const max = desc[k - 1]
  const min = desc[desc.length - k]

  return {
    min,
    max,
    avg,
    sampleCount,
    isReliable: sampleCount >= minSamples,
    outOfBandRejected,
    highestPlausible: desc[0],
  }
}

export interface MaxHrResolution {
  /** The max HR to use for effort math: the observed max when reliable and higher than
   *  the estimate, else the age estimate. */
  maxUsed: number
  source: 'observed' | 'estimated'
  observedMax: number | null
  estimatedMax: number
}

/** Decide which max HR to anchor effort on. The observed max wins only when it's reliable
 *  AND at least as high as the age estimate (a low observed max just means you haven't
 *  gone hard on a monitored session yet — don't let it drag the ceiling down). */
export function resolveMaxHr(observed: ObservedHrProfile, estimatedMax: number): MaxHrResolution {
  const useObserved = observed.isReliable && observed.max != null && observed.max >= estimatedMax
  return {
    maxUsed: useObserved ? observed.max! : estimatedMax,
    source: useObserved ? 'observed' : 'estimated',
    observedMax: observed.max,
    estimatedMax,
  }
}

/** Express a heart rate as a % of the resolved max (0–100+, rounded). Null for a
 *  non-positive max. */
export function pctOfMax(bpm: number, maxHr: number): number | null {
  if (!(maxHr > 0)) return null
  return Math.round((bpm / maxHr) * 100)
}
