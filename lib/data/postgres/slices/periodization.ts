import { eq, and, inArray, asc, desc, sql, isNull, gte, lte } from 'drizzle-orm'
import { NotFoundError } from '@trainingai/shared/errors'
import type { getDb } from '../client'
import * as s from '../schema'
import { shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { holdsOneDayDeload } from '@trainingai/shared/ai-periodization/one-day-deload'
import { slotHoldsPlan } from '@trainingai/shared/ai-periodization/plan-status'
import { sessionUnderWayCutoff } from '@trainingai/shared/ai-periodization/session-under-way'
import { oneRmImplausible, MAX_PLAUSIBLE_ONE_RM_KG } from '@trainingai/shared/validation/plausibility'
import {
  joiningPhaseFor, programMoveMark,
  type ProgramCompletion, type PhaseAnswer, type ProgramMoveOptions, type DecidePending, type DecideTarget,
} from '@trainingai/shared/ai-periodization/program-phase'
import type { TimingRow } from '@trainingai/shared/workout/time-profile'
import type {
  SessionPeriodization, PeriodizationPhase, AiPrescription,
  Baseline1rmEntry, PendingTransition, PrescriptionStatus, ProgramVolumeTarget,
  PrescriptionGeneratedFor as GeneratedFor,
} from '@trainingai/shared/types/ai-periodization'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

// ── Row Mappers ────────────────────────────────────────────────────────────────

export function mapPeriodization(row: typeof s.sessionPeriodization.$inferSelect): SessionPeriodization {
  return {
    id: row.id,
    userId: row.userId,
    programSessionId: row.programSessionId,
    phase: row.phase as PeriodizationPhase,
    phaseStartedAt: row.phaseStartedAt,
    sessionsInPhase: row.sessionsInPhase,
    baselineComplete: row.baselineComplete,
    baseline1rm: (row.baseline1rm ?? {}) as Record<string, Baseline1rmEntry>,
    prescription: (row.prescription ?? null) as AiPrescription | null,
    prescriptionGeneratedAt: row.prescriptionGeneratedAt ?? null,
    prescriptionExpiresAt: row.prescriptionExpiresAt ?? null,
    prescriptionStatus: row.prescriptionStatus as PrescriptionStatus,
    lastSessionRanPrescription: row.lastSessionRanPrescription ?? null,
    pendingTransition: (row.pendingTransition ?? null) as PendingTransition | null,
    preEmergencyDeloadPhase: (row.preEmergencyDeloadPhase ?? null) as PeriodizationPhase | null,
    updatedAt: row.updatedAt,
  }
}

// ── Session Periodization ──────────────────────────────────────────────────────

export async function getSessionPeriodization(db: Db, userId: string, programSessionId: string): Promise<SessionPeriodization | null> {
  const [row] = await db
    .select({
      sp: s.sessionPeriodization,
      // #3890: a shorter session the weekly check-in asked for, for a week that could hold today in any
      // timezone (the caller picks the one for the user's local week). In the same statement, so the
      // stored-plan read costs a person with no check-in nothing extra.
      checkinBudgets: sql<{ weekStart: string; min: number }[] | null>`(
        SELECT json_agg(json_build_object('weekStart', c.applies_week_start::text, 'min', c.shorter_session_min))
          FROM weekly_checkins c
         WHERE c.user_id = ${userId} AND c.status = 'saved' AND c.deleted_at IS NULL
           AND c.shorter_session_min IS NOT NULL
           AND c.applies_week_start BETWEEN CURRENT_DATE - 8 AND CURRENT_DATE + 2)`,
      // #3890: the weeks around today whose saved check-in holds a lift ("Heavy"), for the same reason.
      // Which lifts, and which week is the user's, the caller works out only when one is listed.
      checkinHeldWeeks: sql<string[] | null>`(
        SELECT array_agg(DISTINCT c.applies_week_start::text)
          FROM weekly_checkins c
         WHERE c.user_id = ${userId} AND c.status = 'saved' AND c.deleted_at IS NULL
           AND c.applies_week_start BETWEEN CURRENT_DATE - 8 AND CURRENT_DATE + 2
           AND EXISTS (SELECT 1 FROM weekly_checkin_exercises e
                        WHERE e.checkin_id = c.id AND e.user_id = ${userId} AND e.deleted_at IS NULL
                          AND e.answer = 'heavy' AND e.effect IN ('held', 'lowered_one_step')))`,
    })
    .from(s.sessionPeriodization)
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
    .limit(1)
  if (!row) return null
  const state = mapPeriodization(row.sp)
  return {
    ...state,
    ...(row.checkinBudgets?.length ? { checkinSessionBudgets: row.checkinBudgets } : {}),
    ...(row.checkinHeldWeeks?.length ? { checkinHeldWeeks: row.checkinHeldWeeks } : {}),
  }
}

export async function ensureSessionPeriodization(db: Db, userId: string, programSessionId: string): Promise<SessionPeriodization> {
  const [row] = await db
    .insert(s.sessionPeriodization)
    .values({ userId, programSessionId })
    .onConflictDoNothing()
    .returning()
  if (row) return mapPeriodization(row)
  const existing = await getSessionPeriodization(db, userId, programSessionId)
  return existing!
}

/**
 * The program's rows, locked for the rest of the transaction, in id order (so two writers lock them
 * in the same order). A program move, the switch-over, a re-align and a baseline joining the program
 * all take this lock first, so none of them reads rows another is about to change (#3766).
 */
async function lockProgramRows(tx: Tx, userId: string, programId: string): Promise<SessionPeriodization[]> {
  const rows = await tx
    .select({ sp: s.sessionPeriodization })
    .from(s.sessionPeriodization)
    .innerJoin(s.programSessions, eq(s.sessionPeriodization.programSessionId, s.programSessions.id))
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.programSessions.programId, programId),
      isNull(s.programSessions.deletedAt),
    ))
    .orderBy(asc(s.sessionPeriodization.id))
    .for('update', { of: s.sessionPeriodization })
  return rows.map(r => mapPeriodization(r.sp))
}

/**
 * #3900 second review (1), third review (2): the session types with a workout under way: not
 * finished, not deleted, and with a logged set whose time is at or after `lastSetSince`
 * (`sessionUnderWayCutoff`).
 *
 * A set's time is the PHONE's clock: the latest of its exercise log's `logged_at` and its sets'
 * `set_end_ms` (the phone's clock too; `started_at`, `completed_at` and `client_edited_at` are the
 * phone's as well). Two guards, because nothing about a phone's clock is certain:
 *  - A `set_end_ms` is used only when it reads as a millisecond epoch (`BETWEEN 1e12 AND 4e12`); a
 *    value in seconds, or an absurd one that `to_timestamp` would throw on, is ignored and the log's
 *    `logged_at` stands.
 *  - A phone time more than 10 minutes later than the server's time when it received the log row
 *    (`updated_at`) is not believed: the phone's clock runs ahead. It is not clamped to now, which would
 *    hold the session under way for as long as the row exists, and it is compared with the receive time
 *    rather than the clock now, so the verdict does not flip back once real time catches up with the
 *    phone's. The log row's `updated_at` is its time instead.
 *
 * `updated_at` is not used for a phone time that is believable, because a late sync stamps it with the
 * push's time and would make yesterday's workout look as if it were being trained now. A phone that
 * runs BEHIND is not corrected: no server-stamped time tells its just-logged set from a workout synced
 * late (both rows are received now, both phone times read old), so such a session reads as not under
 * way once the phone's last-set time is older than the window. The start of the workout and the local
 * date do not decide it: a workout across midnight is under way, and one abandoned half-done is not
 * once its last set is old.
 */
