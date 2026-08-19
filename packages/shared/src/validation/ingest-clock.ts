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

import { shiftDateStr } from '../date-utils'

/** A phone that has been offline for longer than this is not the source of a fresh reading. */
export const INGEST_PAST_TOLERANCE_MS = 7 * 24 * 60 * 60_000
/** Ordinary clock skew. Anything further ahead is a broken clock, not a fast one. */
export const INGEST_FUTURE_TOLERANCE_MS = 60_000

/** The same past window as `INGEST_PAST_TOLERANCE_MS`, expressed in whole days for a calendar date. */
export const INGEST_PAST_TOLERANCE_DAYS = 7

export function resolveMeasuredAt(measuredAt: string | undefined, now: Date = new Date()): Date {
  if (!measuredAt) return now
  const t = new Date(measuredAt).getTime()
  if (Number.isNaN(t)) return now
  if (t < now.getTime() - INGEST_PAST_TOLERANCE_MS) return now
  if (t > now.getTime() + INGEST_FUTURE_TOLERANCE_MS) return now
  return new Date(t)
}


/**
 * The calendar-date analogue of `resolveMeasuredAt`, for a route that ingests a *day* rather than an
 * instant (Q-494).
 *
 * **The defect it closes.** `health-connect/ingest` bounded its `date` by regex — shape only, never
 * range — so one request filed a reading in the year 9999, and
 * `getMostRecentConfirmedWeightKg`'s `ORDER BY date DESC LIMIT 1` answered it **permanently**: no
 * later write can outrank it. Measured: `{"date":"9999/12/30","weightKg":499}` → `200`, after which
 * the most-recent confirmed weight read `9999-12-30, 499 kg`. Two readers use that shape — the BLE
 * scale's confirmation step and `deriveActivityKcal`, which multiplies body weight into every
 * activity-calorie estimate.
 *
 * **The ranked source merge cannot help**, and the reason is worth keeping: `health-source.ts` ranks
 * per column *per date*, so it stops a worse source overwriting a better one **on the same day**. A
 * row on a date nothing else ever writes has no competitor, so even rank-1 `health_connect` wins
 * outright. That protection is orthogonal to this, not weak against it.
 *
 * **Why this clamps to the boundary and not to today, unlike its sibling.** `resolveMeasuredAt`
 * returns `now` for anything out of window, which is right for an instant: a scale reading filed a
 * few seconds off is still that reading. This route writes a **daily aggregate** — steps, calories,
 * macros for a whole day — and re-dating a ten-day-old day onto *today* would merge stale numbers
 * into the day every "today" and "most recent" read depends on. Clamping to the nearest in-range day
 * keeps the reconcile-don't-reject behaviour (a 400 would quarantine the outbox mutation and lose a
 * real reading over a bad clock) without corrupting today.
 */
export function resolveIngestDate(
  date: string | undefined,
  todayInUserTz: string,
  pastToleranceDays: number = INGEST_PAST_TOLERANCE_DAYS,
): string {
  if (!date) return todayInUserTz

  // Both separators, checked on the RAW value before normalising: the client's `localDateString()`
  // emits `YYYY/MM/DD`, and a dash-only shape check here would reject every real Tasker call.
  if (!/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(date.slice(0, 10))) return todayInUserTz
  const iso = date.replace(/\//g, '-').slice(0, 10)
  // Rejects a shape-passing non-date such as `2026-02-31`, which `Date` normalises to March 3 rather
  // than refusing. `shiftDateStr(x, 0)` round-trips through that normalisation, so a value that is
  // not its own zero-shift was never a real calendar day. (Q-496 is the same input reaching further
  // in; this closes it for the ingest route as a side effect of bounding the range.)
  if (shiftDateStr(iso, 0) !== iso) return todayInUserTz

  if (iso > todayInUserTz) return todayInUserTz

  const earliest = shiftDateStr(todayInUserTz, -pastToleranceDays)
  return iso < earliest ? earliest : iso
}
