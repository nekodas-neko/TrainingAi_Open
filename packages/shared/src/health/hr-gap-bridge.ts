import { closeClockSkip, type ClockSkip } from '../date-utils'

/**
 * The day's heart-rate "Estimated" line: a separate series of straight bridges across the coverage
 * gaps in the 10-minute buckets, never merged into the real trace, which keeps its honest break.
 * A gap is more than `gapMin` wall-clock minutes (the hour a spring-forward day skips is closed
 * first) and at most `maxGapMin`; a longer one stays a break, since a straight line across hours of
 * nothing reads as more certain than the data is. Each bridge is isolated by a trailing `y: NaN`.
 *
 * The same rule as `interpolateGaps` in the current app's `components/health/hr-day-chart-gaps.ts`
 * (Home's chart passes `showBackfill`). Preview's Home card draws it from here.
 */
export function bridgeHrGaps(
  points: readonly { x: number; y: number }[],
  gapMin = 20,
  maxGapMin = 120,
  skip?: ClockSkip | null,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  points.forEach((p, i) => {
    if (i === 0) return
    const prev = points[i - 1]
    const gap = closeClockSkip(p.x, skip) - closeClockSkip(prev.x, skip)
    if (gap > gapMin && gap <= maxGapMin) {
      out.push({ x: prev.x, y: prev.y })
      out.push({ x: p.x, y: p.y })
      out.push({ x: p.x, y: NaN })
    }
  })
  return out
}
