// BF-203a (meal-plan tracking, phase A). The pure half of the estimate: given today's plan slots,
// which meal types have food logged, which slots were declined, and the local hour, decide which
// slots are owed an estimate and at what macros. No I/O, no clock, no timezone maths — the caller
// resolves the user-local hour and passes it in, which is what makes the boundary testable.

import type { MealType } from '@trainingai/shared/types/nutrition'
import { planMealTypeId } from './meal-type-for-time'

export interface EstimateSlot {
  planMealId: string
  /** The plan meal's stored meal type (LA-172 gives every timed meal one). */
  mealTypeId: string
  /** Local hour at or after which the slot is over. See `slotCloseHour`. */
  closeHour: number
  targetCalories: number
  targetProteinG: number
  targetCarbsG: number
  targetFatG: number
}

export interface EstimateDue {
  planMealId: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  biasKcal: number
}

/**
 * The local hour a slot is over: the later of its meal type's end and one hour past its suggested
 * time. The type's end alone is wrong for a meal filed under the NEAREST window (LA-172): a 16:20
 * meal typed Lunch (12–15) would be estimated at 15:00, before it was due. `null` when neither is
 * known, and such a slot is never estimated.
 */
export function slotCloseHour(typeEndHour: number | null | undefined, suggestedTime: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(suggestedTime ?? '')
  const suggested = m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) + Number(m[2]) / 60 + 1 : null
  const end = typeof typeEndHour === 'number' ? typeEndHour : null
  if (end == null && suggested == null) return null
  return Math.max(end ?? 0, suggested ?? 0)
}

/**
 * The estimate slots of one plan variant. A meal's type is its stored tag, else the window its
 * suggested time falls in or is nearest to (LA-172's rule, the same one the server stores). A meal
 * with no resolvable type or close hour is left out: it can never be estimated, rather than being
 * estimated at a guessed time.
 */
export function estimateSlotsFor(
  meals: readonly { id: string; mealTypeId: string | null; suggestedTime: string | null; targetCalories: number; targetProteinG: number; targetCarbsG: number; targetFatG: number }[],
  mealTypes: readonly MealType[],
): EstimateSlot[] {
  const slots: EstimateSlot[] = []
  for (const m of meals) {
    const mealTypeId = planMealTypeId(m, mealTypes as MealType[])
    if (!mealTypeId) continue
    const type = mealTypes.find(t => t.id === mealTypeId)
    const closeHour = slotCloseHour(type?.timeEndHour, m.suggestedTime)
    if (closeHour == null) continue
    slots.push({
      planMealId: m.id, mealTypeId, closeHour,
      targetCalories: m.targetCalories, targetProteinG: m.targetProteinG,
      targetCarbsG: m.targetCarbsG, targetFatG: m.targetFatG,
    })
  }
  return slots
}

export function dueForEstimate(input: {
  slots: readonly EstimateSlot[]
  /**
   * Meal types with food logged today. Matching is by meal type because `food_logs` has no plan-meal
   * id. **A logged meal satisfies EVERY slot of its type**: when two slots share a type, one of them
   * goes un-estimated rather than both being counted on top of real food. A missed estimate
   * under-counts by one meal; a double estimate invents calories the owner then acts on.
   */
  loggedMealTypeIds: ReadonlySet<string>
  /** Plan meals with any live answer today: a decline, or an estimate already written. */
  answeredPlanMealIds: ReadonlySet<string>
  /** Hour in the USER's timezone, fractional allowed, resolved by the caller. */
  localHour: number
  /** kcal/day of bias (phase C). Zero until that ships. */
  biasKcal: number
}): EstimateDue[] {
  const { slots, loggedMealTypeIds, answeredPlanMealIds, localHour, biasKcal } = input
  const due = slots.filter(
    s => localHour >= s.closeHour
      && !loggedMealTypeIds.has(s.mealTypeId)
      && !answeredPlanMealIds.has(s.planMealId),
  )
  // Spread the day's bias across the slots being estimated in proportion to their size, so a large
  // dinner absorbs more of it than a small snack.
  const total = due.reduce((sum, s) => sum + s.targetCalories, 0)
  return due.map(s => {
    const share = total > 0 ? (s.targetCalories / total) * biasKcal : 0
    return {
      planMealId: s.planMealId,
      calories: Math.max(0, Math.round(s.targetCalories + share)),
      proteinG: s.targetProteinG,
      carbsG: s.targetCarbsG,
      fatG: s.targetFatG,
      biasKcal,
    }
  })
}
