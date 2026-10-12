import { useState } from 'react';
import { ActivityEditor } from '../../activities/components/ActivityEditor';
import { useActivities, useActivityLogs } from '../../activities/data/ActivityProvider';
import { dayTimeInstant } from '../data/manual-night';
import { z } from 'zod';
import { computeHrZones } from '@trainingai/shared/health/hr-zones';
import { zoneBreakdownFromReadings } from '@trainingai/shared/health/zone-minutes';
import { formatHoursMinutes } from '@trainingai/shared/format/units';
import {
  AppText,
  AppButton,
  Card,
  Grid,
  KeyValueGrid,
  LineChart,
  MetricTile,
  ProgressBar,
  Stack,
} from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { useHealthData } from '../data/HealthDataProvider';
import { activityHistorySpec, hrProfileSpec, metricValue } from '../data/models';
import { HealthResourceHeader } from './HealthResourceHeader';
import { HealthViewReady } from './HealthViewReady';
export type HealthActivity = z.infer<typeof activityHistorySpec.schema>['activityLogs'][number];
export function activityFacts(log: HealthActivity) {
  return (
    [
      ['distanceKm', 'Distance', 'km'],
      ['caloriesBurned', 'Calories (est.)', 'kcal'],
      ['avgHr', 'Average HR', 'bpm'],
      ['maxHr', 'Max HR', 'bpm'],
      ['steps', 'Steps (est.)', ''],
      ['elevationGainM', 'Elevation gain', 'm'],
    ] as const
  )
    .filter(([key]) => log[key] != null)
    .map(([key, label, unit]) => ({
      label,
      value: metricValue(log[key], unit, key === 'distanceKm' ? 2 : 0),
    }));
}
const pace = (v: number) =>
  `${Math.floor(v / 60)}:${String(Math.round(v % 60)).padStart(2, '0')}/km`;
