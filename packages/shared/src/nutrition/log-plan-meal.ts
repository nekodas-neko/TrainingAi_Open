import type { FoodLogWithItem, MealType, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { DEFAULT_TZ } from '../date-utils'
import { logFoodEntries, type NewFoodEntry } from '@trainingai/shared/nutrition/log-food'

/**
 * Logging a meal the plan suggested.
 *
 * Q-187 phase 2 is the automatic prefill — the day's meals filled in with a yes/no per meal, plus
 * the "prefilled but unconfirmed" state that has to exist so the energy-balance bar never reports
 * food nobody ate. **This is deliberately the half that needs none of that**: the user taps the
 * button, so the tap IS the confirmation. There is no unconfirmed state to invent, no new table,
 * and no risk of totals counting a meal that was only suggested.
 *
 * It also means the plan finally does something on the day it is for. Until this, a plan told you
 * what to eat and then played no part in the day at all.
 */

/**
 * A plan ingredient as something loggable.
 *
 * The serving size is **100 g and the quantity carries the weight**, rather than a serving of
 * exactly this portion. That is the difference between the library gaining "Cooked quinoa" — a
 * thing you can log again at any weight — and gaining "Cooked quinoa (236 g)", which is useful
 * once and clutter forever.
 *
 * Exported because copying a planned meal into the saved-meal library (Q-398) has to mint the same
 * food items with the same numbers — a second conversion would drift the first time either side
 * rounded differently.
 */
export function ingredientToEntry(ing: NutritionIngredient): NewFoodEntry {
  return {
    name: ing.name,
    servingSizeG: 100,
    calories: Math.round(ing.caloriesPer100g),
    proteinG: ing.proteinPer100g,
    carbsG: ing.carbsPer100g,
    fatG: ing.fatPer100g,
    source: 'ai',
    quantityMultiplier: Math.round((ing.weightG / 100) * 100) / 100,
  }
}

/**
 * Which meal bucket a time of day falls in.
 *
 * Shared because the saved-meals sheet decides this the same way, and two copies would drift the
 * moment someone edits their meal-type hours. Falls back to the first bucket rather than refusing —
 * a gap in the user's configured hours should not lose a log.
 */
export function mealTypeForHour(mealTypes: MealType[], hour: number): string | null {
  return mealTypes.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)?.id
    ?? mealTypes[0]?.id
    ?? null
}

export interface PlanMealToLog {
  name: string
  ingredients: NutritionIngredient[]
  /** The plan's own bucket for this meal, when it has one. */
  mealTypeId?: string | null
  /** 'HH:MM' — used to pick a bucket when the meal has none of its own. */
  suggestedTime?: string | null
}

/**
 * Log every ingredient of a planned meal as its own food log.
 *
 * Per-ingredient rather than one lump, so the day's entry reads like food rather than like a plan,
 * and so a single item can be edited or removed afterwards without discarding the meal.
 *
 * The bucket is the meal's own `mealTypeId` when it has one; otherwise the plan's suggested time,
 * which is more honest than "now" — logging the 07:00 breakfast at 3pm should still land under
 * breakfast.
 */
export async function logPlanMeal(
  meal: PlanMealToLog,
  mealTypes: MealType[],
  date: string,
  userId?: string,
  now: Date = new Date(),
  tz: string = DEFAULT_TZ,
): Promise<FoodLogWithItem[]> {
  if (meal.ingredients.length === 0) {
    throw new Error('This meal has no ingredients to log')
  }

  const suggestedHour = meal.suggestedTime
    ? Number.parseInt(meal.suggestedTime.split(':')[0] ?? '', 10)
    : Number.NaN
  const hour = Number.isFinite(suggestedHour) ? suggestedHour : now.getHours()

  const mealTypeId = meal.mealTypeId ?? mealTypeForHour(mealTypes, hour)
  if (!mealTypeId) throw new Error('No meal type available')

  return logFoodEntries(meal.ingredients.map(ingredientToEntry), date, mealTypeId, userId, tz)
}
