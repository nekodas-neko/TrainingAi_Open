import type { MealPlanDayType } from '../types/nutrition'

/**
 * What a rest day means, in one place (LA-131).
 *
 * The reduction and the three lines that derive from it were declared separately in the meal-plan
 * *generate* and *restructure* routes — the two paths that write variants for the same plan. Tuning
 * one copy and not the other would have made a restructure silently re-target every rest-day meal
 * against a different definition of a rest day than the one that generated it, and neither number
 * would have looked wrong.
 */
export const REST_DAY_CARB_REDUCTION = 0.15

export interface DayMacros {
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

export interface DayMacroTargets extends DayMacros {
  /** Grams of carbohydrate removed — 0 on any day that is not a rest day. */
  carbShiftG: number
}

/**
 * Daily macros adjusted for the day type. Protein and fat are held and only carbohydrate moves,
 * per D3; removing carbohydrate removes its calories too, at 4 kcal/g.
 */
export function macrosForDayType(daily: DayMacros, dayType: MealPlanDayType): DayMacroTargets {
  const carbShiftG = dayType === 'rest' ? Math.round(daily.carbsG * REST_DAY_CARB_REDUCTION) : 0
  return {
    carbShiftG,
    calories: daily.calories - carbShiftG * 4,
    proteinG: daily.proteinG,
    carbsG: daily.carbsG - carbShiftG,
    fatG: daily.fatG,
  }
}
