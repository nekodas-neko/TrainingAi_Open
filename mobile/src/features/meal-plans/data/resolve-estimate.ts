import type { Food } from '../../nutrition/data/models.ts';
import type { NutritionStore } from '../../nutrition/data/NutritionStore.ts';
import { logPlanMeal, type PlanLogging } from './log-plan-meal.ts';
import type { EstimatedMeal, PlanMeal } from './estimated-meals.ts';

// Answering an estimated meal (#2123). Every write goes through the nutrition store's queue, which
// keeps the local copy in step at once and syncs to the server's existing `plan_meal_answers` and
// `food_logs` handlers (ownership-checked there). The estimate is cleared with a soft delete, so a
// device that has not synced yet learns of it.
export type ResolveContext = PlanLogging & {
  store: Pick<NutritionStore, 'logFoods' | 'enqueue'> | null;
};
/** The slot being answered: the plan meal and the meal group its food belongs in. */
export type Slot = { meal: PlanMeal & { id: string }; mealTypeId: string; hasEstimate: boolean };

export const slotOf = (estimated: EstimatedMeal): Slot => ({
  meal: estimated.meal,
  mealTypeId: estimated.mealTypeId,
  hasEstimate: true,
});

/** "I ate this": the assumed meal becomes a food log and its estimate is cleared. */
export function ateAssumed(n: ResolveContext, slot: Slot, date: string, uuid: () => string) {
  return logPlanMeal(n, slot.meal, date, uuid, {
    mealTypeId: slot.mealTypeId,
    clearEstimateFor: slot.hasEstimate ? slot.meal.id : undefined,
  });
}

/** "I ate something else", from the plan: another plan meal is logged in this slot. */
export function ateOtherPlanMeal(
  n: ResolveContext,
  slot: Slot,
  other: PlanMeal,
  date: string,
  uuid: () => string,
) {
  return logPlanMeal(n, other, date, uuid, {
    mealTypeId: slot.mealTypeId,
    clearEstimateFor: slot.hasEstimate ? slot.meal.id : undefined,
  });
}

/** "I ate something else", from what is usually eaten at this time: one serving of that food. */
export async function ateUsualFood(n: ResolveContext, slot: Slot, food: Food, date: string) {
  if (!n.store) throw new Error('Connect your account.');
  await n.store.logFoods(
    [{ ...food, quantityMultiplier: 1 }],
    date,
    slot.mealTypeId,
    { name: food.name },
    slot.hasEstimate ? slot.meal.id : undefined,
  );
}

/** "I skipped it": the existing "no" answer, which also replaces the estimate. */
export async function skipAssumed(n: ResolveContext, slot: Slot, date: string) {
  if (!n.store) throw new Error('Connect your account.');
  await n.store.enqueue([
    { domain: 'plan_meal_answers', date, payload: { planMealId: slot.meal.id, logDate: date } },
  ]);
}
