/**
 * PS-39 — the three routes that make up one prescription's life: `prescribe` generates it, the
 * session `GET` is what the card reads, and `respond` accepts or dismisses it. None had a test that
 * imports its handler, and they are batched here because they verify as one thing — a prescription
 * that generates but cannot be read, or is accepted without reaching the bar, is the same defect
 * seen from three places.
 *
 * Two behaviours carry live incidents and are the reason this file exists:
 *
 *   · **Accepting a deload lightens that session and leaves the phase alone** (#3799). It used to
 *     move the phase to `deload`, which held the loads down for two or three weeks from one day's
 *     reason. Only a planned move (the realisation ceiling, or the phase list) moves it.
 *   · **The GET normalises what it read.** A generation-time floor cannot reach a row already
 *     stored, and those live up to seven days: four single-set prescriptions were live on
 *     2026-07-28, one of them `auto_applied` and actually loading the bar, and an accessory was
 *     prescribed above the primary it sat beside.
 *
 * `normalizeStoredPrescription` and `buildCardExerciseSignals` are therefore NOT mocked.
 * `generatePrescriptionForSession` is — it is the whole generation engine and has its own tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const ensureSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const setBaselineComplete = vi.fn(async (_u: string, _s: string, _b: Row, _mode?: { read?: boolean }) => state({ phase: 'accumulation', baselineComplete: true }) as Row)
const advancePhase = vi.fn(async (_u: string, _s: string, _p: string) => state({ phase: 'deload' }) as Row)
const storePrescription = vi.fn(async (_u: string, _s: string, _p: Row, _e: Date) => undefined)
const updatePrescriptionStatus = vi.fn(async (_u: string, _s: string, _st: string) => undefined)
const getLastExerciseLogsBatch = vi.fn(async (_u: string, _n: string[], _p?: string) => new Map<string, Row>())
const wasProgramSessionTrainedSince = vi.fn(async (_u: string, _s: string, _since: Date) => false)
const revertAutoAdoptedBaseline = vi.fn(async (_u: string, _s: string) => null as Row | null)
const listPersonalRecords = vi.fn(async (_u: string) => new Map<string, number>())
const listRecent1rm = vi.fn(async (_u: string) => new Map<string, { latest: number; previous?: number }>())
const generatePrescriptionForSession = vi.fn(async (..._a: unknown[]) => generated() as Row)
const listSessionPeriodizationForProgram = vi.fn(async (..._a: unknown[]) => [] as Row[])
const refitPrescriptionToBudget = vi.fn(async (..._a: unknown[]) => ({ ok: false, reason: 'no_baseline' }) as Row)

let sessionUser: { id: string; timezone?: string } | null = { id: 'u-1', timezone: 'Australia/Brisbane' }
vi.mock('@/auth', () => ({ auth: async () => (sessionUser ? { user: sessionUser } : null) }))
vi.mock('@/lib/data', () => {
  // Built inside the returned function: `vi.mock` is hoisted above the consts above.
  const repo = async () => ({
    getActiveProgram, ensureSessionPeriodization, getSessionPeriodization, setBaselineComplete,
    advancePhase, storePrescription, updatePrescriptionStatus, getLastExerciseLogsBatch,
    wasProgramSessionTrainedSince,
    revertAutoAdoptedBaseline,
    listPersonalRecords, listRecent1rm,
      // #3766: the program's phase. A program move reaches the same spy as a per-type one; which of the
    // two the route picks is tested in program-phase-3766.test.ts.
    advanceProgramPhase: advancePhase,
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    listSessionPeriodizationForProgram: (...a: unknown[]) => listSessionPeriodizationForProgram(...a),
    reconcileSessionsInPhase: async () => undefined,
})
  return { getRepository: repo, getRepositoryAsync: repo }
})
vi.mock('@trainingai/shared/ai-periodization/generate-prescription', () => ({
  generatePrescriptionForSession: (...a: unknown[]) => generatePrescriptionForSession(...a),
}))
vi.mock('@trainingai/shared/ai-periodization/refit-prescription', () => ({
  refitPrescriptionToBudget: (...a: unknown[]) => refitPrescriptionToBudget(...a),
}))

import { POST as prescribe } from '@/app/api/ai-periodization/session/[sessionId]/prescribe/route'
import { POST as respond } from '@/app/api/ai-periodization/session/[sessionId]/respond/route'
import { GET as readSession } from '@/app/api/ai-periodization/session/[sessionId]/route'
import { POST as transition } from '@/app/api/ai-periodization/session/[sessionId]/transition/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000000aa'
const SQUAT = '00000000-0000-4000-8000-000000000001'
const CURL = '00000000-0000-4000-8000-000000000003'

const program = (over: Row = {}) => ({
  id: 'p-1', name: 'Strength',
  sessions: [{
    id: SESSION_ID, programId: 'p-1', name: 'Upper', position: 0, timeBudgetMinutes: 60,
    exercises: [
      { id: SQUAT, sessionId: SESSION_ID, exerciseName: 'Squat', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary' },
      { id: CURL, sessionId: SESSION_ID, exerciseName: 'Curl', muscleGroups: ['biceps'], position: 1, exerciseRole: 'accessory' },
    ],
  }],
  ...over,
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

const state = (over: Row = {}) => ({
  id: 'st-1', userId: 'u-1', programSessionId: SESSION_ID, phase: 'accumulation',
  phaseStartedAt: new Date(), sessionsInPhase: 3, baselineComplete: true, baseline1rm: {},
  prescription: null, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'none', lastSessionRanPrescription: null, pendingTransition: null,
  preEmergencyDeloadPhase: null, updatedAt: new Date(), ...over,
})

const generated = (over: Row = {}) => ({
  ok: true, prescription: prescription(), prescriptionStatus: 'pending',
  estimatedSessionDurationMin: 55, ...over,
})

const ctx = (id = SESSION_ID) => ({ params: Promise.resolve({ sessionId: id }) })
const post = (handler: typeof prescribe, path: string, body: unknown, id = SESSION_ID) =>
  handler(new Request(`http://localhost/api/ai-periodization/session/${id}/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never, ctx(id) as never)
const prescribePost = (body?: unknown, id = SESSION_ID) => post(prescribe, 'prescribe', body, id)
const respondPost = (body?: unknown, id = SESSION_ID) => post(respond, 'respond', body, id)
const transitionPost = (body?: unknown, id = SESSION_ID) => post(transition, 'transition', body, id)
const getSession = (id = SESSION_ID) =>
  readSession(new Request(`http://localhost/api/ai-periodization/session/${id}`) as never, ctx(id) as never)

/** A fresh user per case — prescribe allows 20 an hour and cases would throttle each other. */
let seq = 0
const freshUser = (over: { timezone?: string } = {}) => {
  sessionUser = { id: `u-${++seq}`, timezone: 'Australia/Brisbane', ...over }
}

