import { bucketAverage } from '@trainingai/shared/health/hr-smoothing';
import { dateStrMidnightInTz, formatMinutesOfDay } from '@trainingai/shared/date-utils';
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band';
import { HealthResourceHeader } from './HealthResourceHeader';
import { AppText, Badge, Card, LineChart, Stack } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { daySpec } from '../../workouts/data/models';
import { useHealthData } from '../data/HealthDataProvider';
import { hrSpec, stressSpec } from '../data/models';
export function HrDayCard({
  embedded = false,
  color,
}: { embedded?: boolean; color?: string } = {}) {
  const { today, timezone, sleep } = useHealthData();
  const { theme } = useTheme();
  const state = useWorkoutResource(hrSpec(today));
  const stress = useWorkoutResource(stressSpec(today));
  const workouts = useWorkoutResource(daySpec(today));
  const midnight = dateStrMidnightInTz(today, timezone).getTime();
  const minute = (at: string | number) =>
    (typeof at === 'string' ? Date.parse(at) : at) - midnight;
  const readings = state.data?.readings ?? [];
  const buckets = bucketAverage(
    readings
      .map((row) => ({ x: minute(row.timestamp) / 60000, bpm: row.bpm }))
      .filter((p) => p.x >= 0 && p.x <= 1440),
    10,
  );
  const points = buckets.flatMap((p, i) => [
    ...(i && p.x - buckets[i - 1].x > 30
      ? [{ x: p.x - 1, label: 'Not recorded', value: null }]
      : []),
    { x: p.x, label: formatMinutesOfDay(p.x), value: p.y },
  ]);
  const night = sleep.find((n) => n.date === today);
  const sleepWindow =
    state.data?.sleep ??
    (night?.sleepStart && night.sleepEnd
      ? bedtimeToMinuteWindow(
          new Date(night.sleepStart),
          new Date(night.sleepEnd),
          today,
          timezone,
        )
      : null);
  const bands = [
    ...(sleepWindow
      ? [
          {
            from: sleepWindow.startMin,
            to: sleepWindow.endMin,
            label: 'Sleep',
            color: theme.tones.sleep.foreground,
          },
        ]
      : []),
    ...Object.values(workouts.data?.workoutDurationsById ?? {}).flatMap((d) =>
      d
        ? [
            {
              from: minute(d.start) / 60000,
              to: minute(d.end) / 60000,
              label: 'Workout',
              color: theme.tones.activity.foreground,
            },
          ]
        : [],
    ),
  ];
  const stressPoints = (stress.data?.series ?? []).flatMap((p, i, rows) => [
    ...(i && p.t - rows[i - 1].t > 75 * 60000
      ? [{ x: minute(p.t) / 60000 - 1, value: null }]
      : []),
    { x: minute(p.t) / 60000, value: p.level },
  ]);
  return (
    <Card
      padded={!embedded}
      style={embedded ? { borderWidth: 0, backgroundColor: 'transparent' } : undefined}
    >
      {!embedded && (
        <HealthResourceHeader
          title="Heart Rate · Today"
          state={state}
          refresh={state.refresh}
        />
      )}
      <LineChart
        color={color === 'transparent' ? undefined : color}
        points={points}
        xDomain={[0, 1440]}
        axisLabels={['00:00', '12:00', '24:00']}
        label="24h heart rate in bpm"
        tone="heart"
        bands={bands}
        interactive
        series={
          stressPoints.length
            ? [
                {
                  label: 'Measured stress',
                  color: theme.tones.recovery.foreground,
                  domain: [-1, 1],
                  points: stressPoints,
                },
              ]
            : []
        }
      />
      <Stack direction="row" wrap>
        {[...new Set(readings.map((r) => r.source).filter(Boolean))].map((source) => (
          <Badge key={source} label={source!} />
        ))}
        {sleepWindow && <Badge label="Sleep" tone="sleep" />}
        {bands.some((b) => b.label === 'Workout') && <Badge label="Workout" tone="activity" />}
        {stressPoints.length > 0 && (
          <Badge label="Measured stress · −1 to +1" tone="recovery" />
        )}
      </Stack>
      <AppText variant="micro" tone="muted">
        00:00 → 24:00 · Heart rate is averaged in 10-minute buckets. Gaps mean no recording.
      </AppText>
    </Card>
  );
}
