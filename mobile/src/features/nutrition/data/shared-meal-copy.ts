import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload';
import { sharedIngredientToEntry } from '@trainingai/shared/nutrition/shared-meal-entry';
import type { z } from 'zod';
import type { FoodEntry } from './food-values.ts';
import { SavedMealSchema } from './models.ts';

/** What `NutritionStore.saveMeals` takes for one meal: the recipe, and the foods it names. */
export type MealCopy = { payload: z.infer<typeof SavedMealSchema>; foods: FoodEntry[] };

// The saved-meal and food-item schemas cap a name; a copy keeps the whole name up to those caps.
const MEAL_NAME_MAX = 120;
const FOOD_NAME_MAX = 200;

/**
 * A friend's (or a scanned) shared meal as a copy for the viewer's OWN library, ready for the store.
 *
 * A copy, never a reference: the ingredients become the viewer's own foods and the meal their own
 * meal, so it works offline and an edit by the author never reaches it. Every ingredient comes
 * across, however many there are, and the whole-recipe weight rides in the quantity multiplier, so
 * the copy's calories and macros match the original to the rounding the sender already applied. The
 * per-ingredient arithmetic is the shared `sharedIngredientToEntry`, the one the current app's scan
 * copy uses.
 *
 * Returns null when the meal cannot be a valid saved meal (no ingredients, or an amount or portion
 * count outside what the saved-meal schema takes). Nothing is trimmed or rescaled to make it fit:
 * a copy with different figures from its original would be wrong without anyone being able to tell.
 */
export function sharedMealCopy(shared: SharedMeal, uuid: () => string): MealCopy | null {
  const name = shared.name.trim().slice(0, MEAL_NAME_MAX);
  if (!name || shared.ingredients.length === 0) {
    return null;
  }
  const foods: FoodEntry[] = [];
  const items: { foodItemId: string; quantityMultiplier: number }[] = [];
  for (const ingredient of shared.ingredients) {
    const { item, quantityMultiplier } = sharedIngredientToEntry(ingredient);
    const id = uuid();
    foods.push({
      ...item,
      name: item.name.trim().slice(0, FOOD_NAME_MAX) || 'Ingredient',
      id,
      quantityMultiplier: 1,
    });
    items.push({ foodItemId: id, quantityMultiplier });
  }
  const payload = SavedMealSchema.safeParse({ name, servings: shared.servings, items });
  return payload.success ? { payload: payload.data, foods } : null;
}
