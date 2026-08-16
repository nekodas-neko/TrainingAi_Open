import { describe, it, expect } from 'vitest'
import { sumIngredients, sanitiseNutrition } from '@trainingai/shared/nutrition/scan-totals'

describe('sumIngredients', () => {
  it('sums weights and per-100g macros', () => {
    const totals = sumIngredients([
      { name: 'chicken', weightG: 150, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
      { name: 'rice',    weightG: 200, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 },
    ])
    expect(totals.servingSizeG).toBe(350)
    expect(totals.proteinG).toBeCloseTo(51.9, 1)   // 46.5 + 5.4
    expect(totals.carbsG).toBeCloseTo(56, 1)
    expect(totals.fatG).toBeCloseTo(6, 1)
    expect(totals.calories).toBe(508)              // 247.5 + 260, within 40% of Atwater
  })
  it('falls back to Atwater when per-100g calories are wildly off', () => {
    const totals = sumIngredients([
      { name: 'banana', weightG: 100, caloriesPer100g: 900, proteinPer100g: 1, carbsPer100g: 23, fatPer100g: 0.3 },
    ])
    // Atwater: 1*4 + 23*4 + 0.3*9 = 98.7 → model's 900 rejected
    expect(totals.calories).toBe(99)
  })
  it('handles a single-ingredient simple food and negative garbage', () => {
    const totals = sumIngredients([
      { name: 'bar', weightG: -60, caloriesPer100g: 400, proteinPer100g: 30, carbsPer100g: 40, fatPer100g: 10 },
    ])
    expect(totals.servingSizeG).toBe(0)
    expect(totals.calories).toBe(0)
  })
})

describe('sanitiseNutrition (moved, behaviour unchanged)', () => {
  it('recalculates calories from macros when deviation exceeds 40%', () => {
    const out = sanitiseNutrition({ servingSizeG: 100, calories: 900, proteinG: 10, carbsG: 10, fatG: 2 })
    expect(out.calories).toBe(98)   // 10*4 + 10*4 + 2*9
    expect(out.confidence).toBe('low')
  })
  it('caps saturated fat at total fat', () => {
    const out = sanitiseNutrition({ servingSizeG: 100, calories: 180, proteinG: 0, carbsG: 0, fatG: 20, satFatG: 35 })
    expect(out.satFatG).toBeLessThanOrEqual(out.fatG!)
  })
})
