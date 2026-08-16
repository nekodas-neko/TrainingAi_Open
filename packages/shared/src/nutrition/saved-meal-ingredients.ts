import type { SavedMeal, SavedMealItem, NutritionIngredient } from '../types/nutrition'

// Turning a saved meal into a meal plan's ingredient list (Q-192 / Q-193).
//
// A saved meal is items joined to `food_items` at a quantity multiplier; a plan meal is a flat
// snapshot of `NutritionIngredient`. The conversion has to go through per-100g densities rather
// than the item's own totals, because that is the only form the portion scaler can resize — and
// resizing is the whole point of putting a meal you already eat into a plan.
//
// `quantityMultiplier` is relative to the food item's own serving size, so the eaten weight is
// `servingSizeG × multiplier`, and the density is the item's macros scaled to 100 g of it.

/**
 * A saved meal expressed as plan ingredients.
 *
 * Items with a zero or missing serving size are skipped rather than guessed at: a density derived
 * from a divide-by-zero would silently poison every later rescale of that meal.
 */
export function savedMealToIngredients(meal: SavedMeal): NutritionIngredient[] {
  const out: NutritionIngredient[] = []
  for (const item of oneServingItems(meal)) {
    const food = item.foodItem
    if (!food) continue
    const servingG = Number(food.servingSizeG)
    if (!(servingG > 0)) continue

    const weightG = Math.round(servingG * Math.max(0, Number(item.quantityMultiplier) || 0))
    if (weightG <= 0) continue

    const per100 = 100 / servingG
    out.push({
      name: food.brand ? `${food.brand} ${food.name}` : food.name,
      weightG,
      caloriesPer100g: round1(Math.max(0, Number(food.calories) || 0) * per100),
      proteinPer100g: round1(Math.max(0, Number(food.proteinG) || 0) * per100),
      carbsPer100g: round1(Math.max(0, Number(food.carbsG) || 0) * per100),
      fatPer100g: round1(Math.max(0, Number(food.fatG) || 0) * per100),
    })
  }
  return out
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

/**
 * One portion's worth of a saved meal's items.
 *
 * A saved meal's items describe the **whole recipe**, which is often a batch — the owner's protein
 * ice cream makes two. Everything that treats a saved meal as something you eat *now* (logging it,
 * putting it in a plan slot) wants one portion, so the division lives here once rather than at each
 * call site. A meal that makes one serving is returned untouched, so nothing that predates
 * `servings` changes behaviour.
 */
export function oneServingItems(meal: SavedMeal): SavedMealItem[] {
  const items = meal.items ?? []
  const servings = Number(meal.servings)
  if (!(servings > 0) || servings === 1) return items
  return items.map(i => ({ ...i, quantityMultiplier: i.quantityMultiplier / servings }))
}
