import type { FoodItem, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { ingredientToEntry } from '@trainingai/shared/nutrition/log-plan-meal'
import { createFoodItem } from '@trainingai/shared/nutrition/create-food-item'
import type { RecipeCandidate } from './recipe-candidates'

export interface ImportedRecipe {
  name: string
  entries: { item: FoodItem; qty: number }[]
  /** `null` when the page never stated a yield. NEVER defaulted to 1 — see below. */
  recipeYield: number | null
}

export type RecipeImportOutcome =
  | { kind: 'imported'; recipe: ImportedRecipe }
  | { kind: 'candidates'; candidates: RecipeCandidate[] }
  | { kind: 'empty' }
  | { kind: 'error' }

/**
 * Turning one `/api/nutrition/scan` response into a meal's ingredients (BF-52).
 *
 * **Lifted out of `ingredient-picker.tsx`, where it was a closure over that component's state.**
 * BF-52 puts a `Recipe photo · Recipe link · Describe` row in the builder itself, above the
 * collapsed ingredient picker — which is the entire point, since the old affordances only existed
 * inside a search field you had to open first. Two callers means the logic cannot stay in one of
 * them, and its own comment already said why a second copy would be wrong: *"the multi-candidate
 * branch, the serial minting, the 0.01 floor and the `recipeYield` refusal are the parts that took
 * two entries to get right"*.
 *
 * **Returns an outcome instead of calling `toast` and `setState`.** That is what makes it testable
 * at all — the in-component version could only be exercised by rendering, and neither vitest project
 * runs a DOM. The caller owns its own spinner, its own message and its own field resets, which also
 * lets the two callers differ where they should: the picker clears its search box, the builder's row
 * clears its URL field.
 *
 * The route is the same one for every input: `{ image, mimeType }`, `{ url }` and `{ text }` are
 * three branches of one handler, so `payload` is passed through whole.
 */
export async function runRecipeImport(
  payload: Record<string, unknown>,
  fallbackName: string,
  userId?: string,
): Promise<RecipeImportOutcome> {
  try {
    const res = await fetch('/api/nutrition/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = res.ok ? await res.json() : null
    const ingredients: NutritionIngredient[] = Array.isArray(body?.ingredients) ? body.ingredients : []
    if (ingredients.length === 0) return { kind: 'empty' }

    // Several dishes: ask which, before minting anything. The top level is `candidates[0]`, so
    // taking it and stopping would silently drop the rest of the page.
    const candidates: RecipeCandidate[] = Array.isArray(body.candidates)
      ? body.candidates.filter((c: RecipeCandidate) => Array.isArray(c?.ingredients) && c.ingredients.length > 0)
      : []
    if (candidates.length > 1) return { kind: 'candidates', candidates }

    // Serial, not `Promise.all`: each one writes the same local table and queues its own outbox
    // row, and a nine-ingredient recipe is not worth racing them for. Same reasoning, same shape
    // as `savePlanMealToLibrary`.
    const entries: { item: FoodItem; qty: number }[] = []
    for (const ing of ingredients) {
      const entry = ingredientToEntry(ing)
      const item = await createFoodItem(entry, userId)
      // The schema floor is 0.01, and a sub-gram garnish rounds to 0.00 two decimals in.
      entries.push({ item, qty: Math.max(0.01, entry.quantityMultiplier) })
    }
    return {
      kind: 'imported',
      recipe: {
        name: typeof body.name === 'string' ? body.name : fallbackName,
        entries,
        // **Handed straight up rather than defaulted to 1.** `null` means the page never said how
        // many the recipe serves, so the payload is the WHOLE batch — a banana-bread page read as
        // one serving is a four-fold error in every macro. The builder's batch-size field asks
        // instead, with an amber line. BF-40 earned this; a new entry point must not undo it.
        recipeYield: typeof body.recipeYield === 'number' ? body.recipeYield : null,
      },
    }
  } catch {
    return { kind: 'error' }
  }
}

/**
 * A network-only failure, said plainly.
 *
 * An Open Food Facts hit, an AI estimate and every recipe import need the network by nature, so a
 * generic "could not read that" while offline reads as a bug rather than as a fact about where you
 * are. Shared by the picker and the builder's source row for the same reason the import itself is.
 */
export function offlineHint(): string | null {
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'That needs a connection — search your own foods, or add it by hand.'
    : null
}
