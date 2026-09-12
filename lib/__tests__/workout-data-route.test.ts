/**
 * PS-39 — `/api/workout-data`, the last of the twelve routes #956 found were *believed* tested and
 * were not, and the biggest: 600 lines behind one GET, serving three different shapes off a query
 * param. Its own source calls it "one of the two reads the whole offline architecture leans on".
 *
 * Four of the behaviours pinned here have a production incident named in the code beside them, and
 * every one of them is invisible from the response shape:
 *
 *   · **A poll must not fire generation.** The pre-workout screen polls every ~3s while a
 *     prescription regenerates; without the guard each tick fired a fresh generation, turning one
 *     into a burst of ~8 Gemini calls that tripped the per-minute limit and 502'd them all.
 *   · **A poll must not be HTTP-cached.** With `max-age=30` the browser re-served the first poll's
 *     `aiPrescriptionPending: true` for the entire poll window, so the client never saw the
 *     prescription that landed mid-window and timed out into "couldn't generate" — while generation
 *     had in fact succeeded (prod 2026-07-19).
 *   · **`?tab=all` is strictly read-only** — no generation, no writes, no re-evaluation. It exists
 *     to collapse an N+1 prefetch, and the authoritative single-tab fetch does that work.
 *   · **The two deload entry points converge.** The pre-workout toggle sends `?aiDeload=1`; Home's
 *     "Take deload week now" writes `earlyDeloadWeekStart` and sends no param at all. The second
 *     arrived a week late and produced byte-identical full-intensity prescriptions for a whole
 *     confirmed deload week (Q-175).
 *
 * `buildWorkoutExercises` and `buildAutomaticPhaseStatus` are mocked — both are large shared
 * functions with their own tests, and mocking them is what lets these cases assert on the DECISIONS
 * this route makes (does the AI drive load, is deload active, which exercises are dropped) rather
 * than on a rendered exercise list. `isEarlyDeloadWeek`, `prescriptionDrivesLoad`,
 * `isAiPrescriptionPending` and `normalizeStoredPrescription` are real: they are the decisions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { todayInTz } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const listProgressionStyles = vi.fn(async (_u: string) => [] as Row[])
const listExerciseLibrary = vi.fn(async () => [] as Row[])
const listProgramPhases = vi.fn(async (_u: string, _p: string) => [] as Row[])
const countAllSessionsSinceStart = vi.fn(async (_u: string, _p: string) => new Map<string, number>())
const getLastExerciseLogsBatch = vi.fn(async (_u: string, _n: string[], _p?: string) => new Map<string, Row>())
const getLastRealOneRmBatch = vi.fn(async (_u: string, _n: string[]) => new Map<string, number>())
const getDayExerciseNames = vi.fn(async (_u: string, _d: string, _tz: string) =>
  [] as Array<{ sessionId: string; exerciseName: string }>)
const listPersonalRecords = vi.fn(async (_u: string) => new Map<string, number>())
const getExerciseEstimates = vi.fn(async (_u: string) => [] as Array<{ exerciseName: string; estimated1rm: number }>)
const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => null as Row | null)
const reconcileSessionsInPhase = vi.fn(async (_u: string, _p: string) => undefined)
const getMoodLog = vi.fn(async (_u: string, _d: string) => null as Row | null)
const getDayCheckin = vi.fn(async (_u: string, _d: string, _p: string) => null as Row | null)
const listInjuries = vi.fn(async (_u: string) => [] as Row[])
const getRecentSessionsOfType = vi.fn(async (_u: string, _s: string, _n: number) => [] as Row[])
const getExerciseMuscleAssignments = vi.fn(async (_n: string[]) => ({}) as Record<string, Row[]>)
const getOuraDailyDerived = vi.fn(async (_u: string, _f: string, _t: string) => [] as Row[])
const updatePrescriptionExercisesCache = vi.fn(async (_u: string, _s: string, _p: Row) => undefined)

const buildWorkoutExercises = vi.fn((_s: unknown, _o: unknown) => [] as Row[])
const buildAutomaticPhaseStatus = vi.fn((..._a: unknown[]) => phaseStatus() as Row)
const regeneratePrescriptionSingleFlight = vi.fn((_u: string, _s: string, _o: Row) => undefined)
const reportServerError = vi.fn()

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getActiveProgram, listProgressionStyles, listExerciseLibrary, listProgramPhases,
    countAllSessionsSinceStart, getLastExerciseLogsBatch, getLastRealOneRmBatch,
    getDayExerciseNames, listPersonalRecords, getExerciseEstimates, getSessionPeriodization,
    reconcileSessionsInPhase, getMoodLog, getDayCheckin, listInjuries, getRecentSessionsOfType,
    getExerciseMuscleAssignments, getOuraDailyDerived, updatePrescriptionExercisesCache,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/workout/session-data', async (orig) => ({
  ...(await orig() as object),
  buildWorkoutExercises: (s: unknown, o: unknown) => buildWorkoutExercises(s, o),
}))
vi.mock('@trainingai/shared/phase-engine', async (orig) => ({
  ...(await orig() as object),
  buildAutomaticPhaseStatus: (...a: unknown[]) => buildAutomaticPhaseStatus(...a),
}))
vi.mock('@trainingai/shared/ai-periodization/regenerate-in-background', () => ({
  regeneratePrescriptionInBackground: (u: string, s: string, o: Row) => regeneratePrescriptionSingleFlight(u, s, o),
}))
vi.mock('@/lib/observability', () => ({ reportServerError: (...a: unknown[]) => reportServerError(...a) }))

import { GET as workoutData } from '@/app/api/workout-data/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_SESSION = '00000000-0000-4000-8000-0000000000bb'
const SQUAT = '00000000-0000-4000-8000-000000000001'
const CURL = '00000000-0000-4000-8000-000000000003'

const sessionOf = (id: string, name: string) => ({
  id, programId: 'p-1', name, position: 0, timeBudgetMinutes: 60,
  exercises: [
    { id: SQUAT, sessionId: id, exerciseName: 'Squat', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' },
    { id: CURL, sessionId: id, exerciseName: 'Curl', muscleGroups: ['biceps'], position: 1, exerciseRole: 'accessory' },
  ],
})

const program = (over: Row = {}) => ({
  id: 'p-1', name: 'Strength', phaseMode: 'manual', trainingGoal: 'strength',
  sessions: [sessionOf(SESSION_ID, 'Upper'), sessionOf(OTHER_SESSION, 'Lower')],
  schedule: null, ...over,
})

const phaseStatus = (over: Row = {}) => ({
  phase: { id: 'ph-1', phaseSetId: 'ps-1', position: 0, name: 'Accumulation', durationCycles: 4, phaseType: 'accumulation' },
  cycleInPhase: 1, totalPhaseCycles: 4, completedCycles: 0, totalProgramCycles: 8,
  sessionsPerCycle: 3, sessionsInCurrentCycle: 0, blockComplete: false,
  approxWeeksRemaining: 4, isDeloadActive: false, isBaseline: false, openEnded: false,
  phaseSessionNumber: 1, ...over,
})

const prescription = (over: Row = {}) => ({
  phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.',
  estimatedSessionDurationMin: 55, weeklyVolumeContribution: {}, confidence: 0.7,
  confidenceReasons: [], droppedExerciseIds: [],
  exercises: [
    { sessionExerciseId: SQUAT, name: 'Squat', sets: 4, reps: 5, pct: 80, restSec: 180 },
    { sessionExerciseId: CURL, name: 'Curl', sets: 3, reps: 12, pct: 60, restSec: 90 },
  ],
  ...over,
})

const periodization = (over: Row = {}) => ({
  id: 'st-1', userId: 'u-1', programSessionId: SESSION_ID, phase: 'accumulation',
  phaseStartedAt: new Date(), sessionsInPhase: 3, baselineComplete: true, baseline1rm: {},
  prescription: prescription(), prescriptionGeneratedAt: new Date(), prescriptionExpiresAt: new Date(Date.now() + 86_400_000),
  prescriptionStatus: 'accepted', lastSessionRanPrescription: null, pendingTransition: null,
  preEmergencyDeloadPhase: null, updatedAt: new Date(), ...over,
})

const get = (query = '') =>
  workoutData(Object.assign(new Request(`http://localhost/api/workout-data${query}`), {
    nextUrl: { pathname: '/api/workout-data' },
  }) as never)

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  vi.clearAllMocks()
  getActiveProgram.mockResolvedValue(program())
  listProgressionStyles.mockResolvedValue([])
  listExerciseLibrary.mockResolvedValue([])
  listProgramPhases.mockResolvedValue([])
  countAllSessionsSinceStart.mockResolvedValue(new Map())
  getLastExerciseLogsBatch.mockResolvedValue(new Map())
  getLastRealOneRmBatch.mockResolvedValue(new Map())
  getDayExerciseNames.mockResolvedValue([])
  listPersonalRecords.mockResolvedValue(new Map())
  getExerciseEstimates.mockResolvedValue([])
  getSessionPeriodization.mockResolvedValue(null)
  getMoodLog.mockResolvedValue(null)
  getDayCheckin.mockResolvedValue(null)
  listInjuries.mockResolvedValue([])
  getRecentSessionsOfType.mockResolvedValue([])
  getExerciseMuscleAssignments.mockResolvedValue({})
  getOuraDailyDerived.mockResolvedValue([])
  buildWorkoutExercises.mockReturnValue([])
  buildAutomaticPhaseStatus.mockReturnValue(phaseStatus())
  freshUser()
})

/** The options `buildWorkoutExercises` was called with — where this route's decisions land. */
const buildOptsFor = (sessionId = SESSION_ID) => {
  const call = buildWorkoutExercises.mock.calls.find(c => (c[0] as Row).id === sessionId)
  return call?.[1] as Row | undefined
}

