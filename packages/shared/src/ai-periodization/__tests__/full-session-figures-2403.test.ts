/**
 * #2403 — under `Full` over a deload, the card's rows showed the full numbers while its "~N min of
 * work" and the weekly-volume pills still showed the deload's. The engine now stores the same two
 * figures for the session Full trains (`fullSession`), computed by the one helper that computes the
 * stored figures.
 *
 * Two things to prove:
 *   1. Nothing that is stored today moves. The figures below were recorded by running these exact
 *      fixtures against main before the change (the three hand-written loops), so moving the
 *      builders and the budget stage onto `prescriptionFigures` is pinned, not assumed.
 *   2. `fullSession` exists only where Full changes something, and it costs the rows Full trains.
 *
 * Fixtures: measured time profiles (so the measured-rest path runs, including the short-day scaled
 * rest), secondary muscle assignments (half-weight volume), a style-less exercise (no `preDeload`, so
 * it stays deloaded under Full), and a mixed-case muscle name.
 */
import { describe, it, expect } from 'vitest'
import type { PrescriptionSignals } from '../signals'
import type { BudgetStageExercise } from '../budget-stage'
import { applyBudgetStage } from '../budget-stage'
import {
  buildWholeSessionDeloadPrescription,
  buildRulesPrescription,
  buildProgramAsWrittenPrescription,
} from '../generate-prescription'
import { prescriptionFigures, rowUnderFull, hasFullSessionRevert } from '../prescription-figures'

type Ex = PrescriptionSignals['exercises'][number]

const profile = (secPerRep: number, light: number | null, moderate: number | null, overall: number) => ({
  secPerRep, secPerRepSamples: 12,
  restSecByBand: { light, moderate, heavy: null, max: null },
  restSamplesByBand: { light: 12, moderate: 12, heavy: 0, max: 0 },
  restSecOverall: overall, restSamplesOverall: 30,
})

const exercise = (over: Partial<Ex>): Ex => ({
  sessionExerciseId: 'se-1', name: 'Bench Press', role: 'primary',
  muscleGroups: ['chest'], muscleAssignments: [{ muscle: 'Chest', role: 'main' }, { muscle: 'triceps', role: 'secondary' }],
  baseline1rm: 100, current1rm: 100, exerciseType: null, rm1Trend: 'flat', rm1ChangeKg: 0,
  avgSetDurationSec: 45, timeProfile: profile(3.2, 95, 140, 120) as never, equipment: [], transitionSec: 180,
  plateau: false, rpeDelta: null, repCompletionRate: null,
  baseSets: [
    { pct: 77.5, reps: 6, restSec: 150 },
    { pct: 77.5, reps: 6, restSec: 150 },
    { pct: 77.5, reps: 6, restSec: 150 },
    { pct: 77.5, reps: 6, restSec: 150 },
  ],
  ...over,
})

const base = (exercises: Ex[], over: Partial<PrescriptionSignals> = {}): PrescriptionSignals => ({
  trainingGoal: 'hypertrophy', autoApplyPrescriptions: false, effectiveTimeBudgetMin: 51,
  exercises,
  phase: 'accumulation', sessionsInPhase: 2, hoursSinceLastSession: 48,
  consecutiveSessionDaysOfThisType: 0, soreMusclesInSession: [], soreMusclesOutOfSession: [],
  sorenessLogDate: 'none', activeInjuredMusclesInSession: [], morningCheckin: null, rpeTrend: null,
  repCompletionRate: null, weeklyTargets: { chest: 16, back: 16, biceps: 12 }, weeklyLogged: { chest: 4, back: 6, biceps: 2 },
  volumeBudgetPerMuscleGroup: {},
  acwr: null, sleepTrend: null, hrvTrend: null, spo2Trend: null, illness: null,
  externalReadiness: null, confidenceTier: 1, confidence: 0.5, confidenceReasons: [],
  selfReportedSick: false, sleepScoreTrend: null, tempZ: null, trainingLoadOts: null,
  trainingLoadHigh: null, resilienceLevel: null,
  ...over,
}) as PrescriptionSignals

