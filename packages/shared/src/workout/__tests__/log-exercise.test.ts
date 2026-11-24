import { describe, it, expect, vi, beforeEach } from 'vitest'

const getActiveProgramWithPhases = vi.fn()
const getActiveProgram           = vi.fn()
const getExerciseType            = vi.fn(async () => 'barbell')
const getDayLog                  = vi.fn(async () => [])
const createWorkoutSession       = vi.fn(async (..._a: unknown[]) => ({ id: 'ws-1' }))
const ensureWorkoutSession       = vi.fn()
const setWorkoutSessionWarmupEnd = vi.fn(async () => {})
const logExerciseAndSets         = vi.fn(async () => ({ exerciseLog: { id: 'el-1' } }))
const upsertPersonalRecordIfBetter = vi.fn(async () => true)
const countAllSessionsSinceStart = vi.fn(async () => new Map())
const getSessionPeriodization    = vi.fn(async () => null)
const getPrescriptionBasisBefore = vi.fn(async (): Promise<number | null> => null)
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
    getPrescriptionBasisBefore,
    programSessionIdOwned: async () => true,
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
  getPrescriptionBasisBefore.mockReset().mockResolvedValue(null)
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
      'u1', 'ps-1', 'Push', expect.any(Date), undefined, 'deload', false, null, false,
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

  // TN-75: an AI-dynamic calibration session is stored as 'baseline', matching workout-data's test.
  it('stores an unfinished ai_dynamic baseline as the session phase, and a finished one as nothing', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'ai_dynamic' })
    getSessionPeriodization.mockResolvedValue({ phase: 'baseline', baselineComplete: false } as never)
    await logExerciseFromPayload('u1', basePayload, TZ)
    expect(createWorkoutSession).toHaveBeenLastCalledWith(
      'u1', 'ps-1', 'Push', expect.any(Date), undefined, 'baseline', false, null, false,
    )

    getSessionPeriodization.mockResolvedValue({ phase: 'baseline', baselineComplete: true } as never)
    await logExerciseFromPayload('u1', basePayload, TZ)
    expect(createWorkoutSession).toHaveBeenLastCalledWith(
      'u1', 'ps-1', 'Push', expect.any(Date), undefined, undefined, false, null, false,
    )
  })

  it('skips the session_periodization lookup for non-ai_dynamic programs', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })

    await logExerciseFromPayload('u1', basePayload, TZ)

    expect(getSessionPeriodization).not.toHaveBeenCalled()
    expect(upsertPersonalRecordIfBetter).toHaveBeenCalledTimes(1)
  })
  // #3671: a PR set at 21:00 that syncs the next morning is dated by the set, not by the upload.
  it('dates the PR by the last set\'s end, which is the log\'s own loggedAt', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })
    const setEnd = Date.now() - 12 * 3_600_000
    await logExerciseFromPayload('u1', { ...basePayload, setEndTimes: [setEnd] }, TZ)
    expect(upsertPersonalRecordIfBetter).toHaveBeenCalledWith('u1', 'Bench Press', expect.any(Number), new Date(setEnd), 'el-1')
  })
})