describe('GET /api/workout-data — the basics', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await get('?tab=' + SESSION_ID)).status).toBe(401)
  })

  it('answers empty rather than an error when there is no active program', async () => {
    getActiveProgram.mockResolvedValue(null)
    const res = await get('?tab=' + SESSION_ID)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ exercises: [], sessions: [] })
  })

  // K8 — one of the two reads the whole offline architecture leans on. An uncaught throw here
  // otherwise 500s with no server trace.
  it('records a thrown read before answering 500', async () => {
    getActiveProgram.mockRejectedValue(new Error('drifted prod data'))
    const res = await get('?tab=' + SESSION_ID)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to load workout data' })
    expect(reportServerError).toHaveBeenCalledTimes(1)
    expect(reportServerError.mock.calls[0][1]).toEqual({ url: '/api/workout-data' })
  })

  // Session identity = DB id, never name. A name match or a sessions[0] fallback would silently
  // serve the WRONG session's numbers instead of letting the client re-sync its offline mirror.
  it('resolves strictly by id — a name is not found, and there is no first-session fallback', async () => {
    for (const q of ['?tab=Upper', '?tab=' + '00000000-0000-4000-8000-00000000dead']) {
      const body = await (await get(q)).json()
      expect(body).toEqual({ exercises: [], sessionNotFound: true })
    }
    expect(buildWorkoutExercises).not.toHaveBeenCalled()
  })

  it('reads the session from either query name', async () => {
    expect((await (await get('?session=' + SESSION_ID)).json()).session.id).toBe(SESSION_ID)
    expect((await (await get('?tab=' + SESSION_ID)).json()).session.id).toBe(SESSION_ID)
  })

  it('counts an exercise done today only within THIS session', async () => {
    // Shared exercise names across sessions are normal (a cable movement in Push and Upper).
    getDayExerciseNames.mockResolvedValue([
      { sessionId: OTHER_SESSION, exerciseName: 'Squat' },
      { sessionId: SESSION_ID, exerciseName: 'Curl' },
    ])
    await get('?tab=' + SESSION_ID)
    expect([...(buildOptsFor()!.loggedTodayInThisSession as Set<string>)]).toEqual(['Curl'])
  })

  it('keys the day to the user timezone, not the server one', async () => {
    // Two fixed-offset zones 26 hours apart, so their local dates differ whatever the clock says.
    const dayFor = async (timezone: string) => {
      freshUser({ timezone }); getDayExerciseNames.mockClear()
      const body = await (await get('?tab=' + SESSION_ID)).json()
      return { dataDate: body.dataDate, asked: getDayExerciseNames.mock.calls[0][1] }
    }
    const ahead = await dayFor('Etc/GMT-14')
    const behind = await dayFor('Etc/GMT+12')
    expect(ahead.dataDate).not.toBe(behind.dataDate)
    expect(ahead.dataDate).toBe(todayInTz('Etc/GMT-14'))
    expect(ahead.asked).toBe(todayInTz('Etc/GMT-14').replace(/-/g, '/'))
  })
})

