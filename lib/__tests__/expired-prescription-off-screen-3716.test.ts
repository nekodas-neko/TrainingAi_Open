/**
 * #3716 — #3712 stopped an expired prescription driving load, but the routes that hand the stored
 * prescription to the screens never looked at its expiry. The card still showed the expired plan
 * with Accept and Dismiss, the Deload toggle adopted an illness deload the morning after it ended,
 * and the Home card took its duration and dropped exercises from an expired accepted plan.
 *
 * Each read now runs `prescriptionAgedOut`, the one rule every server read shares, so these cases
 * follow it with or without #3715 (which widens it to every expired pending offer). The fixtures use
 * a pending deload and accepted plans, which age out under both versions of the rule.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { programMoveMark } from '@trainingai/shared/ai-periodization/program-phase'

type Row = Record<string, unknown>

const getActiveProgram = vi.fn(async (_u: string) => program() as Row | null)
const ensureSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const getSessionPeriodization = vi.fn(async (_u: string, _s: string) => state() as Row | null)
const advancePhase = vi.fn(async (_u: string, _s: string, _p: string) => state() as Row)
const storePrescription = vi.fn(async (..._a: unknown[]) => undefined)
const updatePrescriptionStatus = vi.fn(async (_u: string, _s: string, _st: string) => undefined)
const wasProgramSessionTrainedSince = vi.fn(async () => false)
const revertAutoAdoptedBaseline = vi.fn(async () => null)
const listPersonalRecords = vi.fn(async () => new Map<string, number>())
const listRecent1rm = vi.fn(async () => new Map<string, { latest: number; previous?: number }>())
const reconcileSessionsInPhase = vi.fn(async () => undefined)
const listSessionPeriodizationForProgram = vi.fn(async () => [state()] as Row[])
const getRecentSessionsOfType = vi.fn(async () => [] as Row[])
const getNextSession = vi.fn(async () => ({ isRestDay: false, session: session(), reason: '', program: program() }) as Row)
const getExerciseMuscleAssignments = vi.fn(async () => ({}))
const listProgressionStyles = vi.fn(async () => [
  { id: 'style-1', name: 'Standard', sets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }] },
])
const getExerciseEquipment = vi.fn(async () => ({}))
const listProgramCompletions = vi.fn(async () => [] as Row[])

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-3716', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getActiveProgram, ensureSessionPeriodization, getSessionPeriodization, advancePhase,
    storePrescription, updatePrescriptionStatus, wasProgramSessionTrainedSince,
    revertAutoAdoptedBaseline, listPersonalRecords, listRecent1rm, reconcileSessionsInPhase,
    listSessionPeriodizationForProgram, getRecentSessionsOfType, getNextSession,
    getExerciseMuscleAssignments, listProgressionStyles, getExerciseEquipment,
      // #3766: the program's phase. A program move reaches the same spy as a per-type one; which of the
    // two the route picks is tested in program-phase-3766.test.ts.
    advanceProgramPhase: advancePhase,
    listProgramCompletions,
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
})
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as readSession } from '@/app/api/ai-periodization/session/[sessionId]/route'
import { POST as respond } from '@/app/api/ai-periodization/session/[sessionId]/respond/route'
import { GET as programOverview } from '@/app/api/ai-periodization/program-overview/route'
import { GET as nextSession } from '@/app/api/next-session/route'
import { POST as transition } from '@/app/api/ai-periodization/session/[sessionId]/transition/route'

const SESSION_ID = '00000000-0000-4000-8000-0000000037aa'
const SQUAT = '00000000-0000-4000-8000-000000003701'
const CURL = '00000000-0000-4000-8000-000000003702'

const session = () => ({
  id: SESSION_ID, programId: 'p-1', name: 'Upper', position: 0, timeBudgetMinutes: 60, icon: null,
  exercises: [
    { id: SQUAT, sessionId: SESSION_ID, exerciseName: 'Squat', muscleGroups: ['quads'], position: 0, exerciseRole: 'primary', progressionStyleId: 'style-1' },
    { id: CURL, sessionId: SESSION_ID, exerciseName: 'Curl', muscleGroups: ['biceps'], position: 1, exerciseRole: 'accessory', progressionStyleId: 'style-1' },
  ],
})
const program = () => ({ id: 'p-1', name: 'Strength', phaseMode: 'ai_dynamic', sessions: [session()] })

const prescription = (over: Row = {}) => ({
  phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'Keep going.',
  estimatedSessionDurationMin: 25, weeklyVolumeContribution: {}, confidence: 0.7,
  confidenceReasons: [], droppedExerciseIds: [CURL],
  exercises: [
    { sessionExerciseId: SQUAT, name: 'Squat', sets: 4, reps: 5, pct: 80, restSec: 180 },
  ],
  ...over,
})
const illnessDeload = () => prescription({ phase: 'deload', phaseAction: 'deload_recommended', deload: true, droppedExerciseIds: [] })

const HOUR = 3_600_000
const state = (over: Row = {}) => ({
  id: 'st-1', userId: 'u-3716', programSessionId: SESSION_ID, phase: 'accumulation',
  phaseStartedAt: new Date(), sessionsInPhase: 3, baselineComplete: true, baseline1rm: {},
  prescription: null, prescriptionGeneratedAt: null, prescriptionExpiresAt: null,
  prescriptionStatus: 'none', lastSessionRanPrescription: null, pendingTransition: null,
  preEmergencyDeloadPhase: null, updatedAt: new Date(), ...over,
})
const expired = (p: Row, status: string) =>
  state({ prescription: p, prescriptionStatus: status, prescriptionExpiresAt: new Date(Date.now() - HOUR) })
const live = (p: Row, status: string) =>
  state({ prescription: p, prescriptionStatus: status, prescriptionExpiresAt: new Date(Date.now() + HOUR) })

const ctx = () => ({ params: Promise.resolve({ sessionId: SESSION_ID }) })
const getCard = async () => (await (await readSession(
  new Request(`http://localhost/api/ai-periodization/session/${SESSION_ID}`) as never, ctx() as never)).json())
const transitionPost = (newPhase: string) => transition(new Request(
  `http://localhost/api/ai-periodization/session/${SESSION_ID}/transition`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPhase }) },
) as never, ctx() as never)
// Local midday `days` ago, on the user's calendar (Brisbane has no daylight saving).
const localMidday = (days: number) => new Date(`${shiftDateStr(todayInTz('Australia/Brisbane'), -days)}T12:00:00+10:00`)
const respondPost = (action: 'accept' | 'dismiss') => respond(new Request(
  `http://localhost/api/ai-periodization/session/${SESSION_ID}/respond`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) },
) as never, ctx() as never)

beforeEach(() => {
  vi.clearAllMocks()
  getActiveProgram.mockResolvedValue(program())
})

describe('GET …/session/[sessionId] — the prescription card (#3716)', () => {
  it('leaves out an expired pending illness deload and flags it, so neither card nor Deload default sees it', async () => {
    ensureSessionPeriodization.mockResolvedValue(expired(illnessDeload(), 'pending'))
    const body = await getCard()
    expect(body.state.prescription).toBeNull()
    expect(body.state.prescriptionAgedOut).toBe(true)
    expect(body.state.prescriptionStatus).toBe('pending')
  })

  it('leaves out an expired accepted plan', async () => {
    ensureSessionPeriodization.mockResolvedValue(expired(prescription(), 'accepted'))
    const body = await getCard()
    expect(body.state.prescription).toBeNull()
    expect(body.state.prescriptionAgedOut).toBe(true)
  })

  it('serves a live prescription unchanged, with no flag (control)', async () => {
    ensureSessionPeriodization.mockResolvedValue(live(illnessDeload(), 'pending'))
    const body = await getCard()
    expect(body.state.prescription.deload).toBe(true)
    expect(body.state.prescriptionAgedOut).toBeUndefined()
  })
})

describe('POST …/respond refuses an aged-out prescription (#3716)', () => {
  it('will not accept an expired deload: no phase flip, no status write', async () => {
    getSessionPeriodization.mockResolvedValue(expired(illnessDeload(), 'pending'))
    const res = await respondPost('accept')
    expect(res.status).toBe(409)
    expect(advancePhase).not.toHaveBeenCalled()
    expect(storePrescription).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('still accepts a live deload (control)', async () => {
    getSessionPeriodization.mockResolvedValue(live(illnessDeload(), 'pending'))
    const res = await respondPost('accept')
    expect(res.status).toBe(200)
    // #3799: accepting a deload no longer moves the phase.
    expect(advancePhase).not.toHaveBeenCalled()
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u-3716', SESSION_ID, 'accepted')
  })
})

describe('GET /api/ai-periodization/program-overview (#3716)', () => {
  it('leaves an aged-out prescription out of the session state', async () => {
    listSessionPeriodizationForProgram.mockResolvedValue([expired(prescription(), 'accepted')])
    const body = await (await programOverview()).json()
    expect(body.sessions[0].state.prescription).toBeNull()
    expect(body.sessions[0].state.prescriptionAgedOut).toBe(true)
    expect(body.sessions[0].state.phase).toBe('accumulation')
  })

  it('keeps a live one (control)', async () => {
    listSessionPeriodizationForProgram.mockResolvedValue([live(prescription(), 'accepted')])
    const body = await (await programOverview()).json()
    expect(body.sessions[0].state.prescription.phaseAction).toBe('stay')
  })
})

describe('GET /api/next-session — the Home card (#3716)', () => {
  it('takes neither the duration nor the drops from an expired accepted plan', async () => {
    getSessionPeriodization.mockResolvedValue(expired(prescription(), 'accepted'))
    const body = await (await nextSession()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual([SQUAT, CURL])
    expect(body.estimatedDurationMin).not.toBe(25)
  })

  it('a live accepted plan still drops its exercise and sets the duration (control)', async () => {
    getSessionPeriodization.mockResolvedValue(live(prescription(), 'accepted'))
    const body = await (await nextSession()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual([SQUAT])
    expect(body.estimatedDurationMin).toBe(25)
  })
})

// #3907: respond and next-session ran only `prescriptionAgedOut`, so a plan whose deload had ended
// (#3876), which the card no longer shows, could still be accepted by a queued or stale tap, and
// Home took its duration and drops. Both now make the card's served-plan check.
describe('a plan whose deload has ended (#3907)', () => {
  const endedDeload = () => state({
    phase: 'deload', sessionsInPhase: 2, prescriptionStatus: 'pending',
    prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    prescription: prescription({ phase: 'deload', deload: true, phaseAction: 'deload_recommended', sessionsInPhaseAtPlan: 1 }),
  })
  // Waiting for its switch-over (two types on different phases), so the type's own count decides.
  beforeEach(() => {
    listSessionPeriodizationForProgram.mockResolvedValue([
      state({ phase: 'deload', phaseStartedAt: localMidday(9) }),
      state({ programSessionId: 'other', phase: 'accumulation' }),
    ])
  })

  it('refuses an Accept, and writes nothing', async () => {
    getSessionPeriodization.mockResolvedValue(endedDeload())
    const res = await respondPost('accept')
    expect(res.status).toBe(409)
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('still accepts a deload plan made at the current count (control)', async () => {
    getSessionPeriodization.mockResolvedValue({ ...endedDeload(), prescription: prescription({
      phase: 'deload', deload: true, phaseAction: 'deload_recommended', sessionsInPhaseAtPlan: 2,
    }) })
    const res = await respondPost('accept')
    expect(res.status).toBe(200)
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u-3716', SESSION_ID, 'accepted')
  })

  it('Home takes neither its duration nor its drops', async () => {
    getSessionPeriodization.mockResolvedValue({ ...endedDeload(), prescriptionStatus: 'accepted',
      prescription: prescription({ phase: 'deload', deload: true, sessionsInPhaseAtPlan: 1 }) })
    const body = await (await nextSession()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual([SQUAT, CURL])
    expect(body.estimatedDurationMin).not.toBe(25)
  })
})

// #3907 review: the fixtures above are a program waiting for its switch-over, so the type's own count
// decides and the program's check is never reached. Here the program is aligned: every type is in one
// deload with one start, and the deload has done its one training week, its cap (#3876). A plan made
// before that week was counted is the ended plan; one made after it is not.
describe('an aligned program\'s deload at its cap (#3907, the #3876 case)', () => {
  const start = localMidday(14)
  const mark = programMoveMark('deload')
  const alignedRow = (id: string) => state({
    programSessionId: id, phase: 'deload', phaseStartedAt: start, sessionsInPhase: 1, pendingTransition: mark,
  })
  const deloadPlan = (programWeeksDoneAtPlan: number, status = 'pending') => ({
    ...alignedRow(SESSION_ID), prescriptionStatus: status,
    prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    // One session in, under the type's floor: only the program's cap can end this deload.
    prescription: prescription({
      phase: 'deload', deload: true, phaseAction: 'stay', sessionsInPhaseAtPlan: 1, programWeeksDoneAtPlan,
    }),
  })
  beforeEach(() => {
    listSessionPeriodizationForProgram.mockResolvedValue([alignedRow(SESSION_ID), alignedRow('other')])
    // A session the day after the deload began: one training week of deload, before this one.
    listProgramCompletions.mockResolvedValue([{ programSessionId: SESSION_ID, completedAt: localMidday(13) }])
  })
  afterEach(() => { listProgramCompletions.mockResolvedValue([]) })

  it('respond: refuses an Accept on a plan made before the cap was reached, and writes nothing', async () => {
    getSessionPeriodization.mockResolvedValue(deloadPlan(0))
    const res = await respondPost('accept')
    expect(res.status).toBe(409)
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
  })

  it('respond: accepts a plan made at the cap (control)', async () => {
    getSessionPeriodization.mockResolvedValue(deloadPlan(1))
    const res = await respondPost('accept')
    expect(res.status).toBe(200)
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u-3716', SESSION_ID, 'accepted')
  })

  it('next-session: Home takes neither the ended plan\'s duration nor its drops', async () => {
    getSessionPeriodization.mockResolvedValue(deloadPlan(0, 'accepted'))
    const body = await (await nextSession()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual([SQUAT, CURL])
    expect(body.estimatedDurationMin).not.toBe(25)
  })

  it('next-session: a plan made at the cap still sets them (control)', async () => {
    getSessionPeriodization.mockResolvedValue(deloadPlan(1, 'accepted'))
    const body = await (await nextSession()).json()
    expect(body.session.exercises.map((e: Row) => e.id)).toEqual([SQUAT])
    expect(body.estimatedDurationMin).toBe(25)
  })
})

// #3907 review: `transition` with `newPhase` equal to the current phase takes the plan on offer. It
// checked `prescriptionAgedOut` alone, so a stale "Move to Deload" tap on an ended deload plan was
// still accepted. It now makes the same served-plan check.
describe('POST …/transition to the current phase on an ended deload plan (#3907)', () => {
  const endedDeload = (sessionsInPhaseAtPlan: number) => state({
    phase: 'deload', phaseStartedAt: localMidday(9), sessionsInPhase: 2, prescriptionStatus: 'pending',
    prescriptionExpiresAt: new Date(Date.now() + 5 * 86_400_000),
    prescription: prescription({ phase: 'deload', deload: true, phaseAction: 'deload_recommended', sessionsInPhaseAtPlan }),
  })
  beforeEach(() => {
    // Waiting for its switch-over, so the type's own count decides.
    listSessionPeriodizationForProgram.mockResolvedValue([
      state({ phase: 'deload', phaseStartedAt: localMidday(9) }),
      state({ programSessionId: 'other', phase: 'accumulation' }),
    ])
  })

  it('takes nothing from a plan made before the deload\'s two sessions were done', async () => {
    getSessionPeriodization.mockResolvedValue(endedDeload(1))
    const res = await transitionPost('deload')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.phaseMoved).toBe(false)
    expect(body.prescriptionStatus).toBe('pending')
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
    expect(advancePhase).not.toHaveBeenCalled()
  })

  it('still takes a plan made at the current count (control)', async () => {
    getSessionPeriodization.mockResolvedValue(endedDeload(2))
    const res = await transitionPost('deload')
    expect((await res.json()).prescriptionStatus).toBe('accepted')
    expect(updatePrescriptionStatus).toHaveBeenCalledWith('u-3716', SESSION_ID, 'accepted')
  })
})
