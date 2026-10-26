import { useMemo } from 'react';
import { variantForEstimates } from '@trainingai/shared/nutrition/plan-variant';
import type { MealPlan as SharedMealPlan } from '@trainingai/shared/types/nutrition';
import { useNutrition } from '../nutrition/data/NutritionProvider';
import { planSpec } from '../nutrition/data/models';
import { useWorkoutResource } from '../workouts/data/WorkoutDataProvider';
import { estimateReminders, type MealEstimateReminder, type PlanMeal } from './data/estimated-meals';
import { knownTrainingDay, nextSessionSpec } from './data/next-session';

/**
 * Today's meal reminders (#2123), or null while they cannot be known yet. Only meal groups with
 * "Meal reminders" on take part, so nothing is fetched for anyone who has not asked for them. A
 * split plan on a day that is not known to be a training day or a rest day gets none, as the
 * estimator also declines it: guessing the day would ask about the wrong meals.
 */
export function useMealEstimateReminders(): MealEstimateReminder[] | null {
  const n = useNutrition();
  const wanted = n.view.mealTypes.some((type) => type.remindersEnabled);
  const plans = useWorkoutResource(planSpec, wanted);
  const next = useWorkoutResource(nextSessionSpec, wanted);
  const plan = plans.data?.plans.find((p) => p.id === plans.data?.activePlanId);
  const training = knownTrainingDay(next.data);
  const { answers, logs, mealTypes } = n.view;
  return useMemo(() => {
    if (!n.ready) return null;
    if (!wanted) return [];
    if (!plans.data || !plan) return plans.data ? [] : null;
    const variant = variantForEstimates(plan as unknown as SharedMealPlan, training);
    if (!variant) return [];
    return estimateReminders({
      date: n.today,
      tz: n.timezone,
      meals: variant.meals as unknown as PlanMeal[],
      answers,
      logs,
      mealTypes,
    });
  }, [n.ready, n.today, n.timezone, wanted, plans.data, plan, training, answers, logs, mealTypes]);
}
