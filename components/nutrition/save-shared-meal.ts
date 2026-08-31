import type { SharedMeal, SharedMealIngredient } from '@trainingai/shared/nutrition/label-payload'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import { saveMealToLibrary } from './save-meal'

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

/**
 * One shared ingredient as a per-100 g food item plus the multiplier that restores its weight.
 *
 * Exported for its test rather than for a second caller: the arithmetic is the part that can be
 * wrong in a way nothing visible catches — a scanned meal whose macros are off by a factor of the
 * ingredient's weight still renders, still logs, and is simply untrue.
 */
export function sharedIngredientToEntry(ing: SharedMealIngredient): {
  item: Parameters<typeof createFoodItem>[0]
  quantityMultiplier: number
} {
  // A weight of zero cannot be normalised, and the encoder can emit one: `weightG` is rounded, so a
  // sub-gram garnish arrives as 0. Storing it as a single 1× serving keeps its macros — which is
  // what the totals depend on — rather than dividing by zero and writing NaN into the library.
  if (ing.weightG <= 0) {
    return {
      item: {
        name: ing.name, servingSizeG: 100, source: 'manual',
        calories: Math.round(ing.calories), proteinG: ing.proteinG, carbsG: ing.carbsG, fatG: ing.fatG,
      },
      quantityMultiplier: 1,
    }
  }
  const per100 = (v: number) => Math.round((v / ing.weightG) * 100 * 10) / 10
  return {
    item: {
      name: ing.name,
      servingSizeG: 100,
      calories: Math.round((ing.calories / ing.weightG) * 100),
      proteinG: per100(ing.proteinG),
      carbsG: per100(ing.carbsG),
      fatG: per100(ing.fatG),
      source: 'manual',
    },
    // The saved-meal schema floors a multiplier at 0.01, and a 0.5 g pinch rounds to 0.00 two
    // decimals in — which would drop it from the meal entirely.
    quantityMultiplier: Math.max(0.01, Math.round((ing.weightG / 100) * 100) / 100),
  }
}
