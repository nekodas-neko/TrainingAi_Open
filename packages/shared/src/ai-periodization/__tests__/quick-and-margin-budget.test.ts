/**
 * The budget stage after the Quick-and-deload batch (#2132, #2078, #2284), run end to end through
 * `applyBudgetStage` — the function both a generation and a no-model re-fit call.
 */
import { describe, it, expect } from 'vitest'
import { applyBudgetStage, type BudgetStageExercise } from '@trainingai/shared/ai-periodization/budget-stage'
import { estimateSessionDurationSec, setWorkSec } from '@trainingai/shared/workout/duration-model'
import type { ExerciseTimeProfile } from '@trainingai/shared/workout/time-profile'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'

interface Spec { id: string; name: string; role: string; reps: number; restSec: number; profile?: ExerciseTimeProfile }

const signalsFor = (specs: Spec[], effectiveTimeBudgetMin: number, planningBudgetMin?: number) => ({
  trainingGoal: 'hypertrophy',
  effectiveTimeBudgetMin,
  ...(planningBudgetMin != null && { planningBudgetMin }),
  exercises: specs.map(sp => ({
    sessionExerciseId: sp.id,
    name: sp.name,
    role: sp.role,
    muscleAssignments: [{ muscle: `m-${sp.id}`, role: 'main' as const }],
    transitionSec: 319,
    timeProfile: sp.profile ?? null,
  })),
  weeklyTargets: Object.fromEntries(specs.map(sp => [`m-${sp.id}`, 16])),
  weeklyLogged: {},
}) as unknown as PrescriptionSignals

const stage = (specs: Spec[], sets: number): BudgetStageExercise[] =>
  specs.map(sp => ({ sessionExerciseId: sp.id, name: sp.name, sets, reps: sp.reps, pct: 70, restSec: sp.restSec }))

// The owner's Pull as #2078 reconstructed it: five exercises at two sets, rests 180/127/90/90/90,
// his measured 319 s per gap.
const PULL: Spec[] = [
  { id: 'row', name: 'Barbell Chest Supported Row', role: 'primary', reps: 6, restSec: 180 },
  { id: 'pulldown', name: 'Lat Pulldown', role: 'secondary', reps: 8, restSec: 127 },
  { id: 'curl', name: 'Curl', role: 'accessory', reps: 8, restSec: 90 },
  { id: 'facepull', name: 'Face Pull', role: 'accessory', reps: 10, restSec: 90 },
  { id: 'reardelt', name: 'Rear Delt Fly', role: 'accessory', reps: 10, restSec: 90 },
]

describe('#2078 — Quick on Pull keeps a session, not one movement', () => {
  it('the inputs reproduce the card the owner saw, and the corrected estimate drops 15 minutes', () => {
    const plan = PULL.map(sp => ({ sets: 2, reps: sp.reps, restSec: sp.restSec, transitionSec: 319 }))
    // As shipped: a rest after every set and a gap before every exercise — the 53 on his card.
    const asShipped = plan.reduce((t, ex) => t + ex.sets * setWorkSec(ex.reps) + ex.sets * ex.restSec + ex.transitionSec, 0)
    expect(asShipped / 60).toBeCloseTo(53.1, 1)
    expect(estimateSessionDurationSec(plan)).toBe(asShipped - (180 + 127 + 90 + 90 + 90) - 319)
  })

  it('keeps three of five at a 24-minute working budget, the main lift among them', () => {
    const res = applyBudgetStage(stage(PULL, 2), signalsFor(PULL, 24), 60, 'short', new Set())
    expect(res.droppedIds.size).toBe(2)
    expect(res.droppedIds.has('row')).toBe(false)
    expect(res.estimatedSessionDurationMin).toBeLessThanOrEqual(24)
    expect(res.budgetNote).toContain('dropped for today')
    expect(res.budgetNote).not.toContain('expect to run over')
  })

  it('never returns fewer than two, and says it will run over when two do not fit', () => {
    const res = applyBudgetStage(stage(PULL, 2), signalsFor(PULL, 5), 60, 'short', new Set())
    expect(PULL.length - res.droppedIds.size).toBe(2)
    expect(res.budgetNote).toContain('expect to run over')
  })
})

