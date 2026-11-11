import type { ExerciseHrTrend } from './models';

/**
 * What the Heart & Recovery card draws from an exercise's heart-rate trend, or null when no set of
 * it has trustworthy heart-rate cover yet (the current app's card draws nothing then).
 *
 * `latest` is the newest session with a peak or a 60-second drop; the series are oldest first and
 * leave out sessions with no reading, so a gap is not plotted as a zero.
 */
export function exerciseHrView(trend: ExerciseHrTrend | null) {
  if (!trend || trend.coveredSets === 0) return null;
  const latest =
    [...trend.sessions]
      .reverse()
      .find((session) => session.avgPeakBpm != null || session.avgDrop60 != null) ?? null;
  const series = (key: 'avgPeakBpm' | 'avgDrop60') =>
    trend.sessions.flatMap((session) => (session[key] == null ? [] : [session[key]]));
  const curve =
    latest && (latest.avgDrop30 != null || latest.avgDrop90 != null || latest.avgDrop120 != null)
      ? ([
          ['30s', latest.avgDrop30],
          ['1m', latest.avgDrop60],
          ['90s', latest.avgDrop90],
          ['2m', latest.avgDrop120],
        ] as const)
      : null;
  const peaks = series('avgPeakBpm');
  const drops = series('avgDrop60');
  return {
    latest,
    curve,
    // One reading is a dot, not a trend.
    peakSeries: peaks.length >= 2 ? peaks : null,
    dropSeries: drops.length >= 2 ? drops : null,
    byIntensity: trend.byIntensity,
  };
}
