import { describe, it, expect } from 'vitest'
import { replaceMealInDraft, type Draft, type DraftMeal } from '../meal-plan-draft'

const ing = (name: string, weightG: number, p: number, c: number, f: number) => ({
  name, weightG, caloriesPer100g: p * 4 + c * 4 + f * 9,
  proteinPer100g: p, carbsPer100g: c, fatPer100g: f,
})

function draft(meal: Partial<DraftMeal>): Draft {
  const m: DraftMeal = {
    position: 0, name: 'Original', notes: null, ingredients: [ing('rice', 100, 3, 28, 1)],
    actual: null, suggestedTime: '12:00', timingRole: null,
    targetCalories: 600, targetProteinG: 45, targetCarbsG: 60, targetFatG: 18,
    ...meal,
  }
  return {
    planName: 'p', mealsPerDay: 1, trainingTime: null, stores: [], excludedFoods: [],
    restrictionsSnapshot: [], targetCalories: 600, targetProteinG: 45, targetCarbsG: 60,
    targetFatG: 18, allergies: [],
    variants: [{ dayType: 'all', targetCalories: 600, targetProteinG: 45, targetCarbsG: 60, targetFatG: 18, meals: [m] }],
  }
}

const replacement = { name: 'New meal', notes: null, ingredients: [ing('oats', 100, 13, 60, 7)] }

/**
 * A slot's provenance has to follow its food (BF-11h).
 *
 * The badge reads `source`, and both `kept` and `library` carry a `savedMealId` — so a replacement
 * that left either behind would credit the user for a meal the model wrote, or claim a match that
 * is no longer there.
 */
describe('replaceMealInDraft — provenance follows the food', () => {
  it('an AI reroll drops the library link and the reason with it', () => {
    const d = draft({ savedMealId: 'm1', source: 'library', matchReason: 'Closest on protein.' })
    const out = replaceMealInDraft(d, 0, replacement).variants[0].meals[0]
    expect(out.savedMealId).toBeNull()
    expect(out.source).toBe('ai')
    // Carrying it would explain a match that is no longer there — worse than saying nothing.
    expect(out.matchReason).toBeNull()
  })

  it('an AI reroll over a KEPT meal stops calling it the user\'s', () => {
    const d = draft({ savedMealId: 'm1', source: 'kept', matchReason: null })
    const out = replaceMealInDraft(d, 0, replacement).variants[0].meals[0]
    expect(out.source).toBe('ai')
    expect(out.savedMealId).toBeNull()
  })

  it('a library swap sets the new link and the new reason', () => {
    const d = draft({ source: 'ai', matchReason: 'No saved meal fitted this slot.' })
    const out = replaceMealInDraft(d, 0, {
      ...replacement,
      fromLibrary: { savedMealId: 'm2', matchReason: 'Closest on carbs.' },
    }).variants[0].meals[0]
    expect(out.savedMealId).toBe('m2')
    expect(out.source).toBe('library')
    expect(out.matchReason).toBe('Closest on carbs.')
  })

  it('leaves the slot\'s targets alone either way — a swap changes food, never numbers', () => {
    const d = draft({ source: 'ai', matchReason: null })
    const out = replaceMealInDraft(d, 0, replacement).variants[0].meals[0]
    expect(out.targetCalories).toBe(600)
    expect(out.targetProteinG).toBe(45)
    expect(out.suggestedTime).toBe('12:00')
  })
})
