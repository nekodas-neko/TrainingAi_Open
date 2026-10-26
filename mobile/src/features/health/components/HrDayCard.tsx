import { hrChartDomain } from '@trainingai/shared/health/hr-smoothing';
import {
  clockSkipOnDay,
  closeClockSkip,
  dateStrMidnightInTz,
  wallClockMinuteReader,
} from '@trainingai/shared/date-utils';
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band';
import { noHrDataCopy } from '@trainingai/shared/health/hr-source-copy';
import { HealthResourceHeader } from './HealthResourceHeader';
import { AppText, Card, Legend, LineChart } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { daySpec } from '../../workouts/data/models';
import { useHealthData } from '../data/HealthDataProvider';
import { hrDayBuckets, hrTracePoints } from '../data/hr-trace';
import { hrSpec, stressSpec } from '../data/models';
export function HrDayCard({
  embedded = false,
  color,
  title = 'Heart Rate · Today',
}: { embedded?: boolean; color?: string; title?: string } = {}) {
  const { today, timezone, sleep } = useHealthData();
  const { theme } = useTheme();
  const state = useWorkoutResource(hrSpec(today));
  const stress = useWorkoutResource(stressSpec(today));
  const workouts = useWorkoutResource(daySpec(today));
  const midnight = dateStrMidnightInTz(today, timezone).getTime();
  // Wall-clock minutes of the day, so the axis is the clock face on a 23- or 25-hour day too (#3445).
  const wallMinute = wallClockMinuteReader(midnight, timezone);
  const skip = clockSkipOnDay(midnight, timezone);
  const minute = (at: string | number) => wallMinute(typeof at === 'string' ? Date.parse(at) : at);
  const readings = state.data?.readings ?? [];
  const buckets = hrDayBuckets(readings, midnight, timezone);
  const points = hrTracePoints(buckets, skip);
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
              from: minute(d.start),
              to: minute(d.end),
              label: 'Workout',
              color: theme.tones.activity.foreground,
            },
          ]
        : [],
    ),
  ];
  const stressPoints = (stress.data?.series ?? []).flatMap((p, i, rows) => [
    ...(i && p.t - rows[i - 1].t > 75 * 60000
      ? [{ x: minute(p.t) - 1, value: null }]
      : []),
    { x: minute(p.t), value: p.level },
  ]);
  // With nothing to draw the card is a heading and one line, as the current app's is: no plot box,
  // legend or footnote. The tall plot returns once readings arrive (Home needs two for a line).
  const waiting = state.loading && !state.data;
  const failed = state.error && !state.data;
  if (embedded && readings.length < 2) {
    return (
      <AppText variant="caption" tone="muted">
        {waiting ? ' ' : failed ? 'Couldn’t load heart rate' : 'No heart-rate data today'}
      </AppText>
    );
  }
  if (!embedded && readings.length === 0) {
    return (
      <Card>
        <HealthResourceHeader
          title={title}
          state={state}
          refresh={state.refresh}
        />
        <AppText variant="caption" tone="muted">
          {waiting ? ' ' : failed ? 'Couldn’t load today’s heart rate' : noHrDataCopy(null, 'day')}
        </AppText>
      </Card>
    );
  }
  const lineColor = color === 'transparent' ? undefined : color;
  const hrColor = lineColor ?? theme.tones.heart.foreground;
  const hasWorkout = bands.some((b) => b.label === 'Workout');
  // The legend names what the chart draws, as the current app's does; it carries no source chips.
  const legend = [
    ...(sleepWindow ? [{ label: 'Sleep', color: theme.tones.sleep.foreground }] : []),
    ...(hasWorkout ? [{ label: 'Workout', color: theme.tones.activity.foreground }] : []),
    { label: 'Heart rate', color: hrColor },
    ...(stressPoints.length
      ? [{ label: 'Stress (−1 to +1)', color: theme.tones.recovery.foreground }]
      : []),
  ];
  // Fitted to the day with 10 bpm of headroom either side, as the current app's chart is.
  const domain = hrChartDomain(buckets.map((p) => p.y));
  return (
    <Card
      padded={!embedded}
      style={embedded ? { borderWidth: 0, backgroundColor: 'transparent' } : undefined}
    >
      {!embedded && (
        <HealthResourceHeader
          title={title}
          state={state}
          refresh={state.refresh}
        />
      )}
      <LineChart
        color={lineColor}
        points={points}
        xDomain={[0, 1440]}
        domain={domain}
        axisLabels={['12am', '6am', '12pm', '6pm', '12am']}
        readable
        gridlines
        yAxis
        dots="none"
        height={theme.sizes.hrChartHeight}
        tickCount={4}
        label="24h heart rate in bpm"
        tone="heart"
        bands={bands}
        interactive={!embedded}
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
      <Legend items={legend} />
      {!embedded && (
        <AppText variant="micro" tone="muted">
          Averaged in 10-minute buckets. Gaps mean no recording.
        </AppText>
      )}
    </Card>
  );
}
