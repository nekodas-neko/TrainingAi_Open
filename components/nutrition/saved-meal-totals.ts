import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { oneServingItems } from '@trainingai/shared/nutrition/saved-meal-ingredients'

export interface MealItemRow {
  id: string
  name: string
  weightG: number
  /** How many of the food item's own servings this row is, for the rows that have one. */
  servings: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface MealTotals {
  weightG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

function toRows(items: ReturnType<typeof oneServingItems>): MealItemRow[] {
  return items.map(item => {
    const q = item.quantityMultiplier
    const f = item.foodItem
    return {
      id: item.id,
      name: f?.brand ? `${f.brand} ${f.name}` : f?.name ?? 'Unknown item',
      weightG: (f?.servingSizeG ?? 0) * q,
      servings: q,
      calories: (f?.calories ?? 0) * q,
      proteinG: (f?.proteinG ?? 0) * q,
      carbsG: (f?.carbsG ?? 0) * q,
      fatG: (f?.fatG ?? 0) * q,
    }
  })
}

/**
 * One portion of a saved meal — what "Log this meal" writes, and what the library row shows.
 *
 * A batch recipe's items describe the whole recipe; `oneServingItems` divides by `servings`.
 */
export function portionRows(meal: SavedMeal): MealItemRow[] {
  return toRows(oneServingItems(meal))
}

/**
 * The recipe as entered — every ingredient at the amount the batch actually contains.
 *
 * Artboard 4 lists ingredients as the **whole batch** while its headline figure and macro columns
 * are **per portion**, and labels both. That is not an inconsistency to iron out: the batch is what
 * you cook and the portion is what you eat, and a recipe that shows you half an egg is useless.
 */
export function batchRows(meal: SavedMeal): MealItemRow[] {
  return toRows(meal.items ?? [])
}

export function sumRows(rows: MealItemRow[]): MealTotals {
  return rows.reduce<MealTotals>((a, r) => ({
    weightG: a.weightG + r.weightG,
    calories: a.calories + r.calories,
    proteinG: a.proteinG + r.proteinG,
    carbsG: a.carbsG + r.carbsG,
    fatG: a.fatG + r.fatG,
  }), { weightG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })
}
