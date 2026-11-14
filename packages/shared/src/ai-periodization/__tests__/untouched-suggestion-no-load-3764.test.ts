// #3764 (owner sign-off, option A). A sore tick the app selected and the lifter left untouched
// changes no load: not per exercise, not the whole session, not the emergency soreness rule. A tick
// the lifter added still does. A check-in with no stored suggestion behaves as it did before.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { soreTickProvenance } from '@trainingai/shared/checkin/suggested-soreness'
import { sessionSoreness } from '../session-soreness'
import { computePerExerciseDeload, type PerExerciseDeloadInput } from '../per-exercise-deload'
import { emergencyDeloadTrigger, type EmergencySignals } from '../emergency-deload'
import { reevaluatePrescriptionForToday, reevaluationKey, type ReevaluationSignals } from '../reevaluate'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'

const SESSION_MUSCLES = ['chest', 'quadriceps', 'hamstrings', 'glutes']
const EXERCISES: PerExerciseDeloadInput[] = [
  { sessionExerciseId: 'bench', name: 'Bench', muscleAssignments: [{ muscle: 'chest', role: 'main' }] },
  { sessionExerciseId: 'squat', name: 'Squat', muscleAssignments: [{ muscle: 'quadriceps', role: 'main' }] },
  { sessionExerciseId: 'rdl', name: 'RDL', muscleAssignments: [{ muscle: 'hamstrings', role: 'main' }] },
  { sessionExerciseId: 'thrust', name: 'Hip Thrust', muscleAssignments: [{ muscle: 'glutes', role: 'main' }] },
]
const log = (soreMuscles: string[], suggestedSoreMuscles: string[] | null | undefined) => ({
  bodyState: soreMuscles.length ? ['sore_muscles'] : [], soreMuscles, suggestedSoreMuscles,
})
const deloadFor = (l: ReturnType<typeof log>) => {
  const s = sessionSoreness(l, SESSION_MUSCLES)
  return computePerExerciseDeload(EXERCISES, s.soreMusclesInSession, 'strength', 'accumulation', s.recentlyTrainedMusclesInSession)
}

describe('soreTickProvenance — which ticks are the lifter\'s', () => {
  it('a suggestion left as it was is not the lifter\'s', () => {
    expect(soreTickProvenance(['Quads'], ['Quads'])).toEqual({ lifterReported: [], untouchedSuggestions: ['Quads'] })
  })
  it('a region the lifter added is theirs; a region they removed is in neither list', () => {
    expect(soreTickProvenance(['Chest'], ['Quads'])).toEqual({ lifterReported: ['Chest'], untouchedSuggestions: [] })
  })
  it('compares through the muscle normaliser, so case cannot turn a suggestion into a tick', () => {
    expect(soreTickProvenance(['quads'], ['QUADS']).lifterReported).toEqual([])
  })
  it('no stored suggestion (null or missing) treats every tick as the lifter\'s, as before', () => {
    expect(soreTickProvenance(['Quads'], null).lifterReported).toEqual(['Quads'])
    expect(soreTickProvenance(['Quads'], undefined).lifterReported).toEqual(['Quads'])
  })
  it('an empty stored suggestion means none were suggested', () => {
    expect(soreTickProvenance(['Quads'], []).lifterReported).toEqual(['Quads'])
  })
})

describe('per-exercise deload', () => {
  it('an untouched suggestion changes no load and earns the neutral note', () => {
    const r = deloadFor(log(['Quads'], ['Quads']))
    expect(r.outcome).toBe('none')
    expect(r.deloadedIds.size).toBe(0)
    expect(r.notes).toEqual({})
    expect(r.recentNotes).toEqual({ squat: 'Trained recently — quads, normal load' })
  })
  it('a region the lifter added lightens that exercise with the "still sore" note', () => {
    const r = deloadFor(log(['Quads', 'Chest'], ['Quads']))
    expect(r.outcome).toBe('per_exercise')
    expect([...r.deloadedIds]).toEqual(['bench'])
    expect(r.notes).toEqual({ bench: 'Deload — chest still sore' })
    expect(r.recentNotes).toEqual({ squat: 'Trained recently — quads, normal load' })
  })
  it('a suggested region the lifter removed changes nothing and says nothing', () => {
    const r = deloadFor(log([], ['Quads']))
    expect(r.outcome).toBe('none')
    expect(r.recentNotes).toEqual({})
  })
  it('a legacy check-in with no stored suggestion deloads exactly as before', () => {
    const r = deloadFor(log(['Quads'], null))
    expect(r.outcome).toBe('per_exercise')
    expect(r.notes).toEqual({ squat: 'Deload — quads still sore' })
    expect(r.recentNotes).toEqual({})
  })
  it('a deload phase still returns nothing at all', () => {
    const s = sessionSoreness(log(['Quads'], ['Quads']), SESSION_MUSCLES)
    expect(computePerExerciseDeload(EXERCISES, s.soreMusclesInSession, 'strength', 'deload', s.recentlyTrainedMusclesInSession).recentNotes).toEqual({})
  })
})

