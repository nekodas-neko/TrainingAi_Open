// Moved from lib/walk/segment-stats.ts so TrainingAi Preview's guided walk saves the same
// per-block numbers as the current app's (#3641). The current app's lib file re-exports these.
import type { RoutePoint } from '@trainingai/shared/activity/route-encoding'
import { computeTotalDistanceKm } from '@trainingai/shared/activity/route-metrics'
import { averagePaceSecPerKm } from '@trainingai/shared/activity/route-summary'
import { stepsFromCadenceSeries } from '@trainingai/shared/health/cadence'
import { summarisePacerTally, type PacerBandCounts, type PacerSegmentTally, type PacerSignal } from '@trainingai/shared/health/pacer-adherence'

export type WalkSegmentKind = 'warmup' | 'fast' | 'slow' | 'cooldown'

/**
 * Filters an array of timestamped items to a `[fromMs, toMs)` window — shared by both the
 * per-segment HR filter and the per-segment GPS-point filter in the guided-walk summary
 * (same windowing logic, two different sample shapes).
 */
export function samplesInWindow<T>(
  samples: T[],
  getTimeMs: (item: T) => number,
  fromMs: number,
  toMs: number,
): T[] {
  return samples.filter(s => {
    const t = getTimeMs(s)
    return t >= fromMs && t < toMs
  })
}

export interface WalkSegmentStat {
  index: number
  setNumber: number
  kind: WalkSegmentKind
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
  /**
   * Steps taken during this segment, integrated from the cadence series rather than multiplied
   * out of `avgCadenceSpm` (LA-48).
   *
   * The obvious derivation — mean spm × duration — counts a pause at the moving average, because
   * `avgCadenceSpm` is cadence *while moving* by construction: a stop contributes no readings and
   * so cannot pull it down. It is also a second answer to a question the app already answers, and
   * `stepsFromCadenceSeries` is the one place that answers it — the same arithmetic behind the
   * walk's own saved `steps`, so the segments and the total cannot drift apart.
   *
   * Stored rather than derived at read time for the same reason: every consumer re-deriving it is
   * every consumer rounding it differently.
   */
  steps: number | null
  /**
   * Issue 2242 (LA-48): which signal paced this segment, how often the walker was shown the in-band
   * reading, and the band counts behind it. Counted LIVE from what the pacer displayed, never
   * reconstructed from the binned cadence series. Absent, not 0, on a segment the pacer never judged
   * and on every walk saved before this existed.
   */
  pacerSignal?: PacerSignal | null
  pacerAdherence?: number | null
  pacerTicks?: PacerBandCounts | null
}

/** A mean to one decimal, null for no values: the rounding every walk average uses. */
export function avgOneDecimal(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
}

// Heart rate is whole beats — a 1dp mean is noise here, and it is what made these payloads
// fail the wire schema before it was relaxed (2026-08-02). Cadence keeps `avg`'s 1dp.
function avgWhole(nums: number[]): number | null {
  const mean = avgOneDecimal(nums)
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
  pacerTallies,
}: {
  plan: { segments: { kind: WalkSegmentKind; index: number; setNumber: number; startSec: number; endSec: number }[] }
  startedAtMs: number
  hrSamples: { at: number; bpm: number }[]
  rawPoints: RoutePoint[]
  cadenceSeries: { tSec: number; spm: number }[] | null
  /** The live pacer's per-segment tally, keyed by segment index (issue 2242). Omitted on a walk with none. */
  pacerTallies?: Record<number, PacerSegmentTally> | null
}): WalkSegmentStat[] {
  return plan.segments.map(seg => {
    const fromMs = startedAtMs + seg.startSec * 1000
    const toMs = startedAtMs + seg.endSec * 1000

    const hrInWindow = samplesInWindow(hrSamples, s => s.at, fromMs, toMs)
    const bpms = hrInWindow.map(s => s.bpm)

    const pointsInWindow = samplesInWindow(rawPoints, p => p.t, fromMs, toMs)
    const distanceKm = pointsInWindow.length >= 2 ? computeTotalDistanceKm(pointsInWindow) : null
    // Through the one capped rule (#3128): a segment where the walker barely moved, a 2-minute
    // warm-up over 20 m, is 6,000 s/km, which the save schema rejects, and with it the whole walk.
    const avgPaceSecPerKm = distanceKm != null
      ? averagePaceSecPerKm(distanceKm, seg.endSec - seg.startSec) ?? null
      : null

    const cadenceInWindow = cadenceSeries
      ? samplesInWindow(cadenceSeries, c => startedAtMs + c.tSec * 1000, fromMs, toMs)
      : []

    const pacer = summarisePacerTally(pacerTallies?.[seg.index])

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
      avgCadenceSpm: avgOneDecimal(cadenceInWindow.map(c => c.spm)),
      steps: stepsFromCadenceSeries(cadenceInWindow),
      // Spread, so a segment with no pacer reading has no key at all rather than three nulls.
      ...(pacer ?? {}),
    }
  })
}
