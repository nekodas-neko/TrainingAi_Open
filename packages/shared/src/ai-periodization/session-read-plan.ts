/**
 * The session reads stored beside a plan (#3893). For each exercise of the session being planned,
 * the read of its newest readable log in this program, kept on the stored prescription as
 * `sessionReads`. In shadow: nothing that builds a prescription reads them.
 */
import { dateStrMidnightInTz, shiftDateStr, todayInTz } from '../date-utils'
import { weightStepFor } from '../workout/load-rounding'
import { goalRange } from './goal-ranges'
import { isReadableLog, readLog, type SessionReadLog, type StoredSessionRead } from './session-read'
import type { Program, ProgramSession } from '../types/program'
import type { WorkoutRepository } from '@/lib/data/repository'

/** How far back the newest log of an exercise is looked for. */
export const SESSION_READ_LOOKBACK_DAYS = 90

/** Pure: the newest readable log per exercise of `session`, read. Logs before `programStart` are another program's. */
export function sessionReadsFor(
  session: Pick<ProgramSession, 'exercises'>,
  logs: readonly SessionReadLog[],
  opts: { programStart: Date; trainingGoal: string; equipment: Record<string, string[]> },
): StoredSessionRead[] {
  const newest = new Map<string, SessionReadLog>()
  for (const log of logs) {
    if (log.loggedAt < opts.programStart || !isReadableLog(log)) continue
    const seen = newest.get(log.exerciseName)
    if (!seen || log.loggedAt > seen.loggedAt) newest.set(log.exerciseName, log)
  }
  const reads: StoredSessionRead[] = []
  for (const ex of session.exercises) {
    const log = newest.get(ex.exerciseName)
    if (!log) continue
    const read = readLog(
      log,
      weightStepFor(opts.equipment[ex.exerciseName]),
      goalRange(opts.trainingGoal, ex.exerciseRole).repMax,
    )
    reads.push({ ...read, sessionExerciseId: ex.id, exerciseName: ex.exerciseName, workoutSessionId: log.workoutSessionId })
  }
  return reads
}

export async function loadSessionReads(
  repo: WorkoutRepository,
  userId: string,
  program: Pick<Program, 'createdAt' | 'trainingGoal'>,
  session: Pick<ProgramSession, 'exercises'>,
  tz: string,
): Promise<StoredSessionRead[]> {
  const from = dateStrMidnightInTz(shiftDateStr(todayInTz(tz), -SESSION_READ_LOOKBACK_DAYS), tz)
  // Worked out before either read starts: if this threw between the two calls, the first read's
  // promise would be left with nobody listening, and its failure would surface as an unhandled
  // rejection instead of the caller's "no read" (seen in CI on a session with no exercise list).
  const names = session.exercises.map(e => e.exerciseName)
  const [logs, equipment] = await Promise.all([
    repo.getSessionReadLogs(userId, from, new Date()),
    repo.getExerciseEquipment(names),
  ])
  return sessionReadsFor(session, logs ?? [], {
    programStart: program.createdAt,
    trainingGoal: program.trainingGoal,
    equipment: equipment ?? {},
  })
}