describe('#2284 — a shorter day shortens accessory and secondary rest, never the main lift', () => {
  // A long budget so nothing is trimmed: the only difference between the two runs is the rest.
  const roomy = (preset: number | undefined) =>
    applyBudgetStage(stage(PULL, 3), signalsFor(PULL, 200), 120, preset, new Set())

  it('prescribes the shortened rest, and only on a shorter day', () => {
    const short = roomy(90)
    expect(Object.fromEntries(short.restSec)).toEqual({ row: 180, pulldown: 95, curl: 70, facepull: 70, reardelt: 70 })
    expect(short.budgetNote).toContain('cut by a quarter')
    const standard = roomy(undefined)
    expect(Object.fromEntries(standard.restSec)).toEqual({ row: 180, pulldown: 127, curl: 90, facepull: 90, reardelt: 90 })
    expect(standard.budgetNote).not.toContain('cut by a quarter')
  })

  it('buys back the time it saves — 2 rests each on four exercises', () => {
    const saved = 2 * ((127 - 95) + 3 * (90 - 70))
    const diffMin = roomy(undefined).estimatedSessionDurationMin - roomy(90).estimatedSessionDurationMin
    expect(diffMin).toBe(Math.round(saved / 60))
  })

  it('scales a MEASURED rest by the same ratio, or the fit would never see the saving', () => {
    const profile: ExerciseTimeProfile = {
      secPerRep: null, secPerRepSamples: 0,
      restSecByBand: { light: null, moderate: 120, heavy: null, max: null },
      restSamplesByBand: { light: 0, moderate: 20, heavy: 0, max: 0 },
      restSecOverall: 120, restSamplesOverall: 20,
    }
    // He rests 120 s on a 90 s accessory. On a shorter day the plan expects 120 × 70/90 ≈ 93 s.
    const specs: Spec[] = [
      { id: 'row', name: 'Row', role: 'primary', reps: 6, restSec: 180 },
      { id: 'curl', name: 'Curl', role: 'accessory', reps: 10, restSec: 90, profile },
    ]
    const run = (preset: number | undefined) =>
      applyBudgetStage(stage(specs, 4), signalsFor(specs, 200), 120, preset, new Set())
    const work = 4 * setWorkSec(6) + 3 * 180 + 4 * setWorkSec(10) + 319
    expect(run(undefined).estimatedSessionDurationMin).toBe(Math.round((work + 3 * 120) / 60))
    expect(run(90).estimatedSessionDurationMin).toBe(Math.round((work + 3 * (120 * 70 / 90)) / 60))
  })
})

describe('#2132 — the p75 margin decides the fit; the working budget is what the lifter is shown', () => {
  const FIVE: Spec[] = [
    { id: 'squat', name: 'Squat', role: 'primary', reps: 5, restSec: 180 },
    { id: 'rdl', name: 'RDL', role: 'secondary', reps: 8, restSec: 120 },
    { id: 'press', name: 'Leg Press', role: 'accessory', reps: 10, restSec: 90 },
    { id: 'curl', name: 'Leg Curl', role: 'accessory', reps: 12, restSec: 90 },
    { id: 'calf', name: 'Calf Raise', role: 'accessory', reps: 15, restSec: 60 },
  ]
  const total = (sets: Map<string, number>) => [...sets.values()].reduce((a, b) => a + b, 0)

  it('keeps every third set at the median, and some — not all — at his 75th percentile', () => {
    const atMedian = applyBudgetStage(stage(FIVE, 3), signalsFor(FIVE, 55), 60, undefined, new Set())
    expect(total(atMedian.sets)).toBe(15)
    const withMargin = applyBudgetStage(stage(FIVE, 3), signalsFor(FIVE, 55, 55 / 1.2), 60, undefined, new Set())
    expect(total(withMargin.sets)).toBeGreaterThan(10)
    expect(total(withMargin.sets)).toBeLessThan(15)
    // The estimate stays the honest median one, and is inside the budget he sees — so no overrun note.
    expect(withMargin.estimatedSessionDurationMin).toBeLessThanOrEqual(55 / 1.2 + 0.5)
    expect(withMargin.budgetNote).toBe('')
  })
})
