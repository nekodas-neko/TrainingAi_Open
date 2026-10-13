import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload';
import type {
  NutritionIngredient,
  SavedMeal as SharedSavedMeal,
} from '@trainingai/shared/types/nutrition';
import { normaliseFood } from './food-values';
import type { Food, SavedMeal, Scan } from './models';
import { foodSchema, scaleFood } from './models';
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
export function recipeTotals(items: RecipeItem[], foods: Food[]) {
  return items.reduce(
    (sum, item) => {
      const f = item.food ?? foods.find((x) => x.id === item.foodItemId);
      if (!f) {
        return sum;
      }
      const scaled = scaleFood(f, item.quantityMultiplier);
      return {
        calories: sum.calories + scaled.calories,
        proteinG: sum.proteinG + scaled.proteinG,
        carbsG: sum.carbsG + scaled.carbsG,
        fatG: sum.fatG + scaled.fatG,
      };
    },
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
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
