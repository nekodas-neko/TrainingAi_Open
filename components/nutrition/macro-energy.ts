/**
 * How many calories each macro contributes, and its share of the total.
 *
 * The Atwater factors were written out longhand in four places before this — `MacroRing`'s split
 * arc would have been a fifth, and `saved-meal-card.tsx` already carried one.
 *
 * **LB-9 closed that: there is now exactly one copy**, `packages/shared/src/nutrition/atwater.ts`,
 * which `calorie-balance.ts` and `goal-recommendation.ts` also import. This module re-exports it so
 * existing `components/` imports keep working, and adds the two shapes only the UI needs.
 */
import { KCAL_PER_G } from '@trainingai/shared/nutrition/atwater'

export { KCAL_PER_G }

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
