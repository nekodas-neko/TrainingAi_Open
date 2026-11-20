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
import { MET_ACTIVE_THRESHOLD } from './daily-medians'
import { MET_MINUTE_MS, stillReadings, type StillRhrInput } from './still-rhr'

/** Half-hour buckets, as the ring-era series used. */
export const STILL_HR_STRESS_BUCKET_MS = 30 * MET_MINUTE_MS

/**
 * Still readings a half hour needs before it gets a level. Three is the floor the proposal counted
 * coverage with; below it one reading would decide a bucket.
 *
 * Counted in distinct MINUTES that hold a still reading, not in raw readings: `getHrForWindow` merges
 * every source, so a chest strap at one reading a second would otherwise meet the floor in three seconds
 * and outvote the ring's reading every five minutes sixty to one. Each minute stands as one value (its
 * own median) before the half hour's median is taken.
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

/**
 * How long after a recorded workout or logged activity still readings stay out (#3938 item 3). Sitting
 * down after a session leaves the heart rate raised for a while with no movement to gate it, which would
 * read as full stress. Fifteen minutes covers the steep part of heart-rate recovery; nothing is gated on
 * it beyond what the chart draws.
 */
export const STILL_HR_STRESS_AFTER_EXERCISE_MS = 15 * MET_MINUTE_MS

/** The method label carried with the series, so a reader can tell the rulers apart. */
export const STILL_HR_STRESS_METHOD = 'still_hr' as const

export interface StillHrStressPoint {
  /** The bucket's midpoint (epoch ms). */
  t: number
  /** [−1, +1]; negative is stressed (heart rate above the normal), as the ring-era series. */
  level: number
  /** Distinct minutes holding a still reading behind the level. */
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

export interface StillHrStressInput extends Omit<StillRhrInput, 'hrCoverMs'> {
  normalBpm: number
  /**
   * The app's own recorded workouts and logged activities. Each is left out, plus
   * `STILL_HR_STRESS_AFTER_EXERCISE_MS` after it, and counts as movement for `moving`.
   */
  exerciseWindows?: readonly { startMs: number; endMs: number }[]
  /** A half hour is drawn only once it has ended by this instant, so today never shows a part one. */
  nowMs?: number
}

export interface StillHrStressDay {
  points: StillHrStressPoint[]
  /** Half hours left without a level because the person was moving, merged into spans, ascending. */
  moving: { startMs: number; endMs: number }[]
}

/**
 * The day's half-hour stress levels from heart rate while still, ascending. A half hour with fewer than
 * `STILL_HR_STRESS_MIN_READINGS` minutes holding a still reading is left out (no level, never 0). Buckets
 * start at `dayStartMs`, every 30 minutes.
 */
export function stillHrStressSeries(inp: StillHrStressInput): StillHrStressPoint[] {
  return stillHrStressDay(inp).points
}

/** `stillHrStressSeries`, with the half hours movement left out, for the chart's strip (#3939). */
export function stillHrStressDay(inp: StillHrStressInput): StillHrStressDay {
  if (!Number.isFinite(inp.normalBpm) || inp.normalBpm <= 0) return { points: [], moving: [] }
  const exercise = inp.exerciseWindows ?? []
  const drawnUntil = Math.min(inp.dayEndMs, inp.nowMs ?? inp.dayEndMs)
  const bucketEnded = (k: number) => inp.dayStartMs + (k + 1) * STILL_HR_STRESS_BUCKET_MS <= drawnUntil

  const active = inp.met
    .filter(m => Number.isFinite(m.value) && m.value > MET_ACTIVE_THRESHOLD && m.tsMs >= inp.dayStartMs && m.tsMs < inp.dayEndMs)
    .map(m => m.tsMs)
    .sort((a, b) => a - b)
  // #3938 item 1. A night with no sleep record passes the still gate, and its sleeping heart rate reads
  // as full calm. Before the day's first movement and after its last, a still reading further below the
  // normal than the full scale is taken as sleep and left out. A reading near the normal (an awake
  // morning coffee, an evening on the sofa) stays, which a blanket cut at the first movement would hide.
  const firstActive = active[0] ?? Number.POSITIVE_INFINITY
  const lastActiveEnd = active.length ? active[active.length - 1] + MET_MINUTE_MS : Number.NEGATIVE_INFINITY
  const sleepFloor = inp.normalBpm - STILL_HR_STRESS_FULL_SCALE_BPM

  const still = stillReadings({
    ...inp,
    sleepWindows: [
      ...inp.sleepWindows,
      ...exercise.map(w => ({ startMs: w.startMs, endMs: w.endMs + STILL_HR_STRESS_AFTER_EXERCISE_MS })),
    ],
    hrCoverMs: STILL_HR_STRESS_COVER_MS,
  }).filter(r => !(r.bpm < sleepFloor && (r.tsMs < firstActive || r.tsMs >= lastActiveEnd)))

  // bucket → minute → that minute's readings, so a dense source counts once per minute.
  const byBucket = new Map<number, Map<number, number[]>>()
  for (const r of still) {
    const k = Math.floor((r.tsMs - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS)
    const minute = Math.floor(r.tsMs / MET_MINUTE_MS)
    let minutes = byBucket.get(k)
    if (!minutes) byBucket.set(k, (minutes = new Map()))
    const list = minutes.get(minute)
    if (list) list.push(r.bpm)
    else minutes.set(minute, [r.bpm])
  }
  const points: StillHrStressPoint[] = []
  for (const [k, minutes] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    if (!bucketEnded(k)) continue
    if (minutes.size < STILL_HR_STRESS_MIN_READINGS) continue
    const bpms = [...minutes.values()].map(v => median(v)).filter((v): v is number => v != null)
    const m = median(bpms)
    if (m == null) continue
    const raw = (inp.normalBpm - m) / STILL_HR_STRESS_FULL_SCALE_BPM
    points.push({
      t: inp.dayStartMs + k * STILL_HR_STRESS_BUCKET_MS + STILL_HR_STRESS_BUCKET_MS / 2,
      level: Math.round(Math.max(-1, Math.min(1, raw)) * 1000) / 1000,
      readings: minutes.size,
    })
  }

  // Half hours with no level that held an active minute or a recorded workout or activity.
  const drawn = new Set(points.map(p => Math.floor((p.t - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS)))
  const movingBuckets = new Set<number>()
  for (const ts of active) movingBuckets.add(Math.floor((ts - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS))
  for (const w of exercise) {
    const from = Math.max(inp.dayStartMs, w.startMs)
    const to = Math.min(inp.dayEndMs, w.endMs)
    if (to <= from) continue
    const last = Math.ceil((to - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS) - 1
    for (let k = Math.floor((from - inp.dayStartMs) / STILL_HR_STRESS_BUCKET_MS); k <= last; k++) movingBuckets.add(k)
  }
  const moving: { startMs: number; endMs: number }[] = []
  for (const k of [...movingBuckets].sort((a, b) => a - b)) {
    if (drawn.has(k) || !bucketEnded(k)) continue
    const startMs = inp.dayStartMs + k * STILL_HR_STRESS_BUCKET_MS
    const endMs = startMs + STILL_HR_STRESS_BUCKET_MS
    const prev = moving[moving.length - 1]
    if (prev && prev.endMs === startMs) prev.endMs = endMs
    else moving.push({ startMs, endMs })
  }
  return { points, moving }
}
