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
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
const listPrevious1rm = vi.fn(async () => new Map<string, number>())
const reconcileSessionsInPhase = vi.fn(async () => undefined)
const listSessionPeriodizationForProgram = vi.fn(async () => [state()] as Row[])
const getRecentSessionsOfType = vi.fn(async () => [] as Row[])
const getNextSession = vi.fn(async () => ({ isRestDay: false, session: session(), reason: '', program: program() }) as Row)
const getExerciseMuscleAssignments = vi.fn(async () => ({}))
const listProgressionStyles = vi.fn(async () => [
  { id: 'style-1', name: 'Standard', sets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }] },
])
const getExerciseEquipment = vi.fn(async () => ({}))

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'u-3716', timezone: 'Australia/Brisbane' } }) }))
vi.mock('@/lib/data', () => {
  const repo = async () => ({
    getActiveProgram, ensureSessionPeriodization, getSessionPeriodization, advancePhase,
    storePrescription, updatePrescriptionStatus, wasProgramSessionTrainedSince,
    revertAutoAdoptedBaseline, listPersonalRecords, listPrevious1rm, reconcileSessionsInPhase,
    listSessionPeriodizationForProgram, getRecentSessionsOfType, getNextSession,
    getExerciseMuscleAssignments, listProgressionStyles, getExerciseEquipment,
  })
  return { getRepository: repo, getRepositoryAsync: repo }
})

import { GET as readSession } from '@/app/api/ai-periodization/session/[sessionId]/route'
import { POST as respond } from '@/app/api/ai-periodization/session/[sessionId]/respond/route'
import { GET as programOverview } from '@/app/api/ai-periodization/program-overview/route'
import { GET as nextSession } from '@/app/api/next-session/route'

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
    expect(advancePhase).toHaveBeenCalledWith('u-3716', SESSION_ID, 'deload')
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
