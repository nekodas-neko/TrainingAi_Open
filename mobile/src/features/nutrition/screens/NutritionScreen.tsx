import { randomUUID } from 'expo-crypto';
import { useUndo } from '../../../shared/ui/undo/UndoProvider';
import { useReducedMotion } from '../../../shared/ui/useReducedMotion';
import { layoutMotion } from '../../../shared/ui/layoutMotion';
import { feedback } from '../../../integrations/feedback/haptics';
import {
  formatDateDisplay,
  secondsSinceLocalMidnight,
  shiftDateStr,
} from '@trainingai/shared/date-utils';
import { mealTypeForHour } from '@trainingai/shared/nutrition/meal-type-for-time';
import { QUANTITY_MULTIPLIER_MAX, QUANTITY_MULTIPLIER_MIN } from '@trainingai/shared/nutrition/quantity-bounds';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  ActionTile,
  ActionMenu,
  AppText,
  Card,
  Disclosure,
  Grid,
  IconButton,
  ListRow,
  NumericStepper,
  PageLayout,
  Picker,
  ReadyContent,
  Sheet,
  Skeleton,
  Stack,
  SwipeDelete,
  TabPanel,
  Thumbnail,
} from '../../../shared/ui';
import { MetricLogSheet } from '../../health/components/MetricLogSheet';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { energySpec } from '../../health/data/models';
import { ActiveMealPlan, MealPlansSheet } from '../../meal-plans/components/MealPlansSheet';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { EndOfDaySheet } from '../components/EndOfDaySheet';
import { FoodLogger } from '../components/FoodLogger';
import type { EstimateRequest } from '../../meal-plans/data/estimated-meals';
import { FoodLoggingComplete } from '../components/FoodLoggingComplete';
import { MealSectionHeader } from '../components/MealSectionHeader';
import { MacroLine, NutritionStatus, foodAmount } from '../components/NutritionElements';
import { NutritionEnergyCard } from '../components/NutritionEnergyCard';
import { NutritionSettings, NutritionTargets } from '../components/NutritionSettings';
import { RecipesSheet } from '../components/RecipesSheet';
import { SupplementsSection } from '../components/SupplementsSection';
import { WeeklyNutrition } from '../components/WeeklyNutrition';
import { useNutrition } from '../data/NutritionProvider';
import {
  type FoodLog,
  type MealPlan,
  type SavedMeal,
  adherenceSpec,
  planSpec,
  totals,
  weeklySpec,
} from '../data/models';
export function NutritionScreen({
  openCoach,
  openSettings,
  reviewRequest = 0,
  dateRequest,
  estimateRequest,
}: {
  openCoach?: () => void;
  openSettings: () => void;
  reviewRequest?: number;
  dateRequest?: { date: string; count: number };
  /** A reminder's action on an estimated meal (#2123); shown on its own day. */
  estimateRequest?: (EstimateRequest & { date: string }) | null;
}) {
  const n0 = useNutrition();
  const [date, setDate] = useState(n0.today);
  const n = useNutrition(date);
  const { refresh: refreshNutrition } = n;
  const health = useHealthData();
  const { theme } = useTheme();
  const [planSeed, setPlanSeed] = useState<MealPlan | null>(null);
  const [setupPlan, setSetupPlan] = useState(false);
  const [modal, setModal] = useState<
    'settings' | 'recipes' | 'plans' | 'review' | 'goals' | 'water' | null
  >(null);
  const handledReview = useRef(0);
  const handledDate = useRef(0);
  useEffect(() => {
    if (dateRequest && dateRequest.count > handledDate.current) {
      handledDate.current = dateRequest.count;
      setDate(dateRequest.date);
      setModal(null);
    }
  }, [dateRequest]);
  const handledEstimate = useRef<string | null>(null);
  useEffect(() => {
    if (estimateRequest && handledEstimate.current !== estimateRequest.id) {
      handledEstimate.current = estimateRequest.id;
      setDate(estimateRequest.date);
      setModal(null);
    }
  }, [estimateRequest]);
  useEffect(() => {
    if (reviewRequest > handledReview.current) {
      handledReview.current = reviewRequest;
      setDate(n0.today);
      setModal('review');
    }
  }, [reviewRequest, n0.today]);
  const [logger, setLogger] = useState<string | null>(null);
  const [loggerTab, setLoggerTab] = useState<'search' | undefined>();
  const [library, setLibrary] = useState(false);
  const [edit, setEdit] = useState<FoodLog | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [bucket, setBucket] = useState('');
  const undo = useUndo();
  const reduced = useReducedMotion();
  const deleting = useRef(new Set<string>());
  const [foodActions, setFoodActions] = useState<FoodLog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recipeSelected, setRecipeSelected] = useState<SavedMeal | null>(null);
  const [groupEdit, setGroupEdit] = useState<FoodLog[] | null>(null);
  const [groupScale, setGroupScale] = useState('1');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const previousToday = useRef(n0.today);
  const [manualRefresh, setManualRefresh] = useState(false);
  const energy = useWorkoutResource(energySpec(date));
  const plans = useWorkoutResource(planSpec);
  const weekly = useWorkoutResource(weeklySpec);
  const adherence = useWorkoutResource(adherenceSpec);
  const contentReady =
    [energy, plans, weekly, adherence].every(
      (state) => state.data !== null || (!state.loading && state.error !== null),
    ) &&
    (date !== n.today ||
      n.loaded.includes('supplements:' + date) ||
      !!n.errors['supplements:' + date]);
  useEffect(() => {
    setDate((d) => (d === previousToday.current ? n0.today : d));
    previousToday.current = n0.today;
  }, [n0.today]);
  useEffect(() => {
    void refreshNutrition();
    void health.store?.refresh();
  }, [refreshNutrition, health.store]);
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 25 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) > 50) {
            setDate((previous) => {
              const next = shiftDateStr(previous, g.dx < 0 ? 1 : -1);
              return next <= n0.today ? next : previous;
            });
          }
        },
      }),
    [n0.today],
  );
  const available =
    n.ready &&
    ['mealTypes', 'meals', 'targets', 'logs:' + date].every(
      (key) => n.loaded.includes(key) || n.errors[key],
    );
  const chosen =
    mealTypeForHour(
      n.view.mealTypes as never,
      Math.floor(secondsSinceLocalMidnight(n.timezone) / 3600),
    ) ??
    n.view.mealTypes[0]?.id ??
    '';
  async function change(fn: () => Promise<unknown>) {
    try {
      await fn();
      setActionError(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Could not save this change.');
    }
  }
  function openFood(log: FoodLog) {
    setEdit(log);
    setQuantity(String(log.quantityMultiplier));
    setBucket(log.mealTypeId);
  }
  async function removeFood(logs: FoodLog[]) {
    const store = n.store;
    if (!store || logs.some((log) => deleting.current.has(log.id))) return;
    logs.forEach((log) => deleting.current.add(log.id));
    const recovery = logs.map((log) => ({ ...log, id: randomUUID() }));
    try {
      await undo.perform({
        key: `food:${logs
          .map((log) => log.id)
          .sort()
          .join(',')}`,
        label: logs.length > 1 ? 'Meal deleted' : `${logs[0].foodItem.name} deleted`,
        apply: async () => {
          layoutMotion(reduced);
          await store.removeLogs(logs);
        },
        revert: async () => {
          layoutMotion(reduced);
          await store.restoreLogs(recovery);
        },
      });
    } finally {
      logs.forEach((log) => deleting.current.delete(log.id));
    }
  }
  function foodRow(log: FoodLog) {
    return (
      <SwipeDelete
        key={log.id}
        label={log.foodItem.name}
        onEdit={() => openFood(log)}
        onDelete={() => void removeFood([log])}
      >
        <ListRow
          density="compact"
          leading={<Thumbnail uri={log.foodItem.imageDataUri} label={log.foodItem.name} />}
          title={log.foodItem.name}
          subtitle={`${log.foodItem.brand ?? ''}${log.foodItem.brand ? ' · ' : ''}${foodAmount(log)}`}
          onPress={() => openFood(log)}
          onLongPress={() => {
            feedback('impact');
            setFoodActions(log);
          }}
          trailing={<AppText variant="caption">{Math.round(log.calories)}</AppText>}
        />
      </SwipeDelete>
    );
  }
  return (
    <PageLayout
      landing
      title="Nutrition"
      titleVariant="nutritionTitle"
      subtitle={
        <Stack direction="row" align="center" gap="xxs">
          <View {...swipe.panHandlers}>
            <AppText variant="body" tone="muted">
              {date === n.today
                ? 'Today'
                : date === shiftDateStr(n.today, -1)
                  ? 'Yesterday'
                  : formatDateDisplay(date, 'long')}
            </AppText>
          </View>
          {/* The 48 dp hit areas overlap the title's gap so the band stays as tall as the text. */}
          <Stack
            direction="row"
            gap="none"
            style={{ marginVertical: -(theme.sizes.touchTarget - theme.spacing.xl) / 2 }}
          >
            <IconButton
              icon="back"
              label="Previous day"
              onPress={() => setDate(shiftDateStr(date, -1))}
            />
            <IconButton
              icon="forward"
              label="Next day"
              disabled={date >= n.today}
              onPress={() => setDate(shiftDateStr(date, 1))}
            />
          </Stack>
        </Stack>
      }
      actions={
        <>
          <NutritionStatus date={date} />
          <IconButton
            icon="settings"
            label="Nutrition Settings"
            onPress={() => setModal('settings')}
          />
        </>
      }
    >
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg }}>
        <TabPanel
          key={date}
          onRefresh={() => {
            setManualRefresh(true);
            void Promise.all([
              n.refresh(true),
              health.store?.refresh(true),
              ...[energySpec(date), planSpec, weeklySpec, adherenceSpec].map((spec) =>
                energy.resources?.load<unknown>(spec, true),
              ),
            ]).finally(() => setManualRefresh(false));
          }}
          refreshing={manualRefresh}
        >
          {!n.connected || n.denied ? (
            <>
              <AppText>Sign in to load your nutrition records.</AppText>
              <AppButton title="Account settings" onPress={openSettings} />
            </>
          ) : available ? (
            <ReadyContent
              key={date}
              ready={contentReady}
              placeholder={
                <Stack>
                  {[0, 1, 2].map((i) => (
                    <Card key={i}>
                      <Skeleton
                        style={{
                          height:
                            i === 0 ? theme.sizes.chartHeight * 2 : theme.sizes.chartHeight,
                        }}
                      />
                    </Card>
                  ))}
                </Stack>
              }
            >
              <NutritionEnergyCard date={date} onGoals={() => setModal('goals')} />
              {date === n.today && (
                <>
                  <Grid columns={2}>
                    <ActionTile
                      layout="row"
                      title="Log Food"
                      icon="plus"
                      disabled={!chosen}
                      onPress={() => {
                        setLibrary(false);
                        setLogger(chosen);
                      }}
                    />
                    <ActionTile
                      layout="row"
                      title="Water"
                      icon="water"
                      caption={
                        health.body?.today?.waterMl == null
                          ? '—'
                          : (health.body.today.waterMl / 1000).toFixed(1) + ' L'
                      }
                      onPress={() => setModal('water')}
                    />
                  </Grid>
                  <ActionTile
                    layout="row"
                    title="My Foods"
                    icon="foods"
                    onPress={() => {
                      setLibrary(true);
                      setLogger(chosen);
                    }}
                  />
                  <ActiveMealPlan
                    date={date}
                    estimateRequest={estimateRequest?.date === date ? estimateRequest : null}
                    onLogFood={(mealTypeId, tab) => {
                      setLibrary(false);
                      setLoggerTab(tab);
                      setLogger(mealTypeId);
                    }}
                    onManage={(plan) => {
                      setPlanSeed(plan ?? null);
                      setSetupPlan(false);
                      setModal('plans');
                    }}
                    onStepByStep={() => {
                      setPlanSeed(null);
                      setSetupPlan(true);
                      setModal('plans');
                    }}
                    onSetup={(plan) => {
                      setPlanSeed(plan ?? null);
                      if (openCoach) {
                        openCoach();
                        return;
                      }
                      setSetupPlan(true);
                      setModal('plans');
                    }}
                  />
                </>
              )}
              {n.view.mealTypes.map((mt) => {
                const rows = n.view.logs.filter((log) => log.mealTypeId === mt.id);
                const grouped = new Map<string, FoodLog[]>();
                for (const row of rows) {
                  const key = row.mealGroupId ?? row.id;
                  grouped.set(key, [...(grouped.get(key) ?? []), row]);
                }
                return (
                  <Card key={mt.id} padded={false}>
                    <MealSectionHeader
                      name={mt.name}
                      status={n.view.mealStatuses[mt.id] ?? 'not_recorded'}
                      calories={rows.length ? totals(rows).calories : undefined}
                      expanded={!collapsed.includes(mt.id)}
                      onToggle={
                        rows.length
                          ? () => {
                              layoutMotion(reduced);
                              setCollapsed((previous) =>
                                previous.includes(mt.id)
                                  ? previous.filter((id) => id !== mt.id)
                                  : [...previous, mt.id],
                              );
                            }
                          : undefined
                      }
                      onAdd={() => {
                        layoutMotion(reduced);
                        setCollapsed((previous) => previous.filter((id) => id !== mt.id));
                        setLibrary(false);
                        setLogger(mt.id);
                      }}
                      onSkip={(skipped) =>
                        change(() => n.store!.setMealSkipped(mt.id, date, skipped))
                      }
                    />
                    <Stack
                      gap="none"
                      style={{
                        borderTopWidth: rows.length && !collapsed.includes(mt.id) ? 1 : 0,
                        borderTopColor: theme.colors.border,
                      }}
                    >
                      {!collapsed.includes(mt.id) && rows.length > 0
                        ? [...grouped.entries()].map(([key, logs]) =>
                            logs.length > 1 && logs[0].mealGroupId ? (
                              <Disclosure
                                key={key}
                                title={
                                  n.view.meals.find((m) => m.id === logs[0].savedMealId)
                                    ?.name ??
                                  logs[0].mealGroupName ??
                                  'Meal'
                                }
                              >
                                <Stack>
                                  <AppButton
                                    title="Edit meal portion"
                                    variant="ghost"
                                    onPress={() => {
                                      setGroupEdit(logs);
                                      setGroupScale('1');
                                      setBucket(logs[0].mealTypeId);
                                    }}
                                  />
                                  {logs.map(foodRow)}
                                  <MacroLine value={totals(logs)} />
                                </Stack>
                              </Disclosure>
                            ) : (
                              foodRow(logs[0])
                            ),
                          )
                        : null}
                    </Stack>
                    {rows.length > 1 && !collapsed.includes(mt.id) && (
                      <Stack style={{ padding: theme.spacing.md }}>
                        <MacroLine value={totals(rows)} />
                      </Stack>
                    )}
                  </Card>
                );
              })}
              <FoodLoggingComplete
                date={date}
                isToday={date === n.today}
                daysLogged={energy.data?.maintenance?.daysLogged ?? null}
                calibrated={energy.data?.maintenance?.source === 'calibrated'}
                gapMessage={energy.data?.maintenance?.gapMessage ?? null}
              />
              <Card>
                <WeeklyNutrition
                  onDay={setDate}
                  calorieTarget={
                    energy.data?.date === date ? (energy.data.balance?.budgetKcal ?? null) : null
                  }
                />
                {date === n.today && <SupplementsSection date={date} />}
              </Card>
              <AppButton
                title="End of Day"
                variant="surface"
                onPress={() => setModal('review')}
              />
            </ReadyContent>
          ) : (
            <Stack>
              {[0, 1, 2].map((index) => (
                <Card key={index}>
                  <Skeleton style={{ height: index === 0 ? 200 : 100 }} />
                </Card>
              ))}
            </Stack>
          )}
        </TabPanel>
      </View>
      {logger !== null && (
        <FoodLogger
          key={date + logger}
          date={date}
          mealTypeId={logger}
          library={library}
          initialTab={loggerTab}
          onClose={() => {
            setLogger(null);
            setLoggerTab(undefined);
          }}
          onRecipes={(meal) => {
            setRecipeSelected(meal ?? null);
            setLogger(null);
            setModal('recipes');
          }}
        />
      )}
      {modal === 'recipes' && (
        <RecipesSheet
          initialSelected={recipeSelected}
          date={date}
          onClose={() => setModal(null)}
          onLog={(meal, bucket, portions) => n.store!.logMeal(meal, date, bucket, portions)}
        />
      )}
      {modal === 'settings' && <NutritionSettings onClose={() => setModal(null)} />}
      {modal === 'goals' && <NutritionTargets onClose={() => setModal(null)} />}
      {modal === 'plans' && (
        <MealPlansSheet
          initialPlan={planSeed}
          startSetup={setupPlan}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'review' && <EndOfDaySheet date={date} onClose={() => setModal(null)} />}
      {modal === 'water' && (
        <MetricLogSheet field="waterMl" initial={null} onClose={() => setModal(null)} />
      )}
      <Sheet
        visible={edit !== null}
        title={edit?.foodItem.name ?? 'Edit serving'}
        onClose={() => setEdit(null)}
      >
        {edit && (
          <>
            <NumericStepper
              label="Servings"
              value={quantity}
              min={QUANTITY_MULTIPLIER_MIN}
              max={QUANTITY_MULTIPLIER_MAX}
              step={0.5}
              onChange={setQuantity}
            />
            <Picker
              label="Meal group"
              value={bucket}
              options={n.view.mealTypes.map((mt) => ({ value: mt.id, label: mt.name }))}
              onChange={setBucket}
            />
            <MacroLine value={edit.foodItem} portion={Number(quantity)} />
            <Stack direction="row">
              <AppButton
                title="Save"
                onPress={() =>
                  void change(async () => {
                    await n.store!.editLog(edit, Number(quantity), bucket);
                    setEdit(null);
                  })
                }
              />
              <AppButton
                title="Duplicate"
                variant="secondary"
                onPress={() =>
                  void change(async () => {
                    await n.store!.logFoods(
                      [{ ...edit.foodItem, quantityMultiplier: Number(quantity) }],
                      date,
                      bucket,
                    );
                    setEdit(null);
                  })
                }
              />
              <AppButton
                title="Delete"
                variant="danger"
                onPress={() => {
                  void removeFood([edit]);
                  setEdit(null);
                }}
              />
            </Stack>
          </>
        )}
      </Sheet>
      <Sheet
        visible={groupEdit !== null}
        title={groupEdit?.[0].mealGroupName ?? 'Edit meal'}
        onClose={() => setGroupEdit(null)}
      >
        {groupEdit && (
          <>
            <NumericStepper
              label="Scale this meal"
              value={groupScale}
              min={QUANTITY_MULTIPLIER_MIN}
              max={QUANTITY_MULTIPLIER_MAX}
              step={0.5}
              onChange={setGroupScale}
            />
            <Picker
              label="Meal group"
              value={bucket}
              options={n.view.mealTypes.map((mt) => ({ value: mt.id, label: mt.name }))}
              onChange={setBucket}
            />
            <MacroLine value={totals(groupEdit)} portion={Number(groupScale)} />
            <AppButton
              title="Save meal portion"
              onPress={() =>
                void change(async () => {
                  await n.store!.editGroup(groupEdit, Number(groupScale), bucket);
                  setGroupEdit(null);
                })
              }
            />
            <AppButton
              title="Duplicate meal"
              variant="secondary"
              onPress={() =>
                void change(async () => {
                  await n.store!.logFoods(
                    groupEdit.map((log) => ({
                      ...log.foodItem,
                      quantityMultiplier: log.quantityMultiplier * Number(groupScale),
                    })),
                    date,
                    bucket,
                    {
                      savedMealId: groupEdit[0].savedMealId ?? undefined,
                      name: groupEdit[0].mealGroupName ?? undefined,
                    },
                  );
                  setGroupEdit(null);
                })
              }
            />
            <AppButton
              title="Delete meal"
              variant="danger"
              onPress={() => {
                void removeFood(groupEdit);
                setGroupEdit(null);
              }}
            />
          </>
        )}
      </Sheet>
      {foodActions && (
        <ActionMenu
          visible
          title={foodActions?.foodItem.name ?? 'Food actions'}
          onClose={() => setFoodActions(null)}
          actions={
            foodActions
              ? [
                  { title: 'Edit serving', icon: 'edit', run: () => openFood(foodActions) },
                  {
                    title: 'Duplicate',
                    icon: 'plus',
                    run: () =>
                      void change(async () => {
                        await n.store!.logFoods(
                          [
                            {
                              ...foodActions.foodItem,
                              quantityMultiplier: foodActions.quantityMultiplier,
                            },
                          ],
                          foodActions.date,
                          foodActions.mealTypeId,
                        );
                        feedback('success');
                      }),
                  },
                  {
                    title: 'Delete',
                    icon: 'delete',
                    danger: true,
                    run: () => void removeFood([foodActions]),
                  },
                ]
              : []
          }
        />
      )}
      <Sheet
        visible={actionError !== null}
        title="Nutrition change"
        onClose={() => setActionError(null)}
      >
        <AppText>{actionError}</AppText>
      </Sheet>
    </PageLayout>
  );
}
