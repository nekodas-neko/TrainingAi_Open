import { formatPace } from '@trainingai/shared/health/vdot'
import { avgOneDecimal, type WalkSegmentStat } from '@trainingai/shared/walking/segment-stats'

// The per-segment computation lives in packages/shared, so Preview's walk saves the same blocks (#3641).
export { computeWalkSegmentStats, type WalkSegmentStat } from '@trainingai/shared/walking/segment-stats'

export interface KindAggregate {
  avgHr: number | null
  avgPaceSecPerKm: number | null
  /** Steps per minute across this kind's segments. Null on any walk with no cadence source —
   *  a Polar H10 is the only validated one today, so a GPS-only walk has none. */
  avgCadenceSpm: number | null
  /** Sum of distance across every segment of this kind — "how far you covered", for a
   *  single walk's summary card. */
  totalDistanceKm: number | null
  /** Mean distance per segment of this kind — "how far a typical block goes", for
   *  comparing across many walks where segment counts differ. */
  avgDistanceKm: number | null
  count: number
}

/**
 * Rolls fast/slow segments up into one "your average slow walk" style stat each — averaging
 * per-segment stats (not re-deriving from raw samples), so a segment with no HR/GPS data simply
 * doesn't contribute rather than skewing the roll-up with a false zero. Works equally over one
 * walk's segments or a flattened list from many walks — the aggregation has no notion of which
 * walk a segment came from, so historical cross-walk stats reuse this directly.
 */
export function aggregateSegmentsByKind(segments: WalkSegmentStat[]): Record<'fast' | 'slow', KindAggregate> {
  const byKind = (kind: 'fast' | 'slow'): KindAggregate => {
    const inKind = segments.filter(s => s.kind === kind)
    const hrs = inKind.map(s => s.avgHr).filter((v): v is number => v != null)
    const paces = inKind.map(s => s.avgPaceSecPerKm).filter((v): v is number => v != null)
    const distances = inKind.map(s => s.distanceKm).filter((v): v is number => v != null)
    const cadences = inKind.map(s => s.avgCadenceSpm).filter((v): v is number => v != null)
    return {
      avgHr: avgOneDecimal(hrs),
      avgPaceSecPerKm: avgOneDecimal(paces),
      avgCadenceSpm: avgOneDecimal(cadences),
      totalDistanceKm: distances.length ? Math.round(distances.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      avgDistanceKm: distances.length ? Math.round(avgOneDecimal(distances)! * 100) / 100 : null,
      count: inKind.length,
    }
  }
  return { fast: byKind('fast'), slow: byKind('slow') }
}

/**
 * Which number headlines a fast/slow readout (Q-84).
 *
 * **Cadence when there is one, pace otherwise.** On an interval walk, step rate is the direct read
 * on effort, while pace over a single 1–3 minute block is a small and error-prone GPS sample — the
 * owner's report was that pace alone is the less useful of the two. It falls back to pace rather
 * than to a dash, so a walk with no cadence source reads exactly as it did before.
 *
 * One function because three surfaces render this pair — the summary's fast/slow cards, its
 * per-interval rows, and the walk-config history card. A per-site copy of "which one leads" is how
 * two of them end up disagreeing.
 */
export function walkEffortDisplay(
  v: { avgCadenceSpm: number | null; avgPaceSecPerKm: number | null },
): { lead: string; /** The one that did not lead. Null when pace itself is leading. */ secondary: string | null } {
  const pace = v.avgPaceSecPerKm != null ? formatPace(v.avgPaceSecPerKm) : null
  if (v.avgCadenceSpm == null) return { lead: pace ?? '—', secondary: null }
  return { lead: `${Math.round(v.avgCadenceSpm)} spm`, secondary: pace ?? '—/km' }
}
