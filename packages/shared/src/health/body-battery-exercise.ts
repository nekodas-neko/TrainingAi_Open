// Body Battery's exercise drain (#3495, model v8, owner sign-off 3 Nov 2026).
//
// The heart-rate walk (`body-battery-walk.ts`) only drains for training it can see, and it sees
// training only through a per-minute heart-rate series. Where the day's series is thinner than that
// (a source that sends 5-minute points at rest and scattered ones while awake), an hour of lifting
// cost about 2 points and a full day of training and walking barely moved the level. This adds a
// drain measured against the user's own goals instead, for exactly the training the heart-rate walk
// cannot see:
//
//   - each FINISHED workout costs a share of the morning level in proportion to its volume against
//     the session-volume goal, unless a per-minute heart-rate series covers the workout;
//   - the day's steps cost a share in proportion to the step goal, unless a per-minute series covers
//     the waking day.
//
// So a day where everything is hit ends near 0, a workout-only day keeps a reserve, and a rest day
// holds near the morning level. The rest charge, the heart-rate drain and the stress drain are the
// walk's, unchanged.
//
// **Rest does not refill the exercise drain** (the proposal's question 2). On a day with any
// exercise drain the walk's level is held at or under the morning mark before the drain comes off,
// so a calm hour refills what the heart-rate walk and stress took, but never pays for training or
// steps. A day with no exercise drain is v7 exactly.
//
// **Source-agnostic by construction.** Everything here is a generic shape: reading times, finished
// workouts with a volume, a day's step count and the user's goals. Whether the heart-rate series
// covers a span is decided from the readings' timing alone, never from which device sent them, so a
// strap, a watch writing per-minute heart rate, or a ring all get the same rule.
//
// ⚠ PROVISIONAL constants, set from the owner's 19 Aug checkpoints, not fitted. The replay against
// stored days (#3495's pass tests) is what fits them.

/** The longest gap between two readings that still counts as a per-minute series: one minute, with
 *  the same 30 s of slack the 5-minute density rule allows (`HR_DENSE_MAX_GAP_MS`). */
export const PER_MINUTE_HR_MAX_GAP_MS = 90_000

/** The share of a span a per-minute series must cover for the heart-rate walk to see what happened
 *  in it. Below this the span's training is invisible to the walk, and the exercise drain applies. */
export const PER_MINUTE_COVERAGE_MIN = 0.8

/** The share of the morning level a workout at the session-volume goal costs. */
export const WORKOUT_DRAIN_SHARE = 0.5
/** The share of the morning level the step goal costs. Together with the workout share it is just
 *  under 1, so an everything-hit day ends near 0, not pinned at it before the evening. */
export const STEP_DRAIN_SHARE = 0.45
/** Past the goal, more work still costs more, up to this multiple of it. */
export const GOAL_RATIO_CAP = 1.5

export interface ExerciseDrainWorkout {
  /** Epoch ms the workout started. */
  startMs: number
  /** Epoch ms it finished. A workout still in progress is not passed. */
  endMs: number
  /** The workout's volume, kg. */
  volumeKg: number
}

export interface ExerciseDrainInput {
  /** The morning level the day was walked from, 0–100. */
  anchor: number
  /** Epoch ms the walk starts, and where it stops (now for today, midnight for a finished day). */
  wakeTime: number
  until: number
  /** The day's heart-rate reading times, epoch ms, any order and any source. */
  hrTimes: readonly number[]
  /** The day's finished workouts. */
  workouts: readonly ExerciseDrainWorkout[]
  /** The day's step count (`dayStepCount`), or null when there is no reading. */
  steps: number | null
  goals: { stepGoal: number; sessionVolumeGoalKg: number }
}

export interface ExerciseDrain {
  /** Points the workouts cost by `until`. */
  workoutDrained: number
  /** Points the steps cost by `until`. */
  stepDrained: number
  /** Workouts that drained, and workouts the heart-rate walk already saw. */
  workoutsCounted: number
  workoutsSeenByHr: number
  /** Whether the steps drained, or the waking day's heart rate already covered them. */
  stepsCounted: boolean
  /** The cumulative exercise drain at a moment, so the curve can be drawn through it. */
  drainedBy: (ms: number) => number
}

