// #3890 step 2: the reads the weekly check-in engine and the plan need, and the one rest-day write.
//
// Every query is scoped to the user passed in, which the route takes from the session. Lift identity
// is the `exercise_preferences` rule (migration 202611221206's header): the library id first, the name
// only when an id is missing, and never a name row whose own id names a different library lift.
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'

type Db = ReturnType<typeof getDb>

/**
 * Mark a date as rest, or withdraw it (a tombstone; re-choosing revives the same row). THE rest-day
 * write: `PostgresAdapter.setRestDay` (the web route and the `rest_days` sync domain) and the weekly
 * check-in's days off both call it, so the two cannot drift. Takes a transaction or the pool.
 */
export async function writeRestDay(db: Db, userId: string, date: string, resting: boolean): Promise<void> {
  await db.insert(s.restDays)
    .values({ userId, date, deletedAt: resting ? null : new Date() })
    .onConflictDoUpdate({
      target: [s.restDays.userId, s.restDays.date],
      set: { deletedAt: resting ? null : new Date(), updatedAt: new Date() },
      // Scoped even though the conflict target already includes user_id: an onConflictDoUpdate
      // arm is an UPDATE, and the standing rule is that every one of them is user-scoped.
      setWhere: eq(s.restDays.userId, userId),
    })
}

const namesArray = (names: readonly string[]) =>
  sql`${sql.raw('ARRAY[')}${sql.join(names.map(n => sql`${n}`), sql`, `)}${sql.raw(']::text[]')}`

/**
 * Of `exerciseNames` (a session's lifts), those the saved check-in for the week starting `weekStart`
 * (its `applies_week_start`) answered "Heavy" for, and that the app held or lowered. One query.
 */
export async function listCheckinHeldLifts(db: Db, userId: string, weekStart: string, exerciseNames: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (exerciseNames.length === 0) return out
  const res = await db.execute(sql`
    WITH lifts AS (
      SELECT n.name AS lift, l.id AS lib_id
        FROM unnest(${namesArray(exerciseNames)}) AS n(name)
        LEFT JOIN exercise_library l ON l.name = n.name
    )
    SELECT DISTINCT lifts.lift
      FROM lifts
      JOIN weekly_checkins c
        ON c.user_id = ${userId} AND c.applies_week_start = ${weekStart}::date
       AND c.status = 'saved' AND c.deleted_at IS NULL
      JOIN weekly_checkin_exercises e
        ON e.checkin_id = c.id AND e.user_id = ${userId} AND e.deleted_at IS NULL
       AND e.answer = 'heavy' AND e.effect IN ('held', 'lowered_one_step')
       AND ((lifts.lib_id IS NOT NULL AND e.exercise_id = lifts.lib_id)
            OR (e.exercise_name = lifts.lift AND (e.exercise_id IS NULL OR lifts.lib_id IS NULL OR e.exercise_id = lifts.lib_id)))
  `)
  for (const r of res.rows as { lift: string }[]) out.add(r.lift)
  return out
}

/** The shorter session the saved check-in for the week starting `weekStart` asked for, in minutes. */
export async function getCheckinSessionBudgetMin(db: Db, userId: string, weekStart: string): Promise<number | null> {
  const [row] = await db.select({ min: s.weeklyCheckins.shorterSessionMin }).from(s.weeklyCheckins)
    .where(and(
      eq(s.weeklyCheckins.userId, userId),
      eq(s.weeklyCheckins.appliesWeekStart, weekStart),
      eq(s.weeklyCheckins.status, 'saved'),
      isNull(s.weeklyCheckins.deletedAt),
    ))
    .limit(1)
  return row?.min ?? null
}

/** One lift slot of the active program. `exerciseId` is the slot's library id, else the library row of its name. */
export interface ProgramLift {
  sessionExerciseId: string
  exerciseName: string
  exerciseId: string | null
  exerciseRole: string
  muscleGroups: string[]
}

