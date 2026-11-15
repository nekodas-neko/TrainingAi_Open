/**
 * #3799 (owner's option A, 15 Nov) and #3800.
 *
 * A deload offered for one day's reason (an emergency rule or the whole-session soreness deload)
 * lightens that session only. Accepting it used to move the session type's phase to `deload`, and
 * loads then followed the phase for two or three weeks. Now the phase stays where it was, the
 * accepted deload is held until the session is trained, and the next session is planned from the
 * unchanged phase. Only a planned move (the realisation ceiling, the phase list) changes the phase;
 * the route tests in `lib/__tests__/ai-periodization-session-routes.test.ts` cover that half.
 *
 * #3800: the "missing reps" rule measures the last session against the reps that session was asked
 * for, not the plan stored now.
 *
 * The model is mocked throughout: no live calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiPrescription } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '../signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { isOneDayDeload, holdsOneDayDeload } from '../one-day-deload'
import { shouldTriggerEmergencyDeload } from '../emergency-deload'
import { applyProgramPhaseCap, programPhaseView } from '../program-phase'
import { repCompletionFromSetLogs } from '../rep-completion'

const mocks = vi.hoisted(() => ({ signals: null as unknown, modelAnswer: null as unknown }))
vi.mock('../signals', async importOriginal => ({
  ...(await importOriginal<typeof import('../signals')>()),
  aggregateSignals: async () => mocks.signals,
}))
vi.mock('@/lib/ai/instrument', () => ({
  aiModel: () => ({}),
  loggedGenerateObject: async () => ({ object: mocks.modelAnswer }),
}))

const { generatePrescriptionForSession, buildWholeSessionDeloadPrescription } = await import('../generate-prescription')
const { aggregateSignals: realAggregateSignals } = await vi.importActual<typeof import('../signals')>('../signals')

type Ex = PrescriptionSignals['exercises'][number]
const exercise = (id: string): Ex => ({
  sessionExerciseId: id, name: `Lift ${id}`, role: 'primary', muscleGroups: ['chest'],
  muscleAssignments: [{ muscle: 'chest', role: 'main' }], baseline1rm: 100, current1rm: 100,
  exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0, avgSetDurationSec: 45, timeProfile: null,
  equipment: [], transitionSec: 240, plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [{ pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }, { pct: 80, reps: 5, restSec: 120 }],
}) as Ex

const baseSignals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [exercise('a')], phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {}, acwr: null,
  sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null, externalReadiness: null,
  confidenceTier: 1, confidence: 0.5, confidenceReasons: [], selfReportedSick: false, sleepScoreTrend: null,
  tempZ: null, trainingLoadOts: null, trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as PrescriptionSignals

const SESSION = 'ps-3799'
let n = 0
function harness() {
  const stored: AiPrescription[] = []
  const advanced: string[] = []
  const state = {
    phase: 'accumulation', baselineComplete: true, sessionsInPhase: 2,
    prescription: null as AiPrescription | null, prescriptionStatus: 'consumed',
    prescriptionExpiresAt: null as Date | null, prescriptionGeneratedAt: null,
  }
  const known: Record<string, unknown> = {
    getActiveProgram: async () => ({ id: 'prog-1', sessions: [{ id: SESSION, timeBudgetMinutes: 90 }] }),
    ensureSessionPeriodization: async () => state,
    reconcileSessionsInPhase: async () => undefined,
    getSessionPeriodization: async () => state,
    // #3766: the program's phase is read from every row of the program, and its weeks from completions.
    listSessionPeriodizationForProgram: async () => [{ phaseStartedAt: new Date(0), ...state }],
    listProgramCompletions: async () => [],
    listModelPhaseAnswers: async () => [],
    setProgramPhase: async () => undefined,
    storePrescription: async (_u: string, _s: string, prescription: AiPrescription, expiresAt: Date) => {
      stored.push(prescription)
      state.prescription = prescription
      state.prescriptionExpiresAt = expiresAt
      state.prescriptionStatus = 'pending'
    },
    advancePhase: async (_u: string, _s: string, phase: string) => { advanced.push(phase); state.phase = phase },
    advanceProgramPhase: async (_u: string, _s: string, phase: string) => { advanced.push(phase); state.phase = phase },
  }
  const repo = new Proxy({}, { get: (_t, prop: string) => known[prop] ?? (async () => undefined) }) as WorkoutRepository
  return { repo, stored, advanced, state, run: () => generatePrescriptionForSession(`user-3799-${++n}`, SESSION, repo, 'Australia/Brisbane') }
}

const stayAnswer = {
  phase: 'accumulation', phase_action: 'stay', deload: false, confidence: 0.7, reasoning: 'test',
  exercises: [{ session_exercise_id: 'a', name: 'Lift a', sets: 4, reps: 5, pct: 75, rest_sec: 120 }],
}

describe('telling a one-day deload from a planned one (#3799)', () => {
  it('an emergency or whole-session soreness deload is a one-day deload', () => {
    expect(isOneDayDeload(buildWholeSessionDeloadPrescription(baseSignals(), 'Emergency deload: x.'))).toBe(true)
  })

  it('the realisation cap\'s deload is a planned phase move, not a one-day deload', () => {
    // #3766: the cap is the program's, in training weeks. Two past weeks of realisation reach it.
    const start = new Date('2026-11-02T00:00:00+10:00')
    const view = programPhaseView(
      [{ programSessionId: 'a', phase: 'realisation', phaseStartedAt: start, sessionsInPhase: 2, baselineComplete: true, pendingTransition: null }],
      [{ programSessionId: 'a', completedAt: new Date('2026-11-03T08:00:00+10:00') }, { programSessionId: 'a', completedAt: new Date('2026-11-10T08:00:00+10:00') }],
      'Australia/Brisbane', new Date('2026-11-17T12:00:00+10:00'),
    )
    const planned = applyProgramPhaseCap({ phase: 'realisation', phaseAction: 'stay', reasoning: '' } as AiPrescription, view)
    expect(planned.phase).toBe('deload')
    expect(isOneDayDeload(planned)).toBe(false)
  })

  it('a held one-day deload is pending or accepted and unexpired', () => {
    const now = new Date('2026-11-14T00:00:00Z')
    const p = { deload: true, phaseAction: 'deload_recommended' } as const
    const later = new Date(now.getTime() + 1)
    expect(holdsOneDayDeload({ prescription: p, prescriptionStatus: 'pending', prescriptionExpiresAt: later }, now)).toBe(true)
    expect(holdsOneDayDeload({ prescription: p, prescriptionStatus: 'accepted', prescriptionExpiresAt: later }, now)).toBe(true)
    expect(holdsOneDayDeload({ prescription: p, prescriptionStatus: 'consumed', prescriptionExpiresAt: later }, now)).toBe(false)
    expect(holdsOneDayDeload({ prescription: p, prescriptionStatus: 'accepted', prescriptionExpiresAt: now }, now)).toBe(false)
  })

  it('the emergency check does not re-fire over an accepted deload in an unchanged phase', () => {
    const now = new Date('2026-11-14T00:00:00Z')
    const sick = { ...baseSignals({ selfReportedSick: true }) }
    const accepted = {
      phase: 'accumulation' as const,
      prescription: buildWholeSessionDeloadPrescription(baseSignals(), 'x'),
      prescriptionStatus: 'accepted' as const,
      prescriptionExpiresAt: new Date(now.getTime() + 3_600_000),
    }
    expect(shouldTriggerEmergencyDeload(sick, accepted, now)).toBe(false)
    expect(shouldTriggerEmergencyDeload(sick, { ...accepted, prescriptionStatus: 'consumed' }, now)).toBe(true)
  })
})

describe('an accepted emergency deload leaves the phase, and the next session is normal (#3799)', () => {
  beforeEach(() => { mocks.modelAnswer = stayAnswer })

  it('offer → accept → train → next generation', async () => {
    const h = harness()

    // The offer: an emergency rule fires. Nothing about the phase moves.
    mocks.signals = baseSignals({ acwr: 9 })
    const offered = await h.run()
    expect(offered.ok && offered.prescription.phaseAction).toBe('deload_recommended')
    expect(h.state.phase).toBe('accumulation')

    // The lifter accepts: the respond route writes only the status (its own test pins that).
    h.state.prescriptionStatus = 'accepted'

    // Re-opening the session while the signal still holds returns the accepted deload as it is.
    const reopened = await h.run()
    expect(reopened.ok && reopened.prescriptionStatus).toBe('accepted')
    expect(reopened.ok && reopened.prescription.deload).toBe(true)
    expect(h.stored).toHaveLength(1)

    // The session is trained; completion marks the slot consumed. The next generation, on a clean
    // day, plans a normal session in the phase the session type was already in.
    h.state.prescriptionStatus = 'consumed'
    mocks.signals = baseSignals()
    const next = await h.run()
    expect(next.ok && next.prescription.deload).toBe(false)
    expect(next.ok && next.prescription.phase).toBe('accumulation')
    expect(next.ok && next.prescription.exercises[0].pct).toBe(75)
    expect(h.state.phase).toBe('accumulation')
    expect(h.advanced).toEqual([])
  })
})

describe('the missing-reps signal reads the session\'s own planned reps (#3800)', () => {
  it('done ÷ planned over sets that carry a planned figure', () => {
    const r = repCompletionFromSetLogs([
      { exerciseName: 'Squat', reps: 5, plannedReps: 5 },
      { exerciseName: 'Squat', reps: 3, plannedReps: 5 },
      { exerciseName: 'Curl', reps: 12, plannedReps: 10 },
      { exerciseName: 'Curl', reps: 8, plannedReps: null }, // extra set: left out of both sides
    ])
    expect(r.rate).toBeCloseTo(20 / 20)
    expect(r.perExercise.get('Squat')).toBeCloseTo(8 / 10)
    expect(r.perExercise.get('Curl')).toBeCloseTo(12 / 10)
  })

  it('no planned reps on any set → no signal, so the rule cannot fire', () => {
    expect(repCompletionFromSetLogs([{ exerciseName: 'Squat', reps: 2, plannedReps: null }]).rate).toBeNull()
    expect(repCompletionFromSetLogs([]).rate).toBeNull()
  })

  // The production scenario: the session ran 3×5, then a fallback stored a larger 5×8 plan. Against
  // the stored plan the finished session reads as 15/40 = 38%, under the 70% trigger.
  it('a stored plan that grew after the session does not make a finished session read as missed reps', async () => {
    const lastSession = { id: 'ws-last', startedAt: new Date(Date.now() - 2 * 86_400_000), completedAt: new Date(Date.now() - 2 * 86_400_000 + 3_600_000), sessionName: 'Legs' }
    const nextPlan = {
      phase: 'accumulation', phaseAction: 'stay', deload: false,
      exercises: [{ sessionExerciseId: 'ex-1', name: 'Squat', sets: 5, reps: 8, pct: 70, restSec: 120 }],
    }
    const target: Record<string, unknown> = {
      getActiveProgram: async () => ({
        id: 'p-1', trainingGoal: 'strength', autoApplyPrescriptions: false, createdAt: new Date(Date.now() - 90 * 86_400_000),
        sessions: [{ id: SESSION, name: 'Legs', exercises: [{ id: 'ex-1', exerciseName: 'Squat', muscleGroups: ['quads'] }], timeBudgetMinutes: 60 }],
      }),
      getSessionPeriodization: async () => ({
        phase: 'accumulation', sessionsInPhase: 2, baseline1rm: {}, lastSessionRanPrescription: true,
        prescription: nextPlan, prescriptionStatus: 'pending',
      }),
      getRecentSessionsOfType: async () => [lastSession],
      getSetLogsForSessions: async () => [1, 2, 3].map(setNumber => ({
        workoutSessionId: 'ws-last', exerciseName: 'Squat', setNumber, rpe: null, reps: 5, intensityPct: 80, setTimeSec: null, plannedReps: 5,
      })),
      getTimingAuditData: async () => ({ sets: [], exercises: [], sessions: [] }),
    }
    const repo = new Proxy(target, {
      get(t, prop: string) {
        if (prop in t) return t[prop]
        if (/^get(Exercise|Weekly)/.test(prop)) return async () => ({})
        if (/^get(MoodLog|DayCheckin|OuraCloudSwitchDay)$/.test(prop)) return async () => null
        if (/^list(PersonalRecords|Previous1rm)$/.test(prop)) return async () => new Map()
        return async () => []
      },
    }) as never
    const signals = await realAggregateSignals('u-3800', SESSION, repo, 'Australia/Brisbane')
    expect(signals!.repCompletionRate).toBe(1)
  })
})
