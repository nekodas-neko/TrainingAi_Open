// Our daytime stress series, re-based on heart rate while still (#2860 F1, step 1).
//
// Until the ring moved to Oura Cloud (17 Oct) the app built half-hour stress levels from the ring's raw
// Bluetooth frames: an estimated daytime HRV, compared with the day's median (`lib/health/daytime-stress.ts`,
// stored in `oura_daytime_stress_buckets`). No cloud source sends that, so the chart went empty. This builds
// the same shape from the two series any wearable sends: heart rate (connector guide §3a) and per-minute
// movement (`MovementIntervalSeries`). For each waking half hour, the heart rate of its still minutes is set
// against the person's own still-time normal.
//
// **Display only.** No score reads this series: Body Battery's stress drain and the resilience level keep
// reading what they read before (`still-hr-stress-no-score-2860.test.ts` pins it). Feeding a score is F1
// step 2, a separate tuning sign-off. The level is NOT on the old series' ruler (that one estimated HRV;
// this one is heart rate), so a chart never joins the two.
//
// Pure and source-agnostic: it takes readings on one clock (ms) and knows nothing of who sent them.

import { median } from '@trainingai/shared/stats'
import { MET_MINUTE_MS, stillReadings, type StillRhrInput } from './still-rhr'

/** Half-hour buckets, as the ring-era series used. */
export const STILL_HR_STRESS_BUCKET_MS = 30 * MET_MINUTE_MS

/**
 * Still readings a half hour needs before it gets a level. Three is the floor the proposal counted
 * coverage with; below it one reading would decide a bucket.
 */
export const STILL_HR_STRESS_MIN_READINGS = 3

/**
 * Beats per minute above (below) the normal that read as full stress (full calm), −1 (+1). Not fitted:
 * a display scale chosen so an ordinary still half hour sits near 0 and a clearly raised one reaches the
 * edge. Nothing is gated on it.
 */
export const STILL_HR_STRESS_FULL_SCALE_BPM = 10

/** Prior days' still resting heart rate the normal is the median of, and the fewest it needs. */
export const STILL_HR_NORMAL_WINDOW_DAYS = 14
export const STILL_HR_NORMAL_MIN_DAYS = 3

/**
 * What one reading stands for, centred on its timestamp: a reading counts only when every minute of it
 * was measured and still. Five minutes is the coarsest heart-rate series a connector sends today; a finer
 * one (a chest strap) is only held to a stricter gate by it, never a looser one.
 */
export const STILL_HR_STRESS_COVER_MS = 5 * MET_MINUTE_MS

/** The method label carried with the series, so a reader can tell the rulers apart. */
export const STILL_HR_STRESS_METHOD = 'still_hr' as const

export interface StillHrStressPoint {
  /** The bucket's midpoint (epoch ms). */
  t: number
  /** [−1, +1]; negative is stressed (heart rate above the normal), as the ring-era series. */
  level: number
  /** Still readings behind the level. */
  readings: number
}

/**
 * The person's still-time normal: the median of up to `STILL_HR_NORMAL_WINDOW_DAYS` prior days' stored
 * still resting heart rate, or null with fewer than `STILL_HR_NORMAL_MIN_DAYS`. `days` is ascending by
 * day and holds only days before the one being drawn.
 */
export function stillHrNormal(days: readonly (number | null | undefined)[]): number | null {
  const vals = days
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .slice(-STILL_HR_NORMAL_WINDOW_DAYS)
  if (vals.length < STILL_HR_NORMAL_MIN_DAYS) return null
  return median(vals)
}

/**
 * The day's half-hour stress levels from heart rate while still, ascending. A half hour with fewer than
 * `STILL_HR_STRESS_MIN_READINGS` still readings is left out (no level, never 0). Buckets start at
 * `dayStartMs`, every 30 minutes.
 */
export function stillHrStressSeries(inp: Omit<StillRhrInput, 'hrCoverMs'> & { normalBpm: number }): StillHrStressPoint[] {
  if (!Number.isFinite(inp.normalBpm) || inp.normalBpm <= 0) return []
  const still = stillReadings({ ...inp, hrCoverMs: STILL_HR_STRESS_COVER_MS })
  const byBucket = new Map<number, number[]>()
  for (const r of still) {
    const k = Math.floor((r.tsMs - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS)
    const list = byBucket.get(k)
    if (list) list.push(r.bpm)
    else byBucket.set(k, [r.bpm])
  }
  const out: StillHrStressPoint[] = []
  for (const [k, bpms] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    if (bpms.length < STILL_HR_STRESS_MIN_READINGS) continue
    const m = median(bpms)
    if (m == null) continue
    const raw = (inp.normalBpm - m) / STILL_HR_STRESS_FULL_SCALE_BPM
    out.push({
      t: inp.dayStartMs + k * STILL_HR_STRESS_BUCKET_MS + STILL_HR_STRESS_BUCKET_MS / 2,
      level: Math.round(Math.max(-1, Math.min(1, raw)) * 1000) / 1000,
      readings: bpms.length,
    })
  }
  return out
}
