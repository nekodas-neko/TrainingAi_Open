import type { IntervalPlan, SegmentKind } from './interval-plan'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { computeTotalDistanceKm, computeAvgPaceSecPerKm } from '@/lib/activity/activity-metrics'
import { samplesInWindow } from './segment-window'
import { formatPace } from '@trainingai/shared/health/vdot'

export interface WalkSegmentStat {
  index: number
  setNumber: number
  kind: SegmentKind
  startSec: number
  endSec: number
  avgHr: number | null
  maxHr: number | null
  /** The first HR reading in the segment's window — a starting-point reference distinct
   *  from the average, since HR climbs through a segment (cardiac drift). */
  hrAtStart: number | null
  avgPaceSecPerKm: number | null
  distanceKm: number | null
  avgCadenceSpm: number | null
}

function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
}

// Heart rate is whole beats — a 1dp mean is noise here, and it is what made these payloads
// fail the wire schema before it was relaxed (2026-08-02). Cadence keeps `avg`'s 1dp.
function avgWhole(nums: number[]): number | null {
  const mean = avg(nums)
  return mean == null ? null : Math.round(mean)
}

/**
 * Per-segment stats (HR, pace, distance, cadence) for every segment in a guided walk's plan —
 * the same granularity a workout's set_logs get per set, so a walk's fast/slow blocks have real
 * numbers to compare and average across walks later, not just an ephemeral live display.
 */
export function computeWalkSegmentStats({
  plan,
  startedAtMs,
  hrSamples,
  rawPoints,
  cadenceSeries,
}: {
  plan: IntervalPlan
  startedAtMs: number
  hrSamples: { at: number; bpm: number }[]
  rawPoints: RoutePoint[]
  cadenceSeries: { tSec: number; spm: number }[] | null
}): WalkSegmentStat[] {
  return plan.segments.map(seg => {
    const fromMs = startedAtMs + seg.startSec * 1000
    const toMs = startedAtMs + seg.endSec * 1000

    const hrInWindow = samplesInWindow(hrSamples, s => s.at, fromMs, toMs)
    const bpms = hrInWindow.map(s => s.bpm)

    const pointsInWindow = samplesInWindow(rawPoints, p => p.t, fromMs, toMs)
    const distanceKm = pointsInWindow.length >= 2 ? computeTotalDistanceKm(pointsInWindow) : null
    const avgPaceSecPerKm = distanceKm != null
      ? computeAvgPaceSecPerKm(distanceKm, seg.endSec - seg.startSec)
      : null

    const cadenceInWindow = cadenceSeries
      ? samplesInWindow(cadenceSeries, c => startedAtMs + c.tSec * 1000, fromMs, toMs)
      : []

    return {
      index: seg.index,
      setNumber: seg.setNumber,
      kind: seg.kind,
      startSec: seg.startSec,
      endSec: seg.endSec,
      avgHr: avgWhole(bpms),
      maxHr: bpms.length ? Math.max(...bpms) : null,
      hrAtStart: hrInWindow.length ? hrInWindow[0].bpm : null,
      avgPaceSecPerKm,
      distanceKm,
      avgCadenceSpm: avg(cadenceInWindow.map(c => c.spm)),
    }
  })
}

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
      avgHr: avg(hrs),
      avgPaceSecPerKm: avg(paces),
      avgCadenceSpm: avg(cadences),
      totalDistanceKm: distances.length ? Math.round(distances.reduce((a, b) => a + b, 0) * 100) / 100 : null,
      avgDistanceKm: distances.length ? Math.round(avg(distances)! * 100) / 100 : null,
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
