import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import { formatDateDisplay, shiftDateStr } from '@trainingai/shared/date-utils';
import { computeHrZones } from '@trainingai/shared/health/hr-zones';
import {
  AppText,
  Card,
  Grid,
  MetricTile,
  ProgressBar,
  SegmentedControl,
  StackedBarChart,
  Stack,
  StableContent,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { ResourceStatus } from '../../workouts/components/ResourceStatus';
import { useHealthData } from '../data/HealthDataProvider';
import {
  zoneSpec,
  sleepCorrelationSpec,
  hrProfileSpec,
  metricValue,
} from '../data/models';
import { HealthMetricCard } from './HealthMetricCard';

export function TimeInZoneCard() {
  const { theme } = useTheme();
  const { today } = useHealthData();
  const [window, setWindow] = useState<'day' | 'week' | 'month'>('week');
  const state = useWorkoutResource(
    zoneSpec(shiftDateStr(today, -(window === 'day' ? 0 : window === 'week' ? 6 : 29)), today),
  );
  const zones = state.data ? computeHrZones(state.data.profile) : [];
  const sums = [0, 0, 0, 0, 0];
  for (const day of state.data?.days ?? []) {
    day.seconds.forEach((seconds, index) => {
      sums[index] += seconds;
    });
  }
  const total = sums.reduce((sum, value) => sum + value, 0);
  return (
    <Card>
      <HealthResourceHeader title={'Time in Zones'} state={state} refresh={state.refresh} />
      <SegmentedControl
        label="Heart-rate zone period"
        options={[
          { label: 'Day', value: 'day' },
          { label: 'Week', value: 'week' },
          { label: 'Month', value: 'month' },
        ]}
        value={window}
        onChange={setWindow}
      />

      {state.data?.profile.maxHrSource === 'cooper-blend' && (
        <AppText variant="caption" tone="muted">
          Zone boundaries use your Cooper test peak blended with your age estimate.
        </AppText>
      )}
      <StableContent loading={state.data === null && state.loading}>
        {state.data && state.data.hasHrSource !== false && (
          <StackedBarChart
            label="Recorded heart-rate zone minutes"
            unit="min"
            readable
            gridlines
            yAxis
            bars={state.data.days.map((day, index) => ({
              // Weekday names read at a glance; a month of bars would collide, so every
              // seventh bar carries its date and the rest stay blank.
              label:
                window === 'month'
                  ? index % 7 === 0
                    ? formatDateDisplay(day.day, 'short')
                    : ''
                  : formatDateDisplay(day.day, 'weekday'),
              segments: zones.map((zone, index) => ({
                label: zone.name,
                value: day.seconds[index] / 60,
                color: theme.hrZoneColors[index] ?? zone.color,
              })),
            }))}
          />
        )}
        {state.data?.hasHrSource === false ? (
          <AppText variant="caption" tone="muted">
            No heart-rate source recorded for this profile.
          </AppText>
        ) : (
          state.data &&
          zones.map((zone, index) => (
            <Stack key={zone.id}>
              <Stack direction="row" justify="space-between">
                <AppText variant="caption">
                  {zone.name} · {zone.minBpm}–
                  {Number.isFinite(zone.maxBpm) ? Math.round(zone.maxBpm) : 'max'} bpm
                </AppText>
                <AppText variant="caption">{metricValue(sums[index] / 60, 'min')}</AppText>
              </Stack>
              <ProgressBar value={total ? sums[index] / total : 0} />
            </Stack>
          ))
        )}
      </StableContent>
    </Card>
  );
}
export function SleepPerformanceCard() {
  const state = useWorkoutResource(sleepCorrelationSpec);
  if (state.data && !state.data.hasSufficientData) {
    return null;
  }
  return (
    <HealthMetricCard
      title="Sleep vs Performance"
      points={state.data?.buckets.map((bucket) => ({
        label: `${bucket.label} (n=${bucket.count})`,
        value: bucket.avgPctChange,
      }))}
      status={
        <ResourceStatus
          inline
          label="Sleep vs Performance"
          state={state}
          refresh={state.refresh}
        />
      }
    >
      {state.data && (
        <AppText variant="caption" tone="muted">
          {state.data.insight}
        </AppText>
      )}
    </HealthMetricCard>
  );
}
export function ObservedHeartCard() {
  const state = useWorkoutResource(hrProfileSpec);
  return (
    <Card>
      <HealthResourceHeader
        title={'Observed Heart Rate · Last 90 days'}
        state={state}
        refresh={state.refresh}
      />

      {state.data && (
        <>
          <Grid columns={3}>
            {(['max', 'avg', 'min'] as const).map((key) => (
              <MetricTile
                key={key}
                label={key}
                value={metricValue(state.data!.observed[key], 'bpm')}
                tone="heart"
              />
            ))}
          </Grid>
          <AppText variant="caption" tone="muted">
            Working max {metricValue(state.data.workingMax, 'bpm')} ·{' '}
            {state.data.workingMaxSource === 'cooper-blend'
              ? 'from your Cooper test and age'
              : state.data.workingMaxSource.replace(/-/g, ' ')}
          </AppText>
          {!state.data.observed.isReliable && (
            <AppText variant="caption" tone="muted">
              Not enough recorded heart-rate data for a confident observed maximum.
            </AppText>
          )}
        </>
      )}
    </Card>
  );
}
