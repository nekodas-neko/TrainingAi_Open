/**
 * The "+3 vs your 14-day average (71)" chip under a detail screen's score. One implementation so
 * the current app and Preview cannot print different numbers for the same day.
 *
 * `prior` is the trend values from the days before today; null days are skipped. Needs at least one.
 */
export interface ScoreAverageChip {
  avg: number
  diff: number
  days: number
  text: string
}

export function scoreAverageChip(
  today: number | null | undefined,
  prior: readonly (number | null | undefined)[],
): ScoreAverageChip | null {
  if (today == null) return null
  const values = prior.filter((v): v is number => v != null)
  if (values.length < 1) return null
  const avg = Math.round(values.reduce((s, v) => s + v, 0) / values.length)
  const diff = today - avg
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±'
  return {
    avg,
    diff,
    days: values.length,
    text: `${sign}${Math.abs(diff)} vs your ${values.length}-day average (${avg})`,
  }
}
