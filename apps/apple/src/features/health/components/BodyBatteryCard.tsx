import { useState } from 'react';
import { Pressable } from 'react-native';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import {
  AppText,
  Badge,
  Card,
  Grid,
  Icon,
  LineChart,
  MetricTile,
  ProgressBar,
  Stack,
} from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { batterySpec, metricValue } from '../data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { StressDayCard } from './StressDayCard';
import { HealthResourceHeader } from './HealthResourceHeader';

export function BodyBatteryCard() {
  const health = useHealthData();
  const state = useWorkoutResource(batterySpec(health.today));
  const [expanded, setExpanded] = useState(false);
  const data = state.data;
  return (
    <Card tone="brand">
      <HealthResourceHeader title="Body Battery" state={state} refresh={state.refresh} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Body Battery"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
      >
        <Stack direction="row" align="center" justify="space-between">
          <AppText variant="hero">{data?.hasData ? metricValue(data.current) : '—'}</AppText>
          <Icon name={expanded ? 'down' : 'forward'} tone="muted" />
        </Stack>
        <Stack direction="row" wrap>
          {data?.hasData ? (
            <>
              <Badge label={data.label} />
              <Badge label={data.trend} />
              {data.confidence && !data.confidence.sufficient && <Badge label="Limited data" />}
            </>
          ) : (
            data && <Badge label="No data yet" />
          )}
        </Stack>
      </Pressable>
      <AppText variant="caption" tone="muted">
        Energy left right now — opens at your readiness and drains as you use it.
      </AppText>
      {data?.hasData && <ProgressBar value={data.current / 100} origin="right" />}
      {expanded && data && (
        <>
          {data.hasData ? (
            <>
              <LineChart
                label="Body Battery today"
                domain={[0, 100]}
                fill
                points={data.series.map((point) => ({
                  label: formatTimeOfDay(point.t, health.timezone),
                  value: point.v,
                  x: point.t,
                }))}
              />
              <AppText variant="caption" tone="muted">
                Started at {data.anchor} from {data.anchorSource}
                {data.anchorProvisional ? ' · provisional until readiness arrives' : ''}
              </AppText>
              <Grid columns={2}>
                <MetricTile label="Charged" value={`+${data.charged}`} />
                <MetricTile label="Drained" value={`−${data.drained}`} />
              </Grid>
              {data.confidence && !data.confidence.sufficient && (
                <AppText variant="caption" tone="muted">
                  {metricValue(data.confidence.sampleCount)} recorded heart-rate readings. Treat
                  the number as a rough guide.
                </AppText>
              )}
            </>
          ) : (
            <AppText variant="caption" tone="muted">
              The day’s curve will appear once heart-rate readings arrive. No energy level is
              shown without recorded data.
            </AppText>
          )}
          <StressDayCard date={health.today} />
          <AppText variant="eyebrow" tone="muted">
            How it moves
          </AppText>
          <Grid columns={2}>
            <Card tone="activity">
              <AppText variant="label">Charges</AppText>
              <AppText variant="caption">Rest and sleep</AppText>
            </Card>
            <Card tone="heart">
              <AppText variant="label">Drains</AppText>
              <AppText variant="caption">Training and elevated heart rate</AppText>
            </Card>
          </Grid>
        </>
      )}
    </Card>
  );
}
