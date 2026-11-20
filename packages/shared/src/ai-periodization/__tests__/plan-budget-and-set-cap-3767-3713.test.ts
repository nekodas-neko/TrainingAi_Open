/**
 * #3767 — a workout plan names one time budget, the one it was fitted against, and its estimate
 *          never exceeds it; the model's own minutes are removed from the reasoning.
 * #3713 — a phase's set range is held in code: no exercise is prescribed, grown or earned past the
 *          phase's `setsMax` (owner, 19 Nov: inside the role ceiling, an earned set included, no
 *          week-to-week step limit).
 *
 * Production shapes, counts only: a 60-minute session (working budget 51, planned at 39 after the
 * lifter's margin) whose stored plan read "the 39-minute budget … to fit the 51-min working budget,
 * [an accessory] was dropped" while estimating itself at 32-39 min (#3767); a main lift that went
 * from 4 sets to 6 in accumulation, where `setsMax` is 5 (#3700, #3713).
 */
import { describe, it, expect } from 'vitest'
import { applyBudgetStage, reasoningWithBudgetNote, type BudgetStageExercise } from '@trainingai/shared/ai-periodization/budget-stage'
import { roleCeiling } from '@trainingai/shared/ai-periodization/role-plausibility'
import { phaseSetsMax, intensityZone } from '@trainingai/shared/ai-periodization/prompt'
import { allocateToBudget, applyRoleSetPlausibility } from '@trainingai/shared/ai-periodization/time-budget'
import { workingBudgetMin } from '@trainingai/shared/workout/duration-model'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'

interface Spec { id: string; name: string; role: string; reps: number; restSec: number }

const signalsFor = (specs: Spec[], goal: string, effectiveTimeBudgetMin: number, planningBudgetMin?: number) => ({
  trainingGoal: goal,
  effectiveTimeBudgetMin,
  ...(planningBudgetMin != null && { planningBudgetMin }),
  exercises: specs.map(sp => ({
    sessionExerciseId: sp.id,
    name: sp.name,
    role: sp.role,
    muscleAssignments: [{ muscle: `m-${sp.id}`, role: 'main' as const }],
    transitionSec: 240,
    timeProfile: null,
  })),
  weeklyTargets: Object.fromEntries(specs.map(sp => [`m-${sp.id}`, 16])),
  weeklyLogged: {},
}) as unknown as PrescriptionSignals

const stage = (specs: Spec[], sets: Record<string, number> | number): BudgetStageExercise[] =>
  specs.map(sp => ({
    sessionExerciseId: sp.id, name: sp.name,
    sets: typeof sets === 'number' ? sets : sets[sp.id], reps: sp.reps, pct: 72.5, restSec: sp.restSec,
  }))

const SIX: Spec[] = [
  { id: 'squat', name: 'Squat', role: 'primary', reps: 5, restSec: 180 },
  { id: 'rdl', name: 'RDL', role: 'secondary', reps: 8, restSec: 120 },
  { id: 'press', name: 'Leg Press', role: 'accessory', reps: 10, restSec: 90 },
  { id: 'curl', name: 'Leg Curl', role: 'accessory', reps: 12, restSec: 90 },
  { id: 'ext', name: 'Leg Extension', role: 'accessory', reps: 12, restSec: 90 },
  { id: 'calf', name: 'Calf Raise', role: 'accessory', reps: 15, restSec: 60 },
]

