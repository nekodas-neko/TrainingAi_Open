// #3896 step 4. The reads and the one write of `exercise_preferences` that the plan needs. The table
// is #3996's; the writer of a preference is step 5 (the Coach domain). The only write here is the
// one-shot clear, made when a finished log consumes it.
//
// Lift identity is the `exercise_estimates` rule: match the library id first, fall back to the name.
// A session's lifts carry only a name, so the id is the library row of that name. A row found by name
// whose own id names a different library lift belongs to that lift (it was renamed away from this
// name), so the name fallback skips it.
import { sql } from 'drizzle-orm'
import type { getDb } from '../client'
import { ONE_SHOT_TTL_DAYS, type LiftPreferenceRow } from '@trainingai/shared/ai-periodization/lift-preference'
import { checkinHeldCondition } from './weekly-checkin'

type Db = ReturnType<typeof getDb>

interface PreferenceSqlRow {
  lift: string
  by_id: boolean
  rep_min: number | null
  rep_max: number | null
  rest_sec: number | null
  next_load_step: string | null
  sets_delta: number | null
  one_shot_set_at: Date | string | null
  one_shot_expired: boolean
  stale_stamps: string[] | null
  checkin_held?: boolean
}

/** The user's live preferences for these lifts, keyed by the name the caller passed. One query. */
/** A one-shot the expiry clear just took off a row: the lift, and the `one_shot_set_at` it carried (ms). */
export interface ClearedOneShot { exerciseName: string; setAtMs: number }

/**
 * A row whose one-off columns are empty but that was written in the last this-many days may belong to
 * a lift whose one-off was just used up: a stored plan can still carry its stamp if the restate that
 * follows the consume failed (#4007). Only such a row is checked against the stored plans, inside the
 * one preferences query, so a person with no preferences, a live one-off, or lasting preferences last
 * touched longer ago pays nothing extra. A stamp left past the window is gone when the plan is next
 * remade (generation applies the lift's preference as it is then).
 */
export const STALE_STAMP_RETRY_DAYS = 7

/**
 * `stale` (optional) receives the one-off times that a lift's stored plans still carry although its
 * row no longer holds one (#4007): found by the same single select that reads the preferences, so the
 * check adds no query. The caller restates those plans.
 *
 * `checkinWeekStart` (optional, #3890): the local Monday of the week being planned. With it, a lift the
 * saved weekly check-in for that week (`applies_week_start`) answered "Heavy" for comes back with
 * `checkinHeld: true`, with or without a preference row of its own, from the same single select
 * (`checkinHeldCondition`). Without it the statement and the result are as before.
 */
export async function listExercisePreferences(
  db: Db, userId: string, exerciseNames: string[], cleared?: ClearedOneShot[], stale?: ClearedOneShot[],
  checkinWeekStart?: string,
): Promise<Map<string, LiftPreferenceRow>> {
  const out = new Map<string, LiftPreferenceRow>()
  if (exerciseNames.length === 0) return out
  // An expired one-shot (`ONE_SHOT_TTL_DAYS`, database clock) is cleared the moment a read sees it, by a
  // conditional write that only touches rows still past the limit. If the clear fails the read below
  // still treats it as expired, so a failure never lets an old one-shot apply.
  // #4082 review: `SKIP LOCKED`. This one statement updates several preference rows, and with no lift lock
  // it could wait for a row a weekly check-in holds while the check-in waited for another of them. A
  // clear is best-effort (a read treats an expired one-shot as expired whether or not it was cleared), so
  // a row someone else holds is left for the next read rather than waited for: a statement that never
  // waits cannot be one side of a cycle.
  // The cleared rows' old times come back (a CTE reads them before the update nulls them), so the caller
  // can take the spent step out of the stored plans that still carry it (#4007).
  const expired = await db.execute(sql`
    WITH old AS (
      SELECT id, exercise_name, (extract(epoch FROM one_shot_set_at) * 1000)::float8 AS set_ms
        FROM exercise_preferences
       WHERE user_id = ${userId}
         AND deleted_at IS NULL
         AND one_shot_set_at IS NOT NULL
         AND one_shot_set_at < now() - make_interval(days => ${ONE_SHOT_TTL_DAYS})
         FOR UPDATE SKIP LOCKED
    )
    UPDATE exercise_preferences p
       SET next_load_step = NULL, sets_delta = NULL, one_shot_set_at = NULL, updated_at = now()
      FROM old
     WHERE p.id = old.id AND p.user_id = ${userId}
    RETURNING old.exercise_name, old.set_ms
  `).catch(err => { console.error('[exercise-preferences] clearing an expired one-shot failed:', err); return null })
  for (const r of (expired?.rows ?? []) as { exercise_name: string; set_ms: number }[]) {
    cleared?.push({ exerciseName: r.exercise_name, setAtMs: Number(r.set_ms) })
  }
  return readExercisePreferenceRows(db, userId, exerciseNames, stale, checkinWeekStart)
}

/**
 * The select half of `listExercisePreferences`: the user's live preferences for these lifts, with no
 * clear and no write. The generation's store re-reads through it inside its transaction (#4007), so the
 * rows it compares are the rows the start of the generation read, by the one query.
 */
