/**
 * PS-39 — the four remaining `ai-periodization` routes, batched because they are the program-level
 * half of the same feature the session routes cover (#966) and verify alongside it: skipping the
 * baseline week, moving a session between phases, the program overview card, and the weekly-volume
 * targets the generator's time budget is priced against.
 *
 * Three carry a decision that is invisible from the response shape:
 *
 *   · **`baseline/complete` seeds from typed starting numbers, not only earned ones.**
 *     `personal_records` is log-derived, so a brand-new user has none — the 1RMs they entered in the
 *     program builder live in `exercise_estimates`. Without that fallback the skip-baseline flow was
 *     unreachable for exactly the users it exists for (Q-5), and each source is tagged so the
 *     prescription prompt can tell an earned number from a typed one.
 *   · **A completed transition leaves `'consumed'`, not `'none'`.** `isAiPrescriptionPending` keys on
 *     exactly that value; `'none'` matched nothing, so accepting a transition emptied the card with
 *     nothing left to refill it (owner report, 2026-08-02).
 *   · **`weekly-volume` normalises muscle names on both sides and SUMS the collisions**, because a
 *     target row edited by hand can carry a synonym of one the defaults already wrote.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startOfWeekInTz } from '@trainingai/shared/date-utils'

type Row = Record<string, unknown>

const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const ensureSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row)
const setBaselineComplete = vi.fn(async (_u: string, _s: string, _b: Row) => state() as Row)
const advancePhase = vi.fn(async (_u: string, _s: string, _p: string) => state() as Row)
const updatePrescriptionStatus = vi.fn(async (_u: string, _s: string, _st: string) => undefined)
const listPersonalRecords = vi.fn(async (_u: string) => new Map<string, number>())
const getExerciseEstimates = vi.fn(async (_u: string) => [] as Array<{ exerciseName: string; estimated1rm: number }>)
const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const listPrograms = vi.fn(async (_u: string) => [program()] as Row[])
const listVolumeTargets = vi.fn(async (_u: string, _p: string) =>
  [] as Array<{ muscleGroup: string; targetSetsPerWeek: number }>)
const getWeeklySetsByMuscleGroup = vi.fn(async (_u: string, _p: string, _ws: string, _we: string, _tz: string) =>
  ({}) as Record<string, number>)
const reconcileSessionsInPhase = vi.fn(async (_u: string, _p: string) => undefined)
const listSessionPeriodizationForProgram = vi.fn(async (_u: string, _p: string) => [] as Row[])
const getRecentSessionsOfType = vi.fn(async (_u: string, _s: string, _n: number) => [] as Row[])

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getSessionPeriodization, ensureSessionPeriodization, setBaselineComplete, advancePhase,
    updatePrescriptionStatus, listPersonalRecords, getExerciseEstimates, getActiveProgram,
    listPrograms, listVolumeTargets, getWeeklySetsByMuscleGroup, reconcileSessionsInPhase,
    listSessionPeriodizationForProgram, getRecentSessionsOfType,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { POST as baselineComplete } from '@/app/api/ai-periodization/baseline/complete/route'
import { POST as transition } from '@/app/api/ai-periodization/session/[sessionId]/transition/route'
import { GET as programOverview } from '@/app/api/ai-periodization/program-overview/route'
import { GET as weeklyVolume } from '@/app/api/ai-periodization/weekly-volume/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
const OTHER_SESSION = '00000000-0000-4000-8000-0000000000bb'
const SQUAT = '00000000-0000-4000-8000-000000000001'
const CURL = '00000000-0000-4000-8000-000000000003'

const sessionOf = (id: string, name: string) => ({
  id, programId: 'p-1', name, position: 0, icon: null, timeBudgetMinutes: 60,
  exercises: [
    { id: SQUAT, sessionId: id, exerciseName: 'Squat', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' },
    { id: CURL, sessionId: id, exerciseName: 'Curl', muscleGroups: ['biceps'], position: 1, exerciseRole: 'accessory' },
  ],
})

const program = (over: Row = {}) => ({
  id: 'p-1', name: 'Strength', phaseMode: 'ai_dynamic', trainingGoal: 'strength',
  sessions: [sessionOf(SESSION_ID, 'Upper'), sessionOf(OTHER_SESSION, 'Lower')], ...over,
})

const prescription = (over: Row = {}) => ({
  phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.',
  estimatedSessionDurationMin: 55, weeklyVolumeContribution: {}, confidence: 0.7,
  confidenceReasons: [], droppedExerciseIds: [], exercises: [], ...over,
})

const state = (over: Row = {}) => ({
  id: 'st-1', userId: 'u-1', programSessionId: SESSION_ID, phase: 'accumulation',
  phaseStartedAt: new Date(), sessionsInPhase: 3, baselineComplete: false, baseline1rm: {},
  prescription: null, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'none', lastSessionRanPrescription: null, pendingTransition: null,
  preEmergencyDeloadPhase: null, updatedAt: new Date(), ...over,
})

const post = (
  handler: (req: never, ctx: never) => Promise<Response>,
  url: string, body: unknown, ctx?: unknown,
) => handler(Object.assign(new Request(`http://localhost${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
}), { nextUrl: new URL(`http://localhost${url}`) }) as never, ctx as never)

const completePost = (body: unknown) =>
  post(baselineComplete as never, '/api/ai-periodization/baseline/complete', body)
const transitionPost = (body: unknown, id = SESSION_ID) =>
  post(transition as never, `/api/ai-periodization/session/${id}/transition`, body,
    { params: Promise.resolve({ sessionId: id }) })
const overviewGet = () => programOverview()
const volumeGet = (query = '') =>
  weeklyVolume(Object.assign(new Request(`http://localhost/api/ai-periodization/weekly-volume${query}`), {
    nextUrl: new URL(`http://localhost/api/ai-periodization/weekly-volume${query}`),
  }) as never)

let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

/** The baseline route fires a best-effort self-fetch at /prescribe; never let it reach the network. */
const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