describe('#3767 — one time budget, and an estimate that fits it', () => {
  const WORKING = workingBudgetMin(60) // 51 on a 60-minute session
  const PLANNING = 39 // the stored plan's model sentence named this one

  it('the 60-minute session works out to the 51-minute working budget in the issue', () => {
    expect(WORKING).toBe(51)
  })

  it('a plan that drops an exercise names the budget it was fitted against, not the working one', () => {
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', WORKING, PLANNING), 60, undefined, new Set(), undefined, 'accumulation')
    expect(res.droppedIds.size).toBeGreaterThan(0)
    expect(res.fittedBudgetMin).toBe(PLANNING)
    expect(res.budgetNote).toContain(`about ${PLANNING} min of work`)
    expect(res.budgetNote).not.toContain(`${WORKING}-min`)
    expect(res.budgetNote).not.toContain(`${WORKING} min`)
    // The estimate shown is the one the fit compared, so it is inside the named budget.
    expect(res.estimatedSessionDurationMin).toBeLessThanOrEqual(PLANNING)
    expect(res.budgetNote).not.toContain('expect to run over')
  })

  it('with no margin learned the fitted budget is the working budget, and the note says that one', () => {
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', 30), 60, undefined, new Set(), undefined, 'accumulation')
    expect(res.droppedIds.size).toBeGreaterThan(0)
    expect(res.fittedBudgetMin).toBe(30)
    expect(res.budgetNote).toContain('about 30 min of work (the session\'s time less warm-up)')
    expect(res.budgetNote).not.toContain('margin')
  })

  it('warns of an overrun against the fitted budget, not the larger working one', () => {
    // Two exercises cannot fit 10 planned minutes; the working budget (51) would hide that.
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', WORKING, 10), 60, undefined, new Set(), undefined, 'accumulation')
    expect(res.estimatedSessionDurationMin).toBeGreaterThan(10)
    expect(res.estimatedSessionDurationMin).toBeLessThan(WORKING)
    expect(res.budgetNote).toContain('against the 10 planned')
    // Inside the working budget at median pace: only a slower day runs over.
    expect(res.budgetNote).toContain('a slower-than-usual day may run over')
    expect(res.budgetNote).not.toContain('expect to run over')
  })

  it('says to expect an overrun once the median estimate is past the working budget too', () => {
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', 10, 8), 60, undefined, new Set(), undefined, 'accumulation')
    expect(res.estimatedSessionDurationMin).toBeGreaterThan(10)
    expect(res.budgetNote).toContain('against the 8 planned')
    expect(res.budgetNote).toContain('expect to run over')
  })

  it('names the planned figure rounded down, as the prompt gives it to the model', () => {
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', WORKING, 39.7), 60, undefined, new Set(), undefined, 'accumulation')
    expect(res.fittedBudgetMin).toBe(39)
    expect(res.budgetNote).toContain('about 39 min of work')
  })

  it('a session with no time limit states no budget at all', () => {
    const res = applyBudgetStage(stage(SIX, 3), signalsFor(SIX, 'strength', 0), 0, undefined, new Set(), undefined, 'accumulation')
    expect(res.fittedBudgetMin).toBe(0)
    expect(res.budgetNote).toBe('')
  })

  it('removes the model\'s sentence naming minutes and keeps the rest, then appends the code\'s note', () => {
    const model = 'Squat holds at 72.5% for a third accumulation week. Volume was adjusted to stay within the 39-minute budget.'
    const note = ' To keep today\'s plan to about 39 min of work, Calf Raise was dropped for today.'
    expect(reasoningWithBudgetNote(model, note))
      .toBe('Squat holds at 72.5% for a third accumulation week. To keep today\'s plan to about 39 min of work, Calf Raise was dropped for today.')
  })

  it('catches the spellings the model uses, and leaves rest in seconds alone', () => {
    for (const s of ['Fits in 45 min.', 'A 39-minute session.', 'Keeps it near 40 minutes!', 'About 51 mins of work.']) {
      expect(reasoningWithBudgetNote(s, '')).toBe('')
    }
    expect(reasoningWithBudgetNote('Rest 90 s between sets.', '')).toBe('Rest 90 s between sets.')
  })

  it('keeps the clause of a mixed sentence that says nothing about minutes', () => {
    expect(reasoningWithBudgetNote('Bench moves up 2.5% because RPE ran low, and volume stays inside a 39-minute plan.', ''))
      .toBe('Bench moves up 2.5% because RPE ran low.')
    expect(reasoningWithBudgetNote('Squat holds; the plan fits 40 min. Row adds a set.', ''))
      .toBe('Squat holds. Row adds a set.')
  })

  it('leaves no fragment: an abbreviation is not a sentence end, and a later clause opens with a capital', () => {
    expect(reasoningWithBudgetNote('Sets held at approx. 40 min of work. Row adds a set.', ''))
      .toBe('Row adds a set.')
    expect(reasoningWithBudgetNote('Volume fits a 39-minute plan, and the squat holds.', '')).toBe('The squat holds.')
  })

  it('keeps rest stated in minutes: that is a prescription, not the session\'s length', () => {
    expect(reasoningWithBudgetNote('Rest 3 minutes between heavy sets.', '')).toBe('Rest 3 minutes between heavy sets.')
  })

  it('with nothing to add and nothing removed, the reasoning is unchanged', () => {
    expect(reasoningWithBudgetNote('Steady week.', '')).toBe('Steady week.')
  })
})

