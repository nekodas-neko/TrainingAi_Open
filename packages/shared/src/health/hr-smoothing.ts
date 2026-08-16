// Display-only HR smoothing. Raw/archival samples are NEVER mutated (smoothing happens at
// render time only). One Formula, One Place: hr-day-chart's toBuckets, the done-screen
// recovery chart, and the live workout sparkline all import from here.

/**
 * Average points into fixed-width buckets along a numeric axis (minutes-of-day, minutes
 * from a session origin, etc.). Generalises hr-day-chart's toBuckets. `bucketSize` is in
 * the same unit as `x`. Returns bucket-start x + rounded mean bpm, sorted by x.
 */
export function bucketAverage(
  points: { x: number; bpm: number }[],
  bucketSize: number,
): { x: number; y: number }[] {
  const acc: Record<number, number[]> = {}
  for (const p of points) {
    const bucket = Math.floor(p.x / bucketSize) * bucketSize
    ;(acc[bucket] ??= []).push(p.bpm)
  }
  return Object.entries(acc)
    .map(([k, vals]) => ({ x: Number(k), y: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) }))
    .sort((a, b) => a.x - b.x)
}

// A live HR reading outside this band is a decode/motion artefact, not a heartbeat —
// dropped at ingest so it never reaches the buffer, the plotted line, or the big number.
export const HR_MIN_PLAUSIBLE = 30
export const HR_MAX_PLAUSIBLE = 220

/**
 * Should a freshly-decoded live-HR sample be accepted into the display buffer? Rejects
 * physiologically-impossible values outright, and rejects a lone spike that jumps more
 * than `maxJump` bpm away from the recent median (a genuine effort-driven rise is
 * gradual, so it stays within the gate sample-to-sample and passes; a spurious one-off
 * decode does not). `recent` is the tail of already-accepted values.
 */
export function isPlausibleHrSample(bpm: number, recent: number[], maxJump = 30): boolean {
  if (!Number.isFinite(bpm) || bpm < HR_MIN_PLAUSIBLE || bpm > HR_MAX_PLAUSIBLE) return false
  if (recent.length < 3) return true
  return Math.abs(bpm - median(recent.slice(-5))) <= maxJump
}

/** Median of a numeric array (0 for empty). */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Rolling median over a small centred window — robust to single-beat outliers (a spurious
 * near-live decode doesn't move the line, unlike a mean). For the live sparkline's plain
 * bpm buffer, where there's no timestamp axis to bucket on.
 */
export function rollingMedian(values: number[], window = 5): number[] {
  if (values.length === 0) return values
  const half = Math.floor(window / 2)
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1))
      .slice().sort((a, b) => a - b)
    return slice[Math.floor(slice.length / 2)]
  })
}