export function ActivityDetails({ log: original }: { log: HealthActivity }) {
  const history = useWorkoutResource(activityHistorySpec);
  const entries = useActivityLogs(
    history.data?.activityLogs ?? [],
    original.date.replace(/\//g, '-'),
    original.date.replace(/\//g, '-'),
  );
  const log = entries.find((row) => row.id === original.id) ?? original;
  const { timezone } = useHealthData();
  const [editing, setEditing] = useState(false);
  const activity = useActivities();
  const { theme } = useTheme();
  const enabled = !!log.startTime && !!log.endTime;
  const windowSpec = {
    path: '/api/oura/hr-window',
    query: { date: log.date, startTime: log.startTime ?? '', endTime: log.endTime ?? '' },
    ttl: 900000,
    schema: z.object({
      avgHr: z.number().nullish(),
      maxHr: z.number().nullish(),
      readings: z.array(z.object({ timestamp: z.string(), bpm: z.number().finite() })),
    }),
  };
  const hr = useWorkoutResource(windowSpec, enabled);
  const profile = useWorkoutResource(hrProfileSpec);
  const start = log.startTime
    ? Date.parse(dayTimeInstant(log.date, log.startTime, timezone) ?? '')
    : null;
  const readings =
    hr.data?.readings.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)) ?? [];
  const points = readings.flatMap((p, i) => [
    ...(i && Date.parse(p.timestamp) - Date.parse(readings[i - 1].timestamp) > 120000
      ? [
          {
            x:
              (Date.parse(p.timestamp) - (start ?? Date.parse(readings[0].timestamp))) / 60000 -
              0.01,
            label: 'Not recorded',
            value: null,
          },
        ]
      : []),
    {
      x: (Date.parse(p.timestamp) - (start ?? Date.parse(readings[0].timestamp))) / 60000,
      label: p.timestamp,
      value: p.bpm,
    },
  ]);
  const maxHr = profile.data?.workingMax ?? profile.data?.maxHr;
  const restingHr = profile.data?.restingHr;
  const zones =
    maxHr != null && restingHr != null && readings.length > 1
      ? zoneBreakdownFromReadings(
          readings.map((p) => ({ timestamp: Date.parse(p.timestamp), bpm: p.bpm })),
          computeHrZones({ maxHr, restingHr }),
        )
      : null;
  return (
    <HealthViewReady view="day" requests={[hrProfileSpec, ...(enabled ? [windowSpec] : [])]}>
      <AppText variant="caption" tone="muted">
        {log.date} · {log.startTime ?? ''}
        {log.endTime ? ` → ${log.endTime}` : ''}
      </AppText>
      <Grid columns={3}>
        <MetricTile label="Duration" value={metricValue(log.durationMin, 'min')} />
        <MetricTile label="Distance" value={metricValue(log.distanceKm, 'km', 2)} />
        {log.avgPaceSecPerKm != null && (
          <MetricTile label="Average pace" value={pace(log.avgPaceSecPerKm)} />
        )}
      </Grid>
      <KeyValueGrid rows={activityFacts(log)} />
      {log.cadenceSpm != null && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Cadence
          </AppText>
          <AppText variant="caption">
            {metricValue(log.cadenceSpm, 'spm')} average
            {log.cadenceSource ? ` · ${log.cadenceSource}` : ''}
          </AppText>
          {!!log.cadenceSeries?.length && (
            <LineChart
              label="Recorded cadence"
              points={log.cadenceSeries.map((p) => ({
                x: p.tSec,
                label: `${Math.round(p.tSec / 60)} min`,
                value: p.spm,
              }))}
            />
          )}
        </Card>
      )}
      {(log.elevationGainM != null || log.elevationLossM != null) && (
        <KeyValueGrid
          rows={[
            { label: 'Elevation gain', value: metricValue(log.elevationGainM, 'm') },
            { label: 'Elevation loss', value: metricValue(log.elevationLossM, 'm') },
          ]}
        />
      )}
      {enabled && (
        <Card>
          <HealthResourceHeader title="Heart Rate & Pace" state={hr} refresh={hr.refresh} />
          <LineChart
            label="Recorded heart rate"
            points={points}
            interactive
            tone="heart"
            series={
              log.paceSeries?.length
                ? [
                    {
                      label: 'Pace (sec/km)',
                      color: theme.colors.brand,
                      domain: [
                        Math.max(...log.paceSeries.map((p) => p.paceSec)),
                        Math.min(...log.paceSeries.map((p) => p.paceSec)),
                      ],
                      points: log.paceSeries.map((p) => ({ x: p.tSec / 60, value: p.paceSec })),
                    },
                  ]
                : []
            }
          />
          <AppText variant="micro" tone="muted">
            Heart rate · bpm
            {log.paceSeries?.length ? ' · Pace · sec/km (quicker toward the top)' : ''}
          </AppText>
        </Card>
      )}
      {zones && zones.totalSec > 0 && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Time in Zone · Session load {zones.sessionLoad}
          </AppText>
          {[...zones.zones].reverse().map((zone) => (
            <Stack key={zone.id}>
              <Stack direction="row" justify="space-between">
                <AppText variant="micro" tone="muted">
                  Z{zone.id} {zone.name}
                </AppText>
                <AppText variant="micro" tone="muted">
                  {formatHoursMinutes(zone.seconds / 60)}
                </AppText>
              </Stack>
              <ProgressBar value={zone.pct / 100} color={zone.color} />
            </Stack>
          ))}
        </Card>
      )}
      {!!log.splits?.length && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Splits
          </AppText>
          <LineChart
            label="Split pace in seconds per km"
            points={log.splits.map((s) => ({ label: `Km ${s.km}`, value: s.paceSec }))}
          />
          <KeyValueGrid
            rows={log.splits.map((s) => ({ label: `Km ${s.km}`, value: pace(s.paceSec) }))}
          />
        </Card>
      )}
      {!!log.elevationProfile?.length && (
        <Card>
          <AppText variant="eyebrow" tone="muted">
            Elevation
          </AppText>
          <LineChart
            label="Elevation in meters"
            points={log.elevationProfile.map((p) => ({
              x: p.distKm,
              label: `${p.distKm.toFixed(2)} km`,
              value: p.eleM,
            }))}
          />
        </Card>
      )}
      {log.notes && <AppText>{log.notes}</AppText>}
      <AppButton
        title="Edit activity"
        variant="surface"
        disabled={
          !activity.ready ||
          activity.rows.some((row) => row.pending && row.payload.id === log.id)
        }
        onPress={() => setEditing(true)}
      />
      {editing && <ActivityEditor log={log} onClose={() => setEditing(false)} />}
      {log.source && (
        <AppText variant="micro" tone="muted">
          Source: {log.source}
        </AppText>
      )}
    </HealthViewReady>
  );
}
