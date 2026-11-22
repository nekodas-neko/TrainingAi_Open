// #3890 step 2: the reads the weekly check-in engine and the plan need, and the one rest-day write.
//
// Every query is scoped to the user passed in, which the route takes from the session. Lift identity
// is the `exercise_preferences` rule (migration 202611221206's header): the library id first, the name
// only when an id is missing, and never a name row whose own id names a different library lift.
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'

type Db = ReturnType<typeof getDb>

/**
 * Mark a date as rest, or withdraw it (a tombstone; re-choosing revives the same row). Home's rest-day
 * write: `PostgresAdapter.setRestDay` (the web route and the `rest_days` sync domain). Takes a
 * transaction or the pool. The weekly check-in writes the same rows through `claimRestDay` and
 * `moveOwnedRestDay`, which are conditional so they never take over a row the person set.
 */
export async function writeRestDay(db: Db, userId: string, date: string, resting: boolean): Promise<void> {
  const stamp = new Date()
  await db.insert(s.restDays)
    .values({ userId, date, deletedAt: resting ? null : stamp })
    .onConflictDoUpdate({
      target: [s.restDays.userId, s.restDays.date],
      set: { deletedAt: resting ? null : stamp, updatedAt: stamp },
      // Scoped even though the conflict target already includes user_id: an onConflictDoUpdate
      // arm is an UPDATE, and the standing rule is that every one of them is user-scoped.
      setWhere: eq(s.restDays.userId, userId),
    })
}

/**
 * #3890: the weekly check-in's own rest-day write. Makes `date` a rest day stamped `stamp` only if it
 * is not one already: a new row, or a tombstone revived. A row that is already live is the person's
 * (Home's tap, or theirs from before) and is neither touched nor claimed. One atomic statement, so a
 * tap landing at the same moment as the save is never re-stamped as the check-in's. True when it wrote.
 */
export async function claimRestDay(db: Db, userId: string, date: string, stamp: Date): Promise<boolean> {
  const rows = await db.insert(s.restDays)
    .values({ userId, date, deletedAt: null, updatedAt: stamp })
    .onConflictDoUpdate({
      target: [s.restDays.userId, s.restDays.date],
      set: { deletedAt: null, updatedAt: stamp },
      setWhere: and(eq(s.restDays.userId, userId), isNotNull(s.restDays.deletedAt)),
    })
    .returning({ date: s.restDays.date })
  return rows.length === 1
}

/**
 * #3890: re-stamp (`resting`) or withdraw a rest day the check-in wrote, only while it is still the
 * check-in's: live and stamped `owned`. A row the person changed meanwhile is left as they left it.
 * True when it wrote.
 */
export async function moveOwnedRestDay(db: Db, userId: string, date: string, owned: Date, resting: boolean, to: Date): Promise<boolean> {
  const rows = await db.update(s.restDays)
    .set({ deletedAt: resting ? null : to, updatedAt: to })
    .where(and(
      eq(s.restDays.userId, userId), eq(s.restDays.date, date),
      isNull(s.restDays.deletedAt), eq(s.restDays.updatedAt, owned),
    ))
    .returning({ date: s.restDays.date })
  return rows.length === 1
}

/** Of `dates`, those that are a live rest day of the user's now. One query. */
export async function liveRestDays(db: Db, userId: string, dates: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>()
  if (dates.length === 0) return out
  const rows = await db.select({ date: s.restDays.date, updatedAt: s.restDays.updatedAt }).from(s.restDays)
    .where(and(eq(s.restDays.userId, userId), inArray(s.restDays.date, [...dates]), isNull(s.restDays.deletedAt)))
  for (const r of rows) out.set(r.date, r.updatedAt)
  return out
}

/**
 * #3890 A1: of the dates a check-in recorded as its own (`days_off_written`), those that still are: the
 * rest day is live and its `updated_at` is still the check-in's write stamp (`saved_at`, which
 * `claimRestDay` and `moveOwnedRestDay` wrote). A date the person un-rested, or un-rested and re-rested by hand, has moved
 * on from that stamp and is theirs now: undo and redo leave it alone and drop it from the record.
 */
export async function checkinOwnedRestDays(db: Db, userId: string, recorded: readonly string[], stamp: Date | null): Promise<Set<string>> {
  if (!stamp || recorded.length === 0) return new Set()
  const live = await liveRestDays(db, userId, recorded)
  return new Set([...live].filter(([, at]) => at.getTime() === stamp.getTime()).map(([d]) => d))
}

const namesArray = (names: readonly string[]) =>
  sql`${sql.raw('ARRAY[')}${sql.join(names.map(n => sql`${n}`), sql`, `)}${sql.raw(']::text[]')}`

/**
 * #3890: whether the saved check-in for the week starting `weekStart` (its `applies_week_start`) answered
 * "Heavy" for the lift `lift` (a name) whose library row is `libId`, and the app held or lowered it. A
 * SQL condition over the caller's own `lift` and `lib_id` columns, matched the `exercise_preferences`
 * way: the library id first, the name only when an id is missing, never a name row whose own id names a
 * different library lift. One definition, read by `listCheckinHeldLifts` (the session read) and by the
 * per-lift preference read (`listExercisePreferences`), so the plan and the read cannot disagree.
 */
export function checkinHeldCondition(userId: string, weekStart: string, lift: SQL, libId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
      FROM weekly_checkins c
      JOIN weekly_checkin_exercises e
        ON e.checkin_id = c.id AND e.user_id = ${userId} AND e.deleted_at IS NULL
       AND e.answer = 'heavy' AND e.effect IN ('held', 'lowered_one_step')
     WHERE c.user_id = ${userId} AND c.applies_week_start = ${weekStart}::date
       AND c.status = 'saved' AND c.deleted_at IS NULL
       AND ((${libId} IS NOT NULL AND e.exercise_id = ${libId})
            OR (e.exercise_name = ${lift} AND (e.exercise_id IS NULL OR ${libId} IS NULL OR e.exercise_id = ${libId}))))`
}

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
     WHERE ${checkinHeldCondition(userId, weekStart, sql`lifts.lift`, sql`lifts.lib_id`)}
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

/**
 * The local dates of the user's completed workouts of `programId`'s sessions that started in `[from, to)`,
 * one per workout. An ad-hoc workout or one of another program is not one of the week's planned
 * sessions, so it neither opens the card early nor counts toward "x of y planned" (review, 22 Nov).
 */
export async function completedWorkoutDays(db: Db, userId: string, programId: string, from: Date, to: Date, tz: string): Promise<string[]> {
  const res = await db.execute(sql`
    SELECT to_char(ws.started_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day
      FROM workout_sessions ws
      JOIN program_sessions ps ON ps.id = ws.session_id AND ps.program_id = ${programId}::uuid
      JOIN programs p ON p.id = ps.program_id AND p.user_id = ${userId}
     WHERE ws.user_id = ${userId} AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL
       AND ws.started_at >= ${from.toISOString()}::timestamptz AND ws.started_at < ${to.toISOString()}::timestamptz
     ORDER BY ws.started_at
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