export async function listUnfinishedLoggedSessions(db: Db | Tx, userId: string, lastSetSince: Date): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT last_sets.program_session_id
    FROM (
      SELECT ws.session_id AS program_session_id,
             max(CASE WHEN logs.phone_at <= logs.server_at + interval '10 minutes' THEN logs.phone_at ELSE logs.server_at END) AS last_set_at
      FROM workout_sessions ws
      JOIN (
        SELECT el.workout_session_id,
               GREATEST(el.logged_at,
                        to_timestamp(max(CASE WHEN sl.set_end_ms BETWEEN 1000000000000 AND 4000000000000 THEN sl.set_end_ms END) / 1000.0)) AS phone_at,
               el.updated_at AS server_at
        FROM exercise_logs el
        LEFT JOIN set_logs sl ON sl.exercise_log_id = el.id AND sl.deleted_at IS NULL
        WHERE el.deleted_at IS NULL
        GROUP BY el.id
      ) logs ON logs.workout_session_id = ws.id
      WHERE ws.user_id = ${userId}
        AND ws.session_id IS NOT NULL
        AND ws.deleted_at IS NULL
        AND ws.completed_at IS NULL
      GROUP BY ws.id, ws.session_id
    ) last_sets
    WHERE last_sets.last_set_at >= ${lastSetSince.toISOString()}::timestamptz
  `)
  return (rows.rows as Array<{ program_session_id: string }>).map(r => r.program_session_id)
}

/**
 * #3900 review (D): on the AI plan a program move must not void the plan of a session that is being
 * trained. Its plan is applied by itself, and the slot voided under it left the bar on the base
 * numbers and the next read re-planning it mid-session. The rows of such sessions are returned so the
 * move spares their plan, as it spares a held one-day deload; the session's next plan, after it is
 * finished, is made in the new phase. Other program kinds void as before.
 */
async function underWaySlots(tx: Tx, userId: string, programId: string, rows: SessionPeriodization[]): Promise<Set<string>> {
  const [program] = await tx.select({ phaseMode: s.programs.phaseMode }).from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
  if (program?.phaseMode !== 'ai_dynamic') return new Set()
  const withPlan = rows.filter(slotHoldsPlan)
  if (withPlan.length === 0) return new Set()
  const underWay = new Set(await listUnfinishedLoggedSessions(tx, userId, sessionUnderWayCutoff()))
  return new Set(withPlan.filter(r => underWay.has(r.programSessionId)).map(r => r.id))
}

/** `phase_started_at` equals a JS Date, at the Date's millisecond precision. A start written by SQL
 *  `now()` (the column default) has microseconds, which a JS Date read back from it has lost, so an
 *  exact comparison with that Date never matches. */
function phaseStartedAtIs(at: Date) {
  return sql`date_trunc('milliseconds', ${s.sessionPeriodization.phaseStartedAt}) = ${at.toISOString()}::timestamptz`
}

/**
 * What a session's plan is made from, as one string: its program's training goal and phase mode
 * (#3927: the plan is written for both, and an editor save can change either alone), its time budget
 * and every live exercise's id, name, catalogue link, style, position, role, superset and muscles. #3895 review: the Coach and
 * the program editor void a stored plan when they change a session, but a generation already running
 * read the session before the change and stored after the void, so its plan drove the changed (or
 * restored) session for up to seven days. A generation reads this at its start and stores only while
 * it is unchanged (`storePrescription`), in the same statement as the store. `updated_at` is left
 * out, so a write that changes nothing the plan reads does not void it.
 */
function sessionStructureSql(programSessionId: string) {
  return sql`(SELECT md5(p.training_goal || '#' || p.phase_mode || '#' || ps.time_budget_minutes::text || '#' || coalesce((
      SELECT string_agg(
        se.id::text || ':' || se.exercise_name || ':' || coalesce(se.exercise_id::text, '') || ':' ||
        coalesce(se.style_id::text, '') || ':' || se.position::text || ':' || se.exercise_role || ':' ||
        coalesce(se.superset_group::text, '') || ':' || array_to_string(se.muscle_groups, ','),
        '|' ORDER BY se.position, se.id)
      FROM session_exercises se WHERE se.session_id = ps.id AND se.deleted_at IS NULL), ''))
    FROM program_sessions ps JOIN programs p ON p.id = ps.program_id WHERE ps.id = ${programSessionId})`
}

/** The session's structure stamp (`sessionStructureSql`), null when the session is not the user's. */
export async function getSessionStructureStamp(db: Db, userId: string, programSessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ stamp: sql<string | null>`${sessionStructureSql(programSessionId)}` })
    .from(s.programSessions)
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(eq(s.programSessions.id, programSessionId), eq(s.programs.userId, userId)))
    .limit(1)
  return row?.stamp ?? null
}

async function programIdOf(db: Db | Tx, programSessionId: string): Promise<string | null> {
  const [own] = await db.select({ programId: s.programSessions.programId }).from(s.programSessions)
    .where(eq(s.programSessions.id, programSessionId)).limit(1)
  return own?.programId ?? null
}

/**
 * The phase a session type takes when its baseline completes (#3766, `joiningPhaseFor`): the
 * program's, so it joins the program where it is. Read under the program's row lock, so two
 * baselines finishing together, or one finishing during a program move, see each other's writes.
 * `sessions_in_phase` starts at 0 and the next reconcile counts it.
 */
async function joiningPhase(tx: Tx, userId: string, programSessionId: string): Promise<{
  phase: PeriodizationPhase; phaseStartedAt: Date; pendingTransition: PendingTransition | null
}> {
  const programId = await programIdOf(tx, programSessionId)
  const siblings = programId
    ? (await lockProgramRows(tx, userId, programId)).filter(r => r.programSessionId !== programSessionId)
    : []
  return joiningPhaseFor(siblings, new Date())
}

export async function setBaselineComplete(db: Db, userId: string, programSessionId: string, baseline1rm: Record<string, Baseline1rmEntry>): Promise<SessionPeriodization> {
  return db.transaction(async tx => {
    const joining = await joiningPhase(tx, userId, programSessionId)
    const [row] = await tx
      .update(s.sessionPeriodization)
      .set({
        baselineComplete: true,
        baseline1rm,
        phase: joining.phase,
        phaseStartedAt: joining.phaseStartedAt,
        pendingTransition: joining.pendingTransition as unknown as Record<string, unknown> | null,
        sessionsInPhase: 0,
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.sessionPeriodization.userId, userId),
        eq(s.sessionPeriodization.programSessionId, programSessionId),
      ))
      .returning()
    return mapPeriodization(row)
  })
}

/**
 * The per-exercise 1RM a completed session already wrote (BF-131).
 *
 * The AMRAP baseline estimator is NOT re-run here. `estimateOneRm` takes an `isBaseline` flag, the
 * workout screen passes it, and the result is already persisted to `exercise_logs.estimated_1rm` —
 * so the anchor exists in the data the moment the session is completed. Computing a fresh one at
 * the periodization layer would be a second implementation of a formula this repo has one of, and
 * it would silently disagree with the personal record the same sets produced.
 *
 * Scoped through `workout_sessions` because `exercise_logs` carries no `user_id` of its own.
 */
export async function getSessionExercise1rms(
  db: Db, userId: string, workoutSessionId: string,
): Promise<{ exerciseName: string; estimated1rm: number }[]> {
  const rows = await db
    .select({ exerciseName: s.exerciseLogs.exerciseName, estimated1rm: s.exerciseLogs.estimated1rm })
    .from(s.exerciseLogs)
    .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
    .where(and(
      eq(s.exerciseLogs.workoutSessionId, workoutSessionId),
      eq(s.workoutSessions.userId, userId),
    ))
  return rows
    .filter((r): r is { exerciseName: string; estimated1rm: number } => r.estimated1rm != null && r.estimated1rm > 0)
    .map(r => ({ exerciseName: r.exerciseName, estimated1rm: r.estimated1rm }))
}

/**
 * Merge measured baseline anchors into `baseline1rm`, completing the phase only when every
 * exercise has one (BF-131).
 *
 * **A partial baseline stays in `baseline` and keeps what it measured.** Completing on three of
 * five exercises would leave two anchors missing from the map the prescription reads, which is the
 * "empty, unusable anchor" the skip-baseline route already refuses to write — and the exercises
 * without one are precisely those a rebuilt program added, where re-measuring is the point.
 * Accumulating instead means a second session finishes what the first started, and the stored map
 * is what lets a screen say *which* exercises are outstanding rather than "Baseline needed" for
 * both none and nearly-all.
 *
 * Merged, never replaced: an exercise anchored by an earlier session keeps its entry when a later
 * one re-logs a different subset.
 */
export async function recordBaselineAnchors(
  db: Db,
  userId: string,
  programSessionId: string,
  anchors: Record<string, Baseline1rmEntry>,
  complete: boolean,
): Promise<SessionPeriodization | null> {
  const [current] = await db.select().from(s.sessionPeriodization).where(and(
    eq(s.sessionPeriodization.userId, userId),
    eq(s.sessionPeriodization.programSessionId, programSessionId),
  )).limit(1)
  // Deliberately redundant with the caller's own `!baselineComplete` check: this one is the
  // invariant (it holds for any future caller), that one avoids a pointless read. Measured — each
  // alone is masked by the other, and removing BOTH is caught.
  if (!current || current.baselineComplete) return current ? mapPeriodization(current) : null

  const merged = { ...((current.baseline1rm ?? {}) as Record<string, Baseline1rmEntry>), ...anchors }
  return db.transaction(async tx => {
    const joining = complete ? await joiningPhase(tx, userId, programSessionId) : null
    const [row] = await tx
      .update(s.sessionPeriodization)
      .set(joining
        ? {
            baseline1rm: merged, baselineComplete: true, phase: joining.phase,
            phaseStartedAt: joining.phaseStartedAt,
            pendingTransition: joining.pendingTransition as unknown as Record<string, unknown> | null,
            sessionsInPhase: 0, updatedAt: new Date(),
          }
        // Still in `baseline`: the phase clock and the session counter are untouched, because the
        // lifter has not left the phase and `sessions_in_phase` is already advanced by the completion.
        : { baseline1rm: merged, updatedAt: new Date() })
      .where(and(
        eq(s.sessionPeriodization.userId, userId),
        eq(s.sessionPeriodization.programSessionId, programSessionId),
      ))
      .returning()
    return row ? mapPeriodization(row) : null
  })
}

/**
 * Move the WHOLE program's phase (#3766): every session type whose baseline is done gets the same
 * phase and the same start, in one transaction, and loses its stored plan so the next open plans it
 * in the new phase. Two plans survive: `voidAll` (none by default) and any slot holding an
 * unexpired one-day deload (#3799), which belongs to that day, not to the phase, and on the AI plan
 * the plan of a session under way (`underWaySlots`, #3900 review D). Every row gets the
 * program's mark (`programMoveMark`), with the scheduled short block when one is given.
 *
 * The rows are read and written under one lock. With `expect`, nothing is written unless the program
 * is still where the caller saw it, and the call resolves false: a second tap, a second generation's
 * auto-apply, or a second switch-over racing the first finds the program already moved and leaves
 * it (and the plans regenerated since) alone.
 */
export async function setProgramPhase(
  db: Db, userId: string, programId: string, phase: PeriodizationPhase, startedAt: Date,
  pendingTransition: PendingTransition | null,
  opts: ProgramMoveOptions = {},
): Promise<boolean> {
  const mark = programMoveMark(phase, pendingTransition)
  return db.transaction(async tx => {
    const rows = await lockProgramRows(tx, userId, programId)
    const phased = rows.filter(r => r.baselineComplete && r.phase !== 'baseline')
    if (phased.length === 0) return false
    const expect = opts.expect
    if (expect === 'switch-over' && phased.some(r => r.pendingTransition?.programPhase === true)) return false
    if (expect != null && expect !== 'switch-over') {
      // Compared in the database, at millisecond precision (`phaseStartedAtIs`).
      const [{ off }] = await tx
        .select({ off: sql<number>`count(*)::int` })
        .from(s.sessionPeriodization)
        .where(and(
          inArray(s.sessionPeriodization.id, phased.map(r => r.id)),
          sql`NOT (${eq(s.sessionPeriodization.phase, expect.phase)} AND ${phaseStartedAtIs(expect.phaseStartedAt)})`,
        ))
      if (off > 0) return false
    }
    const voidAll = new Set(opts.voidAll ?? [])
    const spared = await underWaySlots(tx, userId, programId, phased)
    const toVoid = phased.filter(r => voidAll.has(r.programSessionId) || (!holdsOneDayDeload(r) && !spared.has(r.id))).map(r => r.id)
    const now = new Date()
    await tx.update(s.sessionPeriodization)
      .set({
        phase,
        phaseStartedAt: startedAt,
        sessionsInPhase: 0,
        pendingTransition: mark as unknown as Record<string, unknown>,
        updatedAt: now,
      })
      .where(and(
        eq(s.sessionPeriodization.userId, userId),
        inArray(s.sessionPeriodization.id, phased.map(r => r.id)),
      ))
    if (toVoid.length > 0) await voidPlans(tx, userId, toVoid, now)
    return true
  })
}

/** 'consumed' + no plan is what the open-time trigger regenerates from (as `clearProgramPrescriptions`). */
async function voidPlans(tx: Tx, userId: string, rowIds: string[], now: Date): Promise<void> {
  await tx.update(s.sessionPeriodization)
    .set({ prescription: null, prescriptionStatus: 'consumed', prescriptionGeneratedAt: null, prescriptionExpiresAt: null, updatedAt: now })
    .where(and(eq(s.sessionPeriodization.userId, userId), inArray(s.sessionPeriodization.id, rowIds)))
}

/**
 * Put a program on one phase whose rows have come to disagree after its switch-over (#3766): every
 * phased row takes the target `decide` works out from the LOCKED rows (`realignTargetFor`: the
 * program's latest move), so a move landing after the caller's read is not undone. Only a row that
 * was not already there has its count reset and its plan voided (a held one-day deload excepted);
 * the others keep their plans and just get the mark.
 */
export async function realignProgramPhase(db: Db, userId: string, programId: string, decide: DecideTarget): Promise<void> {
  await db.transaction(async tx => {
    const locked = await lockProgramRows(tx, userId, programId)
    const target = decide(locked)
    if (target == null) return
    const phased = locked.filter(r => r.baselineComplete && r.phase !== 'baseline')
    const behind = phased.filter(r => r.phase !== target.phase || r.phaseStartedAt.getTime() !== target.phaseStartedAt.getTime())
    if (behind.length === 0 && phased.every(r => r.pendingTransition?.programPhase === true)) return
    const now = new Date()
    const pending = target.pendingTransition as unknown as Record<string, unknown>
    if (behind.length > 0) {
      await tx.update(s.sessionPeriodization)
        .set({ phase: target.phase, phaseStartedAt: target.phaseStartedAt, sessionsInPhase: 0, pendingTransition: pending, updatedAt: now })
        .where(and(eq(s.sessionPeriodization.userId, userId), inArray(s.sessionPeriodization.id, behind.map(r => r.id))))
      const spared = await underWaySlots(tx, userId, programId, behind)
      const toVoid = behind.filter(r => !holdsOneDayDeload(r) && !spared.has(r.id)).map(r => r.id)
      if (toVoid.length > 0) await voidPlans(tx, userId, toVoid, now)
    }
    await tx.update(s.sessionPeriodization)
      .set({ pendingTransition: pending, updatedAt: now })
      .where(and(eq(s.sessionPeriodization.userId, userId), inArray(s.sessionPeriodization.id, phased.map(r => r.id))))
  })
}

/** A scheduled move on every phased row of the program, phase, start and plans untouched: the
 *  program's mark on its first read, or the switch-over's waiting stamp and date (#3766). `decide`
 *  works it out from the LOCKED rows, so a switch-over landing after the caller's read is not
 *  overwritten by a waiting stamp; null writes nothing. */
export async function setProgramPendingTransition(db: Db, userId: string, programId: string, decide: DecidePending): Promise<void> {
  await db.transaction(async tx => {
    const locked = await lockProgramRows(tx, userId, programId)
    const phased = locked.filter(r => r.baselineComplete && r.phase !== 'baseline')
    if (phased.length === 0) return
    const pending = decide(locked)
    if (pending == null) return
    await tx.update(s.sessionPeriodization)
      .set({ pendingTransition: pending as unknown as Record<string, unknown>, updatedAt: new Date() })
      .where(and(eq(s.sessionPeriodization.userId, userId), inArray(s.sessionPeriodization.id, phased.map(r => r.id))))
  })
}

/** The program move made from one session type's screen or generation: moves the program that
 *  session belongs to, now, and returns that session's row. With `expected` (the phase and start the
 *  caller planned from), a program that has moved since is left as it is. */
export async function advanceProgramPhase(
  db: Db, userId: string, programSessionId: string, newPhase: PeriodizationPhase,
  expected?: { phase: PeriodizationPhase; phaseStartedAt: Date },
): Promise<SessionPeriodization> {
  const programId = await programIdOf(db, programSessionId)
  if (!programId) throw new NotFoundError('Program session')
  await setProgramPhase(db, userId, programId, newPhase, new Date(), null, { voidAll: [programSessionId], expect: expected })
  const row = await getSessionPeriodization(db, userId, programSessionId)
  if (!row) throw new NotFoundError('Session periodization')
  return row
}

/**
 * Completed sessions of a program since `since`: completed, not deleted, with logged sets (the same
 * test `reconcileSessionsInPhase` uses). Training weeks are counted from these (#3766). Sessions of a
 * tombstoned session type still count: the training happened.
 */
export async function listProgramCompletions(db: Db, userId: string, programId: string, since: Date): Promise<ProgramCompletion[]> {
  const rows = await db.execute(sql`
    SELECT ws.session_id AS program_session_id, ws.completed_at
    FROM workout_sessions ws
    JOIN program_sessions ps ON ps.id = ws.session_id
    WHERE ws.user_id = ${userId}
      AND ps.program_id = ${programId}
      AND ws.deleted_at IS NULL
      AND ws.completed_at IS NOT NULL
      AND ws.completed_at >= ${since.toISOString()}
      AND EXISTS (SELECT 1 FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL)
    ORDER BY ws.completed_at
  `)
  return (rows.rows as Array<{ program_session_id: string; completed_at: Date | string }>).map(r => ({
    programSessionId: r.program_session_id,
    completedAt: new Date(r.completed_at),
  }))
}

/** Every MODEL phase answer of these session types since `since` (`prescription_shadow` keeps the
 *  raw answer before any guard), newest first, for the program's early-move vote (#3766). The vote
 *  picks each type's answer for the session it trained (`collectVotes`). */
export async function listModelPhaseAnswers(db: Db, userId: string, programSessionIds: string[], since: Date): Promise<PhaseAnswer[]> {
  if (programSessionIds.length === 0) return []
  const rows = await db
    .select({
      programSessionId: s.prescriptionShadow.programSessionId,
      phase: s.prescriptionShadow.modelPhase,
      phaseAction: s.prescriptionShadow.modelPhaseAction,
      createdAt: s.prescriptionShadow.createdAt,
    })
    .from(s.prescriptionShadow)
    .where(and(
      eq(s.prescriptionShadow.userId, userId),
      inArray(s.prescriptionShadow.programSessionId, programSessionIds),
      gte(s.prescriptionShadow.createdAt, since),
    ))
    .orderBy(desc(s.prescriptionShadow.createdAt))
  return rows.flatMap(r => (r.programSessionId
    ? [{ programSessionId: r.programSessionId, phase: r.phase, phaseAction: r.phaseAction, createdAt: r.createdAt }]
    : []))
}

/** One session type's own phase move, kept for a program still on per-type phases while it waits
 *  for the switch-over (#3766), and the per-type end of a finished deload (#3876). An aligned program moves through `advanceProgramPhase`. The row keeps
 *  the switch-over's waiting stamp and date (a deload left early must not lose the switch Monday);
 *  any other scheduled move, the program's mark included, is cleared. */
export async function advancePhase(db: Db, userId: string, programSessionId: string, newPhase: PeriodizationPhase): Promise<SessionPeriodization> {
  const [row] = await db
    .update(s.sessionPeriodization)
    .set({
      phase: newPhase,
      phaseStartedAt: new Date(),
      sessionsInPhase: 0,
      pendingTransition: sql`CASE WHEN ${s.sessionPeriodization.pendingTransition} ->> 'switchOverPending' = 'true' THEN ${s.sessionPeriodization.pendingTransition} ELSE NULL END`,
      // #3876: the phase a deload was entered from, so the deload can end by itself back there
      // (`deloadExitPhase`). Kept across a move from deload to deload; cleared by any other move.
      preEmergencyDeloadPhase: newPhase === 'deload'
        ? sql`CASE WHEN ${s.sessionPeriodization.phase} <> 'deload' THEN ${s.sessionPeriodization.phase} ELSE ${s.sessionPeriodization.preEmergencyDeloadPhase} END`
        : null,
      prescription: null,
      prescriptionStatus: 'none',
      prescriptionGeneratedAt: null,
      prescriptionExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
    .returning()
  return mapPeriodization(row)
}

/**
 * #3876: the end of a session type's finished deload, at its next plan (`typeDeloadFinished`). Unlike
 * `advancePhase` it is conditional: it moves the row only while it is still the deload the caller read
 * (`phase = 'deload'` and the same start), so two generations racing for the same slot move it once.
 * The loser writes nothing and resolves false; it re-reads the row and plans in the phase the winner
 * moved it to. Before, both called `advancePhase`: the second restarted the new block, and the first's
 * plan, made for the start it had just written, was refused with PHASE_MOVED.
 *
 * The move and the slot's status are one statement, and the status is `'consumed'` with no plan: the
 * state the open-time trigger regenerates from. A generation that fails after the exit (the model, the
 * store) leaves a slot `workout-data` refills, where `advancePhase`'s `'none'` was read by nothing.
 * The switch-over's waiting stamp and date are kept, as in `advancePhase`; the pre-deload phase is
 * spent, so it is cleared.
 */
export async function exitDeload(
  db: Db, userId: string, programSessionId: string, newPhase: PeriodizationPhase, deloadStartedAt: Date,
): Promise<boolean> {
  const now = new Date()
  const moved = await db
    .update(s.sessionPeriodization)
    .set({
      phase: newPhase,
      phaseStartedAt: now,
      sessionsInPhase: 0,
      pendingTransition: sql`CASE WHEN ${s.sessionPeriodization.pendingTransition} ->> 'switchOverPending' = 'true' THEN ${s.sessionPeriodization.pendingTransition} ELSE NULL END`,
      preEmergencyDeloadPhase: null,
      prescription: null,
      prescriptionStatus: 'consumed',
      prescriptionGeneratedAt: null,
      prescriptionExpiresAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
      eq(s.sessionPeriodization.phase, 'deload'),
      phaseStartedAtIs(deloadStartedAt),
    ))
    .returning({ id: s.sessionPeriodization.id })
  return moved.length > 0
}

// `status` is written in the SAME statement as the prescription, deliberately. It used to be a
// second `updatePrescriptionStatus` call after this one, which opened a window: two concurrent
// generations for the same session (the duration-preset picker and the auto-fire trigger use
// different dedup keys, so neither collapses the other) could interleave as
// A.store → B.store → A.setStatus, leaving the row describing run B's prescription with run A's
// status. One statement makes that unrepresentable — the row is always some single run's content
// AND that same run's status. It does not stop the two runs racing; last writer still wins, which
// is correct and was never the defect (Q-54).
//
// `generatedFor` (#3766): the phase and start the plan was made in. A program move during the
// generation (another session's tap or auto-apply) voids this slot and moves its phase; a plan made
// for the old phase is then not stored, so the slot stays voided and regenerates in the new one.
// `generatedFor.structure` (#3895 review): the session's structure stamp read at the generation's
// start. A Coach change, its undo or an editor save while the plan was being made voids the slot;
// the plan, made for the session as it was, is then not stored either.
export async function storePrescription(
  db: Db, userId: string, programSessionId: string, prescription: AiPrescription, expiresAt: Date,
  status: PrescriptionStatus = 'pending',
  generatedFor?: GeneratedFor,
): Promise<boolean> {
  const stored = await db
    .update(s.sessionPeriodization)
    .set({
      prescription: prescription as unknown as Record<string, unknown>,
      prescriptionGeneratedAt: new Date(),
      prescriptionExpiresAt: expiresAt,
      prescriptionStatus: status,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
      ...(generatedFor
        ? [eq(s.sessionPeriodization.phase, generatedFor.phase), phaseStartedAtIs(generatedFor.phaseStartedAt)]
        : []),
      ...(generatedFor?.structure != null
        ? [sql`${sessionStructureSql(programSessionId)} = ${generatedFor.structure}`]
        : []),
    ))
    .returning({ id: s.sessionPeriodization.id })
  return stored.length > 0
}

// Void the cached AI prescription for every session in a program, WITHOUT resetting
// phase/cycle progress (unlike advancePhase). Used when the program structure is edited
// (roles, exercises, budget) so the pre-edit prescription can't keep driving load until
// its 7-day expiry. Status is set to 'consumed' so the workout-data view's existing
// failed-generation retry ('consumed' + null prescription → fire /prescribe) regenerates
// a fresh, edit-aware prescription the next time each session is opened.
export async function clearProgramPrescriptions(db: Db, userId: string, programId: string): Promise<void> {
  const sessionRows = await db
    .select({ id: s.programSessions.id })
    .from(s.programSessions)
    .where(and(eq(s.programSessions.programId, programId), isNull(s.programSessions.deletedAt)))
  const sessionIds = sessionRows.map(r => r.id)
  if (sessionIds.length === 0) return
  await db
    .update(s.sessionPeriodization)
    .set({
      prescription: null,
      prescriptionStatus: 'consumed',
      prescriptionGeneratedAt: null,
      prescriptionExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      inArray(s.sessionPeriodization.programSessionId, sessionIds),
    ))
}

/** One session's stored plan voided to 'consumed' + no plan, which the open-time trigger regenerates
 *  from (as `clearProgramPrescriptions`, for one session). Phase and counts are untouched. */
export async function voidSessionPrescription(db: Db, userId: string, programSessionId: string): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ prescription: null, prescriptionStatus: 'consumed', prescriptionGeneratedAt: null, prescriptionExpiresAt: null, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

/**
 * #3900 review (H): a plan stored `pending` before #3900, brought under the AI plan's rule where it is
 * served: its status (and, for a one-day deload, its expiry) only, the plan itself untouched. Written
 * only while the slot still holds that same pending plan (status and generation time, at millisecond
 * precision), so a plan stored or answered meanwhile is never overwritten. True when it wrote.
 */
export async function adoptPendingPrescription(
  db: Db, userId: string, programSessionId: string, generatedAt: Date, status: PrescriptionStatus, expiresAt: Date,
): Promise<boolean> {
  const rows = await db
    .update(s.sessionPeriodization)
    .set({ prescriptionStatus: status, prescriptionExpiresAt: expiresAt, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
      eq(s.sessionPeriodization.prescriptionStatus, 'pending'),
      sql`date_trunc('milliseconds', ${s.sessionPeriodization.prescriptionGeneratedAt}) = ${generatedAt.toISOString()}::timestamptz`,
    ))
    .returning({ id: s.sessionPeriodization.id })
  return rows.length > 0
}

export async function updatePrescriptionStatus(db: Db, userId: string, programSessionId: string, status: PrescriptionStatus): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ prescriptionStatus: status, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

// Caches a consumption-day re-evaluated prescription (lib/ai-periodization/reevaluate.ts)
// back onto the state row — only the prescription JSONB itself changes; status/expiry/
// generatedAt are left untouched, unlike storePrescription (which is for a fresh
// generation and would wrongly reset an 'accepted' status back to 'pending').
export async function updatePrescriptionExercisesCache(db: Db, userId: string, programSessionId: string, prescription: AiPrescription): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ prescription: prescription as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

/**
 * #3890: replace the stored plan with `after`, only while it is still exactly `before` (the plan the
 * caller read). Status, expiry and generation time are left as they are. True when it wrote. A plan
 * remade or rewritten meanwhile is left alone.
 */
export async function replacePrescriptionIfUnchanged(db: Db, userId: string, programSessionId: string, before: AiPrescription, after: AiPrescription): Promise<boolean> {
  const rows = await db
    .update(s.sessionPeriodization)
    .set({ prescription: after as unknown as Record<string, unknown>, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
      sql`${s.sessionPeriodization.prescription} = ${JSON.stringify(before)}::jsonb`,
    ))
    .returning({ id: s.sessionPeriodization.id })
  return rows.length === 1
}

export async function storePendingTransition(db: Db, userId: string, programSessionId: string, transition: PendingTransition | null): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ pendingTransition: transition as unknown as Record<string, unknown> | null, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

// `completedAt` is the session's own completion time. A session counts toward the phase it was
// COMPLETED in (the canonical definition above `reconcileSessionsInPhase`), so a completion stamped before the phase moved (an offline
// finish synced after a later phase change) is not counted in the new phase.
export async function incrementSessionsInPhase(db: Db, userId: string, programSessionId: string, completedAt?: Date): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({
      sessionsInPhase: sql`${s.sessionPeriodization.sessionsInPhase} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
      ...(completedAt ? [lte(s.sessionPeriodization.phaseStartedAt, completedAt)] : []),
    ))
}

