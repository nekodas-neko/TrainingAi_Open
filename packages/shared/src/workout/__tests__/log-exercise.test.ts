import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActiveProgramWithPhases = vi.fn()
const getActiveProgram           = vi.fn()
const getExerciseType            = vi.fn(async () => 'barbell')
const getDayLog                  = vi.fn(async () => [])
const createWorkoutSession       = vi.fn(async () => ({ id: 'ws-1' }))
const ensureWorkoutSession       = vi.fn()
const setWorkoutSessionWarmupEnd = vi.fn(async () => {})
const logExerciseAndSets         = vi.fn(async () => ({ exerciseLog: { id: 'el-1' } }))
const upsertPersonalRecordIfBetter = vi.fn(async () => true)
const countAllSessionsSinceStart = vi.fn(async () => new Map())
const getSessionPeriodization    = vi.fn(async () => null)
// Newest-first, exactly as the real listBodyMetrics returns (ORDER BY date DESC). The ordering is
// load-bearing: taking the last element instead of the first prices bodyweight volume at a weigh-in
// up to 90 days stale (Q-13 regression, caught on the dev server at 81.85 kg vs the real 82.50).
const listBodyMetrics            = vi.fn(async () => [
  { date: '2026-07-27', weightKg: 82.5 },
  { date: '2026-07-20', weightKg: 82.0 },
  { date: '2026-07-14', weightKg: 81.85 },
])

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getActiveProgramWithPhases,
    getActiveProgram,
    getExerciseType,
    getDayLog,
    createWorkoutSession,
    ensureWorkoutSession,
    setWorkoutSessionWarmupEnd,
    logExerciseAndSets,
    upsertPersonalRecordIfBetter,
    countAllSessionsSinceStart,
    getSessionPeriodization,
    listBodyMetrics,
  }),
}))

import { logExerciseFromPayload, LogExercisePayloadSchema } from '../log-exercise'
import type { LogExercisePayload } from '../log-exercise'
import { defaultUseFor1rm } from '../default-use-for-1rm'

const TZ = 'Australia/Brisbane'

describe('LogExercisePayloadSchema timing bounds (TMR-3)', () => {
  const validBase = {
    sessionName: 'Push',
    exercise: 'Bench Press',
    weights: [100],
    sets: 1,
    reps: [5],
  }

  it('accepts in-range timing fields', () => {
    const result = LogExercisePayloadSchema.safeParse({
      ...validBase,
      timeToCompleteSet: 45,
      setTimes: [30, 45],
      restTimes: [90, 120],
      setStartTimes: [1_700_000_000_000],
      setEndTimes: [1_700_000_100_000],
      interExerciseRestSec: 60,
    })
    expect(result.success).toBe(true)
  })

  it('rejects a negative rest/lap-time value', () => {
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, restTimes: [-1] }).success).toBe(false)
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, setTimes: [-1] }).success).toBe(false)
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, timeToCompleteSet: -1 }).success).toBe(false)
  })

  it('rejects a timing value above the 24h (86,400s) bound', () => {
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, timeToCompleteSet: 86_401 }).success).toBe(false)
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, interExerciseRestSec: 86_401 }).success).toBe(false)
  })

  it('rejects an epoch-ms timestamp outside the plausible range', () => {
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, setStartTimes: [0] }).success).toBe(false)
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, setEndTimes: [9_999_999_999_999] }).success).toBe(false)
  })

  it('rejects more than 20 entries in a timing array', () => {
    expect(LogExercisePayloadSchema.safeParse({ ...validBase, restTimes: Array(21).fill(10) }).success).toBe(false)
  })
})

describe('defaultUseFor1rm (SYN-8 — shared between the server route and the local-store write path)', () => {
  it('defaults every set to true when all reps are equal', () => {
    expect(defaultUseFor1rm([5, 5, 5], 0)).toBe(true)
    expect(defaultUseFor1rm([5, 5, 5], 2)).toBe(true)
  })

  it('defaults only the min-rep set to true when reps diverge (e.g. a top set)', () => {
    const reps = [8, 8, 5] // last set is the heavy/min-rep top set
    expect(defaultUseFor1rm(reps, 0)).toBe(false)
    expect(defaultUseFor1rm(reps, 1)).toBe(false)
    expect(defaultUseFor1rm(reps, 2)).toBe(true)
  })
})

