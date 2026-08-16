import type { HrReading, SetHrStats } from './hr-analysis'

// Per-workout HR summary snapshot (review H-3 / Design-notes Lever W). These scalars are recomputed
// live from oura_heartrate / rr_intervals on every recap view today; the 180-day HR prune therefore
// silently erases them for any workout older than 180d (strap rows are not re-derivable from
// anything). This is the durable Tier-2 record — computed on first ready view and persisted, so old
// recaps keep their numbers after the raw series thins.
export interface WorkoutHrSummary {
  avgBpm: number | null
  peakBpm: number | null
  hrr1Best: number | null       // best (largest) 1-min HR recovery across all sets
  workoutHrvMs: number | null   // rest-window rMSSD (passed in — derived from rr_intervals upstream)
  readingsCount: number
  source: string | null         // 'chest_strap' | 'ble' | 'mixed' | null
}

/** Reduce a workout's live HR readings + per-set recovery stats to the durable summary snapshot.
 *  Pure: same inputs → same output, so the done-screen route and the admin backfill share it. */
export function summariseWorkoutHr(
  readings: (HrReading & { source?: string | null })[],
  setStats: Pick<SetHrStats, 'hrr1'>[],
  workoutHrvMs: number | null,
): WorkoutHrSummary {
  const bpms = readings.map(r => r.bpm)
  const avgBpm = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : null
  const peakBpm = bpms.length ? Math.max(...bpms) : null

  const hrr1s = setStats.map(s => s.hrr1).filter((h): h is number => h != null)
  const hrr1Best = hrr1s.length ? Math.max(...hrr1s) : null

  const sources = new Set(readings.map(r => r.source).filter((x): x is string => x != null))
  const source = sources.size === 0 ? null : sources.size > 1 ? 'mixed' : [...sources][0]

  return { avgBpm, peakBpm, hrr1Best, workoutHrvMs, readingsCount: readings.length, source }
}
