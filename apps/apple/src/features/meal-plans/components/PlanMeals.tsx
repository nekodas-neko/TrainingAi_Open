import { plannedMealRecorded } from '../data/recorded-meals';
import {
  daysBetweenDateStrs,
  secondsSinceLocalMidnight,
  toAestDay,
} from '@trainingai/shared/date-utils';
import { planMealTypeId } from '@trainingai/shared/nutrition/meal-type-for-time';
import { mealTypeForHour } from '@trainingai/shared/nutrition/meal-type-for-time';
import type { MealType } from '@trainingai/shared/types/nutrition';
import { randomUUID } from 'expo-crypto';
import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  AppButton,
  AppText,
  Badge,
  Card,
  Disclosure,
  Stack,
  StatusIndicator,
} from '../../../shared/ui';
import { energySpec } from '../../health/data/models';
import { MacroLine } from '../../nutrition/components/NutritionElements';
import { planSpec, type MealPlan } from '../../nutrition/data/models';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { ingredientItems, recipeDuplicate } from '../../nutrition/data/recipes';
import {
  useWorkoutResource,
  useWorkoutResources,
} from '../../workouts/data/WorkoutDataProvider';
type Nutrition = ReturnType<typeof useNutrition>;
type Meal = MealPlan['variants'][number]['meals'][number];
export async function logPlanMeal(n: Nutrition, m: Meal, date: string, _plan?: MealPlan) {
  if (!n.store) {
    throw new Error('Connect your account.');
  }
  const hour = m.suggestedTime
    ? Number(m.suggestedTime.split(':')[0])
    : Math.floor(secondsSinceLocalMidnight(n.timezone) / 3600);
  const bucket =
    m.mealTypeId ?? mealTypeForHour(n.view.mealTypes as unknown as MealType[], hour);
  if (!bucket) {
    throw new Error('Create a meal group first.');
  }
  if (!m.ingredients.length) {
    throw new Error(
      'This older plan has no ingredients to log. Log your actual food, or replace this meal first.',
    );
  }
  await n.store.logFoods(
    ingredientItems(m.ingredients, 1, randomUUID).flatMap((item) =>
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
  );
}
export async function savePlanMeal(n: Nutrition, m: Meal) {
  if (!n.store || !m.id || !m.ingredients.length) {
    return;
  }
  const view = n.store.view(n.date);
  const linked = view.planLinks[m.id] ?? m.savedMealId;
  if (linked && view.meals.some((meal) => meal.id === linked)) {
    return;
  }
  const items = ingredientItems(m.ingredients, 1, randomUUID);
  const duplicate = recipeDuplicate(m.name, 1, items, view.foods, view.meals);
  const id =
    duplicate?.id ??
    (await n.store.saveMeal(
      {
        name: m.name,
        servings: 1,
        mealTypeIds: m.mealTypeId ? [m.mealTypeId] : [],
        items: items.map((i) => ({
          foodItemId: i.foodItemId,
          quantityMultiplier: i.quantityMultiplier,
        })),
      },
      n.today,
      items.flatMap((i) =>
        i.food ? [{ ...i.food, source: 'ai', quantityMultiplier: 1 }] : [],
      ),
    ));
  await n.store.queueHttp('plan-link', n.today, { planMealId: m.id, savedMealId: id });
}
export function ActiveMealPlan({
  date,
  onManage,
  onSetup,
}: {
  date: string;
  onManage: (plan?: MealPlan) => void;
  onSetup: (plan?: MealPlan) => void;
}) {
  const n = useNutrition(date);
  const resources = useWorkoutResources();
  const state = useWorkoutResource(planSpec);
  const energy = useWorkoutResource(energySpec(date));
  const rec = useWorkoutResource(
    {
      path: '/api/next-session',
      ttl: 300000,
      schema: z
        .object({
          isRestDay: z.boolean(),
          session: z.object({ id: z.string() }).passthrough().nullish(),
        })
        .passthrough(),
    },
    date === n.today,
  );
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const plan = state.data?.plans.find((p) => p.id === state.data?.activePlanId);
  const knownTraining =
    date !== n.today || !rec.data
      ? undefined
      : rec.data.isRestDay
        ? false
        : rec.data.session
          ? true
          : undefined;
  const variant =
    plan?.variants.find((v) => v.dayType === 'all') ??
    plan?.variants.find((v) => v.dayType === (knownTraining ? 'training' : 'rest')) ??
    plan?.variants[0];
  const hour = secondsSinceLocalMidnight(n.timezone) / 3600;
  const logged = (m: Meal) =>
    plannedMealRecorded(m, n.view.logs, n.view.mealTypes as unknown as MealType[]);
  const answer = (m: Meal) => n.view.answers.find((a) => a.planMealId === m.id);
  const skipped = (m: Meal) => {
    const type = planMealTypeId(
      { ...m, mealTypeId: m.mealTypeId ?? null, suggestedTime: m.suggestedTime ?? null },
      n.view.mealTypes as unknown as MealType[],
    );
    return !!type && n.view.mealStatuses[type] === 'skipped';
  };
  const declined = (m: Meal) => answer(m) != null && answer(m)?.answer !== 'estimated';
  const eligible = (variant?.meals ?? []).filter((m) => {
    const start = m.suggestedTime
      ? Number(m.suggestedTime.split(':')[0])
      : n.view.mealTypes.find((t) => t.id === m.mealTypeId)?.timeStartHour;
    const type = planMealTypeId(m, n.view.mealTypes as unknown as MealType[]);
    return (
      !!type &&
      n.view.mealStatuses[type] !== 'recorded' &&
      m.ingredients.length &&
      !logged(m) &&
      !declined(m) &&
      !skipped(m) &&
      (date < n.today || (date === n.today && start != null && start <= hour))
    );
  });
  async function action(fn: () => Promise<void>) {
    if (guard.current) {
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      await fn();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this change.');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const last = plan?.lastReviewedAt ?? plan?.generatedAt;
  const overdue = last
    ? daysBetweenDateStrs(toAestDay(new Date(last), n.timezone), n.today) >= 28
    : false;
  return (
    <>
      {overdue && plan && (
        <Card>
          <AppText variant="heading">Time to review your meal plan</AppText>
          <AppText tone="muted">
            {energy.data?.target?.recommendedKcal == null
              ? 'Current target advice is unavailable; review whether the meals still suit you.'
              : Math.abs(energy.data.target.recommendedKcal - plan.targetCalories) > 100
                ? `Rebuilding would use ${Math.round(energy.data.target.recommendedKcal)} kcal/day, ${energy.data.target.recommendedKcal > plan.targetCalories ? 'up' : 'down'} from ${plan.targetCalories}.`
                : 'The target has not moved much. Rebuild if the meals no longer suit you.'}
          </AppText>
          <Stack direction="row">
            <AppButton title="Rebuild plan" onPress={() => onSetup(plan)} />
            <AppButton
              title="Keep this plan"
              variant="secondary"
              busy={busy}
              onPress={() =>
                void action(async () => {
                  await resources!.write('POST', `${planSpec.path}/${plan.id}/review`, {}, [
                    planSpec.path,
                  ]);
                  state.refresh();
                })
              }
            />
          </Stack>
        </Card>
      )}
      <Card>
        {plan && variant ? (
          <>
            <Stack direction="row" align="center" justify="space-between">
              <AppText variant="heading" style={{ flex: 1 }}>
                {plan.name}
              </AppText>
              <StatusIndicator
                label="Active meal plan"
                busy={busy || state.loading}
                error={error ?? state.error}
                onRetry={state.refresh}
              />
            </Stack>
            <MacroLine
              value={{
                calories: variant.targetCalories,
                proteinG: variant.targetProteinG,
                carbsG: variant.targetCarbsG,
                fatG: variant.targetFatG,
              }}
            />
            {plan.variants.some((v) => v.dayType !== 'all') && (
              <AppText variant="caption" tone="muted">
                {knownTraining === undefined
                  ? 'Day type unknown · showing rest-day plan'
                  : knownTraining
                    ? 'Training-day plan'
                    : 'Rest-day plan'}
              </AppText>
            )}
            <AppText variant="caption" tone="muted">
              Planned meals count only when you confirm what you ate. Unrecorded and skipped
              meals are excluded.
            </AppText>
            {!!eligible.length && (
              <AppButton
                title="Log planned meals I ate"
                variant="secondary"
                busy={busy}
                onPress={() =>
                  void action(async () => {
                    for (const m of eligible) {
                      await logPlanMeal(n, m, date, plan);
                    }
                  })
                }
              />
            )}
            <AppButton
              title={expanded ? 'Hide planned meals' : 'Show planned meals'}
              variant="surface"
              onPress={() => setExpanded(!expanded)}
            />
            {expanded &&
              variant.meals.map((m) => {
                const saved = m.id ? (n.view.planLinks[m.id] ?? m.savedMealId) : m.savedMealId;
                return (
                  <Card key={m.id ?? m.position}>
                    <AppText variant="label">{m.name}</AppText>
                    <AppText variant="caption" tone="muted">
                      {m.suggestedTime ?? ''} · {m.targetCalories} kcal target
                    </AppText>
                    <Badge
                      label={
                        logged(m)
                          ? 'Logged'
                          : skipped(m)
                            ? 'Skipped'
                            : declined(m)
                              ? 'Not this meal'
                              : answer(m)?.answer === 'estimated'
                                ? 'Not recorded · estimate excluded'
                                : 'Planned'
                      }
                    />
                    <Stack direction="row" wrap>
                      <AppButton
                        title={logged(m) ? 'Logged' : 'I ate this'}
                        variant="secondary"
                        busy={busy}
                        disabled={logged(m) || skipped(m) || !m.ingredients.length}
                        onPress={() => void action(() => logPlanMeal(n, m, date, plan))}
                      />
                      <AppButton
                        title={declined(m) ? 'Undo decline' : 'Not this meal'}
                        variant="ghost"
                        busy={busy}
                        disabled={logged(m) || !m.id}
                        onPress={() =>
                          void action(() =>
                            n.store!.enqueue([
                              {
                                domain: 'plan_meal_answers',
                                date,
                                payload: {
                                  planMealId: m.id!,
                                  logDate: date,
                                  ...(declined(m) ? { deleted: true } : {}),
                                },
                              },
                            ]),
                          )
                        }
                      />
                      <AppButton
                        title={
                          saved && n.view.meals.some((x) => x.id === saved)
                            ? 'In My Foods'
                            : 'Save'
                        }
                        variant="ghost"
                        busy={busy}
                        disabled={!!saved && n.view.meals.some((x) => x.id === saved)}
                        onPress={() => void action(() => savePlanMeal(n, m))}
                      />
                    </Stack>
                    <Disclosure title="Ingredients">
                      {m.ingredients.map((i, index) => (
                        <AppText key={index} variant="caption">
                          {i.name} · {i.weightG} g
                        </AppText>
                      ))}
                    </Disclosure>
                  </Card>
                );
              })}
            {expanded && (
              <AppButton
                title="Save all to My Foods"
                variant="secondary"
                busy={busy}
                onPress={() =>
                  void action(async () => {
                    for (const m of variant.meals) {
                      await savePlanMeal(n, m);
                    }
                  })
                }
              />
            )}
            <AppButton title="Manage plan" variant="surface" onPress={() => onManage(plan)} />
          </>
        ) : (
          <AppButton
            title="Create a meal plan"
            icon="foods"
            variant="surface"
            onPress={() => onSetup()}
          />
        )}
      </Card>
    </>
  );
}