beforeEach(() => {
  for (const m of [getActiveProgram, ensureSessionPeriodization, getSessionPeriodization,
    setBaselineComplete, advancePhase, storePrescription, updatePrescriptionStatus,
    getLastExerciseLogsBatch, wasProgramSessionTrainedSince,
    listPersonalRecords, listRecent1rm, generatePrescriptionForSession,
    refitPrescriptionToBudget,
    revertAutoAdoptedBaseline]) m.mockClear()
  getActiveProgram.mockResolvedValue(program())
  ensureSessionPeriodization.mockResolvedValue(state())
  getSessionPeriodization.mockResolvedValue(state())
  getLastExerciseLogsBatch.mockResolvedValue(new Map())
  wasProgramSessionTrainedSince.mockResolvedValue(false)
  revertAutoAdoptedBaseline.mockResolvedValue(null)
  listPersonalRecords.mockResolvedValue(new Map())
  listRecent1rm.mockResolvedValue(new Map())
  generatePrescriptionForSession.mockResolvedValue(generated())
  // Declines by default, so every pre-existing case still exercises the generation path —
  // which is also what production does until a prescription carrying a baseline exists.
  refitPrescriptionToBudget.mockResolvedValue({ ok: false, reason: 'no_baseline' } as Row)
  freshUser()
})

