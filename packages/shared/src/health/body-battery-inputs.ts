/**
 * Two inputs the Body Battery walk depends on, kept out of the route so they can be tested and
 * so the reasoning behind their numbers lives next to them.
 *
 * Both were measured against 36 days of production `body_battery_daily` on 2026-08-04 (backlog
 * Q-57, evidence in `docs/reviews/2026-08-04-body-battery-measured.md`). The measurement matters
 * because the model has no validated target yet — end-of-day battery vs next-day readiness comes
 * out at r = −0.06 — so these are corrections to inputs that are wrong *on their own terms*, not
 * a fit against an outcome.
 */

/** Sane lower bound on HR reserve. A collapsed reserve would make ordinary heart rates read as
 *  maximal effort, so the resolved max can never sit closer than this to resting. */
export const MIN_HR_RESERVE_BPM = 60

/** Days of recorded daily peaks required before trusting observation over the age estimate. */
export const MIN_PEAK_DAYS = 14

/** How far back daily peaks are considered. Long enough to catch a hard session, short enough
 *  that a max set years ago doesn't define today's range. */
export const HR_PEAK_WINDOW_DAYS = 90

export interface BatteryHrMax {
  hrMax: number
  source: 'observed' | 'estimated'
  /** Highest daily peak in the window — null when there aren't enough days. */
  observedPeak: number | null
  peakDays: number
}

/**
 * The top of the working HR range, for the *reserve* the battery drains against.
 *
 * This is deliberately NOT `resolveMaxHr` from `observed-hr.ts`. That one answers "what is the
 * highest you could go", and takes the observed max only when it *exceeds* the age estimate —
 * correct for showing effort as a % of max, where erring high is harmless. Reserve is the
 * opposite: an inflated ceiling makes every heart rate a smaller fraction of it, so drain never
 * triggers. Measured on this user, `220 − age` gives 190 against a real 90-day peak of 168, and
 * the battery ended above 80 on 18 of 36 days with 14 of them pinned at the 100 ceiling.
 *
 * Each daily peak is already corroboration-gated where it is recorded (`computeObservedHr`
 * requires five readings), so the max across days means "the highest level reached repeatedly on
 * any day in the window" — not a single artefact. The rolling window is what lets it come back
 * down; without one it would ratchet up permanently on one bad reading.
 *
 * **Q-57 specified the 95th percentile of daily peaks rather than the max. Backtested over the
 * same 36 days, p95 (157) over-corrected** — it floored the battery at zero on 4 days against 2
 * for the max, and pushed a third of days below 20. The max is used instead; the percentile is
 * recorded here so the deviation is visible rather than silent.
 */
export function resolveBatteryHrMax(
  dailyPeaks: readonly (number | null | undefined)[],
  estimatedMax: number,
  restingHr: number,
): BatteryHrMax {
  const peaks = dailyPeaks.filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0)
  if (peaks.length < MIN_PEAK_DAYS) {
    return { hrMax: estimatedMax, source: 'estimated', observedPeak: peaks.length ? Math.max(...peaks) : null, peakDays: peaks.length }
  }
  const observedPeak = Math.max(...peaks)
  const floor = restingHr + MIN_HR_RESERVE_BPM
  return { hrMax: Math.max(observedPeak, floor), source: 'observed', observedPeak, peakDays: peaks.length }
}

/** Waking samples per hour below which the day's arc is a sampling artefact, not physiology.
 *
 *  Raised 6 → 8 on 2026-08-04 after the owner's first day on v5 sat at **6.9/h** (30 readings over
 *  4.3 waking hours) with the battery moving 3 points — visibly the case this gate exists for, and
 *  it passed. Re-derived over the same 36 days, comparing how far the battery actually travelled in
 *  a day either side of the line:
 *
 *  | threshold | days flagged | mean day-span flagged | not flagged |
 *  |---|---|---|---|
 *  | 6  | 5  | 3.8  | 30.4 |
 *  | **8**  | **6**  | **8.0**  | **30.5** |
 *  | 10 | 10 | 12.9 | 32.0 |
 *
 *  At 6 only the completely dead days are caught. At 10 it starts flagging days that moved 13
 *  points, which is real movement. 8 keeps the flagged group at 8 points across a whole day —
 *  still "not measured" — while the unflagged group is unchanged at ~30. */
export const MIN_SAMPLES_PER_WAKING_HOUR = 8

/** No verdict before this much of the day has elapsed — an hour after waking there is not enough
 *  time for any rate to mean anything. */
export const MIN_WAKING_MINUTES_TO_JUDGE = 60

export interface BatteryConfidence {
  sampleCount: number
  wakingMinutes: number
  samplesPerHour: number
  /** False when the HR series is too sparse for the day's arc to mean anything. */
  sufficient: boolean
}

/**
 * Whether today's HR series is dense enough for the battery arc to be reporting the body rather
 * than the sensor.
 *
 * The ring power-gates its PPG when worn and idle, so a sparse day is not a calm day — it is an
 * unmeasured one, and the walk renders it as a nearly flat line with full confidence. Grouped by
 * waking sample count across 36 production days, the total distance the battery travelled in a
 * day was:
 *
 * | samples | days | mean day span |
 * |---|---|---|
 * | <100 | 7 | **8** |
 * | 100–199 | 7 | 25 |
 * | 200–499 | 8 | 35 |
 * | 500–999 | 8 | 27 |
 * | 1000+ | 6 | 40 |
 *
 * The cliff is below 100, not at the 200/500 marks the backlog entry guessed at — one of those
 * seven days had **zero** waking samples and still rendered a confident number. It is expressed as
 * a rate rather than a count because the same absolute number means very different things at 8am
 * and at 10pm. The rate itself is `MIN_SAMPLES_PER_WAKING_HOUR` above — read its note for why it
 * is 8 and not the ~6/hour this band table first suggested.
 */
export function batteryConfidence(sampleCount: number, wakingMinutes: number): BatteryConfidence {
  const mins = Math.max(0, wakingMinutes)
  const samplesPerHour = mins > 0 ? (sampleCount / mins) * 60 : 0
  return {
    sampleCount,
    wakingMinutes: Math.round(mins),
    samplesPerHour: Math.round(samplesPerHour * 10) / 10,
    sufficient: mins < MIN_WAKING_MINUTES_TO_JUDGE || samplesPerHour >= MIN_SAMPLES_PER_WAKING_HOUR,
  }
}