describe('#3713 — the phase set range is held in code', () => {
  it('the role ceiling takes the phase maximum when it is lower, and only then', () => {
    expect(roleCeiling('primary')).toBe(6)
    expect(roleCeiling('primary', 5)).toBe(5)
    expect(roleCeiling('accessory', 5)).toBe(4)
    expect(roleCeiling('primary', null)).toBe(6)
  })

  it('reads the phase maximum from the one zone table', () => {
    expect(phaseSetsMax('strength', 'accumulation')).toBe(intensityZone('strength', 'accumulation').setsMax)
    expect(phaseSetsMax('strength', 'accumulation')).toBe(5)
    expect(phaseSetsMax('strength', null)).toBeNull()
  })

  const TWO: Spec[] = [
    { id: 'bench', name: 'Bench Press', role: 'primary', reps: 5, restSec: 180 },
    { id: 'fly', name: 'Cable Fly', role: 'accessory', reps: 12, restSec: 60 },
  ]

  it('the model\'s 6 sets on the main lift in accumulation become 5, with no time limit to trim them', () => {
    const res = applyBudgetStage(stage(TWO, { bench: 6, fly: 3 }), signalsFor(TWO, 'strength', 0), 0, undefined, new Set(), undefined, 'accumulation')
    expect(res.sets.get('bench')).toBe(5)
  })

  it('a roomy budget grows the main lift to the phase maximum, not the role ceiling', () => {
    const res = applyBudgetStage(stage(TWO, { bench: 4, fly: 2 }), signalsFor(TWO, 'strength', 200), 60, 'standard', new Set(), undefined, 'accumulation')
    expect(res.sets.get('bench')).toBe(5)
    expect(res.sets.get('fly')).toBe(4)
  })

  it('an earned set does not go past the phase maximum', () => {
    // A secondary at hypertrophy accumulation's maximum (4) earns one: it stays at 4. Its role
    // ceiling alone (5) would have let it through.
    const SEC: Spec[] = [
      { id: 'squat', name: 'Squat', role: 'primary', reps: 8, restSec: 150 },
      { id: 'row', name: 'Row', role: 'secondary', reps: 10, restSec: 90 },
    ]
    const res = applyBudgetStage(stage(SEC, { squat: 4, row: 5 }), signalsFor(SEC, 'hypertrophy', 200), 60, 'standard', new Set(['row']), undefined, 'accumulation')
    expect(res.sets.get('row')).toBe(4)
    expect(res.sets.get('squat')).toBe(4)
  })

  it('the allocator never starts a lift above the phase maximum, even its 3-set main-lift minimum', () => {
    const res = allocateToBudget(
      [{ sessionExerciseId: 'a', role: 'primary', sets: 4, reps: 15, restSec: 60, transitionSec: 240 }],
      200,
      { phaseSetsMax: 2 },
    )
    expect(res.exercises[0].sets).toBe(2)
  })

  it('a known phase is required: without one only the role ceiling applies', () => {
    const out = applyRoleSetPlausibility([{ sessionExerciseId: 'a', role: 'primary', sets: 6, reps: 5, restSec: 180, transitionSec: 240 }])
    expect(out[0].sets).toBe(6)
  })
})