describe('POST …/session/[sessionId]/prescribe', () => {
  it('refuses without a session', async () => {
    sessionUser = null
    expect((await prescribePost()).status).toBe(401)
  })

  it('rejects a malformed id before generating anything', async () => {
    expect((await prescribePost(undefined, 'not-a-uuid')).status).toBe(400)
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })

  it('generates with no body at all — the manual path sends none', async () => {
    const res = await prescribePost()
    expect(res.status).toBe(200)
    const [, , , tz, exclude, preset] = generatePrescriptionForSession.mock.calls[0]
    expect(tz).toBe('Australia/Brisbane')
    expect(exclude).toBeUndefined()
    expect(preset).toBeUndefined()
  })

  it('passes the user timezone through, not the server one', async () => {
    freshUser({ timezone: 'America/New_York' })
    await prescribePost()
    expect(generatePrescriptionForSession.mock.calls[0][3]).toBe('America/New_York')
  })

  it('forwards the completion-path exclusion and the duration preset', async () => {
    await prescribePost({ excludeSessionId: 'ws-9', durationPreset: 'long' })
    const [, , , , exclude, preset] = generatePrescriptionForSession.mock.calls[0]
    expect(exclude).toBe('ws-9')
    expect(preset).toBe('long')
  })

  it('rejects an unknown body key and an invented preset', async () => {
    expect((await prescribePost({ durationPreset: 'standard', sneak: 1 })).status).toBe(400)
    freshUser()
    expect((await prescribePost({ durationPreset: 'epic' })).status).toBe(400)
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })

  // BF-7 PR 2b — the ladder is minutes now. These exercise the real handler and the real schema,
  // which is what makes them the route's verification rather than the model's.
  it('forwards a chosen number of minutes', async () => {
    await prescribePost({ durationPreset: 45 })
    expect(generatePrescriptionForSession.mock.calls[0][5]).toBe(45)
  })

  it('still accepts the three stored labels, because prescriptions carry them', async () => {
    for (const label of ['short', 'standard', 'long'] as const) {
      generatePrescriptionForSession.mockClear()
      freshUser()
      await prescribePost({ durationPreset: label })
      expect(generatePrescriptionForSession.mock.calls[0][5]).toBe(label)
    }
  })

  it('rejects a minute count that is out of range or not whole', async () => {
    for (const bad of [-30, 1441, 45.5]) {
      generatePrescriptionForSession.mockClear()
      freshUser()
      expect((await prescribePost({ durationPreset: bad })).status).toBe(400)
      expect(generatePrescriptionForSession).not.toHaveBeenCalled()
    }
  })

  // CONTROL — the bounds are a REQUEST guard, not the model's floor. A request below
  // MIN_PRESET_BUDGET_MIN is legal and gets clamped downstream with its direction intact; 400ing it
  // would tell a lifter at the floor that their choice was malformed.
  it('accepts an under-floor request rather than refusing it', async () => {
    await prescribePost({ durationPreset: 5 })
    expect(generatePrescriptionForSession.mock.calls[0][5]).toBe(5)
  })

  it('accepts zero as an explicit request to turn the time limit off', async () => {
    const response = await prescribePost({ durationPreset: 0 })
    expect(response.status).toBe(200)
    expect(refitPrescriptionToBudget.mock.calls[0][4]).toBe(0)
    expect(generatePrescriptionForSession.mock.calls[0][5]).toBe(0)
  })

  it('refuses an oversized body', async () => {
    expect((await prescribePost({ excludeSessionId: 'x'.repeat(32 * 1024) })).status).toBe(413)
  })

  it('reports the generator own failure status, not a blanket 500', async () => {
    generatePrescriptionForSession.mockResolvedValue({ ok: false, error: 'Not AI-dynamic', status: 400 })
    const res = await prescribePost()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Not AI-dynamic' })
  })

  it('defaults the reported preset to standard when the prescription carries none', async () => {
    expect((await (await prescribePost()).json()).durationPreset).toBe('standard')

    freshUser()
    generatePrescriptionForSession.mockResolvedValue(
      generated({ prescription: prescription({ durationPreset: 'short' }) }))
    expect((await (await prescribePost()).json()).durationPreset).toBe('short')
  })

  it('rate-limits the twenty-first generation in the hour', async () => {
    for (let i = 0; i < 20; i++) expect((await prescribePost()).status).toBe(200)
    expect((await prescribePost()).status).toBe(429)
  })
})

/**
 * LA-147 — two buckets, because two very different things arrive at this route.
 *
 * RV-202 ② stopped a duration change from calling the model but left it spending the model's
 * allowance, so twenty preset switches in an hour produced "Too many requests" for work the AI
 * never saw. The limit's own comment cited preset-switching as the reason it was 20 rather than
 * 10 — the justification had outlived the behaviour.
 */
