import { assessFromTrends, type TrendPoint } from '@trainingai/shared/health/progress-markers';
import {
  computeHrZones,
  zoneForBpm,
  HR_REST_THRESHOLD,
  hrReserve,
} from '@trainingai/shared/health/hr-zones';
import { AppText, Card, Icon, Stack } from '../../../shared/ui';
import { ContributorDetails } from './ContributorCard';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { hrProfileSpec, readinessSpec, metricValue } from '../data/models';
import type { z } from 'zod';

export function HeartHeroValue({ bpm }: { bpm: number | null }) {
  const profile = useWorkoutResource(hrProfileSpec).data;
  const maxHr = profile?.workingMax ?? profile?.maxHr;
  const restingHr = profile?.restingHr;
  const zones =
    maxHr != null && restingHr != null && maxHr > restingHr
      ? computeHrZones({ maxHr, restingHr })
      : null;
  const grade =
    bpm != null && zones && restingHr != null && maxHr != null
      ? bpm <= restingHr + HR_REST_THRESHOLD * hrReserve(maxHr, restingHr)
        ? { name: 'Resting', color: zones[0].color }
        : zoneForBpm(bpm, zones)
      : null;
  return (
    <Stack align="center">
      <Icon name="health" />
      <AppText variant="title">
        {metricValue(bpm)}{' '}
        <AppText variant="label" tone="muted">
          bpm
        </AppText>
      </AppText>
      <AppText variant="caption" style={grade ? { color: grade.color } : undefined}>
        {grade?.name ?? 'Current heart rate'}
      </AppText>
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
      <AppText variant="eyebrow" tone="muted">
        Are you making progress?
      </AppText>
      <AppText variant="micro" tone="muted">
        baseline → now
      </AppText>
      {markers.map((marker) => (
        <Stack key={marker.key}>
          <AppText>{marker.summary}</AppText>
          <AppText variant="micro" tone="muted">
            {marker.retestCadence}
          </AppText>
        </Stack>
      ))}
    </Card>
  );
}
