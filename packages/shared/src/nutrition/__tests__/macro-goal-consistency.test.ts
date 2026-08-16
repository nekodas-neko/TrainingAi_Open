import { describe, it, expect } from 'vitest'
import {
  caloriesFromMacros, carbsFromRemainder, reconcileDailyMacros,
  MACRO_GOAL_TOLERANCE_KCAL, MACRO_RECONCILE_TOLERANCE_KCAL,
} from '../goal-recommendation'

/**
 * The four nutrition targets are independent fields and nothing ever made them agree.
 * These pin the arithmetic the editor now shows, and the relationship between showing a gap and
 * the read-path reconciliation that has to keep guarding rows which already drifted.
 */

describe('caloriesFromMacros', () => {
  // The seeded account, and the reason every meal plan built from it read "over by 110 kcal".
  it('exposes the real 110 kcal disagreement on the seeded targets', () => {
    expect(caloriesFromMacros({ proteinG: 150, carbsG: 180, fatG: 60 })).toBe(1860)
    expect(1860 - 1750).toBe(110)
  })

  it('uses Atwater factors', () => {
    expect(caloriesFromMacros({ proteinG: 10, carbsG: 10, fatG: 10 })).toBe(4 * 10 + 4 * 10 + 9 * 10)
  })
})

describe('the one-tap fix', () => {
  it('makes the four numbers agree', () => {
    const goal = 1750
    const carbsG = carbsFromRemainder(goal, 150, 60)
    expect(Math.abs(caloriesFromMacros({ proteinG: 150, carbsG, fatG: 60 }) - goal))
      .toBeLessThanOrEqual(MACRO_GOAL_TOLERANCE_KCAL)
  })

  // Protein and fat are the ones people set on purpose; carbs are conventionally the remainder,
  // which is what calculateBaseline already does.
  it('changes only carbohydrate', () => {
    const carbsG = carbsFromRemainder(1750, 150, 60)
    expect(carbsG).not.toBe(180)
    expect(carbsG).toBe(Math.round((1750 - 150 * 4 - 60 * 9) / 4))
  })

  it('never asks for negative carbs when protein and fat already exceed the goal', () => {
    expect(carbsFromRemainder(1000, 200, 80)).toBe(0)
  })
})

describe('showing the gap does not replace reconciling it on read', () => {
  // The editor is a prompt, not an enforcement: a row saved before this existed, or by another
  // writer, still reaches consumers drifted — so the read-path guard has to stay.
  it('a drifted row is still reconciled when something plans against it', () => {
    const r = reconcileDailyMacros(1750, { proteinG: 150, carbsG: 180, fatG: 60 })
    expect(r.adjusted).toBe(true)
    expect(Math.abs(caloriesFromMacros(r) - 1750)).toBeLessThanOrEqual(MACRO_GOAL_TOLERANCE_KCAL)
  })

  // Found by this test: carbsFromRemainder rounds to a whole gram, so on a 1,750 kcal goal it
  // returns 153 g — 1,752 kcal implied. A tolerance under 2 kcal made the reconciler flag its own
  // output, and the meal-plan review step would have told the user their macros did not add up
  // immediately after the editor's one-tap fix made them add up.
  it('does not flag the output of its own remainder helper', () => {
    const macros = { proteinG: 150, carbsG: carbsFromRemainder(1750, 150, 60), fatG: 60 }
    expect(caloriesFromMacros(macros)).toBe(1752)
    const r = reconcileDailyMacros(1750, macros)
    expect(r.adjusted).toBe(false)
    expect(r.carbsG).toBe(macros.carbsG)
  })

  it('the reconcile tolerance covers a whole gram of carbohydrate', () => {
    expect(MACRO_RECONCILE_TOLERANCE_KCAL).toBeGreaterThanOrEqual(2)
    // But not so loose that a real disagreement slips through.
    expect(MACRO_RECONCILE_TOLERANCE_KCAL).toBeLessThan(MACRO_GOAL_TOLERANCE_KCAL)
  })

  it('the tolerance is tight — a goal is typed, not measured', () => {
    expect(MACRO_GOAL_TOLERANCE_KCAL).toBeLessThan(50)
  })
})
