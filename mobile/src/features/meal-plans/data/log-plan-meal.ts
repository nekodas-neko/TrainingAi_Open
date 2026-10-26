import { secondsSinceLocalMidnight } from '@trainingai/shared/date-utils';
import { mealTypeForHour } from '@trainingai/shared/nutrition/meal-type-for-time';
import type { MealType } from '@trainingai/shared/types/nutrition';
import { ingredientItems } from '../../nutrition/data/recipes.ts';
import type { NutritionStore } from '../../nutrition/data/NutritionStore.ts';
import type { MealPlan } from '../../nutrition/data/models.ts';

type Meal = MealPlan['variants'][number]['meals'][number];
/** What logging a plan meal needs of the nutrition context. */
export type PlanLogging = {
  store: Pick<NutritionStore, 'logFoods'> | null;
  timezone: string;
  view: { mealTypes: readonly unknown[] };
};

/**
 * Writes a plan meal's ingredients as food logs. `mealTypeId` puts them under a given meal group,
 * as when a plan meal is eaten in place of an estimated one; `clearEstimateFor` ends that meal's
 * estimate in the same write (#2123).
 */
export async function logPlanMeal(
  n: PlanLogging,
  m: Meal,
  date: string,
  uuid: () => string,
  options: { mealTypeId?: string; clearEstimateFor?: string } = {},
) {
  if (!n.store) {
    throw new Error('Connect your account.');
  }
  const hour = m.suggestedTime
    ? Number(m.suggestedTime.split(':')[0])
    : Math.floor(secondsSinceLocalMidnight(n.timezone) / 3600);
  const bucket =
    options.mealTypeId ??
    m.mealTypeId ??
    mealTypeForHour(n.view.mealTypes as unknown as MealType[], hour);
  if (!bucket) {
    throw new Error('Create a meal group first.');
  }
  if (!m.ingredients.length) {
    throw new Error(
      'This older plan has no ingredients to log. Log your actual food, or replace this meal first.',
    );
  }
  await n.store.logFoods(
    ingredientItems(m.ingredients, 1, uuid).flatMap((item) =>
      item.food
        ? [
            {
              ...item.food,
              id: undefined,
              source: 'ai',
              quantityMultiplier: item.quantityMultiplier,
            },
          ]
        : [],
    ),
    date,
    bucket,
    { name: m.name, savedMealId: m.savedMealId ?? undefined },
    options.clearEstimateFor,
  );
}
