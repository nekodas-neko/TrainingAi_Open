// #3893: the session read is stored beside the plan IN SHADOW. Generating with and without a read
// gives the same prescription (exercises, loads, sets, reps, rest, phase, reasoning) and the same
// model prompt, byte for byte; the only difference in what is stored is the `sessionReads` field.
// The model is mocked: 0 real calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { SessionReadLog, SessionReadSet } from '../session-read'
import type { WorkoutRepository } from '@/lib/data/repository'

const mocks = vi.hoisted(() => ({
  signals: null as unknown,
  modelAnswer: null as unknown,
  prompts: [] as Array<{ system: string; prompt: string }>,
}))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('ai', async importOriginal => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: async (args: { system: string; prompt: string }) => {
    mocks.prompts.push({ system: args.system, prompt: args.prompt })
    // A fresh copy per call, as a real reply is: generation edits the parsed answer in place.
    return { object: structuredClone(mocks.modelAnswer) }
  },
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async (_meta: unknown, run: (signal?: AbortSignal) => Promise<unknown>) => run(undefined),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string, name: string, muscle: string): Ex => ({
  sessionExerciseId: id, name, role: 'primary', muscleGroups: [muscle],
  muscleAssignments: [{ muscle, role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: ['barbell'], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }],
}) as Ex

const signals = {
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('a', 'Bench Press', 'chest'), exercise('b', 'Squat', 'quadriceps')],
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
  soreMusclesInSession: [], soreMusclesOutOfSession: [], recentlyTrainedMusclesInSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
} as unknown as PrescriptionSignals

const SESSION = 'ps-3893'
const set = (setNumber: number, over: Partial<SessionReadSet> = {}): SessionReadSet => ({
  setNumber, reps: 5, weightKg: 80, plannedReps: 5, plannedWeightKg: 80, plannedPct: 75,
  restTimeSec: 120, plannedRestSec: 120, rpe: null, rpeSource: null, hr: null, ...over,
})
// Bench: set 2 came up 2 short after a 40 % rest (the rest explains it). Squat: set 1 missed by 3.
const LOGS: SessionReadLog[] = [
  { name: 'Bench Press', sets: [set(1, { restTimeSec: 48 }), set(2, { reps: 3 }), set(3)] },
  { name: 'Squat', sets: [set(1, { reps: 2 }), set(2), set(3)] },
].map(({ name, sets }, i) => ({
  exerciseLogId: `el-${i}`, workoutSessionId: 'ws-last', programSessionId: SESSION, exerciseName: name,
  loggedAt: new Date('2026-11-12T01:00:00Z'), estimated1rm: 100, exerciseDeloaded: false, exerciseType: 'weighted',
  session: { completed: true, isEarlyDeload: false, wasOverride: false, intensityMode: 'full', phaseType: 'normal', hrDense: null },
  effortVsPlan: null, effortSource: null, sets,
}))

let n = 0
async function generate(logs: SessionReadLog[] | 'throws') {
  const stored: AiPrescription[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const program = {
    id: 'prog-1', createdAt: new Date('2026-11-01T00:00:00Z'), trainingGoal: 'strength',
    sessions: [{
      id: SESSION, timeBudgetMinutes: 90,
      exercises: [
        { id: 'a', exerciseName: 'Bench Press', exerciseRole: 'primary' },
        { id: 'b', exerciseName: 'Squat', exerciseRole: 'primary' },
      ],
    }],
  }
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: null }),
    getActiveProgram: async () => program,
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    listSessionPeriodizationForProgram: async () => [{ phaseStartedAt: new Date(0), ...state }],
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    getSessionReadLogs: async () => { if (logs === 'throws') throw new Error('db down'); return logs },
    getExerciseEquipment: async () => ({ 'Bench Press': ['barbell'], Squat: ['barbell'] }),
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p) },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  mocks.prompts = []
  await generatePrescriptionForSession(`user-3893-${++n}`, SESSION, repo, 'Australia/Brisbane')
  return { stored: stored[0], prompts: mocks.prompts }
}

const plan = (p: AiPrescription) => ({
  exercises: p.exercises, phase: p.phase, phaseAction: p.phaseAction, deload: p.deload, reasoning: p.reasoning,
  confidence: p.confidence, estimatedSessionDurationMin: p.estimatedSessionDurationMin,
  weeklyVolumeContribution: p.weeklyVolumeContribution,
})

describe('the session read in shadow changes nothing in the plan (#3893)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
    mocks.signals = signals
    mocks.modelAnswer = {
      phase: 'accumulation', phase_action: 'stay', deload: false, confidence: 0.7, reasoning: 'Steady week.',
      exercises: [
        { session_exercise_id: 'a', name: 'Bench Press', sets: 3, reps: 5, pct: 75, rest_sec: 120 },
        { session_exercise_id: 'b', name: 'Squat', sets: 3, reps: 5, pct: 75, rest_sec: 120 },
      ],
    }
  })
  afterEach(() => { vi.useRealTimers() })

  it('stores the reads beside the plan', async () => {
    const { stored } = await generate(LOGS)
    expect(stored.sessionReads?.map(r => [r.sessionExerciseId, r.verdict, r.nextLoad])).toEqual([
      ['a', 'hold-rest-more', 'hold'],
      ['b', 'reduce', 'down-2'],
    ])
  })

  it('the prescription is identical with and without a read, and so is the model prompt', async () => {
    const withRead = await generate(LOGS)
    const without = await generate([])
    expect(withRead.prompts).toHaveLength(1)
    expect(without.prompts).toHaveLength(1)
    expect(withRead.prompts[0].system).toBe(without.prompts[0].system)
    expect(withRead.prompts[0].prompt).toBe(without.prompts[0].prompt)
    expect(plan(withRead.stored)).toEqual(plan(without.stored))
    // The only stored difference is the field itself.
    const { sessionReads, ...rest } = withRead.stored
    expect(sessionReads).toHaveLength(2)
    expect(rest).toEqual(without.stored)
    expect('sessionReads' in without.stored).toBe(false)
  })

  it('a read that fails to load stores the plan without one', async () => {
    const failed = await generate('throws')
    const without = await generate([])
    expect(failed.stored).toEqual(without.stored)
  })

  it('the model prompt never names the read', async () => {
    const { prompts } = await generate(LOGS)
    expect(prompts[0].system + prompts[0].prompt).not.toMatch(/session.?read|hold-rest-more|rest the full/i)
  })
})