/**
 * The decrement for a deleted workout, shared by both delete flows (`lib/workout/delete-session.ts`
 * and the workout-entry delete in `lib/workout/exercise-log-edits.ts`). `$3` is the deleted
 * session's `completed_at`; the callers run it only for a completed session. Floor at 0.
 */
export const DECREMENT_SESSIONS_IN_PHASE_SQL =
  `UPDATE session_periodization
   SET sessions_in_phase = GREATEST(sessions_in_phase - 1, 0), updated_at = now()
   WHERE user_id = $1 AND program_session_id = $2 AND $3 >= phase_started_at`

// Recompute every session's `sessions_in_phase` for a program from the actual
// (non-empty) workout_sessions logged since each session's phase started. The stored
// counter is only ever incremented (on complete-workout) and decremented (on the app's
// delete flow), so directly-inserted or directly-deleted test rows can leave it stale.
// Deriving from real sessions makes the count self-healing. Only writes rows that drift.
// Canonical definition of "a session in the current phase": non-deleted, with
// logged sets, and COMPLETED at or after phase_started_at. Applied here, in the increment above
// (complete-workout.ts passes the completion time) and in `DECREMENT_SESSIONS_IN_PHASE_SQL` (both
// delete flows) — one definition, checked in three places (AI-5). It read `started_at` until #3799:
// a session started before the phase moved and finished after it ran in the new phase and was not
// counted, so a deload block ran three sessions instead of two.
export async function reconcileSessionsInPhase(db: Db, userId: string, programId: string): Promise<void> {
  await db.execute(sql`
    UPDATE session_periodization sp
    SET sessions_in_phase = sub.cnt, updated_at = NOW()
    FROM (
      SELECT sp2.id AS id,
             COUNT(ws.id)::int AS cnt
      FROM session_periodization sp2
      JOIN program_sessions ps ON ps.id = sp2.program_session_id
      LEFT JOIN workout_sessions ws
        ON ws.session_id = sp2.program_session_id
       AND ws.user_id = sp2.user_id
       AND ws.completed_at >= sp2.phase_started_at
       AND ws.deleted_at IS NULL
       AND ws.completed_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM exercise_logs el WHERE el.workout_session_id = ws.id AND el.deleted_at IS NULL)
      WHERE sp2.user_id = ${userId} AND ps.program_id = ${programId} AND ps.deleted_at IS NULL
      GROUP BY sp2.id
    ) sub
    WHERE sp.id = sub.id AND sp.sessions_in_phase <> sub.cnt
  `)
}