const basePayload: LogExercisePayload = {
  sessionName: 'Push',
  sessionId: 'ps-1',
  exercise: 'Bench Press',
  weights: [100],
  sets: 1,
  reps: [5],
}

beforeEach(() => {
  getActiveProgramWithPhases.mockReset()
  getActiveProgram.mockReset()
  getExerciseType.mockReset().mockResolvedValue('barbell')
  getDayLog.mockReset().mockResolvedValue([])
  createWorkoutSession.mockReset().mockResolvedValue({ id: 'ws-1' })
  ensureWorkoutSession.mockReset()
  setWorkoutSessionWarmupEnd.mockClear()
  logExerciseAndSets.mockReset().mockResolvedValue({ exerciseLog: { id: 'el-1' } })
  upsertPersonalRecordIfBetter.mockReset().mockResolvedValue(true)
  countAllSessionsSinceStart.mockReset().mockResolvedValue(new Map())
  getSessionPeriodization.mockReset().mockResolvedValue(null)
})

describe('logExerciseFromPayload — ai_dynamic deload PR gate (AI-8)', () => {
  it('does not mint a PR for a beats-target set in an ai_dynamic session_periodization deload phase', async () => {
    // getActiveProgramWithPhases only resolves for 'automatic' programs — null for ai_dynamic.
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'ai_dynamic' })
    getSessionPeriodization.mockResolvedValue({ phase: 'deload' })

    const result = await logExerciseFromPayload('u1', basePayload, TZ)

    expect(getSessionPeriodization).toHaveBeenCalledWith('u1', 'ps-1')
    expect(upsertPersonalRecordIfBetter).not.toHaveBeenCalled()
    expect(result.isPR).toBe(false)
    expect(createWorkoutSession).toHaveBeenCalledWith(
      'u1', 'ps-1', 'Push', expect.any(Date), undefined, 'deload', false,
    )
  })

  it('still mints a PR for the same beats-target set in an ai_dynamic accumulation phase', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'ai_dynamic' })
    getSessionPeriodization.mockResolvedValue({ phase: 'accumulation' })

    const result = await logExerciseFromPayload('u1', basePayload, TZ)

    expect(upsertPersonalRecordIfBetter).toHaveBeenCalledTimes(1)
    expect(result.isPR).toBe(true)
  })

  it('skips the session_periodization lookup for non-ai_dynamic programs', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })

    await logExerciseFromPayload('u1', basePayload, TZ)

    expect(getSessionPeriodization).not.toHaveBeenCalled()
    expect(upsertPersonalRecordIfBetter).toHaveBeenCalledTimes(1)
  })
})

