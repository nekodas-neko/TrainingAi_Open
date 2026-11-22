// #3896 step 4. Fixture sessions shared by the no-rows identity test and the preference tests: a
// spread of goals, roles, autoregulation signals, a per-exercise deload, a model failure and a deload
// phase, so "no preference changes nothing" is checked on every branch the reader touches.
// Made-up numbers; no real lift, person or health value.
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { BuildWorkoutExercisesCtx } from '../../../workout/session-data'
import type { ProgramPhase, ProgramSession } from '../../../types/program'
import type { ProgressionStyle, StyleSet } from '../../../types/progression'

type Ex = PrescriptionSignals['exercises'][number]

export function exercise(id: string, role: string, muscle: string, over: Partial<Ex> = {}): Ex {
  return {
    sessionExerciseId: id, name: `Lift ${id}`, role, muscleGroups: [muscle],
    muscleAssignments: [{ muscle, role: 'main' }], baseline1rm: 100, current1rm: 100, latest1rm: 100,
    exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
    equipment: role === 'primary' ? ['barbell'] : ['cable'], transitionSec: 240, plateau: false,
    rpeDelta: null, repCompletionRate: null,
    baseSets: [{ pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }, { pct: 75, reps: 6, restSec: 150 }],
    ...over,
  } as Ex
}

export function signals(over: Partial<PrescriptionSignals>): PrescriptionSignals {
  return {
    trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
    exercises: [], phase: 'accumulation', sessionsInPhase: 2,
    hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0,
    soreMusclesInSession: [], recentlyTrainedMusclesInSession: [], soreMusclesOutOfSession: [],
    sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
    repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
    sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
    confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
    tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
    ...over,
  } as unknown as PrescriptionSignals
}

export interface Scenario {
  name: string
  phase: string
  signals: PrescriptionSignals
  /** The model's answer, or null for a failed call (the rules fallback). */
  model: Record<string, unknown> | null
}

const row = (id: string, sets: number, reps: number, pct: number, rest: number) =>
  ({ session_exercise_id: id, name: `Lift ${id}`, sets, reps, pct, rest_sec: rest })
const answer = (phase: string, exercises: ReturnType<typeof row>[]) =>
  ({ phase, phase_action: 'stay', deload: false, reasoning: 'test plan', exercises })

export const SCENARIOS: Scenario[] = [
  {
    name: 'strength, three roles, no autoregulation',
    phase: 'accumulation',
    signals: signals({
      trainingGoal: 'strength',
      exercises: [exercise('p', 'primary', 'quadriceps'), exercise('s', 'secondary', 'back'), exercise('a', 'accessory', 'biceps')],
    }),
    model: answer('accumulation', [row('p', 4, 6, 75, 180), row('s', 3, 8, 72.5, 150), row('a', 3, 10, 65, 90)]),
  },
  {
    name: 'powerbuilding, autoregulation pushes and backs off',
    phase: 'intensification',
    signals: signals({
      trainingGoal: 'powerbuilding', phase: 'intensification',
      exercises: [
        exercise('p', 'primary', 'chest', { rpeDelta: 2, rm1Trend: 'down', repCompletionRate: 0.8 }),
        exercise('s', 'secondary', 'back', { rpeDelta: -2, rm1Trend: 'up', repCompletionRate: 1 }),
        exercise('a', 'accessory', 'triceps', { rpeDelta: -1.6, rm1Trend: 'flat', repCompletionRate: 1 }),
      ],
    }),
    model: answer('intensification', [row('p', 4, 5, 82.5, 180), row('s', 3, 7, 75, 150), row('a', 3, 9, 70, 90)]),
  },
  {
    name: 'hypertrophy, one exercise deloaded for a sore tick',
    phase: 'accumulation',
    signals: signals({
      trainingGoal: 'hypertrophy', soreMusclesInSession: ['Biceps'], sorenessLogDate: 'today',
      exercises: [exercise('p', 'primary', 'quadriceps'), exercise('a', 'accessory', 'biceps')],
    }),
    model: answer('accumulation', [row('p', 4, 10, 70, 150), row('a', 3, 12, 60, 90)]),
  },
  {
    name: 'strength, the model call fails (rules fallback)',
    phase: 'accumulation',
    signals: signals({
      trainingGoal: 'strength',
      exercises: [exercise('p', 'primary', 'quadriceps'), exercise('a', 'accessory', 'biceps', {
        baseSets: [{ pct: 65, reps: 10, restSec: 90 }, { pct: 65, reps: 10, restSec: 90 }],
      })],
    }),
    model: null,
  },
  {
    name: 'strength, a deload phase and the model call fails',
    phase: 'deload',
    signals: signals({
      trainingGoal: 'strength', phase: 'deload',
      exercises: [exercise('p', 'primary', 'quadriceps'), exercise('a', 'accessory', 'biceps')],
    }),
    model: null,
  },
]

export const SESSION_ID = 'ps-3896'