// #3877: a session the lifter overrode to full weight inside a deload phase is not a deload. Production
// had one (26 Oct: phase deload, mode full, override on) that stored an estimate of 0 on every exercise.
describe('logExerciseFromPayload — a deload overridden to full weight (#3877)', () => {
  beforeEach(() => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'ai_dynamic' })
    getSessionPeriodization.mockResolvedValue({ phase: 'deload' } as never)
  })

  it('estimates the 1RM, can set a record, and is not recorded as a deload', async () => {
    const result = await logExerciseFromPayload('u1', { ...basePayload, intensityMode: 'full', wasOverride: true }, TZ)
    expect(result.estimated1rm).toBeGreaterThan(0)
    expect(result.isPR).toBe(true)
    expect(createWorkoutSession).toHaveBeenCalledWith('u1', 'ps-1', 'Push', expect.any(Date), undefined, undefined, false, 'full', true)
  })

  // The three payload shapes that reach the server for an override to full weight: native sends
  // `'full'`, the WebView omits the field (it sends `intensityMode` only for a deload), and an outbox
  // replay of a full session carries null.
  it.each([
    ['native: intensityMode full', { intensityMode: 'full' as const }],
    ['web: intensityMode omitted', {}],
    ['outbox replay: intensityMode null', { intensityMode: null }],
  ])('an override to full weight keeps its 1RM — %s', async (_label, mode) => {
    const result = await logExerciseFromPayload('u1', { ...basePayload, ...mode, wasOverride: true } as never, TZ)
    expect(result.estimated1rm).toBeGreaterThan(0)
    expect(result.isPR).toBe(true)
  })

  it('no override and no mode (the web\'s plain deload session) is still the phase\'s deload', async () => {
    const result = await logExerciseFromPayload('u1', { ...basePayload }, TZ)
    expect(result.estimated1rm).toBe(0)
    expect(result.isPR).toBe(false)
  })

  // #4097: what was trained decides. A workout that says it was trained at full weight is full whatever the stored
  // phase is by the time it uploads; one that says nothing (an older build, the WebView's full weight) still
  // takes the stored phase, as before.
  it('an upload that says full weight is full, even when the stored phase has since become the deload', async () => {
    const result = await logExerciseFromPayload('u1', { ...basePayload, intensityMode: 'full', wasOverride: false }, TZ)
    expect(result.estimated1rm).toBeGreaterThan(0)
    expect(createWorkoutSession).toHaveBeenCalledWith('u1', 'ps-1', 'Push', expect.any(Date), undefined, undefined, false, 'full', false)
  })

  it('an upload that says nothing about how it was trained is the stored phase\'s deload, as before', async () => {
    const result = await logExerciseFromPayload('u1', { ...basePayload, intensityMode: undefined, wasOverride: false }, TZ)
    expect(result.estimated1rm).toBe(0)
    expect(result.isPR).toBe(false)
  })

  it('an upload that says deload is a deload whatever the stored phase is', async () => {
    getSessionPeriodization.mockResolvedValue({ phase: 'accumulation', baselineComplete: true } as never)
    const result = await logExerciseFromPayload('u1', { ...basePayload, intensityMode: 'deload', wasOverride: false }, TZ)
    expect(result.estimated1rm).toBe(0)
  })

  // #3888: with no `workoutSessionId` and no open session of that name, the create branch stored
  // neither field, so the session row read back as "no override" whatever the lifter chose.
  it.each([
    ['full, overridden', { intensityMode: 'full' as const, wasOverride: true }, 'full', true],
    ['deload, overridden', { intensityMode: 'deload' as const, wasOverride: true }, 'deload', true],
    ['deload, plan as given', { intensityMode: 'deload' as const, wasOverride: false }, 'deload', false],
  ])('a session created without a client id stores the intensity mode and override — %s', async (_l, mode, wantMode, wantOverride) => {
    await logExerciseFromPayload('u1', { ...basePayload, ...mode }, TZ)
    expect(createWorkoutSession).toHaveBeenCalledTimes(1)
    const call = createWorkoutSession.mock.calls[0]
    expect(call[7]).toBe(wantMode)
    expect(call[8]).toBe(wantOverride)
  })

  it('an override to the deload stays a deload', async () => {
    const result = await logExerciseFromPayload('u1', { ...basePayload, intensityMode: 'deload', wasOverride: true }, TZ)
    expect(result.estimated1rm).toBe(0)
    expect(result.isPR).toBe(false)
  })

  it('a session already stored as a deload keeps its type: past rows are not rewritten', async () => {
    ensureWorkoutSession.mockResolvedValue({ wasInserted: false, phaseId: undefined, phaseType: 'deload', isEarlyDeload: false })
    const result = await logExerciseFromPayload('u1', {
      ...basePayload, workoutSessionId: '00000000-0000-4000-8000-000000003877', intensityMode: 'full', wasOverride: true,
    }, TZ)
    expect(result.estimated1rm).toBe(0)
    expect(result.isPR).toBe(false)
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

// LA-21. The midnight fallback here is where **7 of the owner's 11 implausible sessions came from**:
// each recorded `started_at` at exactly 00:00 local against a `completed_at` between 08:53 and 14:05,
// so a real workout read as an 8-to-14-hour one. Those durations are culled from statistics now,
// which means those sessions contribute nothing — recording a plausible start is what makes a real
// workout count again.
describe('logExerciseFromPayload — the session start ladder (LA-21)', () => {
  const startOf = () => createWorkoutSession.mock.calls[0][3] as Date
  const localMidnightMs = (isoDay: string) =>
    new Date(`${isoDay}T00:00:00+10:00`).getTime()   // Brisbane, no DST

  beforeEach(() => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })
  })

  it('prefers the device anchor when the payload carries one', async () => {
    const anchor = Date.now() - 40 * 60_000
    await logExerciseFromPayload('u1', { ...basePayload, workoutStartedAt: anchor }, TZ)
    expect(startOf().getTime()).toBe(anchor)
  })

  // The case that produced the seven. The first set's start is already in the payload and is INSIDE
  // the session, so it loses the warm-up rather than the hours midnight loses.
  it('falls back to the first set start, not to midnight', async () => {
    const firstSet = Date.now() - 25 * 60_000
    await logExerciseFromPayload('u1', { ...basePayload, setStartTimes: [firstSet, firstSet + 120_000] }, TZ)
    expect(startOf().getTime()).toBe(firstSet)
  })

  // `workout-screen.tsx` sends `workoutStartMs ?? undefined`, and the store's abandoned-session guard
  // nulls `workoutStartMs` — so the guard that protects against a days-old session is what leaves the
  // next log with no anchor at all. Logging happens during the session, so `now` is inside it.
  it('uses now when nothing in the payload carries timing and the log is for today', async () => {
    const before = Date.now()
    await logExerciseFromPayload('u1', basePayload, TZ)
    const started = startOf().getTime()
    expect(started).toBeGreaterThanOrEqual(before)
    expect(started).toBeLessThanOrEqual(Date.now())
  })

  // A back-dated log is the one case where we genuinely do not know, and `now` would be a worse lie
  // than midnight — it would place the session on the wrong DAY. Midnight plus the cull is honest.
  it('keeps midnight for a back-dated log, where the start is genuinely unknown', async () => {
    await logExerciseFromPayload('u1', { ...basePayload, localDate: '2026-05-04' }, TZ)
    expect(startOf().getTime()).toBe(localMidnightMs('2026-05-04'))
  })
})