beforeEach(() => {
  vi.clearAllMocks()
  getSessionPeriodization.mockResolvedValue(state())
  ensureSessionPeriodization.mockResolvedValue(state())
  setBaselineComplete.mockResolvedValue(state({ baselineComplete: true }))
  advancePhase.mockResolvedValue(state())
  listPersonalRecords.mockResolvedValue(new Map())
  getExerciseEstimates.mockResolvedValue([])
  getActiveProgram.mockResolvedValue(program())
  listPrograms.mockResolvedValue([program()])
  listVolumeTargets.mockResolvedValue([])
  getWeeklySetsByMuscleGroup.mockResolvedValue({})
  listSessionPeriodizationForProgram.mockResolvedValue([])
  getRecentSessionsOfType.mockResolvedValue([])
  // `clearAllMocks` clears CALLS, not implementations — a `mockRejectedValue` from one case
  // otherwise leaks into the next, which is how the success case first read as a failure.
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ prescription: prescription() }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  }))
  vi.stubGlobal('fetch', fetchMock)
  // The baseline route logs its non-fatal generation failure; captured so the run stays quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {})
  freshUser()
})

afterEach(() => { vi.restoreAllMocks() })

describe('POST /api/ai-periodization/baseline/complete', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await completePost({ sessionId: SESSION_ID })).status).toBe(401)
  })

  it('rejects a body that is not a uuid, carries an extra key, or is oversized', async () => {
    // Each against a request that would otherwise succeed, so the schema is what refuses it.
    expect((await completePost({ sessionId: 'not-a-uuid' })).status).toBe(400)
    expect((await completePost({ sessionId: SESSION_ID, useExisting: true })).status).toBe(400)
    expect((await completePost({ sessionId: SESSION_ID, pad: 'x'.repeat(16 * 1024) })).status).toBe(413)
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  it('refuses to complete a baseline twice', async () => {
    getSessionPeriodization.mockResolvedValue(state({ baselineComplete: true }))
    const res = await completePost({ sessionId: SESSION_ID })
    expect(res.status).toBe(409)
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  it('404s a session that is not in the active program', async () => {
    getActiveProgram.mockResolvedValue(program({ sessions: [] }))
    expect((await completePost({ sessionId: SESSION_ID })).status).toBe(404)
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  it('seeds the anchor from earned records, keyed by session-exercise id', async () => {
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120], ['Curl', 30]]))
    const body = await (await completePost({ sessionId: SESSION_ID })).json()
    expect(body.baseline1rm).toEqual({
      [SQUAT]: { kg: 120, source: 'existing' },
      [CURL]: { kg: 30, source: 'existing' },
    })
    expect(setBaselineComplete.mock.calls[0][2]).toEqual(body.baseline1rm)
  })

  // Q-5. personal_records is log-derived, so a brand-new user has none — the numbers they typed in
  // the builder live in exercise_estimates, and without this the skip-baseline flow was unreachable
  // for exactly the users it exists for. The source tag is what lets the prompt tell them apart.
  it('falls back to the numbers the user typed in the builder, tagged as estimates', async () => {
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120]]))
    getExerciseEstimates.mockResolvedValue([
      { exerciseName: 'Curl', estimated1rm: 25 },
      { exerciseName: 'Squat', estimated1rm: 999 },  // an earned record outranks a typed one
    ])
    const body = await (await completePost({ sessionId: SESSION_ID })).json()
    expect(body.baseline1rm).toEqual({
      [SQUAT]: { kg: 120, source: 'existing' },
      [CURL]: { kg: 25, source: 'estimate' },
    })
  })

  it('refuses to complete with an empty anchor, and says to run a real baseline instead', async () => {
    const res = await completePost({ sessionId: SESSION_ID })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('no_prior_data')
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  it('survives a prescription generation that fails — it is best effort', async () => {
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120]]))
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const res = await completePost({ sessionId: SESSION_ID })
    expect(console.error).toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.baseline1rm[SQUAT]).toEqual({ kg: 120, source: 'existing' })
    expect(body.prescription).toBeNull()
    expect(setBaselineComplete).toHaveBeenCalledTimes(1)  // the baseline still landed
  })

  it('returns the prescription when generation succeeds', async () => {
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120]]))
    const body = await (await completePost({ sessionId: SESSION_ID })).json()
    expect(body.prescription.phase).toBe('accumulation')
  })
})

