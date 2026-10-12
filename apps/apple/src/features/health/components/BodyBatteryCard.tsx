import { useState } from 'react';
import { useTheme } from '../../../shared/theme/ThemeProvider';
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
  const [expanded, setExpanded] = useState(false);
  const data = state.data;
  return (
    <Card tone="brand" style={{ padding: theme.spacing.md, gap: theme.spacing.xs }}>
      <Stack direction="row" align="center" gap="xs">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Body Battery"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={{ flex: 1 }}
        >
          <Stack direction="row" align="center" gap="xs">
            <Icon
              name={data?.hasData ? 'battery' : 'info'}
              size={theme.sizes.iconSmall}
              tone={data?.hasData ? 'brand' : 'muted'}
            />
            <AppText variant="micro" tone="muted">
              Body Battery
            </AppText>
            <AppText variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
              {data?.hasData ? data.label : data ? 'No data yet' : '—'}
            </AppText>
            <AppText variant="micro" tone="muted">
              {data?.hasData ? data.trend : ''}
            </AppText>
            <AppText variant="hero" style={{ flex: 1, textAlign: 'right' }}>
              {data?.hasData ? metricValue(data.current) : '—'}
            </AppText>
            <Icon
              name={expanded ? 'down' : 'forward'}
              size={theme.sizes.iconSmall}
              tone="muted"
            />
          </Stack>
        </Pressable>
        <StatusIndicator
          label="Body Battery"
          busy={state.loading && !data}
          error={state.error}
          onRetry={state.refresh}
        />
      </Stack>
      <ProgressBar value={data?.hasData ? data.current / 100 : 0} origin="right" />
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
                {data.anchorProvisional ? ' · provisional until energy arrives' : ''}
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
