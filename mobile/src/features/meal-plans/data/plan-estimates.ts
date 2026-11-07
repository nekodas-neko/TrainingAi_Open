import { msToHHMMInTz, toAestDay } from '@trainingai/shared/date-utils';
import { planEstimateAnswers } from '@trainingai/shared/nutrition/plan-estimate-answers';
import type { MealPlan as SharedMealPlan, MealType } from '@trainingai/shared/types/nutrition';
import type { MealPlan } from '../../nutrition/data/models.ts';
import type { NutritionStore } from '../../nutrition/data/NutritionStore.ts';

// Writing today's plan-meal estimates (#3650). A plan meal whose slot is over with nothing of its
// meal type logged and no answer is assumed eaten, and counts in the ring and the server's intake
// until the owner answers (#2122). The current app writes these when its plan card loads
// (`app/nutrition/use-plan-meal-logging.ts`); this is the same write for Preview, from the same
// shared rule (`planEstimateAnswers`) and through the same `plan_meal_answers` push branch, which
// leaves any answer already on the server alone.

/**
 * Queues the estimates owed for `date` and returns how many. Writes nothing for another day, a
 * split plan whose day type is unknown, or before today's food logs and plan answers have been read
 * from the server: estimating against a partial picture could add a meal the owner already logged
 * or declined in the other app.
 *
 * The payload carries no id. The server keeps the first live answer, so when the current app has
 * already written the same estimate the read-back still matches and nothing is set aside.
 */
export async function materialisePlanEstimates(input: {
  store: Pick<NutritionStore, 'enqueue' | 'view' | 'getSnapshot'>;
  date: string;
  timezone: string;
  plan: MealPlan | null | undefined;
  isTrainingDay: boolean | undefined;
  now?: number;
}): Promise<number> {
  const { store, date, timezone, plan } = input;
  const now = input.now ?? Date.now();
  if (!plan || date !== toAestDay(new Date(now), timezone)) return 0;
  const state = store.getSnapshot();
  if (
    !state.ready ||
    state.denied ||
    !state.loaded.includes('logs:' + date) ||
    !state.loaded.includes('answers:' + date)
  ) {
    return 0;
  }
  const view = store.view(date);
  const [h, m] = msToHHMMInTz(now, timezone).split(':').map(Number);
  const due = planEstimateAnswers({
    plan: plan as unknown as SharedMealPlan,
    isTrainingDay: input.isTrainingDay,
    mealTypes: view.mealTypes as unknown as MealType[],
    loggedMealTypeIds: new Set(view.logs.map((log) => log.mealTypeId)),
    answeredPlanMealIds: new Set(view.answers.map((a) => a.planMealId)),
    localHour: h + m / 60,
  });
  if (!due.length) return 0;
  await store.enqueue(
    due.map((e) => ({
      domain: 'plan_meal_answers' as const,
      date,
      payload: { ...e, logDate: date },
    })),
  );
  return due.length;
}
