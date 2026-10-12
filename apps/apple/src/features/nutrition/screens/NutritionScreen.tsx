import {
  formatDateDisplay,
  secondsSinceLocalMidnight,
  shiftDateStr,
} from '@trainingai/shared/date-utils';
import { mealTypeForHour } from '@trainingai/shared/nutrition/meal-type-for-time';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  AppButton,
  AppText,
  Card,
  ConfirmationCard,
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
import { MealLoggingStatus } from '../components/MealLoggingStatus';
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
  openSettings,
  reviewRequest = 0,
  dateRequest,
}: {
  openSettings: () => void;
  reviewRequest?: number;
  dateRequest?: { date: string; count: number };
}) {
  const n0 = useNutrition();
  const [date, setDate] = useState(n0.today);
  const n = useNutrition(date);
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
  useEffect(() => {
    if (reviewRequest > handledReview.current) {
      handledReview.current = reviewRequest;
      setDate(n0.today);
      setModal('review');
    }
  }, [reviewRequest, n0.today]);
  const [logger, setLogger] = useState<string | null>(null);
  const [library, setLibrary] = useState(false);
  const [edit, setEdit] = useState<FoodLog | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [bucket, setBucket] = useState('');
  const [remove, setRemove] = useState<FoodLog[] | null>(null);
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
    n.refresh();
    void health.store?.refresh();
  }, [n.store, health.store, date]);
  useEffect(() => {
    if (date === n.today) {
      void n.store
        ?.ensureMealStatusTracking(date)
        .catch(() => setActionError('Could not save meal tracking on this phone.'));
    }
  }, [n.store, date, n.today, n.loaded, n.data.mealStatuses, n.data.mealTypes]);
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
  function foodRow(log: FoodLog) {
    return (
      <SwipeDelete key={log.id} label={log.foodItem.name} onDelete={() => setRemove([log])}>
        <ListRow
          density="compact"
          leading={<Thumbnail uri={log.foodItem.imageDataUri} label={log.foodItem.name} />}
          title={log.foodItem.name}
          subtitle={`${log.foodItem.brand ?? ''}${log.foodItem.brand ? ' · ' : ''}${foodAmount(log)}`}
          onPress={() => {
            setEdit(log);
            setQuantity(String(log.quantityMultiplier));
            setBucket(log.mealTypeId);
          }}
          trailing={<AppText variant="caption">{Math.round(log.calories)}</AppText>}
        />
      </SwipeDelete>
    );
  }
  return (
    <PageLayout
      title="Nutrition"
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
      <Stack direction="row" align="center" style={{ paddingHorizontal: theme.spacing.lg }}>
        <IconButton
          icon="back"
          label="Previous day"
          onPress={() => setDate(shiftDateStr(date, -1))}
        />
        <AppText variant="heading" style={{ flex: 1, textAlign: 'center' }}>
          {date === n.today
            ? 'Today'
            : date === shiftDateStr(n.today, -1)
              ? 'Yesterday'
              : formatDateDisplay(date, 'long')}
        </AppText>
        <IconButton
          icon="forward"
          label="Next day"
          disabled={date >= n.today}
          onPress={() => setDate(shiftDateStr(date, 1))}
        />
      </Stack>
      <View style={{ flex: 1, paddingHorizontal: theme.spacing.lg }} {...swipe.panHandlers}>
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
                    <AppButton
                      title="Log Food"
                      icon="plus"
                      variant="surface"
                      disabled={!chosen}
                      onPress={() => {
                        setLibrary(false);
                        setLogger(chosen);
                      }}
                    />
                    <AppButton
                      title={`Water · ${health.body?.today?.waterMl == null ? '—' : (health.body.today.waterMl / 1000).toFixed(1) + ' L'}`}
                      icon="water"
                      variant="surface"
                      onPress={() => setModal('water')}
                    />
                  </Grid>
                  <AppButton
                    title="My Foods"
                    icon="foods"
                    variant="surface"
                    onPress={() => {
                      setLibrary(true);
                      setLogger(chosen);
                    }}
                  />
                  <ActiveMealPlan
                    date={date}
                    onManage={(plan) => {
                      setPlanSeed(plan ?? null);
                      setSetupPlan(false);
                      setModal('plans');
                    }}
                    onSetup={(plan) => {
                      setPlanSeed(plan ?? null);
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
                  <Stack key={mt.id}>
                    <Stack direction="row" align="center" justify="space-between">
                      <AppButton
                        title={mt.name}
                        variant="ghost"
                        onPress={() =>
                          setCollapsed(
                            collapsed.includes(mt.id)
                              ? collapsed.filter((id) => id !== mt.id)
                              : [...collapsed, mt.id],
                          )
                        }
                      />
                      <AppText variant="micro" tone="muted">
                        {rows.length ? Math.round(totals(rows).calories) : ''}
                      </AppText>
                      <IconButton
                        icon="plus"
                        label={`Add food to ${mt.name}`}
                        onPress={() => {
                          setLibrary(false);
                          setLogger(mt.id);
                        }}
                      />
                    </Stack>
                    <Card padded={false}>
                      <MealLoggingStatus
                        mealName={mt.name}
                        status={n.view.mealStatuses[mt.id] ?? 'not_recorded'}
                        onChange={(skipped) =>
                          void change(() => n.store!.setMealSkipped(mt.id, date, skipped))
                        }
                      />
                      {collapsed.includes(mt.id) ? (
                        rows.length ? (
                          <MacroLine value={totals(rows)} />
                        ) : null
                      ) : rows.length ? (
                        [...grouped.entries()].map(([key, logs]) =>
                          logs.length > 1 && logs[0].mealGroupId ? (
                            <Disclosure
                              key={key}
                              title={
                                n.view.meals.find((m) => m.id === logs[0].savedMealId)?.name ??
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
                      ) : null}
                    </Card>
                    {rows.length > 1 && <MacroLine value={totals(rows)} />}
                  </Stack>
                );
              })}
              <Card>
                <WeeklyNutrition onDay={setDate} />
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
          onClose={() => setLogger(null)}
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
              min={0.01}
              max={100}
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
                  setRemove([edit]);
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
              min={0.01}
              max={100}
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
                setRemove(groupEdit);
                setGroupEdit(null);
              }}
            />
          </>
        )}
      </Sheet>
      <Sheet visible={remove !== null} title="Delete food" onClose={() => setRemove(null)}>
        {remove && (
          <ConfirmationCard
            title={`Delete ${remove[0].foodItem.name}?`}
            message="This removes the selected diary entry."
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            onConfirm={() =>
              void change(async () => {
                await n.store!.removeLogs(remove);
                setRemove(null);
              })
            }
            onCancel={() => setRemove(null)}
          />
        )}
      </Sheet>
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