/** A repository that answers only what generation reads; every other method resolves undefined. */
export function fakeRepo(phase: string, stored: AiPrescription[], extra: Record<string, unknown> = {}): WorkoutRepository {
  const state = {
    phase, baselineComplete: true, sessionsInPhase: 2, phaseStartedAt: new Date(0),
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const program = { id: 'prog-1', createdAt: new Date(0), trainingGoal: 'strength', sessions: [{ id: SESSION_ID, timeBudgetMinutes: 90, exercises: [] }] }
  const known: Record<string, unknown> = {
    getActiveProgramWithStructureStamp: async () => ({ program, structure: 'stamp' }),
    getActiveProgram: async () => program,
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    listSessionPeriodizationForProgram: async () => [state],
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => true,
    setProgramPendingTransition: async () => undefined,
    realignProgramPhase: async () => undefined,
    voidSessionPrescription: async () => undefined,
    getSessionReadLogs: async () => [],
    getExerciseEquipment: async () => ({}),
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p); return true },
    ...extra,
  }
  return new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
}

// ── The static-style path (`buildWorkoutExercises`): automatic phases, and ai_dynamic before a plan ──

const set = (pct: number, reps: number, restSec: number, n: number): StyleSet =>
  ({ id: `set-${n}`, styleId: 'x', setNumber: n, pct, reps, restSec, useFor1rm: true })
const style = (id: string, sets: StyleSet[]): ProgressionStyle =>
  ({ id, userId: 'u', name: `Style ${id}`, sets: sets.map(s => ({ ...s, styleId: id })) } as unknown as ProgressionStyle)

export const STYLES: ProgressionStyle[] = [
  style('heavy', [set(80, 5, 180, 1), set(80, 5, 180, 2), set(80, 5, 180, 3), set(80, 5, 180, 4)]),
  style('medium', [set(72.5, 8, 150, 1), set(72.5, 8, 150, 2), set(72.5, 8, 150, 3)]),
  style('light', [set(65, 10, 90, 1), set(65, 10, 90, 2), set(65, 10, 90, 3)]),
]

export const STATIC_SESSION: ProgramSession = {
  id: 'ps-static', programId: 'prog-1', name: 'Session A', position: 0, timeBudgetMinutes: 60,
  exercises: [
    { id: 'se-p', sessionId: 'ps-static', exerciseName: 'Lift p', styleId: 'heavy', muscleGroups: ['quadriceps'], position: 0, exerciseRole: 'primary' },
    { id: 'se-s', sessionId: 'ps-static', exerciseName: 'Lift s', styleId: 'medium', muscleGroups: ['back'], position: 1, exerciseRole: 'secondary' },
    { id: 'se-a', sessionId: 'ps-static', exerciseName: 'Lift a', styleId: 'light', muscleGroups: ['biceps'], position: 2, exerciseRole: 'accessory' },
    { id: 'se-b', sessionId: 'ps-static', exerciseName: 'Lift b', styleId: 'light', muscleGroups: ['core'], position: 3, exerciseRole: 'accessory' },
  ],
}

const PHASES: ProgramPhase[] = [
  { id: 'ph-1', phaseSetId: 'set', position: 0, name: 'Build', durationCycles: 4, phaseType: 'normal' as never, primaryStyleId: 'heavy', secondaryStyleId: 'medium' },
]

export function staticCtx(mode: 'automatic' | 'ai_dynamic', over: Partial<BuildWorkoutExercisesCtx> = {}): BuildWorkoutExercisesCtx {
  const styleById = new Map(STYLES.map(st => [st.id, st.sets]))
  return {
    lastLogs: new Map(),
    lastRealOneRm: new Map([['Lift p', { estimated1rm: 140, target80: 112 }], ['Lift s', { estimated1rm: 90, target80: 72 }]]),
    prMap: new Map([['Lift a', 40]]),
    estimateMap: new Map(),
    styleById,
    styleByName: new Map(STYLES.map(st => [(st as unknown as { name: string }).name, st.sets])),
    styles: STYLES,
    libByName: new Map([
      ['lift p', { name: 'Lift p', exerciseType: 'weighted', equipment: ['barbell'], muscles: [] }],
      ['lift s', { name: 'Lift s', exerciseType: 'weighted', equipment: ['cable'], muscles: [] }],
      ['lift a', { name: 'Lift a', exerciseType: 'weighted', equipment: ['dumbbell'], muscles: [] }],
      ['lift b', { name: 'Lift b', exerciseType: 'bodyweight', equipment: [], muscles: [] }],
    ] as never),
    currentPhase: mode === 'automatic' ? PHASES[0] : null,
    allPhases: mode === 'automatic' ? PHASES : [],
    isDeloadActive: false,
    isBaselinePhase: false,
    aiDrivesLoad: false,
    aiPrescription: null,
    aiPhaseLabel: '',
    isAiDynamic: mode === 'ai_dynamic',
    aiDeload: false,
    droppedThisCycle: new Set(),
    loggedTodayInThisSession: new Set(),
    trainingGoal: 'powerbuilding',
    ...over,
  }
}
