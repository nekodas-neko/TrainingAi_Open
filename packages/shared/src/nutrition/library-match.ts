import { scaleIngredientsToTargets, type ScalableIngredient } from './meal-split'
import { sumIngredients } from './scan-totals'
import { fitDistance, mealFit, type MacroTotals } from './meal-macro-fit'
import type { NutritionIngredient } from '../types/nutrition'

/**
 * Which saved meal, if any, should fill a plan slot (BF-11g).
 *
 * Today every unpinned slot is a fresh AI recipe and nothing reads the library, which is the owner's
 * complaint: *"it prefers meals already in the planner and adds other meals around it."*
 *
 * Pure and synchronous on purpose — the ranking is the part worth testing, and it is untestable
 * behind an AI call.
 */

export interface LibraryMeal {
  id: string
  name: string
  /** Empty means untagged, which is eligible for every slot rather than none. */
  mealTypeIds: string[]
  ingredients: NutritionIngredient[]
}

export interface LibrarySlot {
  index: number
  /** Minutes past midnight, from `splitMacrosAcrossMeals`. */
  timeMinutes: number
  target: MacroTotals
}

export interface MealTypeWindow {
  id: string
  timeStartHour: number
  timeEndHour: number
}

export interface LibraryPick {
  slotIndex: number
  meal: LibraryMeal
  /** Why this meal, in one line — BF-11h's swap and the AI edit both read it. */
  matchReason: string
}

/**
 * The meal types whose window contains a slot's time.
 *
 * The windows already exist and already define this — a slot's meal type is not a new concept and
 * must not become a second definition of one. A window may wrap midnight (22 → 2), so the contained
 * test is written for that rather than assuming start < end.
 */
export function slotMealTypeIds(timeMinutes: number, mealTypes: MealTypeWindow[]): string[] {
  const hour = ((timeMinutes / 60) % 24 + 24) % 24
  return mealTypes
    .filter(t => {
      const start = t.timeStartHour
      const end = t.timeEndHour
      if (end <= start) return hour >= start || hour < end   // wraps midnight
      return hour >= start && hour < end
    })
    .map(t => t.id)
}

/** Untagged meals suit any slot; a tagged meal must share a tag with the slot's meal types. */
function eligibleForSlot(meal: LibraryMeal, slotTypeIds: string[]): boolean {
  if (meal.mealTypeIds.length === 0) return true
  return meal.mealTypeIds.some(id => slotTypeIds.includes(id))
}

function reasonFor(actual: MacroTotals, target: MacroTotals): string {
  const rel = (a: number, t: number) => t > 0 ? Math.abs(a - t) / t : 0
  const macros: [string, number][] = [
    ['protein', rel(actual.proteinG, target.proteinG)],
    ['carbs', rel(actual.carbsG, target.carbsG)],
    ['fat', rel(actual.fatG, target.fatG)],
  ]
  macros.sort((a, b) => a[1] - b[1])
  const [closest, closestErr] = macros[0]
  const [worst, worstErr] = macros[macros.length - 1]
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return worstErr <= 0.02
    ? 'From your library — lands on target once portioned.'
    : `From your library — closest on ${closest} (within ${pct(closestErr)}), ${worst} off by ${pct(worstErr)}.`
}

/**
 * Fill what the library can, slot by slot, leaving the rest to the model.
 *
 * **Judged on the meal it would BECOME, not the meal as saved.** A candidate is run through the real
 * `scaleIngredientsToTargets` before it is ranked or gated, because that is what the plan does to it
 * moments later. Ranking the saved totals instead would reject a perfectly-shaped meal for being the
 * wrong size — which is the one thing portioning always fixes. It matters more than it sounds:
 * the scaler moves each macro GROUP independently and clamps each to
 * `PORTION_SCALE_MIN`–`PORTION_SCALE_MAX`, so "close enough" is a question about the meal's macro
 * shape and about whether it has a source for each macro at all, not about its totals.
 *
 * No second metric and no fresh threshold, per the plan: `fitDistance` ranks and `mealFit` gates,
 * both already the one place that answers "how far is this meal from its target".
 *
 * **A meal is never used twice in a day.** The model is told to return "genuinely DIFFERENT food",
 * but a library search never reaches the model — this is a failure mode the feature creates, not one
 * it inherits.
 */
export function selectLibraryMeals(
  slots: LibrarySlot[],
  library: LibraryMeal[],
  mealTypes: MealTypeWindow[],
): LibraryPick[] {
  const picks: LibraryPick[] = []
  const used = new Set<string>()

  for (const slot of slots) {
    const slotTypeIds = slotMealTypeIds(slot.timeMinutes, mealTypes)
    let best: { meal: LibraryMeal; actual: MacroTotals; distance: number } | null = null

    for (const meal of library) {
      if (used.has(meal.id)) continue
      if (meal.ingredients.length === 0) continue
      if (!eligibleForSlot(meal, slotTypeIds)) continue

      const scaled = scaleIngredientsToTargets(meal.ingredients as ScalableIngredient[], slot.target)
      const totals = sumIngredients(scaled as NutritionIngredient[])
      const actual: MacroTotals = {
        calories: totals.calories, proteinG: totals.proteinG, carbsG: totals.carbsG, fatG: totals.fatG,
      }
      const distance = fitDistance(actual, slot.target)
      if (!best || distance < best.distance) best = { meal, actual, distance }
    }

    if (!best) continue
    // The gate is the shipped definition of "this meal is fine", asked of the portioned meal.
    if (!mealFit(best.actual, slot.target).allOnTarget) continue

    used.add(best.meal.id)
    picks.push({ slotIndex: slot.index, meal: best.meal, matchReason: reasonFor(best.actual, slot.target) })
  }

  return picks
}