export async function setLastSessionRanPrescription(db: Db, userId: string, programSessionId: string, ranPrescription: boolean): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ lastSessionRanPrescription: ranPrescription, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

export async function listSessionPeriodizationForProgram(db: Db, userId: string, programId: string): Promise<SessionPeriodization[]> {
  const rows = await db
    .select({ sp: s.sessionPeriodization })
    .from(s.sessionPeriodization)
    .innerJoin(
      s.programSessions,
      eq(s.sessionPeriodization.programSessionId, s.programSessions.id),
    )
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.programSessions.programId, programId),
      // LB-66: a tombstoned session keeps its periodization row (the ON DELETE CASCADE that used
      // to destroy it no longer fires), so the filter has to be here rather than implied.
      isNull(s.programSessions.deletedAt),
    ))
  return rows.map(r => mapPeriodization(r.sp))
}

// ── Volume Targets ─────────────────────────────────────────────────────────────

export async function listVolumeTargets(db: Db, userId: string, programId: string): Promise<ProgramVolumeTarget[]> {
  return db
    .select({
      id: s.programVolumeTargets.id,
      programId: s.programVolumeTargets.programId,
      muscleGroup: s.programVolumeTargets.muscleGroup,
      targetSetsPerWeek: s.programVolumeTargets.targetSetsPerWeek,
    })
    .from(s.programVolumeTargets)
    .innerJoin(s.programs, eq(s.programs.id, s.programVolumeTargets.programId))
    .where(and(
      eq(s.programVolumeTargets.programId, programId),
      eq(s.programs.userId, userId),
    ))
    .orderBy(asc(s.programVolumeTargets.muscleGroup))
}

