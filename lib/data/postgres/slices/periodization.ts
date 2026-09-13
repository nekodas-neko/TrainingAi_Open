import { eq, and, inArray, asc, desc, sql, isNull, gte } from 'drizzle-orm'
import { NotFoundError } from '@trainingai/shared/errors'
import type { getDb } from '../client'
import * as s from '../schema'
import { shiftDateStr, dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import type { TimingRow } from '@trainingai/shared/workout/time-profile'
import type {
  SessionPeriodization, PeriodizationPhase, AiPrescription,
  Baseline1rmEntry, PendingTransition, PrescriptionStatus, ProgramVolumeTarget,
} from '@trainingai/shared/types/ai-periodization'

type Db = ReturnType<typeof getDb>

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
    .select()
    .from(s.sessionPeriodization)
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
    .limit(1)
  return row ? mapPeriodization(row) : null
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

export async function setBaselineComplete(db: Db, userId: string, programSessionId: string, baseline1rm: Record<string, Baseline1rmEntry>): Promise<SessionPeriodization> {
  const [row] = await db
    .update(s.sessionPeriodization)
    .set({
      baselineComplete: true,
      baseline1rm,
      phase: 'accumulation',
      phaseStartedAt: new Date(),
      sessionsInPhase: 0,
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
  const [row] = await db
    .update(s.sessionPeriodization)
    .set(complete
      ? {
          baseline1rm: merged, baselineComplete: true, phase: 'accumulation',
          phaseStartedAt: new Date(), sessionsInPhase: 0, updatedAt: new Date(),
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
}

export async function advancePhase(db: Db, userId: string, programSessionId: string, newPhase: PeriodizationPhase): Promise<SessionPeriodization> {
  const [row] = await db
    .update(s.sessionPeriodization)
    .set({
      phase: newPhase,
      phaseStartedAt: new Date(),
      sessionsInPhase: 0,
      pendingTransition: null,
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

// `status` is written in the SAME statement as the prescription, deliberately. It used to be a
// second `updatePrescriptionStatus` call after this one, which opened a window: two concurrent
// generations for the same session (the duration-preset picker and the auto-fire trigger use
// different dedup keys, so neither collapses the other) could interleave as
// A.store → B.store → A.setStatus, leaving the row describing run B's prescription with run A's
// status. One statement makes that unrepresentable — the row is always some single run's content
// AND that same run's status. It does not stop the two runs racing; last writer still wins, which
// is correct and was never the defect (Q-54).
export async function storePrescription(db: Db, userId: string, programSessionId: string, prescription: AiPrescription, expiresAt: Date, status: PrescriptionStatus = 'pending'): Promise<void> {
  await db
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
    ))
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

export async function storePendingTransition(db: Db, userId: string, programSessionId: string, transition: PendingTransition | null): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({ pendingTransition: transition as unknown as Record<string, unknown> | null, updatedAt: new Date() })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

export async function incrementSessionsInPhase(db: Db, userId: string, programSessionId: string): Promise<void> {
  await db
    .update(s.sessionPeriodization)
    .set({
      sessionsInPhase: sql`${s.sessionPeriodization.sessionsInPhase} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(s.sessionPeriodization.userId, userId),
      eq(s.sessionPeriodization.programSessionId, programSessionId),
    ))
}

// Recompute every session's `sessions_in_phase` for a program from the actual
// (non-empty) workout_sessions logged since each session's phase started. The stored
// counter is only ever incremented (on complete-workout) and decremented (on the app's
// delete flow), so directly-inserted or directly-deleted test rows can leave it stale.
// Deriving from real sessions makes the count self-healing. Only writes rows that drift.
// Canonical definition of "a session in the current phase": completed (completed_at IS NOT
// NULL), non-deleted, since phase_started_at. Applied here and at both decrement sites
// (delete-session.ts, workout-entry route) and the increment site (complete-workout.ts) —
// one definition, checked in three places (AI-5).
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
       AND ws.started_at >= sp2.phase_started_at
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
  id: string; startedAt: Date; completedAt: Date | null; sessionName: string
}>> {
  return db
    .select({
      id: s.workoutSessions.id,
      startedAt: s.workoutSessions.startedAt,
      completedAt: s.workoutSessions.completedAt,
      sessionName: s.workoutSessions.sessionName,
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
}>> {
  if (workoutSessionIds.length === 0) return []
  return db
    .select({
      workoutSessionId: s.exerciseLogs.workoutSessionId,
      exerciseName: s.exerciseLogs.exerciseName,
      setNumber: s.setLogs.setNumber,
      rpe: s.setLogs.rpe,
      reps: s.setLogs.reps,
      intensityPct: s.setLogs.intensityPct,
      setTimeSec: s.setLogs.setTimeSec,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .where(and(inArray(s.exerciseLogs.workoutSessionId, workoutSessionIds), isNull(s.setLogs.deletedAt), isNull(s.exerciseLogs.deletedAt)))
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

// 90-day estimated-1RM history per exercise, one point per session-day — feeds the
// strength-projection plateau detector and, since LA-96, /api/strength-trend, which used to
// carry a byte-identical copy of this query.
export async function getExercise1rmHistory(db: Db, userId: string, exerciseNames: string[], tz: string): Promise<Record<string, { date: string; rm: number }[]>> {
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
      -- Mirrors getLastRealOneRmBatch's two-marker gate (LA-96). The estimated_1rm > 0
      -- predicate alone trusts the write-time invariant that a deload always stores 0, and
      -- that invariant has been violated in production in both directions.
      AND el.exercise_deloaded = false
      AND ws.started_at >= NOW() - INTERVAL '90 days'
      AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY el.exercise_name, session_date
    ORDER BY el.exercise_name, session_date
  `)
  const byExercise: Record<string, { date: string; rm: number }[]> = {}
  for (const row of result.rows) {
    const arr = byExercise[row.exercise_name] ?? []
    arr.push({ date: row.session_date, rm: Number(row.rm) })
    byExercise[row.exercise_name] = arr
  }
  return byExercise
}

export async function getWeeklySetsByMuscleGroup(db: Db, userId: string, programId: string, weekStart: string, weekEnd: string, tz: string): Promise<Record<string, number>> {
  const weekEndNextStr = shiftDateStr(weekEnd, 1)
  // User-local midnight boundaries (Date Arithmetic rule) — matches the dateStrMidnightInTz
  // pattern already used at :302 in this file, instead of a bare ::date cast which compares
  // against UTC midnight and can straddle two user-local weeks.
  const weekStartTz = dateStrMidnightInTz(weekStart, tz)
  const weekEndNextTz = dateStrMidnightInTz(weekEndNextStr, tz)

  const libRows = await db.execute(sql`
    SELECT
      LOWER(muscle_entry->>'muscle') AS muscle_group,
      SUM(CASE WHEN muscle_entry->>'role' = 'main' THEN 1.0 ELSE 0.5 END) AS weighted_sets
    FROM set_logs sl
    JOIN exercise_logs el ON sl.exercise_log_id = el.id
    JOIN workout_sessions ws ON el.workout_session_id = ws.id
    CROSS JOIN LATERAL jsonb_array_elements(
      (SELECT muscles FROM exercise_library WHERE name = el.exercise_name)
    ) AS muscle_entry
    WHERE ws.user_id = ${userId}
      AND ws.started_at >= ${weekStartTz}
      AND ws.started_at < ${weekEndNextTz}
      AND ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ${programId})
      AND EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND sl.deleted_at IS NULL AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY LOWER(muscle_entry->>'muscle')
  `)

  const nonLibRows = await db.execute(sql`
    SELECT
      LOWER(mg) AS muscle_group,
      COUNT(*)::float AS weighted_sets
    FROM set_logs sl
    JOIN exercise_logs el ON sl.exercise_log_id = el.id
    JOIN workout_sessions ws ON el.workout_session_id = ws.id
    CROSS JOIN LATERAL UNNEST(el.muscle_groups) AS mg
    WHERE ws.user_id = ${userId}
      AND ws.started_at >= ${weekStartTz}
      AND ws.started_at < ${weekEndNextTz}
      AND ws.session_id IN (SELECT id FROM program_sessions WHERE program_id = ${programId})
      AND NOT EXISTS (SELECT 1 FROM exercise_library WHERE name = el.exercise_name)
      AND sl.deleted_at IS NULL AND el.deleted_at IS NULL AND ws.deleted_at IS NULL
    GROUP BY LOWER(mg)
  `)

  // Keys are canonical (normalizeMuscle), matching what computeDefaultVolumeTargets writes into
  // program_volume_targets. The exercise library ships both spellings of several muscles ("core"
  // in 14 seeded rows, "quadriceps", "pecs", …), so returning raw labels split one muscle across
  // two keys and no caller could line logged sets up against its own target.
  const result: Record<string, number> = {}
  for (const row of [...libRows.rows, ...nonLibRows.rows] as { muscle_group: string; weighted_sets: string | number }[]) {
    if (!row.muscle_group) continue
    const mg = normalizeMuscle(row.muscle_group)
    result[mg] = (result[mg] ?? 0) + Number(row.weighted_sets)
  }
  return result
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
