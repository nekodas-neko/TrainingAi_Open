import { hrChartDomain } from '@trainingai/shared/health/hr-smoothing';
import {
  clockSkipOnDay,
  dateStrMidnightInTz,
  wallClockMinuteReader,
} from '@trainingai/shared/date-utils';
import { bedtimeToMinuteWindow } from '@trainingai/shared/health/hr-sleep-band';
import { noHrDataCopy } from '@trainingai/shared/health/hr-source-copy';
import { stressRuns } from '@trainingai/shared/health/stress-day-line';
import { HealthResourceHeader } from './HealthResourceHeader';
import { AppText, Card, Legend, LineChart } from '../../../shared/ui';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { scaleAlpha } from '../../../shared/theme/alpha';
import { hrDayChartColors } from '../../../shared/theme/tokens';
import { useWorkoutResource } from '../../workouts/data/WorkoutDataProvider';
import { daySessionsSpec } from '../../workouts/data/models';
import { useHealthData } from '../data/HealthDataProvider';
import {
  hrDayBuckets,
  hrEstimatedPoints,
  hrTracePoints,
  hrWorkoutLabel,
  hrWorkoutWindows,
} from '../data/hr-trace';
import { hrSpec, stressSpec } from '../data/models';
// hr-day-chart.tsx windowDefs: the sleep window is drawn at 14%, the workout window at 22%.
const HR_SLEEP_BAND_OPACITY = 0.14;
const HR_WORKOUT_BAND_OPACITY = 0.22;
export function HrDayCard({
  embedded = false,
  color,
  title = 'Heart Rate · Today',
  showEstimated = false,
}: {
  embedded?: boolean;
  color?: string;
  title?: string;
  /** Bridge gaps of 20 to 120 minutes with a dashed "Estimated" line: Home's card only, as in the current app. */
  showEstimated?: boolean;
} = {}) {
  const { today, timezone, sleep } = useHealthData();
  const { theme } = useTheme();
  const state = useWorkoutResource(hrSpec(today));
  const stress = useWorkoutResource(stressSpec(today));
  const workouts = useWorkoutResource(daySessionsSpec(today));
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
            opacity: HR_SLEEP_BAND_OPACITY,
          },
        ]
      : []),
    ...hrWorkoutWindows(workouts.data?.sessions ?? [], wallMinute).map((window) => ({
      ...window,
      label: hrWorkoutLabel(window.name),
      color: hrDayChartColors.workoutBand,
      opacity: HR_WORKOUT_BAND_OPACITY,
    })),
  ];
  // Negated, so stress points up as on "When the day ran stressed" (#3935).
  const stressPoints = stressRuns(stress.data?.series ?? []).flatMap((run, i) => [
    ...(i ? [{ x: minute(run[0].t) - 1, value: null }] : []),
    ...run.map((p) => ({ x: minute(p.t), value: 0 - p.level })),
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
  // hr-day-chart.tsx: with no card colour the line is neutral, white at 75% on dark, slate at 70% on light.
  const hrColor =
    lineColor ?? scaleAlpha(theme.colors.text, theme.mode === 'dark' ? 0.75 : 0.7);
  const workoutBands = bands.filter((b) => b.label !== 'Sleep');
  const estimated = showEstimated ? hrEstimatedPoints(buckets, skip) : [];
  const estimatedColor = scaleAlpha(
    theme.mode === 'dark' ? hrDayChartColors.estimated.dark : hrDayChartColors.estimated.light,
    0.6,
  );
  // The legend names what the chart draws, as the current app's does; it carries no source chips.
  const legend = [
    ...(sleepWindow ? [{ label: 'Sleep', color: theme.tones.sleep.foreground }] : []),
    ...[...new Set(workoutBands.map((b) => b.label))].map((label) => ({
      label,
      color: hrDayChartColors.workoutBand,
    })),
    { label: 'Heart rate', color: hrColor },
    ...(stressPoints.length
      ? [{ label: 'Stress (−1 to +1)', color: theme.tones.recovery.foreground }]
      : []),
    ...(estimated.length ? [{ label: 'Estimated', color: estimatedColor }] : []),
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
        color={hrColor}
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
        boundedAxis
        label="24h heart rate in bpm"
        tone="heart"
        bands={bands}
        interactive={!embedded}
        series={[
          ...(estimated.length
            ? [{ label: 'Estimated', color: estimatedColor, dashed: true, points: estimated }]
            : []),
          ...(stressPoints.length
            ? [
                {
                  label: 'Estimated stress',
                  color: theme.tones.recovery.foreground,
                  domain: [-1, 1] as const,
                  points: stressPoints,
                },
              ]
            : []),
        ]}
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
