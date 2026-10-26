import { describe, it, expect } from 'vitest'
import { sharedMealFromSaved, encodeSharedMeal, decodeSharedMeal } from '../label-payload'
import type { SavedMeal, FoodItem } from '../../types/nutrition'

const food = (i: number): FoodItem => ({
  id: `f${i}`, userId: 'u', name: `Ingredient ${i}`, brand: i % 2 ? 'Brand' : undefined, servingSizeG: 40 + i,
  calories: 100 + i, proteinG: 5 + i / 10, carbsG: 10 + i / 10, fatG: 2 + i / 10,
  source: 'manual', region: 'AU', createdAt: new Date(),
} as FoodItem)

function bigMeal(n: number, servings = 3): SavedMeal {
  return {
    id: 'm1', userId: 'u', name: 'Big batch', servings, createdAt: new Date(),
    items: Array.from({ length: n }, (_, i) => ({
      id: `i${i}`, savedMealId: 'm1', foodItemId: `f${i}`, quantityMultiplier: 1.5, foodItem: food(i),
    })),
  } as unknown as SavedMeal
}

describe('sharedMealFromSaved — a friend\'s library path, no QR budget', () => {
  it('names every ingredient of a 20-ingredient meal and rolls nothing up', () => {
    const shared = sharedMealFromSaved(bigMeal(20))
    expect(shared.ingredients).toHaveLength(20)
    expect(shared.rolled).toBe(0)
    expect(shared.ingredients.some(i => i.name.startsWith('+'))).toBe(false)
    // The label path, by contrast, gives way at its byte budget — the reason this path exists.
    expect(encodeSharedMeal(bigMeal(20)).rolled).toBeGreaterThan(0)
  })

  it('carries the WHOLE recipe and the servings, not one portion', () => {
    const shared = sharedMealFromSaved(bigMeal(1, 4))
    expect(shared.servings).toBe(4)
    // 1.5 × the item's 40 g serving, undivided by servings.
    expect(shared.ingredients[0].weightG).toBe(60)
    expect(shared.ingredients[0].calories).toBe(Math.round(100 * 1.5))
  })

  it('agrees with the label encoder on every figure while the label still fits', () => {
    const meal = bigMeal(2)
    const fromLabel = decodeSharedMeal(encodeSharedMeal(meal).text)!
    expect(sharedMealFromSaved(meal)).toEqual(fromLabel)
  })

  it('defaults a missing or zero servings to 1', () => {
    expect(sharedMealFromSaved({ ...bigMeal(1), servings: 0 }).servings).toBe(1)
  })
})