export async function readExercisePreferenceRows(
  db: Db, userId: string, exerciseNames: string[], stale?: ClearedOneShot[], checkinWeekStart?: string,
): Promise<Map<string, LiftPreferenceRow>> {
  const out = new Map<string, LiftPreferenceRow>()
  if (exerciseNames.length === 0) return out
  const held = checkinWeekStart ? checkinHeldCondition(userId, checkinWeekStart, sql`lifts.lift`, sql`lifts.lib_id`) : null
  const res = await db.execute(sql`
    WITH lifts AS (
      SELECT n.name AS lift, l.id AS lib_id
      FROM unnest(${sql.raw('ARRAY[')}${sql.join(exerciseNames.map(n => sql`${n}`), sql`, `)}${sql.raw(']::text[]')}) AS n(name)
      LEFT JOIN exercise_library l ON l.name = n.name
    )
    SELECT lifts.lift,
           COALESCE(lifts.lib_id IS NOT NULL AND p.exercise_id = lifts.lib_id, false) AS by_id,
           p.rep_min, p.rep_max, p.rest_sec, p.next_load_step, p.sets_delta, p.one_shot_set_at,
           COALESCE(p.one_shot_set_at < now() - make_interval(days => ${ONE_SHOT_TTL_DAYS}), false) AS one_shot_expired,
           CASE WHEN ${stale ? sql`true` : sql`false`}
                 AND p.one_shot_set_at IS NULL
                 AND p.updated_at > now() - make_interval(days => ${STALE_STAMP_RETRY_DAYS})
                THEN ARRAY(
                  SELECT DISTINCT e->'liftPreference'->>'oneShotSetAt'
                    FROM session_periodization sp
                   CROSS JOIN LATERAL jsonb_array_elements(
                           CASE WHEN jsonb_typeof(sp.prescription->'exercises') = 'array' THEN sp.prescription->'exercises' ELSE '[]'::jsonb END) AS e
                   WHERE sp.user_id = ${userId}
                     AND e->>'name' = lifts.lift
                     AND e->'liftPreference'->>'oneShotSetAt' IS NOT NULL)
                ELSE ARRAY[]::text[]
           END AS stale_stamps
           ${held ? sql`, ${held} AS checkin_held` : sql``}
    FROM lifts
    ${held ? sql`LEFT JOIN` : sql`JOIN`} exercise_preferences p
      ON p.user_id = ${userId}
     AND p.deleted_at IS NULL
     AND (
       (lifts.lib_id IS NOT NULL AND p.exercise_id = lifts.lib_id)
       OR (p.exercise_name = lifts.lift AND (p.exercise_id IS NULL OR lifts.lib_id IS NULL OR p.exercise_id = lifts.lib_id))
     )
    ${held ? sql`WHERE p.id IS NOT NULL OR ${held}` : sql``}
    ORDER BY lifts.lift, by_id DESC
  `)
  for (const r of res.rows as unknown as PreferenceSqlRow[]) {
    if (out.has(r.lift)) continue // by_id DESC (never null): an id match wins over a name match
    out.set(r.lift, {
      repMin: r.rep_min == null ? null : Number(r.rep_min),
      repMax: r.rep_max == null ? null : Number(r.rep_max),
      restSec: r.rest_sec == null ? null : Number(r.rest_sec),
      nextLoadStep: r.one_shot_expired ? null : r.next_load_step,
      setsDelta: r.one_shot_expired || r.sets_delta == null ? null : Number(r.sets_delta),
      oneShotSetAt: r.one_shot_expired || r.one_shot_set_at == null ? null : new Date(r.one_shot_set_at),
      ...(r.checkin_held === true && { checkinHeld: true }),
    })
    for (const at of r.stale_stamps ?? []) {
      const ms = new Date(at).getTime()
      if (!Number.isNaN(ms)) stale?.push({ exerciseName: r.lift, setAtMs: ms })
    }
  }
  return out
}

/**
 * Consume the lift's one-shot, once, for a log of a plan that carried it: null its three columns in ONE
 * conditional write, only while the stored `one_shot_set_at` is the very value the log presents
 * (`servedSetAt`, the `liftPreference.oneShotSetAt` its plan recorded; the client echoes it in the log
 * payload). The presented value is only ever compared against the row's own, never stored: a forged,
 * stale or missing value matches nothing and leaves the one-shot in place. A one-shot set after the
 * plan was made, or a newer one that replaced the one the plan carried, does not match either.
 *
 * Equality is to the millisecond (the plan records an ISO string, which has no microseconds), so the
 * test is a 2 ms window. No clock is compared here: the set and the expiry both use the database's
 * `now()`, and a write of `one_shot_set_at` must too (step 5), never an app or device time.
 *
 * A second device or a retry racing this one re-checks the row after this commits and finds nothing to
 * take, so at most one call returns true. The caller decides whether the log may consume at all
 * (`logMayConsumeOneShot`: a new, non-deload, non-baseline log).
 */
export async function consumeLiftOneShot(db: Db, userId: string, exerciseName: string, servedSetAt: Date): Promise<boolean> {
  if (Number.isNaN(servedSetAt.getTime())) return false
  const res = await db.execute(sql`
    UPDATE exercise_preferences p
       SET next_load_step = NULL, sets_delta = NULL, one_shot_set_at = NULL, updated_at = now()
     WHERE p.id = (
             SELECT q.id
               FROM exercise_preferences q
               LEFT JOIN exercise_library l ON l.name = ${exerciseName}
              WHERE q.user_id = ${userId}
                AND q.deleted_at IS NULL
                AND ((l.id IS NOT NULL AND q.exercise_id = l.id)
                     OR (q.exercise_name = ${exerciseName} AND (q.exercise_id IS NULL OR l.id IS NULL OR q.exercise_id = l.id)))
              ORDER BY COALESCE(l.id IS NOT NULL AND q.exercise_id = l.id, false) DESC
              LIMIT 1
           )
       AND p.user_id = ${userId}
       AND p.deleted_at IS NULL
       AND p.one_shot_set_at IS NOT NULL
       AND abs(extract(epoch FROM (p.one_shot_set_at - ${servedSetAt.toISOString()}::timestamptz))) < 0.002
    RETURNING p.id
  `)
  return (res.rowCount ?? res.rows.length) === 1
}
