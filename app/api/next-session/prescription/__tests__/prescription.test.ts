import { describe, it, expect, vi, beforeEach } from 'vitest'

const TEST_USER_ID = 'user-1'

const getNextSession = vi.fn()
const getActiveProgram = vi.fn()
const listProgressionStyles = vi.fn(async () => [])
const listExerciseLibrary = vi.fn(async () => [])
const getLastExerciseLogsBatch = vi.fn(async () => new Map())
// Q-202: the working basis now comes from the last NON-DELOAD 1RM, not from the last log,
// so a deliberate sustained weight reduction can actually lower the prescription. These tests
// seed it wherever they previously seeded lastLogs to drive the weight.
const getLastRealOneRmBatch = vi.fn(async () => new Map<string, { estimated1rm: number; target80: number | null }>())
const listPersonalRecords = vi.fn(async () => new Map())
// Q-5: the route resolves the working basis from logs + PRs + user-entered estimates.
const getExerciseEstimates = vi.fn(async () => [] as { exerciseName: string; estimated1rm: number }[])
const getSessionPeriodization = vi.fn(async () => null)

// Repo methods that mutate state — the endpoint must be a pure read, so none of
// these should ever be invoked.
const updatePrescriptionStatus = vi.fn()
const updatePrescriptionExercisesCache = vi.fn()

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

vi.mock('@/lib/data', () => ({
  getRepository: async () => ({
    getNextSession,
    getActiveProgram,
    listProgressionStyles,
    listExerciseLibrary,
    getLastExerciseLogsBatch,
    getLastRealOneRmBatch,
    listPersonalRecords,
    getExerciseEstimates,
    getSessionPeriodization,
    updatePrescriptionStatus,
    updatePrescriptionExercisesCache,
  }),
}))

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { GET } from '../route'

function session(id: string, name: string, exercises: { id: string; exerciseName: string; styleId?: string }[]) {
  return {
    id, programId: 'prog-1', name, position: 0, timeBudgetMinutes: 60,
    exercises: exercises.map((e, i) => ({ ...e, sessionId: id, position: i, exerciseRole: 'primary' as const, muscleGroups: [] })),
  }
}

