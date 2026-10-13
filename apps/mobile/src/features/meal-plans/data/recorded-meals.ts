import { planMealTypeId } from '@trainingai/shared/nutrition/meal-type-for-time';
import type { MealType } from '@trainingai/shared/types/nutrition';
export function plannedMealRecorded(
  meal: {
    name: string;
    mealTypeId?: string | null;
    suggestedTime?: string | null;
    ingredients: { name: string }[];
  },
  logs: { mealTypeId: string; mealGroupName?: string | null; foodItem: { name: string } }[],
  types: MealType[],
) {
  const type = planMealTypeId(meal, types);
  const rows = type ? logs.filter((x) => x.mealTypeId === type) : logs;
  if (rows.some((x) => x.mealGroupName === meal.name)) return true;
  if (!type || !meal.ingredients.length) return false;
  const names = new Set(rows.map((x) => x.foodItem.name.toLowerCase()));
  return meal.ingredients.every((x) => names.has(x.name.toLowerCase()));
}
