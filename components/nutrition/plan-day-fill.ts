import type { MealPlanMeal, MealType } from '@trainingai/shared/types/nutrition'

/**
 * Which planned meals a one-tap "log the day" action should write (Q-187, step 4).
 *
 * The plan's phases 1–3 shipped a per-meal *"I ate this"* and a per-meal decline. What was left was
 * the automatic half — and the plan's own recommendation was an **explicit action rather than a
 * prefill on day open**, because a prefill that guesses wrong trains you to ignore it.
 *
 * **The action is bounded by time, and that is the decision this module exists to hold.** The
 * property the whole Q-187 design protects is that the day's totals never count food nobody ate:
 * unconfirmed prefills stay out of `food_logs` entirely, so no reader can miscount. A button that
 * logs the *whole* day would hand that property back — press it at 9am and the macro bars report a
 * full day eaten, including a dinner that has not happened. The tap is a confirmation, and you
 * cannot confirm a meal you have not had.
 *
 * So on **today** it offers only the meals whose time has come; on a **past** day it offers all of
 * them, which is the retrospective-logging case and the one people actually use; on a **future**
 * day it offers nothing.
 */

/**
 * When a planned meal is meant to happen, as an hour of the day.
 *
 * `suggestedTime` wins over the meal's bucket because it is the more specific answer to *when* —
 * a bucket is a window, and its start hour is only a stand-in. Null when neither is available,
 * which a plan saved before `suggestedTime` existed and carrying no `mealTypeId` can be.
 */
export function planMealHour(meal: MealPlanMeal, mealTypes: MealType[]): number | null {
  if (meal.suggestedTime) {
    const hour = Number.parseInt(meal.suggestedTime.split(':')[0] ?? '', 10)
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) return hour
  }
  if (meal.mealTypeId) {
    const bucket = mealTypes.find(t => t.id === meal.mealTypeId)
    if (bucket) return bucket.timeStartHour
  }
  return null
}

/**
 * The hour of day out of `nowDatetimeInTz`'s `"YYYY/MM/DD HH:MM"`.
 *
 * Here rather than sliced at the call site so the format assumption sits in one place and under
 * test — a slice that silently returns `NaN` would make every meal look not-yet-due, which reads as
 * a button that has stopped working rather than as a parse failure.
 */
export function hourFromTzDatetime(s: string): number | null {
  const hour = Number.parseInt(s.split(' ')[1]?.split(':')[0] ?? '', 10)
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null
}

export interface FillableInput {
  meals: MealPlanMeal[]
  mealTypes: MealType[]
  /** The day the Nutrition tab is showing, `YYYY-MM-DD`. */
  selectedDate: string
  /** Today in the USER's timezone — never the device's. */
  today: string
  /** The current hour in the user's timezone, 0–23. Only consulted when the two dates match. */
  nowHour: number
  /** Positions already logged, derived from the day's food (see `use-plan-meal-logging.ts`). */
  loggedPositions: Set<number>
  /** Plan-meal ids the user said they did not eat. */
  declinedMealIds: Set<string>
}

/**
 * The meals the action would log, in plan order. Empty means the button has nothing to do and
 * should not be shown at all — a control that does nothing is worse than no control.
 */
export function fillableMeals(input: FillableInput): MealPlanMeal[] {
  const { meals, mealTypes, selectedDate, today, nowHour, loggedPositions, declinedMealIds } = input
  if (selectedDate > today) return []
  const past = selectedDate < today

  return meals.filter(meal => {
    // A plan saved before Q-192 stored names and macros but no ingredients, and there is nothing to
    // write from those.
    if (meal.ingredients.length === 0) return false
    if (loggedPositions.has(meal.position)) return false
    if (declinedMealIds.has(meal.id)) return false
    if (past) return true
    const hour = planMealHour(meal, mealTypes)
    // A meal whose time cannot be resolved is not offered on today: unlike a past day, there is no
    // way to establish it has already happened, and the failure mode of guessing is logging food
    // that was not eaten.
    return hour != null && hour <= nowHour
  })
}
