import { randomUUID } from 'crypto'
import { NotFoundError, UserFacingError } from '@trainingai/shared/errors'
import { eq, and, inArray, gte, lt, asc, desc, sql, isNull } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type {
  Program, ProgramSession, SessionExercise, Schedule, ScheduleDay,
  ProgressionStyle, StyleSet,
} from '@trainingai/shared/types'
import type { ProgramPhase, ProgramPhaseType, PhaseSetWithPhases, ExerciseRole } from '@trainingai/shared/types/program'
import { aestMidnight, toAestDateStr, todayInTz, DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { buildOwnedPhaseSetName } from '@trainingai/shared/phase-set-naming'
import { isUuid } from '@trainingai/shared/validation/uuid'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import { withProgramWriteLock, voidProgramPrescriptionsIn } from './periodization'

type Db = ReturnType<typeof getDb>

// ── Private helpers ─────────────────────────────────────────────────────────

function rowToPhase(r: typeof s.programPhases.$inferSelect): ProgramPhase {
  return {
    id: r.id,
    phaseSetId: r.phaseSetId!,
    position: r.position,
    name: r.name,
    durationCycles: r.durationCycles,
    phaseType: r.phaseType as ProgramPhaseType,
    primaryStyleId: r.primaryStyleId ?? undefined,
    secondaryStyleId: r.secondaryStyleId ?? undefined,
  }
}

async function anchorForMostRecentSessions(db: Db, userId: string, n: number): Promise<Date> {
  if (n <= 0) return new Date()
  const rows = await db
    .select({ startedAt: s.workoutSessions.startedAt })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.isEarlyDeload, false),
      isNull(s.workoutSessions.deletedAt),
    ))
    .orderBy(desc(s.workoutSessions.startedAt))
    .limit(n + 1)

  if (rows.length > n) return rows[n].startedAt
  if (rows.length > 0) return new Date(rows[rows.length - 1].startedAt.getTime() - 1000)
  return new Date()
}

async function cycleAnchorFromHistory(db: Db, userId: string, phaseSetId: string | null, sessionsPerCycle: number | null): Promise<Date> {
  if (!phaseSetId || !sessionsPerCycle) return new Date()
  const phases = await db.select({ durationCycles: s.programPhases.durationCycles })
    .from(s.programPhases)
    .where(eq(s.programPhases.phaseSetId, phaseSetId))
  const totalCycles = phases.reduce((sum, p) => sum + p.durationCycles, 0)
  const blockLength = sessionsPerCycle * totalCycles
  if (blockLength <= 0) return new Date()

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.workoutSessions)
    .where(and(eq(s.workoutSessions.userId, userId), eq(s.workoutSessions.isEarlyDeload, false), isNull(s.workoutSessions.deletedAt)))

  const n = (row?.count ?? 0) % blockLength
  return anchorForMostRecentSessions(db, userId, n)
}

// ── Programs ─────────────────────────────────────────────────────────────────

/**
 * The active program, else the oldest. #3793 ⑤: this used to load every program with all its
 * sessions, exercises and schedule days and keep one (3,203 calls, 7% of all statements). The row is
 * now chosen first, by the same rule (`is_active` first, then oldest by `created_at`, as
 * `listPrograms` orders them, with the id breaking a tie so the pick is stable), and only its children are loaded.
 */
export async function getActiveProgram(db: Db, userId: string): Promise<Program | null> {
  const pRows = await db.select().from(s.programs)
    .where(eq(s.programs.userId, userId))
    .orderBy(desc(s.programs.isActive), asc(s.programs.createdAt), asc(s.programs.id))
    .limit(1)
  return (await programsWithChildren(db, pRows))[0] ?? null
}

export async function listPrograms(db: Db, userId: string): Promise<Program[]> {
  const pRows = await db.select().from(s.programs)
    .where(eq(s.programs.userId, userId))
    .orderBy(asc(s.programs.createdAt))
  return programsWithChildren(db, pRows)
}

