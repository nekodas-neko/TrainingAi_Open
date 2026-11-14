import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload';
import type {
  NutritionIngredient,
  SavedMeal as SharedSavedMeal,
} from '@trainingai/shared/types/nutrition';
import { normaliseFood } from './food-values';
import type { Food, SavedMeal, Scan } from './models';
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit';
import { foodSchema } from './models';
export function asSharedMeal(meal: SavedMeal): SharedSavedMeal {
  return meal as unknown as SharedSavedMeal;
}
export type RecipeItem = { foodItemId: string; quantityMultiplier: number; food?: Food | null };
export function ingredientItems(
  ingredients: NutritionIngredient[],
  servings = 1,
  uuid: () => string = () => crypto.randomUUID(),
): RecipeItem[] {
  return ingredients
    .filter((i) => i.weightG > 0)
    .map((i) => {
      const id = uuid();
      const serving = i.weightG * servings < 1 ? 10 : 100;
      const density = serving / 100;
      return {
        foodItemId: id,
        quantityMultiplier: (i.weightG * servings) / serving,
        food: foodSchema.parse({
          source: 'text',
          ...normaliseFood(
            {
              id,
              name: i.name,
              servingSizeG: serving,
              calories: i.caloriesPer100g * density,
              proteinG: i.proteinPer100g * density,
              carbsG: i.carbsPer100g * density,
              fatG: i.fatPer100g * density,
              source: 'text',
              quantityMultiplier: 1,
            },
            id,
          ),
        }),
      };
    });
}
export function sharedMealIngredients(meal: SharedMeal): NutritionIngredient[] {
  return meal.ingredients.map((i) => ({
    name: i.name,
    weightG: i.weightG / meal.servings,
    caloriesPer100g: i.weightG > 0 ? (i.calories * 100) / i.weightG : 0,
    proteinPer100g: i.weightG > 0 ? (i.proteinG * 100) / i.weightG : 0,
    carbsPer100g: i.weightG > 0 ? (i.carbsG * 100) / i.weightG : 0,
    fatPer100g: i.weightG > 0 ? (i.fatG * 100) / i.weightG : 0,
  }));
}
export function scanRecipe(scan: Scan, yieldCount: number, uuid?: () => string) {
  return {
    name: scan.name,
    servings: String(yieldCount),
    items: ingredientItems(scan.ingredients ?? [], yieldCount, uuid),
    imageDataUri: scan.imageDataUri ?? null,
    mealTypeIds: [] as string[],
    url: '',
  };
}
/**
 * A recipe's totals: each ingredient scaled, summed through the shared `sumMacroTotals`, and the
 * TOTAL rounded (whole kcal, 0.1 g), as the server's sum is. Rounding each ingredient first, as
 * this did, drifts from the saved figure by up to half a unit per ingredient (#3756).
 */
export function recipeTotals(items: RecipeItem[], foods: Food[]) {
  const sum = sumMacroTotals(
    items.map((item) => {
      const f = item.food ?? foods.find((x) => x.id === item.foodItemId);
      const q = item.quantityMultiplier;
      return f
        ? {
            calories: f.calories * q,
            proteinG: f.proteinG * q,
            carbsG: f.carbsG * q,
            fatG: f.fatG * q,
          }
        : null;
    }),
  );
  const tenth = (value: number) => Math.round(value * 10) / 10;
  return {
    calories: Math.round(sum.calories),
    proteinG: tenth(sum.proteinG),
    carbsG: tenth(sum.carbsG),
    fatG: tenth(sum.fatG),
  };
}
export function recipeDuplicate(
  name: string,
  servings: number,
  items: RecipeItem[],
  foods: Food[],
  meals: SavedMeal[],
) {
  const total = recipeTotals(items, foods);
  return meals.find(
    (m) =>
      m.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      ['calories', 'proteinG', 'carbsG', 'fatG'].every(
        (key) =>
          Math.abs(
            m.totals[key as keyof typeof total] / m.servings -
              total[key as keyof typeof total] / servings,
          ) < 1,
      ),
  );
}