const exercises: Ex[] = [
  exercise({}),
  exercise({
    sessionExerciseId: 'se-2', name: 'Cable Row', role: 'secondary',
    muscleAssignments: [{ muscle: 'back', role: 'main' }, { muscle: 'biceps', role: 'secondary' }],
    timeProfile: profile(2.6, 70, null, 88) as never, transitionSec: 120,
    baseSets: [{ pct: 70, reps: 10, restSec: 120 }, { pct: 70, reps: 10, restSec: 120 }, { pct: 70, reps: 10, restSec: 120 }],
  }),
  exercise({
    sessionExerciseId: 'se-3', name: 'Curl', role: 'accessory',
    muscleAssignments: [{ muscle: 'biceps', role: 'main' }],
    timeProfile: null, transitionSec: 90,
    baseSets: [{ pct: 65, reps: 12, restSec: 90 }, { pct: 65, reps: 12, restSec: 90 }, { pct: 65, reps: 12, restSec: 90 }],
  }),
  exercise({
    sessionExerciseId: 'se-4', name: 'Skull Crusher', role: 'accessory',
    muscleAssignments: [{ muscle: 'triceps', role: 'main' }],
    timeProfile: null, baseSets: [],
  }),
]

export const FIX = {
  signals: {
    normal: base(exercises),
    tight: base(exercises, { effectiveTimeBudgetMin: 25 }),
    deloadPhase: base(exercises, { phase: 'deload' }),
    allStyled: base(exercises.slice(0, 3)),
  },
  stage: [
    { sessionExerciseId: 'se-1', name: 'Bench Press', sets: 4, reps: 6, pct: 77.5, restSec: 150 },
    { sessionExerciseId: 'se-2', name: 'Cable Row', sets: 4, reps: 10, pct: 70, restSec: 120 },
    { sessionExerciseId: 'se-3', name: 'Curl', sets: 4, reps: 12, pct: 65, restSec: 90 },
    { sessionExerciseId: 'se-4', name: 'Skull Crusher', sets: 3, reps: 12, pct: 60, restSec: 90 },
  ] satisfies BudgetStageExercise[],
}

const figuresOf = (p: { estimatedSessionDurationMin: number; weeklyVolumeContribution: Record<string, number> }) =>
  ({ estimatedSessionDurationMin: p.estimatedSessionDurationMin, weeklyVolumeContribution: p.weeklyVolumeContribution })

describe('the stored figures are what main stored (characterization, recorded before the change)', () => {
  it('whole-session deload', () => {
    expect(figuresOf(buildWholeSessionDeloadPrescription(FIX.signals.normal, 'r')))
      .toEqual({ estimatedSessionDurationMin: 19, weeklyVolumeContribution: { chest: 2, triceps: 3, back: 2, biceps: 3 } })
    expect(figuresOf(buildWholeSessionDeloadPrescription(FIX.signals.allStyled, 'r')))
      .toEqual({ estimatedSessionDurationMin: 13, weeklyVolumeContribution: { chest: 2, triceps: 1, back: 2, biceps: 3 } })
  })

  it('program as written, and the rules fallback in a deload phase', () => {
    expect(figuresOf(buildProgramAsWrittenPrescription(FIX.signals.normal, 'r')!))
      .toEqual({ estimatedSessionDurationMin: 23, weeklyVolumeContribution: { chest: 4, triceps: 2, back: 3, biceps: 4.5 } })
    expect(figuresOf(buildRulesPrescription(FIX.signals.deloadPhase, 'r')!))
      .toEqual({ estimatedSessionDurationMin: 19, weeklyVolumeContribution: { chest: 2, triceps: 3, back: 2, biceps: 3 } })
  })

  it.each([
    ['short', 34, { chest: 4, triceps: 5, back: 4, biceps: 6 }],
    ['standard', 37, { chest: 4, triceps: 5, back: 4, biceps: 6 }],
    ['long', 47, { chest: 6, triceps: 7, back: 5, biceps: 6.5 }],
  ] as const)('budget stage, %s day', (preset, min, volume) => {
    const res = applyBudgetStage(FIX.stage, FIX.signals.normal, 60, preset, new Set(['se-1']))
    expect(figuresOf(res)).toEqual({ estimatedSessionDurationMin: min, weeklyVolumeContribution: volume })
    expect('fullSession' in res).toBe(false)
  })

  it('budget stage on a tight budget', () => {
    const res = applyBudgetStage(FIX.stage, FIX.signals.tight, 60, 'standard', new Set(['se-1']))
    expect(figuresOf(res)).toEqual({ estimatedSessionDurationMin: 25, weeklyVolumeContribution: { chest: 4, triceps: 4, back: 2, biceps: 3 } })
  })
})

