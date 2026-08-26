import type { MacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit'
import { fitDistance } from '@trainingai/shared/nutrition/meal-macro-fit'

/**
 * Is this meal one you already have? (BF-11d)
 *
 * A recipe link is easy to paste twice, and a multi-dish page pasted twice adds every dish again in
 * one press. So a save asks first — but only when it is confident, because a false match interrupts
 * a save that was fine.
 *
 * **Two independent tests, and BOTH must pass.** `fitDistance` is reused rather than a new threshold
 * invented: it already reduces a macro comparison to one comparable number, relative rather than
 * absolute, and its own doc says it exists *"so two candidate versions of the same meal can be
 * compared without a second opinion about what 'better' means"*. That is this question. But macros
 * alone match every protein shake against every other one, so a normalised **name** match is
 * required alongside.
 *
 * **The name test is equality after normalisation, not fuzzy.** BF-38 measured 19 redundant
 * `food_items` rows and its guidance is explicit — *prefer under-merging*, because a rule that
 * collapses *Greek Yogurt Plain* into *Greek Yogurt Vanilla* silently corrupts the macros of every
 * past log. Here the cost of under-matching is a duplicate the owner can delete; the cost of
 * over-matching is an offer to overwrite the wrong meal.
 *
 * Lives beside its callers rather than in `packages/shared/` because nothing outside
 * `components/nutrition/` asks this — same placement as `saved-meal-qty.ts` and `recipe-import.ts`.
 */

/**
 * Total relative macro difference below which two meals count as the same food.
 *
 * `fitDistance` sums three relative errors, so 0.15 is an average of 5% per macro. Chosen to sit
 * well inside rounding noise — the same recipe imported twice differs only by `perServing`'s 0.1 g
 * weight rounding — while a genuinely different meal of similar size clears it easily.
 */
export const DUPLICATE_MAX_FIT_DISTANCE = 0.15

/** Lowercase, punctuation stripped, whitespace collapsed. `"Nan's  Banana-Bread!"` → `nans banana bread`. */
export function normaliseMealName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export interface ComparableMeal {
  id: string
  name: string
  totals: MacroTotals
}

/**
 * The existing meal this one duplicates, or null.
 *
 * `excludeId` is the meal being edited: re-saving a meal you opened is not a duplicate of itself,
 * and offering to "update" it would be a question with one answer.
 */
export function findDuplicateMeal(
  candidate: { name: string; totals: MacroTotals },
  existing: ComparableMeal[],
  excludeId?: string | null,
): ComparableMeal | null {
  const name = normaliseMealName(candidate.name)
  if (!name) return null
  for (const meal of existing) {
    if (excludeId && meal.id === excludeId) continue
    if (normaliseMealName(meal.name) !== name) continue
    // Compared against the stored meal as the target, so the relative error is measured against a
    // figure that already exists rather than one being proposed.
    if (fitDistance(candidate.totals, meal.totals) <= DUPLICATE_MAX_FIT_DISTANCE) return meal
  }
  return null
}
