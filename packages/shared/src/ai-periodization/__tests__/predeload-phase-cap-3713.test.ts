// #3713 review follow-up. A per-exercise deload records the row's full numbers (`preDeload`), and
// `Full` or a cleared soreness the next morning puts them back. Those full numbers kept the model's
// raw set count, which no stage capped: strength accumulation allows 5 sets, the model answered 6
// for a squat sore at generation, and the revert gave 6. The cap now applies at write (generation)
// and on the revert (`reevaluatePrescriptionForToday`, for a plan stored before the fix).
//
// Generation runs through `generatePrescriptionForSession` with the model and the signal
// aggregation mocked: 0 real calls.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sessionSoreness } from '../session-soreness'
import type { PerExerciseDeloadInput } from '../per-exercise-deload'
import { reevaluatePrescriptionForToday, type ReevaluationSignals } from '../reevaluate'
import { phaseSetsMax } from '../prompt'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'

const STRENGTH_ACCUMULATION_MAX = 5

const log = (soreMuscles: string[]) => ({
  bodyState: soreMuscles.length ? ['sore_muscles'] : [], soreMuscles, suggestedSoreMuscles: null,
})

const mocks = vi.hoisted(() => ({ signals: null as unknown, modelAnswer: null as unknown }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async () => ({ object: mocks.modelAnswer }),
}))
const { generatePrescriptionForSession } = await import('../generate-prescription')

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string, muscle: string): Ex => ({
  sessionExerciseId: id, name: `Lift ${id}`, role: 'primary', muscleGroups: [muscle],
  muscleAssignments: [{ muscle, role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }, { pct: 75, reps: 5, restSec: 120 }],
}) as Ex

function signalsFrom(sore: string[]): PrescriptionSignals {
  const s = sessionSoreness(log(sore), ['chest', 'quadriceps'])
  return {
    trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 0,
    exercises: [exercise('bench', 'chest'), exercise('squat', 'quadriceps')], phase: 'accumulation', sessionsInPhase: 2,
    hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0, ...s,
    sorenessLogDate: 'today', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
    repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
    sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
    confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
    tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  } as unknown as PrescriptionSignals
}

const SESSION = 'ps-3713'
let n = 0
async function generate() {
  const stored: AiPrescription[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const known: Record<string, unknown> = {
    // #3927: the program and the stamp from one snapshot, as the adapter reads them.
    getActiveProgramWithStructureStamp: async (u: string, id: string) => ({
      program: await (known.getActiveProgram as (u: string) => unknown)(u),
      structure: await (known.getSessionStructureStamp as ((u: string, id: string) => unknown) | undefined)?.(u, id),
    }),
    getActiveProgram: async () => ({ id: 'prog-1', sessions: [{ id: SESSION, timeBudgetMinutes: 0 }] }),
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
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p) },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  await generatePrescriptionForSession(`user-3713-${++n}`, SESSION, repo, 'Australia/Brisbane')
  return stored[0]
}

const NOW = new Date('2026-11-14T02:00:00Z')

describe('generation: the full numbers of a deloaded row carry the phase cap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    mocks.modelAnswer = {
      phase: 'accumulation', phase_action: 'stay', deload: false, confidence: 0.7, reasoning: 'test',
      exercises: [
        { session_exercise_id: 'bench', name: 'Lift bench', sets: 6, reps: 5, pct: 75, rest_sec: 120 },
        { session_exercise_id: 'squat', name: 'Lift squat', sets: 6, reps: 5, pct: 75, rest_sec: 120 },
      ],
    }
  })
  afterEach(() => { vi.useRealTimers() })

  it('the phase maximum the test relies on', () => {
    expect(phaseSetsMax('strength', 'accumulation')).toBe(STRENGTH_ACCUMULATION_MAX)
  })

  it('a squat sore at generation records 5 full sets, not the model\'s 6', async () => {
    mocks.signals = signalsFrom(['Quads'])
    const plan = await generate()
    const squat = plan.exercises.find(e => e.sessionExerciseId === 'squat')!
    expect(squat.deloaded).toBe(true)
    expect(squat.preDeload!.sets).toBe(STRENGTH_ACCUMULATION_MAX)
    // The row trained at full load is capped the same way.
    expect(plan.exercises.find(e => e.sessionExerciseId === 'bench')!.sets).toBe(STRENGTH_ACCUMULATION_MAX)
    // The phase the stage capped against is recorded for a later re-fit.
    expect(plan.refitBaseline?.phase).toBe('accumulation')
  })

  it('soreness cleared the next morning puts back the capped count', async () => {
    mocks.signals = signalsFrom(['Quads'])
    const plan = await generate()
    const r = reevaluatePrescriptionForToday(plan, reevalSignals(), { ...reevalState }, NOW)
    expect(r.prescription.exercises.find(e => e.sessionExerciseId === 'squat')).toMatchObject({
      deloaded: false, sets: STRENGTH_ACCUMULATION_MAX,
    })
  })
})

const EXERCISES: PerExerciseDeloadInput[] = [
  { sessionExerciseId: 'bench', name: 'Bench', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
  { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quadriceps', role: 'main' }] },
]
const reevalSignals = (): ReevaluationSignals => ({
  soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], hoursSinceLastSession: 48,
  activeInjuredMusclesInSession: [], trainingGoal: 'strength', illnessFlag: null, selfReportedSick: false,
  exercises: EXERCISES,
})
const reevalState = { phase: 'accumulation', prescription: null, prescriptionStatus: 'accepted', prescriptionExpiresAt: null } as const

describe('the revert caps a plan stored before the fix', () => {
  const RAW = { sets: 6, reps: 5, pct: 75, restSec: 150 }
  const stored = (over: Partial<AiPrescription> = {}): AiPrescription => ({
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.8,
    estimatedSessionDurationMin: 50, weeklyVolumeContribution: {},
    exercises: [
      { sessionExerciseId: 'bench', name: 'Bench', sets: 5, reps: 5, pct: 75, restSec: 150 },
      { sessionExerciseId: 'squat', name: 'Squat', sets: 2, reps: 5, pct: 52, restSec: 120, deloaded: true,
        deloadNote: 'Deload — quads still sore', preDeload: RAW },
    ],
    ...over,
  })

  it('a stored preDeload of 6 comes back as 5 in strength accumulation', () => {
    const r = reevaluatePrescriptionForToday(stored(), reevalSignals(), { ...reevalState }, NOW)
    expect(r.prescription.exercises.find(e => e.sessionExerciseId === 'squat')).toMatchObject({
      deloaded: false, sets: STRENGTH_ACCUMULATION_MAX, reps: RAW.reps, pct: RAW.pct,
    })
  })

  it('caps against the phase the loads were written for, not a guard\'s rewritten phase', () => {
    // A cap guard rewrote `phase` to the next one on a plain stay; the loads are still accumulation's.
    const offer = stored({ phase: 'deload', phaseAction: 'transition_recommended' })
    const r = reevaluatePrescriptionForToday(offer, reevalSignals(), { ...reevalState }, NOW)
    expect(r.prescription.exercises.find(e => e.sessionExerciseId === 'squat')!.sets).toBe(STRENGTH_ACCUMULATION_MAX)
  })
})