describe('a re-fit does not spend the model\'s budget (LA-147)', () => {
  const refittedOk = () => ({
    ok: true,
    prescription: { ...generated().prescription as Row, durationPreset: 'short' },
    prescriptionStatus: 'pending',
    estimatedSessionDurationMin: 25,
  }) as Row

  it('allows more re-fits than the model\'s limit would', async () => {
    // THE case. Twenty-one preset switches used to 429 on the twenty-first; none of them reaches
    // the model, so none of them should be charged to it.
    refitPrescriptionToBudget.mockResolvedValue(refittedOk())
    for (let i = 0; i < 25; i++) {
      expect((await prescribePost({ durationPreset: 'short' })).status, `switch ${i + 1}`).toBe(200)
    }
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
  })

  it('still bounds them — the re-fit runs ~30 repository reads, so it is not free', async () => {
    refitPrescriptionToBudget.mockResolvedValue(refittedOk())
    for (let i = 0; i < 60; i++) expect((await prescribePost({ durationPreset: 'short' })).status).toBe(200)
    expect((await prescribePost({ durationPreset: 'short' })).status).toBe(429)
  })

  it('leaves the model\'s own budget intact after a run of re-fits', async () => {
    // The two buckets are independent: spending the cheap one must not consume the model's.
    refitPrescriptionToBudget.mockResolvedValue(refittedOk())
    for (let i = 0; i < 25; i++) await prescribePost({ durationPreset: 'short' })

    refitPrescriptionToBudget.mockResolvedValue({ ok: false, reason: 'no_baseline' } as Row)
    expect((await prescribePost()).status).toBe(200)
    expect(generatePrescriptionForSession).toHaveBeenCalled()
  })

  it('CHARGES the model bucket when a preset request falls through to a real generation', async () => {
    // A preset with no stored plan to re-fit reaches the generator, so it is about to spend
    // tokens and must be charged like any other generation.
    refitPrescriptionToBudget.mockResolvedValue({ ok: false, reason: 'no_baseline' } as Row)
    for (let i = 0; i < 20; i++) {
      expect((await prescribePost({ durationPreset: 'long' })).status).toBe(200)
    }
    expect((await prescribePost({ durationPreset: 'long' })).status).toBe(429)
  })

  it('refuses before reading the body, so an unparsed request cannot be free', async () => {
    // The outer ceiling is checked first precisely so the branch-deciding field cannot be omitted
    // to get a free parse. Past it, even a malformed body is refused by the limiter, not the schema.
    for (let i = 0; i < 60; i++) await prescribePost({ durationPreset: 'short' })
    expect((await prescribePost({ durationPreset: 'nonsense-not-a-preset' })).status).toBe(429)
  })
})

describe('a duration change re-fits instead of re-generating (RV-202 ②)', () => {
  const refitted = () => ({
    ok: true,
    prescription: { ...generated().prescription as Row, durationPreset: 'short' },
    prescriptionStatus: 'pending',
    estimatedSessionDurationMin: 25,
  }) as Row

  it('does not reach the model at all when the stored plan can answer', async () => {
    refitPrescriptionToBudget.mockResolvedValue(refitted())
    const res = await prescribePost({ durationPreset: 'short' })
    expect(res.status).toBe(200)
    expect(generatePrescriptionForSession).not.toHaveBeenCalled()
    const [, , , tz, preset] = refitPrescriptionToBudget.mock.calls[0]
    expect(tz).toBe('Australia/Brisbane')
    expect(preset).toBe('short')
    expect((await res.json()).durationPreset).toBe('short')
  })

  it('is never consulted when no preset was asked for', async () => {
    await prescribePost()
    expect(refitPrescriptionToBudget).not.toHaveBeenCalled()
    expect(generatePrescriptionForSession).toHaveBeenCalled()
  })

  it('falls through to a full generation when the stored plan cannot answer', async () => {
    const res = await prescribePost({ durationPreset: 'long' })
    expect(res.status).toBe(200)
    expect(refitPrescriptionToBudget).toHaveBeenCalled()
    expect(generatePrescriptionForSession.mock.calls[0][5]).toBe('long')
  })
})

