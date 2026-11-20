// How the "When the day ran stressed" chart draws a day of half-hour stress levels (#3939), shared by
// the current app (`components/body-battery/stress-day-chart.tsx`) and Preview (`StressDayCard.tsx`).
//
// The owner, 20 Nov: "I'd rather a consistent line that shows areas of elevated stress rather than
// gaps." So the measured runs are joined by a bridge from the last reading of one run to the first of
// the next, which each app draws dotted and fainter. **A bridge is never a reading**: it carries no
// level anywhere (tooltips, the event list), which is why it is returned apart from the runs rather
// than as interpolated points. The elevated fill is computed from the runs only, never a bridge.
//
// Pure and axis-agnostic: points carry whatever x the caller plots on (minutes into the day, epoch ms).

import { STRESS_HIGH_LEVEL } from './daytime-stress-thresholds'

/**
 * Buckets are nominally 30 minutes apart, so anything past this is a real hole rather than jitter.
 * Two and a half buckets: it tolerates one dropped reading without tolerating an hour and a half of
 * silence.
 */
export const STRESS_RUN_GAP_MS = 75 * 60_000

/** Where "Elevated" starts: the same −0.5 the Home strip calls "High". Negative is stressed. */
export const STRESS_ELEVATED_LEVEL = STRESS_HIGH_LEVEL

export interface StressLinePoint {
  x: number
  /** [−1, +1]; negative is stressed. */
  level: number
}

/**
 * Consecutive buckets split into runs at every gap longer than `STRESS_RUN_GAP_MS`, sorted by instant
 * first: a back-filled day has no ordering guarantee, and an out-of-order point would double back.
 */
export function stressRuns<T extends { t: number }>(buckets: readonly T[]): T[][] {
  const sorted = [...buckets].sort((a, b) => a.t - b.t)
  const runs: T[][] = []
  for (const b of sorted) {
    const run = runs[runs.length - 1]
    if (run && b.t - run[run.length - 1].t <= STRESS_RUN_GAP_MS) run.push(b)
    else runs.push([b])
  }
  return runs
}

/**
 * The straight joins between runs: the last reading of each run to the first of the next. Nothing
 * before the first run or after the last, so the line never reaches past what was measured.
 */
export function stressBridges<P>(runs: readonly (readonly P[])[]): [P, P][] {
  const out: [P, P][] = []
  for (let i = 1; i < runs.length; i++) {
    const prev = runs[i - 1]
    const next = runs[i]
    if (prev.length && next.length) out.push([prev[prev.length - 1], next[0]])
  }
  return out
}

/**
 * The areas between a measured run and the Elevated threshold where the run is past it, as closed
 * polygons in the run's own (x, level) space: each starts and ends on the threshold, at the run's end
 * points or where a segment crosses it. A lone reading past the threshold has no width and no area.
 */
export function elevatedAreas(run: readonly StressLinePoint[], threshold = STRESS_ELEVATED_LEVEL): StressLinePoint[][] {
  const out: StressLinePoint[][] = []
  let cur: StressLinePoint[] | null = null
  for (let i = 0; i < run.length; i++) {
    const p = run[i]
    const inside = p.level < threshold
    if (i > 0) {
      const q = run[i - 1]
      if ((q.level < threshold) !== inside) {
        const f = (threshold - q.level) / (p.level - q.level)
        const cross = { x: q.x + f * (p.x - q.x), level: threshold }
        if (cur) {
          cur.push(cross)
          out.push(cur)
          cur = null
        } else {
          cur = [cross]
        }
      }
    }
    if (inside) {
      if (!cur) cur = [{ x: p.x, level: threshold }]
      cur.push({ x: p.x, level: p.level })
    }
  }
  if (cur) {
    cur.push({ x: cur[cur.length - 1].x, level: threshold })
    out.push(cur)
  }
  return out.filter(poly => Math.max(...poly.map(v => v.x)) > Math.min(...poly.map(v => v.x)))
}
