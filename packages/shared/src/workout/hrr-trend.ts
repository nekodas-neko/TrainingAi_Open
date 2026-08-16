// Aggregation for the 14-day HRR (heart-rate recovery) trend. The core HRR1 math — bpmAtLog - bpm60
// per set — lives once in analyseHrRecovery (lib/workout/hr-analysis.ts); this file only rolls those
// per-set values up to one number per session and one "best session" number per day. No HRR formula here.

/** Median of a session's per-set HRR1 values, ignoring nulls. Rounded to a whole bpm/min. Median (not
 *  mean) so one anomalous set doesn't skew the session. */
export function sessionHrr1Median(hrr1Values: (number | null)[]): number | null {
  const vals = hrr1Values
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b)
  if (vals.length === 0) return null
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid]
  return Math.round(median)
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
