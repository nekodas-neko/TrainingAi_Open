import { randomUUID } from 'expo-crypto';
import { planMealTypeId } from '@trainingai/shared/nutrition/meal-type-for-time';
import type { MealType } from '@trainingai/shared/types/nutrition';
import { useEffect, useRef, useState } from 'react';
import { Pressable } from 'react-native';
import { z } from 'zod';
import { AppButton, AppText, Badge, Card, Icon, ListRow, Notice, Sheet, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { foodSchema } from '../../nutrition/data/models';
import type { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import {
  assumedLine,
  estimatedMeals,
  planPickerMeals,
  type EstimateRequest,
  type EstimatedMeal,
  type PlanMeal,
} from '../data/estimated-meals';
import {
  ateAssumed,
  ateOtherPlanMeal,
  ateUsualFood,
  skipAssumed,
  slotOf,
  type Slot,
} from '../data/resolve-estimate';

type Nutrition = ReturnType<typeof useNutrition>;
type Step = 'choices' | 'picker';

/**
 * Estimated meals (#2123): each one is a dashed, tappable row that always prints the assumed
 * portion, and a sheet of four answers. "I ate something else" goes on to a picker. The same sheet
 * and picker open from a reminder's actions (`request`), which can also answer straight away.
 */
export function EstimatedMeals({
  date,
  n,
  meals,
  recorded,
  request,
  onLogFood,
}: {
  date: string;
  n: Nutrition;
  /** Today's meals from the plan variant the plan card shows. */
  meals: readonly PlanMeal[];
  recorded: (meal: PlanMeal) => boolean;
  request?: EstimateRequest | null;
  /** Opens the food logger on a meal group: "Add extras" and "Search all foods". */
  onLogFood: (mealTypeId: string, tab?: 'search') => void;
}) {
  const { theme } = useTheme();
  const rows = estimatedMeals({
    meals,
    answers: n.view.answers,
    logs: n.view.logs,
    mealTypes: n.view.mealTypes,
  });
  const [open, setOpen] = useState<{ slot: Slot; kcal: number; typeName: string; step: Step } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const handled = useRef<string | null>(null);

  function openFor(estimated: EstimatedMeal, step: Step = 'choices') {
    setError(null);
    setOpen({
      slot: slotOf(estimated),
      kcal: estimated.kcal,
      typeName: estimated.mealTypeName,
      step,
    });
  }

  async function run(fn: () => Promise<void>, then?: () => void) {
    if (guard.current) return false;
    guard.current = true;
    setBusy(true);
    try {
      await fn();
      setError(null);
      setOpen(null);
      then?.();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this change.');
      return false;
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  // A reminder's action or tap. It waits for the plan, the store and today's logs and answers,
  // answers once, and ignores a meal that has been answered or logged since the reminder was sent.
  // A failed answer opens the sheet so the reason is shown.
  const dataReady =
    n.loaded.includes('logs:' + date) &&
    n.loaded.includes('answers:' + date) &&
    n.view.mealTypes.length > 0;
  useEffect(() => {
    if (!request || handled.current === request.id || !n.store || !meals.length || !dataReady)
      return;
    handled.current = request.id;
    const meal = meals.find((m) => m.id === request.planMealId);
    const mealTypeId = meal ? planMealTypeId(meal, n.view.mealTypes as unknown as MealType[]) : null;
    if (!meal?.id || !mealTypeId) return;
    const answer = n.view.answers.find((a) => a.planMealId === meal.id);
    const unanswered =
      (!answer || answer.answer === 'estimated') &&
      !recorded(meal) &&
      !n.view.logs.some((log) => log.mealTypeId === mealTypeId);
    if (!unanswered) return;
    const estimated = rows.find((row) => row.meal.id === meal.id);
    const slot: Slot = { meal: { ...meal, id: meal.id }, mealTypeId, hasEstimate: !!estimated };
    const typeName = n.view.mealTypes.find((t) => t.id === mealTypeId)?.name ?? meal.name;
    const kcal = estimated?.kcal ?? Math.round(meal.targetCalories);
    const show = (step: Step) => setOpen({ slot, kcal, typeName, step });
    if (request.action === 'ate')
      void run(() => ateAssumed(n, slot, date, randomUUID)).then((ok) => ok || show('choices'));
    else if (request.action === 'skipped')
      void run(() => skipAssumed(n, slot, date)).then((ok) => ok || show('choices'));
    else show(request.action === 'else' ? 'picker' : 'choices');
    // `rows`, `recorded`, `run` and `n` are rebuilt every render; the request id is what makes
    // this happen once.
  }, [request, n.store, meals, dataReady]);

  const dashed = {
    borderStyle: 'dashed' as const,
    borderColor: theme.tones.brand.border,
  };
  return (
    <>
      {rows.map((row) => (
        <Pressable
          key={row.meal.id}
          accessibilityRole="button"
          accessibilityLabel={`${row.mealTypeName}, estimated. Tap to answer.`}
          onPress={() => openFor(row)}
        >
          <Card style={dashed}>
            <Stack direction="row" align="center" gap="md">
              <Stack gap="xs" style={{ flex: 1 }}>
                <Stack direction="row" align="center">
                  <AppText variant="label">{row.mealTypeName}</AppText>
                  <Badge label="Estimated" />
                </Stack>
                <AppText variant="caption" tone="muted">
                  {assumedLine(row.meal.name, row.kcal)}
                </AppText>
              </Stack>
              <Icon name="forward" tone="muted" size={theme.sizes.iconSmall} />
            </Stack>
          </Card>
        </Pressable>
      ))}
      <Sheet
        visible={open !== null}
        title={open?.step === 'picker' ? 'What did you have?' : (open?.typeName ?? '')}
        onClose={() => !busy && setOpen(null)}
        onBack={open?.step === 'picker' ? () => setOpen({ ...open, step: 'choices' }) : undefined}
      >
        {open?.step === 'choices' && (
          <>
            <AppText variant="caption" tone="muted">
              {assumedLine(open.slot.meal.name, open.kcal)}
            </AppText>
            {error && <Notice title="Not saved" message={error} error />}
            <AppButton
              title="I ate this"
              busy={busy}
              onPress={() => void run(() => ateAssumed(n, open.slot, date, randomUUID))}
            />
            <AppButton
              title="I ate something else"
              variant="secondary"
              disabled={busy}
              onPress={() => setOpen({ ...open, step: 'picker' })}
            />
            <AppButton
              title="I skipped it"
              variant="secondary"
              disabled={busy}
              onPress={() => void run(() => skipAssumed(n, open.slot, date))}
            />
            <AppButton
              title="Add extras"
              variant="ghost"
              disabled={busy}
              onPress={() =>
                void run(
                  () => ateAssumed(n, open.slot, date, randomUUID),
                  () => onLogFood(open.slot.mealTypeId),
                )
              }
            />
          </>
        )}
        {open?.step === 'picker' && (
          <Picker
            n={n}
            date={date}
            open={open}
            meals={meals}
            recorded={recorded}
            busy={busy}
            error={error}
            run={run}
            onLogFood={onLogFood}
          />
        )}
      </Sheet>
    </>
  );
}

function Picker({
  n,
  date,
  open,
  meals,
  recorded,
  busy,
  error,
  run,
  onLogFood,
}: {
  n: Nutrition;
  date: string;
  open: { slot: Slot; typeName: string };
  meals: readonly PlanMeal[];
  recorded: (meal: PlanMeal) => boolean;
  busy: boolean;
  error: string | null;
  run: (fn: () => Promise<void>, then?: () => void) => Promise<boolean>;
  onLogFood: (mealTypeId: string, tab?: 'search') => void;
}) {
  const { slot } = open;
  const usual = useWorkoutResource({
    path: '/api/nutrition/recent-for-meal',
    query: { mealTypeId: slot.mealTypeId },
    ttl: 300000,
    schema: z.array(foodSchema),
  });
  const fromPlan = planPickerMeals(meals, slot.meal.id, recorded);
  const where = open.typeName.toLowerCase();
  return (
    <>
      {error && <Notice title="Not saved" message={error} error />}
      <AppText variant="caption" tone="muted">
        Usually at {where}
      </AppText>
      {(usual.data ?? []).length > 0 ? (
        <Card padded={false}>
          {(usual.data ?? []).map((food, index, list) => (
            <ListRow
              key={food.id}
              title={food.name}
              subtitle={food.brand ?? undefined}
              trailing={
                <AppText tone="muted">{Math.round(food.calories)} kcal</AppText>
              }
              divider={index < list.length - 1}
              disabled={busy}
              onPress={() => void run(() => ateUsualFood(n, slot, food, date))}
            />
          ))}
        </Card>
      ) : (
        <AppText tone="muted">
          {usual.loading ? 'Loading…' : usual.error ? 'Could not load these.' : 'Nothing yet.'}
        </AppText>
      )}
      {fromPlan.length > 0 && (
        <>
          <AppText variant="caption" tone="muted">
            From your plan
          </AppText>
          <Card padded={false}>
            {fromPlan.map((meal, index) => (
              <ListRow
                key={meal.id ?? meal.position}
                title={meal.name}
                trailing={<AppText tone="muted">{Math.round(meal.targetCalories)} kcal</AppText>}
                divider={index < fromPlan.length - 1}
                disabled={busy}
                onPress={() => void run(() => ateOtherPlanMeal(n, slot, meal, date, randomUUID))}
              />
            ))}
          </Card>
        </>
      )}
      <AppButton
        title="Search all foods"
        variant="ghost"
        disabled={busy}
        onPress={() => void run(async () => {}, () => onLogFood(slot.mealTypeId, 'search'))}
      />
    </>
  );
}
