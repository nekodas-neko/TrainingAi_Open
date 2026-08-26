import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'

// Deterministic totals from the per-ingredient breakdown. The model no longer
// self-verifies its arithmetic — we do the sums. Calories prefer the model's
// per-100g figures (they can encode fibre/alcohol nuance) but fall back to
// Atwater when they disagree with the macros by more than 40%.
/**
 * One serving's worth of a recipe's ingredients.
 *
 * A recipe is *n* servings; a meal is one. Dividing the **weights** and leaving the per-100g
 * densities alone is the whole operation — the densities describe the food, not the portion.
 *
 * Shared because two callers do it: `/api/nutrition/scan` divides when a page states its
 * `recipeYield`, and the meal picker divides when it does not and the user says how many it makes
 * (Q-409). Silently importing a whole tray as one meal is a 4x calorie error that looks entirely
 * plausible, so the two must agree by construction rather than by both being written correctly.
 *
 * A yield of 1 or less returns the input untouched.
 */
export function perServing(ingredients: NutritionIngredient[], servings: number): NutritionIngredient[] {
  if (!(servings > 1)) return ingredients
  return ingredients.map(i => ({ ...i, weightG: Math.round((i.weightG / servings) * 10) / 10 }))
}

export function sumIngredients(ingredients: NutritionIngredient[]): {
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
} {
  let servingSizeG = 0, proteinG = 0, carbsG = 0, fatG = 0, calFromPer100 = 0
  for (const ing of ingredients) {
    const w = Math.max(0, Number(ing.weightG) || 0)
    servingSizeG += w
    proteinG     += Math.max(0, Number(ing.proteinPer100g)  || 0) * w / 100
    carbsG       += Math.max(0, Number(ing.carbsPer100g)    || 0) * w / 100
    fatG         += Math.max(0, Number(ing.fatPer100g)      || 0) * w / 100
    calFromPer100 += Math.max(0, Number(ing.caloriesPer100g) || 0) * w / 100
  }
  const atwater = proteinG * 4 + carbsG * 4 + fatG * 9
  const calories = calFromPer100 > 0 && Math.abs(calFromPer100 - atwater) / Math.max(atwater, 1) <= 0.4
    ? calFromPer100
    : atwater
  return {
    servingSizeG: Math.round(servingSizeG),
    calories: Math.round(calories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
  }
}

export interface RawNutrition {
  name?: string
  brand?: string
  servingSizeG?: number
  calories?: number
  proteinG?: number
  carbsG?: number
  fatG?: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
  confidence?: string
  notes?: string
  ingredients?: NutritionIngredient[]
  /** BF-35. Carried from a barcode/search lookup's Open Food Facts thumbnail. */
  imageDataUri?: string | null
}

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)) }
function pos(v: unknown): number { return Math.max(0, Number(v) || 0) }

/**
 * How far a stated calorie figure may sit from its own macros before it is not to be trusted.
 *
 * `sanitiseNutrition` *rewrites* calories past this; `macroCalorieDisagreement` only *reports*.
 * They share the number on purpose — a second threshold somewhere else would mean a row the UI
 * calls fine and the sanitiser silently rewrites, or the reverse.
 */
export const ATWATER_DEVIATION_LIMIT = 0.4

/**
 * Where a disagreement becomes worth telling the user about.
 *
 * Deliberately tighter than the rewrite limit: between the two the numbers stand as given but the
 * row should not look verified. Below it is ordinary rounding — food labels round, and Atwater
 * factors are approximations — so warning there would train people to ignore the warning.
 */
export const MACRO_MISMATCH_VISIBLE_LIMIT = 0.15

/**
 * How far a row's macros are from its own stated calories, as a fraction, or null when there is
 * nothing to compare.
 *
 * Open Food Facts is filled in field by field by different contributors, so a product can state
 * 96 kcal beside 5P/3C/10F — 122 kcal by Atwater, 27% out. That is under the sanitiser's rewrite
 * threshold, so the row lands as-is and the user picks it off a list believing both numbers.
 */
export function macroCalorieDisagreement(
  r: { calories?: number; proteinG?: number; carbsG?: number; fatG?: number },
): number | null {
  const calories = pos(r.calories)
  if (!(calories > 0)) return null
  const fromMacros = pos(r.proteinG) * 4 + pos(r.carbsG) * 4 + pos(r.fatG) * 9
  if (!(fromMacros > 0)) return null
  return Math.abs(calories - fromMacros) / calories
}

export function sanitiseNutrition(r: RawNutrition): RawNutrition {
  let protein  = pos(r.proteinG)
  let carbs    = pos(r.carbsG)
  let fat      = pos(r.fatG)
  let calories = pos(r.calories)
  let serving  = pos(r.servingSizeG)
  const fiber  = pos(r.fiberG)
  const sugar  = pos(r.sugarG)
  let satFat   = pos(r.satFatG)
  const sodium = pos(r.sodiumMg)

  // Serving size sanity
  serving = clamp(serving || 100, 1, 2000)

  // Macro density caps per serving (extremely generous upper bounds)
  const maxFatG    = serving * 1.0   // fat can't exceed serving weight
  const maxProtein = serving * 1.0
  const maxCarbs   = serving * 1.0

  protein = clamp(protein, 0, maxProtein)
  carbs   = clamp(carbs,   0, maxCarbs)
  fat     = clamp(fat,     0, maxFatG)

  // Saturated fat can't exceed total fat
  satFat = clamp(satFat, 0, fat)

  // Expected calories from macros (Atwater factors)
  const calFromMacros = protein * 4 + carbs * 4 + fat * 9

  // If calories is wildly off from macro math (>40% deviation), recalculate
  const deviation = calories > 0 ? Math.abs(calories - calFromMacros) / calories : 1
  if (deviation > 0.4 || calories === 0) {
    // Calories are unreliable — trust the macros
    calories = Math.round(calFromMacros)
  }

  // If fat alone (×9) exceeds total calories by >20%, fat was hallucinated — recalculate
  if (fat * 9 > calories * 1.2 && protein * 4 + carbs * 4 < calories) {
    fat = Math.max(0, Math.round((calories - protein * 4 - carbs * 4) / 9))
    satFat = clamp(satFat, 0, fat)
  }

  // Final calorie cap (single item unlikely to exceed 3000 kcal)
  calories = clamp(calories, 0, 3000)

  // Downgrade confidence if we had to make corrections
  const corrected = (
    fat !== pos(r.fatG) ||
    protein !== pos(r.proteinG) ||
    carbs !== pos(r.carbsG) ||
    deviation > 0.4
  )
  const confidence = corrected
    ? (r.confidence === 'high' ? 'medium' : 'low')
    : r.confidence

  return {
    ...r,
    servingSizeG: Math.round(serving),
    calories:     Math.round(calories),
    proteinG:     Math.round(protein  * 10) / 10,
    carbsG:       Math.round(carbs    * 10) / 10,
    fatG:         Math.round(fat      * 10) / 10,
    fiberG:       Math.round(fiber    * 10) / 10,
    sugarG:       Math.round(sugar    * 10) / 10,
    satFatG:      Math.round(satFat   * 10) / 10,
    sodiumMg:     Math.round(sodium),
    confidence,
  }
}