describe('GET /api/workout-data?tab=meta — program structure', () => {
  it('returns the program and styles with no phase status on a manual program', async () => {
    const body = await (await get('?tab=meta')).json()
    expect(body.program.id).toBe('p-1')
    expect(body.phaseStatus).toBeNull()
    expect(body.perSessionPhaseStatus).toEqual([])
    expect(listProgramPhases).not.toHaveBeenCalled()
  })

  it('answers the same for an empty tab param', async () => {
    expect((await (await get('')).json()).program.id).toBe('p-1')
  })

  // The leader is the session furthest through the program, not the first one listed.
  it('reports the furthest-progressed session as the program phase status', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'automatic' }))
    listProgramPhases.mockResolvedValue([{ id: 'ph-1' }])
    buildAutomaticPhaseStatus
      .mockReturnValueOnce(phaseStatus({ completedCycles: 1 }))
      .mockReturnValueOnce(phaseStatus({ completedCycles: 5 }))
    const body = await (await get('?tab=meta')).json()
    expect(body.phaseStatus.completedCycles).toBe(5)
    expect(body.perSessionPhaseStatus.map((p: Row) => p.sessionId)).toEqual([SESSION_ID, OTHER_SESSION])
  })
})

describe('GET /api/workout-data — a poll must cost nothing', () => {
  const consumed = () => getSessionPeriodization.mockResolvedValue(periodization({ prescriptionStatus: 'consumed' }))

  it('regenerates a consumed prescription on an ordinary read', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    consumed()
    const body = await (await get('?tab=' + SESSION_ID)).json()
    expect(body.aiPrescriptionPending).toBe(true)
    expect(regeneratePrescriptionSingleFlight).toHaveBeenCalledTimes(1)
  })

  // Without this the ~3s poll fired a fresh generation every tick — one generation became a burst
  // of ~8 Gemini calls that tripped the per-minute limit and 502'd them all.
  it('reports the same pending state on a poll without firing generation', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    consumed()
    const body = await (await get(`?tab=${SESSION_ID}&poll=1`)).json()
    expect(body.aiPrescriptionPending).toBe(true)
    expect(regeneratePrescriptionSingleFlight).not.toHaveBeenCalled()
  })

  // With max-age the browser re-served the first poll's `pending: true` for the whole window, so
  // the client never saw the prescription that landed mid-window (prod 2026-07-19).
  it('never lets a poll response be HTTP-cached', async () => {
    expect((await get(`?tab=${SESSION_ID}&poll=1`)).headers.get('Cache-Control')).toBe('no-store')
    expect((await get(`?tab=${SESSION_ID}`)).headers.get('Cache-Control')).toBe('private, no-store')
    expect((await get('?tab=meta')).headers.get('Cache-Control')).toBe('private, no-store')
  })
})

