import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import {
  computeBarMetric,
  type StrengthMode,
} from '@trainingai/shared/health/strength-progress';
import {
  AppText,
  Card,
  Picker,
  ProgressBar,
  SegmentedControl,
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
  metricValue,
} from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';
import { useTheme } from '../../../shared/theme/ThemeProvider';

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
  return (
    <Card>
      <HealthResourceHeader title={'Trends & Insights'} state={state} refresh={state.refresh} />
      <Picker label="Trend" options={views} value={view} onChange={setView} />
      <StableContent
        loading={state.data === null && state.loading}
        frameHeight={
          theme.sizes.chartHeight + theme.sizes.touchTarget * 3 + theme.spacing.md * 3
        }
      >
        {state.data && (
          <>
            <AppText variant="caption">{state.data.insight}</AppText>
            {state.data.hasSufficientData && (
              <HealthMetricCard
                title={views.find((option) => option.value === view)?.label ?? 'Trend'}
                points={state.data.buckets.map((bucket) => ({
                  label: `${bucket.label} (n=${bucket.count})`,
                  value: bucket.avg,
                }))}
              />
            )}
          </>
        )}
      </StableContent>
    </Card>
  );
}
function StrengthWorkingCard() {
  const [mode, setMode] = useState<StrengthMode>('working');
  const state = useWorkoutResource(weightsSpec);
  const sessions = [...new Set(state.data?.exercises.map((exercise) => exercise.sessionName))];
  return (
    <Card tone="nutrition">
      <HealthResourceHeader title={'Strength Progress'} state={state} refresh={state.refresh} />
      <SegmentedControl
        label="Strength comparison"
        options={[
          { label: 'Working', value: 'working' },
          { label: '1RM', value: 'latest' },
        ]}
        value={mode}
        onChange={setMode}
      />

      {state.data?.phaseName && (
        <AppText variant="caption" tone="muted">
          {state.data.phaseName} · {state.data.cycleLabel}
        </AppText>
      )}
      {sessions.map((session) => (
        <Stack key={session}>
          <AppText variant="label">{session}</AppText>
          {state.data?.exercises
            .filter((exercise) => exercise.sessionName === session)
            .map((exercise) => {
              const metric = computeBarMetric(exercise, mode);
              return metric ? (
                <Stack key={exercise.exercise}>
                  <Stack direction="row" justify="space-between">
                    <AppText variant="caption">{exercise.exercise}</AppText>
                    <AppText variant="label">{metric.label}</AppText>
                  </Stack>
                  <ProgressBar value={metric.pct / 100} />
                  {metric.delta !== null && metric.trend !== 'same' && (
                    <AppText variant="micro" tone="muted">
                      {metric.trend === 'up' ? '+' : '−'}
                      {metric.delta} {metric.deltaUnit}
                    </AppText>
                  )}
                </Stack>
              ) : null;
            })}
        </Stack>
      ))}
      {state.data &&
        !state.data.exercises.some((exercise) => exercise.estimated1rm !== null) && (
          <AppText variant="caption" tone="muted">
            No strength readings yet
          </AppText>
        )}
    </Card>
  );
}
function GoalsCard() {
  const health = useHealthData();
  const goals = useWorkoutResource(goalsSpec);
  const progress = useWorkoutResource(progressSpec);
  const energy = useWorkoutResource(energySpec(health.today));
  const [view, setView] = useState<'today' | 'week'>('today');
  const weekly = view === 'week';
  const factor = weekly ? 7 : 1;
  const rows = [
    {
      label: 'Steps',
      value: weekly ? health.body?.weekToDate?.steps : health.body?.today?.steps,
      goal: goals.data?.stepsGoal != null ? goals.data.stepsGoal * factor : null,
    },
    {
      label: 'Water',
      value: weekly ? health.body?.weekToDate?.waterMl : health.body?.today?.waterMl,
      goal: goals.data?.waterGoalMl != null ? goals.data.waterGoalMl * factor : null,
    },
    {
      label: 'Sleep',
      value: weekly ? progress.data?.sleep.thisWeekHours : progress.data?.sleep.lastNightHours,
      goal: goals.data?.sleepGoalHours != null ? goals.data.sleepGoalHours * factor : null,
    },
    {
      label: 'Calories',
      value: weekly ? health.body?.weekToDate?.calories : health.body?.today?.calories,
      goal:
        energy.data?.balance?.budgetKcal != null
          ? energy.data.balance.budgetKcal * factor
          : null,
    },
    {
      label: 'Workouts',
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
    <Card tone="activity">
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
        label="Goal period"
        options={[
          { label: 'Today', value: 'today' },
          { label: 'This Week', value: 'week' },
        ]}
        value={view}
        onChange={setView}
      />

      {visible.map((row) => (
        <Stack key={row.label}>
          <Stack direction="row" justify="space-between">
            <AppText variant="caption">{row.label}</AppText>
            <AppText variant="caption">
              {metricValue(row.value, '', 1)} / {metricValue(row.goal, '', 1)}
            </AppText>
          </Stack>
          <ProgressBar value={row.value! / row.goal!} />
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
