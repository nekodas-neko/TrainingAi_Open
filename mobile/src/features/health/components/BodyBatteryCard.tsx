import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import {
  AppText,
  Card,
  ExpandableCard,
  Grid,
  LineChart,
  MetricTile,
  ProgressBar,
  StatusIndicator,
} from '../../../shared/ui';
import { useHealthData } from '../data/HealthDataProvider';
import { batterySpec, metricValue } from '../data/models';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { StressDayCard } from './StressDayCard';

export function BodyBatteryCard() {
  const { theme } = useTheme();
  const health = useHealthData();
  const state = useWorkoutResource(batterySpec(health.today));
  const data = state.data;
  return (
    <ExpandableCard
      title="Body Battery"
      subtitle={
        data?.hasData
          ? `${data.label} · ${data.trend}`
          : data
            ? 'No data yet'
            : 'Waiting for readings'
      }
      icon="battery"
      tone="brand"
      value={data?.hasData ? metricValue(data.current) : undefined}
      status={
        (state.loading && !data) || state.error ? (
          <StatusIndicator
            label="Body Battery"
            busy={state.loading && !data}
            error={state.error}
            onRetry={state.refresh}
          />
        ) : undefined
      }
      summary={
        data?.hasData ? <ProgressBar value={data.current / 100} origin="right" /> : undefined
      }
    >
      {data ? (
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
                Started at {data.anchor} from{' '}
                {data.anchorSource}
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
            <Card
              tone="activity"
              style={{ flex: 1, gap: theme.spacing.xs, padding: theme.spacing.md }}
            >
              <AppText variant="label">Charges</AppText>
              <AppText variant="caption">Rest and sleep</AppText>
            </Card>
            <Card
              tone="heart"
              style={{ flex: 1, gap: theme.spacing.xs, padding: theme.spacing.md }}
            >
              <AppText variant="label">Drains</AppText>
              <AppText variant="caption">Training and elevated heart rate</AppText>
            </Card>
          </Grid>
        </>
      ) : (
        <AppText variant="caption" tone="muted">
          Your recorded readings will appear here when available.
        </AppText>
      )}
    </ExpandableCard>
  );
}
