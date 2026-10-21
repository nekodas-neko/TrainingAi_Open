/**
 * The most recent resting-HR reading in a set of body-metric rows, or null when none qualifies.
 *
 * **Picked by MAX DATE, not by position.** Repositories return `bodyMetrics` in no order a caller
 * may rely on: Postgres `listBodyMetrics` sorts `date DESC`, so the `[...rows].reverse().find(...)`
 * idiom this replaces read the OLDEST reading in its window and called it the latest (#3216). The
 * failure is invisible: a plausible bpm from the wrong week.
 *
 * A zero or negative value is no reading, the same as null — a ring with no contact can store a 0,
 * and a 0 bpm resting HR would widen every Karvonen zone.
 *
 * The caller bounds the window; this picks within it. No reading in the window is null, never an
 * older row from outside it.
 */
export function latestRestingHrRow<T extends { date: string; restingHeartRate?: number | null }>(
  rows: readonly T[],
): T | null {
  let best: T | null = null
  for (const r of rows) {
    if (r.restingHeartRate == null || !(r.restingHeartRate > 0)) continue
    if (best == null || r.date > best.date) best = r
  }
  return best
}

/** The bpm of `latestRestingHrRow`, for callers that only need the number. */
export function latestRestingHr(rows: readonly { date: string; restingHeartRate?: number | null }[]): number | null {
  return latestRestingHrRow(rows)?.restingHeartRate ?? null
}
