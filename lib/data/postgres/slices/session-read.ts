import { eq, and, inArray, asc, isNull, gte, lt } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import type { SessionReadLog } from '@trainingai/shared/ai-periodization/session-read'

type Db = ReturnType<typeof getDb>

/**
 * The stored inputs of the session read (#3893), one row per exercise log of the user's workouts
 * started in `[from, to)`, oldest first: the log's flags, the session's, its sets with the rest
 * after each, and the per-set heart-rate verdicts with the workout's `hr_dense`. Read only.
 */
export async function getSessionReadLogs(db: Db, userId: string, from: Date, to: Date): Promise<SessionReadLog[]> {
  const logs = await db
    .select({
      exerciseLogId: s.exerciseLogs.id,
      workoutSessionId: s.exerciseLogs.workoutSessionId,
      programSessionId: s.workoutSessions.programSessionId,
      exerciseName: s.exerciseLogs.exerciseName,
      loggedAt: s.exerciseLogs.loggedAt,
      estimated1rm: s.exerciseLogs.estimated1rm,
      exerciseDeloaded: s.exerciseLogs.exerciseDeloaded,
      effortVsPlan: s.exerciseLogs.effortVsPlan,
      effortSource: s.exerciseLogs.effortSource,
      exerciseType: s.exerciseLibrary.exerciseType,
      completedAt: s.workoutSessions.completedAt,
      isEarlyDeload: s.workoutSessions.isEarlyDeload,
      wasOverride: s.workoutSessions.wasOverride,
      intensityMode: s.workoutSessions.intensityMode,
      phaseType: s.workoutSessions.phaseType,
      hrDense: s.workoutHrStats.hrDense,
    })
    .from(s.exerciseLogs)
    .innerJoin(s.workoutSessions, eq(s.workoutSessions.id, s.exerciseLogs.workoutSessionId))
    .leftJoin(s.exerciseLibrary, eq(s.exerciseLibrary.id, s.exerciseLogs.exerciseId))
    .leftJoin(s.workoutHrStats, eq(s.workoutHrStats.workoutSessionId, s.workoutSessions.id))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      gte(s.workoutSessions.startedAt, from),
      lt(s.workoutSessions.startedAt, to),
      isNull(s.workoutSessions.deletedAt),
      isNull(s.exerciseLogs.deletedAt),
    ))
    .orderBy(asc(s.exerciseLogs.loggedAt))
  if (logs.length === 0) return []

  const sets = await db
    .select({
      exerciseLogId: s.setLogs.exerciseLogId,
      setNumber: s.setLogs.setNumber,
      reps: s.setLogs.reps,
      weightKg: s.setLogs.weightKg,
      plannedReps: s.setLogs.plannedReps,
      plannedWeightKg: s.setLogs.plannedWeightKg,
      plannedPct: s.setLogs.plannedPct,
      restTimeSec: s.setLogs.restTimeSec,
      plannedRestSec: s.setLogs.plannedRestSec,
      rpe: s.setLogs.rpe,
      rpeSource: s.setLogs.rpeSource,
      setEffortVsPlan: s.setLogs.effortVsPlan,
      setEffortSource: s.setLogs.effortSource,
      hrSetLogId: s.setHrStats.setLogId,
      recoveredPreset: s.setHrStats.recoveredPreset,
      restAdequate: s.setHrStats.restAdequate,
      coverageOk: s.setHrStats.coverageOk,
    })
    .from(s.setLogs)
    .leftJoin(s.setHrStats, eq(s.setHrStats.setLogId, s.setLogs.id))
    .where(and(inArray(s.setLogs.exerciseLogId, logs.map(l => l.exerciseLogId)), isNull(s.setLogs.deletedAt)))
    .orderBy(asc(s.setLogs.exerciseLogId), asc(s.setLogs.setNumber))

  const setsByLog = new Map<string, SessionReadLog['sets']>()
  for (const row of sets) {
    const list = setsByLog.get(row.exerciseLogId) ?? []
    list.push({
      setNumber: row.setNumber,
      reps: row.reps,
      weightKg: row.weightKg,
      plannedReps: row.plannedReps,
      plannedWeightKg: row.plannedWeightKg,
      plannedPct: row.plannedPct,
      restTimeSec: row.restTimeSec,
      plannedRestSec: row.plannedRestSec,
      rpe: row.rpe,
      rpeSource: row.rpeSource,
      setEffortVsPlan: row.setEffortVsPlan,
      setEffortSource: row.setEffortSource,
      hr: row.hrSetLogId
        ? { recoveredPreset: row.recoveredPreset, restAdequate: row.restAdequate, coverageOk: row.coverageOk ?? false }
        : null,
    })
    setsByLog.set(row.exerciseLogId, list)
  }

  return logs.map(l => ({
    exerciseLogId: l.exerciseLogId,
    workoutSessionId: l.workoutSessionId,
    programSessionId: l.programSessionId,
    exerciseName: l.exerciseName,
    loggedAt: l.loggedAt,
    estimated1rm: l.estimated1rm,
    exerciseDeloaded: l.exerciseDeloaded,
    exerciseType: l.exerciseType ?? null,
    session: {
      completed: l.completedAt != null,
      isEarlyDeload: l.isEarlyDeload,
      wasOverride: l.wasOverride,
      intensityMode: l.intensityMode,
      phaseType: l.phaseType,
      hrDense: l.hrDense ?? null,
    },
    effortVsPlan: l.effortVsPlan,
    effortSource: l.effortSource,
    sets: setsByLog.get(l.exerciseLogId) ?? [],
  }))
}
