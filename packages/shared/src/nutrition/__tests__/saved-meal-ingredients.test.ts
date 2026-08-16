import { describe, it, expect } from 'vitest'
import { savedMealToIngredients } from '../saved-meal-ingredients'
import { sumIngredients } from '../scan-totals'
import { scaleIngredientsToTargets } from '../meal-split'
import type { SavedMeal, FoodItem } from '../../types/nutrition'

const food = (over: Partial<FoodItem>): FoodItem => ({
  id: 'f', userId: 'u', name: 'Food', servingSizeG: 100,
  calories: 100, proteinG: 10, carbsG: 10, fatG: 2,
  source: 'manual', region: 'AU', ...over,
} as FoodItem)

const meal = (items: SavedMeal['items']): SavedMeal => ({
  id: 'm', userId: 'u', name: 'My usual', createdAt: new Date(), items,
  totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
})

describe('savedMealToIngredients', () => {
  it('converts an item to a weight plus per-100g densities', () => {
    // 150 g serving at 1.5x = 225 g eaten; 300 kcal per 150 g = 200 kcal per 100 g.
    const out = savedMealToIngredients(meal([{
      id: 'i', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1.5,
      foodItem: food({ name: 'Chicken breast', servingSizeG: 150, calories: 300, proteinG: 45, carbsG: 0, fatG: 6 }),
    }]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      name: 'Chicken breast', weightG: 225,
      caloriesPer100g: 200, proteinPer100g: 30, carbsPer100g: 0, fatPer100g: 4,
    })
  })

  it('preserves what the meal actually comes to', () => {
    const out = savedMealToIngredients(meal([{
      id: 'i', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 2,
      foodItem: food({ servingSizeG: 100, calories: 120, proteinG: 12, carbsG: 8, fatG: 3 }),
    }]))
    const totals = sumIngredients(out)
    expect(totals.calories).toBe(240)
    expect(totals.proteinG).toBe(24)
    expect(totals.carbsG).toBe(16)
    expect(totals.fatG).toBe(6)
  })

  it('prefixes the brand so two items with the same name stay distinguishable', () => {
    const out = savedMealToIngredients(meal([{
      id: 'i', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1,
      foodItem: food({ name: 'Greek Yoghurt', brand: 'Chobani' }),
    }]))
    expect(out[0].name).toBe('Chobani Greek Yoghurt')
  })

  it('skips an item whose serving size cannot produce a density', () => {
    const out = savedMealToIngredients(meal([
      { id: 'a', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1, foodItem: food({ servingSizeG: 0 }) },
      { id: 'b', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 0, foodItem: food({ servingSizeG: 100 }) },
      { id: 'c', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1, foodItem: food({ name: 'Kept' }) },
    ]))
    expect(out.map(i => i.name)).toEqual(['Kept'])
  })

  it('produces something the portion scaler can resize', () => {
    // The point of the conversion: a meal you already eat has to be resizable to a plan's target.
    const out = savedMealToIngredients(meal([
      { id: 'a', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1, foodItem: food({ name: 'Rice', servingSizeG: 100, calories: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }) },
      { id: 'b', savedMealId: 'm', foodItemId: 'f', quantityMultiplier: 1, foodItem: food({ name: 'Chicken', servingSizeG: 100, calories: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }) },
    ]))
    const scaled = scaleIngredientsToTargets(out, { proteinG: 45, carbsG: 60, fatG: 6 })
    const totals = sumIngredients(scaled)
    expect(totals.proteinG).toBeCloseTo(45, 0)
    expect(totals.carbsG).toBeCloseTo(60, 0)
  })

  it('returns an empty list for a meal with no items', () => {
    expect(savedMealToIngredients(meal([]))).toEqual([])
  })
})
