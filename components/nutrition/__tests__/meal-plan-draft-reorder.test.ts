import { describe, it, expect } from 'vitest'
import { reorderDraft } from '../meal-plan-draft'
import type { Draft, DraftMeal } from '../meal-plan-draft'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

/**
 * Reordering an unsaved draft.
 *
 * The load-bearing rule is that **targets belong to the slot and food moves between slots**.
 * `splitMacrosAcrossMeals` weights carbs toward the meals bracketing training, so the 07:00 slot
 * and the 17:00 slot genuinely want different food — swapping the names and leaving the numbers
 * behind would silently re-target both meals.
 */

const oats: NutritionIngredient[] = [
  { name: 'Rolled oats', weightG: 80, caloriesPer100g: 380, proteinPer100g: 13, carbsPer100g: 60, fatPer100g: 8 },
]
const chicken: NutritionIngredient[] = [
  { name: 'Chicken breast', weightG: 150, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
  { name: 'White rice', weightG: 200, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 },
]

function meal(position: number, name: string, ingredients: NutritionIngredient[], carbs: number): DraftMeal {
  return {
    position, name, notes: null, ingredients, actual: null,
    suggestedTime: ['07:00', '12:00', '18:00'][position],
    timingRole: position === 1 ? 'pre_workout' : null,
    targetCalories: 600, targetProteinG: 40, targetCarbsG: carbs, targetFatG: 20,
  }
}

function draft(): Draft {
  return {
    planName: 'Test', mealsPerDay: 3, trainingTime: '13:00', stores: [], excludedFoods: [],
    restrictionsSnapshot: [], targetCalories: 1800, targetProteinG: 120, targetCarbsG: 180,
    targetFatG: 60, allergies: [],
    variants: [{
      dayType: 'all', targetCalories: 1800, targetProteinG: 120, targetCarbsG: 180, targetFatG: 60,
      meals: [meal(0, 'Oats', oats, 40), meal(1, 'Chicken and rice', chicken, 90), meal(2, 'Dinner', oats, 50)],
    }],
  }
}

describe('reorderDraft', () => {
  it('moves the food to the new position', () => {
    const r = reorderDraft(draft(), 2, 0)
    expect(r.variants[0].meals.map(m => m.name)).toEqual(['Dinner', 'Oats', 'Chicken and rice'])
  })

  it('renumbers positions contiguously from zero', () => {
    const r = reorderDraft(draft(), 0, 2)
    expect(r.variants[0].meals.map(m => m.position)).toEqual([0, 1, 2])
  })

  // The whole point: the numbers stay with the slot, so a meal that moves is re-targeted.
  it('leaves targets, times and timing roles with the slot, not the meal', () => {
    const r = reorderDraft(draft(), 1, 0)
    const moved = r.variants[0].meals[0]
    expect(moved.name).toBe('Chicken and rice')
    expect(moved.suggestedTime).toBe('07:00')      // slot 0's time
    expect(moved.targetCarbsG).toBe(40)            // slot 0's carbs, not the 90 it came with
    expect(moved.timingRole).toBeNull()            // pre_workout belonged to slot 1

    const displaced = r.variants[0].meals[1]
    expect(displaced.name).toBe('Oats')
    expect(displaced.targetCarbsG).toBe(90)
    expect(displaced.timingRole).toBe('pre_workout')
  })

  it('rescales the ingredients to the target the meal arrived at', () => {
    const before = draft().variants[0].meals[1].ingredients.find(i => i.name === 'White rice')!
    const r = reorderDraft(draft(), 1, 0)
    const after = r.variants[0].meals[0].ingredients.find(i => i.name === 'White rice')!
    // Moved from a 90g carb slot to a 40g one, so the carb source must shrink.
    expect(after.weightG).toBeLessThan(before.weightG)
  })

  it('recomputes what the meal actually comes to', () => {
    const r = reorderDraft(draft(), 1, 0)
    expect(r.variants[0].meals[0].actual).not.toBeNull()
    expect(r.variants[0].meals[0].actual!.carbsG).toBeGreaterThan(0)
  })

  it('is a no-op for a move that goes nowhere or out of range', () => {
    const d = draft()
    expect(reorderDraft(d, 1, 1)).toBe(d)
    expect(reorderDraft(d, 0, 3)).toBe(d)
    expect(reorderDraft(d, -1, 0)).toBe(d)
  })

  // One slot must not hold different food on a training day and a rest day.
  it('applies the same move to every variant', () => {
    const d = draft()
    d.variants.push({ ...d.variants[0], dayType: 'rest', meals: d.variants[0].meals.map(m => ({ ...m })) })
    const r = reorderDraft(d, 2, 0)
    expect(r.variants[0].meals.map(m => m.name)).toEqual(r.variants[1].meals.map(m => m.name))
  })

  it('does not mutate the draft it was given', () => {
    const d = draft()
    reorderDraft(d, 0, 2)
    expect(d.variants[0].meals.map(m => m.name)).toEqual(['Oats', 'Chicken and rice', 'Dinner'])
  })
})