/** Program rows → `Program`s with their sessions, exercises and schedule, in the rows' order. */
async function programsWithChildren(db: Db, pRows: (typeof s.programs.$inferSelect)[]): Promise<Program[]> {
  if (!pRows.length) return []

  const programIds = pRows.map(p => p.id)
  const [sRows, schedRows] = await Promise.all([
    db.select().from(s.programSessions)
      .where(and(inArray(s.programSessions.programId, programIds), isNull(s.programSessions.deletedAt)))
      .orderBy(asc(s.programSessions.programId), asc(s.programSessions.position)),
    db.select().from(s.schedules)
      .where(inArray(s.schedules.programId, programIds)),
  ])

  const sessionIds = sRows.map(r => r.id)
  const scheduleIds = schedRows.map(r => r.id)
  const [exRows, dayRows] = await Promise.all([
    sessionIds.length
      ? db.select().from(s.sessionExercises)
          .where(and(inArray(s.sessionExercises.sessionId, sessionIds), isNull(s.sessionExercises.deletedAt)))
          .orderBy(asc(s.sessionExercises.sessionId), asc(s.sessionExercises.position))
      : Promise.resolve([]),
    scheduleIds.length
      ? db.select().from(s.scheduleDays)
          .where(inArray(s.scheduleDays.scheduleId, scheduleIds))
      : Promise.resolve([]),
  ])

  return pRows.map(p => {
    const sessions: ProgramSession[] = sRows
      .filter(r => r.programId === p.id)
      .map(r => ({
        id: r.id, programId: r.programId, name: r.name, position: r.position,
        icon: r.icon ?? undefined,
        timeBudgetMinutes: r.timeBudgetMinutes ?? 60,
        exercises: exRows
          .filter(e => e.sessionId === r.id)
          .map<SessionExercise>(e => ({
            id: e.id, sessionId: e.sessionId, exerciseName: e.exerciseName,
            styleId: e.styleId ?? undefined,
            muscleGroups: e.muscleGroups ?? [],
            position: e.position,
            exerciseRole: (e.exerciseRole as ExerciseRole) ?? UNCLASSIFIED_EXERCISE_ROLE,
            supersetGroup: e.supersetGroup ?? null,
          })),
      }))

    const schedRow = schedRows.find(r => r.programId === p.id)
    let schedule: Schedule | undefined
    if (schedRow) {
      const days = dayRows.filter(d => d.scheduleId === schedRow.id)
      schedule = {
        id: schedRow.id, programId: schedRow.programId,
        type: schedRow.type as 'rotation' | 'weekly',
        restAfterN: schedRow.restAfterN ?? undefined,
        days: days.map<ScheduleDay>(d => ({
          dayOfWeek: d.dayOfWeek, sessionId: d.sessionId ?? undefined,
        })),
        reminderEnabled: schedRow.reminderEnabled,
        reminderTime: schedRow.reminderTime ?? null,
      }
    }

    return {
      id: p.id, userId: p.userId, name: p.name, isActive: p.isActive,
      sessions, schedule,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
      phaseMode: (p.phaseMode as 'manual' | 'automatic' | 'ai_dynamic') ?? 'manual',
      phaseSetId: p.phaseSetId ?? undefined,
      startedAt: p.startedAt ?? undefined,
      sessionsPerCycle: p.sessionsPerCycle ?? undefined,
      earlyDeloadWeekStart: p.earlyDeloadWeekStart ?? undefined,
      totalWeeks: p.totalWeeks ?? undefined,
      trainingGoal: p.trainingGoal ?? 'strength',
      autoApplyPrescriptions: p.autoApplyPrescriptions ?? false,
    }
  })
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * `voidPrescriptions`: the program editor's save. A structural edit must void the program's stored AI
 * plans, and does so in THIS transaction (#4082 review 2), so a save the lock refused as busy neither saved
 * the edit nor left it half done, and one that answered ok has already voided the old plans.
 *
 * An edit of an existing program deletes and re-inserts its replaced sessions, and the cascade deletes
 * those sessions' stored-plan rows (several rows, no stated order); a weekly check-in updates one plan row
 * per lift. So an edit takes the person's lift-write lock first, like the phase movers (#4082 review 2):
 * a wait past the bound, a statement timeout or a deadlock rolls the whole save back as `BusyError` (409).
 * A new program has no plan rows and takes none.
 */
export async function saveProgram(db: Db, userId: string, program: Program, opts: { voidPrescriptions?: boolean } = {}): Promise<Program> {
  const write = async (tx: Tx): Promise<Program> => {
    const [nameClash] = await tx.select({ id: s.programs.id })
      .from(s.programs)
      .where(and(
        eq(s.programs.userId, userId),
        eq(s.programs.name, program.name),
        program.id ? sql`${s.programs.id} != ${program.id}` : undefined,
      ))
    if (nameClash) {
      throw new UserFacingError(`A program named "${program.name}" already exists. Use a different name.`, 409)
    }

    let pRow: typeof s.programs.$inferSelect
    if (program.id) {
      const [r] = await tx.update(s.programs)
        .set({
          name: program.name, isActive: program.isActive, updatedAt: new Date(),
          phaseMode: program.phaseMode ?? 'manual',
          phaseSetId: program.phaseSetId ?? null,
          sessionsPerCycle: program.sessionsPerCycle ?? null,
          totalWeeks: program.totalWeeks ?? null,
          trainingGoal: program.trainingGoal ?? 'strength',
          autoApplyPrescriptions: program.autoApplyPrescriptions ?? false,
        })
        .where(and(eq(s.programs.id, program.id), eq(s.programs.userId, userId)))
        .returning()
      // 0 rows means the id is not this user's. It already failed closed — `pRow.id` below throws
      // inside the transaction — but by accident rather than by design, and with an opaque
      // TypeError instead of a reason (Q-129).
      if (!r) throw new NotFoundError('Program')
      pRow = r
    } else {
      const [r] = await tx.insert(s.programs)
        .values({
          userId, name: program.name, isActive: program.isActive, updatedAt: new Date(),
          phaseMode: program.phaseMode ?? 'manual',
          phaseSetId: program.phaseSetId ?? null,
          sessionsPerCycle: program.sessionsPerCycle ?? null,
          totalWeeks: program.totalWeeks ?? null,
          trainingGoal: program.trainingGoal ?? 'strength',
          autoApplyPrescriptions: program.autoApplyPrescriptions ?? false,
        })
        .returning()
      pRow = r
    }
    const programId = pRow.id

    const [ownedPhaseSet] = await tx.select({
      id: s.phaseSets.id, name: s.phaseSets.name, templateBaseName: s.phaseSets.templateBaseName,
    })
      .from(s.phaseSets)
      .where(and(eq(s.phaseSets.ownerProgramId, programId), eq(s.phaseSets.userId, userId)))
    if (ownedPhaseSet?.templateBaseName) {
      const renamedTo = buildOwnedPhaseSetName(ownedPhaseSet.templateBaseName, program.name)
      if (renamedTo !== ownedPhaseSet.name) {
        await tx.update(s.phaseSets).set({ name: renamedTo }).where(eq(s.phaseSets.id, ownedPhaseSet.id))
      }
    }

    if (program.isActive) {
      await tx.update(s.programs)
        .set({ isActive: false })
        .where(and(eq(s.programs.userId, userId), sql`${s.programs.id} != ${programId}`))
    }

    // Tombstoned rows are included: they are still this program's, so they must not read as
    // "belongs to another program" below, and a supplied id that names one is a resurrection
    // that has to be hard-deleted before it can be re-inserted under the same primary key.
    const allSessions = await tx.select({
      id: s.programSessions.id,
      position: s.programSessions.position,
      deletedAt: s.programSessions.deletedAt,
    }).from(s.programSessions).where(eq(s.programSessions.programId, programId))
    const oldSessions = allSessions.filter(r => r.deletedAt == null)
    // ON DELETE SET NULL on workout_sessions.session_id means deleting program_sessions
    // below severs the link from already-logged workouts to their session — even ones
    // logged moments before this save. The save UI now round-trips session ids for
    // sessions that already existed, so the recreated row keeps the same id and the
    // link can be restored by identity (see restore loop below). The position-based
    // map is kept only as a fallback for sessions saved before ids were round-tripped.
    let orphanedWorkoutSessions: { id: string; programSessionId: string | null }[] = []
    const oldByPosition = new Map(oldSessions.map(r => [r.position, r.id]))
    const oldIdSet = new Set(oldSessions.map(r => r.id))
    const ownedIdSet = new Set(allSessions.map(r => r.id))
    let savedPeriodizationRows: (typeof s.sessionPeriodization.$inferSelect)[] = []

    // RV-34: `sessions[].id` is the client's, used verbatim as the new row's primary key so a program
    // edit does not sever `workout_sessions.session_id` from already-logged workouts. Unchecked, an
    // id belonging to ANOTHER user's program was a raw `23505` duplicate-key 500 with the failed SQL
    // in `error_events` — failing closed by accident of a constraint rather than by design.
    //
    // The guard has to be "exists under a different program", NOT "not one of this program's rows":
    // `builder-review.tsx` mints a fresh `crypto.randomUUID()` for every session on save, so the
    // stricter reading refuses every save from the workout builder. An id that exists nowhere is an
    // ordinary insert; an id that exists elsewhere is the case that used to 500.
    const suppliedSessionIds = program.sessions.map(sess => sess.id).filter((id): id is string => !!id)
    if (!suppliedSessionIds.every(isUuid)) {
      // Would reach the driver as `22P02` on insert and surface as the same opaque 500.
      throw new UserFacingError('This program contains a malformed session id. Reload and try again.', 400)
    }
    const foreignIds = suppliedSessionIds.filter(id => !ownedIdSet.has(id))
    if (foreignIds.length) {
      const taken = await tx.select({ id: s.programSessions.id })
        .from(s.programSessions)
        .where(inArray(s.programSessions.id, foreignIds))
      if (taken.length) {
        throw new UserFacingError('This program refers to a session that belongs to another program. Reload and try again.', 409)
      }
    }

    // LB-66: there is no delete endpoint for a program session — removing one is expressed as
    // saving the program without it. So the replace-all below is only a real deletion for the ids
    // that do NOT come back; those are tombstoned, and everything else keeps the existing
    // hard-delete + re-insert (which is what round-trips ids and rebuilds positions).
    const suppliedSet = new Set(suppliedSessionIds)
    const removedIds = oldSessions.filter(r => !suppliedSet.has(r.id)).map(r => r.id)
    const replacedIds = allSessions.filter(r => suppliedSet.has(r.id)).map(r => r.id)

    if (removedIds.length) {
      const now = new Date()
      await tx.update(s.sessionExercises).set({ deletedAt: now })
        .where(and(inArray(s.sessionExercises.sessionId, removedIds), isNull(s.sessionExercises.deletedAt)))
      await tx.update(s.programSessions).set({ deletedAt: now })
        .where(inArray(s.programSessions.id, removedIds))
      // The FK used to do this: `schedule_days.session_id` is ON DELETE SET NULL, so the hard
      // delete cleared the slot. A tombstone does not fire it, and a schedule day pointing at a
      // session the user removed would still resolve on the workout screen.
      await tx.update(s.scheduleDays).set({ sessionId: null })
        .where(inArray(s.scheduleDays.sessionId, removedIds))
    }
    if (replacedIds.length) {
      // Captured for the rows actually being deleted. Tombstoned sessions are deliberately not in
      // here: nothing fires on them, so their workout links and periodization state survive
      // untouched, which is the point of the tombstone.
      orphanedWorkoutSessions = await tx.select({ programSessionId: s.workoutSessions.programSessionId, id: s.workoutSessions.id })
        .from(s.workoutSessions)
        .where(inArray(s.workoutSessions.programSessionId, replacedIds))
      savedPeriodizationRows = await tx.select()
        .from(s.sessionPeriodization)
        .where(inArray(s.sessionPeriodization.programSessionId, replacedIds))
      await tx.delete(s.sessionExercises).where(inArray(s.sessionExercises.sessionId, replacedIds))
      await tx.delete(s.programSessions).where(inArray(s.programSessions.id, replacedIds))
    }

    const sessionsWithIds = program.sessions.map(sess => ({
      sess,
      sessionId: sess.id ?? crypto.randomUUID(),
      exercises: sess.exercises.map(ex => ({ ex, exerciseId: ex.id ?? crypto.randomUUID() })),
    }))

    if (sessionsWithIds.length) {
      await tx.insert(s.programSessions).values(sessionsWithIds.map(({ sess, sessionId }) => ({
        id: sessionId,
        programId, name: sess.name, position: sess.position,
        icon: sess.icon ?? null,
        timeBudgetMinutes: sess.timeBudgetMinutes ?? 60,
      })))
      // RV-168: the catalogue FK, resolved the same way migration 099 backfilled it — exact,
      // case-sensitive match on the library's unique name. Without this every program save wiped
      // `exercise_id` back to NULL, because a save is a delete + re-insert and the insert never
      // carried it; only the Coach swap wrote it, which is why stray rows had it and no others did.
      const libraryNames = [...new Set(
        sessionsWithIds.flatMap(({ exercises }) => exercises.map(({ ex }) => ex.exerciseName)),
      )]
      const libraryIdByName = new Map<string, string>()
      if (libraryNames.length) {
        const libRows = await tx.select({ id: s.exerciseLibrary.id, name: s.exerciseLibrary.name })
          .from(s.exerciseLibrary)
          .where(inArray(s.exerciseLibrary.name, libraryNames))
        for (const r of libRows) libraryIdByName.set(r.name, r.id)
      }
      const exerciseRows = sessionsWithIds.flatMap(({ sessionId, exercises }) =>
        // `exerciseId` destructured here is the ROW's own primary key; `exerciseId:` below is the
        // catalogue FK. Two different things, one name — see the `id:` line.
        exercises.map(({ ex, exerciseId }) => ({
          id: exerciseId,
          sessionId, exerciseName: ex.exerciseName,
          exerciseId: libraryIdByName.get(ex.exerciseName) ?? null,
          styleId: ex.styleId ?? null,
          muscleGroups: ex.muscleGroups.map(mg => mg.toLowerCase()),
          position: ex.position,
          exerciseRole: ex.exerciseRole ?? UNCLASSIFIED_EXERCISE_ROLE,
          supersetGroup: ex.supersetGroup ?? null,
        })))
      if (exerciseRows.length) await tx.insert(s.sessionExercises).values(exerciseRows)
    }

    const savedSessions: ProgramSession[] = sessionsWithIds.map(({ sess, sessionId, exercises }) => ({
      ...sess, id: sessionId, programId,
      exercises: exercises.map(({ ex, exerciseId }) => ({ ...ex, id: exerciseId, sessionId })),
    }))

    // Restore periodization state for sessions that kept their original IDs (round-tripped).
    if (savedPeriodizationRows.length) {
      const incomingSessionIds = new Set(program.sessions.map(s => s.id).filter(Boolean))
      const rowsToRestore = savedPeriodizationRows.filter(r => incomingSessionIds.has(r.programSessionId))
      for (const row of rowsToRestore) {
        await tx.insert(s.sessionPeriodization).values(row).onConflictDoNothing()
      }
    }

    // Re-point workout_sessions at the recreated session, so already-logged workouts
    // stay linked after the delete+recreate above.
    if (orphanedWorkoutSessions.length) {
      const newIdByOldId = new Map<string, string>()
      // Fallback for sessions saved before ids were round-tripped: match by the slot
      // (position) they occupied. Breaks if sessions were reordered/removed, which the
      // identity-based pass below corrects whenever an id is available.
      for (const sess of savedSessions) {
        const oldId = oldByPosition.get(sess.position)
        if (oldId) newIdByOldId.set(oldId, sess.id)
      }
      // Identity-based: a session whose id was round-tripped keeps that same id after
      // recreation, so it maps to itself regardless of any reordering/removal.
      for (const sess of program.sessions) {
        if (sess.id && oldIdSet.has(sess.id)) newIdByOldId.set(sess.id, sess.id)
      }
      for (const ws of orphanedWorkoutSessions) {
        const newId = ws.programSessionId ? newIdByOldId.get(ws.programSessionId) : undefined
        if (newId) {
          await tx.update(s.workoutSessions).set({ programSessionId: newId }).where(eq(s.workoutSessions.id, ws.id))
        }
      }
    }

    // Restore session_periodization rows wiped by ON DELETE CASCADE above.
    // Only restore for sessions whose id was preserved (round-tripped); deleted/replaced
    // sessions legitimately lose their periodization state.
    if (savedPeriodizationRows.length) {
      const newSavedIds = new Set(savedSessions.map(s => s.id))
      for (const row of savedPeriodizationRows) {
        if (newSavedIds.has(row.programSessionId)) {
          await tx.insert(s.sessionPeriodization)
            .values(row)
            .onConflictDoNothing()
        }
      }
    }

    const schedulePayload = (program as Program & { schedule?: Schedule | null }).schedule
    if (schedulePayload === null) {
      const [existing] = await tx.select({ id: s.schedules.id }).from(s.schedules).where(eq(s.schedules.programId, programId))
      if (existing) {
        await tx.delete(s.scheduleDays).where(eq(s.scheduleDays.scheduleId, existing.id))
        await tx.delete(s.schedules).where(eq(s.schedules.id, existing.id))
      }
    } else if (schedulePayload) {
      const [schedRow] = await tx.insert(s.schedules)
        .values({
          ...(schedulePayload.id ? { id: schedulePayload.id } : {}),
          programId, type: schedulePayload.type,
          restAfterN: schedulePayload.restAfterN ?? null,
          reminderEnabled: schedulePayload.reminderEnabled ?? false,
          reminderTime: schedulePayload.reminderTime ?? null,
        })
        .onConflictDoUpdate({
          target: s.schedules.programId,
          set: {
            type: sql`EXCLUDED.type`,
            restAfterN: sql`EXCLUDED.rest_after_n`,
            reminderEnabled: sql`EXCLUDED.reminder_enabled`,
            reminderTime: sql`EXCLUDED.reminder_time`,
          },
        })
        .returning()
      const scheduleId = schedRow.id
      const savedSessionIds = new Set(savedSessions.map(sess => sess.id))
      await tx.delete(s.scheduleDays).where(eq(s.scheduleDays.scheduleId, scheduleId))
      if (schedulePayload.days) {
        for (const day of schedulePayload.days) {
          await tx.insert(s.scheduleDays)
            .values({
              scheduleId,
              dayOfWeek: day.dayOfWeek,
              // Only a session this save leaves live on this program. That covers a stale client
              // naming a session this same save removed (the FK used to null it on delete and no
              // longer fires) and an id that is not one of this program's sessions at all, which
              // is stored as a rest day rather than refusing the whole program save.
              sessionId: day.sessionId && savedSessionIds.has(day.sessionId) ? day.sessionId : null,
            })
        }
      }
    }

    if (opts.voidPrescriptions) await voidProgramPrescriptionsIn(tx, userId, programId)

    return {
      ...program, id: programId, sessions: savedSessions,
      createdAt: pRow.createdAt, updatedAt: pRow.updatedAt,
    }
  }
  return program.id ? withProgramWriteLock(db, userId, write) : db.transaction(write)
}

/**
 * The program's cascade deletes its sessions' stored-plan rows (several rows, no stated order), so it takes
 * the person's lift-write lock first, like the phase movers (#4082 review 2); busy is `BusyError` (409).
 */
export async function deleteProgram(db: Db, userId: string, programId: string): Promise<void> {
  await withProgramWriteLock(db, userId, async tx => {
    const [owned] = await tx.select({ id: s.phaseSets.id })
      .from(s.phaseSets)
      .where(and(eq(s.phaseSets.ownerProgramId, programId), eq(s.phaseSets.userId, userId)))
    if (owned) {
      await tx.delete(s.phaseSets).where(eq(s.phaseSets.id, owned.id))
    }
    await tx.delete(s.programs).where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
  })
}

export async function removeSessionExercise(db: Db, userId: string, sessionExerciseId: string): Promise<boolean> {
  // Ownership: the row's session must belong to a program the user owns. Verify via join,
  // then tombstone by id (session_exercises has no user_id column of its own).
  const [owned] = await db
    .select({ id: s.sessionExercises.id, programId: s.programs.id })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(
      eq(s.sessionExercises.id, sessionExerciseId),
      eq(s.programs.userId, userId),
      isNull(s.sessionExercises.deletedAt),
    ))
    .limit(1)
  if (!owned) return false
  // LB-66: tombstone rather than delete, and bump the parent program so the pull delta re-sends
  // the subtree — the delta only carries a program whose `updated_at` moved, and it replaces the
  // client's children wholesale, so the bump is what makes the removal reach other devices at all.
  await db.update(s.sessionExercises).set({ deletedAt: new Date() })
    .where(eq(s.sessionExercises.id, sessionExerciseId))
  await db.update(s.programs).set({ updatedAt: new Date() })
    .where(eq(s.programs.id, owned.programId))
  return true
}

// ── Block Periodization ───────────────────────────────────────────────────────

export async function listProgramPhases(db: Db, userId: string, programId: string): Promise<ProgramPhase[]> {
  // Scoped to the caller: the program's phase_set_id is a client-writable FK, so resolving it
  // unscoped let another user's phase names, types, durations and cycle structure render on this
  // user's workout screen (Q-129). The join is the same shape removeSessionExercise uses.
  const [prog] = await db
    .select({ phaseSetId: s.programs.phaseSetId })
    .from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
    .limit(1)
  if (!prog?.phaseSetId) return []

  // The phases are read through the caller's own phase sets as well, so a `phase_set_id` that is
  // not the caller's resolves to no phases even if one was stored before the write paths checked it.
  const rows = await db.select({ phase: s.programPhases }).from(s.programPhases)
    .innerJoin(s.phaseSets, eq(s.phaseSets.id, s.programPhases.phaseSetId))
    .where(and(eq(s.programPhases.phaseSetId, prog.phaseSetId), eq(s.phaseSets.userId, userId)))
    .orderBy(asc(s.programPhases.position))
  return rows.map(r => rowToPhase(r.phase))
}

/**
 * True when `id` names a phase set belonging to `userId`, or is empty (nothing to check).
 *
 * `phase_sets.user_id` is NOT NULL and there is no shared or global set, so an id the caller does
 * not own is always wrong (Q-129). The one check behind every write that stores a client-supplied
 * `programs.phase_set_id`: the program save route and the Coach's program-phase apply. A malformed
 * id is `false`, not a driver error, for the reason `progressionStyleIdsOwned` gives.
 */
export async function phaseSetIdOwned(
  db: Db, userId: string, id: string | null | undefined,
): Promise<boolean> {
  if (id == null || id === '') return true
  if (!isUuid(id)) return false
  const [row] = await db.select({ id: s.phaseSets.id })
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.id, id), eq(s.phaseSets.userId, userId)))
    .limit(1)
  return !!row
}

