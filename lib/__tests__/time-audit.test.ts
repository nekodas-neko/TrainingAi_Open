import { describe, it, expect } from 'vitest'
import {
  median, robustStats, computeExerciseStats, computeEquipmentStats, decomposeSessions,
  robustAvgSetDurationsByExercise, MIN_TRUSTED_SAMPLES, clampWindowStart,
  buildMeasuredTimeBudget, resolveTransitionSec, WARMUP_LEARN_MIN_SESSIONS,
  type TimingSetRow, type TimingExerciseRow, type TimingSessionRow, type EquipmentClass,
} from '@trainingai/shared/workout/time-audit'
import { TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD } from '@trainingai/shared/workout/duration-model'

const set = (over: Partial<TimingSetRow>): TimingSetRow => ({
  workoutSessionId: 'ws1', exerciseName: 'Squat', equipment: ['barbell'],
  setNumber: 1, reps: 5, setTimeSec: 30, restTimeSec: 120, setStartMs: null,
  ...over,
})
const exRow = (over: Partial<TimingExerciseRow>): TimingExerciseRow => ({
  workoutSessionId: 'ws1', exerciseName: 'Squat', equipment: ['barbell'],
  interExerciseRestSec: 200,
  ...over,
})

describe('median / robustStats', () => {
  it('median of odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('excludes values outside [0.25×, 4×] median and counts them', () => {
    // The reported real-world case: 4 sets ~60s, 1 tracked-wrong at 360s.
    const r = robustStats([60, 58, 62, 60, 360])
    expect(r.outlierCount).toBe(1)
    expect(r.median).toBeGreaterThanOrEqual(58)
    expect(r.median).toBeLessThanOrEqual(62)
    expect(r.count).toBe(4)
  })

  it('keeps everything when values are consistent', () => {
    const r = robustStats([100, 110, 120])
    expect(r.outlierCount).toBe(0)
    expect(r.count).toBe(3)
    expect(r.p75).toBeGreaterThanOrEqual(r.median!)
  })
})

describe('computeExerciseStats', () => {
  it('aggregates per exercise with sec/rep and rest', () => {
    const sets = [
      set({ setTimeSec: 30, reps: 5 }),
      set({ setTimeSec: 34, reps: 5, setNumber: 2 }),
      set({ exerciseName: 'Leg Press', equipment: ['machine'], setTimeSec: 40, reps: 10 }),
    ]
    const exercises = [
      exRow({ interExerciseRestSec: 250 }),
      exRow({ exerciseName: 'Leg Press', equipment: ['machine'], interExerciseRestSec: 90, workoutSessionId: 'ws2' }),
    ]
    const stats = computeExerciseStats(sets, exercises)
    const squat = stats.find(s => s.exerciseName === 'Squat')!
    expect(squat.setCount).toBe(2)
    expect(squat.medianSetSec).toBe(32)
    expect(squat.medianSecPerRep).toBeCloseTo(32 / 5, 1)
    expect(squat.medianRestSec).toBe(120)
    expect(squat.medianTransitionSec).toBe(250)
    const legPress = stats.find(s => s.exerciseName === 'Leg Press')!
    expect(legPress.medianTransitionSec).toBe(90)
  })

  it('ignores null timings', () => {
    const stats = computeExerciseStats([set({ setTimeSec: null, restTimeSec: null })], [])
    expect(stats[0].setCount).toBe(0)
  })
})

describe('computeEquipmentStats', () => {
  it('rolls transitions up by equipment class and compares to the current model', () => {
    const rows = [
      exRow({ interExerciseRestSec: 260 }),
      exRow({ interExerciseRestSec: 300, workoutSessionId: 'ws2' }),
      exRow({ exerciseName: 'Leg Press', equipment: ['machine'], interExerciseRestSec: 100 }),
      exRow({ exerciseName: 'Plank', equipment: ['bodyweight'], interExerciseRestSec: 45 }),
    ]
    const stats = computeEquipmentStats(rows)
    const barbell = stats.find(s => s.equipmentClass === 'barbell')!
    expect(barbell.transitionCount).toBe(2)
    expect(barbell.medianTransitionSec).toBe(280)
    expect(barbell.currentModelSec).toBe(240)
    expect(stats.find(s => s.equipmentClass === 'standard')!.currentModelSec).toBe(120)
    expect(stats.find(s => s.equipmentClass === 'bodyweight')!.currentModelSec).toBe(60)
  })
})

