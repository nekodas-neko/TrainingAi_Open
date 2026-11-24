import type { PoolClient } from 'pg'
import { getPool } from '@/lib/data/postgres/client'
import { DECREMENT_SESSIONS_IN_PHASE_SQL } from '@/lib/data/postgres/slices/periodization'

/**
 * Soft-deletes a whole workout session and its exercise_logs + set_logs
 * (tombstoned via deleted_at, not hard-deleted), scoped to the owning user.
 * Returns the distinct exercise names so callers can reconcile personal
 * records afterward.
 *
 * Server-only path (mirrors DELETE /api/workout-entry). The tombstone lets
 * getSyncDelta propagate the delete to devices that haven't synced yet —
 * a hard delete is invisible to them and the session resurrects on pull.
 */
export async function deleteWorkoutSession(
  userId: string,
  workoutSessionId: string,
): Promise<{ deleted: boolean; exerciseNames: string[] }> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const done = await tombstoneWorkoutSessionInTx(client, userId, workoutSessionId, new Date().toISOString())
    if (done == null) {
      await client.query('ROLLBACK')
      return { deleted: false, exerciseNames: [] }
    }
    await client.query('COMMIT')
    return { deleted: true, exerciseNames: done.exerciseNames }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/**
 * The delete itself, inside a transaction the caller owns: tombstones the session, its exercise logs
 * and their sets, and keeps the phase counter honest. Null when the session is not the user's or is
 * already deleted (nothing written). Shared by `deleteWorkoutSession` and the #3802 clean-up job, so
 * the two cannot drift. The caller reconciles personal records for the returned names after commit.
 *
 * `liveChildrenOnly` (the #3802 job) leaves an exercise or set log that is already tombstoned as it
 * is, so its original `deleted_at` survives and the returned counts are the rows actually written.
 * The app's delete leaves it off, and its queries are unchanged: they re-stamp every child.
 */
export interface TombstonedSession {
  exerciseNames: string[]
  /** Rows each statement touched. */
  written: { sessions: number; exerciseLogs: number; setLogs: number; phaseCountersDecremented: number }
}

export async function tombstoneWorkoutSessionInTx(
  client: Pick<PoolClient, 'query'>,
  userId: string,
  workoutSessionId: string,
  now: string,
  opts: { liveChildrenOnly?: boolean } = {},
): Promise<TombstonedSession | null> {
  const liveOnly = opts.liveChildrenOnly ? ' AND deleted_at IS NULL' : ''
  const { rows: owned } = await client.query(
    `SELECT 1 FROM workout_sessions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [workoutSessionId, userId],
  )
  if (owned.length === 0) return null

  const { rows: nameRows } = await client.query<{ exercise_name: string }>(
    `SELECT DISTINCT el.exercise_name
     FROM exercise_logs el
     WHERE el.workout_session_id = $1`,
    [workoutSessionId],
  )
  const exerciseNames = nameRows.map(r => r.exercise_name)

  // Capture program-session + start time before delete to keep the
  // AI-periodization phase counter honest (mirrors workout-entry DELETE).
  const { rows: sessRows } = await client.query<{ session_id: string | null; started_at: Date; completed_at: Date | null }>(
    `SELECT session_id, started_at, completed_at FROM workout_sessions WHERE id = $1 AND user_id = $2`,
    [workoutSessionId, userId],
  )
  const programSessionId = sessRows[0]?.session_id ?? null
  const completedAt = sessRows[0]?.completed_at ?? null
  const startedAt = sessRows[0]?.started_at ?? null

  const ws = await client.query(
    `UPDATE workout_sessions SET deleted_at = $3, updated_at = $3 WHERE id = $1 AND user_id = $2`,
    [workoutSessionId, userId, now],
  )
  const el = await client.query(
    `UPDATE exercise_logs SET deleted_at = $2, updated_at = $2 WHERE workout_session_id = $1${liveOnly}`,
    [workoutSessionId, now],
  )
  const sl = await client.query(
    `UPDATE set_logs SET deleted_at = $2 WHERE exercise_log_id IN
       (SELECT id FROM exercise_logs WHERE workout_session_id = $1)${liveOnly}`,
    [workoutSessionId, now],
  )

  // Completing a session increments sessions_in_phase, so deleting one must
  // decrement it — but only when the deleted session fell inside the current
  // phase window (started_at >= phase_started_at, #4097; completed_at before that, #3799) AND was actually completed
  // (canonical definition, AI-5) — an abandoned session that never completed
  // was never counted, so deleting it must not decrement. Floor at 0.
  let phaseCountersDecremented = 0
  if (programSessionId && completedAt) {
    const d = await client.query(
      DECREMENT_SESSIONS_IN_PHASE_SQL,
      [userId, programSessionId, startedAt],
    )
    phaseCountersDecremented = d.rowCount ?? 0
  }
  return {
    exerciseNames,
    written: { sessions: ws.rowCount ?? 0, exerciseLogs: el.rowCount ?? 0, setLogs: sl.rowCount ?? 0, phaseCountersDecremented },
  }
}
