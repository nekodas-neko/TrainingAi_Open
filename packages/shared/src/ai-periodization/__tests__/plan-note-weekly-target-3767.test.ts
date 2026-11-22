/**
 * #3767 (owner, 22 Nov, option A) — the plan's note says which muscle groups the session leaves under
 * their weekly target. Code writes the sentence; no prescribed number moves.
 *
 * The stage knows the sets logged so far this week and this session's own planned sets, so the
 * sentence is about "after this session" and the sessions left, never a whole-week planned figure.
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
  sessionsLeft?: number | undefined
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
  ...('sessionsLeft' in o ? { sessionsLeftThisWeek: o.sessionsLeft } : { sessionsLeftThisWeek: 3 }),
}) as unknown as PrescriptionSignals

const run = (o: Opts = {}) => {
  const budget = o.budget ?? 600
  return applyBudgetStage(exercises(), signalsFor(o), budget === 0 ? 0 : 60, undefined, new Set(), undefined, o.phase ?? 'accumulation')
}

/** Targets that sit exactly `gap` sets above what this session plans for each muscle (negative: below). */
const targetsFrom = (gaps: Partial<Record<(typeof MUSCLES)[number], number>>, planned: Record<string, number>) =>
  Object.fromEntries(MUSCLES.map(m => [m, (planned[m] ?? 0) + (gaps[m] ?? 0)]))

const sentence = (note: string) => note.match(/After this session[^.]*\./)?.[0] ?? ''

describe('#3767 — the plan names the muscle groups it leaves under their weekly target', () => {
  const planned = run().weeklyVolumeContribution

  it('sanity: the fixture plans sets for every muscle', () => {
    for (const m of MUSCLES) expect(planned[m]).toBeGreaterThan(0)
  })

  it('one group under: names it and the sessions left after this one', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned), sessionsLeft: 3 })
    expect(sentence(res.budgetNote)).toBe('After this session, chest is still under target this week, with 2 sessions left.')
  })

  it('says "1 session left" in the singular', () => {
    const res = run({ targets: targetsFrom({ chest: 2 }, planned), sessionsLeft: 2 })
    expect(sentence(res.budgetNote)).toContain('with 1 session left.')
  })

  it('two under: joined with "and", furthest under first', () => {
    const res = run({ targets: targetsFrom({ chest: 2, hamstrings: 5 }, planned) })
    expect(sentence(res.budgetNote)).toBe('After this session, hamstrings and chest are still under target this week, with 2 sessions left.')
  })

  it('several under: three named, the furthest under first, the rest counted', () => {
    const res = run({ targets: targetsFrom({ chest: 2, back: 6, quads: 4, hamstrings: 3, glutes: 8 }, planned) })
    expect(sentence(res.budgetNote)).toBe('After this session, glutes, back, quads and 2 more are still under target this week, with 2 sessions left.')
  })

  it('exactly three under are all named, with no "more"', () => {
    const res = run({ targets: targetsFrom({ chest: 2, back: 6, quads: 4 }, planned) })
    expect(sentence(res.budgetNote)).toBe('After this session, back, quads and chest are still under target this week, with 2 sessions left.')
  })

  it('one over and one under: only the under one is named', () => {
    const res = run({ targets: targetsFrom({ chest: -4, back: 3 }, planned) })
    expect(sentence(res.budgetNote)).toBe('After this session, back is still under target this week, with 2 sessions left.')
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

  it('the last session of the week: "with no sessions left"', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned), sessionsLeft: 1 })
    expect(sentence(res.budgetNote)).toBe('After this session, chest is still under target this week, with no sessions left.')
  })

  it('an unknown count of sessions leaves the tail off', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned), sessionsLeft: undefined })
    expect(sentence(res.budgetNote)).toBe('After this session, chest is still under target this week.')
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
    expect(sentence(long.budgetNote)).toMatch(/^After this session, [a-z, ]+ and 2 more are still under target this week, with 2 sessions left\.$/)
  })

  it('is code-owned: the minutes filter never touches it, and it follows the model\'s text', () => {
    const res = run({ targets: targetsFrom({ chest: 3 }, planned) })
    const text = reasoningWithBudgetNote('Squat holds. Fits 39 minutes, because rest is short.', res.budgetNote)
    expect(text).toBe(`Squat holds.${res.budgetNote}`)
    expect(text).toContain('with 2 sessions left.')
  })

  it('changes the note only: the stored plan is identical with and without groups under target', () => {
    const none = run({ targets: targetsFrom({}, planned) })
    const some = run({ targets: targetsFrom({ chest: 3, back: 6, quads: 4, hamstrings: 3, glutes: 8 }, planned) })
    expect(some.budgetNote).not.toBe(none.budgetNote)
    // Same sets, rest, drops, estimate, weekly contribution: only the note text differs.
    expect({ ...some, budgetNote: '' }).toEqual({ ...none, budgetNote: '' })
  })

  it('on a cut session the plan does not depend on the sentence: only the note differs', () => {
    // A tight budget drops and trims, so the fit is really exercised. Same targets and logged sets
    // (they feed the fit), a different count of sessions left (read by the sentence alone).
    const targets = targetsFrom({ chest: 5, back: 5 }, planned)
    const a = run({ budget: 15, targets, sessionsLeft: 3 })
    const b = run({ budget: 15, targets, sessionsLeft: 1 })
    const c = run({ budget: 15, targets, sessionsLeft: undefined })
    expect(a.droppedIds.size).toBeGreaterThan(0)
    expect(a.budgetNote).not.toBe(b.budgetNote)
    expect({ ...b, budgetNote: '' }).toEqual({ ...a, budgetNote: '' })
    expect({ ...c, budgetNote: '' }).toEqual({ ...a, budgetNote: '' })
    // And the sentence is there on a cut session, after the code's own drop note.
    expect(a.budgetNote).toMatch(/dropped for today.* After this session, .* still under target this week, with 2 sessions left\.$/)
  })
})