describe('no fullSession where Full changes nothing — those prescriptions store exactly what they did', () => {
  it('the program as written and a non-deload rules plan carry none', () => {
    expect('fullSession' in buildProgramAsWrittenPrescription(FIX.signals.normal, 'r')!).toBe(false)
    expect('fullSession' in buildRulesPrescription(FIX.signals.normal, 'r')!).toBe(false)
  })

  it('the budget stage carries none with an empty map', () => {
    expect('fullSession' in applyBudgetStage(FIX.stage, FIX.signals.normal, 60, 'standard', new Set(), new Map())).toBe(false)
  })
})

describe('fullSession costs the session Full trains', () => {
  it('a whole-session deload with every exercise styled: Full trains the program as written, figure for figure', () => {
    const deload = buildWholeSessionDeloadPrescription(FIX.signals.allStyled, 'r')
    const written = buildProgramAsWrittenPrescription(FIX.signals.allStyled, 'r')!
    expect(deload.fullSession).toEqual(figuresOf(written))
    // And it is not the deload's own figure — the bug.
    expect(deload.fullSession!.estimatedSessionDurationMin).toBeGreaterThan(deload.estimatedSessionDurationMin)
  })

  it('an exercise with no recorded full numbers stays at its deload numbers inside the figure', () => {
    const deload = buildWholeSessionDeloadPrescription(FIX.signals.normal, 'r')
    // Skull Crusher has no style, so no preDeload: it keeps its 2 deload sets of triceps (main) on
    // top of Bench's 4 full sets of triceps (secondary, half weight).
    expect(deload.fullSession!.weeklyVolumeContribution.triceps).toBe(4)
    expect(deload.fullSession).toEqual(prescriptionFigures(deload.exercises.map(rowUnderFull), FIX.signals.normal))
  })

  it('the deload-phase rules fallback (#2512) carries it too', () => {
    const rules = buildRulesPrescription(FIX.signals.deloadPhase, 'r')!
    expect(rules.fullSession).toEqual(buildWholeSessionDeloadPrescription(FIX.signals.deloadPhase, 'r').fullSession)
  })

  it('the budget stage: a cut row at its recorded full numbers, every other row as staged', () => {
    const full = { sets: 4, reps: 12, pct: 65, restSec: 90 }
    const deloadedStage = FIX.stage.map(ex => ex.sessionExerciseId === 'se-3'
      ? { ...ex, sets: 2, reps: 15, pct: 50, restSec: 60 } : ex)
    const res = applyBudgetStage(deloadedStage, FIX.signals.normal, 60, 'standard', new Set(['se-1']), new Map([['se-3', full]]))
    // Curl trains only biceps (main), so its full 4 sets replace whatever the stage left the deload.
    expect(res.fullSession!.weeklyVolumeContribution.biceps)
      .toBe(res.weeklyVolumeContribution.biceps - res.sets.get('se-3')! + 4)
    expect(res.fullSession!.weeklyVolumeContribution.chest).toBe(res.weeklyVolumeContribution.chest)
    expect(res.fullSession!.estimatedSessionDurationMin).toBeGreaterThan(res.estimatedSessionDurationMin)
    // It is the shared helper over exactly those rows — no second costing.
    expect(res.fullSession!.estimatedSessionDurationMin).toBe(prescriptionFigures(
      deloadedStage.map(ex => ex.sessionExerciseId === 'se-3'
        ? { sessionExerciseId: 'se-3', ...full }
        : { ...ex, sets: res.sets.get(ex.sessionExerciseId)!, restSec: res.restSec.get(ex.sessionExerciseId)! }),
      FIX.signals.normal,
    ).estimatedSessionDurationMin)
  })

  it('hasFullSessionRevert needs a deloaded row WITH a record', () => {
    expect(hasFullSessionRevert([{ deloaded: true }])).toBe(false)
    expect(hasFullSessionRevert([{ deloaded: false, preDeload: { sets: 3, reps: 8, pct: 75, restSec: 120 } }])).toBe(false)
    expect(hasFullSessionRevert([{ deloaded: true, preDeload: { sets: 3, reps: 8, pct: 75, restSec: 120 } }])).toBe(true)
  })
})
