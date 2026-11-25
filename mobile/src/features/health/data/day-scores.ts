import { metricValue } from './models';

/**
 * One tile of the day screen's score row. A day that was not scored says so, in muted text,
 * instead of a coloured dash that reads as a zero. `missing` is what the tile says when there is
 * nothing to show ("No score" for a score, "No reading" for resting heart rate, which is a
 * measurement and not a score).
 */
export function dayScoreTile(
  value: unknown,
  missing: string,
): { text: string; muted: boolean } {
  const text = metricValue(value);
  return text === '—' ? { text: missing, muted: true } : { text, muted: false };
}