/**
 * True when `id` names a session (live or tombstoned) of one of `userId`'s programs.
 *
 * `program_sessions` has no `user_id`; ownership is through `programs`. Used before a
 * client-supplied session id is stored as a link (`workout_sessions.programSessionId`).
 * A malformed id is `false`.
 */
export async function programSessionIdOwned(db: Db, userId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const [row] = await db.select({ id: s.programSessions.id })
    .from(s.programSessions)
    .innerJoin(s.programs, eq(s.programs.id, s.programSessions.programId))
    .where(and(eq(s.programSessions.id, id), eq(s.programs.userId, userId)))
    .limit(1)
  return !!row
}

export async function listPhaseSets(db: Db, userId: string): Promise<PhaseSetWithPhases[]> {
  const sets = await db
    .select()
    .from(s.phaseSets)
    .where(eq(s.phaseSets.userId, userId))
    .orderBy(asc(s.phaseSets.createdAt))

  if (sets.length === 0) return []

  const primaryStyle = s.progressionStyles
  const allPhases = await db
    .select({
      phase:            s.programPhases,
      primaryStyleName: primaryStyle.name,
    })
    .from(s.programPhases)
    // RV-32: scoped to the caller. `program_phases.primary_style_id` is a client-supplied FK that
    // three write paths accepted without an ownership check, and this join is what turned a borrowed
    // id into someone else's style NAME on screen and inside an LLM prompt. Scoping it means a
    // reference the caller does not own reads as blank rather than as another user's words — which
    // stays true for rows written before the write guards existed.
    .leftJoin(primaryStyle, and(eq(primaryStyle.id, s.programPhases.primaryStyleId), eq(primaryStyle.userId, userId)))
    .where(inArray(s.programPhases.phaseSetId, sets.map(set => set.id)))
    .orderBy(asc(s.programPhases.position))

  const phasesBySetId = new Map<string, ProgramPhase[]>()
  for (const row of allPhases) {
    const { phase, primaryStyleName } = row
    if (!phase.phaseSetId) continue
    const list = phasesBySetId.get(phase.phaseSetId) ?? []
    list.push({ ...rowToPhase(phase), primaryStyleName: primaryStyleName ?? undefined })
    phasesBySetId.set(phase.phaseSetId, list)
  }

  return sets.map(set => ({
    id: set.id, name: set.name, isDefault: set.isDefault,
    ownerProgramId: set.ownerProgramId ?? undefined,
    templateBaseName: set.templateBaseName ?? undefined,
    phases: phasesBySetId.get(set.id) ?? [],
  }))
}