describe('GET /api/workout-data?tab=all — strictly read-only', () => {
  beforeEach(() => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    getSessionPeriodization.mockResolvedValue(periodization({ prescriptionStatus: 'consumed' }))
  })

  it('returns every session keyed by id in one response', async () => {
    const body = await (await get('?tab=all')).json()
    expect(Object.keys(body.perSession).sort()).toEqual([SESSION_ID, OTHER_SESSION].sort())
    expect(body.perSession[SESSION_ID].session.name).toBe('Upper')
  })

  it('reports pending state without generating, writing, or re-evaluating', async () => {
    const body = await (await get('?tab=all')).json()
    expect(body.perSession[SESSION_ID].aiPrescriptionPending).toBe(true)
    expect(regeneratePrescriptionSingleFlight).not.toHaveBeenCalled()
    expect(updatePrescriptionExercisesCache).not.toHaveBeenCalled()
    // The re-evaluation reads are the tell: the single-tab path makes them, this one must not.
    expect(getMoodLog).not.toHaveBeenCalled()
    expect(listInjuries).not.toHaveBeenCalled()
  })

  it('never passes the aiDeload toggle, which this path cannot see', async () => {
    await get('?tab=all&aiDeload=1')
    expect(buildOptsFor()!.aiDeload).toBe(false)
  })
})

