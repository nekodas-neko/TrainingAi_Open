// BF-198 — on a WHOLE-SESSION deload the `Full` toggle did nothing. `Full` reverts each exercise to
// the `preDeload` block its prescription recorded; the per-exercise path records one and this
// builder recorded none, so the toggle had nothing to restore. Worse, every set under the override
// was still logged as a deload and earned no 1RM. Measured in production: Upper and Pull, 5 of 5
// deloaded, 0 with `preDeload`.
import { describe, it, expect } from 'vitest'
import { buildWholeSessionDeloadPrescription, buildRulesPrescription } from '../generate-prescription'
import { buildWorkoutExercises, type BuildWorkoutExercisesCtx } from '@trainingai/shared/workout/session-data'
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_REST } from '@trainingai/shared/ai-periodization/deload-constants'
import type { PrescriptionSignals } from '../signals'
import type { ProgramSession } from '@trainingai/shared/types/program'

type Ex = PrescriptionSignals['exercises'][number]

const exercise = (over: Partial<Ex> = {}): Ex => ({
  sessionExerciseId: 'se-1', name: 'Incline Bench Press', role: 'primary',
  muscleGroups: ['chest'], muscleAssignments: [{ muscle: 'chest', role: 'main' }],
  baseline1rm: 60, current1rm: 60, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0,
  avgSetDurationSec: 45, timeProfile: null, equipment: [], transitionSec: 240, plateau: false,
  rpeDelta: null, repCompletionRate: null,
  baseSets: [
    { pct: 75, reps: 8, restSec: 120 },
    { pct: 75, reps: 8, restSec: 120 },
    { pct: 75, reps: 8, restSec: 120 },
  ],
  ...over,
})

const signals = (over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'strength', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 90,
  exercises: [
    exercise(),
    exercise({ sessionExerciseId: 'se-2', name: 'Barbell Skull Crusher', role: 'accessory', baseSets: [] }),
  ],
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: {}, weeklyLogged: {}, volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null,
  externalReadiness: null, confidenceTier: 1, confidence: 0.5, confidenceReasons: [],
  selfReportedSick: false, sleepScoreTrend: null, tempZ: null, trainingLoadOts: null,
  trainingLoadHigh: null, resilienceLevel: null,
  ...over,
})

describe('BF-198 — a whole-session deload records what Full reverts to', () => {
  const s = signals()
  const deload = buildWholeSessionDeloadPrescription(s, 'emergency')
  const byId = (id: string) => deload.exercises.find(e => e.sessionExerciseId === id)!

  it('is still a deload, at the deload numbers', () => {
    expect(deload.deload).toBe(true)
    for (const e of deload.exercises) {
      expect(e.deloaded).toBe(true)
      expect(e.pct).toBe(DELOAD_LOWER_PCT.strength ?? 50)
      expect(e.reps).toBe(DELOAD_REPS.strength ?? 8)
      expect(e.restSec).toBe(DELOAD_REST)
    }
  })

  it('records the program’s own numbers as preDeload — the same plan the rules prescriber builds', () => {
    const full = buildRulesPrescription(s, 'x')!.exercises.find(e => e.sessionExerciseId === 'se-1')!
    expect(byId('se-1').preDeload).toEqual({ sets: full.sets, reps: 8, pct: 75, restSec: 120 })
  })

  it('restores the session that FITS today’s budget, not the raw style', () => {
    // At 90 minutes nothing is trimmed, so the style's 3 sets and the fitted count agree and a test
    // there cannot tell them apart. A tight budget can.
    const tight = signals({ effectiveTimeBudgetMin: 5 })
    const full = buildRulesPrescription(tight, 'x')!.exercises.find(e => e.sessionExerciseId === 'se-1')!
    expect(full.sets).toBeLessThan(3)
    const pre = buildWholeSessionDeloadPrescription(tight, 'emergency')
      .exercises.find(e => e.sessionExerciseId === 'se-1')!.preDeload
    expect(pre?.sets).toBe(full.sets)
  })

  it('records nothing for an exercise with no base style, rather than inventing numbers', () => {
    expect(byId('se-2').preDeload).toBeUndefined()
  })

  it('reaches the workout screen as a preDeloadStyle, which is what the Full revert needs', () => {
    const session: ProgramSession = {
      id: 'sess', programId: 'p', name: 'Upper', position: 0, timeBudgetMinutes: 60,
      exercises: [
        { id: 'se-1', sessionId: 'sess', exerciseName: 'Incline Bench Press', muscleGroups: ['chest'], position: 0, exerciseRole: 'primary' },
      ],
    }
    const ctx: BuildWorkoutExercisesCtx = {
      lastLogs: new Map(), prMap: new Map(), estimateMap: new Map(), styleById: new Map(),
      styleByName: new Map(), styles: [], libByName: new Map(), currentPhase: null, allPhases: [],
      isDeloadActive: false, isBaselinePhase: false, aiDrivesLoad: true, aiPrescription: deload,
      aiPhaseLabel: 'Deload', isAiDynamic: true, aiDeload: false, droppedThisCycle: new Set(),
      loggedTodayInThisSession: new Set(), trainingGoal: 'strength',
    }
    const [ex] = buildWorkoutExercises(session, ctx)
    expect(ex.deloaded).toBe(true)
    expect(ex.preDeloadStyle?.[0]?.pct).toBe(75)
    expect(ex.preDeloadSets).toBe(byId('se-1').preDeload!.sets)
  })
})
