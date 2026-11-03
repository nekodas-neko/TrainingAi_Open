/**
 * #3495 — Body Battery's goal-based exercise drain (v8).
 *
 * Synthetic numbers only: reading times, a volume and a step count, never the owner's data.
 */
import { describe, it, expect } from 'vitest'
import {
  perMinuteHrCoverage, hrWalkSeesSpan, exerciseDrain, levelWithExerciseDrain,
  WORKOUT_DRAIN_SHARE, STEP_DRAIN_SHARE, GOAL_RATIO_CAP, PER_MINUTE_HR_MAX_GAP_MS,
} from '../body-battery-exercise'

const MIN = 60_000
const WAKE = Date.UTC(2026, 10, 1, 21, 0) // any instant; the module reads times only
const END = WAKE + 15 * 60 * MIN
const goals = { stepGoal: 8000, sessionVolumeGoalKg: 5000 }

const every = (from: number, to: number, stepMs: number) => {
  const out: number[] = []
  for (let t = from; t <= to; t += stepMs) out.push(t)
  return out
}
const workout = (startMin: number, lenMin: number, volumeKg = 5000) =>
  ({ startMs: WAKE + startMin * MIN, endMs: WAKE + (startMin + lenMin) * MIN, volumeKg })

describe('per-minute heart-rate coverage', () => {
  it('counts only the time between readings no more than a minute and a half apart', () => {
    expect(perMinuteHrCoverage(every(WAKE, WAKE + 60 * MIN, MIN), WAKE, WAKE + 60 * MIN)).toBe(1)
    // A 5-minute series is dense by the zone-minute rule, but it is not per-minute.
    expect(perMinuteHrCoverage(every(WAKE, WAKE + 60 * MIN, 5 * MIN), WAKE, WAKE + 60 * MIN)).toBe(0)
    // The gap limit itself still counts; a second over it does not.
    expect(perMinuteHrCoverage([WAKE, WAKE + PER_MINUTE_HR_MAX_GAP_MS], WAKE, WAKE + PER_MINUTE_HR_MAX_GAP_MS)).toBe(1)
    expect(perMinuteHrCoverage([WAKE, WAKE + PER_MINUTE_HR_MAX_GAP_MS + 1000], WAKE, WAKE + PER_MINUTE_HR_MAX_GAP_MS + 1000)).toBe(0)
  })

  it('reads the half of a span that has per-minute readings as half covered, in any order', () => {
    const times = every(WAKE, WAKE + 30 * MIN, MIN).reverse()
    expect(perMinuteHrCoverage(times, WAKE, WAKE + 60 * MIN)).toBeCloseTo(0.5, 5)
    expect(hrWalkSeesSpan(times, WAKE, WAKE + 60 * MIN)).toBe(false)
    expect(perMinuteHrCoverage([], WAKE, WAKE)).toBe(0)
  })
})

