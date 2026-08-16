// The night's headline vitals — HRV, resting HR, average HR — from decoded ring events.
//
// These three numbers have a specific, non-obvious definition that has been settled once and must
// not be re-derived. They lived inline inside `aggregateOuraRawSamples` (a ~1,100-line repository
// method), which meant they could only be exercised through a database, and the on-device rollup
// (backlog Q-29 / D2 Task 5) would have had to re-implement them — a second implementation of the
// same metric, which is a bug by definition.
//
// The rules, all pinned by the Oura on-device program's Review Outcome:
//
//  - **HRV is a quality-gated MEDIAN of the ring's own `0x5d` rmssd_ms, never a mean and never a
//    recompute from IBI.** Recomputing from per-beat intervals gives a different, un-comparable
//    number.
//  - **Resting HR is the lowest 5-minute BIN AVERAGE, never the raw per-beat minimum.** The
//    decoder caps an interval at 2000 ms, i.e. exactly 30 bpm, so a single missed beat produces a
//    plausible-looking minimum that a raw `min()` would seize on.
//  - **MET gating applies to both, from the same windows.** HRV and resting HR must drop the same
//    active periods or the two disagree about what "at rest" meant that night.

import { medianGated, metActiveWindows, type TimedSample, type ExclusionWindow } from './daily-medians'

/** A decoded ring event: its deciseconds timestamp and the decoder's payload object. */
export interface DecodedRow {
  ds: number | string
  decoded: unknown
}

/** The 0x50 activity stream is on a 1-minute grid — 600 deciseconds per MET bin. */
export const MET_SAMPLE_STEP_DS = 600
/** Each 0x5d event carries several 5-minute pairs; stagger them so the MET gate lines up. */
export const HRV_PAIR_DS = 5 * 60 * 10
export const HR_BIN_DS = 5 * 60 * 10
/** Outside this band a beat is an artifact, not a reading. */
export const HR_PLAUSIBLE_MIN = 35
export const HR_PLAUSIBLE_MAX = 150
/** A 5-minute bin needs this many beats before its average is worth comparing. */
export const MIN_BEATS_PER_BIN = 3

/** Pull a numeric array off a decoder payload, tolerating a missing or mistyped key. */
export function numericField(decoded: unknown, key: string): number[] {
  const arr = (decoded as Record<string, unknown> | null)?.[key]
  return Array.isArray(arr) ? arr.filter((v): v is number => typeof v === 'number') : []
}

/**
 * Active-period windows to exclude, from the 0x50 activity stream.
 *
 * Each event holds a run of per-minute MET values; expand them onto the grid and let
 * `metActiveWindows` pad each active bin. In-sleep MET sits near baseline, so at night this
 * rarely fires — which is the point: when it does fire, something real happened.
 */
export function metExclusionWindows(metRows: DecodedRow[], padDs = MET_SAMPLE_STEP_DS): ExclusionWindow[] {
  const samples: TimedSample[] = []
  for (const r of metRows) {
    const mets = numericField(r.decoded, 'met')
    for (let i = 0; i < mets.length; i++) {
      samples.push({ ds: Number(r.ds) + i * MET_SAMPLE_STEP_DS, value: mets[i] })
    }
  }
  return metActiveWindows(samples, padDs)
}

/**
 * The RMSSD samples a night's HRV is taken over, already accuracy-gated.
 *
 * Two gates are available over BLE: the MET exclusion (applied by the caller, via `medianGated`)
 * and an accuracy **proxy** — drop a pair whose own `hr_bpm` is implausible. The ring carries no
 * `hrv_accuracy` byte, so this is best-effort and explicitly NOT parity with Oura's own gating.
 */