/**
 * Lift slots of the user's ACTIVE program, in session then exercise order. `primaryOnly` gives the
 * main lifts (the program's own `exercise_role = 'primary'`, the role the time budget, the prompt and
 * the session read already treat as the main lift). `sessionExerciseId` narrows to one slot, so a
 * client-supplied id is ownership-checked by the same query that reads it.
 */
export async function listProgramLifts(
  db: Db, userId: string, opts: { primaryOnly?: boolean; sessionExerciseId?: string } = {},
): Promise<ProgramLift[]> {
  const res = await db.execute(sql`
    SELECT se.id, se.exercise_name, COALESCE(se.exercise_id, l.id) AS exercise_id, se.exercise_role, se.muscle_groups
      FROM session_exercises se
      JOIN program_sessions ps ON ps.id = se.session_id AND ps.deleted_at IS NULL
      JOIN programs p ON p.id = ps.program_id AND p.user_id = ${userId} AND p.is_active = true
      LEFT JOIN exercise_library l ON l.name = se.exercise_name
     WHERE se.deleted_at IS NULL
       ${opts.primaryOnly ? sql`AND se.exercise_role = 'primary'` : sql``}
       ${opts.sessionExerciseId ? sql`AND se.id = ${opts.sessionExerciseId}::uuid` : sql``}
     ORDER BY ps.position, se.position, se.id
  `)
  return (res.rows as Record<string, unknown>[]).map(r => ({
    sessionExerciseId: String(r.id),
    exerciseName: String(r.exercise_name),
    exerciseId: (r.exercise_id as string | null) ?? null,
    exerciseRole: String(r.exercise_role),
    muscleGroups: Array.isArray(r.muscle_groups) ? (r.muscle_groups as string[]) : [],
  }))
}

/** The local dates of the user's completed workouts that started in `[from, to)`, one per workout. */
export async function completedWorkoutDays(db: Db, userId: string, from: Date, to: Date, tz: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT to_char(started_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day
      FROM workout_sessions
     WHERE user_id = ${userId} AND deleted_at IS NULL AND completed_at IS NOT NULL
       AND started_at >= ${from.toISOString()}::timestamptz AND started_at < ${to.toISOString()}::timestamptz
     ORDER BY started_at
  `)
  return (res.rows as { day: string }[]).map(r => r.day)
}

export type CheckinRow = typeof s.weeklyCheckins.$inferSelect
export type CheckinLiftRow = typeof s.weeklyCheckinExercises.$inferSelect

/** The user's live check-in for a week (by its reviewed `week_start`), optionally locked. */
export async function getCheckinByWeek(db: Db, userId: string, weekStart: string, lock = false): Promise<CheckinRow | null> {
  const q = db.select().from(s.weeklyCheckins)
    .where(and(eq(s.weeklyCheckins.userId, userId), eq(s.weeklyCheckins.weekStart, weekStart), isNull(s.weeklyCheckins.deletedAt)))
    .limit(1)
  const [row] = lock ? await q.for('update') : await q
  return row ?? null
}

/** The user's live check-in by id: another person's id reads as none. */
export async function getCheckinById(db: Db, userId: string, id: string, lock = false): Promise<CheckinRow | null> {
  const q = db.select().from(s.weeklyCheckins)
    .where(and(eq(s.weeklyCheckins.id, id), eq(s.weeklyCheckins.userId, userId), isNull(s.weeklyCheckins.deletedAt)))
    .limit(1)
  const [row] = lock ? await q.for('update') : await q
  return row ?? null
}

/** The check-in's lift rows; `includeDeleted` for a redo, which revives a tombstoned row. */
export async function listCheckinLifts(db: Db, userId: string, checkinId: string, includeDeleted = false): Promise<CheckinLiftRow[]> {
  return db.select().from(s.weeklyCheckinExercises)
    .where(and(
      eq(s.weeklyCheckinExercises.userId, userId),
      eq(s.weeklyCheckinExercises.checkinId, checkinId),
      ...(includeDeleted ? [] : [isNull(s.weeklyCheckinExercises.deletedAt)]),
    ))
    .orderBy(s.weeklyCheckinExercises.createdAt, s.weeklyCheckinExercises.id)
}
