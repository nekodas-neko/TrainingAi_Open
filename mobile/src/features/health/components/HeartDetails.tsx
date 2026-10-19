import { View } from 'react-native';
import {
  assessFromTrends,
  type MarkerAssessment,
  type TrendPoint,
} from '@trainingai/shared/health/progress-markers';
import { seriesShape, trimLeadingGaps } from '@trainingai/shared/health/series-gaps';
import { weekOverWeekChange } from '@trainingai/shared/health/trend-delta';
import {
  computeHrZones,
  zoneForBpm,
  HR_REST_THRESHOLD,
  hrReserve,
} from '@trainingai/shared/health/hr-zones';
import { AppText, Card, Icon, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import type { IconName } from '../../../shared/ui/Icon';
import { ContributorDetails } from './ContributorCard';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { hrProfileSpec, readinessSpec, metricValue } from '../data/models';
import { weekdayAxis } from '../data/body-view';
import { HealthMetricCard } from './HealthMetricCard';
import { useReadableCueColor } from './RangeBar';
import type { z } from 'zod';

export function HeartHeroValue({ bpm }: { bpm: number | null }) {
  const { theme } = useTheme();
  const profile = useWorkoutResource(hrProfileSpec).data;
  const maxHr = profile?.maxHr ?? profile?.workingMax;
  const restingHr = profile?.restingHr;
  const zones =
    maxHr != null && restingHr != null && maxHr > restingHr
      ? computeHrZones({ maxHr, restingHr })
      : null;
  const grade =
    bpm != null && zones && restingHr != null && maxHr != null
      ? bpm <= restingHr + HR_REST_THRESHOLD * hrReserve(maxHr, restingHr)
        ? { name: 'Resting', id: 1 }
        : zoneForBpm(bpm, zones)
      : null;
  const zoneColor = grade ? (theme.hrZoneColors[grade.id - 1] ?? zones?.[0].color) : undefined;
  return (
    <Stack align="center">
      <Icon name="health" />
      <AppText variant="title">
        {metricValue(bpm)}{' '}
        <AppText variant="label" tone="muted">
          bpm
        </AppText>
      </AppText>
      {grade && theme.mode === 'light' ? (
        // Light draws the zone as a pill: the zone colour alone on the hero's pink gradient read as
        // plain blue text rather than a status.
        <View
          style={{
            borderRadius: theme.radii.pill,
            borderWidth: 1,
            borderColor: zoneColor,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.sm,
            paddingVertical: theme.spacing.xxs,
          }}
        >
          <AppText variant="caption" style={{ color: zoneColor }}>
            {grade.name}
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" style={grade ? { color: zoneColor } : undefined}>
          {grade?.name ?? 'Current heart rate'}
        </AppText>
      )}
    </Stack>
  );
}
export function HeartFactors({
  data,
}: {
  data: z.infer<ReturnType<typeof readinessSpec>['schema']> | null;
}) {
  return (
    <ContributorDetails
      title="Understanding your heart metrics"
      factors={[
        {
          key: 'resting_heart_rate',
          label: 'Resting heart rate',
          extra:
            data?.hrMin != null
              ? `Lowest recorded today: ${metricValue(data.hrMin, 'bpm')}`
              : undefined,
        },
        {
          key: 'hrv_balance',
          label: 'Heart-rate variability (HRV)',
          extra:
            data?.recentHrv != null || data?.baselineHrv != null
              ? `Recent 7-day HRV ${metricValue(data?.recentHrv, 'ms')} · baseline ${metricValue(data?.baselineHrv, 'ms')}`
              : undefined,
        },
      ]}
    />
  );
}
export function HeartProgress({ trends }: { trends: TrendPoint[] | undefined }) {
  const markers =
    trends && trends.length >= 4
      ? assessFromTrends(trends).filter((m) => m.trend !== 'insufficient')
      : [];
  if (!markers.length) {
    return null;
  }
  return (
    <Card>
      <Stack direction="row" justify="space-between" align="center">
        <AppText variant="eyebrow" tone="muted">
          Are you making progress?
        </AppText>
        <AppText variant="micro" tone="muted">
          baseline → now
        </AppText>
      </Stack>
      {markers.map((marker) => (
        <ProgressLine key={marker.key} marker={marker} />
      ))}
    </Card>
  );
}

const trendLook: Record<
  MarkerAssessment['trend'],
  { icon: IconName; spoken: string; color: 'good' | 'watch' | 'muted' }
> = {
  improving: { icon: 'upper', spoken: 'improving', color: 'good' },
  declining: { icon: 'lower', spoken: 'slipping', color: 'watch' },
  stable: { icon: 'minus', spoken: 'steady', color: 'muted' },
  insufficient: { icon: 'info', spoken: 'unknown', color: 'muted' },
};
function ProgressLine({ marker }: { marker: MarkerAssessment }) {
  const { theme } = useTheme();
  const cueColor = useReadableCueColor();
  const look = trendLook[marker.trend];
  return (
    <Stack
      direction="row"
      align="flex-start"
      accessible
      accessibilityLabel={`${look.spoken}: ${marker.summary}. ${marker.retestCadence}`}
    >
      <Icon
        name={look.icon}
        size={theme.sizes.iconSmall}
        color={look.color === 'muted' ? theme.colors.muted : cueColor(look.color)}
      />
      <Stack gap="xxs" style={{ flex: 1 }}>
        <AppText>{marker.summary}</AppText>
        <AppText variant="micro" tone="muted">
          {marker.retestCadence}
        </AppText>
      </Stack>
    </Stack>
  );
}

/**
 * One of the three 14-day heart cards (resting heart rate, HRV, recovery): the line with its
 * y-axis, gridlines and weekday labels, how many days are missing, and the change since last
 * week. A metric with no reading in the window says why instead of showing an empty chart.
 */
export function HeartTrendCard({
  title,
  days,
  color,
  emptyText,
}: {
  title: string;
  days: readonly { date: string; value: number | null }[];
  color: string;
  emptyText: string;
}) {
  const cueColor = useReadableCueColor();
  const shown = trimLeadingGaps(days, (day) => day.value);
  if (!shown) {
    return (
      <HealthMetricCard title={title} caption="Last 14 days">
        <AppText variant="caption" tone="muted">
          {emptyText}
        </AppText>
      </HealthMetricCard>
    );
  }
  const missing = seriesShape(shown.map((day) => day.value)).coverage;
  const change = weekOverWeekChange(days.map((day) => day.value));
  return (
    <HealthMetricCard
      title={title}
      caption={`Last 14 days${missing ? ` · ${missing}` : ''}`}
      points={shown.map((day, index) => ({
        label: day.date,
        value: day.value,
        x: index,
      }))}
      chart={{
        readable: true,
        gridlines: true,
        yAxis: true,
        fill: true,
        dots: 'isolated',
        color,
        // trend-sparkline.tsx: an 88 px plot with at most four y labels.
        height: 88,
        tickCount: 4,
        axisLabels: weekdayAxis(shown.map((day) => day.date)),
      }}
      // The change sits at the top right of the title row, as the current app's does.
      status={
        change && (
          <AppText
            variant="micro"
            tone={change.direction === 'same' ? 'muted' : undefined}
            style={
              change.direction === 'same'
                ? undefined
                : { color: cueColor(change.direction === 'up' ? 'good' : 'bad') }
            }
          >
            {change.text}
          </AppText>
        )
      }
    />
  );
}