describe('POST …/session/[sessionId]/respond', () => {
  const withPrescription = (over: Row = {}) =>
    getSessionPeriodization.mockResolvedValue(state({ prescription: prescription(over), ...over }))

  it('refuses without a session, on a malformed id, and on a body it cannot read', async () => {
    sessionUser = null
    expect((await respondPost({ action: 'accept' })).status).toBe(401)

    freshUser()
    expect((await respondPost({ action: 'accept' }, 'not-a-uuid')).status).toBe(400)
    expect((await respondPost({ action: 'maybe' })).status).toBe(400)
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  // Deliberately against a state that WOULD succeed: with a null prescription every body is a 400
  // for the next reason down, and the case would pass with no schema at all.
  it('rejects an unknown body key rather than stripping it', async () => {
    withPrescription()
    const res = await respondPost({ action: 'accept', sneak: 1 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid body' })
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('404s an unknown session and 400s one with nothing to respond to', async () => {
    getSessionPeriodization.mockResolvedValue(null)
    expect((await respondPost({ action: 'accept' })).status).toBe(404)

    getSessionPeriodization.mockResolvedValue(state({ prescription: null }))
    const res = await respondPost({ action: 'accept' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No prescription')
  })

  it('records an ordinary accept and dismiss without touching the phase', async () => {
    withPrescription()
    expect(await (await respondPost({ action: 'accept' })).json()).toEqual({ prescriptionStatus: 'accepted' })
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('accepted')
    expect(advancePhase).not.toHaveBeenCalled()

    updatePrescriptionStatus.mockClear()
    expect(await (await respondPost({ action: 'dismiss' })).json()).toEqual({ prescriptionStatus: 'dismissed' })
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('dismissed')
    expect(advancePhase).not.toHaveBeenCalled()
  })

  // #3799, option A. A deload offered for one day's reason lightens that session only.
  it('accepting a deload offer leaves the phase where it is and keeps the plan', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      prescription: prescription({ phase: 'deload', deload: true, phaseAction: 'deload_recommended' }),
      prescriptionStatus: 'pending',
    }))
    const res = await respondPost({ action: 'accept' })
    expect(res.status).toBe(200)
    expect(advancePhase).not.toHaveBeenCalled()
    expect(storePrescription).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('accepted')
  })

  it('does not re-flip a session already in deload', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      phase: 'deload',
      prescription: prescription({ deload: true, phaseAction: 'deload_recommended' }),
    }))
    await respondPost({ action: 'accept' })
    expect(advancePhase).not.toHaveBeenCalled()
    expect(storePrescription).not.toHaveBeenCalled()
  })

  it('never flips the phase on a dismiss, deload or not', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      prescription: prescription({ deload: true, phaseAction: 'deload_recommended' }),
    }))
    await respondPost({ action: 'dismiss' })
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('dismissed')
  })
})

// #3799: only a planned deload moves the phase. A deload offered for one day's reason is taken for
// that session by "Move to Deload", the same as accepting it.
describe('POST …/session/[sessionId]/transition — one-day vs planned deload (#3799)', () => {
  const oneDay = () => prescription({ phase: 'deload', deload: true, phaseAction: 'deload_recommended' })

  it('"Move to Deload" on a one-day deload offer accepts it and leaves the phase', async () => {
    getSessionPeriodization.mockResolvedValue(state({ prescription: oneDay(), prescriptionStatus: 'pending' }))
    const res = await transitionPost({ newPhase: 'deload' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.phaseMoved).toBe(false)
    expect(body.prescriptionStatus).toBe('accepted')
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus.mock.calls[0][2]).toBe('accepted')
  })

  it('#3900: "Move to Deload" on a deload the AI plan already applied takes it again and writes nothing', async () => {
    getSessionPeriodization.mockResolvedValue(state({ prescription: oneDay(), prescriptionStatus: 'auto_applied' }))
    const res = await transitionPost({ newPhase: 'deload' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ phaseMoved: false, prescriptionStatus: 'auto_applied' })
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('a one-day offer in realisation (deload is the adjacent phase) still leaves the phase', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'realisation', prescription: oneDay(), prescriptionStatus: 'pending' }))
    await transitionPost({ newPhase: 'deload' })
    expect(advancePhase).not.toHaveBeenCalled()
  })

  it('an unforced "Move to Deload" over a one-day deload already trained is refused, phase unchanged', async () => {
    getSessionPeriodization.mockResolvedValue(state({ phase: 'realisation', prescription: oneDay(), prescriptionStatus: 'consumed' }))
    const res = await transitionPost({ newPhase: 'deload' })
    expect(res.status).toBe(409)
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('the realisation ceiling\'s planned deload moves the phase', async () => {
    getSessionPeriodization.mockResolvedValue(state({
      phase: 'realisation',
      prescription: prescription({ phase: 'deload', phaseAction: 'transition_recommended' }),
      prescriptionStatus: 'pending',
    }))
    const res = await transitionPost({ newPhase: 'deload' })
    expect(res.status).toBe(200)
    expect(advancePhase.mock.calls[0][2]).toBe('deload')
  })

  it('the lifter choosing Deload from the phase list moves the phase, even over a one-day offer', async () => {
    getSessionPeriodization.mockResolvedValue(state({ prescription: oneDay(), prescriptionStatus: 'pending' }))
    await transitionPost({ newPhase: 'deload', force: true })
    expect(advancePhase.mock.calls[0][2]).toBe('deload')
  })

  it('the lifter choosing Deload from the phase list with no offer moves the phase', async () => {
    getSessionPeriodization.mockResolvedValue(state({ prescription: prescription(), prescriptionStatus: 'auto_applied' }))
    await transitionPost({ newPhase: 'deload', force: true })
    expect(advancePhase.mock.calls[0][2]).toBe('deload')
  })
})