export async function createPhaseSet(
  db: Db,
  userId: string,
  name: string,
  phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
): Promise<PhaseSetWithPhases> {
  return db.transaction(async tx => {
    const setId = randomUUID()
    await tx.insert(s.phaseSets).values({ id: setId, userId, name, isDefault: false })

    const saved = phases.length
      ? (await tx.insert(s.programPhases).values(phases.map(phase => ({
          phaseSetId: setId,
          position: phase.position, name: phase.name,
          durationCycles: phase.durationCycles, phaseType: phase.phaseType,
          primaryStyleId: phase.primaryStyleId ?? null,
          secondaryStyleId: phase.secondaryStyleId ?? null,
        }))).returning()).map(rowToPhase)
      : []
    return { id: setId, name, isDefault: false, phases: saved }
  })
}

export async function createOwnedPhaseSetClone(
  db: Db,
  userId: string,
  templateBaseName: string,
  programName: string,
  phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
): Promise<PhaseSetWithPhases> {
  const name = buildOwnedPhaseSetName(templateBaseName, programName)
  return db.transaction(async tx => {
    const setId = randomUUID()
    await tx.insert(s.phaseSets).values({ id: setId, userId, name, isDefault: false, templateBaseName })

    const saved = phases.length
      ? (await tx.insert(s.programPhases).values(phases.map(phase => ({
          phaseSetId: setId,
          position: phase.position, name: phase.name,
          durationCycles: phase.durationCycles, phaseType: phase.phaseType,
          primaryStyleId: phase.primaryStyleId ?? null,
          secondaryStyleId: phase.secondaryStyleId ?? null,
        }))).returning()).map(rowToPhase)
      : []
    return { id: setId, name, isDefault: false, templateBaseName, phases: saved }
  })
}

