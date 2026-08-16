import { describe, it, expect } from 'vitest'
import { oneServingItems, savedMealToIngredients } from '../saved-meal-ingredients'
import type { SavedMeal, FoodItem } from '../../types/nutrition'

function food(over: Partial<FoodItem> = {}): FoodItem {
  return {
    id: 'f1', userId: 'u', name: 'Whey', servingSizeG: 30,
    calories: 120, proteinG: 25, carbsG: 2, fatG: 1,
    source: 'manual', region: 'AU', createdAt: new Date(), ...over,
  }
}

function meal(servings: number, qty = 2): SavedMeal {
  return {
    id: 'm1', userId: 'u', name: 'Ninja Creami', servings, createdAt: new Date(),
    items: [{ id: 'i1', savedMealId: 'm1', foodItemId: 'f1', quantityMultiplier: qty, foodItem: food() }],
    totals: { calories: 240, proteinG: 50, carbsG: 4, fatG: 2 },
  }
}

describe('oneServingItems', () => {
  // A meal that predates the field, or that genuinely makes one plate, must be untouched — this is
  // what makes the column safe to add to every existing row.
  it('returns the items unchanged for a single-serving meal', () => {
    const m = meal(1)
    expect(oneServingItems(m)).toBe(m.items)
  })

  it('divides the quantity by the batch size', () => {
    expect(oneServingItems(meal(2))[0].quantityMultiplier).toBe(1)
    expect(oneServingItems(meal(4))[0].quantityMultiplier).toBe(0.5)
  })

  // Dividing by zero would make one portion infinite, which would then be scaled into a plan.
  it('treats a missing or nonsensical batch size as one serving', () => {
    expect(oneServingItems(meal(0))[0].quantityMultiplier).toBe(2)
    expect(oneServingItems(meal(-3))[0].quantityMultiplier).toBe(2)
    expect(oneServingItems({ ...meal(1), servings: undefined as unknown as number })[0].quantityMultiplier).toBe(2)
  })

  it('leaves the original items alone', () => {
    const m = meal(2)
    oneServingItems(m)
    expect(m.items[0].quantityMultiplier).toBe(2)
  })
})

describe('savedMealToIngredients with a batch recipe', () => {
  // The owner's case: a two-serving tub went into a meal-plan slot as the whole tub.
  it('puts one serving into a plan, not the whole batch', () => {
    const whole = savedMealToIngredients(meal(1))
    const half = savedMealToIngredients(meal(2))
    expect(whole[0].weightG).toBe(60)
    expect(half[0].weightG).toBe(30)
  })

  it('keeps per-100g densities identical regardless of batch size', () => {
    const a = savedMealToIngredients(meal(1))[0]
    const b = savedMealToIngredients(meal(3))[0]
    expect(b.proteinPer100g).toBe(a.proteinPer100g)
    expect(b.caloriesPer100g).toBe(a.caloriesPer100g)
  })
})
