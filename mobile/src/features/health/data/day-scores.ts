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

/** The day screen's four tiles, in order, each already worded: a figure, or what is missing in its own words. */
export function dayScoreRows(
  data:
    | {
        scores?: { readiness?: unknown; sleep?: unknown; activity?: unknown } | null;
        bodyMeta?: { restingHeartRate?: unknown } | null;
      }
    | null
    | undefined,
): { label: 'Readiness' | 'HR' | 'Sleep' | 'Move'; text: string; muted: boolean }[] {
  return [
    { label: 'Readiness' as const, ...dayScoreTile(data?.scores?.readiness, 'No score') },
    { label: 'HR' as const, ...dayScoreTile(data?.bodyMeta?.restingHeartRate, 'No reading') },
    { label: 'Sleep' as const, ...dayScoreTile(data?.scores?.sleep, 'No score') },
    { label: 'Move' as const, ...dayScoreTile(data?.scores?.activity, 'No score') },
  ];
}