export async function linkPhaseSetOwnership(db: Db, phaseSetId: string, programId: string, userId: string): Promise<void> {
  await db.update(s.phaseSets)
    .set({ ownerProgramId: programId })
    .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
}

export async function updatePhaseSet(
  db: Db,
  phaseSetId: string,
  userId: string,
  name: string,
  phases: Omit<ProgramPhase, 'id' | 'phaseSetId'>[],
): Promise<PhaseSetWithPhases> {
  const [existing] = await db
    .select()
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
    .limit(1)
  if (!existing) throw new NotFoundError('Phase set')
  if (existing.isDefault) throw new UserFacingError('Default phase set cannot be modified', 403)

  return db.transaction(async tx => {
    await tx.update(s.phaseSets).set({ name }).where(eq(s.phaseSets.id, phaseSetId))
    await tx.delete(s.programPhases).where(eq(s.programPhases.phaseSetId, phaseSetId))

    const saved = phases.length
      ? (await tx.insert(s.programPhases).values(phases.map(phase => ({
          phaseSetId,
          position: phase.position, name: phase.name,
          durationCycles: phase.durationCycles, phaseType: phase.phaseType,
          primaryStyleId: phase.primaryStyleId ?? null,
          secondaryStyleId: phase.secondaryStyleId ?? null,
        }))).returning()).map(rowToPhase)
      : []
    return { id: phaseSetId, name, isDefault: existing.isDefault, phases: saved }
  })
}

