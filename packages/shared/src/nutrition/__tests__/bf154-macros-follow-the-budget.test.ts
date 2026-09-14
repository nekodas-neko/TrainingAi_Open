import { describe, it, expect } from 'vitest'
import { macrosForKcal, macroKcal, scaleMacrosForEarnedKcal, budgetProvenance } from '../calorie-balance'
import { KCAL_PER_G } from '../atwater'

/**
 * BF-154 — the grams follow the budget, so the gap the card used to explain is zero.
 *
 * The owner's words (2026-09-13): *"Can we have it dynamically sized for my calories? I.e before
 * excercise its 1 value and after its another if calories increase?"*
 *
 * Figures are his: a stored target of 150/166/55 (≈1,660 kcal) against a resting-rate-anchored
 * budget base of 1,294.
 */
const STORED = { proteinG: 150, carbsG: 166, fatG: 55 }
const BUDGET_BASE = 1294

describe('BF-154 — macrosForKcal', () => {
  it('fits the split to the budget, which is the whole point: no gap left to explain', () => {
    const fitted = macrosForKcal(STORED, BUDGET_BASE)
    // Within rounding of one gram on each of carbs and fat.
    expect(Math.abs(macroKcal(fitted) - BUDGET_BASE)).toBeLessThanOrEqual(KCAL_PER_G.fat)
  })

  it('holds protein while carbs and fat absorb the whole difference', () => {
    const fitted = macrosForKcal(STORED, BUDGET_BASE)
    expect(fitted.proteinG).toBe(150)
    expect(fitted.carbsG).toBeLessThan(STORED.carbsG)
    expect(fitted.fatG).toBeLessThan(STORED.fatG)
  })

  it('preserves the carbs:fat ENERGY ratio, not each macro\'s share of the day', () => {
    const before = (STORED.carbsG * KCAL_PER_G.carbs) / (STORED.fatG * KCAL_PER_G.fat)
    const f = macrosForKcal(STORED, BUDGET_BASE)
    const after = (f.carbsG * KCAL_PER_G.carbs) / (f.fatG * KCAL_PER_G.fat)
    expect(after).toBeCloseTo(before, 1)
  })

  it('moves with the budget — the owner\'s "before exercise one value, after another"', () => {
    const rest = macrosForKcal(STORED, BUDGET_BASE)
    const moved = macrosForKcal(STORED, BUDGET_BASE + 400)
    expect(moved.carbsG).toBeGreaterThan(rest.carbsG)
    expect(moved.fatG).toBeGreaterThan(rest.fatG)
    expect(moved.proteinG).toBe(rest.proteinG)
    expect(Math.abs(macroKcal(moved) - (BUDGET_BASE + 400))).toBeLessThanOrEqual(KCAL_PER_G.fat)
  })

  it('zeroes carbs and fat rather than going negative when protein alone exceeds the total', () => {
    const fitted = macrosForKcal(STORED, 200)   // 150 g protein is already 600 kcal
    expect(fitted).toEqual({ proteinG: 150, carbsG: 0, fatG: 0 })
  })

  it('returns the input untouched for a non-finite total', () => {
    expect(macrosForKcal(STORED, NaN)).toBe(STORED)
  })
})

describe('BF-154 — scaleMacrosForEarnedKcal still behaves, now that it delegates', () => {
  it('is exactly macrosForKcal at its own total plus what was earned', () => {
    for (const earned of [1, 50, 400, 1200]) {
      expect(scaleMacrosForEarnedKcal(STORED, earned))
        .toEqual(macrosForKcal(STORED, macroKcal(STORED) + earned))
    }
  })

  it('still returns the base untouched when nothing was earned', () => {
    expect(scaleMacrosForEarnedKcal(STORED, 0)).toBe(STORED)
    expect(scaleMacrosForEarnedKcal(STORED, -50)).toBe(STORED)
  })
})

describe('BF-154 — the grams and the budget are one number, end to end', () => {
  // The defect this closes: the card printed a budget from `budgetProvenance` and grams fitted to
  // the STORED goal, so the two disagreed by ~366 kcal at every hour of every day and a whole
  // module existed to measure it.
  const balance = {
    restingBaseKcal: 2278, activeKcal: 406, targetNetKcal: -500, restingRateKcal: BUDGET_BASE,
  }

  it('the fitted grams add up to the budget the card prints', () => {
    const { base, total } = budgetProvenance(balance)
    expect(base).toBe(BUDGET_BASE)
    const scaled = macrosForKcal(STORED, total)
    expect(Math.abs(macroKcal(scaled) - total)).toBeLessThanOrEqual(KCAL_PER_G.fat)
  })

  // Why the old gap was CONSTANT, which is the part that makes it a design fault rather than a
  // rounding one: the previous code grew the stored grams by `earned` and the budget by the same
  // `earned`, so the difference between them never moved however much the day was walked. No amount
  // of movement was ever going to close it.
  it('the old pairing left a gap no movement could close', () => {
    const gapAt = (earned: number) => {
      const { total } = budgetProvenance({ ...balance, activeKcal: earned })
      return macroKcal(scaleMacrosForEarnedKcal(STORED, earned)) - total
    }
    const atRest = macroKcal(STORED) - BUDGET_BASE
    expect(atRest).toBeGreaterThan(400)
    for (const earned of [100, 406, 900]) {
      expect(Math.abs(gapAt(earned) - atRest), `earned=${earned}`).toBeLessThanOrEqual(KCAL_PER_G.fat)
    }
  })

  it('the new pairing has no gap at any amount of movement', () => {
    for (const earned of [0, 100, 406, 900]) {
      const { total } = budgetProvenance({ ...balance, activeKcal: earned })
      const fitted = macrosForKcal(STORED, total)
      expect(Math.abs(macroKcal(fitted) - total), `earned=${earned}`).toBeLessThanOrEqual(KCAL_PER_G.fat)
    }
  })
})
