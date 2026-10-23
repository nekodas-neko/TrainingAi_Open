import { View } from 'react-native';
import { HealthResourceHeader } from './HealthResourceHeader';
import { useState } from 'react';
import { formatDateDisplay, shiftDateStr } from '@trainingai/shared/date-utils';
import { computeHrZones } from '@trainingai/shared/health/hr-zones';
import { maxHrSourceNote } from '@trainingai/shared/health/hr-source-copy';
import { plural } from '@trainingai/shared/format/plural';
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
import { zoneSpec, sleepCorrelationSpec, hrProfileSpec, metricValue } from '../data/models';
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
      <HealthResourceHeader
        title={'Time in Zones'}
        state={state}
        refresh={state.refresh}
        trailing={
          <View style={{ width: theme.sizes.zonePeriodToggle }}>
            <SegmentedControl
              appearance="tabs"
              size="xs"
              label="Heart-rate zone period"
              options={[
                { label: 'Day', value: 'day' },
                { label: 'Week', value: 'week' },
                { label: 'Month', value: 'month' },
              ]}
              value={window}
              onChange={setWindow}
            />
          </View>
        }
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
  const { theme } = useTheme();
  const profile = state.data;
  const observed = profile?.observed;
  // Stand-in notices are amber in the current app: a number worth a second look, not an error.
  const warning = { color: theme.tones.checkin.foreground };
  const maxNote = maxHrSourceNote(
    profile?.workingMaxSource as Parameters<typeof maxHrSourceNote>[0],
  );
  const rejected = observed?.outOfBandRejected ?? 0;
  return (
    <Card>
      <HealthResourceHeader
        title={'Heart-rate profile · Last 90 days'}
        state={state}
        refresh={state.refresh}
      />

      {profile && observed && (
        <>
          <Grid columns={3}>
            <MetricTile
              label="Max recorded"
              emphasize
              value={metricValue(observed.max)}
              unit="bpm"
              stat
            />
            <MetricTile
              label="Average"
              value={metricValue(observed.avg)}
              unit="bpm"
              stat
            />
            <MetricTile
              label="Min"
              value={metricValue(observed.min)}
              unit="bpm"
              stat
            />
          </Grid>
          <Stack gap="xs">
            <AppText variant="caption" tone="muted">
              Working max{' '}
              <AppText variant="caption">{metricValue(profile.workingMax, 'bpm')}</AppText> (
              {maxNote.label}). Age estimate {metricValue(profile.estimatedMax)} · resting{' '}
              {metricValue(profile.restingHr)}.
            </AppText>
            {maxNote.detail && (
              <AppText variant="caption" style={warning}>
                {maxNote.detail}
              </AppText>
            )}
            {!observed.isReliable && !maxNote.standIn && (
              <AppText variant="caption" style={warning}>
                Not enough monitored heart-rate data yet for a confident max — a few harder
                sessions with heart rate recorded will sharpen it. Using the age estimate for
                now.
              </AppText>
            )}
            {observed.isReliable &&
              observed.highestPlausible != null &&
              observed.max != null && (
                <AppText variant="caption" tone="muted">
                  Your max is a level you’ve reached repeatedly, not a one-off blip
                  {observed.highestPlausible > observed.max
                    ? ` — the single highest reading was ${observed.highestPlausible} bpm`
                    : ''}
                  .
                </AppText>
              )}
            {rejected > 0 && (
              <AppText variant="caption" style={warning}>
                {plural(rejected, 'reading was', 'readings were')} discarded as impossible
                (outside 30–220 bpm) — worth a look if that count keeps climbing.
              </AppText>
            )}
          </Stack>
        </>
      )}
    </Card>
  );
}