export async function deletePhaseSet(db: Db, phaseSetId: string, userId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(s.phaseSets)
    .where(and(eq(s.phaseSets.id, phaseSetId), eq(s.phaseSets.userId, userId)))
    .limit(1)
  if (!existing) throw new NotFoundError('Phase set')
  if (existing.isDefault) throw new UserFacingError('Cannot delete the default phase set', 403)

  // Scoped to the caller: an unscoped probe both blocked this user's delete on a stranger's
  // program and named that program in an error surfaced verbatim to the client (Q-129).
  const using = await db
    .select({ name: s.programs.name })
    .from(s.programs)
    .where(and(eq(s.programs.phaseSetId, phaseSetId), eq(s.programs.userId, userId)))
  if (using.length > 0) {
    throw new UserFacingError(`In use by: ${using.map(p => p.name).join(', ')}`, 400)
  }
  await db.delete(s.phaseSets).where(eq(s.phaseSets.id, phaseSetId))
}

export async function updateProgramPhaseSettings(
  db: Db,
  programId: string,
  userId: string,
  settings: { phaseMode?: 'manual' | 'automatic' | 'ai_dynamic'; startedAt?: string | null; sessionsPerCycle?: number | null; phaseSetId?: string | null },
): Promise<void> {
  const set: Record<string, unknown> = {}
  if (settings.phaseMode !== undefined) set.phaseMode = settings.phaseMode
  if ('startedAt' in settings) set.startedAt = settings.startedAt ?? null
  if ('sessionsPerCycle' in settings) set.sessionsPerCycle = settings.sessionsPerCycle ?? null
  if ('phaseSetId' in settings) set.phaseSetId = settings.phaseSetId ?? null

  // First time a program enters automatic phase mode, anchor the block-cycle reference
  // point automatically from the user's training history — never overwrite an existing
  // anchor, so later saves/migrations can't silently reset progress.
  if (settings.phaseMode === 'automatic') {
    if (!('startedAt' in settings)) {
      set.startedAt = sql`COALESCE(${s.programs.startedAt}, ${todayInTz()})`
    }

    const [existing] = await db
      .select({ cycleAnchorAt: s.programs.cycleAnchorAt, phaseSetId: s.programs.phaseSetId, sessionsPerCycle: s.programs.sessionsPerCycle })
      .from(s.programs)
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))

    if (!existing?.cycleAnchorAt) {
      const phaseSetId = 'phaseSetId' in settings ? (settings.phaseSetId ?? null) : (existing?.phaseSetId ?? null)
      const sessionsPerCycle = 'sessionsPerCycle' in settings ? (settings.sessionsPerCycle ?? null) : (existing?.sessionsPerCycle ?? null)
      set.cycleAnchorAt = await cycleAnchorFromHistory(db, userId, phaseSetId, sessionsPerCycle)
    }
  }

  if (!Object.keys(set).length) return

  await db.update(s.programs).set(set)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
}

export async function countSessionsSinceStart(db: Db, userId: string, programId: string): Promise<number> {
  // Count by user + anchor only — do NOT join workout_sessions.session_id to
  // program_sessions. saveProgram() deletes/recreates program_sessions on every
  // edit, and the FK is ON DELETE SET NULL, so session_id gets wiped to null on
  // every program save and an inner join here would always return 0.
  const [prog] = await db
    .select({ cycleAnchorAt: s.programs.cycleAnchorAt, startedAt: s.programs.startedAt })
    .from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.isEarlyDeload, false),
      isNull(s.workoutSessions.deletedAt),
      sql`${s.workoutSessions.startedAt} > coalesce(${prog?.cycleAnchorAt ?? null}, ${prog?.startedAt ?? null}::timestamptz, '-infinity'::timestamptz)`,
    ))
  return row?.count ?? 0
}