export async function replaceVolumeTargets(db: Db, userId: string, programId: string, targets: { muscleGroup: string; targetSetsPerWeek: number }[]): Promise<void> {
  await db.transaction(async tx => {
    // program_volume_targets has no user_id column, so this DELETE can only be scoped by first
    // proving the program belongs to the caller. Without it the statement is
    // `DELETE ... WHERE program_id = $1` against a client-supplied id — the same
    // delete-and-reinsert-by-parent-id shape that wiped rows in the saveProgressionStyle incident
    // (Q-174). The row-count guard is the check, exactly as saveProgram and saveProgressionStyle do.
    const owned = await tx.select({ id: s.programs.id }).from(s.programs)
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
      .limit(1)
    if (owned.length === 0) throw new NotFoundError('Program')

    await tx.delete(s.programVolumeTargets).where(eq(s.programVolumeTargets.programId, programId))
    if (targets.length > 0) {
      await tx.insert(s.programVolumeTargets).values(targets.map(t => ({ programId, ...t })))
    }
  })
}

// ── Session / Set Queries (AI context) ────────────────────────────────────────

export async function getWorkoutSessionProgramSessionId(db: Db, userId: string, workoutSessionId: string): Promise<string | null> {
  const [row] = await db
    .select({ programSessionId: s.workoutSessions.programSessionId })
    .from(s.workoutSessions)
    .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId), isNull(s.workoutSessions.deletedAt)))
    .limit(1)
  return row?.programSessionId ?? null
}

