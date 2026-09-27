import { getPool } from '@/lib/data/postgres/client'

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

    const { rows: owned } = await client.query(
      `SELECT 1 FROM workout_sessions WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [workoutSessionId, userId],
    )
    if (owned.length === 0) {
      await client.query('ROLLBACK')
      return { deleted: false, exerciseNames: [] }
    }

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
    const startedAt = sessRows[0]?.started_at ?? null
    const wasCompleted = sessRows[0]?.completed_at != null

    const now = new Date().toISOString()
    await client.query(
      `UPDATE workout_sessions SET deleted_at = $3, updated_at = $3 WHERE id = $1 AND user_id = $2`,
      [workoutSessionId, userId, now],
    )
    await client.query(
      `UPDATE exercise_logs SET deleted_at = $2, updated_at = $2 WHERE workout_session_id = $1`,
      [workoutSessionId, now],
    )
    await client.query(
      `UPDATE set_logs SET deleted_at = $2 WHERE exercise_log_id IN
         (SELECT id FROM exercise_logs WHERE workout_session_id = $1)`,
      [workoutSessionId, now],
    )

    // Completing a session increments sessions_in_phase, so deleting one must
    // decrement it — but only when the deleted session fell inside the current
    // phase window (started_at >= phase_started_at) AND was actually completed
    // (canonical definition, AI-5) — an abandoned session that never completed
    // was never counted, so deleting it must not decrement. Floor at 0.
    if (programSessionId && startedAt && wasCompleted) {
      await client.query(
        `UPDATE session_periodization
         SET sessions_in_phase = GREATEST(sessions_in_phase - 1, 0), updated_at = now()
         WHERE user_id = $1 AND program_session_id = $2 AND $3 >= phase_started_at`,
        [userId, programSessionId, startedAt],
      )
    }

    await client.query('COMMIT')
    return { deleted: true, exerciseNames }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
