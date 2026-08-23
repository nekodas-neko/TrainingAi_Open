import { describe, it, expect } from 'vitest'
import { budgetProvenance } from '@trainingai/shared/nutrition/calorie-balance'

/**
 * **Q-401.** Two calorie budgets sat on the Nutrition tab 274 kcal apart, both labelled "left",
 * with nothing reconciling them. The root cause was two TDEE models — a wizard multiplier baked
 * into the stored goal, and a sedentary base with measured movement added — and the owner's
 * decision was to keep the second: *"i want the lowest number that assumes no exercise/movement…
 * then we adjust/increase that number [by] activity."*
 *
 * This is the arithmetic that says so on screen. It is a separate exported function, and tested,
 * because **two surfaces render it** (the Nutrition tab and Home's nutrition card) and a second
 * copy of a calorie figure is precisely what produced the entry.
 */
describe('budgetProvenance', () => {
  it('splits the budget into the rest-day floor and what movement earned', () => {
    // The owner's own numbers: 1,826 resting, recomp goal of −200, so 1,626 before moving.
    expect(budgetProvenance({ restingBaseKcal: 1826, activeKcal: 312, targetNetKcal: -200 }))
      .toEqual({ base: 1626, earned: 312, total: 1938 })
  })

  it('is the rest-day floor exactly when nothing has been earned', () => {
    const p = budgetProvenance({ restingBaseKcal: 1826, activeKcal: 0, targetNetKcal: -200 })
    expect(p).toEqual({ base: 1626, earned: 0, total: 1626 })
  })

  /**
   * A surplus goal is a POSITIVE delta, so the base sits above resting burn. Signing this wrong
   * would show a bulking user a deficit budget and read as a bug in the goal rather than in a
   * subtraction.
   */
  it('adds a surplus goal rather than subtracting it', () => {
    expect(budgetProvenance({ restingBaseKcal: 1800, activeKcal: 0, targetNetKcal: 300 }).base).toBe(2100)
  })

  it('rounds each part, so base + earned always equals the total shown', () => {
    const p = budgetProvenance({ restingBaseKcal: 1826.4, activeKcal: 311.6, targetNetKcal: -200.2 })
    expect(p.base + p.earned).toBe(p.total)
    expect(Number.isInteger(p.base) && Number.isInteger(p.earned)).toBe(true)
  })
})
