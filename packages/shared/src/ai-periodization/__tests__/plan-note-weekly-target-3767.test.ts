/**
 * #3767 (owner, 22 Nov, option A) — the plan's note says which muscle groups the session leaves under
 * their weekly target. Code writes the sentence; no prescribed number moves.
 *
 * The stage knows the sets logged so far this week and this session's own planned sets. It does not
 * know the week's other plans or which days are left, so the sentence makes no claim about either; it
 * says when it was true ("When this plan was made"), because a plan is served for up to 7 days.
 */
import { describe, it, expect } from 'vitest'
import { applyBudgetStage, reasoningWithBudgetNote, type BudgetStageExercise } from '@trainingai/shared/ai-periodization/budget-stage'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'

const MUSCLES = ['chest', 'back', 'quads', 'hamstrings', 'glutes', 'shoulders'] as const
const ROLES = ['primary', 'secondary', 'accessory', 'accessory', 'accessory', 'accessory']

const exercises = (): BudgetStageExercise[] =>
  MUSCLES.map((m, i) => ({ sessionExerciseId: `ex-${m}`, name: `Lift ${i}`, sets: 3, reps: 10, pct: 72.5, restSec: 90 }))

interface Opts {
  targets?: Record<string, number>
  logged?: Record<string, number>
  budget?: number
  phase?: string
}

const signalsFor = (o: Opts = {}) => ({
  trainingGoal: 'hypertrophy',
  effectiveTimeBudgetMin: o.budget ?? 600,
  phase: o.phase ?? 'accumulation',
  exercises: MUSCLES.map((m, i) => ({
    sessionExerciseId: `ex-${m}`,
    name: `Lift ${i}`,
    role: ROLES[i],
    muscleAssignments: [{ muscle: m, role: 'main' as const }],
    transitionSec: 60,
    timeProfile: null,
  })),
  weeklyTargets: o.targets ?? {},
  weeklyLogged: o.logged ?? {},
}) as unknown as PrescriptionSignals

const run = (o: Opts = {}) => {
  const budget = o.budget ?? 600
  return applyBudgetStage(exercises(), signalsFor(o), budget === 0 ? 0 : 60, undefined, new Set(), undefined, o.phase ?? 'accumulation')
}

/** Targets that sit exactly `gap` sets above what this session plans for each muscle (negative: below). */
const targetsFrom = (gaps: Partial<Record<(typeof MUSCLES)[number], number>>, planned: Record<string, number>) =>
  Object.fromEntries(MUSCLES.map(m => [m, (planned[m] ?? 0) + (gaps[m] ?? 0)]))

const sentence = (note: string) => note.match(/When this plan was made[^.]*\./)?.[0] ?? ''

