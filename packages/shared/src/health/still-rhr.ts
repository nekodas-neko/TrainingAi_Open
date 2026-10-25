// A day's resting heart rate from its still daytime periods (#2634) — the value behind the shadow
// readiness model's `heart.daytime_rhr` unit.
//
// "Still" means the ring measured the minute and its MET stayed under the active threshold, and the
// wearer was not asleep. The gating and the median are the ones the nightly HRV/RHR already use
// (`metActiveWindows` + `medianGated`, `daily-medians.ts`): this module only picks which readings
// stand for a daytime rest, and says how many minutes stand behind the number.
//
// Source-agnostic and pure: it takes a MET minute grid, heart-rate readings and sleep windows on one
// clock (milliseconds). Today the caller is the Oura Cloud path (`lib/oura/cloud/still-rhr.ts`), whose
// heart rate is a reading about every 5 minutes.

import { inAnyWindow, medianGated, metActiveWindows, MET_ACTIVE_THRESHOLD, type ExclusionWindow, type TimedSample } from './daily-medians'
import { HR_PLAUSIBLE_MAX, HR_PLAUSIBLE_MIN } from './night-vitals'

/** MET is a 1-minute grid: one reading covers this long from its timestamp. */
export const MET_MINUTE_MS = 60_000

/** What one Oura Cloud heart-rate reading stands for: the ~5 minutes around its timestamp. */
export const CLOUD_HR_COVER_MS = 5 * MET_MINUTE_MS

/**
 * Still minutes a day needs before its value is stored — below it the day is null, never 0 and never a
 * thin median. The same 60 the Body Battery uses as the least waking time it will judge a day on
 * (`MIN_WAKING_MINUTES_TO_JUDGE`); the stress model's own 240-minute gate is for a model that scores
 * 30-minute buckets across the whole day, which a median does not need.
 *
 * It is counted in MINUTES, not readings, and a reading counts the minutes it stands for
 * (`hrCoverMs`). With heart rate every ~5 minutes that is 12 readings of fully still time, not 60: a
 * floor in readings would have asked for five hours of stillness.
 */
export const STILL_RHR_MIN_COVERAGE_MIN = 60

export interface StillRhrInput {
  /** Heart-rate readings with their time. */
  hr: readonly { tsMs: number; bpm: number }[]
  /** MET readings, one per minute starting at `tsMs`. A minute with no reading is not measured. */
  met: readonly { tsMs: number; value: number }[]
  /** Recorded sleep (nights and naps), which is not a daytime rest. */
  sleepWindows: readonly { startMs: number; endMs: number }[]
  /** The local day, `[dayStartMs, dayEndMs)`. */
  dayStartMs: number
  dayEndMs: number
  /**
   * How long one heart-rate reading stands for, centred on its timestamp. A reading counts only when
   * EVERY minute it stands for was measured and still, so a 5-minute average that spans a walk is
   * dropped whole. 0 = the reading stands for the one minute it falls in.
   */
  hrCoverMs?: number
}

export interface StillRhr {
  bpm: number
  /** Distinct still minutes that readings stand for. */
  coverageMin: number
}

/**
 * The median heart rate of the day's still readings, with their coverage, or null when fewer than
 * `minCoverageMin` still minutes stand behind them.
 */
export function stillDaytimeRhr(inp: StillRhrInput, minCoverageMin = STILL_RHR_MIN_COVERAGE_MIN): StillRhr | null {
  const met: TimedSample[] = inp.met
    .filter(m => Number.isFinite(m.value))
    .map(m => ({ ds: m.tsMs, value: m.value }))
    .sort((a, b) => a.ds - b.ds)
  if (met.length === 0) return null

  const exclude: ExclusionWindow[] = [
    ...metActiveWindows(met, MET_MINUTE_MS, MET_ACTIVE_THRESHOLD),
    ...inp.sleepWindows.map(w => ({ startDs: w.startMs, endDs: w.endMs })),
  ]
  // A minute is still when it was measured and sits in no exclusion window. Keyed by its start.
  const measured = new Set(met.map(m => m.ds))
  const stillMinutes = new Set<number>()
  for (const m of met) {
    // The window of a minute that follows an active one starts at that minute's end, which is this
    // minute's start: test the minute's middle so the boundary does not drop it.
    if (!inAnyWindow(m.ds + MET_MINUTE_MS / 2, exclude)) stillMinutes.add(m.ds)
  }

  const cover = Math.max(0, inp.hrCoverMs ?? 0)
  const qualifying: (TimedSample & { minutes: number[] })[] = []
  for (const h of inp.hr) {
    if (h.tsMs < inp.dayStartMs || h.tsMs >= inp.dayEndMs) continue
    if (!(h.bpm >= HR_PLAUSIBLE_MIN && h.bpm <= HR_PLAUSIBLE_MAX)) continue
    // The minutes this reading stands for, by their start: those whose middle is inside the span.
    const half = cover / 2
    // Half-open, so a reading on a minute boundary stands for exactly `cover` of minutes, not one more.
    const first = cover > 0 ? Math.ceil((h.tsMs - half - MET_MINUTE_MS / 2) / MET_MINUTE_MS) : Math.floor(h.tsMs / MET_MINUTE_MS)
    const last = cover > 0 ? Math.ceil((h.tsMs + half - MET_MINUTE_MS / 2) / MET_MINUTE_MS) - 1 : first
    const minutes: number[] = []
    for (let k = first; k <= last; k++) minutes.push(k * MET_MINUTE_MS)
    if (minutes.length === 0) continue
    if (!minutes.every(m => measured.has(m) && stillMinutes.has(m))) continue
    qualifying.push({ ds: h.tsMs, value: h.bpm, minutes })
  }

  const covered = new Set<number>()
  for (const q of qualifying) for (const m of q.minutes) covered.add(m)
  if (covered.size < minCoverageMin) return null

  const bpm = medianGated(qualifying)
  return bpm == null ? null : { bpm, coverageMin: covered.size }
}
