// Aggregation for the 14-day HRR (heart-rate recovery) trend. Each set's value is HRR60 — the one
// measured one-minute recovery, `deriveHrr60` in hrr60.ts (#2457, the input #2299 v2 signed); this
// file only picks it per set and rolls those values up to one number per session and one "best
// session" number per day. No HRR formula here.
//
// #2234: the trend used the nearest-reading `hrr1` from `analyseHrRecovery`. On a ring-only day two
// readings a minute apart at the same bpm pass its 45–75 s separation gate and difference to exactly
// 0 (or a small negative when the bpm crept up), so the sparkline plotted 0-value points where the
// honest answer is "not measured". HRR60 needs dense HR, so such a set is null and the day is a gap.

import { median } from '@trainingai/shared/stats'
import type { HrReading } from './hr-analysis'
import { deriveHrr60 } from './hrr60'

/** The set's end, as `computeSetHrStats` anchors HRR60: the timed end, else the logged time. */
export interface TrendSet {
  setEndMs?: number | null
  loggedAt: Date | null
}

/** Per set, the measured HRR60 (bpm) or null where the series could not see the minute. Never 0
 *  for "unknown": a 0 here is a measured flat recovery from dense HR. */
export function setHrr60Values(
  readings: readonly (HrReading & { source?: string | null })[],
  sets: readonly TrendSet[],
): (number | null)[] {
  return sets.map(s => deriveHrr60(readings, s.setEndMs ?? s.loggedAt?.getTime() ?? null)?.bpm ?? null)
}

/** Median of a session's per-set HRR values, ignoring nulls. Rounded to a whole bpm/min. Median (not
 *  mean) so one anomalous set doesn't skew the session. */
export function sessionHrr1Median(hrr1Values: (number | null)[]): number | null {
  const m = median(hrr1Values.filter((v): v is number => v != null))
  return m === null ? null : Math.round(m)
}

/** One value per day: the best (highest) session median for that day. Higher HRR1 = faster recovery =
 *  better cardiovascular fitness. Days with no usable HR data are absent from the map (caller renders
 *  them as a gap). */
export function rollupDailyBestHrr(
  sessions: { day: string; hrr1Values: (number | null)[] }[],
): Map<string, number | null> {
  const byDay = new Map<string, number | null>()
  for (const s of sessions) {
    const m = sessionHrr1Median(s.hrr1Values)
    if (m == null) continue
    const prev = byDay.get(s.day)
    byDay.set(s.day, prev == null ? m : Math.max(prev, m))
  }
  return byDay
}