describe('#3767 — the plan names the muscle groups it leaves under their weekly target', () => {
  const planned = run().weeklyVolumeContribution

  it('sanity: the fixture plans sets for every muscle', () => {
    for (const m of MUSCLES) expect(planned[m]).toBeGreaterThan(0)
  })

  it('one group under: "was under its weekly target"', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, chest was under its weekly target.')
  })

  it('two under: "A and B were", furthest under first', () => {
    const res = run({ targets: targetsFrom({ chest: 2, hamstrings: 5 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, hamstrings and chest were under their weekly target.')
  })

  it('exactly three under: "A, B and C were", all named, no "more"', () => {
    const res = run({ targets: targetsFrom({ chest: 2, back: 6, quads: 4 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, back, quads and chest were under their weekly target.')
  })

  it('more than three under: three named, the furthest under first, the rest counted', () => {
    const res = run({ targets: targetsFrom({ chest: 2, back: 6, quads: 4, hamstrings: 3, glutes: 8 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, glutes, back, quads and 2 more were under their weekly target.')
  })

  it('ties are broken by name', () => {
    const res = run({ targets: targetsFrom({ quads: 3, back: 3, glutes: 3 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, back, glutes and quads were under their weekly target.')
  })

  it('makes no claim about sessions left', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned) })
    expect(res.budgetNote).not.toMatch(/left|remaining|after this session/i)
  })

  it('one over and one under: only the under one is named', () => {
    const res = run({ targets: targetsFrom({ chest: -4, back: 3 }, planned) })
    expect(sentence(res.budgetNote)).toBe('When this plan was made, back was under its weekly target.')
  })

  it('counts the sets already done this week', () => {
    // Target is 4 above this session's plan, but 4 sets are already logged: not under.
    const res = run({ targets: targetsFrom({ chest: 4 }, planned), logged: { chest: 4 } })
    expect(sentence(res.budgetNote)).toBe('')
  })

  it('a shortfall under one whole set is rounding, not a shortfall', () => {
    expect(sentence(run({ targets: targetsFrom({ chest: 0.5 }, planned) }).budgetNote)).toBe('')
  })

  it('none under: no sentence', () => {
    expect(run({ targets: targetsFrom({}, planned) }).budgetNote).toBe('')
  })

  it('a muscle the session does not train is not named', () => {
    const res = run({ targets: { ...targetsFrom({}, planned), calves: 12 } })
    expect(res.budgetNote).toBe('')
  })

  it('a muscle whose only exercise was dropped is named, and the same text says that exercise was dropped', () => {
    // Every group far under: the dropped one plans no sets, so it is the furthest under and comes first.
    const targets = Object.fromEntries(MUSCLES.map(m => [m, 30]))
    const res = run({ budget: 15, targets })
    expect(res.droppedIds.size).toBeGreaterThan(0)
    const dropped = [...res.droppedIds].map(id => id.replace('ex-', ''))
    expect(dropped.length).toBeLessThanOrEqual(3)
    for (const muscle of dropped) {
      expect(res.weeklyVolumeContribution[muscle] ?? 0).toBe(0)
      const name = `Lift ${MUSCLES.indexOf(muscle as (typeof MUSCLES)[number])}`
      // The drop note, in the same text, names the exercise...
      expect(res.budgetNote).toMatch(new RegExp(`${name}\\b.*dropped for today`))
      // ...and the sentence names its muscle: it plans no sets, so it is among the furthest under.
      expect(sentence(res.budgetNote)).toContain(muscle)
    }
  })

  it('no time limit and nothing cut: no sentence', () => {
    const noLimit = run({ budget: 0 })
    const res = run({ budget: 0, targets: targetsFrom({ chest: 3 }, noLimit.weeklyVolumeContribution) })
    expect(res.fittedBudgetMin).toBe(0)
    expect(res.budgetNote).toBe('')
  })

  it('a deload or baseline session: no sentence', () => {
    for (const phase of ['deload', 'baseline']) {
      expect(run({ phase, targets: targetsFrom({ chest: 3 }, planned) }).budgetNote).toBe('')
    }
  })

  it('unknown targets: no sentence', () => {
    expect(run({ targets: {} }).budgetNote).toBe('')
  })

  it('stays one short sentence even with the longest names and the most groups', () => {
    const long = run({ targets: targetsFrom({ hamstrings: 9, glutes: 8, quads: 7, back: 6, chest: 5 }, planned) })
    expect(sentence(long.budgetNote).length).toBeLessThanOrEqual(115)
    expect(sentence(long.budgetNote)).toBe('When this plan was made, hamstrings, glutes, quads and 2 more were under their weekly target.')
  })

  it("is code-owned: the minutes filter leaves it alone, and it follows the model's text", () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned) })
    const text = reasoningWithBudgetNote('Squat holds. Fits 39 minutes, because rest is short.', res.budgetNote)
    expect(text).toBe('Squat holds. When this plan was made, chest was under its weekly target.')
  })

  it('the minutes filter keeps the sentence when the model also names minutes in the same text', () => {
    const res = run({ budget: 15, targets: targetsFrom({ chest: 5, back: 5 }, planned) })
    const text = reasoningWithBudgetNote('Fits the 39-minute budget. Volume holds.', res.budgetNote)
    expect(text.startsWith('Volume holds.')).toBe(true)
    expect(text).toContain(sentence(res.budgetNote))
  })

  // The whole stored plan, not just the note's neighbours. `GOLDEN` is what `main` (before this
  // sentence existed) returned for these fixtures, with groups under target. The weekly targets steer
  // the fit's ordering, so a cut session cannot be compared against a run with different targets;
  // it is compared against `main`'s own answer instead, and the roomy session (no cut, no steering)
  // also against a run with empty targets.
  describe('changes the note only', () => {
    const GOLDEN: Record<number, unknown> = {
      15: {
        sets: {
          'ex-chest': 3,
          'ex-back': 2,
          'ex-quads': 3,
          'ex-hamstrings': 3,
          'ex-glutes': 2,
          'ex-shoulders': 3
        },
        restSec: {
          'ex-chest': 90,
          'ex-back': 90,
          'ex-quads': 90,
          'ex-hamstrings': 90,
          'ex-glutes': 90,
          'ex-shoulders': 90
        },
        droppedIds: [
          'ex-shoulders',
          'ex-hamstrings',
          'ex-quads'
        ],
        estimatedSessionDurationMin: 14,
        weeklyVolumeContribution: {
          chest: 3,
          back: 2,
          glutes: 2
        },
        fittedBudgetMin: 15
      },
      25: {
        sets: {
          'ex-chest': 4,
          'ex-back': 2,
          'ex-quads': 2,
          'ex-hamstrings': 2,
          'ex-glutes': 2,
          'ex-shoulders': 3
        },
        restSec: {
          'ex-chest': 90,
          'ex-back': 90,
          'ex-quads': 90,
          'ex-hamstrings': 90,
          'ex-glutes': 90,
          'ex-shoulders': 90
        },
        droppedIds: [
          'ex-shoulders'
        ],
        estimatedSessionDurationMin: 25,
        weeklyVolumeContribution: {
          chest: 4,
          back: 2,
          quads: 2,
          hamstrings: 2,
          glutes: 2
        },
        fittedBudgetMin: 25
      },
      40: {
        sets: {
          'ex-chest': 4,
          'ex-back': 4,
          'ex-quads': 3,
          'ex-hamstrings': 2,
          'ex-glutes': 3,
          'ex-shoulders': 2
        },
        restSec: {
          'ex-chest': 90,
          'ex-back': 90,
          'ex-quads': 90,
          'ex-hamstrings': 90,
          'ex-glutes': 90,
          'ex-shoulders': 90
        },
        droppedIds: [],
        estimatedSessionDurationMin: 38,
        weeklyVolumeContribution: {
          chest: 4,
          back: 4,
          quads: 3,
          hamstrings: 2,
          glutes: 3,
          shoulders: 2
        },
        fittedBudgetMin: 40
      },
      600: {
        sets: {
          'ex-chest': 4,
          'ex-back': 4,
          'ex-quads': 4,
          'ex-hamstrings': 4,
          'ex-glutes': 4,
          'ex-shoulders': 4
        },
        restSec: {
          'ex-chest': 90,
          'ex-back': 90,
          'ex-quads': 90,
          'ex-hamstrings': 90,
          'ex-glutes': 90,
          'ex-shoulders': 90
        },
        droppedIds: [],
        estimatedSessionDurationMin: 52,
        weeklyVolumeContribution: {
          chest: 4,
          back: 4,
          quads: 4,
          hamstrings: 4,
          glutes: 4,
          shoulders: 4
        },
        fittedBudgetMin: 600
      }
    }
    const plan = (r: ReturnType<typeof run>) => {
      const { budgetNote: _note, ...rest } = r
      return { ...rest, sets: Object.fromEntries(r.sets), restSec: Object.fromEntries(r.restSec), droppedIds: [...r.droppedIds] }
    }
    for (const budget of [600, 15, 25, 40]) {
      it(`${budget === 600 ? 'a roomy' : `a ${budget}-minute`} session: with groups under target the stored plan equals main's, apart from the note`, () => {
        const base = run({ budget })
        const under = run({ budget, targets: targetsFrom({ chest: 3, back: 6, quads: 4, hamstrings: 3, glutes: 8 }, base.weeklyVolumeContribution) })
        expect(under.budgetNote).toContain('When this plan was made')
        expect(plan(under)).toEqual(GOLDEN[budget])
      })
    }

    it('a roomy session: empty targets give the same plan, and no sentence', () => {
      const base = run({ budget: 600 })
      const under = run({ budget: 600, targets: targetsFrom({ chest: 3, back: 6, quads: 4, hamstrings: 3, glutes: 8 }, base.weeklyVolumeContribution) })
      const empty = run({ budget: 600, targets: {} })
      expect(empty.budgetNote).toBe('')
      expect(plan(under)).toEqual(plan(empty))
    })
  })
})