/**
 * The fraction of `[fromMs, toMs]` covered by a per-minute heart-rate series: the time between
 * consecutive readings no more than `PER_MINUTE_HR_MAX_GAP_MS` apart, over the span. A reading
 * outside the span still closes a gap that crosses its edge. 0 for an empty span.
 */
export function perMinuteHrCoverage(times: readonly number[], fromMs: number, toMs: number): number {
  if (!(toMs > fromMs)) return 0
  const sorted = [...times].sort((a, b) => a - b)
  let covered = 0
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]
    const b = sorted[i]
    if (b - a > PER_MINUTE_HR_MAX_GAP_MS) continue
    const lo = Math.max(a, fromMs)
    const hi = Math.min(b, toMs)
    if (hi > lo) covered += hi - lo
  }
  return Math.min(1, covered / (toMs - fromMs))
}

/** Whether the heart-rate walk can see what happened in `[fromMs, toMs]`. */
export function hrWalkSeesSpan(times: readonly number[], fromMs: number, toMs: number): boolean {
  return perMinuteHrCoverage(times, fromMs, toMs) >= PER_MINUTE_COVERAGE_MIN
}

const ratio = (done: number, goal: number) => (goal > 0 && done > 0 ? Math.min(done / goal, GOAL_RATIO_CAP) : 0)

/** A linear ramp of `points` across `[from, to]`, read at `ms`. A zero-length span lands at `to`. */
function rampAt(points: number, from: number, to: number, ms: number): number {
  if (points <= 0 || ms < from) return 0
  if (ms >= to || to <= from) return points
  return points * ((ms - from) / (to - from))
}

/**
 * The day's exercise drain. Workouts drain across their own span (from wake, if they began before
 * it); the steps, a day's total with no times, are spread across the waking span to `until`. Their
 * combined workout ratio is capped at `GOAL_RATIO_CAP`, like the steps'.
 */
export function exerciseDrain(input: ExerciseDrainInput): ExerciseDrain {
  const { anchor, wakeTime, until, hrTimes, goals } = input
  const morning = Math.max(0, Math.min(100, anchor))

  const finished = input.workouts.filter(w => w.endMs > w.startMs && w.endMs <= until && w.volumeKg > 0)
  const unseen = finished.filter(w => !hrWalkSeesSpan(hrTimes, w.startMs, w.endMs))
  const rawRatios = unseen.map(w => (goals.sessionVolumeGoalKg > 0 ? w.volumeKg / goals.sessionVolumeGoalKg : 0))
  const rawTotal = rawRatios.reduce((s, r) => s + r, 0)
  const scale = rawTotal > GOAL_RATIO_CAP ? GOAL_RATIO_CAP / rawTotal : 1
  const workoutRamps = unseen.map((w, i) => ({
    points: morning * WORKOUT_DRAIN_SHARE * rawRatios[i] * scale,
    from: Math.max(w.startMs, wakeTime),
    to: Math.max(w.endMs, wakeTime),
  }))

  const stepsCounted = input.steps != null && input.steps > 0 && !hrWalkSeesSpan(hrTimes, wakeTime, until)
  const stepPoints = stepsCounted ? morning * STEP_DRAIN_SHARE * ratio(input.steps!, goals.stepGoal) : 0

  const drainedBy = (ms: number) =>
    workoutRamps.reduce((s, r) => s + rampAt(r.points, r.from, r.to, ms), 0) + rampAt(stepPoints, wakeTime, until, ms)

  return {
    workoutDrained: workoutRamps.reduce((s, r) => s + r.points, 0),
    stepDrained: stepPoints,
    workoutsCounted: unseen.length,
    workoutsSeenByHr: finished.length - unseen.length,
    stepsCounted,
    drainedBy,
  }
}

/**
 * The level with the exercise drain taken off: the walk's level, held at or under the morning mark
 * once the day has any exercise drain (rest never refills training), less the drain so far. With no
 * exercise drain it is the walk's level unchanged.
 */
export function levelWithExerciseDrain(walkLevel: number, anchor: number, exerciseDrained: number, dayHasExerciseDrain: boolean): number {
  if (!dayHasExerciseDrain) return walkLevel
  return Math.max(0, Math.min(100, Math.min(walkLevel, anchor) - exerciseDrained))
}
