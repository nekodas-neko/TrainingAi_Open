import { describe, it, expect } from 'vitest'
import {
  macroFit, mealFit, sumMacroTotals,
  MEAL_FIT_FLOOR_KCAL, MEAL_FIT_FLOOR_GRAMS,
} from '../meal-macro-fit'

describe('macroFit', () => {
  it('calls a proportional miss on target inside 10%', () => {
    expect(macroFit(95, 100, MEAL_FIT_FLOOR_GRAMS).status).toBe('on')
    expect(macroFit(105, 100, MEAL_FIT_FLOOR_GRAMS).status).toBe('on')
    expect(macroFit(120, 100, MEAL_FIT_FLOOR_GRAMS).status).toBe('over')
    expect(macroFit(80, 100, MEAL_FIT_FLOOR_GRAMS).status).toBe('under')
  })

  it('uses the absolute floor when the target is small', () => {
    // 10% of 4 g is 0.4 g — nothing real lands inside that, so the floor governs.
    expect(macroFit(8, 4, MEAL_FIT_FLOOR_GRAMS).status).toBe('on')
    expect(macroFit(15, 4, MEAL_FIT_FLOOR_GRAMS).status).toBe('over')
  })

  it('reports the signed delta and the fill ratio', () => {
    const f = macroFit(60, 90, MEAL_FIT_FLOOR_GRAMS)
    expect(f.delta).toBe(-30)
    expect(f.ratio).toBeCloseTo(0.667, 2)
  })

  it('does not divide by a zero target', () => {
    const f = macroFit(20, 0, MEAL_FIT_FLOOR_GRAMS)
    expect(f.ratio).toBe(0)
    expect(Number.isFinite(f.ratio)).toBe(true)
    expect(f.status).toBe('over')
  })

  it('gives calories a bigger floor than grams', () => {
    expect(macroFit(430, 400, MEAL_FIT_FLOOR_KCAL).status).toBe('on')
    expect(macroFit(430, 400, MEAL_FIT_FLOOR_GRAMS).status).toBe('on') // 10% of 400 still covers it
    expect(macroFit(46, 0, MEAL_FIT_FLOOR_KCAL).status).toBe('on')
    expect(macroFit(46, 0, MEAL_FIT_FLOOR_GRAMS).status).toBe('over')
  })
})

describe('mealFit', () => {
  const target = { calories: 577, proteinG: 38, carbsG: 90, fatG: 15 }

  it('flags the macros that miss and leaves the rest alone', () => {
    // The real drift seen on device: right protein, badly short carbs and fat.
    const fit = mealFit({ calories: 428, proteinG: 40, carbsG: 60, fatG: 4 }, target)
    expect(fit.protein.status).toBe('on')
    expect(fit.calories.status).toBe('under')
    expect(fit.carbs.status).toBe('under')
    expect(fit.fat.status).toBe('under')
    expect(fit.allOnTarget).toBe(false)
  })

  it('reports allOnTarget when every macro is inside tolerance', () => {
    const fit = mealFit({ calories: 570, proteinG: 39, carbsG: 88, fatG: 16 }, target)
    expect(fit.allOnTarget).toBe(true)
  })
})

describe('sumMacroTotals', () => {
  it('adds the meals that have totals and skips the ones that do not', () => {
    const total = sumMacroTotals([
      { calories: 400, proteinG: 30, carbsG: 40, fatG: 12 },
      null,
      { calories: 600, proteinG: 45, carbsG: 60, fatG: 18 },
      undefined,
    ])
    expect(total).toEqual({ calories: 1000, proteinG: 75, carbsG: 100, fatG: 30 })
  })

  it('returns zeroes for an empty list rather than null', () => {
    expect(sumMacroTotals([])).toEqual({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
  })
})
