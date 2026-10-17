import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import type { BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band';
import { View } from 'react-native';
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
import { batteryColor } from '../../nutrition/data/display';

const trendLabel = { charging: 'Charging', draining: 'Draining', steady: 'Steady' } as const;
const anchorFrom = { readiness: ' from readiness', sleep: ' from sleep', default: '' } as const;

export function BodyBatteryCard() {
  const { theme } = useTheme();
  const health = useHealthData();
  const state = useWorkoutResource(batterySpec(health.today));
  const data = state.data;
  const lowData = !!data?.hasData && !!data.confidence && !data.confidence.sufficient;
  const color = batteryColor(
    (data?.label ?? 'Good') as BodyBatteryLabel,
    {
      colors: theme.colors,
      tones: theme.tones,
    },
  );
  return (
    <ExpandableCard
      title="Body Battery"
      subtitle={
        data?.hasData
          ? `${data.label} · ${trendLabel[data.trend]}`
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
        data ? (
          <View style={{ gap: theme.spacing.xs }}>
            {lowData && (
              <View
                style={{
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.spacing.xxs,
                  borderRadius: theme.radii.pill,
                  backgroundColor: theme.colors.brandSurface,
                  paddingHorizontal: theme.spacing.sm,
                  paddingVertical: theme.spacing.xxs,
                }}
              >
                <AppText variant="micro" tone="muted">
                  Limited data
                </AppText>
              </View>
            )}
            <AppText variant="micro" tone="muted">
              Energy left right now — opens at your readiness and drains as you use it.
            </AppText>
            <ProgressBar
              value={data.hasData ? data.current / 100 : 0}
              origin="right"
              color={color}
            />
          </View>
        ) : undefined
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
                Started at {data.anchor}
                {anchorFrom[data.anchorSource]}
                {data.anchorProvisional ? ' · provisional until readiness lands' : ''}
              </AppText>
              <Grid columns={2}>
                <MetricTile label="Charged" value={`+${data.charged}`} />
                <MetricTile label="Drained" value={`−${data.drained}`} />
              </Grid>
              {data.confidence && !data.confidence.sufficient && (
                <AppText variant="caption" tone="muted">
                  Your ring recorded only {metricValue(data.confidence.sampleCount)} heart-rate
                  readings since you woke — about {metricValue(data.confidence.samplesPerHour)} an
                  hour. The ring stops sampling when you are still, so today’s line is mostly gaps
                  held flat rather than a measured calm. Treat the number as a rough guide.
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