describe('robustAvgSetDurationsByExercise', () => {
  it('returns the robust median per exercise, excluding a timer-left-running outlier', () => {
    const rows = [
      { exerciseName: 'Squat', setTimeSec: 58 },
      { exerciseName: 'Squat', setTimeSec: 60 },
      { exerciseName: 'Squat', setTimeSec: 62 },
      { exerciseName: 'Squat', setTimeSec: 360 }, // timer left running
      { exerciseName: 'Bench', setTimeSec: 40 },
    ]
    const out = robustAvgSetDurationsByExercise(rows)
    expect(out.Squat).toBeGreaterThanOrEqual(58)
    expect(out.Squat).toBeLessThanOrEqual(62)
    expect(out.Bench).toBe(40)
  })

  it('omits an exercise with no rows — callers decide the "no data" default themselves', () => {
    const out = robustAvgSetDurationsByExercise([{ exerciseName: 'Squat', setTimeSec: 50 }])
    expect(out).not.toHaveProperty('Deadlift')
  })
})

describe('decomposeSessions', () => {
  it('splits a session into warmup/work/rest/transition/unaccounted', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [{
      workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 3_600_000, warmupEndedAt: t0 + 600_000,
    }]
    const sets = [
      set({ setTimeSec: 60, restTimeSec: 120, setStartMs: t0 + 900_000 }),
      set({ setTimeSec: 60, restTimeSec: 120, setNumber: 2, setStartMs: t0 + 1_080_000 }),
    ]
    const exercises = [exRow({ interExerciseRestSec: 240 })]
    const [d] = decomposeSessions(sessions, sets, exercises)
    expect(d.totalSec).toBe(3600)
    expect(d.warmupSec).toBe(600)
    expect(d.workSec).toBe(120)
    expect(d.restSec).toBe(240)
    expect(d.transitionSec).toBe(240)
    expect(d.unaccountedSec).toBe(3600 - 600 - 120 - 240 - 240)
  })

  it('excludes a negative inter_exercise_rest_sec from the transition sum instead of subtracting it', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [{
      workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 3_600_000, warmupEndedAt: t0 + 600_000,
    }]
    const sets = [set({ setTimeSec: 60, restTimeSec: 120, setStartMs: t0 + 900_000 })]
    const exercises = [
      exRow({ interExerciseRestSec: 240 }),
      exRow({ interExerciseRestSec: -30, exerciseName: 'Bench' }), // superset overlap
    ]
    const [d] = decomposeSessions(sessions, sets, exercises)
    expect(d.transitionSec).toBe(240) // the -30 is excluded, not summed in as -30
  })

  it('falls back to first set start when warmup end is missing, and skips incomplete sessions', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [
      { workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 1_800_000, warmupEndedAt: null },
      { workoutSessionId: 'ws2', startedAt: t0, completedAt: null, warmupEndedAt: null },
    ]
    const sets = [set({ setStartMs: t0 + 480_000 })]
    const out = decomposeSessions(sessions, sets, [])
    expect(out).toHaveLength(1)
    expect(out[0].warmupSec).toBe(480)
  })

  it('excludes sessions shorter than the minimum realistic duration', () => {
    const sessions: TimingSessionRow[] = [
      { workoutSessionId: 'a', startedAt: 0, completedAt: 16_000, warmupEndedAt: null },   // 16s — junk
      { workoutSessionId: 'b', startedAt: 0, completedAt: 45 * 60_000, warmupEndedAt: null }, // 45min — real
    ]
    const result = decomposeSessions(sessions, [], [])
    expect(result.map(r => r.workoutSessionId)).toEqual(['b'])
  })

  it('keeps a short-but-plausible single-exercise session (does not over-filter)', () => {
    const sessions: TimingSessionRow[] = [
      { workoutSessionId: 'c', startedAt: 0, completedAt: 3 * 60_000, warmupEndedAt: null }, // 3min
    ]
    expect(decomposeSessions(sessions, [], []).map(r => r.workoutSessionId)).toEqual(['c'])
  })
})

