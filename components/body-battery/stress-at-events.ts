import { minutesIntoDay, type StressSegment } from './stress-day'

/**
 * Reading the day's stress beside the day's events (TN-35).
 *
 * The owner: *"I'd like to get stress metric to be a usable value to determine what events stress
 * me."* TN-3b's chart answers *when* a stressed window happened. Attribution needs *what was
 * happening then*, and the day timeline already carries typed, timestamped events — so the join
 * needs no new data, only a placement and an honest lookup.
 *
 * **The lookup returns `null` far more often than it looks like it should, and that is the point.**
 * Coverage averages 26.6 buckets a day — **13.3 of 24 hours** — with real multi-hour holes, so a
 * great many events have no reading beside them at all. The entry's instruction is explicit:
 * *"Render that as absent, never as calm."* A missing bucket is not a level of zero, and a UI that
 * prints 0 for one is making up the one number the owner would act on.
 *
 * **No verdict is computed here and none should be added.** Ranking causes needs many marked
 * instances per event type; one month of one user will not support it, and an automatic
 * "X stresses you" is TN-16's shape, which is parked.
 */

/** Buckets are 30 minutes wide and placed at their midpoint, so one covers ±15 around its `x`. */
export const BUCKET_HALF_MIN = 15

/** The minimal shape this needs from a timeline event — deliberately not the route's full type. */
export interface DayEvent {
  type: string
  title: string
  /** "h:mm a", already formatted in the user's zone by the route. */
  time: string
  timeMs: number
}

export interface PlacedEvent extends DayEvent {
  /** Minutes since local midnight, 0–1440 — the same axis the chart draws on. */
  x: number
  /** The measured level at this moment, or `null` when no bucket covers it. */
  level: number | null
}

/**
 * `tag` is excluded and must stay excluded. `oura_tags` holds zero rows — it was fed by the Oura
 * Cloud, removed 2026-08-13 and never to be re-added — so rendering the lane would promise a marker
 * mechanism that does not exist.
 */
const EXCLUDED_TYPES = new Set(['tag'])

/** The level of the bucket covering `minute`, or `null` if the nearest measured point is further
 *  than half a bucket away — which is what a gap looks like from here. */
export function levelAt(segments: StressSegment[], minute: number): number | null {
  let best: { d: number; level: number } | null = null
  for (const seg of segments) {
    for (const p of seg) {
      const d = Math.abs(p.x - minute)
      if (d <= BUCKET_HALF_MIN && (best === null || d < best.d)) best = { d, level: p.level }
    }
  }
  return best?.level ?? null
}

/** Place the day's events on the chart's axis and read the level at each, in time order. */
export function placeEvents(
  events: DayEvent[],
  segments: StressSegment[],
  tz: string,
): PlacedEvent[] {
  return events
    .filter(e => !EXCLUDED_TYPES.has(e.type))
    .map(e => {
      const x = minutesIntoDay(e.timeMs, tz)
      return { ...e, x, level: levelAt(segments, x) }
    })
    .sort((a, b) => a.x - b.x)
}

/** How many of the placed events actually have a reading — the honest headline for the list. */
export function measuredCount(placed: PlacedEvent[]): number {
  return placed.filter(e => e.level !== null).length
}
