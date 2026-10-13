import { useRecordedIntake } from '../../nutrition/data/useRecordedIntake';
import { HrDayCard } from '../../health/components/HrDayCard';
import { verdictSpec } from '../../health/data/checkin';
import { acwrBandByKey } from '@trainingai/shared/ai-periodization/acwr';
import { recoveryBand } from '@trainingai/shared/health/recovery-band';
import { nativeColor } from '../../../shared/ui';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import type { ResourceSpec, ResourceState } from '../../workouts/data/WorkoutResources';
import { Pressable, View } from 'react-native';
import {
  AppText,
  Card,
  Grid,
  MetricCard,
  Icon,
  LineChart,
  ProgressBar,
  SegmentRing,
  Stack,
  AppButton,
} from '../../../shared/ui';
import type { HealthDetail } from '../../health/screens/HealthDetailScreen';
import { useHealthData } from '../../health/data/HealthDataProvider';
import {
  energySpec,
  goalsSpec,
  hrSpec,
  loadSpec,
  metricValue,
  recoverySpec,
} from '../../health/data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useNutrition } from '../../nutrition/data/NutritionProvider';
import { useHome } from '../data/HomeProvider';
import { metricLabels } from '../data/models';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { shiftDateStr, formatTimeOfDay } from '@trainingai/shared/date-utils';

