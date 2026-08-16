import type { RunType } from './types'

export const RUN_TYPES_FOR_STATS: RunType[] = ['recovery', 'easy', 'long', 'tempo', 'interval']

export interface RunTypeAggregate {
  avgPaceSecPerKm: number | null
  avgDistanceKm: number | null
  avgHr: number | null
  count: number
}

export interface CompletedRunForStats {
  runType: string
  distanceKm: number | null
  avgPaceSecPerKm: number | null
  avgHr: number | null
}

function avg(nums: number[]): number | null {
  return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
}

/**
 * Rolls completed runs up into one "your average tempo run" style stat per run type —
 * averaging per-run values (not re-deriving from raw samples), so a run missing a stat
 * simply doesn't contribute rather than skewing the average with a false zero. Only the
 * five known RunTypes are aggregated; any other/legacy runType string is dropped.
 */
export function computeRunTypeStats(runs: CompletedRunForStats[]): Record<RunType, RunTypeAggregate> {
  const byType = (type: RunType): RunTypeAggregate => {
    const inType = runs.filter((r) => r.runType === type)
    const paces = inType.map((r) => r.avgPaceSecPerKm).filter((v): v is number => v != null)
    const distances = inType.map((r) => r.distanceKm).filter((v): v is number => v != null)
    const hrs = inType.map((r) => r.avgHr).filter((v): v is number => v != null)
    return {
      avgPaceSecPerKm: avg(paces),
      avgDistanceKm: distances.length ? Math.round(avg(distances)! * 100) / 100 : null,
      avgHr: avg(hrs),
      count: inType.length,
    }
  }
  return Object.fromEntries(RUN_TYPES_FOR_STATS.map((t) => [t, byType(t)])) as Record<RunType, RunTypeAggregate>
}
