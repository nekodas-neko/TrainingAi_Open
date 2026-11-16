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
//
// Once stored, the verdict is what the calorie gate reads (`hrDense ?? live`), from the moment it is
// written, not only after the prune (#3839). It is re-judged only when a later write passes the
// fuller-wins guard (as many readings or more). So a series that is edited or deduped down to fewer
// readings keeps the verdict taken over the fuller one until such a write: the calories and the
// recap follow the stored verdict, not the thinner live series.
import { isDenseHrSeries, isDenseHrSpan } from '@trainingai/shared/health/intraday-hr-contributors'
import { SET_PEAK_AFTER_MS, SET_PEAK_BEFORE_MS } from '@trainingai/shared/workout/hr-analysis'

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

/** How far either side of a set's log time its "End" reading may be: the nearest reading within
 *  90 s (`nearestReading` in `analyseHrRecovery`). */
export const SET_HR_WINDOW_MS = 90_000

/** Whether one set's heart rate rests on enough readings to show: the density rule over the readings
 *  inside the set's peak window (`SET_PEAK_BEFORE_MS` before its log time to `SET_PEAK_AFTER_MS`
 *  after, the window `analyseHrRecovery` takes the peak over), so a peak built on zero or one reading
 *  is never shown (#3839). "End" is shown only with the peak, so it too is shown only when two
 *  readings or more sit around the log time, never from a lone reading. A set with no log time has
 *  nothing to anchor on. */
export function setHrMeasured(
  readings: readonly { timestamp: Date }[],
  loggedAt: Date | null,
): boolean {
  if (!loggedAt) return false
  const at = loggedAt.getTime()
  const times = readings
    .map(r => r.timestamp.getTime())
    .filter(t => t >= at - SET_PEAK_BEFORE_MS && t <= at + SET_PEAK_AFTER_MS)
  return isDenseHrSeries(times)
}

/** Whether a recap may show per-set heart rate and one-minute recovery as numbers. `hrDense` is the
 *  workout verdict (`null` when there was nothing to judge, which hides nothing on its own: a
 *  workout with no readings has no numbers to hide); `measured` is the set's own check. */
export function showSetHr(hrDense: boolean | null | undefined, measured: boolean | undefined): boolean {
  return hrDense !== false && measured !== false
}

/** Whether a recap shows `SPARSE_WORKOUT_HR_NOTE` (#3839): when the workout verdict is sparse, and
 *  also when it passed but no set had enough readings around it, which is what readings every 3 to
 *  5 minutes look like (dense by `HR_DENSE_MAX_GAP_MS`, yet never two inside one set's window).
 *  Not with no readings at all: there is nothing sparse to explain, and the recap says there is no
 *  trace instead. An older response without `hrMeasured` never trips the second case. */
export function showSparseWorkoutHrNote(
  hrDense: boolean | null | undefined,
  readingsCount: number,
  sets: readonly { hrMeasured?: boolean }[],
): boolean {
  if (hrDense === false) return true
  return readingsCount > 0 && sets.length > 0 && sets.every(s => s.hrMeasured === false)
}

/** Shown once, in place of per-set heart rate and recovery, when the workout's heart rate is sparse. */
export const SPARSE_WORKOUT_HR_NOTE =
  'Heart rate came in only every few minutes, too sparse for per-set heart rate or recovery. Wear the chest strap for per-set heart rate.'

/** Shown on one set, in place of its heart rate, when too few readings fall around it. */
export const SET_HR_NOT_MEASURED = 'Too few heart-rate readings around this set to show its heart rate.'
