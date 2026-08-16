import { describe, it, expect } from 'vitest'
import { ingredientsToEntries, scanResultToEntries, sumIngredientEntries } from '../log-food'
import type { NutritionScanResult } from '@trainingai/shared/types/nutrition'

describe('ingredientsToEntries', () => {
  it('creates one entry per ingredient with weight-scaled macros', () => {
    const entries = ingredientsToEntries(
      [
        { name: 'Pulled Beef', weightG: 200, caloriesPer100g: 200, proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 10 },
        { name: 'Bao Buns', weightG: 100, caloriesPer100g: 250, proteinPer100g: 8, carbsPer100g: 45, fatPer100g: 4 },
      ],
      1,
    )
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ name: 'Pulled Beef', servingSizeG: 200, calories: 400, proteinG: 50, carbsG: 0, fatG: 20 })
    expect(entries[1]).toMatchObject({ name: 'Bao Buns', servingSizeG: 100, calories: 250, proteinG: 8, carbsG: 45, fatG: 4 })
    expect(entries.every(e => e.source === 'ai' && e.quantityMultiplier === 1)).toBe(true)
  })

  it('applies the meal-level quantity multiplier to every component', () => {
    const entries = ingredientsToEntries(
      [{ name: 'Rice', weightG: 100, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 }],
      2,
    )
    expect(entries[0].quantityMultiplier).toBe(2)
  })
})

describe('sumIngredientEntries', () => {
  it('sums to the same totals as the individually-logged entries (NUT-9)', () => {
    const ings = [
      { name: 'Pulled Beef', weightG: 200, caloriesPer100g: 200, proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 10 },
      { name: 'Bao Buns', weightG: 100, caloriesPer100g: 250, proteinPer100g: 8, carbsPer100g: 45, fatPer100g: 4 },
    ]
    const entries = ingredientsToEntries(ings, 1)
    const expected = entries.reduce((acc, e) => ({
      servingSizeG: acc.servingSizeG + e.servingSizeG,
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }), { servingSizeG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

    expect(sumIngredientEntries(ings)).toEqual(expected)
  })

  it('defaults quantity to 1', () => {
    const ings = [{ name: 'Rice', weightG: 100, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 }]
    expect(sumIngredientEntries(ings)).toEqual(sumIngredientEntries(ings, 1))
  })
})

describe('scanResultToEntries', () => {
  const base: NutritionScanResult = {
    name: 'Meal', servingSizeG: 300, calories: 650, proteinG: 58, carbsG: 45, fatG: 24, confidence: 'high',
  }

  it('splits a multi-ingredient meal into components', () => {
    const result: NutritionScanResult = {
      ...base,
      ingredients: [
        { name: 'A', weightG: 200, caloriesPer100g: 200, proteinPer100g: 25, carbsPer100g: 0, fatPer100g: 10 },
        { name: 'B', weightG: 100, caloriesPer100g: 250, proteinPer100g: 8, carbsPer100g: 45, fatPer100g: 4 },
      ],
    }
    const entries = scanResultToEntries(result, 1)
    expect(entries.map(e => e.name)).toEqual(['A', 'B'])
  })

  it('keeps a single food as one entry', () => {
    const entries = scanResultToEntries(base, 1)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'Meal', calories: 650, servingSizeG: 300 })
  })

  it('keeps a single-ingredient result as one entry (no needless split)', () => {
    const result: NutritionScanResult = {
      ...base,
      ingredients: [{ name: 'Only', weightG: 300, caloriesPer100g: 216, proteinPer100g: 19, carbsPer100g: 15, fatPer100g: 8 }],
    }
    const entries = scanResultToEntries(result, 1)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Meal')
  })
})
