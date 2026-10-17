import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import { View } from 'react-native';
import type { StrengthMode } from '@trainingai/shared/health/strength-progress';
import {
  AppText,
  Card,
  ChipPicker,
  Icon,
  ProgressBar,
  SegmentedControl,
  SeriesBarChart,
  Stack,
  StableContent,
} from '../../../shared/ui';
import { StrengthScreen } from '../../progress/StrengthScreen';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import {
  correlationSpec,
  energySpec,
  goalsSpec,
  progressSpec,
  weightsSpec,
} from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import {
  STRENGTH_BAR_MARKERS,
  STRENGTH_BAR_WIDTH,
  goalCountText,
  lastTrainedSession,
  strengthDelta,
  strengthFillPct,
  strengthGroups,
  type GoalKey,
} from '../progressPresentation';

const views = [
  { value: 'subjective-recovery', label: 'Recovery calibration' },
  { value: 'session-rpe', label: 'Session effort' },
  { value: 'rest-adherence', label: 'Rest discipline' },
  { value: 'recovery-vs-strength', label: 'Recovery vs strength' },
  { value: 'hrv-volume', label: 'HRV vs volume' },
  { value: 'bedtime-sleep', label: 'Bedtime vs sleep' },
  { value: 'meal-timing', label: 'Meals vs sleep' },
  { value: 'energy-balance', label: 'Fuelling vs strength' },
  { value: 'soreness-volume', label: 'Volume vs soreness' },
];
function TrendsCard() {
  const { theme } = useTheme();
  const [view, setView] = useState(views[0].value);
  const state = useWorkoutResource(correlationSpec(view));
  const data = state.data;
  const label = views.find((option) => option.value === view)?.label ?? 'Trend';
  const series = data?.series ?? [];
  const sufficient = data !== null && (data.hasSufficientData || series.length > 0);
  return (
    <Card>
      <HealthResourceHeader title={'Trends'} state={state} refresh={state.refresh} />
      <ChipPicker
        label="Trend view"
        showLabel={false}
        horizontal
        options={views}
        value={view}
        onChange={(next) => next && setView(next)}
      />
      <StableContent
        loading={data === null && state.loading}
        frameHeight={
          theme.sizes.chartHeight + theme.sizes.touchTarget * 3 + theme.spacing.md * 3
        }
      >
        {data && !sufficient && (
          <>
            <AppText variant="heading">Not enough data yet</AppText>
            <AppText variant="caption" tone="muted">
              Keep logging to unlock this trend
            </AppText>
          </>
        )}
        {data && sufficient && (
          <>
            <AppText variant="label" numberOfLines={3}>
              {data.insight}
            </AppText>
            {series.length > 0 ? (
              <SeriesBarChart
                label={label}
                bars={series.map((point) => ({
                  label: point.date.slice(5),
                  value: point.sessionLoad,
                  description: `${point.date}: RPE ${point.sessionRpe}/10, effort load ${point.sessionLoad}`,
                }))}
              />
            ) : (
              <HealthMetricCard
                title={label}
                points={data.buckets.map((bucket) => ({
                  label: `${bucket.label} (n=${bucket.count})`,
                  value: bucket.avg,
                }))}
              />
            )}
          </>
        )}
      </StableContent>
      <AppText variant="micro" tone="muted">
        Correlations need enough paired data points to be meaningful: keep logging workouts, sleep,
        meals and morning check-ins to unlock each view.
      </AppText>
    </Card>
  );
}
function StrengthBar({ pct, color }: { pct: number; color: string }) {
  const { theme } = useTheme();
  return (
    <View style={{ width: STRENGTH_BAR_WIDTH }}>
      <View style={{ height: theme.spacing.md }}>
        {STRENGTH_BAR_MARKERS.map((marker) => (
          <AppText
            key={marker}
            variant="micro"
            tone="muted"
            style={{
              position: 'absolute',
              bottom: 0,
              left: `${marker}%`,
              width: 20,
              marginLeft: -10,
              textAlign: 'center',
            }}
          >
            {marker}
          </AppText>
        ))}
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        style={{
          height: theme.spacing.sm,
          borderRadius: theme.radii.pill,
          backgroundColor: theme.colors.raised,
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            height: '100%',
            width: `${strengthFillPct(pct)}%`,
            backgroundColor: color,
            borderRadius: theme.radii.pill,
          }}
        />
      </View>
      {STRENGTH_BAR_MARKERS.map((marker) => (
        <View
          key={marker}
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: theme.spacing.md,
            height: theme.spacing.sm,
            left: `${marker}%`,
            borderLeftWidth: 1,
            borderStyle: 'dashed',
            borderColor: theme.colors.border,
          }}
        />
      ))}
    </View>
  );
}
function StrengthWorkingCard() {
  const { theme } = useTheme();
  const [mode, setMode] = useState<StrengthMode>('working');
  const state = useWorkoutResource(weightsSpec);
  const exercises = state.data?.exercises ?? [];
  const groups = strengthGroups(exercises, mode);
  const lastSession = lastTrainedSession(exercises);
  return (
    <Card accent={theme.progress.strength}>
      <HealthResourceHeader title={'Strength Progress'} state={state} refresh={state.refresh} />
      <SegmentedControl
        animated
        label="Strength comparison"
        options={[
          { label: 'Sets', value: 'working' },
          { label: '1RM', value: 'latest' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {(state.data?.phaseName || lastSession) && (
        <Stack direction="row" align="center" wrap>
          {state.data?.phaseName && (
            <AppText variant="micro" style={{ color: theme.progress.strength }}>
              {state.data.phaseName}
              {state.data.cycleLabel ? ` · ${state.data.cycleLabel}` : ''}
            </AppText>
          )}
          {lastSession && (
            <AppText variant="micro" tone="muted">
              Last: {lastSession}
            </AppText>
          )}
        </Stack>
      )}
      {groups.map(({ session, rows }) => (
        <Stack key={session}>
          <AppText
            variant="micro"
            style={{ color: theme.progress.strength, textTransform: 'uppercase', letterSpacing: 0.6 }}
          >
            {session}
          </AppText>
          {rows.map(({ exercise, metric }) => {
            const delta = strengthDelta(metric, {
              trendUp: theme.progress.trendUp,
              trendDown: theme.progress.trendDown,
            });
            return (
              <Stack key={exercise.exercise} direction="row" align="center">
                <AppText variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                  {exercise.exercise}
                </AppText>
                <StrengthBar pct={metric.pct} color={metric.color} />
                <View style={{ width: theme.sizes.touchTarget + theme.spacing.lg, alignItems: 'flex-end' }}>
                  <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                    {metric.label}
                  </AppText>
                  {delta && (
                    <AppText variant="micro" style={{ color: delta.color }}>
                      {delta.text}
                    </AppText>
                  )}
                </View>
              </Stack>
            );
          })}
        </Stack>
      ))}
      {state.data && !groups.length && (
        <AppText variant="caption" tone="muted">
          No strength readings yet
        </AppText>
      )}
    </Card>
  );
}
function GoalsCard() {
  const { theme } = useTheme();
  const health = useHealthData();
  const goals = useWorkoutResource(goalsSpec);
  const progress = useWorkoutResource(progressSpec);
  const energy = useWorkoutResource(energySpec(health.today));
  const [view, setView] = useState<'today' | 'week'>('today');
  const weekly = view === 'week';
  const factor = weekly ? 7 : 1;
  const rows = [
    {
      label: 'Steps' as GoalKey,
      icon: 'legs' as const,
      value: weekly ? health.body?.weekToDate?.steps : health.body?.today?.steps,
      goal: goals.data?.stepsGoal != null ? goals.data.stepsGoal * factor : null,
    },
    {
      label: 'Calories' as GoalKey,
      icon: 'flame' as const,
      value: weekly ? health.body?.weekToDate?.calories : health.body?.today?.calories,
      goal:
        energy.data?.balance?.budgetKcal != null
          ? energy.data.balance.budgetKcal * factor
          : null,
    },
    {
      label: 'Water' as GoalKey,
      icon: 'water' as const,
      value: weekly ? health.body?.weekToDate?.waterMl : health.body?.today?.waterMl,
      goal: goals.data?.waterGoalMl != null ? goals.data.waterGoalMl * factor : null,
    },
    {
      label: 'Sleep' as GoalKey,
      icon: 'moon' as const,
      value: weekly ? progress.data?.sleep.thisWeekHours : progress.data?.sleep.lastNightHours,
      goal: goals.data?.sleepGoalHours != null ? goals.data.sleepGoalHours * factor : null,
    },
    {
      label: 'Workouts' as GoalKey,
      icon: 'workout' as const,
      value: progress.data
        ? weekly
          ? progress.data.workouts.completedThisWeek
          : progress.data.workouts.todayComplete
            ? 1
            : 0
        : null,
      goal: progress.data ? (weekly ? progress.data.workouts.scheduledThisWeek : 1) : null,
    },
  ];
  const visible = rows.filter((row) => row.value != null && row.goal != null && row.goal > 0);
  return (
    <Card accent={theme.progress.goals.Steps}>
      <HealthResourceHeader
        title="Goals"
        state={{
          ...goals,
          loading: goals.loading || progress.loading || energy.loading,
          refreshing: goals.refreshing || progress.refreshing || energy.refreshing,
          error: goals.error ?? progress.error ?? energy.error,
        }}
        refresh={() => {
          goals.refresh();
          progress.refresh();
          energy.refresh();
        }}
      />
      <SegmentedControl
        animated
        label="Goal period"
        options={[
          { label: 'Today', value: 'today' },
          { label: 'This Week', value: 'week' },
        ]}
        value={view}
        onChange={setView}
      />

      {visible.map((row) => (
        <Stack key={row.label} gap="xs">
          <Stack direction="row" align="center" gap="sm">
            <Icon name={row.icon} size={14} color={theme.progress.goals[row.label]} />
            <AppText variant="label">{row.label}</AppText>
          </Stack>
          <ProgressBar value={row.value! / row.goal!} color={theme.progress.goals[row.label]} />
          <AppText variant="micro" tone="muted" style={{ fontVariant: ['tabular-nums'] }}>
            {goalCountText(row.value!, row.goal!, weekly)}
          </AppText>
        </Stack>
      ))}
      {!visible.length &&
        goals.data &&
        progress.data &&
        health.body &&
        !health.bodyError &&
        !goals.error &&
        !progress.error && (
          <AppText variant="caption" tone="muted">
            No configured goals with recorded data {weekly ? 'this week' : 'today'}.
          </AppText>
        )}
    </Card>
  );
}
export function ProgressPanel() {
  return (
    <>
      <StrengthScreen embedded section="trend" onBack={() => {}} />
      <TrendsCard />
      <StrengthWorkingCard />
      <GoalsCard />
    </>
  );
}
