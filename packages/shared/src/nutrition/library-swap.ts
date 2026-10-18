import { selectLibraryMeals, type MealTypeWindow } from '@trainingai/shared/nutrition/library-match'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { parseTimeToMinutes } from '@trainingai/shared/nutrition/meal-split'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

/**
 * The fields of a draft meal slot this reads. Structural, so the current app's and Preview's own
 * `DraftMeal` types both fit without either moving here (#3041).
 */
export interface LibrarySwapSlot {
  position: number
  suggestedTime: string
  savedMealId?: string | null
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
}

export interface LibrarySwap {
  meal: SavedMeal
  matchReason: string
}

/**
 * The best saved meal for one slot of a draft (BF-11h, design item 11).
 *
 * **Runs `selectLibraryMeals` — the same function the generator uses — rather than a second
 * matcher.** Two implementations of "does this meal fit this slot" would drift, and the one the
 * user sees on a reroll has to agree with the one that built the plan. It is shared code precisely
 * so the client can reach it: no route, no model call, no cost.
 *
 * Returns `null` when nothing fits, which is the honest answer and the reason the AI option stays.
 */
export function libraryMealForSlot(
  slot: LibrarySwapSlot,
  library: SavedMeal[],
  mealTypes: MealTypeWindow[],
  /** Saved-meal ids already used elsewhere in the plan — a meal must not appear twice in a day. */
  usedSavedMealIds: string[],
): LibrarySwap | null {
  const timeMinutes = parseTimeToMinutes(slot.suggestedTime)
  if (timeMinutes == null) return null

  const exclude = new Set(usedSavedMealIds)
  // The meal currently in this slot is excluded too: "swap" that returns what is already there
  // would read as the button doing nothing.
  if (slot.savedMealId) exclude.add(slot.savedMealId)

  const [pick] = selectLibraryMeals(
    [{
      index: slot.position,
      timeMinutes,
      target: {
        calories: slot.targetCalories,
        proteinG: slot.targetProteinG,
        carbsG: slot.targetCarbsG,
        fatG: slot.targetFatG,
      },
    }],
    library
      .filter(m => !exclude.has(m.id))
      .map(m => ({ id: m.id, name: m.name, mealTypeIds: m.mealTypeIds, ingredients: savedMealToIngredients(m) })),
    mealTypes,
  )
  if (!pick) return null

  const meal = library.find(m => m.id === pick.meal.id)
  return meal ? { meal, matchReason: pick.matchReason } : null
}

/** Every saved meal the draft is already using, so a swap cannot duplicate one. */
export function usedSavedMealIds(meals: Pick<LibrarySwapSlot, 'savedMealId'>[]): string[] {
  return meals.map(m => m.savedMealId).filter((id): id is string => id != null)
}