// Q-298. A phase-level deload zeroes the 1RM (deload work is submaximal and must not read as a max)
// and used to store `exercise_deloaded = false` — so the row did not describe what had happened to
// it. The estimate and its provenance now come from one named predicate, which is the only way they
// cannot drift apart again.
describe('logExerciseFromPayload — deload provenance (Q-298)', () => {
  const storedDeloaded = () => logExerciseAndSets.mock.calls[0][1].exerciseDeloaded as boolean
  const storedEstimate = () => logExerciseAndSets.mock.calls[0][1].estimated1rm as number

  beforeEach(() => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'manual' })
  })

  it('stamps the flag when the PHASE is the deload, not only when the AI flag is', async () => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue({ id: 'p1', phaseMode: 'ai_dynamic' })
    getSessionPeriodization.mockResolvedValue({ phase: 'deload' })

    await logExerciseFromPayload('u1', basePayload, TZ)

    expect(storedEstimate()).toBe(0)        // the estimate was declined…
    expect(storedDeloaded()).toBe(true)     // …and the row now says so
  })

  it('still stamps it for a per-exercise AI deload', async () => {
    await logExerciseFromPayload('u1', { ...basePayload, exerciseDeloaded: true }, TZ)
    expect(storedEstimate()).toBe(0)
    expect(storedDeloaded()).toBe(true)
  })

  // The invariant that makes this safe to rely on downstream: a zero estimate and a false flag can
  // no longer occur together, which is the state `getLastRealOneRmBatch` needed a second predicate
  // to defend against.
  it('leaves an ordinary set unflagged and estimated', async () => {
    await logExerciseFromPayload('u1', basePayload, TZ)
    expect(storedDeloaded()).toBe(false)
    expect(storedEstimate()).toBeGreaterThan(0)
  })
})

// Issue 2200: the server scores each set against the bar the device put up.
describe('score against the bar loaded (issue 2200)', () => {
  beforeEach(() => {
    getActiveProgramWithPhases.mockResolvedValue(null)
    getActiveProgram.mockResolvedValue(null)
  })
  const skull = {
    ...basePayload,
    exercise: 'Barbell Skull Crusher',
    weights: [27.5, 27.5],
    sets: 2,
    reps: [10, 10],
    progressionStyle: [{ pct: 70.5, reps: 10, restSec: 90 }, { pct: 70.5, reps: 10, restSec: 90 }],
    plannedWeights: [27.5, 27.5],
  }

  it('the prescribed bar hit exactly holds the basis the device sent', async () => {
    const out = await logExerciseFromPayload('u1', { ...skull, prescriptionBasisKg: 36.5 }, TZ)
    expect(out.estimated1rm).toBe(36.5)
    expect(getPrescriptionBasisBefore).not.toHaveBeenCalled()
  })

  it('a replay with bars but no basis reads the last real 1RM before the log', async () => {
    getPrescriptionBasisBefore.mockResolvedValueOnce(36.5)
    const out = await logExerciseFromPayload('u1', { ...skull, exerciseLogId: '00000000-0000-4000-8000-000000002200', setEndTimes: [1_759_700_000_000, 1_759_700_100_000] }, TZ)
    expect(out.estimated1rm).toBe(36.5)
    expect(getPrescriptionBasisBefore).toHaveBeenCalledWith('u1', 'Barbell Skull Crusher', new Date(1_759_700_100_000), '00000000-0000-4000-8000-000000002200')
  })

  it('with no basis anywhere it scores as before (the planned percentage)', async () => {
    const out = await logExerciseFromPayload('u1', skull, TZ)
    expect(out.estimated1rm).toBe(39)
  })

  it('a basis that could not have produced the bar is ignored', async () => {
    const out = await logExerciseFromPayload('u1', { ...skull, prescriptionBasisKg: 30 }, TZ)
    expect(out.estimated1rm).toBe(39)
  })

  it('without bars the basis is never looked up', async () => {
    await logExerciseFromPayload('u1', { ...skull, plannedWeights: undefined }, TZ)
    expect(getPrescriptionBasisBefore).not.toHaveBeenCalled()
  })

  it('rejects a non-positive basis at the schema', () => {
    const valid = { sessionName: 'Push', exercise: 'Barbell Skull Crusher', weights: [27.5], sets: 1, reps: [10], plannedWeights: [27.5] }
    expect(LogExercisePayloadSchema.safeParse({ ...valid, prescriptionBasisKg: 0 }).success).toBe(false)
    expect(LogExercisePayloadSchema.safeParse({ ...valid, prescriptionBasisKg: 36.5 }).success).toBe(true)
  })
})