describe('whole-session deload', () => {
  const legs = ['Quads', 'Hamstrings', 'Glutes']
  it('most of the session under untouched suggestions is not a whole-session deload', () => {
    const r = deloadFor(log(legs, legs))
    expect(r.outcome).toBe('none')
    expect(Object.keys(r.recentNotes).sort()).toEqual(['rdl', 'squat', 'thrust'])
  })
  it('the same regions added by the lifter still offer the whole-session deload', () => {
    expect(deloadFor(log(legs, [])).outcome).toBe('whole_session')
  })
  it('and a legacy check-in with them still offers it', () => {
    expect(deloadFor(log(legs, null)).outcome).toBe('whole_session')
  })
})

describe('emergency soreness rule (<36 h and 3+ sore muscles in the session)', () => {
  const legs = ['Quads', 'Hamstrings', 'Glutes']
  const emergency = (l: ReturnType<typeof log>): EmergencySignals => ({
    consecutiveSessionDaysOfThisType: 0, hoursSinceLastSession: 20,
    soreMusclesInSession: sessionSoreness(l, SESSION_MUSCLES).soreMusclesInSession,
    activeInjuredMusclesInSession: [], acwr: null, rpeTrend: null, repCompletionRate: null, selfReportedSick: false,
  })
  it('three untouched suggestions do not fire it', () => {
    expect(emergencyDeloadTrigger(emergency(log(legs, legs)))).toBeNull()
  })
  it('three regions the lifter added do', () => {
    expect(emergencyDeloadTrigger(emergency(log(legs, ['Chest'])))?.kind).toBe('soreness')
  })
  it('two added plus one untouched does not reach three', () => {
    expect(emergencyDeloadTrigger(emergency(log(legs, ['Glutes'])))).toBeNull()
  })
  it('a legacy check-in still fires it', () => {
    expect(emergencyDeloadTrigger(emergency(log(legs, null)))?.kind).toBe('soreness')
  })
})

describe('sessionSoreness — the out-of-session list and the bodyState gate', () => {
  it('an untouched suggestion outside the session is dropped, a lifter tick outside it kept', () => {
    const s = sessionSoreness(log(['Biceps', 'Triceps'], ['Biceps']), SESSION_MUSCLES)
    expect(s).toEqual({ soreMusclesInSession: [], soreMusclesOutOfSession: ['Triceps'], recentlyTrainedMusclesInSession: [] })
  })
  it('no "sore_muscles" body state means nothing, as before', () => {
    expect(sessionSoreness({ bodyState: [], soreMuscles: ['Quads'], suggestedSoreMuscles: [] }, SESSION_MUSCLES).soreMusclesInSession).toEqual([])
  })
})

