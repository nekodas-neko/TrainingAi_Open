import { useTheme } from '../../../shared/theme/ThemeProvider';
import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import type { BodyBatteryLabel } from '@trainingai/shared/health/body-battery-band';
import {
  BODY_BATTERY_EXPLAINER,
  BODY_BATTERY_PROVISIONAL_SUFFIX,
  BODY_BATTERY_SPARSE_DAY,
  bodyBatteryAnchorSuffix,
} from '@trainingai/shared/health/body-battery-copy';
import { View } from 'react-native';
import {
  AppText,
  Badge,
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
import { batterySummary } from '../data/battery-summary';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { StressDayCard } from './StressDayCard';
import { batteryColor } from '../../../shared/battery-color';

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
      status: theme.status,
    },
  );
  return (
    <ExpandableCard
      title="Body Battery"
      subtitle={batterySummary(data).subtitle}
      icon="battery"
      tone="brand"
      value={batterySummary(data).value}
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
              <Badge label="Limited data" tone="brand" />
            )}
            <AppText variant="micro" tone="muted">
              {BODY_BATTERY_EXPLAINER}
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
                {bodyBatteryAnchorSuffix(data.anchorSource)}
                {data.anchorProvisional ? BODY_BATTERY_PROVISIONAL_SUFFIX : ''}
              </AppText>
              <Grid columns={2}>
                <MetricTile label="Charged" value={`+${data.charged}`} />
                <MetricTile label="Drained" value={`−${data.drained}`} />
              </Grid>
              {data.confidence && !data.confidence.sufficient && (
                <AppText variant="caption" tone="muted">
                  {BODY_BATTERY_SPARSE_DAY[0]}
                  {metricValue(data.confidence.sampleCount)}
                  {BODY_BATTERY_SPARSE_DAY[1]}
                  {metricValue(data.confidence.samplesPerHour, '', 1)}
                  {BODY_BATTERY_SPARSE_DAY[2]}
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
