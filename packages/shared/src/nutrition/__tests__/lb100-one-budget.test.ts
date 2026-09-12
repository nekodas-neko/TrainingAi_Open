/**
 * LB-100 — every surface counts against ONE budget.
 *
 * BF-150 anchored `budgetProvenance` to the stored goal and left `computeCalorieBalance`'s deviation
 * on the old expression, so Home's donut counted against `goal + earned` while the Nutrition ring's
 * "N kcal left" counted against `restingBase + goalDelta + earned`. `one-calorie-budget.spec.ts`
 * caught it on BF-150's own pre-merge run; E2E is advisory, so it merged red.
 *
 * The property is arithmetic and belongs here, where it runs on every commit rather than only when
 * a browser job is green. Q-415/Q-417 fixed this class once before.
 */
import { describe, it, expect } from 'vitest'
import { computeCalorieBalance, budgetProvenance } from '../calorie-balance'

// The e2e fixture's own figures, which is where this was caught.
const FIXTURE = { restingBaseKcal: 2069, activeKcal: 714, intakeKcal: 1200, goalDeltaKcal: 300 }

describe('remainingKcal counts against the same budget budgetProvenance reports', () => {
  it.each([
    { name: 'anchored to a stored goal', goalKcal: 1900 },
    { name: 'anchored to a goal below resting burn', goalKcal: 1350 },
    { name: 'no stored goal — the old expression still governs', goalKcal: null },
  ])('$name', ({ goalKcal }) => {
    const b = computeCalorieBalance({ ...FIXTURE, goalKcal })
    const budget = budgetProvenance({ ...FIXTURE, targetNetKcal: b.targetNetKcal, goalKcal }).total
    expect(b.remainingKcal).toBe(budget - Math.round(FIXTURE.intakeKcal))
  })

  // The regression in one line: with a goal 469 kcal below the old expression, the two must not
  // drift apart. Before the fix `remainingKcal` was 469 higher than the donut's budget allowed.
  it('does not leave the ring 469 kcal adrift of the donut', () => {
    const anchored = computeCalorieBalance({ ...FIXTURE, goalKcal: 1900 })
    const unanchored = computeCalorieBalance({ ...FIXTURE, goalKcal: null })
    expect(unanchored.remainingKcal - anchored.remainingKcal).toBe(469)
  })

  // The zone label and colour come off the same deviation, so they follow the budget too — a card
  // reading "Goal reached" against a budget it is not counting against is the Q-417 shape.
  it('bands the day against the anchored budget, not the estimator', () => {
    // 3,000 eaten: 386 over the anchored budget (2,614), 83 UNDER the old one (3,083). The bands
    // are ±150 on target and ±400 outside it, so the same day reads "over" against the budget the
    // donut shows and "on target" against the expression the ring used — a card calling a 386 kcal
    // overshoot fine is the Q-417 shape, and this is the case that separates them.
    const day = computeCalorieBalance({ ...FIXTURE, intakeKcal: 3000, goalKcal: 1900 })
    expect(day.deviationKcal).toBe(3000 - (1900 + 714))
    expect(day.zone).toBe('over')
    expect(computeCalorieBalance({ ...FIXTURE, intakeKcal: 3000, goalKcal: null }).zone).toBe('on_target')
  })

  it('leaves expenditure and net alone — they measure burn, not budget', () => {
    const a = computeCalorieBalance({ ...FIXTURE, goalKcal: 1900 })
    const b = computeCalorieBalance({ ...FIXTURE, goalKcal: null })
    expect(a.expenditureKcal).toBe(b.expenditureKcal)
    expect(a.netKcal).toBe(b.netKcal)
  })
})