/**
 * BF-144: has THIS program session been trained since `since`?
 *
 * Resolved through `workout_sessions.session_id` — the live FK to `program_sessions` — rather than
 * by matching exercise names, which is what BF-143's guard did. A name lookup is right only while
 * names stay unique and unchanged: rename a session, or add a second one sharing a name, and the
 * question gets answered about the wrong workouts. An id cannot be confused that way.
 *
 * The caller keeps its own date comparison as the companion test, because rows predating the link
 * carry no `session_id` and so cannot answer for themselves.
 */
export async function wasProgramSessionTrainedSince(
  db: Db, userId: string, programSessionId: string, since: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: s.exerciseLogs.id })
    .from(s.exerciseLogs)
    .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.programSessionId, programSessionId),
      isNull(s.workoutSessions.deletedAt),
      isNull(s.exerciseLogs.deletedAt),
      gte(s.exerciseLogs.loggedAt, since),
    ))
    .limit(1)
  return row != null
}

export async function getRecentSessionsOfType(db: Db, userId: string, programSessionId: string, limit: number): Promise<Array<{
  id: string; startedAt: Date; completedAt: Date | null; sessionName: string; pausedSec: number | null
}>> {
  return db
    .select({
      id: s.workoutSessions.id,
      startedAt: s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
      sessionName: s.workoutSessions.sessionName,
      pausedSec: s.workoutSessions.pausedSec,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.programSessionId, programSessionId),
      isNull(s.workoutSessions.deletedAt),
    ))
    .orderBy(desc(s.workoutSessions.startedAt))
    .limit(limit)
}