// #3876: a move to the phase the type is already in changes nothing. A type two sessions into its
// deload (production: 5 and 12 Nov) got "Move to Deload" on 18 Nov and its deload started again.
describe('POST …/session/[sessionId]/transition — a move to the phase it is already in (#3876)', () => {
  const deloadStart = new Date('2026-11-04T08:00:00Z')
  // The plan was made at the deload's current count: one made before it is an ended deload's plan,
  // which the card does not show and this route no longer takes (#3907).
  const inDeload = (over: Row = {}) => state({
    phase: 'deload', phaseStartedAt: deloadStart, sessionsInPhase: 2,
    prescription: prescription({ phase: 'deload', deload: true, phaseAction: 'deload_recommended', sessionsInPhaseAtPlan: 2 }),
    prescriptionStatus: 'pending', ...over,
  })

  for (const force of [false, true]) {
    it(`"Move to Deload" ${force ? 'with' : 'without'} force takes the plan and leaves the start and count`, async () => {
      getSessionPeriodization.mockResolvedValue(inDeload())
      const res = await transitionPost({ newPhase: 'deload', ...(force && { force: true }) })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.phaseMoved).toBe(false)
      expect(body.prescriptionStatus).toBe('accepted')
      expect(body.state.phaseStartedAt).toBe(deloadStart.toISOString())
      expect(body.state.sessionsInPhase).toBe(2)
      expect(advancePhase).not.toHaveBeenCalled()
      expect(updatePrescriptionStatus.mock.calls.map(c => c[2])).toEqual(['accepted'])
    })
  }

  it('with no plan on offer it changes nothing at all', async () => {
    getSessionPeriodization.mockResolvedValue(inDeload({ prescriptionStatus: 'consumed' }))
    const res = await transitionPost({ newPhase: 'deload', force: true })
    expect(res.status).toBe(200)
    expect((await res.json()).phaseMoved).toBe(false)
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('the same holds for any phase: accumulation to accumulation is not a restart', async () => {
    getSessionPeriodization.mockResolvedValue(state({ prescription: prescription(), prescriptionStatus: 'pending' }))
    await transitionPost({ newPhase: 'accumulation', force: true })
    expect(advancePhase).not.toHaveBeenCalled()
  })

  it('a move to another phase still moves it', async () => {
    getSessionPeriodization.mockResolvedValue(inDeload())
    await transitionPost({ newPhase: 'accumulation', force: true })
    expect(advancePhase.mock.calls[0][2]).toBe('accumulation')
  })
})

describe('GET …/session/[sessionId]', () => {
  it('refuses without a session and on a malformed id', async () => {
    sessionUser = null
    expect((await getSession()).status).toBe(401)

    freshUser()
    expect((await getSession('not-a-uuid')).status).toBe(400)
    expect(getActiveProgram).not.toHaveBeenCalled()
  })

  it('404s a session that is not in the caller\'s own active program', async () => {
    getActiveProgram.mockResolvedValue(program({ sessions: [] }))
    expect((await getSession()).status).toBe(404)
    expect(ensureSessionPeriodization).not.toHaveBeenCalled()
  })

  it('answers no-store, because this app manages its own freshness', async () => {
    const res = await getSession()
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('derives the card signals from the latest two estimates (the PR is only the display value), without the full aggregation', async () => {
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120], ['Curl', 30]]))
    listRecent1rm.mockResolvedValue(new Map([['Squat', { latest: 100, previous: 110 }]]))
    const body = await (await getSession()).json()
    const squat = body.signals.exercises.find((e: Row) => e.sessionExerciseId === SQUAT)
    expect(squat).toMatchObject({ name: 'Squat', role: 'primary', current1rm: 120, latest1rm: 100, rm1Trend: 'down', rm1ChangeKg: -10 })
    // No previous record: a trend cannot be claimed, and the change is not invented.
    expect(body.signals.exercises.find((e: Row) => e.sessionExerciseId === CURL))
      .toMatchObject({ current1rm: 30, rm1Trend: 'flat', rm1ChangeKg: 0 })
  })

  // Read-side normalisation. The generation-time floor cannot reach a row already stored.
  it('floors a stored single-set prescription to two working sets on read', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({
      prescription: prescription({
        exercises: [{ sessionExerciseId: SQUAT, name: 'Squat', sets: 1, reps: 5, pct: 80, restSec: 180 }],
      }),
    }))
    const body = await (await getSession()).json()
    expect(body.state.prescription.exercises[0].sets).toBe(2)
  })

  it('caps a stored accessory that out-loads the session anchor', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({
      prescription: prescription({
        exercises: [
          { sessionExerciseId: SQUAT, name: 'Squat', sets: 4, reps: 5, pct: 76, restSec: 180 },
          { sessionExerciseId: CURL, name: 'Curl', sets: 3, reps: 12, pct: 77.5, restSec: 90 },
        ],
      }),
    }))
    const body = await (await getSession()).json()
    const curl = body.state.prescription.exercises.find((e: Row) => e.sessionExerciseId === CURL)
    expect(curl.pct).toBe(76)
  })

  it('rewrites a stored transition that would go nowhere', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({
      phase: 'accumulation',
      prescription: prescription({ phase: 'accumulation', phaseAction: 'transition_recommended' }),
    }))
    const body = await (await getSession()).json()
    expect(body.state.prescription.phaseAction).toBe('stay')
  })
})

