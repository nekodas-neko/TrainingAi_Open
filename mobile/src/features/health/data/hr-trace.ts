import {
  closeClockSkip,
  formatMinutesOfDay,
  formatTimeOfDay,
  wallClockMinuteReader,
  type ClockSkip,
} from '@trainingai/shared/date-utils';
import { bucketAverage } from '@trainingai/shared/health/hr-smoothing';

/** Gaps wider than this, in elapsed minutes, are drawn as "Not recorded". */
const GAP_MIN = 30;

/**
 * The day's heart-rate readings as 10-minute buckets on the clock face (#3445). Minutes are the
 * wall-clock minute of the local day, so a 23- or 25-hour day still lines up with the 12am–12am axis.
 */
export function hrDayBuckets(
  readings: { timestamp: string; bpm: number }[],
  dayStartMs: number,
  timezone: string,
) {
  const minuteOf = wallClockMinuteReader(dayStartMs, timezone);
  return bucketAverage(
    readings
      .map((row) => ({ x: minuteOf(Date.parse(row.timestamp)), bpm: row.bpm }))
      .filter((p) => p.x >= 0 && p.x <= 1440),
    10,
  );
}

/**
 * Chart points for buckets on wall-clock minutes, with a "Not recorded" break wherever more than
 * 30 minutes passed. The hour a spring-forward day skips is closed first: 01:45 → 03:00 is a jump of
 * 75 wall-clock minutes but 15 real ones.
 */
export function hrTracePoints(buckets: { x: number; y: number }[], skip: ClockSkip | null) {
  return buckets.flatMap((p, i) => [
    ...(i && closeClockSkip(p.x, skip) - closeClockSkip(buckets[i - 1].x, skip) > GAP_MIN
      ? [{ x: p.x - 1, label: 'Not recorded', value: null }]
      : []),
    { x: p.x, label: formatMinutesOfDay(p.x), value: p.y },
  ]);
}

/**
 * The activity detail's heart-rate trace (#3702): one point per reading, x in minutes since the
 * activity's start (the pace series and the route scrub share that axis), labelled with the local
 * clock time. The current app's ActivityHrChart draws these as one connected line; Preview used to
 * break it wherever two readings were more than two minutes apart, which turned a sparse window
 * into short strokes, and labelled the axis with the raw UTC timestamp.
 */
export function activityHrPoints(
  readings: readonly { timestamp: string; bpm: number }[],
  start: number | null,
  timezone: string,
) {
  const timed = readings
    .map((row) => ({ at: Date.parse(row.timestamp), bpm: row.bpm }))
    .filter((row) => Number.isFinite(row.at))
    .sort((a, b) => a.at - b.at);
  if (!timed.length) return [];
  const origin = start != null && Number.isFinite(start) ? start : timed[0].at;
  return timed.map((row) => ({
    x: (row.at - origin) / 60000,
    label: formatTimeOfDay(row.at, timezone),
    value: row.bpm,
  }));
}

/**
 * Logged workouts as wall-clock minute windows for the day's heart-rate chart, by the current app's
 * rule (hr-day-chart.tsx workoutWindows): a finished session only, from its start to its completion,
 * and only when it ends after it starts. `minuteOf` places an instant on the day's clock face.
 */
export function hrWorkoutWindows(
  sessions: readonly { startedAt: string; completedAt: string | null }[],
  minuteOf: (ms: number) => number,
) {
  return sessions.flatMap((session) => {
    if (session.completedAt == null) return [];
    const start = minuteOf(Date.parse(session.startedAt));
    const end = minuteOf(Date.parse(session.completedAt));
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [{ from: start, to: end }] : [];
  });
}
