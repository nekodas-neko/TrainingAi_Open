import { useCallback, useEffect, useState } from 'react';
import { formatDateDisplay, formatTimeOfDay, toAestDay } from '@trainingai/shared/date-utils';
import {
  AppText,
  Card,
  Grid,
  Icon,
  LineChart,
  MetricTile,
  Stack,
  SwitchRow,
  SegmentedControl,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useLocalStorage } from '../../../core/storage/StorageProvider';
import { alertPermission } from '../../../integrations/notifications/platform';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../../health/data/HealthDataProvider';
import { ringBatterySpec } from '../../health/data/body-models';
import {
  DEFAULT_RING_ALERT,
  RING_ALERT_KEY,
  RING_ALERT_LEVELS,
  chargeTimeText,
  daysLeftText,
  drainChart,
  parseRingAlert,
  readingAge,
  type RingAlertSettings,
} from '../data/ring-battery';

const dash = '—';

// More → Devices → Oura Ring: the ring's battery and its health (#3069). Oura reports no capacity, so
// health is drain per day over time: a rising line means the ring holds charge for less time.
export function RingBatteryCard() {
  const battery = useWorkoutResource(ringBatterySpec);
  const { timezone } = useHealthData();
  const { theme } = useTheme();
  const storage = useLocalStorage().device();
  const [alert, setAlert] = useState<RingAlertSettings>(DEFAULT_RING_ALERT);
  useEffect(() => {
    let live = true;
    void storage
      .get(RING_ALERT_KEY)
      .catch(() => null)
      .then((raw) => live && setAlert(parseRingAlert(raw)));
    return () => {
      live = false;
    };
  }, [storage]);
  // Read again at save, so the alert watcher's own `fired` is not overwritten with a stale copy.
  const change = useCallback(
    async (patch: Partial<RingAlertSettings>) => {
      const current = parseRingAlert(await storage.get(RING_ALERT_KEY).catch(() => null));
      const next = { ...current, ...patch };
      setAlert(next);
      await storage.set(RING_ALERT_KEY, JSON.stringify(next)).catch(() => undefined);
    },
    [storage],
  );

  const data = battery.data;
  const latest = data?.latest ?? null;
  const chart = drainChart(data?.series ?? []);
  const charging = latest?.charging === true;
  return (
    <>
      <Card>
        <AppText variant="eyebrow" tone="muted">
          Oura Ring
        </AppText>
        {latest ? (
          <>
            <Stack direction="row" align="center" gap="md">
              <Icon
                name={latest.percent < alert.level ? 'batteryLow' : 'batteryFull'}
                tone={latest.percent < alert.level ? 'danger' : 'brand'}
                size={theme.sizes.emphasizedIcon}
              />
              <Stack gap="xxs">
                <AppText variant="wheelValue">{Math.round(latest.percent)}%</AppText>
                <AppText variant="caption" tone="muted">
                  {charging ? 'Charging' : 'Not charging'} · synced{' '}
                  {readingAge((Date.now() - latest.tsMs) / 60_000)}
                </AppText>
              </Stack>
            </Stack>
            {data?.daysLeft != null && (
              <AppText variant="caption">
                About {daysLeftText(data.daysLeft)} left at your usual drain
              </AppText>
            )}
          </>
        ) : (
          <AppText tone="muted">
            {battery.error && !data
              ? 'Couldn’t load the ring’s battery'
              : battery.loading
                ? 'Loading the ring’s battery'
                : 'No battery reading yet. It arrives with the Oura app’s next sync.'}
          </AppText>
        )}
      </Card>
      {latest && (
        <>
          <Card>
            <AppText variant="eyebrow" tone="muted">
              Battery health
            </AppText>
            {chart.points.length >= 2 ? (
              <LineChart
                label="Average battery drain per day, in percent"
                points={chart.points}
                axisLabels={chart.axisLabels}
                gaps="connect"
                readable
                yAxis
                dots="none"
              />
            ) : (
              <AppText variant="caption" tone="muted">
                The chart appears once the ring has a few days of readings.
              </AppText>
            )}
            <AppText variant="caption" tone="muted">
              Average drain per day. A rising line means the ring holds charge for less time than
              before.
            </AppText>
            <Grid columns={3} gap="sm">
              <MetricTile
                stat
                label="drain / day, last 30 days"
                value={data?.drainPerDayPct != null ? `${Math.round(data.drainPerDayPct)}%` : dash}
              />
              <MetricTile
                stat
                label="between charges"
                value={
                  data?.daysBetweenCharges != null
                    ? `${data.daysBetweenCharges.toFixed(1)} d`
                    : dash
                }
              />
              <MetricTile
                stat
                label="to charge, average"
                value={data?.avgChargeSec != null ? chargeTimeText(data.avgChargeSec) : dash}
              />
            </Grid>
          </Card>
          <Card>
            <Stack direction="row" justify="space-between" align="center">
              <AppText>Last charged</AppText>
              <AppText tone="muted">
                {data?.lastChargedMs != null
                  ? `${formatDateDisplay(toAestDay(new Date(data.lastChargedMs), timezone), 'short')}, ${formatTimeOfDay(data.lastChargedMs, timezone)}`
                  : dash}
              </AppText>
            </Stack>
            <SwitchRow
              label="Alert me when battery is low"
              value={alert.enabled}
              onValueChange={(enabled) => {
                void change({ enabled });
                // The first alert needs the permission; without it the screen still shows the level.
                if (enabled) void alertPermission(true).catch(() => undefined);
              }}
            />
            {alert.enabled && (
              <Stack gap="xs">
                <AppText variant="caption" tone="muted">
                  Alert level
                </AppText>
                <SegmentedControl
                  label="Alert level"
                  options={RING_ALERT_LEVELS.map((level) => ({
                    label: `${level}%`,
                    value: String(level),
                  }))}
                  value={String(alert.level)}
                  onChange={(level) => void change({ level: Number(level) })}
                />
              </Stack>
            )}
          </Card>
        </>
      )}
      <AppText variant="caption" tone="muted" style={{ paddingHorizontal: theme.spacing.xs }}>
        From the Oura app’s sync, so it can be a few hours old.
      </AppText>
    </>
  );
}
