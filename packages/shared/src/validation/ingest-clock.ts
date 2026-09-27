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

import { isCalendarDate, shiftDateStr } from '../date-utils'

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

  // `isCalendarDate` accepts both separators and rejects a shape-passing non-date such as
  // `2026-02-31`, which `Date` normalises to March 3 rather than refusing. It is the shared
  // predicate (Q-496) rather than a second copy of the round-trip test.
  if (!isCalendarDate(date.slice(0, 10))) return todayInUserTz
  const iso = date.replace(/\//g, '-').slice(0, 10)

  if (iso > todayInUserTz) return todayInUserTz

  const earliest = shiftDateStr(todayInUserTz, -pastToleranceDays)
  return iso < earliest ? earliest : iso
}

/**
 * A client-sent day is either usable or it is not, and the caller decides what to do about it
 * (RV-177). Where `resolveIngestDate` reconciles a day it intends to keep, this one answers whether
 * keeping it is possible at all, so a batch route can refuse one record instead of the batch.
 *
 * **Measured 2026-09-25, on the two routes this was written for.** `sync-health` bounded every
 * date by `DATE_RE` — shape only — so `2026-99-99` in one record reached the `date` column and
 * `22008 date/time field value out of range` took down the whole flush: a three-record payload
 * with two good days wrote **neither**. That is the poison-pill shape the handler's own comment
 * says it exists to avoid, arriving through the one field the comment did not cover. In the same
 * pass `{"date":"9999-12-30","weightKg":499}` answered 200 and wrote the row — Q-494's permanent
 * capture of every "most recent weight" read, reproduced on a second route.
 *
 * **Why the future tolerance is a day and not zero.** The client buckets by ITS local date and the
 * server computes today from the session's timezone. Around local midnight the two legitimately
 * disagree, so a zero tolerance would discard the real steps of the hour the user is awake for.
 *
 * **Why there is no past bound**, unlike `resolveIngestDate`'s: `SYNC_DAYS_COLD` is 30, so a first
 * install backfills a month, and clamping that to a 7-day window would merge three weeks of days
 * into one. An old day is real history; a far-future one captures reads that no later write can
 * outrank. Only the second is a defect.
 */
export const INGEST_FUTURE_TOLERANCE_DAYS = 1

export function ingestDayRejection(date: string, todayInUserTz: string): string | null {
  if (!isCalendarDate(date)) return `not a real calendar date: "${date.slice(0, 20)}"`
  const latest = shiftDateStr(todayInUserTz, INGEST_FUTURE_TOLERANCE_DAYS)
  return date.replace(/\//g, '-') > latest ? `dated after ${latest}` : null
}