describe('consumption-day re-check', () => {
  const FULL = { sets: 4, reps: 5, pct: 75, restSec: 150 }
  const stored: AiPrescription = {
    phase: 'accumulation', phaseAction: 'stay', deload: false, reasoning: 'r', confidence: 0.8,
    estimatedSessionDurationMin: 50, weeklyVolumeContribution: {},
    exercises: [
      { sessionExerciseId: 'bench', name: 'Bench', ...FULL },
      // Deloaded yesterday under the old rule, for a suggestion nobody touched.
      { sessionExerciseId: 'squat', name: 'Squat', sets: 2, reps: 5, pct: 52, restSec: 120, deloaded: true,
        deloadNote: 'Deload — quads still sore', preDeload: FULL },
    ],
  }
  const state = { phase: 'accumulation', prescription: null, prescriptionStatus: 'accepted', prescriptionExpiresAt: null } as const
  const signals = (l: ReturnType<typeof log>): ReevaluationSignals => {
    const s = sessionSoreness(l, SESSION_MUSCLES)
    return {
      soreMusclesInSession: s.soreMusclesInSession, recentlyTrainedMusclesInSession: s.recentlyTrainedMusclesInSession,
      hoursSinceLastSession: 48, activeInjuredMusclesInSession: [], trainingGoal: 'strength', illnessFlag: null,
      selfReportedSick: false, exercises: EXERCISES.slice(0, 2),
    }
  }
  const NOW = new Date('2026-11-14T02:00:00Z')

  it('a plan deloaded for an untouched suggestion goes back to normal load with the neutral note', () => {
    const r = reevaluatePrescriptionForToday(stored, signals(log(['Quads'], ['Quads'])), { ...state }, NOW)
    const squat = r.prescription.exercises.find(e => e.sessionExerciseId === 'squat')!
    expect(r.changed).toBe(true)
    expect(squat).toMatchObject({ ...FULL, deloaded: false, autoregNote: 'Trained recently — quads, normal load' })
    expect(squat.deloadNote).toBeUndefined()
  })
  it('a plan built at normal load gains the neutral note once, and no numbers move', () => {
    const fresh: AiPrescription = { ...stored, exercises: [stored.exercises[0], { sessionExerciseId: 'squat', name: 'Squat', ...FULL }] }
    const r = reevaluatePrescriptionForToday(fresh, signals(log(['Quads'], ['Quads'])), { ...state }, NOW)
    expect(r.changed).toBe(true)
    expect(r.prescription.exercises[1]).toEqual({ sessionExerciseId: 'squat', name: 'Squat', ...FULL, autoregNote: 'Trained recently — quads, normal load' })
    expect(reevaluatePrescriptionForToday(r.prescription, signals(log(['Quads'], ['Quads'])), { ...state }, NOW).changed).toBe(false)
  })
  it('the same region added by the lifter keeps the deload', () => {
    const r = reevaluatePrescriptionForToday(stored, signals(log(['Quads'], [])), { ...state }, NOW)
    expect(r.prescription.exercises.find(e => e.sessionExerciseId === 'squat')).toMatchObject({ deloaded: true, pct: 52 })
  })
  it('the re-check key moves when only the provenance moves, and a legacy log keeps its old key', () => {
    const base = { bodyState: ['sore_muscles'], soreMuscles: ['Quads'], updatedAt: '2026-11-14T01:00:00.000Z' }
    expect(reevaluationKey('2026-11-14', { ...base, suggestedSoreMuscles: ['Quads'] }))
      .not.toBe(reevaluationKey('2026-11-14', { ...base, suggestedSoreMuscles: [] }))
    expect(reevaluationKey('2026-11-14', { ...base, suggestedSoreMuscles: null })).toBe(reevaluationKey('2026-11-14', base))
  })
})

// ── Generation: the deterministic deload runs before the model, and the note reaches the plan ──

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

function signalsFrom(l: ReturnType<typeof log>): PrescriptionSignals {
  const s = sessionSoreness(l, ['chest', 'quadriceps'])
  return {
    trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
    exercises: [exercise('a', 'chest'), exercise('b', 'quadriceps')], phase: 'accumulation', sessionsInPhase: 2,
    hoursSinceLastSession: 48, consecutiveSessionDaysOfThisType: 0, ...s,
    sorenessLogDate: 'today', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
    repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
    sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
    confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
    tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  } as unknown as PrescriptionSignals
}

const SESSION = 'ps-3764'
let n = 0
async function generate() {
  const stored: AiPrescription[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null, prescriptionStatus: 'consumed', prescriptionExpiresAt: null, prescriptionGeneratedAt: null,
  }
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog-1', sessions: [{ id: SESSION, timeBudgetMinutes: 90 }] }),
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    storePrescription: async (_u: string, _s: string, p: AiPrescription) => { stored.push(p) },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  await generatePrescriptionForSession(`user-3764-${++n}`, SESSION, repo, 'Australia/Brisbane')
  return stored[0]
}

describe('generation with the model mocked (0 real calls)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
    mocks.modelAnswer = {
      phase: 'accumulation', phase_action: 'stay', deload: false, confidence: 0.7, reasoning: 'test',
      exercises: [
        { session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 5, pct: 75, rest_sec: 120 },
        { session_exercise_id: 'b', name: 'Lift b', sets: 4, reps: 5, pct: 75, rest_sec: 120 },
      ],
    }
  })
  afterEach(() => { vi.useRealTimers() })

  it('an untouched suggestion: the exercise keeps the model\'s load and shows the neutral note', async () => {
    mocks.signals = signalsFrom(log(['Quads'], ['Quads']))
    const b = (await generate()).exercises.find(e => e.sessionExerciseId === 'b')!
    expect(b).toMatchObject({ pct: 75, autoregNote: 'Trained recently — quads, normal load' })
    expect(b.deloaded).toBeUndefined()
  })
  it('the lifter added it: the exercise is lightened with the "still sore" note', async () => {
    mocks.signals = signalsFrom(log(['Quads'], []))
    const b = (await generate()).exercises.find(e => e.sessionExerciseId === 'b')!
    expect(b).toMatchObject({ deloaded: true, deloadNote: 'Deload — quads still sore' })
    expect(b.pct).toBeLessThan(75)
  })
})
