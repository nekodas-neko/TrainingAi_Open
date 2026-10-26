import { formatTimeOfDay } from '@trainingai/shared/date-utils';
import {
  BODY_BATTERY_PROVISIONAL_SUFFIX,
  BODY_BATTERY_SPARSE_DAY,
  bodyBatteryAnchorSuffix,
} from '@trainingai/shared/health/body-battery-copy';
import { AppText, Card, Grid, LineChart, MetricTile, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { metricValue, type batterySpec } from '../data/models';
import { StressDayCard } from './StressDayCard';
import type { z } from 'zod';

type Battery = z.infer<ReturnType<typeof batterySpec>['schema']>;

/** What Body Battery shows under its number: the day's curve, what charged and drained it, stress. */
export function BodyBatteryDetails({ data }: { data: Battery | null | undefined }) {
  const { theme } = useTheme();
  const health = useHealthData();
  return (
    <Stack
      gap="md"
      style={{
        paddingHorizontal: theme.spacing.md,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        borderTopWidth: 1,
        borderTopColor: theme.tones.brand.border,
      }}
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
    </Stack>
  );
}
