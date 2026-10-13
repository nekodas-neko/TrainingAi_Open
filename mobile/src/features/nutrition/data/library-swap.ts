import {
  selectLibraryMeals,
  type MealTypeWindow,
} from '@trainingai/shared/nutrition/library-match';
import { parseTimeToMinutes } from '@trainingai/shared/nutrition/meal-split';
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients';
import type { SavedMeal } from '@trainingai/shared/types/nutrition';
import type { DraftMeal } from './plan-draft';
export interface LibrarySwap {
  meal: SavedMeal;
  matchReason: string;
}
export function libraryMealForSlot(
  slot: DraftMeal,
  library: SavedMeal[],
  mealTypes: MealTypeWindow[],
  usedSavedMealIds: string[],
): LibrarySwap | null {
  const timeMinutes = parseTimeToMinutes(slot.suggestedTime);
  if (timeMinutes == null) return null;
  const exclude = new Set(usedSavedMealIds);
  if (slot.savedMealId) exclude.add(slot.savedMealId);
  const [pick] = selectLibraryMeals(
    [
      {
        index: slot.position,
        timeMinutes,
        target: {
          calories: slot.targetCalories,
          proteinG: slot.targetProteinG,
          carbsG: slot.targetCarbsG,
          fatG: slot.targetFatG,
        },
      },
    ],
    library
      .filter((m) => !exclude.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        mealTypeIds: m.mealTypeIds,
        ingredients: savedMealToIngredients(m),
      })),
    mealTypes,
  );
  if (!pick) return null;
  const meal = library.find((m) => m.id === pick.meal.id);
  return meal ? { meal, matchReason: pick.matchReason } : null;
}
export function usedSavedMealIds(meals: DraftMeal[]): string[] {
  return meals.map((m) => m.savedMealId).filter((id): id is string => id != null);
}
