import { formatHrChange } from '@trainingai/shared/health/hr-change-display';

// Labels the current app's HR Recovery Profile card puts on a band's mix of episode sources.
const SOURCE_LABEL: Record<string, string> = {
  set_rest: 'lifting',
  run_cooldown: 'workout',
  interval: 'interval',
  ambient: 'ambient',
};

/** "12 lifting, 3 workout" for a band that mixes sources, null for a single-source band. */
export function sourceMixLabel(bySource: Record<string, number | undefined>): string | null {
  const entries = Object.entries(bySource).filter(([, count]) => (count ?? 0) > 0);
  if (entries.length < 2) {
    return null;
  }
  return entries.map(([source, count]) => `${count} ${SOURCE_LABEL[source] ?? source}`).join(', ');
}

/** The rate text with its direction arrow; `direction` picks the cyan (recovering) or amber colour. */
export function rateDisplay(rate: number | null): { text: string; direction: 'down' | 'up' | null } {
  const { text } = formatHrChange(rate);
  return { text, direction: rate == null || rate === 0 ? null : rate > 0 ? 'down' : 'up' };
}

/** Bands with at least two months of data get a line; the rest would be a dot. */
export function trendSeries(
  trend: readonly { label: string; points: readonly { medianRateBpmMin: number | null }[] }[],
) {
  return trend.flatMap((band) => {
    const values = band.points
      .map((point) => point.medianRateBpmMin)
      .filter((value): value is number => value != null);
    return band.points.length >= 2 && values.length >= 2 ? [{ label: band.label, values }] : [];
  });
}
