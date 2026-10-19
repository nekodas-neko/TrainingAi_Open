import { useEffect, useRef, useState } from 'react';
import { AppButton, AppText, Card, ListRow, Skeleton, Stack } from '../../../shared/ui';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { planSpec } from '../../nutrition/data/models';
import { savePlanMeal } from '../../meal-plans/components/PlanMeals';
import type { PlanCardArgs, WidgetResult } from '../data/widgets';
import { failureNotice } from '../../../core/reporting/index.ts';
export function PlanCard({
  args,
  onResult,
}: {
  args: PlanCardArgs;
  onResult?: (result: WidgetResult) => void;
}) {
  const state = useWorkoutResource(planSpec),
    n = useNutrition(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const guard = useRef(false),
    reported = useRef(false);
  const plan = state.data?.plans.find((p) => (args.planId ? p.id === args.planId : p.isActive));
  const variant =
    plan?.variants.find((v) => v.dayType === 'all') ??
    plan?.variants.find((v) => v.dayType === 'training') ??
    plan?.variants[0];
  const meals = variant?.meals.slice().sort((a, b) => a.position - b.position) ?? [];
  const unsaved = meals.filter(
    (meal) =>
      meal.id && !meal.savedMealId && !n.view.planLinks[meal.id] && meal.ingredients.length,
  );
  useEffect(() => {
    if (state.data && !plan && onResult && !reported.current) {
      reported.current = true;
      onResult({
        status: 'stale',
        detail: args.planId ? 'That plan is gone.' : 'No active meal plan yet.',
      });
    }
  }, [state.data, plan, onResult]);
  async function save() {
    if (guard.current || !onResult || !n.store) return;
    guard.current = true;
    setBusy(true);
    let saved = 0;
    try {
      await Promise.all([n.store.refresh('foods', n.today), n.store.refresh('meals', n.today)]);
      for (const meal of unsaved) {
        await savePlanMeal(n, meal);
        saved++;
      }
      onResult({
        status: 'chose',
        id: 'save_all',
        label: `Saved ${saved} ${saved === 1 ? 'meal' : 'meals'} to My Foods`,
      });
    } catch (failure) {
      setError(failureNotice(
        `Saved ${saved} of ${unsaved.length} meals. Retry to save the rest.`,
        failure,
      ));
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <Card>
      <AppText variant="label">{args.title}</AppText>
      {!state.data ? (
        <Skeleton style={{ height: 160 }} />
      ) : !plan ? (
        <AppText tone="muted">No meal plan available.</AppText>
      ) : (
        <>
          <AppText variant="caption" tone="muted">
            {variant?.targetCalories.toLocaleString()} kcal · {meals.length} {meals.length === 1 ? 'meal' : 'meals'}
          </AppText>
          {meals.map((m) => (
            <ListRow
              key={m.id ?? m.position}
              title={m.name}
              subtitle={`${Math.round(m.targetCalories)} kcal · ${m.ingredients.length} ${m.ingredients.length === 1 ? 'ingredient' : 'ingredients'}`}
              trailing={
                m.savedMealId || (m.id && n.view.planLinks[m.id]) ? (
                  <AppText>✓</AppText>
                ) : undefined
              }
            />
          ))}
          <AppText variant="caption" tone="muted">
            Saving copies each meal into My Foods, where you can log or edit it.
          </AppText>
          {error && <AppText tone="danger">{error}</AppText>}
          {onResult && (
            <Stack direction="row">
              <AppButton
                title="Redo"
                variant="surface"
                disabled={busy}
                style={{ flex: 1 }}
                onPress={() =>
                  onResult({ status: 'chose', id: 'redo', label: 'Build me a different plan' })
                }
              />
              <AppButton
                title="Save all to My Foods"
                busy={busy}
                disabled={!unsaved.length || !n.ready}
                style={{ flex: 1.5 }}
                onPress={() => {
                  void save();
                }}
              />
            </Stack>
          )}
        </>
      )}
      {state.error && <AppButton title="Retry plan" variant="ghost" onPress={state.refresh} />}
    </Card>
  );
}
