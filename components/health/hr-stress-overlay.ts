import { toSegments, type StressBucket } from '@/components/body-battery/stress-day'

/**
 * Placing the day's stress series onto the HR chart's axis (TN-3b).
 *
 * The owner asked for stress *on the heart-rate charts* — *"I will be able to match it up based on
 * time to what I was doing around then."* The standalone strip answers "when did stress happen";
 * this answers "what was my heart doing while it did", which needs the two on one time axis.
 *
 * **Drawn as the measured series, not as "stressed" bands.** Thresholding the level into shaded
 * windows would read better, and it would mean inventing the number that decides what counts as
 * stressed. That is a calibration, calibration belongs to Tuning and the owner, and a display
 * threshold is still a claim about the user's day. The line states the measurement and nothing
 * more.
 *
 * **Gap handling is `toSegments`', not a second copy.** Coverage averages 13.3 of 24 hours and one
 * measured day jumps 06:45 → 13:15; a line joined across that hole would draw a stress level for
 * six hours nobody recorded. Chart.js breaks a line on a `null` y, so the runs are re-joined here
 * with a null between them — one dataset, gaps intact.
 */

/** A point on the HR chart's x axis (minutes since local midnight); `y: null` breaks the line. */
export interface StressPoint {
  x: number
  y: number | null
}

export interface StressOverlay {
  points: StressPoint[]
  /** Measured buckets placed, ignoring the nulls that separate the runs. */
  measured: number
}

export function stressOverlay(buckets: StressBucket[], tz: string): StressOverlay {
  const segments = toSegments(buckets, tz)
  const points: StressPoint[] = []
  for (const seg of segments) {
    // The break belongs between runs, never before the first or after the last — a leading null
    // would give Chart.js a point at x undefined and shift the whole series.
    if (points.length) points.push({ x: seg[0].x, y: null })
    for (const p of seg) points.push({ x: p.x, y: p.level })
  }
  return { points, measured: segments.reduce((n, s) => n + s.length, 0) }
}