describe('POST …/session/[sessionId]/transition', () => {
  it('refuses without a session, on a malformed id, and on a body it cannot read', async () => {
    sessionUser = null
    expect((await transitionPost({ newPhase: 'deload' })).status).toBe(401)

    freshUser()
    expect((await transitionPost({ newPhase: 'deload' }, 'not-a-uuid')).status).toBe(400)
    expect((await transitionPost({ newPhase: 'holiday' })).status).toBe(400)
    expect((await transitionPost({ newPhase: 'deload', sneak: 1 })).status).toBe(400)
    expect(advancePhase).not.toHaveBeenCalled()
  })

  it('404s a session with no periodization state', async () => {
    getSessionPeriodization.mockResolvedValue(null)
    expect((await transitionPost({ newPhase: 'intensification' })).status).toBe(404)
  })

  it('allows the next phase in the natural cycle', async () => {
    // accumulation → intensification → realisation → deload → accumulation
    for (const [from, to] of [
      ['accumulation', 'intensification'], ['intensification', 'realisation'],
      ['realisation', 'deload'], ['deload', 'accumulation'],
    ] as const) {
      advancePhase.mockClear()
      getSessionPeriodization.mockResolvedValue(state({ phase: from }))
      expect((await transitionPost({ newPhase: to })).status).toBe(200)
      expect(advancePhase.mock.calls[0][2]).toBe(to)
    }
  })

  it('refuses a jump the engine never recommended, and names the override', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'accumulation' }))
    const res = await transitionPost({ newPhase: 'realisation' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('force:true')
    expect(advancePhase).not.toHaveBeenCalled()
  })

  it('takes that jump when forced', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'accumulation' }))
    expect((await transitionPost({ newPhase: 'realisation', force: true })).status).toBe(200)
    expect(advancePhase.mock.calls[0][2]).toBe('realisation')
  })

  it('allows a non-adjacent phase the stored prescription actually recommended', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      phase: 'accumulation',
      prescription: prescription({ phaseAction: 'transition_recommended', phase: 'realisation' }),
    }))
    expect((await transitionPost({ newPhase: 'realisation' })).status).toBe(200)
  })

  it('does not treat a prescription recommending a DIFFERENT phase as permission', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      phase: 'accumulation',
      prescription: prescription({ phaseAction: 'transition_recommended', phase: 'deload' }),
    }))
    expect((await transitionPost({ newPhase: 'realisation' })).status).toBe(400)
  })

  // 'none' matched nothing `isAiPrescriptionPending` keys on, so accepting a transition emptied the
  // card with nothing left to refill it (owner report, 2026-08-02).
  it('leaves the slot as consumed, so the card refills instead of emptying', async () => {
    await transitionPost({ newPhase: 'intensification' })
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('consumed')
    // Written AFTER advancePhase, which clears the slot to 'none' itself.
    expect(advancePhase).toHaveBeenCalled()
    expect(advancePhase.mock.invocationCallOrder[0])
      .toBeLessThan(updatePrescriptionStatus.mock.invocationCallOrder[0])
  })
})