describe('decomposeSessions — warmup cap + overflow to unaccounted', () => {
  const cap = 900 // MAX_PLAUSIBLE_WARMUP_SEC
  it('caps warmup at the ceiling and rolls the overflow into unaccounted', () => {
    const startedAt = 0
    const sessions: TimingSessionRow[] = [{ workoutSessionId: 'a', startedAt, completedAt: 40 * 60_000, warmupEndedAt: 22 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    expect(d.rawWarmupSec).toBe(22 * 60)
    expect(d.warmupSec).toBe(cap)
    expect(d.warmupOverflowSec).toBe(22 * 60 - cap)
    expect(d.unaccountedSec).toBe(2400 - cap)
  })
  it('leaves a normal warmup untouched (no overflow, warmupSec === rawWarmupSec)', () => {
    const sessions: TimingSessionRow[] = [{ workoutSessionId: 'b', startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 10 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    expect(d.warmupSec).toBe(10 * 60)
    expect(d.rawWarmupSec).toBe(10 * 60)
    expect(d.warmupOverflowSec).toBe(0)
  })
})

describe('decomposeSessions — anomaly flags', () => {
  it('flags an over-cap warmup with the raw seconds', () => {
    const sessions: TimingSessionRow[] = [{ workoutSessionId: 'a', startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 22 * 60_000 }]
    const [d] = decomposeSessions(sessions, [], [])
    const warm = d.anomalies.find(x => x.type === 'warmup_over_cap')
    expect(warm?.sec).toBe(22 * 60)
  })
  it('flags a runaway set and excessive unaccounted', () => {
    const sessions: TimingSessionRow[] = [{ workoutSessionId: 'b', startedAt: 0, completedAt: 60 * 60_000, warmupEndedAt: 60_000 }]
    const sets = [set({ workoutSessionId: 'b', exerciseName: 'Bench', equipment: ['barbell'], setNumber: 1, reps: 5, setTimeSec: 12 * 60, restTimeSec: null, setStartMs: 60_000 })]
    const [d] = decomposeSessions(sessions, sets, [])
    expect(d.anomalies.map(a => a.type)).toContain('runaway_set')
    expect(d.anomalies.map(a => a.type)).toContain('excessive_unaccounted')
  })
  it('has no anomalies for a clean session', () => {
    // Total wall-clock exactly matches warmup + work + rest (no transition), so
    // unaccounted is 0 — the plan's own draft left completedAt at 30min here,
    // which left ~19min genuinely unaccounted and should (correctly) have flagged.
    const sessions: TimingSessionRow[] = [{ workoutSessionId: 'c', startedAt: 0, completedAt: (8 * 60 + 40 + 120) * 1000, warmupEndedAt: 8 * 60_000 }]
    const sets = [set({ workoutSessionId: 'c', exerciseName: 'Bench', equipment: ['barbell'], setNumber: 1, reps: 5, setTimeSec: 40, restTimeSec: 120, setStartMs: 8 * 60_000 })]
    const [d] = decomposeSessions(sessions, sets, [])
    expect(d.anomalies).toEqual([])
  })
})

describe('clampWindowStart', () => {
  it('returns the window start unchanged when there is no baseline', () => {
    const windowStart = new Date('2026-06-01T00:00:00Z')
    expect(clampWindowStart(windowStart, null)).toEqual(windowStart)
  })
  it('clamps to the baseline when it is more recent than the rolling window start', () => {
    const windowStart = new Date('2026-06-01T00:00:00Z')
    const baseline = new Date('2026-07-01T00:00:00Z')
    expect(clampWindowStart(windowStart, baseline)).toEqual(baseline)
  })
  it('leaves the window start unaffected when the baseline is older than it', () => {
    const windowStart = new Date('2026-06-01T00:00:00Z')
    const baseline = new Date('2026-01-01T00:00:00Z')
    expect(clampWindowStart(windowStart, baseline)).toEqual(windowStart)
  })
})

describe('buildMeasuredTimeBudget', () => {
  it('learns a per-exercise transition median only once samples cross MIN_TRUSTED_SAMPLES', () => {
    const exercises: TimingExerciseRow[] = [
      ...Array.from({ length: MIN_TRUSTED_SAMPLES }, (_, i) =>
        exRow({ workoutSessionId: `ws${i}`, exerciseName: 'Squat', equipment: ['barbell'], interExerciseRestSec: 200 })),
      ...Array.from({ length: 2 }, (_, i) =>
        exRow({ workoutSessionId: `wb${i}`, exerciseName: 'Bench', equipment: ['barbell'], interExerciseRestSec: 300 })),
    ]
    const budget = buildMeasuredTimeBudget([], [], exercises)
    expect(budget.transitionSecByExercise.Squat).toBe(200)
    expect(budget.transitionSecByExercise).not.toHaveProperty('Bench') // only 2 samples
    // The class rolls up every barbell row (5×200 + 2×300 = 7 ≥ threshold) → learned.
    expect(budget.transitionSecByClass.barbell).toBeGreaterThan(0)
  })

  it('does not learn a warmup median below WARMUP_LEARN_MIN_SESSIONS sessions', () => {
    const sessions: TimingSessionRow[] = Array.from({ length: WARMUP_LEARN_MIN_SESSIONS - 1 }, (_, i) => ({
      workoutSessionId: `ws${i}`, startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 5 * 60_000,
    }))
    expect(buildMeasuredTimeBudget(sessions, [], []).warmupSec).toBeNull()
  })

  it('learns the warmup median at or above the session threshold', () => {
    const sessions: TimingSessionRow[] = Array.from({ length: WARMUP_LEARN_MIN_SESSIONS }, (_, i) => ({
      workoutSessionId: `ws${i}`, startedAt: 0, completedAt: 40 * 60_000, warmupEndedAt: 5 * 60_000,
    }))
    expect(buildMeasuredTimeBudget(sessions, [], []).warmupSec).toBe(5 * 60)
  })
})

describe('resolveTransitionSec', () => {
  const measured = {
    transitionSecByExercise: { Squat: 210 },
    transitionSecByClass: { barbell: 260 } as Partial<Record<EquipmentClass, number>>,
    warmupSec: null,
  }
  it('prefers the per-exercise median (most specific)', () => {
    expect(resolveTransitionSec('Squat', ['barbell'], measured)).toBe(210)
  })
  it('falls back to the equipment-class median when the exercise has none', () => {
    expect(resolveTransitionSec('Deadlift', ['barbell'], measured)).toBe(260)
  })
  it('falls back to the duration-model constant when neither is learned', () => {
    expect(resolveTransitionSec('Curl', ['dumbbell'], measured)).toBe(TRANSITION_SEC_STANDARD)
  })
  it('falls back to the constant when no measured budget is supplied', () => {
    expect(resolveTransitionSec('Squat', ['barbell'], null)).toBe(TRANSITION_SEC_BARBELL)
  })
})

describe('WARMUP_LEARN_MIN_SESSIONS', () => {
  it('demands more samples than a single set stat (warmup is noisier)', () => {
    expect(WARMUP_LEARN_MIN_SESSIONS).toBeGreaterThan(MIN_TRUSTED_SAMPLES)
  })
})

describe('MIN_TRUSTED_SAMPLES', () => {
  it('is a small positive threshold below which a median should be treated as unreliable', () => {
    expect(MIN_TRUSTED_SAMPLES).toBeGreaterThan(0)
    expect(MIN_TRUSTED_SAMPLES).toBeLessThanOrEqual(10)
  })
})
