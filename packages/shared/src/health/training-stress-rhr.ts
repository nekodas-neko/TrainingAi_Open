/** How far back the training-stress score will borrow a resting heart rate from. */
export const TRAINING_STRESS_RHR_WINDOW_DAYS = 7

export interface RestingHrReading { value: number; day: string }

/**
 * The resting heart rate the training-stress score uses for `date`: that day's own reading when
 * it exists, otherwise the most recent one within `TRAINING_STRESS_RHR_WINDOW_DAYS` before it.
 *
 * Resting heart rate is stored per day from the night's sleep, so one night with no recorded sleep
 * left the day with none and the whole score gated as `no_profile` (#2401). A resting rate moves
 * slowly, so last week's is a better input than refusing to score. `day` says which date it came
 * from so the caller can tell the reader it was borrowed.
 *
 * `rows` may arrive in any order and may include days after `date`, which are ignored.
 */
export function restingHrForDay(
  rows: readonly { date: string; restingHeartRate?: number | null }[],
  date: string,
  earliest: string,
): RestingHrReading | null {
  let best: RestingHrReading | null = null
  for (const r of rows) {
    const v = r.restingHeartRate
    if (v == null || !Number.isFinite(v) || v <= 0) continue
    if (r.date > date || r.date < earliest) continue
    if (best == null || r.date > best.day) best = { value: v, day: r.date }
  }
  return best
}