// Keyed by program-session id (`workout_sessions.session_id`), NOT session name —
// renaming a session must not reset its phase progress (session identity = DB id, WK-15).
// The id is stable across renames and config-save recreations (the save path re-points
// `session_id` at the recreated row). Legacy rows with a null `session_id` — very old logs
// and every APK-sync-created row (the sync path stamps no program-session id) — are resolved
// to their current program-session by matching `session_name` within THIS program. Rows that
// match no current session (a renamed-away or deleted session) are omitted: no caller ever
// looks them up (callers only query current sessions, all of which resolve to an id).
export async function countAllSessionsSinceStart(db: Db, userId: string, programId: string): Promise<Map<string, number>> {
  const [prog] = await db
    .select({ cycleAnchorAt: s.programs.cycleAnchorAt, startedAt: s.programs.startedAt })
    .from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))

  // name → current program-session id, for attributing legacy null-`session_id` rows.
  // Duplicate names collapse last-wins (same as the old name-keyed count could not
  // distinguish them either) — resolution happens in JS to avoid a join fan-out that
  // would double-count a null-id row against two identically-named sessions.
  const progSessions = await db
    .select({ id: s.programSessions.id, name: s.programSessions.name })
    .from(s.programSessions)
    .where(and(eq(s.programSessions.programId, programId), isNull(s.programSessions.deletedAt)))

  const sessionNameLower = sql<string>`lower(${s.workoutSessions.sessionName})`
  const rows = await db
    .select({
      sessionId: s.workoutSessions.programSessionId,
      sessionName: sessionNameLower,
      count: sql<number>`count(*)::int`,
    })
    .from(s.workoutSessions)
    .where(and(
      eq(s.workoutSessions.userId, userId),
      eq(s.workoutSessions.isEarlyDeload, false),
      isNull(s.workoutSessions.deletedAt),
      sql`${s.workoutSessions.startedAt} > coalesce(${prog?.cycleAnchorAt ?? null}, ${prog?.startedAt ?? null}::timestamptz, '-infinity'::timestamptz)`,
    ))
    .groupBy(s.workoutSessions.programSessionId, sessionNameLower)

  return foldSessionCounts(progSessions, rows)
}

/** One group of completed workouts: the program-session id they carry (null on legacy and APK-sync rows), the lower-cased name, how many. */
type SessionCountGroup = { sessionId: string | null; sessionName: string; count: number }

/** Resolves the groups to a count per current program-session id, name-matching the null-id rows. */
function foldSessionCounts(progSessions: { id: string; name: string }[], rows: SessionCountGroup[]): Map<string, number> {
  const idByNameLower = new Map(progSessions.map(ps => [ps.name.toLowerCase(), ps.id]))
  const counts = new Map<string, number>()
  for (const r of rows) {
    const id = r.sessionId ?? idByNameLower.get(r.sessionName)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + r.count)
  }
  return counts
}

/**
 * A program's phases and the completed-session counts that place each session in them, in ONE
 * statement (#4050). `listProgramPhases` and `countAllSessionsSinceStart` each re-read the program
 * row, and the counts read the session names too: 5 statements for what the program row, one phase
 * query and one grouped count already hold. The scoping, the rows and the counts are exactly those
 * two functions': the program and the phase set are the caller's, the phases are in position order,
 * the counts are the same grouped query folded by `foldSessionCounts`.
 *
 * A program with no phases (no phase set, or an empty one) returns an empty count map: a count only
 * places a session inside a phase, so with no phase there is nothing for it to place. It is a plain
 * read: no lock, no `FOR UPDATE`, no write (docs/lift-write-lock-order.md).
 */
export async function getProgramPhaseState(
  db: Db, userId: string, programId: string,
): Promise<{ phases: ProgramPhase[]; sessionCounts: Map<string, number> }> {
  const { rows } = await db.execute<{ phases: PhaseJson[]; names: { id: string; name: string }[]; groups: SessionCountGroup[] }>(sql`
    WITH prog AS (
      SELECT p.id, p.phase_set_id, p.cycle_anchor_at, p.started_at
      FROM programs p WHERE p.id = ${programId} AND p.user_id = ${userId}
    ), ph AS (
      SELECT pp.* FROM prog
      JOIN phase_sets ps ON ps.id = prog.phase_set_id AND ps.user_id = ${userId}
      JOIN program_phases pp ON pp.phase_set_id = ps.id
    )
    SELECT
      (SELECT coalesce(json_agg(json_build_object(
          'id', ph.id, 'phaseSetId', ph.phase_set_id, 'position', ph.position, 'name', ph.name,
          'durationCycles', ph.duration_cycles, 'phaseType', ph.phase_type,
          'primaryStyleId', ph.primary_style_id, 'secondaryStyleId', ph.secondary_style_id
        ) ORDER BY ph.position), '[]'::json) FROM ph) AS phases,
      (SELECT coalesce(json_agg(json_build_object('id', x.id, 'name', x.name)), '[]'::json)
         FROM program_sessions x
        WHERE x.program_id = ${programId} AND x.deleted_at IS NULL AND EXISTS (SELECT 1 FROM ph)) AS names,
      (SELECT coalesce(json_agg(json_build_object('sessionId', g.sid, 'sessionName', g.sname, 'count', g.cnt)), '[]'::json)
         FROM (
           SELECT w.session_id AS sid, lower(w.session_name) AS sname, count(*)::int AS cnt
           FROM workout_sessions w, prog
           WHERE w.user_id = ${userId} AND w.is_early_deload = false AND w.deleted_at IS NULL
             AND w.started_at > coalesce(prog.cycle_anchor_at, prog.started_at::timestamptz, '-infinity'::timestamptz)
             AND EXISTS (SELECT 1 FROM ph)
           GROUP BY w.session_id, lower(w.session_name)
         ) g) AS groups
  `)
  const row = rows[0]
  if (!row || row.phases.length === 0) return { phases: [], sessionCounts: new Map() }
  return {
    phases: row.phases.map(p => ({
      id: p.id,
      phaseSetId: p.phaseSetId!,
      position: p.position,
      name: p.name,
      durationCycles: p.durationCycles,
      phaseType: p.phaseType as ProgramPhaseType,
      primaryStyleId: p.primaryStyleId ?? undefined,
      secondaryStyleId: p.secondaryStyleId ?? undefined,
    })),
    sessionCounts: foldSessionCounts(row.names, row.groups),
  }
}

