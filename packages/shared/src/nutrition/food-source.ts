import type { NutritionIngredient, ScanOrigin } from '@trainingai/shared/types/nutrition'

// Pure, so the native app can import it: `log-food.ts` reaches the web local store and cannot be
// loaded there. `log-food.ts` re-exports all of it, so web callers are unchanged.

/**
 * How the food was identified → the `source` a `food_items` row records.
 *
 * `'search'` maps to `'ai'` only because the column has no value for an Open Food Facts text
 * lookup, and adding one is a migration. That is a wrong label this change does not fix, not a
 * chosen one — BF-70's follow-up. `'barcode'` is the value BF-70 exists to start writing: it was
 * essentially never stored, which is why BF-38 measured 3 of 221 rows carrying it.
 */
export function scanOriginToSource(origin: ScanOrigin | undefined): NewFoodEntry['source'] {
  if (origin === 'barcode') return 'barcode'
  if (origin === 'photo' || origin === 'text' || origin === 'url' || origin === 'search') return 'ai'
  // OR-205. No origin means no scan: a hand-typed entry. This used to fall back to
  // `confidence ? 'ai' : 'manual'`, which let the model's self-reported confidence decide a stored
  // value, and the photo scan route set no origin, so that fallback was the path for every AI scan.
  return 'manual'
}

/**
 * #2925. The `source` a scanned entry is stored under, after the user has had the form in front of
 * them. `sanitiseFoodItemNutrition` repairs anything that is not 'manual', and that repair reads a
 * number as a model's invention. A calorie or macro figure the person changed is theirs, so any
 * edit away from what the scan returned makes the entry hand-entered; an untouched scan keeps its
 * origin and its repair.
 */
export function sourceAfterEdit(
  scanned: NewFoodEntry['source'],
  scan: { calories: number; proteinG: number; carbsG: number; fatG: number; servingSizeG: number } | null,
  form: { calories: number; proteinG: number; carbsG: number; fatG: number; servingSizeG: number },
): NewFoodEntry['source'] {
  if (scanned === 'manual' || !scan) return scanned
  const same = scan.calories === form.calories && scan.proteinG === form.proteinG
    && scan.carbsG === form.carbsG && scan.fatG === form.fatG && scan.servingSizeG === form.servingSizeG
  return same ? scanned : 'manual'
}

/**
 * #2925. The `source` for a food picked off a name search. A hit that carries calories but no macros
 * (Open Food Facts often has the energy and nothing else) is stored with its macros defaulted to 0,
 * and `sanitiseNutrition` reads "calories with no macros behind them" as a model hallucination and
 * zeroes the calories. The numbers came from a database, not a model, so that hit is stored as
 * 'manual', which keeps them: the column has no value for "database, partial", and a kept figure
 * matters more than telling this row apart. A hit with its macros stays 'text' and is repaired as before.
 */
export function lookupHitSource(food: {
  calories: number
  proteinG?: number | null
  carbsG?: number | null
  fatG?: number | null
}): NewFoodEntry['source'] {
  const noMacros = !(food.proteinG ?? 0) && !(food.carbsG ?? 0) && !(food.fatG ?? 0)
  return food.calories > 0 && noMacros ? 'manual' : 'text'
}

/**
 * A single food entry to log. When `foodItemId` is present the item already
 * exists (e.g. picked from the library) and is not recreated; otherwise a new
 * food item is created from these fields.
 */
export interface NewFoodEntry {
  foodItemId?: string
  name: string
  brand?: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG?: number
  sugarG?: number
  sodiumMg?: number
  satFatG?: number
  source: 'ai' | 'manual' | 'barcode' | 'text'
  quantityMultiplier: number
  /** BF-35's thumbnail, when the entry came from a lookup that carried one (BF-70). */
  imageDataUri?: string | null
  /** LB-158's product code, when the entry came from a barcode scan. */
  barcode?: string
}

function r1(n: number) { return Math.round(n * 10) / 10 }

/** Split a multi-ingredient meal into one entry per component with its own macros. */
export function ingredientsToEntries(
  ings: NutritionIngredient[],
  quantity: number,
  source: NewFoodEntry['source'] = 'ai',
): NewFoodEntry[] {
  return ings.map(ing => {
    const scale = ing.weightG / 100
    return {
      name: ing.name,
      servingSizeG: Math.round(ing.weightG),
      calories: Math.round(ing.caloriesPer100g * scale),
      proteinG: r1(ing.proteinPer100g * scale),
      carbsG: r1(ing.carbsPer100g * scale),
      fatG: r1(ing.fatPer100g * scale),
      source,
      quantityMultiplier: quantity,
    }
  })
}

// Totals that equal the sum of the individually-logged per-ingredient entries
// (see ingredientsToEntries) — the single shared source for a multi-ingredient
// preview, so it never drifts from what actually gets logged (One Formula, One
// Place). Not the same as scan-totals.ts's sumIngredients, which uses a
// sum-then-Atwater-cross-check and is the authority only for the single-item
// scan sanitisation path, not this per-ingredient preview/log path.
export function sumIngredientEntries(ings: NutritionIngredient[], quantity = 1): {
  servingSizeG: number; calories: number; proteinG: number; carbsG: number; fatG: number
} {
  return ingredientsToEntries(ings, quantity).reduce(
    (acc, e) => ({
      servingSizeG: acc.servingSizeG + e.servingSizeG,
      calories: acc.calories + e.calories,
      proteinG: r1(acc.proteinG + e.proteinG),
      carbsG:   r1(acc.carbsG   + e.carbsG),
      fatG:     r1(acc.fatG     + e.fatG),
    }),
    { servingSizeG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  )
}
