/**
 * Laying out a day of stress buckets against a clock (TN-3b).
 *
 * The owner: *"Can we have this displayed on a widget or chart so we can see when the stress occurs.
 * I will be able to match it up based on time to what I was doing around then."* That is a request
 * for a **time axis**, which is exactly what `stress-strip.tsx`'s sparkline cannot give — it shows
 * the shape and cannot answer "when".
 *
 * Split from the component because both vitest projects run in `node`, where there is no DOM: the
 * bucketing, the gap detection and the night band are the parts with judgement in them, and they are
 * the parts worth pinning.
 */

/** A measured bucket: midpoint in epoch ms, level ∈ [−1,+1] with negative meaning stressed. */
export interface StressBucket {
  t: number
  level: number
}

/** One point placed on the axis. `x` is minutes since local midnight, 0–1440. */
export interface PlacedPoint {
  x: number
  level: number
}

/**
 * A run of consecutive buckets with no gap in it. Drawn as one path.
 *
 * **Segments exist so gaps stay gaps.** Coverage averages 26.6 buckets a day — 13.3 of 24 hours —
 * and 2026-09-08 jumps 06:45 → 13:15, a 6.5-hour hole. One joined path across that would draw a
 * stress level for six hours nobody measured, which is the single way this chart could lie.
 */
export type StressSegment = PlacedPoint[]

/**
 * Buckets are nominally 30 minutes apart, so anything past this is a real hole rather than jitter.
 *
 * Two and a half buckets: it tolerates one dropped reading (the ring stops sampling when you are
 * still) without tolerating an hour and a half of silence.
 */
const GAP_MINUTES = 75

/**
 * The clock formatter, built per CALL and never at module scope (LA-124, the same shape as RV-80).
 *
 * Constructing one is the expensive part — `toSegments` did it once per bucket, 3.19 ms against
 * 0.16 ms on a full day's 48 buckets. Lifting it one level further, to a module constant, would
 * bind the first caller's zone for the lifetime of the process; `minutesIntoDay`'s `Etc/GMT+5` case
 * is what fails if anyone does, and `toSegments` has its own control for the same mutation.
 */
function clockFormat(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function minutesFrom(fmt: Intl.DateTimeFormat, t: number): number {
  const parts = fmt.formatToParts(new Date(t))
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  // 24:00 is a legal `en-GB` rendering of midnight and would place a point past the axis.
  return (hour % 24) * 60 + minute
}

/** Local minutes-since-midnight for an instant, in the user's zone rather than the device's. */
export function minutesIntoDay(t: number, tz: string): number {
  return minutesFrom(clockFormat(tz), t)
}

/**
 * Place a day's buckets on the axis, split into segments at every real gap.
 *
 * Sorted first: the series arrives in order today, but a back-filled day assembled from stored rows
 * has no such guarantee, and an out-of-order point would draw a line doubling back on itself.
 */
export function toSegments(buckets: StressBucket[], tz: string): StressSegment[] {
  const fmt = clockFormat(tz)
  const placed = buckets
    .map(b => ({ x: minutesFrom(fmt, b.t), level: b.level }))
    .sort((a, b) => a.x - b.x)

  const segments: StressSegment[] = []
  let run: StressSegment = []
  for (const p of placed) {
    if (run.length && p.x - run[run.length - 1].x > GAP_MINUTES) {
      segments.push(run)
      run = []
    }
    run.push(p)
  }
  if (run.length) segments.push(run)
  return segments
}

/** Total minutes covered by measured runs — the honest denominator for "how much of the day is this". */
export function coveredMinutes(segments: StressSegment[]): number {
  // A lone bucket covers its own 30 minutes; a run covers its span plus that same half-bucket at
  // each end, which is what makes one reading and two adjacent readings differ by 30 rather than 0.
  return segments.reduce((n, seg) => n + (seg[seg.length - 1].x - seg[0].x) + 30, 0)
}