describe('GET /api/workout-data — the two deload entry points converge (Q-175)', () => {
  beforeEach(() => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    getSessionPeriodization.mockResolvedValue(periodization())
  })

  it('is not deloaded by default', async () => {
    const body = await (await get('?tab=' + SESSION_ID)).json()
    expect(body.phaseStatus.isDeloadActive).toBe(false)
    expect(buildOptsFor()!.isDeloadActive).toBe(false)
  })

  it('deloads from the pre-workout toggle', async () => {
    const body = await (await get(`?tab=${SESSION_ID}&aiDeload=1`)).json()
    expect(body.phaseStatus.isDeloadActive).toBe(true)
    expect(buildOptsFor()!.aiDeload).toBe(true)
  })

  // Home's "Take deload week now" writes earlyDeloadWeekStart and sends NO query param. Missing
  // this produced byte-identical full-intensity prescriptions for a whole confirmed deload week.
  it('deloads from a confirmed early-deload week with no query param at all', async () => {
    const tz = 'Australia/Brisbane'
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic', earlyDeloadWeekStart: todayInTz(tz) }))
    const body = await (await get('?tab=' + SESSION_ID)).json()
    expect(body.phaseStatus.isDeloadActive).toBe(true)
    expect(buildOptsFor()!.isDeloadActive).toBe(true)
  })

  it('leaves a week that has already ended alone', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic', earlyDeloadWeekStart: '2026-01-01' }))
    const body = await (await get('?tab=' + SESSION_ID)).json()
    expect(body.phaseStatus.isDeloadActive).toBe(false)
  })
})

describe('GET /api/workout-data — what drives the bar', () => {
  beforeEach(() => { getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' })) })

  it('lets an accepted prescription drive load, and omits what it dropped this cycle', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({
      prescription: prescription({ droppedExerciseIds: [CURL] }),
    }))
    await get('?tab=' + SESSION_ID)
    const opts = buildOptsFor()!
    expect(opts.aiDrivesLoad).toBe(true)
    expect([...(opts.droppedThisCycle as Set<string>)]).toEqual([CURL])
    expect(opts.aiPhaseLabel).toBe('Accumulation')
  })

  it('keeps a dismissed prescription off the bar, and its drops with it', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({
      prescriptionStatus: 'dismissed',
      prescription: prescription({ droppedExerciseIds: [CURL] }),
    }))
    await get('?tab=' + SESSION_ID)
    const opts = buildOptsFor()!
    expect(opts.aiDrivesLoad).toBe(false)
    expect([...(opts.droppedThisCycle as Set<string>)]).toEqual([])
  })

  it('normalises a stored prescription before it reaches the bar', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({
      prescription: prescription({
        exercises: [{ sessionExerciseId: SQUAT, name: 'Squat', sets: 1, reps: 5, pct: 80, restSec: 180 }],
      }),
    }))
    await get('?tab=' + SESSION_ID)
    const p = buildOptsFor()!.aiPrescription as { exercises: Array<{ sets: number }> }
    expect(p.exercises[0].sets).toBe(2)  // the two-set read-side floor
  })

  it('keeps the AI off the bar during a baseline week', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({ phase: 'baseline', baselineComplete: false }))
    await get('?tab=' + SESSION_ID)
    const opts = buildOptsFor()!
    expect(opts.isBaselinePhase).toBe(true)
    expect(opts.aiPrescription).toBeNull()
    expect(opts.aiDrivesLoad).toBe(false)
  })

  // BF-148 — REPLACES a test that asserted the opposite ("ends a stale baseline only on a log from
  // THIS program"). That guard was keyed on exercise NAMES, so rebuilding a session inside an
  // existing program reused the names and read as already-calibrated: the header rendered
  // "Baseline" from this same periodization state while the set card prescribed a normal 3x8.
  // The periodization row is now the only authority, which is what the header, the pre-workout
  // panel and generate-prescription's refusal already trusted.
  it('keeps the baseline when the same exercise names were logged before in this program', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({ phase: 'baseline', baselineComplete: false }))
    getLastExerciseLogsBatch.mockImplementation(async (_u: string, _n: string[], programId?: string) =>
      programId === 'p-1' ? new Map([['Squat', { id: 'log-1' }]]) : new Map())
    await get('?tab=' + SESSION_ID)
    expect(buildOptsFor()!.isBaselinePhase).toBe(true)
  })

  // The other half of the same rule: a completed baseline ends it, and nothing else has to.
  // `phase` stays 'baseline' on purpose so `baselineComplete` is the ONLY term under test —
  // flipping the phase as well would let the condition pass for the wrong reason.
  it('ends the baseline when the periodization row says it is complete', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({ phase: 'baseline', baselineComplete: true }))
    getLastExerciseLogsBatch.mockResolvedValue(new Map())
    await get('?tab=' + SESSION_ID)
    expect(buildOptsFor()!.isBaselinePhase).toBe(false)
  })

  // And the phase term carries its own weight: a session past baseline does not re-enter it just
  // because the completion flag was never set. Without this, `phase === 'baseline'` could be
  // deleted from the condition and every test would still pass.
  it('does not re-enter the baseline for a later phase with the flag unset', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({ phase: 'accumulation', baselineComplete: false }))
    getLastExerciseLogsBatch.mockResolvedValue(new Map())
    await get('?tab=' + SESSION_ID)
    expect(buildOptsFor()!.isBaselinePhase).toBe(false)
  })
})

