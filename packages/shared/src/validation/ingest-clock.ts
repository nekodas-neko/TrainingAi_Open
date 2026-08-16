/**
 * Reconciling a client-supplied timestamp against the server's clock.
 *
 * The device ingest routes accept the phone's own idea of when a reading happened. That value was
 * taken at face value (Q-24 §7), so a drifted or crafted clock could file a weigh-in years out and
 * silently reorder the timeline that later reads back from it.
 *
 * These clamp rather than reject. The reading itself is good data captured off real hardware, and
 * discarding it over its timestamp loses more than it protects — out of window, the server's own
 * time stands in, exactly as it already does when the field is omitted.
 *
 * `resolveCompletedAt` (lib/workout/complete-workout.ts) is the sibling of these and lives there
 * instead because it reconciles against the session's own `startedAt`, not just the clock.
 */

/** A phone that has been offline for longer than this is not the source of a fresh reading. */
export const INGEST_PAST_TOLERANCE_MS = 7 * 24 * 60 * 60_000
/** Ordinary clock skew. Anything further ahead is a broken clock, not a fast one. */
export const INGEST_FUTURE_TOLERANCE_MS = 60_000

export function resolveMeasuredAt(measuredAt: string | undefined, now: Date = new Date()): Date {
  if (!measuredAt) return now
  const t = new Date(measuredAt).getTime()
  if (Number.isNaN(t)) return now
  if (t < now.getTime() - INGEST_PAST_TOLERANCE_MS) return now
  if (t > now.getTime() + INGEST_FUTURE_TOLERANCE_MS) return now
  return new Date(t)
}
