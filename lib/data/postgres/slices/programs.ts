import { randomUUID } from 'crypto'
import { NotFoundError } from '@trainingai/shared/errors'
import { eq, and, inArray, gte, lt, asc, desc, sql, isNull } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type {
  Program, ProgramSession, SessionExercise, Schedule, ScheduleDay,
  ProgressionStyle, StyleSet,
} from '@trainingai/shared/types'
import type { ProgramPhase, ProgramPhaseType, PhaseSetWithPhases, ExerciseRole } from '@trainingai/shared/types/program'
import { aestMidnight, toAestDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { buildOwnedPhaseSetName } from '@trainingai/shared/phase-set-naming'

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

export async function getActiveProgram(db: Db, userId: string): Promise<Program | null> {
  const programs = await listPrograms(db, userId)
  return programs.find(p => p.isActive) ?? programs[0] ?? null
}

export async function listPrograms(db: Db, userId: string): Promise<Program[]> {
  const pRows = await db.select().from(s.programs)
    .where(eq(s.programs.userId, userId))
    .orderBy(asc(s.programs.createdAt))
  if (!pRows.length) return []

  const programIds = pRows.map(p => p.id)
  const [sRows, schedRows] = await Promise.all([
    db.select().from(s.programSessions)
      .where(inArray(s.programSessions.programId, programIds))
      .orderBy(asc(s.programSessions.programId), asc(s.programSessions.position)),
    db.select().from(s.schedules)
      .where(inArray(s.schedules.programId, programIds)),
  ])

  const sessionIds = sRows.map(r => r.id)
  const scheduleIds = schedRows.map(r => r.id)
  const [exRows, dayRows] = await Promise.all([
    sessionIds.length
      ? db.select().from(s.sessionExercises)
          .where(inArray(s.sessionExercises.sessionId, sessionIds))
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
            exerciseRole: (e.exerciseRole as ExerciseRole) ?? 'primary',
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

export async function saveProgram(db: Db, userId: string, program: Program): Promise<Program> {
  return db.transaction(async tx => {
    const [nameClash] = await tx.select({ id: s.programs.id })
      .from(s.programs)
      .where(and(
        eq(s.programs.userId, userId),
        eq(s.programs.name, program.name),
        program.id ? sql`${s.programs.id} != ${program.id}` : undefined,
      ))
    if (nameClash) {
      throw new Error(`A program named "${program.name}" already exists. Use a different name.`)
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

    const oldSessions = await tx.select({ id: s.programSessions.id, position: s.programSessions.position })
      .from(s.programSessions).where(eq(s.programSessions.programId, programId))
    // ON DELETE SET NULL on workout_sessions.session_id means deleting program_sessions
    // below severs the link from already-logged workouts to their session — even ones
    // logged moments before this save. The save UI now round-trips session ids for
    // sessions that already existed, so the recreated row keeps the same id and the
    // link can be restored by identity (see restore loop below). The position-based
    // map is kept only as a fallback for sessions saved before ids were round-tripped.
    let orphanedWorkoutSessions: { id: string; sessionId: string | null }[] = []
    const oldByPosition = new Map(oldSessions.map(r => [r.position, r.id]))
    const oldIdSet = new Set(oldSessions.map(r => r.id))
    let savedPeriodizationRows: (typeof s.sessionPeriodization.$inferSelect)[] = []
    if (oldSessions.length) {
      const oldIds = oldSessions.map(r => r.id)
      orphanedWorkoutSessions = await tx.select({ id: s.workoutSessions.id, sessionId: s.workoutSessions.sessionId })
        .from(s.workoutSessions)
        .where(inArray(s.workoutSessions.sessionId, oldIds))
      savedPeriodizationRows = await tx.select()
        .from(s.sessionPeriodization)
        .where(inArray(s.sessionPeriodization.programSessionId, oldIds))
      await tx.delete(s.sessionExercises).where(inArray(s.sessionExercises.sessionId, oldIds))
      await tx.delete(s.programSessions).where(eq(s.programSessions.programId, programId))
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
      const exerciseRows = sessionsWithIds.flatMap(({ sessionId, exercises }) =>
        exercises.map(({ ex, exerciseId }) => ({
          id: exerciseId,
          sessionId, exerciseName: ex.exerciseName,
          styleId: ex.styleId ?? null,
          muscleGroups: ex.muscleGroups.map(mg => mg.toLowerCase()),
          position: ex.position,
          exerciseRole: ex.exerciseRole ?? 'primary',
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
        const newId = ws.sessionId ? newIdByOldId.get(ws.sessionId) : undefined
        if (newId) {
          await tx.update(s.workoutSessions).set({ sessionId: newId }).where(eq(s.workoutSessions.id, ws.id))
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
      await tx.delete(s.scheduleDays).where(eq(s.scheduleDays.scheduleId, scheduleId))
      if (schedulePayload.days) {
        for (const day of schedulePayload.days) {
          await tx.insert(s.scheduleDays)
            .values({ scheduleId, dayOfWeek: day.dayOfWeek, sessionId: day.sessionId ?? null })
        }
      }
    }

    return {
      ...program, id: programId, sessions: savedSessions,
      createdAt: pRow.createdAt, updatedAt: pRow.updatedAt,
    }
  })
}

export async function deleteProgram(db: Db, userId: string, programId: string): Promise<void> {
  await db.transaction(async tx => {
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
  // then delete by id (session_exercises has no user_id column of its own).
  const [owned] = await db
    .select({ id: s.sessionExercises.id })
    .from(s.sessionExercises)
    .innerJoin(s.programSessions, eq(s.sessionExercises.sessionId, s.programSessions.id))
    .innerJoin(s.programs, eq(s.programSessions.programId, s.programs.id))
    .where(and(eq(s.sessionExercises.id, sessionExerciseId), eq(s.programs.userId, userId)))
    .limit(1)
  if (!owned) return false
  await db.delete(s.sessionExercises).where(eq(s.sessionExercises.id, sessionExerciseId))
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

  const rows = await db.select().from(s.programPhases)
    .where(eq(s.programPhases.phaseSetId, prog.phaseSetId))
    .orderBy(asc(s.programPhases.position))
  return rows.map(rowToPhase)
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
    .leftJoin(primaryStyle, eq(primaryStyle.id, s.programPhases.primaryStyleId))
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
  if (existing.isDefault) throw new Error('Default phase set cannot be modified')

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
  if (existing.isDefault) throw new Error('Cannot delete the default phase set')

  // Scoped to the caller: an unscoped probe both blocked this user's delete on a stranger's
  // program and named that program in an error surfaced verbatim to the client (Q-129).
  const using = await db
    .select({ name: s.programs.name })
    .from(s.programs)
    .where(and(eq(s.programs.phaseSetId, phaseSetId), eq(s.programs.userId, userId)))
  if (using.length > 0) {
    throw new Error(`In use by: ${using.map(p => p.name).join(', ')}`)
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
    .where(eq(s.programSessions.programId, programId))
  const idByNameLower = new Map(progSessions.map(ps => [ps.name.toLowerCase(), ps.id]))

  const sessionNameLower = sql<string>`lower(${s.workoutSessions.sessionName})`
  const rows = await db
    .select({
      sessionId: s.workoutSessions.sessionId,
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
    .groupBy(s.workoutSessions.sessionId, sessionNameLower)

  const counts = new Map<string, number>()
  for (const r of rows) {
    const id = r.sessionId ?? idByNameLower.get(r.sessionName)
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + r.count)
  }
  return counts
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

export async function confirmEarlyDeload(db: Db, userId: string, programId: string, today: string): Promise<void> {
  const [y, m, d] = today.split('-').map(Number)
  const dayStart = aestMidnight(y, m, d)
  const dayEnd   = aestMidnight(y, m, d + 1)
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