describe('GET /api/ai-periodization/program-overview', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await overviewGet()).status).toBe(401)
  })

  it('answers an empty list rather than an error when there is no active program', async () => {
    getActiveProgram.mockResolvedValue(null)
    const res = await overviewGet()
    expect(await res.json()).toEqual({ sessions: [] })
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  // Directly-inserted or deleted sessions otherwise leave a stale "N sessions in phase".
  it('heals the stored phase counts before reading them', async () => {
    await overviewGet()
    expect(reconcileSessionsInPhase).toHaveBeenCalledWith('u-' + seq, 'p-1')
    expect(reconcileSessionsInPhase.mock.invocationCallOrder[0])
      .toBeLessThan(listSessionPeriodizationForProgram.mock.invocationCallOrder[0])
  })

  it('pairs each session with its own state, and reports none for a session that has none', async () => {
    listSessionPeriodizationForProgram.mockResolvedValue([state({ programSessionId: OTHER_SESSION, phase: 'deload' })])
    const body = await (await overviewGet()).json()
    expect(body.sessions.map((s: Row) => s.sessionId)).toEqual([SESSION_ID, OTHER_SESSION])
    expect(body.sessions[0].state).toBeNull()
    expect(body.sessions[1].state.phase).toBe('deload')
  })

  it('counts days since the last COMPLETED session, ignoring one still in progress', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
    getRecentSessionsOfType.mockResolvedValue([
      { id: 'ws-2', completedAt: null },            // started today, never finished
      { id: 'ws-1', completedAt: threeDaysAgo },
    ])
    const body = await (await overviewGet()).json()
    expect(body.sessions[0].lastTrainedDaysAgo).toBe(3)
  })

  it('reports null rather than zero when a session has never been trained', async () => {
    const body = await (await overviewGet()).json()
    expect(body.sessions[0].lastTrainedDaysAgo).toBeNull()
  })
})

describe('GET /api/ai-periodization/weekly-volume', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await volumeGet()).status).toBe(401)
  })

  it('404s a programId the caller does not own, without reading its targets', async () => {
    listPrograms.mockResolvedValue([program({ id: 'p-mine' })])
    const res = await volumeGet('?programId=p-someone-elses')
    expect(res.status).toBe(404)
    expect(listVolumeTargets).not.toHaveBeenCalled()
  })

  it('falls back to the active program when none is named', async () => {
    await volumeGet()
    expect(listVolumeTargets.mock.calls[0][1]).toBe('p-1')
    expect(listPrograms).not.toHaveBeenCalled()
  })

  it('404s when there is no program to fall back to', async () => {
    getActiveProgram.mockResolvedValue(null)
    expect((await volumeGet()).status).toBe(404)
  })

  // A target row edited by hand can carry a synonym of one the defaults already wrote, and the
  // logged side is normalised too — so both must land on the same key, and collisions must SUM.
  it('normalises muscle names and sums two rows that mean the same muscle', async () => {
    listVolumeTargets.mockResolvedValue([
      { muscleGroup: 'Quads', targetSetsPerWeek: 8 },
      { muscleGroup: 'quadriceps', targetSetsPerWeek: 4 },
      { muscleGroup: 'biceps', targetSetsPerWeek: 6 },
    ])
    const body = await (await volumeGet()).json()
    expect(body.targets.quads).toBe(12)
    expect(body.targets.biceps).toBe(6)
    expect(Object.keys(body.targets).sort()).toEqual(['biceps', 'quads'])
  })

  it('asks for a Monday-to-Sunday week in the user timezone', async () => {
    freshUser({ timezone: 'Etc/GMT-14' })
    await volumeGet()
    const [, , weekStart, weekEnd, tz] = getWeeklySetsByMuscleGroup.mock.calls[0]
    expect(weekStart).toBe(startOfWeekInTz('Etc/GMT-14'))
    expect(tz).toBe('Etc/GMT-14')
    const span = (new Date(weekEnd + 'T00:00:00Z').getTime() - new Date(weekStart + 'T00:00:00Z').getTime()) / 86_400_000
    expect(span).toBe(6)
  })

  it('answers no-store, because this app manages its own freshness', async () => {
    expect((await volumeGet()).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
