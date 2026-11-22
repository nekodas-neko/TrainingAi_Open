/**
 * The session reads stored beside a plan (#3893). For each exercise of the session being planned,
 * the read of its newest readable log in this program, kept on the stored prescription as
 * `sessionReads`. In shadow: nothing that builds a prescription reads them.
 */
import { dateStrMidnightInTz, shiftDateStr, startOfWeekInTz, todayInTz } from '../date-utils'
import { weightStepFor } from '../workout/load-rounding'
import { goalRange } from './goal-ranges'
import { preferredRepBand, type LiftPreference } from './lift-preference'
import { isReadableLog, readLog, type SessionReadLog, type StoredSessionRead } from './session-read'
import { holdUnderCheckin } from '../weekly-checkin/effects'
import type { Program, ProgramSession } from '../types/program'
import type { WorkoutRepository } from '@/lib/data/repository'

/** How far back the newest log of an exercise is looked for. */
export const SESSION_READ_LOOKBACK_DAYS = 90

/** Pure: the newest readable log per exercise of `session`, read. Logs before `programStart` are another program's. */
export function sessionReadsFor(
  session: Pick<ProgramSession, 'exercises'>,
  logs: readonly SessionReadLog[],
  opts: {
    programStart: Date; trainingGoal: string; equipment: Record<string, string[]>
    /** #3896: lifts with a stored preference. A rep range replaces the role's band ceiling, so the
     *  read never calls for reps past what the lifter chose. */
    liftPreferences?: ReadonlyMap<string, LiftPreference>
    /** #3890: lifts last week's check-in answered "Heavy" for (this week's, by `applies_week_start`).
     *  Their read never adds load (`holdUnderCheckin`). Empty or absent: every read as without it. */
    checkinHeld?: ReadonlySet<string>
  },
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
      preferredRepBand(opts.liftPreferences?.get(ex.exerciseName), goalRange(opts.trainingGoal, ex.exerciseRole)).repMax,
    )
    const judged = opts.checkinHeld?.has(ex.exerciseName) ? holdUnderCheckin(read) : read
    reads.push({ ...judged, sessionExerciseId: ex.id, exerciseName: ex.exerciseName, workoutSessionId: log.workoutSessionId })
  }
  return reads
}

export async function loadSessionReads(
  repo: WorkoutRepository,
  userId: string,
  program: Pick<Program, 'createdAt' | 'trainingGoal'>,
  session: Pick<ProgramSession, 'exercises'>,
  tz: string,
  liftPreferences?: ReadonlyMap<string, LiftPreference>,
): Promise<StoredSessionRead[]> {
  const from = dateStrMidnightInTz(shiftDateStr(todayInTz(tz), -SESSION_READ_LOOKBACK_DAYS), tz)
  // Worked out before either read starts: if this threw between the two calls, the first read's
  // promise would be left with nobody listening, and its failure would surface as an unhandled
  // rejection instead of the caller's "no read" (seen in CI on a session with no exercise list).
  const names = session.exercises.map(e => e.exerciseName)
  const [logs, equipment, checkinHeld] = await Promise.all([
    repo.getSessionReadLogs(userId, from, new Date()),
    repo.getExerciseEquipment(names),
    loadCheckinHeld(repo, userId, names, tz),
  ])
  return sessionReadsFor(session, logs ?? [], {
    programStart: program.createdAt,
    trainingGoal: program.trainingGoal,
    equipment: equipment ?? {},
    liftPreferences,
    checkinHeld,
  })
}

/**
 * #3890: the session's lifts that the check-in for this week (`applies_week_start` = this local Monday)
 * answered "Heavy". A failed read is no hold: the read is in shadow, and a missing hold only means the
 * read says what it would have said without the check-in.
 */
async function loadCheckinHeld(repo: WorkoutRepository, userId: string, names: string[], tz: string): Promise<ReadonlySet<string>> {
  if (names.length === 0 || typeof repo.listCheckinHeldLifts !== 'function') return new Set()
  try {
    return await repo.listCheckinHeldLifts(userId, startOfWeekInTz(tz), names)
  } catch (err) {
    console.error('[weekly-checkin] reading held lifts failed; reading sessions without them:', err)
    return new Set()
  }
}
