// Whether a workout's heart rate is dense enough to stand behind per-set figures (#3775).
//
// One rule, the density rule #2437 decided and #3078 applied to workouts (`isDenseHrSpan`: at least
// two readings, no gap over `HR_DENSE_MAX_GAP_MS`), judged only where the series comes wholly from a
// source whose heart rate is not continuous by construction. Which sources those are is each
// source's declared `heartRateSpacing` (`DENSITY_GATED_HR_SOURCES`), never a source id here.
//
// The workout verdict is the one the calorie gate reads (`getAvgBpmBySession`), stored as
// `workout_hr_stats.hr_dense` whenever the snapshot is written (`upsertWorkoutHrStats`) and frozen
// before the HR prune (`freezeWorkoutHrDensity`). The recap reads the same verdict to decide whether
// per-set heart rate and one-minute recovery are shown as numbers.
import { isDenseHrSeries, isDenseHrSpan } from '@trainingai/shared/health/intraday-hr-contributors'

/** A workout's own series, start to end without the pads: how many readings, how many from a source
 *  the density rule does not gate, and the longest gap between consecutive ones (ms). The shape
 *  `workoutHrSpanSql` returns. */
export type WorkoutHrSpan = { n: number; ungated: number; max_gap_ms: number | null }

/** The verdict on one series: `null` with no reading to judge, `true` when any reading comes from a
 *  source the rule does not gate, else `isDenseHrSpan`. */
export function workoutHrSpanVerdict(span: WorkoutHrSpan | null): boolean | null {
  const n = Number(span?.n ?? 0)
  if (n === 0) return null
  if (Number(span?.ungated ?? 0) > 0) return true
  return isDenseHrSpan(n, span?.max_gap_ms == null ? null : Number(span.max_gap_ms))
}

/** How far either side of a set's log time its shown heart rate reaches: the peak looks 90 s back and
 *  the "end" reading is the nearest within 90 s (`analyseHrRecovery`). */
export const SET_HR_WINDOW_MS = 90_000

/** Whether one set's heart rate rests on enough readings to show: the density rule over the readings
 *  within `SET_HR_WINDOW_MS` of its log time, so a figure built on zero or one reading is never
 *  shown. A set with no log time has nothing to anchor on. */
export function setHrMeasured(
  readings: readonly { timestamp: Date }[],
  loggedAt: Date | null,
): boolean {
  if (!loggedAt) return false
  const at = loggedAt.getTime()
  const times = readings
    .map(r => r.timestamp.getTime())
    .filter(t => t >= at - SET_HR_WINDOW_MS && t <= at + SET_HR_WINDOW_MS)
  return isDenseHrSeries(times)
}

/** Whether a recap may show per-set heart rate and one-minute recovery as numbers. `hrDense` is the
 *  workout verdict (`null` when there was nothing to judge, which hides nothing on its own: a
 *  workout with no readings has no numbers to hide); `measured` is the set's own check. */
export function showSetHr(hrDense: boolean | null | undefined, measured: boolean | undefined): boolean {
  return hrDense !== false && measured !== false
}

/** Shown once, in place of per-set heart rate and recovery, when the workout's heart rate is sparse. */
export const SPARSE_WORKOUT_HR_NOTE =
  'Heart rate came in only every few minutes, too sparse for per-set heart rate or recovery. Wear the chest strap for per-set heart rate.'

/** Shown on one set, in place of its heart rate, when too few readings fall around it. */
export const SET_HR_NOT_MEASURED = 'Too few heart-rate readings around this set to show its heart rate.'