type PhaseJson = {
  id: string; phaseSetId: string | null; position: number; name: string; durationCycles: number
  phaseType: string; primaryStyleId: string | null; secondaryStyleId: string | null
}

export async function autoRecalibrateCycleAnchor(db: Db, userId: string, programId: string): Promise<void> {
  const [prog] = await db
    .select({ phaseSetId: s.programs.phaseSetId, sessionsPerCycle: s.programs.sessionsPerCycle })
    .from(s.programs)
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))

  const anchor = await cycleAnchorFromHistory(db, userId, prog?.phaseSetId ?? null, prog?.sessionsPerCycle ?? null)

  await db.update(s.programs)
    .set({ cycleAnchorAt: anchor, startedAt: toAestDateStr(anchor) })
    .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
}

export async function getActiveProgramWithPhases(db: Db, userId: string) {
  const prog = await getActiveProgram(db, userId)
  if (!prog || prog.phaseMode !== 'automatic' || !prog.startedAt) return null
  const phases = await listProgramPhases(db, userId, prog.id)
  return { program: prog, phases }
}

export async function confirmEarlyDeload(db: Db, userId: string, programId: string, today: string, timezone = DEFAULT_TZ): Promise<void> {
  const [y, m, d] = today.split('-').map(Number)
  const dayStart = aestMidnight(y, m, d, timezone)
  const dayEnd   = aestMidnight(y, m, d + 1, timezone)
  await db.transaction(async tx => {
    await tx.update(s.programs)
      .set({ earlyDeloadWeekStart: today })
      .where(and(eq(s.programs.id, programId), eq(s.programs.userId, userId)))
    await tx.update(s.workoutSessions)
      .set({ isEarlyDeload: true })
      .where(and(
        eq(s.workoutSessions.userId, userId),
        gte(s.workoutSessions.startedAt, dayStart),
        lt(s.workoutSessions.startedAt, dayEnd),
      ))
  })
}

// ── Progression Styles ────────────────────────────────────────────────────────

/**
 * True when every id supplied is a progression style belonging to `userId` (RV-32).
 *
 * `progression_styles.user_id` is NOT NULL and there is no shared or global style, so an id the
 * caller does not own is always wrong. The narrow shape matters: the three write paths that needed
 * this include `logExerciseFromPayload`, which runs on every logged set — `listProgressionStyles`
 * would be two queries and a full hydrate of every style's sets to answer one boolean.
 *
 * A malformed id is `false`, not a throw: the column is `uuid`, so passing one through would reach
 * the driver as `22P02` and surface as an opaque 500 — the shape RV-33 is about.
 */
export async function progressionStyleIdsOwned(
  db: Db, userId: string, ids: (string | null | undefined)[],
): Promise<boolean> {
  const wanted = [...new Set(ids.filter((v): v is string => typeof v === 'string' && v.length > 0))]
  if (!wanted.length) return true
  if (!wanted.every(isUuid)) return false
  const rows = await db.select({ id: s.progressionStyles.id })
    .from(s.progressionStyles)
    .where(and(eq(s.progressionStyles.userId, userId), inArray(s.progressionStyles.id, wanted)))
  return rows.length === wanted.length
}

export async function listProgressionStyles(db: Db, userId: string): Promise<ProgressionStyle[]> {
  const styleRows = await db.select().from(s.progressionStyles)
    .where(eq(s.progressionStyles.userId, userId))
    .orderBy(asc(s.progressionStyles.name))
  if (!styleRows.length) return []

  const styleIds = styleRows.map(r => r.id)
  const setRows = await db.select().from(s.styleSets)
    .where(inArray(s.styleSets.styleId, styleIds))
    .orderBy(asc(s.styleSets.styleId), asc(s.styleSets.setNumber))

  return styleRows.map(r => ({
    id: r.id, userId: r.userId, name: r.name,
    sets: setRows
      .filter(ss => ss.styleId === r.id)
      .map<StyleSet>(ss => ({
        id: ss.id, styleId: ss.styleId, setNumber: ss.setNumber,
        pct: ss.pct, reps: ss.reps, restSec: ss.restSec, useFor1rm: ss.useFor1rm,
      })),
  }))
}

export async function saveProgressionStyle(db: Db, userId: string, style: ProgressionStyle): Promise<ProgressionStyle> {
  return db.transaction(async tx => {
    let styleId: string
    if (style.id) {
      // Bump updatedAt so set-only edits (which don't change the name) still
      // surface in the sync delta, which keys the style subtree off this column.
      // Row-count guard: a forged id belonging to another user must not reach the
      // unscoped styleSets delete/re-insert below.
      const updated = await tx.update(s.progressionStyles)
        .set({ name: style.name, updatedAt: new Date() })
        .where(and(eq(s.progressionStyles.id, style.id), eq(s.progressionStyles.userId, userId)))
        .returning({ id: s.progressionStyles.id })
      if (updated.length === 0) throw new NotFoundError('Progression style')
      styleId = updated[0].id
    } else {
      const [sRow] = await tx.insert(s.progressionStyles)
        .values({ userId, name: style.name })
        .onConflictDoUpdate({
          target: [s.progressionStyles.userId, s.progressionStyles.name],
          set: { name: sql`EXCLUDED.name` },
        })
        .returning()
      styleId = sRow.id
    }

    await tx.delete(s.styleSets).where(eq(s.styleSets.styleId, styleId))
    const savedSets: StyleSet[] = style.sets.length
      ? (await tx.insert(s.styleSets)
          .values(style.sets.map(set => ({
            ...(set.id ? { id: set.id } : {}),
            styleId, setNumber: set.setNumber, pct: set.pct,
            reps: set.reps, restSec: set.restSec, useFor1rm: set.useFor1rm,
          })))
          .returning())
          .map((setRow, i) => ({ ...style.sets[i], id: setRow.id, styleId }))
      : []

    return { ...style, id: styleId, userId, sets: savedSets }
  })
}

export async function deleteProgressionStyle(db: Db, userId: string, styleId: string): Promise<void> {
  await db.delete(s.progressionStyles)
    .where(and(eq(s.progressionStyles.id, styleId), eq(s.progressionStyles.userId, userId)))
}
