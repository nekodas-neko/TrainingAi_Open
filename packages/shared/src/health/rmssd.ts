// lib/health/rmssd.ts
// rMSSD from raw RR intervals (ms). The ONLY RR→rMSSD implementation in the app
// (the ring's 0x5d events carry ring-precomputed rMSSD — different provenance).
// Artifact gate: successive pairs differing >20% are ectopic/dropped-beat noise
// and are excluded pairwise (standard Kubios-style threshold filter).
const MIN_BEATS = 30
const ARTIFACT_RATIO = 0.2
/** How far a pair's timestamp gap may stray from the later beat's own interval and still count as
 *  two consecutive beats. Reconstructed beat times (`hr-ingest` walks them backwards from the
 *  packet's receive time) can be off by tens of ms at a packet boundary, while a gap with a beat
 *  missing is about twice the interval, so half an interval separates the two cleanly. */
const ADJACENT_TOLERANCE_RATIO = 0.5

/** One beat: `atMs` is when it ENDED, `rrMs` the interval it closed. So the previous beat ended
 *  about `rrMs` earlier, if there was no beat between. */
export interface RrBeat { atMs: number; rrMs: number }

/**
 * #2488. rMSSD is the root mean square of SUCCESSIVE differences, which means beats that follow
 * each other. This used to difference every neighbour in the array, and in the strap's sparse mode
 * (about 60% of half-hours) the array holds short runs of beats with gaps between them, so it
 * differenced across the gaps: the drift of the heart rate between runs, counted as variability.
 * Daytime rMSSD read 76–93 ms where counting only truly adjacent pairs gives 25–32 ms. A pair now
 * counts only when the time between the two beats matches the later beat's interval.
 *
 * It takes beats with their times, not bare intervals, because adjacency cannot be told from the
 * intervals alone. Order does not matter; it sorts a copy.
 */
export function rmssdFromRr(beats: readonly RrBeat[]): number | null {
  if (beats.length < MIN_BEATS) return null
  const sorted = [...beats].sort((x, y) => x.atMs - y.atMs)
  const sqDiffs: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].rrMs
    const b = sorted[i].rrMs
    // Not consecutive beats: a gap, or a beat lost between them.
    if (Math.abs((sorted[i].atMs - sorted[i - 1].atMs) - b) > ADJACENT_TOLERANCE_RATIO * b) continue
    if (Math.abs(b - a) > ARTIFACT_RATIO * a) continue
    sqDiffs.push((b - a) ** 2)
  }
  if (sqDiffs.length < MIN_BEATS / 2) return null
  const mean = sqDiffs.reduce((s, v) => s + v, 0) / sqDiffs.length
  return Math.sqrt(mean)
}