describe('GET /api/next-session/prescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listProgressionStyles.mockResolvedValue([])
    listExerciseLibrary.mockResolvedValue([])
    getLastExerciseLogsBatch.mockResolvedValue(new Map())
    getLastRealOneRmBatch.mockResolvedValue(new Map())
    listPersonalRecords.mockResolvedValue(new Map())
    getSessionPeriodization.mockResolvedValue(null)
  })

  it('returns isRestDay when the recommendation is a rest day', async () => {
    getNextSession.mockResolvedValue({ isRestDay: true, reason: 'rest' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'manual', sessions: [] })

    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ isRestDay: true })
  })

  it('returns source "static" for a non-ai_dynamic program', async () => {
    const sess = session('sess-1', 'Push', [{ id: 'ex-1', exerciseName: 'Bench Press', styleId: 'style-1' }])
    getNextSession.mockResolvedValue({ isRestDay: false, session: sess, reason: '' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'automatic', sessions: [sess] })
    listProgressionStyles.mockResolvedValue([
      { id: 'style-1', name: 'Standard', sets: [{ pct: 80, reps: 8, restSec: 90, useFor1rm: true }] },
    ])
    getLastExerciseLogsBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100 }]]))
    getLastRealOneRmBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100, target80: 80 }]]))

    const res = await GET()
    const body = await res.json()
    expect(body.isRestDay).toBe(false)
    expect(body.source).toBe('static')
    expect(body.sessionName).toBe('Push')
    expect(body.exercises[0].sets[0]).toEqual({ weightKg: 80, reps: 8, restSec: 90 })
    expect(getSessionPeriodization).not.toHaveBeenCalled()
  })

  it('returns source "pending" for an ai_dynamic program with no stored prescription', async () => {
    const sess = session('sess-1', 'Push', [{ id: 'ex-1', exerciseName: 'Bench Press' }])
    getNextSession.mockResolvedValue({ isRestDay: false, session: sess, reason: '' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'ai_dynamic', sessions: [sess] })
    getSessionPeriodization.mockResolvedValue({ prescription: null, prescriptionStatus: 'consumed', prescriptionGeneratedAt: null, prescriptionExpiresAt: null })

    const res = await GET()
    const body = await res.json()
    expect(body.source).toBe('pending')
  })

  it('returns source "driving" and applies the stored prescription\'s pct/reps/rest', async () => {
    const sess = session('sess-1', 'Push', [{ id: 'ex-1', exerciseName: 'Bench Press' }])
    getNextSession.mockResolvedValue({ isRestDay: false, session: sess, reason: '' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'ai_dynamic', sessions: [sess] })
    getLastExerciseLogsBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100 }]]))
    getLastRealOneRmBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100, target80: 80 }]]))
    getSessionPeriodization.mockResolvedValue({
      prescriptionStatus: 'accepted',
      prescriptionGeneratedAt: new Date(),
      prescriptionExpiresAt: null,
      prescription: {
        phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
        estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
        exercises: [{ sessionExerciseId: 'ex-1', name: 'Bench Press', sets: 3, reps: 5, pct: 85, restSec: 120 }],
      },
    })

    const res = await GET()
    const body = await res.json()
    expect(body.source).toBe('driving')
    expect(body.exercises[0].sets).toHaveLength(3)
    expect(body.exercises[0].sets[0]).toEqual({ weightKg: 85, reps: 5, restSec: 120 })
  })

  it('keeps driving load even once the stored prescription is past its expiry timestamp (no auto-expiry — only an explicit dismiss changes status)', async () => {
    const sess = session('sess-1', 'Push', [{ id: 'ex-1', exerciseName: 'Bench Press', styleId: 'style-1' }])
    getNextSession.mockResolvedValue({ isRestDay: false, session: sess, reason: '' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'ai_dynamic', sessions: [sess] })
    listProgressionStyles.mockResolvedValue([
      { id: 'style-1', name: 'Standard', sets: [{ pct: 80, reps: 8, restSec: 90, useFor1rm: true }] },
    ])
    getLastExerciseLogsBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100 }]]))
    getLastRealOneRmBatch.mockResolvedValue(new Map([['Bench Press', { estimated1rm: 100, target80: 80 }]]))
    getSessionPeriodization.mockResolvedValue({
      prescriptionStatus: 'accepted',
      prescriptionGeneratedAt: new Date(),
      prescriptionExpiresAt: new Date(Date.now() - 1000),
      prescription: {
        phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
        estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
        exercises: [{ sessionExerciseId: 'ex-1', name: 'Bench Press', sets: 3, reps: 5, pct: 85, restSec: 120 }],
      },
    })

    const res = await GET()
    const body = await res.json()
    expect(body.source).toBe('driving')
    expect(body.exercises[0].sets[0]).toEqual({ weightKg: 85, reps: 5, restSec: 120 })
  })

  it('never calls a prescription-mutating repo method', async () => {
    const sess = session('sess-1', 'Push', [{ id: 'ex-1', exerciseName: 'Bench Press' }])
    getNextSession.mockResolvedValue({ isRestDay: false, session: sess, reason: '' })
    getActiveProgram.mockResolvedValue({ id: 'prog-1', phaseMode: 'ai_dynamic', sessions: [sess] })
    getSessionPeriodization.mockResolvedValue({
      prescriptionStatus: 'accepted',
      prescriptionGeneratedAt: new Date(),
      prescriptionExpiresAt: new Date(Date.now() - 1000),
      prescription: {
        phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: '', confidence: 1,
        estimatedSessionDurationMin: 45, weeklyVolumeContribution: {},
        exercises: [{ sessionExerciseId: 'ex-1', name: 'Bench Press', sets: 1, reps: 5, pct: 85, restSec: 120 }],
      },
    })

    await GET()
    expect(updatePrescriptionStatus).not.toHaveBeenCalled()
    expect(updatePrescriptionExercisesCache).not.toHaveBeenCalled()
  })
})
