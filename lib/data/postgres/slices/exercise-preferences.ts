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
import type { LiftPreferenceRow } from '@trainingai/shared/ai-periodization/lift-preference'

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
}

/** The user's live preferences for these lifts, keyed by the name the caller passed. One query. */
export async function listExercisePreferences(db: Db, userId: string, exerciseNames: string[]): Promise<Map<string, LiftPreferenceRow>> {
  const out = new Map<string, LiftPreferenceRow>()
  if (exerciseNames.length === 0) return out
  const res = await db.execute(sql`
    WITH lifts AS (
      SELECT n.name AS lift, l.id AS lib_id
      FROM unnest(${sql.raw('ARRAY[')}${sql.join(exerciseNames.map(n => sql`${n}`), sql`, `)}${sql.raw(']::text[]')}) AS n(name)
      LEFT JOIN exercise_library l ON l.name = n.name
    )
    SELECT lifts.lift,
           COALESCE(lifts.lib_id IS NOT NULL AND p.exercise_id = lifts.lib_id, false) AS by_id,
           p.rep_min, p.rep_max, p.rest_sec, p.next_load_step, p.sets_delta, p.one_shot_set_at
    FROM lifts
    JOIN exercise_preferences p
      ON p.user_id = ${userId}
     AND p.deleted_at IS NULL
     AND (
       (lifts.lib_id IS NOT NULL AND p.exercise_id = lifts.lib_id)
       OR (p.exercise_name = lifts.lift AND (p.exercise_id IS NULL OR lifts.lib_id IS NULL OR p.exercise_id = lifts.lib_id))
     )
    ORDER BY lifts.lift, by_id DESC
  `)
  for (const r of res.rows as unknown as PreferenceSqlRow[]) {
    if (out.has(r.lift)) continue // by_id DESC (never null): an id match wins over a name match
    out.set(r.lift, {
      repMin: r.rep_min == null ? null : Number(r.rep_min),
      repMax: r.rep_max == null ? null : Number(r.rep_max),
      restSec: r.rest_sec == null ? null : Number(r.rest_sec),
      nextLoadStep: r.next_load_step,
      setsDelta: r.sets_delta == null ? null : Number(r.sets_delta),
      oneShotSetAt: r.one_shot_set_at == null ? null : new Date(r.one_shot_set_at),
    })
  }
  return out
}

/**
 * Consume the lift's one-shot, once: null its three columns in ONE conditional write, only while a
 * one-shot is still stored and it was written before `receivedAt` (server time when the log arrived).
 * A second device or a retry racing this one re-checks the row after this commits and finds nothing to
 * take, so at most one call returns true. The caller decides whether the log may consume at all
 * (`shouldConsumeOneShot`: a new, non-deload, non-baseline log).
 */
export async function consumeLiftOneShot(db: Db, userId: string, exerciseName: string, receivedAt: Date): Promise<boolean> {
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
       AND p.one_shot_set_at < ${receivedAt.toISOString()}::timestamptz
    RETURNING p.id
  `)
  return (res.rowCount ?? res.rows.length) === 1
}