describe('the exercise drain', () => {
  const sparse = every(WAKE, END, 5 * MIN) // a 5-minute series: sees no training
  const base = { anchor: 80, wakeTime: WAKE, until: END, hrTimes: sparse, workouts: [], steps: 0, goals }

  it('drains a workout at the volume goal by the workout share of the morning level, across its span', () => {
    const d = exerciseDrain({ ...base, workouts: [workout(120, 60)] })
    expect(d.workoutDrained).toBeCloseTo(80 * WORKOUT_DRAIN_SHARE, 6)
    expect(d.workoutsCounted).toBe(1)
    expect(d.drainedBy(WAKE + 119 * MIN)).toBe(0)
    expect(d.drainedBy(WAKE + 150 * MIN)).toBeCloseTo(20, 6)
    expect(d.drainedBy(END)).toBeCloseTo(40, 6)
  })

  it('leaves a workout the per-minute series covers to the heart-rate walk', () => {
    const strap = [...sparse, ...every(WAKE + 120 * MIN, WAKE + 180 * MIN, 1000)]
    const d = exerciseDrain({ ...base, hrTimes: strap, workouts: [workout(120, 60)] })
    expect(d.workoutDrained).toBe(0)
    expect(d.workoutsSeenByHr).toBe(1)
  })

  it('never counts a workout that has not finished by the end of the walk, or has no volume', () => {
    const d = exerciseDrain({ ...base, until: WAKE + 150 * MIN, workouts: [workout(120, 60), workout(10, 30, 0)] })
    expect(d.workoutDrained).toBe(0)
    expect(d.workoutsCounted).toBe(0)
  })

  it('drains the steps against the step goal, spread over the waking span', () => {
    const d = exerciseDrain({ ...base, steps: 4000 })
    expect(d.stepsCounted).toBe(true)
    expect(d.stepDrained).toBeCloseTo(80 * STEP_DRAIN_SHARE * 0.5, 6)
    expect(d.drainedBy(WAKE + (END - WAKE) / 2)).toBeCloseTo(d.stepDrained / 2, 6)
  })

  it('leaves the steps to the walk on a day a per-minute series covers', () => {
    const d = exerciseDrain({ ...base, hrTimes: every(WAKE, END, MIN), steps: 12000 })
    expect(d.stepsCounted).toBe(false)
    expect(d.stepDrained).toBe(0)
  })

  it('caps work past the goal at GOAL_RATIO_CAP, across all of a day\'s workouts together', () => {
    const steps = exerciseDrain({ ...base, steps: 40_000 })
    expect(steps.stepDrained).toBeCloseTo(80 * STEP_DRAIN_SHARE * GOAL_RATIO_CAP, 6)
    const three = exerciseDrain({ ...base, workouts: [workout(60, 60), workout(200, 60), workout(400, 60)] })
    expect(three.workoutDrained).toBeCloseTo(80 * WORKOUT_DRAIN_SHARE * GOAL_RATIO_CAP, 6)
  })

  it('drains nothing on a day with no steps and no finished workout', () => {
    const d = exerciseDrain({ ...base, steps: null })
    expect(d.workoutDrained + d.stepDrained).toBe(0)
    expect(d.drainedBy(END)).toBe(0)
  })
})

describe('the level with the exercise drain taken off', () => {
  it('is the walk level unchanged on a day with no exercise drain', () => {
    expect(levelWithExerciseDrain(92, 70, 0, false)).toBe(92)
  })

  it('never lets charge above the morning mark pay for training (question 2)', () => {
    // The walk charged to 85 from a morning of 70; a 30-point workout lands at 40, not 55.
    expect(levelWithExerciseDrain(85, 70, 30, true)).toBe(40)
    // Below the mark, the walk's own drain stands and the exercise drain comes off it.
    expect(levelWithExerciseDrain(60, 70, 30, true)).toBe(30)
    expect(levelWithExerciseDrain(10, 70, 30, true)).toBe(0)
  })

  it('meets the proposal\'s checkpoints from a typical morning', () => {
    const anchor = 75
    const sparse = every(WAKE, END, 5 * MIN)
    const day = (workouts: ReturnType<typeof workout>[], steps: number) => {
      const d = exerciseDrain({ anchor, wakeTime: WAKE, until: END, hrTimes: sparse, workouts, steps, goals })
      return levelWithExerciseDrain(anchor, anchor, d.workoutDrained + d.stepDrained, d.workoutDrained + d.stepDrained > 0)
    }
    const everything = day([workout(120, 60)], 8000)
    const workoutOnly = day([workout(120, 60)], 0)
    const rest = day([], 1500)
    expect(everything).toBeLessThanOrEqual(5)        // pass test 2: everything hit ends near 0
    expect(workoutOnly).toBeGreaterThanOrEqual(25)   // pass test 2: a workout alone keeps a reserve
    expect(rest - workoutOnly).toBeGreaterThanOrEqual(15) // pass test 1: training day ≥ 15 below rest
    expect(anchor - rest).toBeLessThanOrEqual(10)    // a rest day holds near the morning level
  })
})
