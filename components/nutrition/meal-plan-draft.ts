import { scaleIngredientsToTargets } from '@trainingai/shared/nutrition/meal-split'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

/** The unsaved plan returned by /api/nutrition/meal-plans/generate, before the user accepts it. */

export interface DraftMealTotals {
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface DraftMeal {
  position: number
  name: string
  /** Set when this slot was filled from the user's library rather than generated (Q-193). */
  savedMealId?: string | null
  /**
   * Where this slot's food came from (BF-11g). `kept` is a meal the user pinned, `library` one the
   * planner matched from their saved meals, `ai` one the model wrote.
   *
   * Optional because a draft held from before BF-11h reaches this type through `replaceMealInDraft`
   * and through the saved-plan editor, neither of which has a source to state.
   */
  source?: 'kept' | 'library' | 'ai'
  /**
   * Why this meal, in one sentence — which macro drove a library match, or that nothing fitted.
   *
   * **`null` and "nothing fitted" are different answers, and the distinction is load-bearing.** The
   * server sends `null` on an AI slot when the library was never searched, and the sentence only
   * when it was: so a null here means "the library had no say", not "the library had nothing".
   * The reroll reads exactly that to decide whether offering a library swap makes sense.
   */
  matchReason?: string | null
  notes: string | null
  ingredients: NutritionIngredient[]
  /** What the listed ingredients actually sum to. Null when the meal has none. */
  actual: DraftMealTotals | null
  suggestedTime: string
  timingRole: 'pre_workout' | 'post_workout' | null
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
}

export interface DraftVariant {
  dayType: 'all' | 'training' | 'rest'
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  meals: DraftMeal[]
}

export interface Draft {
  planName: string
  mealsPerDay: number
  trainingTime: string | null
  stores: string[]
  excludedFoods: string[]
  restrictionsSnapshot: { code: string; label: string; severity: 'avoid' | 'allergy' }[]
  restDayAdjustment?: string
  /** Set when the saved macros did not sum to the saved calorie goal and carbs were refitted. */
  macrosAdjusted?: boolean
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
  variants: DraftVariant[]
  allergies: string[]
  /**
   * Pins the server could not honour, because there were more of them than slots (BF-11g).
   *
   * The client caps pins at `mealCount - 1` while you pick, so this should be empty in practice —
   * it fills when the meal count was lowered AFTER pinning, which is the silent drop BF-11h's
   * reduction prompt exists to catch. Rendered rather than ignored, because a plan that quietly
   * loses a meal you explicitly asked to keep reads as a bug in pinning.
   */
  droppedPins?: string[]
  /** How many slots the library filled, so the review step can say so without counting. */
  libraryMatchCount?: number
}

export interface RegeneratedMeal {
  name: string
  notes: string | null
  ingredients: NutritionIngredient[]
  /**
   * Set when the replacement came from the user's library rather than the model (BF-11h).
   *
   * Without it a library swap would land as `source: 'ai'` with the link dropped — the slot would
   * stop crediting a meal the user owns, and offer to "save" it back on the next screen.
   */
  fromLibrary?: { savedMealId: string; matchReason: string }
}

/**
 * Swap one meal into every variant of a draft, keeping each variant's own targets.
 *
 * Replacing the meal in only the variant the user was looking at would leave a split plan holding
 * two different meals in the same slot — "Meal 2" would be chicken on a training day and salmon on
 * a rest day, which is not what a training/rest split means. The same meal is used throughout, with
 * its carb sources rescaled to that variant's target, exactly as the generator does.
 *
 * Targets are never touched: a swap changes the food, never the plan's numbers.
 */
export function replaceMealInDraft(draft: Draft, position: number, meal: RegeneratedMeal): Draft {
  return {
    ...draft,
    variants: draft.variants.map(v => ({
      ...v,
      meals: v.meals.map(m => {
        if (m.position !== position) return m
        const ingredients = scaleIngredientsToTargets(meal.ingredients,
          { proteinG: m.targetProteinG, carbsG: m.targetCarbsG, fatG: m.targetFatG }) as NutritionIngredient[]
        return {
          ...m,
          name: meal.name,
          // A model-written replacement no longer holds the library meal it came from, so the link
          // goes with it — leaving it would offer to "save" a meal that is no longer this one. A
          // library swap sets the new link instead, because the slot still holds a meal they own.
          savedMealId: meal.fromLibrary?.savedMealId ?? null,
          source: meal.fromLibrary ? 'library' : 'ai',
          // The reason belongs to the meal now in the slot. Carrying the old one over would explain
          // a match that is no longer there — and on an AI reroll it would claim a match outright.
          matchReason: meal.fromLibrary?.matchReason ?? null,
          notes: meal.notes,
          ingredients,
          actual: ingredients.length > 0 ? sumIngredients(ingredients) : null,
        }
      }),
    })),
  }
}

/**
 * Move a meal to a different slot in an unsaved draft.
 *
 * The slot keeps its numbers and the **food moves between slots** — target macros, suggested time
 * and timing role belong to the position, not to the meal. That is not a detail: `splitMacrosAcross
 * Meals` weights carbs toward the meals bracketing training and fat away from the pre-workout one,
 * so the 07:00 slot and the 17:00 slot genuinely want different food. Swapping the labels and
 * leaving the targets behind would silently re-target both meals.
 *
 * Ingredients are rescaled to the target the meal has arrived at, and `actual` recomputed, so the
 * macro bars keep telling the truth about the new arrangement. This mirrors what the structure
 * route does server-side for a saved plan — the draft cannot call it, because it does not exist in
 * the database yet.
 *
 * Applied to every variant, for the same reason `replaceMealInDraft` is: one slot must not hold
 * different food on a training day and a rest day.
 */
export function reorderDraft(draft: Draft, from: number, to: number): Draft {
  const count = draft.variants[0]?.meals.length ?? 0
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return draft

  return {
    ...draft,
    variants: draft.variants.map(v => {
      const byPosition = [...v.meals].sort((a, b) => a.position - b.position)
      const moved = byPosition.splice(from, 1)[0]
      if (!moved) return v
      byPosition.splice(to, 0, moved)

      return {
        ...v,
        meals: byPosition.map((meal, position) => {
          // The slot the meal has landed in — its numbers stay put while the food moves.
          const slot = v.meals.find(m => m.position === position)!
          const ingredients = scaleIngredientsToTargets(meal.ingredients, {
            proteinG: slot.targetProteinG, carbsG: slot.targetCarbsG, fatG: slot.targetFatG,
          }) as NutritionIngredient[]
          return {
            ...meal,
            position,
            suggestedTime: slot.suggestedTime,
            timingRole: slot.timingRole,
            targetCalories: slot.targetCalories,
            targetProteinG: slot.targetProteinG,
            targetCarbsG: slot.targetCarbsG,
            targetFatG: slot.targetFatG,
            ingredients,
            actual: ingredients.length > 0 ? sumIngredients(ingredients) : null,
          }
        }),
      }
    }),
  }
}