export function HomeMetricTiles({
  openBody,
  openNutrition,
  log,
}: {
  openBody: () => void;
  openNutrition: () => void;
  log: (field: 'weightKg' | 'steps' | 'waterMl') => void;
}) {
  const health = useHealthData();
  const home = useHome();
  const n = useNutrition();
  const { theme } = useTheme();
  const today = health.body?.today?.date === health.today ? health.body.today : null;
  const energy = useWorkoutResource(energySpec(health.today));
  const resolved = useRecordedIntake(health.today, energy.data?.balance);
  const nutrition = n.view.totals;
  const values: Record<
    string,
    {
      value: number | null;
      unit: string;
      icon: 'scale' | 'legs' | 'flame' | 'water' | 'nutrition';
      field?: 'weightKg' | 'steps' | 'waterMl';
      nutrition?: boolean;
    }
  > = {
    weightKg: {
      value: health.body?.latestWeightKg ?? null,
      unit: 'kg',
      icon: 'scale',
      field: 'weightKg',
    },
    steps: { value: today?.steps ?? null, unit: '', icon: 'legs', field: 'steps' },
    calories: {
      value: resolved.intake ?? today?.calories ?? null,
      unit: 'kcal',
      icon: 'flame',
      nutrition: true,
    },
    distanceKm: { value: today?.distanceKm ?? null, unit: 'km', icon: 'legs' },
    protein: {
      value: nutrition?.proteinG ?? today?.protein ?? null,
      unit: 'g',
      icon: 'nutrition',
      nutrition: true,
    },
    carb: {
      value: nutrition?.carbsG ?? today?.carb ?? null,
      unit: 'g',
      icon: 'nutrition',
      nutrition: true,
    },
    fat: {
      value: nutrition?.fatG ?? today?.fat ?? null,
      unit: 'g',
      icon: 'nutrition',
      nutrition: true,
    },
    waterIntake: { value: today?.waterMl ?? null, unit: 'ml', icon: 'water', field: 'waterMl' },
  };
  return (
    <Grid columns={3}>
      {(home.preferences.homeWidgets ?? ['weightKg', 'steps', 'calories']).flatMap((key) => {
        const value = values[key];
        const tileColor =
          nativeColor(home.preferences.pillColors?.[key]) ??
          (key === 'steps'
            ? theme.homeCards.streakRight
            : key === 'calories'
              ? theme.scores.activity
              : theme.colors.brand);
        if (!value) {
          return [];
        }
        return [
          <MetricCard
            key={key}
            dense
            centered
            label={metricLabels[key as keyof typeof metricLabels]}
            value={metricValue(
              value.value,
              '',
              key === 'weightKg' || key === 'distanceKm' ? 1 : 0,
            )}
            unit={value.unit}
            icon={value.icon}
            accent={tileColor}
            openLabel={value.nutrition ? 'View Nutrition' : 'View Body measurements'}
            onOpen={value.nutrition ? openNutrition : openBody}
            onLog={value.field ? () => log(value.field!) : undefined}
          />,
        ];
      })}
    </Grid>
  );
}
type WidgetProps = {
  id: string;
  openBody: () => void;
  openNutrition: () => void;
  openDetail: (detail: HealthDetail) => void;
  openReadiness: () => void;
  openTraining?: () => void;
  openMorning?: () => void;
};
type Extra = {
  goals?: ResourceState<z.infer<typeof goalsSpec.schema>>;
  load?: ResourceState<z.infer<typeof loadSpec.schema>>;
  recovery?: ResourceState<z.infer<typeof recoverySpec.schema>>;
  hr?: ResourceState<z.infer<ReturnType<typeof hrSpec>['schema']>>;
  energy?: ResourceState<z.infer<ReturnType<typeof energySpec>['schema']>>;
};
function ResourceWidget<T>({
  spec,
  render,
}: {
  spec: ResourceSpec<T>;
  render: (state: ResourceState<T>) => ReactNode;
}) {
  const state = useWorkoutResource(spec);
  return render(state);
}
export function HomeWidget(props: WidgetProps) {
  const { today } = useHealthData();
  if (props.id === 'sleepWidget' || props.id === 'stepsWidget')
    return (
      <ResourceWidget
        spec={goalsSpec}
        render={(goals) => <HomeWidgetBody {...props} goals={goals} />}
      />
    );
  if (props.id === 'acwrWidget')
    return (
      <ResourceWidget
        spec={loadSpec}
        render={(load) => <HomeWidgetBody {...props} load={load} />}
      />
    );
  if (props.id === 'muscleStatusWidget')
    return (
      <ResourceWidget
        spec={recoverySpec}
        render={(recovery) => <HomeWidgetBody {...props} recovery={recovery} />}
      />
    );
  if (props.id === 'hrChartWidget')
    return (
      <ResourceWidget
        spec={hrSpec(today)}
        render={(hr) => <HomeWidgetBody {...props} hr={hr} />}
      />
    );
  if (props.id === 'nutritionDonut' || props.id === 'energyBalanceWidget')
    return (
      <ResourceWidget
        spec={energySpec(today)}
        render={(energy) => <HomeWidgetBody {...props} energy={energy} />}
      />
    );
  return <HomeWidgetBody {...props} />;
}
function HomeWidgetBody({
  id,
  openBody,
  openNutrition,
  openReadiness,
  openTraining = openBody,
  openMorning,
  goals,
  load,
  recovery,
  energy,
}: WidgetProps & Extra) {
  const { theme } = useTheme();
  const health = useHealthData();
  const home = useHome();
  const n = useNutrition();
  const today = health.body?.today?.date === health.today ? health.body.today : null;
  const accent =
    nativeColor(home.preferences.cardColors?.[id]) ??
    theme.homeCards[id as keyof typeof theme.homeCards];
  const title = (label: string) => (
    <AppText variant="eyebrow" tone="muted">
      {label}
    </AppText>
  );
  const resolvedIntake = useRecordedIntake(health.today, energy?.data?.balance);
  if (id === 'nutritionDonut') {
    const total =
      n.view.totals && resolvedIntake.intake != null
        ? { ...n.view.totals, calories: resolvedIntake.intake }
        : n.view.totals;
    const goal = energy?.data?.balance?.budgetKcal ?? null;
    const remaining = total && goal !== null ? goal - total.calories : null;
    return (
      <Pressable
        onPress={openNutrition}
        accessibilityRole="button"
        accessibilityLabel="View Nutrition"
      >
        <Card accent={accent}>
          <Stack direction="row" align="center">
            <SegmentRing
              label="Calories toward today’s budget"
              value={total && goal ? total.calories / goal : 0}
              segments={[{ share: 1, color: theme.colors.brand }]}
            >
              <AppText variant="heading">
                {remaining === null ? '—' : Math.abs(Math.round(remaining)).toLocaleString()}
              </AppText>
              <AppText variant="micro" tone="muted">
                {remaining !== null && remaining < 0 ? 'over' : 'left'}
              </AppText>
            </SegmentRing>
            <Stack style={{ flex: 1 }} gap="xs">
              {title('Nutrition · Today')}
              <AppText variant="caption">
                {metricValue(total?.calories, 'kcal')}
                {goal === null ? '' : ` / ${Math.round(goal).toLocaleString()}`}
              </AppText>
              <ProgressBar value={total && goal ? total.calories / goal : 0} />
              {(['proteinG', 'carbsG', 'fatG'] as const).map((key, index) => (
                <Stack key={key} direction="row" align="center" gap="xs">
                  <View
                    style={{
                      width: theme.spacing.xs,
                      height: theme.spacing.xs,
                      borderRadius: theme.radii.pill,
                      backgroundColor: [
                        theme.macros.protein,
                        theme.macros.carbs,
                        theme.macros.fat,
                      ][index],
                    }}
                  />
                  <AppText variant="micro" tone="muted" style={{ flex: 1 }}>
                    {['Protein', 'Carbs', 'Fat'][index]}
                  </AppText>
                  <AppText variant="micro">{metricValue(total?.[key], 'g', 1)}</AppText>
                </Stack>
              ))}
            </Stack>
          </Stack>
        </Card>
      </Pressable>
    );
  }
  if (id === 'energyBalanceWidget') {
    const balance = energy?.data?.balance;
    const intake = resolvedIntake.intake;
    const remaining =
      intake != null && balance?.budgetKcal != null ? balance.budgetKcal - intake : null;
    return (
      <Pressable
        onPress={openNutrition}
        accessibilityRole="button"
        accessibilityLabel="View energy balance"
      >
        <Card accent={accent}>
          <Stack direction="row" justify="space-between">
            {title('Energy Balance')}
            <AppText variant="micro" tone="muted">
              {resolvedIntake.zoneLabel}
            </AppText>
          </Stack>
          <AppText variant="hero">
            {remaining === null ? '—' : Math.abs(Math.round(remaining)).toLocaleString()}{' '}
            <AppText variant="caption" tone="muted">
              kcal {remaining != null && remaining < 0 ? 'over target' : 'left today'}
            </AppText>
          </AppText>
          <ProgressBar
            value={intake != null && balance?.budgetKcal ? intake / balance.budgetKcal : 0}
          />
          <AppText variant="micro" tone="muted">
            {metricValue(intake)} eaten · {metricValue(balance?.expenditureKcal)} burned
            {energy?.data?.maintenance?.source === 'calibrated'
              ? ` · ${Math.round(energy.data.maintenance.kcal).toLocaleString()} maintenance`
              : ''}
          </AppText>
          {!balance && energy?.data && (
            <AppText variant="caption" tone="muted">
              Add your {energy.data.missingProfileFields.join(', ')} in Profile.
            </AppText>
          )}
        </Card>
      </Pressable>
    );
  }
  if (id === 'weightSparkline') {
    const days = home.preferences.weightLookback === 30 ? 30 : 7;
    const from = shiftDateStr(health.today, -(days - 1));
    const points = (
      health.body?.weightTrend ??
      health.body?.recent.flatMap((row) =>
        row.weightKg == null ? [] : [{ date: row.date, weightKg: row.weightKg }],
      ) ??
      []
    )
      .filter((row) => row.date >= from)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ label: row.date, value: row.weightKg }));
    return (
      <Pressable
        onPress={openBody}
        accessibilityRole="button"
        accessibilityLabel="View weight trend"
      >
        <Card accent={accent}>
          <Stack direction="row" align="center">
            <Stack style={{ flex: 1 }} gap="xs">
              {title('Body Weight')}
              <AppText variant="hero">
                {metricValue(health.body?.latestWeightKg, 'kg', 1)}
              </AppText>
              <AppText variant="micro" tone="muted">
                Last {days} days
              </AppText>
            </Stack>
            <View style={{ width: theme.sizes.weightSparkline }}>
              <LineChart
                label="Weight trend"
                height={theme.sizes.miniChart}
                showLabels={false}
                points={points}
              />
            </View>
          </Stack>
        </Card>
      </Pressable>
    );
  }
  if (id === 'sleepWidget') {
    const night = health.sleep.find(
      (row) => row.date === health.today || row.date === shiftDateStr(health.today, -1),
    );
    const goal = goals?.data?.sleepGoalHours ?? null;
    const stages = night
      ? [
          { label: 'Deep', hours: night.deepSleepHours, color: theme.sleepStages.deep },
          { label: 'REM', hours: night.remSleepHours, color: theme.sleepStages.rem },
          { label: 'Light', hours: night.lightSleepHours, color: theme.sleepStages.light },
          { label: 'Awake', hours: night.awakHours, color: theme.sleepStages.awake },
        ]
      : [];
    const known = stages.reduce((sum, row) => sum + (row.hours ?? 0), 0);
    return (
      <Stack>
        <Pressable
          onPress={openBody}
          accessibilityRole="button"
          accessibilityLabel="View last night’s sleep"
        >
          <Card accent={accent}>
            <Stack direction="row" justify="space-between">
              <Stack gap="xs" style={{ flex: 1 }}>
                {title('Sleep')}
                <AppText variant="hero">
                  {night?.durationHours == null ? '—' : night.durationHours.toFixed(1) + 'h'}
                  {goal !== null && (
                    <AppText variant="caption" tone="muted">
                      {' '}
                      / {goal}h goal
                    </AppText>
                  )}
                </AppText>
                {night?.sleepStart && night.sleepEnd && (
                  <AppText variant="caption" tone="muted">
                    {formatTimeOfDay(night.sleepStart, health.timezone)} –{' '}
                    {formatTimeOfDay(night.sleepEnd, health.timezone)}
                  </AppText>
                )}
              </Stack>
              <Icon name="moon" color={theme.scores.sleep} />
            </Stack>
            <ProgressBar
              value={night?.durationHours && goal ? night.durationHours / goal : 0}
              color={theme.scores.sleep}
            />
            {known > 0 && (
              <>
                <Stack direction="row" gap="xxs">
                  {stages
                    .filter((row) => (row.hours ?? 0) > 0)
                    .map((row) => (
                      <View
                        key={row.label}
                        style={{
                          flex: row.hours!,
                          height: theme.spacing.sm,
                          backgroundColor: row.color,
                        }}
                      />
                    ))}
                </Stack>
                <Stack direction="row" wrap gap="sm">
                  {stages.map((row) => (
                    <Stack key={row.label} direction="row" align="center" gap="xxs">
                      <View
                        style={{
                          width: theme.spacing.xs,
                          height: theme.spacing.xs,
                          backgroundColor: row.color,
                          borderRadius: theme.radii.pill,
                        }}
                      />
                      <AppText variant="micro" tone="muted">
                        {row.label}
                      </AppText>
                      <AppText variant="micro">
                        {row.hours == null ? '—' : row.hours.toFixed(1) + 'h'}
                      </AppText>
                    </Stack>
                  ))}
                </Stack>
              </>
            )}
            {night?.sourceLabel && (
              <AppText variant="micro" tone="muted">
                {night.sourceLabel}
              </AppText>
            )}
          </Card>
        </Pressable>
        {openMorning && <HomeSleepFeedback onCorrect={openMorning} />}
      </Stack>
    );
  }
  if (id === 'stepsWidget') {
    const weekly = goals?.data?.stepsGoalType === 'weekly';
    const value = weekly ? health.body?.weekToDate?.steps : today?.steps;
    const goal =
      goals?.data?.stepsGoal == null ? null : goals.data.stepsGoal * (weekly ? 7 : 1);
    const rows = (health.body?.recent ?? []).slice(0, 7).reverse();
    const max = Math.max(1, ...rows.map((row) => row.steps ?? 0));
    return (
      <Pressable onPress={openBody} accessibilityRole="button" accessibilityLabel="View steps">
        <Card accent={accent}>
          <Stack direction="row" justify="space-between">
            <Stack gap="xs">
              {title(weekly ? 'Steps (week)' : 'Steps')}
              <AppText variant="hero">
                {metricValue(value)}
                {goal !== null && (
                  <AppText variant="caption" tone="muted">
                    {' '}
                    / {goal.toLocaleString()}
                  </AppText>
                )}
              </AppText>
            </Stack>
            <Icon name="legs" tone="brand" />
          </Stack>
          <ProgressBar
            value={value != null && goal ? value / goal : 0}
            color={theme.tones.activity.foreground}
          />
          <Stack
            direction="row"
            gap="xs"
            align="flex-end"
            style={{ height: theme.sizes.stepsSparkline }}
          >
            {rows.map((row, index) => (
              <View
                key={row.date}
                accessibilityLabel={`${row.date}: ${row.steps ?? 'not recorded'} steps`}
                style={{
                  flex: 1,
                  height:
                    row.steps == null
                      ? theme.spacing.xxs
                      : Math.max(
                          theme.spacing.xs,
                          (row.steps / max) * theme.sizes.stepsSparkline,
                        ),
                  borderRadius: theme.radii.small,
                  backgroundColor:
                    row.steps == null
                      ? theme.colors.border
                      : index === rows.length - 1
                        ? theme.colors.brand
                        : theme.colors.brandSurface,
                }}
              />
            ))}
          </Stack>
        </Card>
      </Pressable>
    );
  }
  if (id === 'moodWidget') {
    const feel = health.checkins[health.today]?.sleepQualityFeel;
    return (
      <Pressable
        onPress={openReadiness}
        accessibilityRole="button"
        accessibilityLabel="Edit exercise energy"
      >
        <Card accent={accent}>
          <Stack direction="row" align="center" justify="space-between">
            <Stack gap="xs" style={{ flex: 1 }}>
              {title('Exercise Energy')}
              {home.mood ? (
                <Stack direction="row" align="center">
                  <Icon
                    name={home.mood.energyLevel === 'pumped' ? 'power' : 'mind'}
                    color={theme.tones.checkin.foreground}
                  />
                  <Stack gap="xxs">
                    <AppText variant="label">
                      {
                        {
                          drained: 'Drained',
                          low: 'Low',
                          ok: 'OK',
                          good: 'Good',
                          pumped: 'Pumped',
                        }[home.mood.energyLevel]
                      }
                    </AppText>
                    {home.mood.soreMuscles.length > 0 && (
                      <AppText variant="micro" tone="muted">
                        Sore: {home.mood.soreMuscles.join(', ')}
                      </AppText>
                    )}
                  </Stack>
                </Stack>
              ) : (
                <>
                  <AppText variant="heading">How are you feeling?</AppText>
                  <AppText variant="micro" tone="muted">
                    Tap to log energy & soreness
                  </AppText>
                </>
              )}
            </Stack>
            <Icon name="mind" color={theme.tones.checkin.foreground} />
          </Stack>
          {feel != null && (
            <Stack
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                paddingTop: theme.spacing.md,
              }}
              gap="xs"
            >
              <Stack direction="row" align="center" justify="space-between">
                <Stack direction="row" align="center">
                  <Icon name="moon" color={theme.scores.sleep} />
                  <AppText variant="label">
                    {['Terrible', 'Poor', 'OK', 'Good', 'Great'][feel - 1]}
                  </AppText>
                </Stack>
                <Stack direction="row" align="center" gap="xxs">
                  {[1, 2, 3, 4, 5].map((dot) => (
                    <View
                      key={dot}
                      style={{
                        width: theme.spacing.xs,
                        height: theme.spacing.xs,
                        borderRadius: theme.radii.pill,
                        backgroundColor: dot <= feel ? theme.colors.brand : theme.colors.border,
                      }}
                    />
                  ))}
                  <AppText variant="micro" tone="muted">
                    {feel}/5
                  </AppText>
                </Stack>
              </Stack>
              <AppText variant="micro" tone="muted">
                Your rating, not a score
              </AppText>
            </Stack>
          )}
        </Card>
      </Pressable>
    );
  }
  if (id === 'acwrWidget') {
    const data = load?.data;
    const band =
      data?.acwr != null
        ? acwrBandByKey(data.interpretation as Parameters<typeof acwrBandByKey>[0])
        : null;
    return (
      <Pressable
        onPress={openTraining}
        accessibilityRole="button"
        accessibilityLabel="View training load"
      >
        <Card accent={accent}>
          {title('ACWR')}
          <Stack direction="row" align="center">
            <AppText variant="hero">{metricValue(data?.acwr, '', 2)}</AppText>
            <AppText variant="caption" tone="muted">
              {band?.label ?? (data ? 'Need more data' : '—')}
            </AppText>
          </Stack>
          <AppText variant="micro" tone="muted">
            Acute : chronic workload ratio
          </AppText>
        </Card>
      </Pressable>
    );
  }
  if (id === 'muscleStatusWidget') {
    const fatigued = [...(recovery?.data?.muscles ?? [])]
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);
    return (
      <Pressable
        onPress={openTraining}
        accessibilityRole="button"
        accessibilityLabel="View muscle status"
      >
        <Card accent={accent}>
          {title('Muscle Status')}
          {fatigued.length ? (
            fatigued.map((row) => (
              <Stack key={row.muscle} gap="xxs">
                <Stack direction="row" justify="space-between">
                  <AppText variant="micro" tone="muted">
                    {row.muscle}
                  </AppText>
                  <AppText variant="micro" tone="muted">
                    {Math.round(row.pct)}%
                  </AppText>
                </Stack>
                <ProgressBar value={row.pct / 100} color={recoveryBand(row.pct).color} />
              </Stack>
            ))
          ) : (
            <AppText variant="caption" tone="muted">
              No recent training data
            </AppText>
          )}
        </Card>
      </Pressable>
    );
  }
  if (id === 'hrChartWidget') {
    return (
      <Pressable
        onPress={openBody}
        accessibilityRole="button"
        accessibilityLabel="View heart rate chart"
      >
        <Card accent={accent}>
          {title('Heart Rate · Today')}
          <HrDayCard embedded color={accent} />
        </Card>
      </Pressable>
    );
  }
  return null;
}
function HomeSleepFeedback({ onCorrect }: { onCorrect: () => void }) {
  const health = useHealthData();
  const state = useWorkoutResource(verdictSpec(health.today));
  const verdict = state.data?.verdict;
  if (
    health.sleep.some((night) => night.date === health.today && night.localOnly) ||
    !verdict ||
    verdict.verdict === 'normal' ||
    verdict.responseState !== 'none'
  ) {
    return null;
  }
  return (
    <Stack>
      <AppText variant="micro" tone="muted">
        Last night was {verdict.verdict === 'good' ? 'better' : 'below'} your usual sleep
        baseline.
      </AppText>
      <AppButton title="Doesn’t match how you slept?" variant="ghost" onPress={onCorrect} />
    </Stack>
  );
}
