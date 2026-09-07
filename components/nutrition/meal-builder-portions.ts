export interface MealMacroTotals {
  calories: number
  protein: number
  carbs: number
  fat: number
}

/**
 * The batch figures divided into one portion — BF-121.
 *
 * The builder's footer divided **calories** by `servings` and printed the macros raw beside them, so
 * one row carried two denominators with only one of them labelled. The same meal's detail sheet reads
 * the other way round: its headline and macro columns are per portion, *"that is what `Log this meal`
 * writes"*.
 *
 * **Divide, then round.** Rounding first and dividing after is how the footer would disagree with the
 * diary row the log later writes, which is the number the owner actually compares against. Dividing
 * the batch sum is exact rather than an approximation of the canonical path: `oneServingItems` scales
 * each ingredient's `quantityMultiplier` by `1 / servings` and the totals are a linear sum of those,
 * so `batch / servings` and `sum(perPortionRows)` are the same real number.
 *
 * `servings` of 0 or less cannot divide — a meal is at least one portion — so it falls back to the
 * batch, which is what `oneServingItems` does with the same guard.
 */
export function perPortion(batch: MealMacroTotals, servings: number): MealMacroTotals {
  if (!(servings > 0) || servings === 1) return batch
  return {
    calories: batch.calories / servings,
    protein: batch.protein / servings,
    carbs: batch.carbs / servings,
    fat: batch.fat / servings,
  }
}

/** Whether a second, per-portion line says anything the batch line does not. */
export function showsPerPortion(servings: number): boolean {
  return servings > 0 && servings !== 1
}