export function rmssdSamples(hrvRows: DecodedRow[]): TimedSample[] {
  const out: TimedSample[] = []
  for (const r of hrvRows) {
    const rm = numericField(r.decoded, 'rmssd_ms')
    const hb = numericField(r.decoded, 'hr_bpm')
    for (let i = 0; i < rm.length; i++) {
      if (!(rm[i] > 0)) continue
      const hr = hb[i]
      if (hr != null && (hr < HR_PLAUSIBLE_MIN || hr > HR_PLAUSIBLE_MAX)) continue
      out.push({ ds: Number(r.ds) + i * HRV_PAIR_DS, value: rm[i] })
    }
  }
  return out
}

/**
 * The HRV headline in milliseconds from samples already extracted, rounded to 0.1.
 *
 * Split from {@link nightlyHrvMs} for callers that also need the individual samples — the
 * chronic-stress model takes the raw list — so the two never come from separate extraction passes.
 */
export function hrvMsFromSamples(samples: TimedSample[], exclusion: ExclusionWindow[]): number | null {
  const m = medianGated(samples, exclusion)
  return m != null ? Math.round(m * 10) / 10 : null
}

/** The night's HRV headline in milliseconds, rounded to 0.1, or null when nothing survives gating. */
export function nightlyHrvMs(hrvRows: DecodedRow[], exclusion: ExclusionWindow[]): number | null {
  return hrvMsFromSamples(rmssdSamples(hrvRows), exclusion)
}

/** One 5-minute heart-rate bin: its index on the `HR_BIN_DS` grid and the beats it holds. */
export interface HrBin {
  /** Multiply by `HR_BIN_DS` for the bin's start in deciseconds. */
  bin: number
  averageBpm: number
  beatCount: number
}

export interface NightHeartRate {
  /** Lowest qualifying 5-minute bin average — Oura's "lowest", not a per-beat minimum. */
  restingHrBpm: number | null
  /** Mean over every plausible beat in the window. */
  averageHrBpm: number | null
  /** Beats that passed the plausibility band — 0 means the night has no usable HR. */
  beatCount: number
  /**
   * Every non-empty bin, ascending. Returned rather than recomputed because the Recovery Index
   * needs exactly this series (hours between the smoothed overnight minimum and wake) and a second
   * binning pass would be a second definition of "the night's HR curve".
   *
   * Note these are ALL non-empty bins, including ones disqualified from resting HR for having too
   * few beats or overlapping a MET window — the recovery curve wants the shape of the whole night.
   */
  bins: HrBin[]
}

/**
 * Resting and average heart rate for one sleep window.
 *
 * A bin is disqualified by having too few beats OR by overlapping a MET active period — the same
 * windows HRV drops, so the two numbers agree about when the night was at rest.
 */
export function nightlyHeartRate(ibiRows: DecodedRow[], exclusion: ExclusionWindow[]): NightHeartRate {
  const bins = new Map<number, { sum: number; n: number }>()
  let sum = 0
  let n = 0
  for (const r of ibiRows) {
    const bin = Math.floor(Number(r.ds) / HR_BIN_DS)
    const b = bins.get(bin) ?? { sum: 0, n: 0 }
    for (const v of numericField(r.decoded, 'hr_bpm')) {
      if (v < HR_PLAUSIBLE_MIN || v > HR_PLAUSIBLE_MAX) continue
      b.sum += v
      b.n += 1
      sum += v
      n += 1
    }
    bins.set(bin, b)
  }

  const overlapsMet = (bin: number) => {
    const start = bin * HR_BIN_DS
    const end = start + HR_BIN_DS
    return exclusion.some(w => start < w.endDs && end > w.startDs)
  }

  let restingHrBpm: number | null = null
  for (const [bin, b] of bins.entries()) {
    if (b.n < MIN_BEATS_PER_BIN || overlapsMet(bin)) continue
    const avg = b.sum / b.n
    if (restingHrBpm === null || avg < restingHrBpm) restingHrBpm = avg
  }

  const ordered: HrBin[] = Array.from(bins.entries())
    .filter(([, b]) => b.n > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([bin, b]) => ({ bin, averageBpm: b.sum / b.n, beatCount: b.n }))

  return { restingHrBpm, averageHrBpm: n > 0 ? sum / n : null, beatCount: n, bins: ordered }
}