describe('logExerciseFromPayload — planned snapshot (set-log planned_pct/planned_rest_sec)', () => {
  beforeEach(() => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })
  })

  it('snapshots each set’s planned pct/rest verbatim from the progression style', async () => {
    await logExerciseFromPayload('u1', {
      ...basePayload,
      weights: [100, 90],
      sets: 2,
      reps: [5, 8],
      progressionStyle: [
        { pct: 80, reps: 5, restSec: 180 },
        { pct: 70, reps: 8, restSec: 120 },
      ],
    }, TZ)

    const sets = logExerciseAndSets.mock.calls[0][2]
    expect(sets[0]).toMatchObject({ plannedPct: 80, plannedReps: 5, plannedRestSec: 180 })
    expect(sets[1]).toMatchObject({ plannedPct: 70, plannedReps: 8, plannedRestSec: 120 })
  })

  it('leaves the planned snapshot undefined when no progression style is present', async () => {
    await logExerciseFromPayload('u1', basePayload, TZ)

    const sets = logExerciseAndSets.mock.calls[0][2]
    expect(sets[0].plannedPct).toBeUndefined()
    expect(sets[0].plannedReps).toBeUndefined()
    expect(sets[0].plannedRestSec).toBeUndefined()
  })

  // Q-14: a bodyweight movement is never prescribed a %1RM — resolveBodyweightStyle turns the
  // style's pct into a rep target. Storing that pct alongside a BW_REF-relative intensity_pct made
  // every bodyweight set read as a 14-18 pp overshoot against a target that never existed.
  it('writes no planned pct for a bodyweight movement, only the rep target', async () => {
    getExerciseType.mockResolvedValueOnce('bodyweight')
    await logExerciseFromPayload('u1', {
      ...basePayload,
      exercise: 'Pull-Up',
      weights: [0, 0],
      sets: 2,
      reps: [6, 5],
      progressionStyle: [
        { pct: 75, reps: 7, restSec: 150 },
        { pct: 68, reps: 6, restSec: 150 },
      ],
    }, TZ)

    const sets = logExerciseAndSets.mock.calls[0][2]
    expect(sets[0].plannedPct).toBeUndefined()
    expect(sets[1].plannedPct).toBeUndefined()
    // The prescription that was actually delivered survives.
    expect(sets[0]).toMatchObject({ plannedReps: 7, plannedRestSec: 150 })
    expect(sets[1]).toMatchObject({ plannedReps: 6, plannedRestSec: 150 })
  })

  it('still records planned pct for a weighted lift', async () => {
    getExerciseType.mockResolvedValueOnce('barbell')
    await logExerciseFromPayload('u1', {
      ...basePayload,
      weights: [100],
      sets: 1,
      reps: [5],
      progressionStyle: [{ pct: 80, reps: 5, restSec: 180 }],
    }, TZ)

    expect(logExerciseAndSets.mock.calls[0][2][0]).toMatchObject({ plannedPct: 80, plannedReps: 5 })
  })
})

// Q-13: a bodyweight set logs 0 kg on the bar, so volume computed from the raw weights recorded
// ZERO work for real reps. Volume is now priced at the lifter's real body weight × a per-exercise
// fraction — and specifically at the MOST RECENT weigh-in, not the oldest in the lookup window.
describe('bodyweight volume (Q-13)', () => {
  beforeEach(() => {
    logExerciseAndSets.mockClear()
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue(null)
  })

  const logged = () => logExerciseAndSets.mock.calls[0][1] as { volume: number }

  it('prices an unloaded bodyweight set at the latest weigh-in, not zero', async () => {
    getExerciseType.mockResolvedValueOnce('bodyweight')
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload('u1', {
      sessionName: 'Pull', exercise: 'Pull-Up', weights: [0, 0, 0], sets: 3, reps: [6, 6, 6],
    } as never, 'Australia/Brisbane')
    // Pull-Up factor 1.00 × 82.5 kg × 18 reps.
    expect(logged().volume).toBeCloseTo(1485, 1)
  })

  it('uses the most recent weigh-in, never the oldest in the window', async () => {
    // The bug: listBodyMetrics returns newest-first, and reversing it before find() silently
    // selected the 81.85 kg entry from two weeks earlier.
    getExerciseType.mockResolvedValueOnce('bodyweight')
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload('u1', {
      sessionName: 'Pull', exercise: 'Pull-Up', weights: [0, 0, 0], sets: 3, reps: [6, 6, 6],
    } as never, 'Australia/Brisbane')
    expect(logged().volume).not.toBeCloseTo(81.85 * 18, 1)
  })

  it('scales by the exercise’s own body-mass fraction', async () => {
    getExerciseType.mockResolvedValueOnce('bodyweight')
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload('u1', {
      sessionName: 'Pull', exercise: 'Hanging Leg Raise', weights: [0], sets: 1, reps: [10],
    } as never, 'Australia/Brisbane')
    // Both legs ≈ 32% of body mass: 82.5 × 0.32 × 10.
    expect(logged().volume).toBeCloseTo(264, 0)
  })

  it('leaves a weighted lift priced on the bar exactly as before', async () => {
    getExerciseType.mockResolvedValueOnce('barbell')
    const { logExerciseFromPayload } = await import('@trainingai/shared/workout/log-exercise')
    await logExerciseFromPayload('u1', {
      sessionName: 'Push', exercise: 'Barbell Bench Press', weights: [80, 80, 80], sets: 3, reps: [5, 5, 5],
    } as never, 'Australia/Brisbane')
    expect(logged().volume).toBeCloseTo(1200, 1)
  })
})