describe('GET /api/workout-data — the consumption-day re-evaluation', () => {
  beforeEach(() => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    getSessionPeriodization.mockResolvedValue(periodization())
  })

  it('re-evaluates against today and caches the fingerprint it settled on', async () => {
    await get('?tab=' + SESSION_ID)
    expect(updatePrescriptionExercisesCache).toHaveBeenCalledTimes(1)
    const stamped = updatePrescriptionExercisesCache.mock.calls[0][2] as { reevaluatedInputsKey?: string }
    expect(stamped.reevaluatedInputsKey).toBeTruthy()
    expect((buildOptsFor()!.aiPrescription as Row).reevaluatedInputsKey).toBe(stamped.reevaluatedInputsKey)
  })

  // The cheap skip on a repeat fetch. Two guards were removed and replaced by this fingerprint
  // because both made a same-day check-in — the case where it matters most — unable to take effect.
  it('skips the heavy reads when the inputs have not moved since last time', async () => {
    await get('?tab=' + SESSION_ID)
    const key = (updatePrescriptionExercisesCache.mock.calls[0][2] as { reevaluatedInputsKey: string }).reevaluatedInputsKey

    vi.clearAllMocks()
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    getSessionPeriodization.mockResolvedValue(periodization({
      prescription: prescription({ reevaluatedInputsKey: key }),
    }))
    buildWorkoutExercises.mockReturnValue([])
    await get('?tab=' + SESSION_ID)
    expect(getRecentSessionsOfType).not.toHaveBeenCalled()
    expect(updatePrescriptionExercisesCache).not.toHaveBeenCalled()
  })

  it('re-runs the moment a check-in changes the inputs', async () => {
    await get('?tab=' + SESSION_ID)
    const key = (updatePrescriptionExercisesCache.mock.calls[0][2] as { reevaluatedInputsKey: string }).reevaluatedInputsKey

    vi.clearAllMocks()
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    getSessionPeriodization.mockResolvedValue(periodization({
      prescription: prescription({ reevaluatedInputsKey: key }),
    }))
    getMoodLog.mockResolvedValue({ bodyState: ['sore_muscles'], soreMuscles: ['quads'] })
    buildWorkoutExercises.mockReturnValue([])
    await get('?tab=' + SESSION_ID)
    expect(getRecentSessionsOfType).toHaveBeenCalledTimes(1)
  })

  it('does not re-evaluate a prescription that is not driving the bar', async () => {
    getSessionPeriodization.mockResolvedValue(periodization({ prescriptionStatus: 'dismissed' }))
    await get('?tab=' + SESSION_ID)
    expect(getMoodLog).not.toHaveBeenCalled()
    expect(updatePrescriptionExercisesCache).not.toHaveBeenCalled()
  })
})