// #3876, review of acd5f2d: the card's read served a stored plan in a deload that had done its two
// sessions. Its `deload: true` was adopted by both toggles, and Preview trained a third deload.
describe('GET …/session/[sessionId] — a deload that has ended (#3876)', () => {
  const deloadPlan = (atPlan: number) => state({
    phase: 'deload', sessionsInPhase: 2, prescriptionStatus: 'auto_applied',
    prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    prescription: prescription({ phase: 'deload', deload: true, sessionsInPhaseAtPlan: atPlan }),
  })

  // Waiting for its switch-over (two types on different phases), so the type's own count decides.
  beforeEach(() => {
    listSessionPeriodizationForProgram.mockResolvedValue([
      state({ phase: 'deload', phaseStartedAt: new Date(Date.now() - 9 * 86_400_000) }),
      state({ programSessionId: 'other', phase: 'accumulation' }),
    ])
    return () => { listSessionPeriodizationForProgram.mockResolvedValue([]) }
  })

  it('serves a plan made before the deload\'s second session as no plan', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    ensureSessionPeriodization.mockResolvedValue(deloadPlan(1))
    const body = await (await getSession()).json()
    expect(body.state).toMatchObject({ prescription: null, prescriptionAgedOut: true, phase: 'deload' })
  })

  it('serves a plan made at the current count, which has been through the exit', async () => {
    getActiveProgram.mockResolvedValue(program({ phaseMode: 'ai_dynamic' }))
    ensureSessionPeriodization.mockResolvedValue(deloadPlan(2))
    const body = await (await getSession()).json()
    expect(body.state.prescription).toMatchObject({ deload: true })
    expect(body.state.prescriptionAgedOut).toBeUndefined()
  })
})

