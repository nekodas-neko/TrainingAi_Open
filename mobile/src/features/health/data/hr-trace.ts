import {
  closeClockSkip,
  formatMinutesOfDay,
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
