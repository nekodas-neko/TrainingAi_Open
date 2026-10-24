// A day's resting heart rate from its still daytime periods (#2634) — the value behind the shadow
// readiness model's `heart.daytime_rhr` unit.
//
// "Still" means the ring measured the minute and its MET stayed under the active threshold, and the
// wearer was not asleep. The gating and the median are the ones the nightly HRV/RHR already use
// (`metActiveWindows` + `medianGated`, `daily-medians.ts`): this module only picks which samples
// stand for a daytime rest, and says how many minutes stand behind the number.
//
// Pure: it takes decoded samples on one shared clock (milliseconds) and returns a value or null.

import { inAnyWindow, medianGated, metActiveWindows, MET_ACTIVE_THRESHOLD, type ExclusionWindow, type TimedSample } from './daily-medians'
import { HR_PLAUSIBLE_MAX, HR_PLAUSIBLE_MIN, MET_SAMPLE_STEP_DS } from './night-vitals'

/** One MET reading covers this long after its timestamp (the 0x50 stream is a 1-minute grid). */
export const MET_MINUTE_MS = MET_SAMPLE_STEP_DS * 100

/**
 * Still minutes with a heart rate that a day needs before its value is stored — below it the day
 * is null, never 0 and never a thin median. The same 60 the Body Battery uses as the least waking
 * time it will judge a day on (`MIN_WAKING_MINUTES_TO_JUDGE`); the stress model's own 240-minute
 * gate is for a model that scores 30-minute buckets across the whole day, which a median does not
 * need.
 */
export const STILL_RHR_MIN_COVERAGE_MIN = 60

export interface StillRhrInput {
  /** Heart-rate readings with their time. Several readings may share one timestamp (one frame). */
  hr: readonly { tsMs: number; bpm: number }[]
  /** MET readings, each at its own minute (the caller staggers a frame's values onto the grid). */
  met: readonly { tsMs: number; value: number }[]
  /** Recorded sleep, which is not a daytime rest. */
  sleepWindows: readonly { startMs: number; endMs: number }[]
  /** The local day, `[dayStartMs, dayEndMs)`. */
  dayStartMs: number
  dayEndMs: number
}

export interface StillRhr {
  bpm: number
  /** Distinct still minutes that had at least one heart-rate reading. */
  coverageMin: number
}

/**
 * The median heart rate of the day's still minutes, with its coverage, or null when fewer than
 * {@link STILL_RHR_MIN_COVERAGE_MIN} still minutes had a reading.
 *
 * A reading only counts when a MET reading covers its minute: a minute the ring did not measure
 * movement for is unknown, not still.
 */
export function stillDaytimeRhr(inp: StillRhrInput, minCoverageMin = STILL_RHR_MIN_COVERAGE_MIN): StillRhr | null {
  const met: TimedSample[] = inp.met
    .filter(m => m.tsMs >= inp.dayStartMs - MET_MINUTE_MS && m.tsMs < inp.dayEndMs && Number.isFinite(m.value))
    .map(m => ({ ds: m.tsMs, value: m.value }))
    .sort((a, b) => a.ds - b.ds)
  if (met.length === 0) return null

  const exclude: ExclusionWindow[] = [
    ...metActiveWindows(met, MET_MINUTE_MS, MET_ACTIVE_THRESHOLD),
    ...inp.sleepWindows.map(w => ({ startDs: w.startMs, endDs: w.endMs })),
  ]

  // The MET minute (by its start) each reading falls in; no covering minute → not measured.
  const candidates: (TimedSample & { minute: number })[] = []
  let j = 0
  for (const h of [...inp.hr].sort((a, b) => a.tsMs - b.tsMs)) {
    if (h.tsMs < inp.dayStartMs || h.tsMs >= inp.dayEndMs) continue
    if (!(h.bpm >= HR_PLAUSIBLE_MIN && h.bpm <= HR_PLAUSIBLE_MAX)) continue
    while (j + 1 < met.length && met[j + 1].ds <= h.tsMs) j++
    if (met[j].ds > h.tsMs || h.tsMs >= met[j].ds + MET_MINUTE_MS) continue
    candidates.push({ ds: h.tsMs, value: h.bpm, minute: met[j].ds })
  }

  const minutes = new Set<number>()
  for (const c of candidates) if (!inAnyWindow(c.ds, exclude)) minutes.add(c.minute)
  if (minutes.size < minCoverageMin) return null

  const bpm = medianGated(candidates, exclude)
  return bpm == null ? null : { bpm, coverageMin: minutes.size }
}
