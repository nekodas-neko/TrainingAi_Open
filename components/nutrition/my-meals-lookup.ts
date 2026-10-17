import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { readAiPausedMessage } from '@/lib/ai-paused-notice'
import type { TypedMeal } from './my-meals-picker'

/**
 * Resolves one typed meal (or recipe link) through `/api/nutrition/scan`.
 *
 * Out of the component so the paused case can be tested without a DOM. `paused` carries the server's
 * sentence when the AI balance is empty (issue 2890), so the picker can say so once for the batch;
 * the row itself still comes back `failed`, which is true: its macros were not worked out.
 */
export async function lookupTypedMeal(
  pending: TypedMeal,
  url: string | null,
  atLimit: boolean,
): Promise<{ meal: TypedMeal; paused: string | null }> {
  const { text } = pending
  try {
    const res = await fetch('/api/nutrition/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(url ? { url } : { text }),
    })
    const paused = res.ok ? null : await readAiPausedMessage(res)
    const body = res.ok ? await res.json() : null
    const ingredients: NutritionIngredient[] = Array.isArray(body?.ingredients) ? body.ingredients : []
    const meal: TypedMeal = ingredients.length > 0
      ? {
          text, name: body.name || pending.name, ingredients, looking: false, failed: false,
          // A recipe with no stated yield is the whole batch, so it cannot be kept until the user
          // says how many it serves — keeping it would put a tray in one meal slot.
          keep: !atLimit && !(url && body.recipeYield == null),
          sourceUrl: body.sourceUrl ?? url ?? undefined,
          recipeYield: url ? (body.recipeYield ?? null) : undefined,
        }
      : { ...pending, looking: false, failed: true }
    return { meal, paused }
  } catch {
    return { meal: { ...pending, looking: false, failed: true }, paused: null }
  }
}
