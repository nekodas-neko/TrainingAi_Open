/**
 * How many calories each macro contributes, and its share of the total.
 *
 * The Atwater factors were written out longhand in four places before this — `MacroRing`'s new
 * split arc would have been a fifth, and `saved-meal-card.tsx` already carried one. This is the one
 * copy `components/` uses.
 *
 * **The other two live in `packages/shared/` and are Lane A's to fold in:**
 * `calorie-balance.ts` has a `KCAL_PER_G` that is not exported, and `goal-recommendation.ts`
 * hardcodes `* 4` / `* 9` at three call sites. Filed as LB-9 — this module cannot reach across that
 * boundary, and adding a sixth copy to close a gap is how there came to be four.
 */

/** Atwater factors: the calories in a gram of each macronutrient. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const

export interface MacroGrams {
  proteinG: number
  carbsG: number
  fatG: number
}

/** Calories from each macro, and their sum. */
export function macroKcal({ proteinG, carbsG, fatG }: MacroGrams) {
  const protein = proteinG * KCAL_PER_G.protein
  const carbs = carbsG * KCAL_PER_G.carbs
  const fat = fatG * KCAL_PER_G.fat
  return { protein, carbs, fat, total: protein + carbs + fat }
}

/**
 * Each macro's share of the calories the macros account for, as a fraction of 1.
 *
 * Deliberately measured against the macro total rather than a logged calorie figure: the two
 * disagree whenever a food's calories were entered independently of its macros, and a share that
 * does not add to 1 draws a ring with a gap in it that means nothing. All zeroes returns all zeroes
 * rather than dividing by it.
 */
export function macroShares(grams: MacroGrams) {
  const kcal = macroKcal(grams)
  if (kcal.total <= 0) return { protein: 0, carbs: 0, fat: 0 }
  return {
    protein: kcal.protein / kcal.total,
    carbs: kcal.carbs / kcal.total,
    fat: kcal.fat / kcal.total,
  }
}
