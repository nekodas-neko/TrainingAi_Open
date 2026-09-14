import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import type { IngredientEntry } from './use-ingredient-quantities'

/**
 * A saved meal, as ingredients the builder can hold (BF-161).
 *
 * The owner: *"For the meal builder it should let you add meals/saved items as part of the meal
 * builder."* The schema forbids real nesting — `saved_meal_items.food_item_id` is NOT NULL, so
 * there is no column a nested meal could occupy — and the owner chose flattening over a migration:
 * *"Okay lets go with flatten for now."*
 *
 * **So this is a snapshot, deliberately.** Editing the source meal afterwards does not change a
 * meal built from it. That is the cost of not paying for a nullable `food_item_id`, recursive macro
 * computation in every consumer, and cycle prevention (meal A contains B contains A) — and it is
 * why nothing on screen may imply a live link back to the source.
 *
 * Quantities come through at their stored multiplier, which is the WHOLE recipe rather than one
 * portion: `SavedMeal.totals` is documented as the whole recipe and `servings` is what to divide it
 * by. Adding the whole thing is what makes BF-161's check — that the result matches the sum of the
 * sources — true as stated.
 */
export function savedMealToEntries(meal: SavedMeal): IngredientEntry[] {
  return meal.items.map(i => ({ item: i.foodItem, qty: i.quantityMultiplier }))
}

/** Meals whose name matches what has been typed. An empty query lists them all, like the food side. */
export function matchSavedMeals(meals: SavedMeal[], query: string): SavedMeal[] {
  const q = query.trim().toLowerCase()
  if (!q) return meals
  return meals.filter(m => m.name.toLowerCase().includes(q))
}
