import { KCAL_PER_G } from '@trainingai/shared/nutrition/atwater';
export { KCAL_PER_G };
export interface MacroGrams {
  proteinG: number;
  carbsG: number;
  fatG: number;
}
export function macroKcal({ proteinG, carbsG, fatG }: MacroGrams) {
  const protein = proteinG * KCAL_PER_G.protein;
  const carbs = carbsG * KCAL_PER_G.carbs;
  const fat = fatG * KCAL_PER_G.fat;
  return { protein, carbs, fat, total: protein + carbs + fat };
}
export function macroShares(grams: MacroGrams) {
  const kcal = macroKcal(grams);
  if (kcal.total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: kcal.protein / kcal.total,
    carbs: kcal.carbs / kcal.total,
    fat: kcal.fat / kcal.total,
  };
}
