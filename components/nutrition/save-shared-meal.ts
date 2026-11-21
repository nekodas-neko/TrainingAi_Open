import type { MacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit'
import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { sharedIngredientToEntry } from '@trainingai/shared/nutrition/shared-meal-entry'
import { saveMealToLibrary } from './save-meal'

/**
 * A scanned payload's whole-recipe macros, for the duplicate check (LB-34).
 *
 * **A label is a physical object and gets scanned by whoever picks it up** — a partner scanning the
 * fridge on Tuesday and again on Friday used to end up with two identical meals and no sign that
 * either was a copy. `findDuplicateMeal` already answers "do you have this?", and it wants totals;
 * this is the one line of arithmetic that lets the scan path ask it.
 *
 * Summed directly rather than through `sumIngredients`, which takes the per-100 g
 * `NutritionIngredient` shape — a `SharedMealIngredient` already carries its macros for its own
 * weight, so routing them through a per-100 g helper would mean converting twice to get back where
 * they started.
 *
 * These are WHOLE-recipe figures, matching `SavedMeal.totals`, which is what they are compared
 * against. `servings` is carried separately by the payload and must not divide them here.
 */
export function sharedMealTotals(shared: SharedMeal): MacroTotals {
  let calories = 0, proteinG = 0, carbsG = 0, fatG = 0
  for (const ing of shared.ingredients) {
    calories += Number(ing.calories) || 0
    proteinG += Number(ing.proteinG) || 0
    carbsG += Number(ing.carbsG) || 0
    fatG += Number(ing.fatG) || 0
  }
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
  }
}

/**
 * A scanned label turned into the scanner's OWN saved meal (BF-57).
 *
 * **A copy, never a reference — and that is the design, not a simplification.** The alternative was
 * to make `saved_meals.id` globally resolvable so a label could point at the author's row; it was
 * rejected because a photograph of a label would then be read access to someone's meal, and because
 * the author editing their recipe would silently rewrite everybody else's history. The payload
 * carries the whole meal instead, so this function has nothing to fetch: it works offline, and it
 * works for a scanner whose account has never met the author's.
 *
 * **Ingredients are normalised to per-100 g, exactly as `ingredientToEntry` does for a planned
 * meal.** Two reasons, and the second is the one that would have bitten: per-100 g is what makes
 * `createFoodItem`'s duplicate check find the chicken breast already in the scanner's library
 * instead of minting a second row per scan, and it is the basis every other food item in this app
 * is stored on — a meal whose items were stored per-recipe-weight would read correctly and then
 * scale wrongly the moment someone edited it.
 *
 * **The totals survive the conversion because the multiplier carries the weight.** A 300 g
 * ingredient becomes a per-100 g item logged at ×3, so the copy's calories and macros match the
 * original to the rounding the encoder already applied — which is the guarantee `encodeSharedMeal`
 * is built around and the only thing that makes a rolled remainder honest.
 */
export async function saveSharedMealToLibrary(
  shared: SharedMeal,
  userId: string | undefined,
  tz: string,
): Promise<{ mealId: string; name: string }> {
  if (shared.ingredients.length === 0) throw new Error('That label carries no ingredients')

  // Serial, not `Promise.all`: each one writes the same local table and queues its own outbox row,
  // and the payload holds at most a handful. Same call as the plan-meal copy makes, for the same
  // reason — one creation path, so the dedup and the offline queueing cannot diverge.
  const items: { foodItemId: string; quantityMultiplier: number }[] = []
  for (const ing of shared.ingredients) {
    const entry = sharedIngredientToEntry(ing)
    const item = await createFoodItem(entry.item, userId)
    items.push({ foodItemId: item.id, quantityMultiplier: entry.quantityMultiplier })
  }

  const mealId = crypto.randomUUID()
  const now = new Date().toISOString()
  await saveMealToLibrary({
    mealId,
    name: shared.name,
    items,
    // The payload carries servings so a copy is the batch the author cooks, not one plate. Dropping
    // it would halve or double every portion the scanner logs from this meal afterwards.
    servings: shared.servings,
    imageDataUri: null,
    // `undefined`, never `[]`. Absent means "leave the stored tags alone"; `[]` means "clear them",
    // and this meal has none to clear — the distinction BF-11e built into the route and the outbox.
    mealTypeIds: undefined,
    createdAt: now,
    isUpdate: false,
    userId,
    tz,
  })
  return { mealId, name: shared.name }
}

// The per-ingredient arithmetic lives in the shared package, where Preview's copy of a friend's meal
// uses it too. Re-exported so this module's callers and tests keep one import.
export { sharedIngredientToEntry }