export async function getSetLogsForSessions(db: Db, workoutSessionIds: string[]): Promise<Array<{
  workoutSessionId: string; exerciseName: string; setNumber: number;
  rpe: number | null; reps: number; intensityPct: number | null; setTimeSec: number | null
  rpeSource: import('@trainingai/shared/workout/rpe-source').RpeSource | null
  plannedReps: number | null
}>> {
  if (workoutSessionIds.length === 0) return []
  return db
    .select({
      workoutSessionId: s.exerciseLogs.workoutSessionId,
      exerciseName: s.exerciseLogs.exerciseName,
      setNumber: s.setLogs.setNumber,
      rpe: s.setLogs.rpe,
      rpeSource: s.setLogs.rpeSource,
      reps: s.setLogs.reps,
      intensityPct: s.setLogs.intensityPct,
      setTimeSec: s.setLogs.setTimeSec,
      plannedReps: s.setLogs.plannedReps,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .where(and(inArray(s.exerciseLogs.workoutSessionId, workoutSessionIds), isNull(s.setLogs.deletedAt), isNull(s.exerciseLogs.deletedAt)))
}

/**
 * #4061: for each lift (keyed by the name passed), the "How did it feel?" answer on its latest log
 * among these workout sessions: the newest session, then the newest log in it. A log belongs to a
 * lift by the `exercise_preferences` rule: the library id of the lift's name first; by name only when
 * the log carries no id, or the same one (a log renamed away to another library lift is not this one).
 * Owner-scoped through `workout_sessions.user_id`; deleted rows are skipped. A lift with no log is absent.
 */
export async function getLatestExerciseEfforts(
  db: Db, userId: string, workoutSessionIds: string[], exerciseNames: string[],
): Promise<Map<string, { vsPlan: number | null; source: string | null }>> {
  const out = new Map<string, { vsPlan: number | null; source: string | null }>()
  if (workoutSessionIds.length === 0 || exerciseNames.length === 0) return out
  const list = (xs: string[]) => sql`${sql.raw('ARRAY[')}${sql.join(xs.map(x => sql`${x}`), sql`, `)}${sql.raw(']::text[]')}`
  // Cast the parameter array, not the column, so `workout_session_id`'s index stays usable.
  const uuidList = (xs: string[]) => sql`${sql.raw('ARRAY[')}${sql.join(xs.map(x => sql`${x}`), sql`, `)}${sql.raw(']::uuid[]')}`
  const res = await db.execute(sql`
    WITH lifts AS (
      SELECT n.name AS lift, l.id AS lib_id
      FROM unnest(${list(exerciseNames)}) AS n(name)
      LEFT JOIN exercise_library l ON l.name = n.name -- unique
    )
    SELECT DISTINCT ON (lifts.lift) lifts.lift, el.effort_vs_plan, el.effort_source
      FROM lifts
      JOIN exercise_logs el
        ON el.deleted_at IS NULL
       AND el.workout_session_id = ANY(${uuidList(workoutSessionIds)})
       AND (
         (lifts.lib_id IS NOT NULL AND el.exercise_id = lifts.lib_id)
         OR (el.exercise_name = lifts.lift AND (el.exercise_id IS NULL OR lifts.lib_id IS NULL OR el.exercise_id = lifts.lib_id))
       )
      JOIN workout_sessions ws ON ws.id = el.workout_session_id AND ws.user_id = ${userId} AND ws.deleted_at IS NULL
     ORDER BY lifts.lift, ws.started_at DESC, el.logged_at DESC, el.id DESC
  `)
  for (const r of res.rows as Array<{ lift: string; effort_vs_plan: number | null; effort_source: string | null }>) {
    out.set(r.lift, { vsPlan: r.effort_vs_plan == null ? null : Number(r.effort_vs_plan), source: r.effort_source })
  }
  return out
}

export async function getSetTimingRows(db: Db, userId: string, exerciseNames: string[]): Promise<TimingRow[]> {
  if (exerciseNames.length === 0) return []
  const [userRow] = await db.select({ timingBaselineDate: s.users.timingBaselineDate }).from(s.users).where(eq(s.users.id, userId)).limit(1)
  const conditions = [
    eq(s.workoutSessions.userId, userId),
    inArray(s.exerciseLogs.exerciseName, exerciseNames),
    isNull(s.setLogs.deletedAt),
    isNull(s.exerciseLogs.deletedAt),
    isNull(s.workoutSessions.deletedAt),
  ]
  if (userRow?.timingBaselineDate) conditions.push(gte(s.workoutSessions.startedAt, dateStrMidnightInTz(userRow.timingBaselineDate)))
  return db
    .select({
      exerciseName: s.exerciseLogs.exerciseName,
      reps: s.setLogs.reps,
      setTimeSec: s.setLogs.setTimeSec,
      restTimeSec: s.setLogs.restTimeSec,
      intensityPct: s.setLogs.intensityPct,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
    .where(and(...conditions))
}

/**
 * The one test for "this workout was a baseline session" in SQL, written against the
 * `workout_sessions ws` alias (#2297, #2460). A baseline session is the first run of each session
 * after a program is built: one unprescribed set per exercise, so its estimate goes through the
 * AMRAP scaling instead of being divided back up by a prescribed %1RM. TN-75 (#1957) has tagged it
 * `phase_type = 'baseline'` since 2026-09-29.
 *
 * `IS NOT DISTINCT FROM`, so a NULL tag is NOT baseline. Every row before TN-75 is NULL, and an
 * untagged row is unknown rather than known-baseline: it keeps being read as it always was until a
 * backfill tags it (`scripts/backfill-baseline-phase-tag.mjs`).
 */
export const wsIsBaselineSession = sql`ws.phase_type IS NOT DISTINCT FROM 'baseline'`

/**
 * A deload session, by any of the three markers a deload leaves (the same set `isReadableLog` in
 * `session-read.ts` uses): the phase tag, the early-deload flag, the intensity mode.
 *
 * Null-safe on purpose (#3891): `ws.phase_type <> 'deload'` is NULL, not true, for the untagged
 * rows that predate the phase tag, and a WHERE clause drops a NULL. A null phase type is unknown,
 * not a deload, so it stays in. Write the exclusion as `NOT ${wsIsDeloadSession}`.
 */
export const wsIsDeloadSession = sql`(ws.phase_type IS NOT DISTINCT FROM 'deload' OR ws.is_early_deload OR ws.intensity_mode IS NOT DISTINCT FROM 'deload')`

/**
 * 90-day estimated-1RM history per exercise, one point per session-day. It feeds the
 * strength-projection plateau detector (`signals.ts`) and, since LA-96, `/api/strength-trend`,
 * which used to carry a byte-identical copy of this query.
 *
 * **Baseline sessions are left out (#2460, owner decision 2026-10-07).** A baseline estimate is
 * AMRAP-scaled from one unprescribed set, while every other point is a prescribed set divided by
 * its own %1RM. On the owner's bench the 09-07 → 09-12 baseline read 82.75 between prescribed
 * 103.75 and 91.25: a dip that the % change, the 30-day projection, the 90-day low and the plateau
 * check all took as real. A day whose only points are baseline has no point at all — a gap, never a
 * zero. An untagged (NULL) session is still included; see `wsIsBaselineSession`.
 *
 * `windowDays` defaults to the card's 90; the coach's plateau report asks for 180 so it reads these
 * same points (issue 2648).
 *
 * `getLastRealOneRmBatch` keeps reading baseline estimates on purpose: it is the working basis the
 * bar loads from, and straight after a rebuild the baseline is the only basis there is.
 */
export async function getExercise1rmHistory(db: Db, userId: string, exerciseNames: string[], tz: string, windowDays = 90): Promise<Record<string, { date: string; rm: number }[]>> {
  if (exerciseNames.length === 0) return {}
  type RawRow = { exercise_name: string; session_date: string; rm: number }
  const result = await db.execute<RawRow>(sql`
    SELECT
      el.exercise_name,
      to_char((ws.started_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS session_date,
      MAX(el.estimated_1rm)::double precision AS rm
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    WHERE ws.user_id = ${userId}::uuid
      AND el.exercise_name IN (${sql.join(exerciseNames.map(n => sql`${n}`), sql`, `)})
      AND el.estimated_1rm IS NOT NULL
      AND el.estimated_1rm > 0
      -- #3878: the record path's plausibility gate (oneRmImplausible), so a stored estimate the log
      -- path refused as a record is not a point of the 1RM trend either. NaN and Infinity fail <=
      -- here as they fail the function, which the rows are checked with again below.
      AND el.estimated_1rm <= ${MAX_PLAUSIBLE_ONE_RM_KG}
      -- Mirrors getLastRealOneRmBatch's two-marker gate (LA-96). The estimated_1rm > 0
      -- predicate alone trusts the write-time invariant that a deload always stores 0, and
      -- that invariant has been violated in production in both directions.
      AND el.exercise_deloaded = false
      AND NOT (${wsIsBaselineSession})
      AND ws.started_at >= NOW() - make_interval(days => ${windowDays}::int)
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY el.exercise_name, session_date
    ORDER BY el.exercise_name, session_date
  `)
  const byExercise: Record<string, { date: string; rm: number }[]> = {}
  for (const row of result.rows) {
    const arr = byExercise[row.exercise_name] ?? []
    const rm = Number(row.rm)
    if (oneRmImplausible(rm)) continue
    arr.push({ date: row.session_date, rm })
    byExercise[row.exercise_name] = arr
  }
  return byExercise
}

/** One row of the shared attribution query: a canonical muscle, its week when bucketed, and the measure. */
interface MuscleAttributionRow { muscle: string; weekStart: string | null; value: number }

/**
 * LA-118 — the ONE muscle-attribution query. Every per-muscle read of logged sets goes through this.
 *
 * It was written out four times before this existed and the copies disagreed. Not on the weighting:
 * the 1.0 main / 0.5 secondary split was identical everywhere and every copy's comment said so.
 * They disagreed on **which timestamp a set is attributed to** and **whether a previous programme
 * counts** — and no comment mentioned either, which is why the divergence survived being described
 * four times over. Both are parameters here, so a caller now has to state its answer.
 *
 * **The two branches are not a fallback for missing data.** They read different columns:
 * `exercise_library.muscles` carries a role per muscle, `exercise_logs.muscle_groups` is a bare
 * text array. An exercise absent from the library has no role to weight by, so each tagged muscle
 * counts whole — the behaviour every copy already had, preserved deliberately rather than
 * normalised away.
 *
 * #2420 folded in the fifth reader, `/api/muscle-tonnage-trend`, which shares the attribution and
 * differs in two things — both parameters here rather than a second copy:
 *
 * - `measure`: `'sets'` counts a set (role-weighted), `'tonnage'` sums `weight_kg * reps` under the
 *   same role weight. A zero-load (bodyweight) set still yields a row, at 0 kg, so its muscle stays
 *   on the trend as a flat line rather than vanishing.
 * - `weekAnchor`: groups by 7-day week in SQL, anchored on a LOCAL date, placing each set by the
 *   local calendar date of its timestamp in `tz`.
 *
 * **The window is a local-calendar-day comparison, not an instant range**, and so is the bucket —
 * one `localDay` expression for both. For the set counts the two forms select the same rows and
 * the sums are exact (`1.0`/`0.5` numerics, `COUNT`), so their answer is unchanged. Tonnage is a
 * `float8` SUM, whose last digit depends on the order the plan feeds it rows: with an instant range
 * the trend's fixture came back `795.0999999999999` where the route had answered `795.1`. Keeping
 * the route's own predicate, join order and in-SQL weekly grouping is what keeps its JSON
 * byte-identical (#2420's characterization test). Summing per day and adding days in JS would
 * re-round the same way.
 *
 * Rows come back library branch first, then free-text, each muscle already normalised. A caller
 * that sums them in that order reproduces what the copies did.
 */
async function muscleAttributionRows(db: Db, opts: {
  userId: string
  /** First local calendar day of the span, `YYYY-MM-DD`, inclusive. */
  from: string
  /**
   * Last local calendar day, INCLUSIVE. Every caller has an upper bound — the absence of one is the
   * LA-118 defect.
   */
  to: string
  /** The zone whose calendar days `from`, `to` and the week buckets are. */
  tz: string
  /**
   * Which timestamp attributes a set to a day.
   *
   * `logged_at` is the set's own — a session started before midnight whose later exercises were
   * logged after it contributes to both days, which is what a per-day card means. `started_at` is
   * the session's, and is right only when the unit being measured is a programme session.
   */
  dateColumn: 'logged_at' | 'started_at'
  /** Scope to one programme's sessions. Omit to count across programme changes. */
  programId?: string
  measure: 'sets' | 'tonnage'
  /** Group into 7-day weeks starting on this local date. Omit for one total per muscle. */
  weekAnchor?: string
}): Promise<MuscleAttributionRow[]> {
  const dateExpr = opts.dateColumn === 'logged_at' ? sql`el.logged_at` : sql`ws.started_at`
  // The set's LOCAL calendar day. The window and the week bucket both read this one expression, so
  // a row can never be inside the window yet outside every bucket.
  const localDay = sql`to_char((${dateExpr} AT TIME ZONE ${opts.tz}), 'YYYY-MM-DD')`
  const programFilter = opts.programId
    ? sql`AND ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ${opts.programId})`
    : sql``
  const anchor = opts.weekAnchor
  const weekCol = anchor
    ? sql`, to_char(${anchor}::date + ((${localDay}::date - ${anchor}::date) / 7) * 7, 'YYYY-MM-DD') AS week_start`
    : sql``
  const groupBy = anchor ? sql`GROUP BY 1, 2` : sql`GROUP BY 1`
  const roleWeight = sql`CASE WHEN muscle_entry->>'role' = 'main' THEN 1.0 ELSE 0.5 END`
  const libValue = opts.measure === 'tonnage'
    ? sql`SUM((sl.weight_kg * sl.reps) * ${roleWeight})::float`
    : sql`SUM(${roleWeight})`
  const nonLibValue = opts.measure === 'tonnage'
    ? sql`SUM(sl.weight_kg * sl.reps)::float`
    : sql`COUNT(*)::float`

  const libRows = await db.execute(sql`
    SELECT
      LOWER(muscle_entry->>'muscle') AS muscle_group
      ${weekCol},
      ${libValue} AS value
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL jsonb_array_elements(
      (SELECT muscles FROM exercise_library WHERE name = el.exercise_name)
    ) AS muscle_entry
    WHERE ws.user_id = ${opts.userId}
      AND ${localDay} >= ${opts.from}
      AND ${localDay} < ${shiftDateStr(opts.to, 1)}
      ${programFilter}
      AND EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND sl.deleted_at IS NULL AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    ${groupBy}
  `)

  const nonLibRows = await db.execute(sql`
    SELECT
      LOWER(mg) AS muscle_group
      ${weekCol},
      ${nonLibValue} AS value
    FROM exercise_logs el
    JOIN workout_sessions ws ON ws.id = el.workout_session_id
    JOIN set_logs sl ON sl.exercise_log_id = el.id
    CROSS JOIN LATERAL UNNEST(el.muscle_groups) AS mg
    WHERE ws.user_id = ${opts.userId}
      AND ${localDay} >= ${opts.from}
      AND ${localDay} < ${shiftDateStr(opts.to, 1)}
      ${programFilter}
      AND NOT EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND sl.deleted_at IS NULL AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    ${groupBy}
  `)

  // Canonical keys, matching what computeDefaultVolumeTargets writes into program_volume_targets.
  // The exercise library ships both spellings of several muscles ("core" in 14 seeded rows,
  // "quadriceps", "pecs", …), so returning raw labels split one muscle across two keys and no
  // caller could line logged sets up against its own target.
  type Raw = { muscle_group: string | null; week_start?: string; value: string | number }
  const out: MuscleAttributionRow[] = []
  for (const row of [...libRows.rows, ...nonLibRows.rows] as Raw[]) {
    if (!row.muscle_group) continue
    out.push({ muscle: normalizeMuscle(row.muscle_group), weekStart: row.week_start ?? null, value: Number(row.value) })
  }
  return out
}

/** Weighted sets per canonical muscle: `muscleAttributionRows` summed over the whole span. */
async function weightedSetsByMuscle(db: Db, opts: {
  userId: string
  from: string
  to: string
  tz: string
  dateColumn: 'logged_at' | 'started_at'
  programId?: string
}): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const row of await muscleAttributionRows(db, { ...opts, measure: 'sets' })) {
    result[row.muscle] = (result[row.muscle] ?? 0) + row.value
  }
  return result
}

/**
 * Weighted sets per muscle for ONE programme over a span.
 *
 * Keyed on `ws.started_at` rather than `el.logged_at`, and that stays as it is: its unit is a
 * programme session, and its caller — `signals.ts` — grades a week against that programme's own
 * targets. (It had a second caller, `/api/ai-periodization/weekly-volume`, until LB-137 retired
 * that route: nothing had read it since RV-120 deleted the card it served.) Changing the date column here
 * would move numbers they already compare against, which is a behaviour change dressed as a
 * refactor. For a span that should cross programme changes, use `getSetsByMuscleInWindow`.
 */
export async function getWeeklySetsByMuscleGroup(db: Db, userId: string, programId: string, weekStart: string, weekEnd: string, tz: string): Promise<Record<string, number>> {
  // User-local calendar days (Date Arithmetic rule), never a bare ::date cast, which compares
  // against UTC midnight and can straddle two user-local weeks.
  return weightedSetsByMuscle(db, { userId, from: weekStart, to: weekEnd, tz, dateColumn: 'started_at', programId })
}

/**
 * LB-111 — weighted sets per muscle over an ARBITRARY span, across every programme.
 *
 * `getWeeklySetsByMuscleGroup` above cannot serve this, and the difference is not the date range:
 * it scopes to **one** `programId`, so a 60-day window spanning a programme change would silently
 * drop the sets logged under the previous one. That is the right answer for its two callers and the
 * wrong answer for a movement-balance card, whose claim is about the lifter's training rather than
 * one programme's adherence.
 *
 * `to` is INCLUSIVE — the caller names two calendar days and means both of them.
 */
export async function getSetsByMuscleInWindow(
  db: Db, userId: string, from: string, to: string, tz: string,
): Promise<Record<string, number>> {
  return weightedSetsByMuscle(db, { userId, from, to, tz, dateColumn: 'logged_at' })
}

/**
 * #2420 — tonnage per canonical muscle per week, for `/api/muscle-tonnage-trend`.
 *
 * Rows, not totals: the caller lays them onto its own week axis, summing rows that share a muscle
 * after normalisation. Weeks are 7-day buckets anchored on `from`, and a set lands in the bucket of
 * its own LOCAL `logged_at` date in `tz` — the attribution `getSetsByMuscleInWindow` uses, so a
 * session started at 22:00 Sunday whose sets were logged after midnight counts toward the new
 * week. `to` is INCLUSIVE.
 */
export async function getMuscleTonnageByWeek(
  db: Db, userId: string, from: string, to: string, tz: string,
): Promise<{ muscle: string; weekStart: string; tonnageKg: number }[]> {
  const rows = await muscleAttributionRows(db, {
    userId, from, to, tz, dateColumn: 'logged_at', measure: 'tonnage', weekAnchor: from,
  })
  return rows.map(r => ({ muscle: r.muscle, weekStart: r.weekStart as string, tonnageKg: r.value }))
}

/**
 * Undo a baseline the auto-adopt path completed on borrowed personal records (BF-143).
 *
 * `source: 'personal_record'` is written in exactly one place — the auto-heal block in
 * `app/api/ai-periodization/session/[sessionId]/route.ts` — so a row whose every anchor carries it
 * was completed by that path and by nothing else. An AMRAP writes `'amrap'` and the prior-data
 * choice writes `'existing'`; neither is touched here.
 *
 * **Why this is a revert and not a repair-in-place.** The adopted numbers cannot be salvaged: one
 * of them was a bodyweight 1RM index stored under a key named `kg`, and a baseline is the
 * denominator every prescription percentage multiplies. Clearing it puts the session back where
 * the owner's rule says a never-trained session belongs — measuring, not prescribing.
 *
 * Returns null when nothing matched, so the caller can tell a revert from a no-op.
 */
export async function revertAutoAdoptedBaseline(
  db: Db,
  userId: string,
  programSessionId: string,
): Promise<SessionPeriodization | null> {
  const [current] = await db.select().from(s.sessionPeriodization).where(and(
    eq(s.sessionPeriodization.userId, userId),
    eq(s.sessionPeriodization.programSessionId, programSessionId),
  )).limit(1)
  if (!current || !current.baselineComplete) return null

  const anchors = Object.values((current.baseline1rm ?? {}) as Record<string, Baseline1rmEntry>)
  // An empty map is not evidence of the auto-adopt path, so it is left alone rather than reverted.
  if (anchors.length === 0 || !anchors.every(a => a.source === 'personal_record')) return null

  const [row] = await db
    .update(s.sessionPeriodization)
    .set({
      phase: 'baseline', phaseStartedAt: new Date(), baselineComplete: false,
      baseline1rm: {}, sessionsInPhase: 0,
      // A prescription generated off the adopted anchors is derived from them and outlives them by
      // up to 7 days, so it goes with them.
      prescription: null, prescriptionStatus: 'none',
      prescriptionGeneratedAt: null, prescriptionExpiresAt: null, pendingTransition: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
    .returning()
  return row ? mapPeriodization(row) : null
}