describe('GET …/session/[sessionId] — the stale-baseline auto-heal', () => {
  const baselineRunning = () =>
    ensureSessionPeriodization.mockResolvedValue(state({ phase: 'baseline', baselineComplete: false }))

  it('leaves a genuine baseline week alone when nothing has been logged', async () => {
    baselineRunning()
    await getSession()
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  /**
   * The repository answered yes: this program session carries a log at least as new as the phase
   * clock. BF-144 moved that date comparison down into the query, so the route-level shape is the
   * answer rather than the logs — the comparison itself is covered against a real database in
   * `lib/data/postgres/__tests__/was-program-session-trained-since.test.ts`.
   */
  const loggedSincePhaseStart = () => wasProgramSessionTrainedSince.mockResolvedValue(true)

  it('completes a baseline the completion endpoint never reached, from the personal records', async () => {
    baselineRunning()
    loggedSincePhaseStart()
    // BOTH exercises, because a subset no longer completes — see the partial-coverage case below.
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120], ['Curl', 30]]))
    await getSession()
    expect(setBaselineComplete.mock.calls[0][2]).toEqual({
      [SQUAT]: { kg: 120, source: 'personal_record' },
      [CURL]: { kg: 30, source: 'personal_record' },
    })
  })

  // #4098: a baseline workout finished while the lock was busy stored its measured anchors by the partial
  // write. The self-heal completes from them: a personal record only fills what was not measured.
  it('keeps a measured anchor over a personal record, and asks for the read mode (a busy lock is skipped)', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({
      phase: 'baseline', baselineComplete: false, baseline1rm: { [SQUAT]: { kg: 135, source: 'amrap' } },
    }))
    loggedSincePhaseStart()
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120], ['Curl', 30]]))
    await getSession()
    expect(setBaselineComplete.mock.calls[0][2]).toEqual({
      [SQUAT]: { kg: 135, source: 'amrap' },
      [CURL]: { kg: 30, source: 'personal_record' },
    })
    expect(setBaselineComplete.mock.calls[0][3]).toEqual({ read: true })
  })

  // BF-143 ①. The owner rebuilt a session inside an existing program and it never asked for an
  // AMRAP: the old condition asked whether these exercise NAMES had ever been logged, which is true
  // of every recreated session. The logs must be newer than the phase clock to mean "interrupted".
  it('does not complete when the only logs predate the baseline phase — a recreated session', async () => {
    baselineRunning()
    wasProgramSessionTrainedSince.mockResolvedValue(false)
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120], ['Curl', 30]]))
    await getSession()
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  // BF-143 ②. Lower held three baselines for four exercises and was still marked complete, so the
  // exercise without a personal record could never acquire one. `recordBaselineAnchors` already
  // holds this invariant for the measured path; this is the same rule on the adopted path.
  it('does not complete on partial coverage — an exercise with no personal record', async () => {
    baselineRunning()
    loggedSincePhaseStart()
    listPersonalRecords.mockResolvedValue(new Map([['Squat', 120]]))
    await getSession()
    expect(setBaselineComplete).not.toHaveBeenCalled()
  })

  // BF-143 ③. The already-stored bad state: complete, but never trained since the phase began.
  it('reverts a baseline that was completed without the session being trained', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({ phase: 'accumulation', baselineComplete: true }))
    await getSession()
    expect(revertAutoAdoptedBaseline.mock.calls[0][1]).toBe(SESSION_ID)
  })

  it('leaves a completed baseline alone once the session has been trained in this phase', async () => {
    ensureSessionPeriodization.mockResolvedValue(state({ phase: 'accumulation', baselineComplete: true }))
    loggedSincePhaseStart()
    await getSession()
    expect(revertAutoAdoptedBaseline).not.toHaveBeenCalled()
  })

  // BF-144. The interruption question is asked about THIS program session's id and THIS phase
  // clock — not about exercise names, which answer for the wrong workouts the moment a session is
  // renamed or a second one shares a name. A program-scoping argument is no longer needed: a
  // program-session id belongs to exactly one program by construction.
  it('asks about this session id and this phase clock, not about exercise names', async () => {
    const phaseStartedAt = new Date(Date.now() - 3 * 86_400_000)
    ensureSessionPeriodization.mockResolvedValue(
      state({ phase: 'baseline', baselineComplete: false, phaseStartedAt }))
    await getSession()
    expect(wasProgramSessionTrainedSince.mock.calls[0][1]).toBe(SESSION_ID)
    expect(wasProgramSessionTrainedSince.mock.calls[0][2]).toEqual(phaseStartedAt)
    expect(getLastExerciseLogsBatch).not.toHaveBeenCalled()
  })
})
