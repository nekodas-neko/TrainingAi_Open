import { sql } from 'drizzle-orm'
import type { getDb } from '../client'

type Db = ReturnType<typeof getDb>

// Counts FINISHED workouts only (`completed_at IS NOT NULL`) — owner decision, audit finding Q-8.
// Before this, sessions and volume used different definitions of "a workout": the session count was
// "has at least one log" while volume and sets swept in every started-and-abandoned session too,
// which was ~26% of the owner's displayed lifetime volume. Migration 146 stamps `completed_at` on
// the historical sessions that genuinely finished before the completion flow was reliable, so
// counting completed-only does not silently discard real training.
//
// user_stats totals are a fast-path counter incremented in logExerciseAndSets
// (replay-guarded) but never decremented on any delete — a direct DB edit,
// tombstoned session, or deleted set permanently inflates them, which then
// mis-gates XP/achievements. Deriving from source-of-truth tables self-heals
// the drift (SYNC-T1), mirroring reconcileSessionsInPhase's pattern. The
// derive query has no GROUP BY, so it always returns exactly one aggregate
// row (zeros for a user with no sessions) rather than silently no-op-ing —
// otherwise a user whose sessions were all deleted would never zero out.
export async function reconcileUserStats(db: Db, userId: string): Promise<void> {
  // Three independent scalar subqueries, not one query joining exercise_logs to
  // set_logs — a single JOIN would duplicate each exercise_log's volume once per
  // matching set_log row (a 1-exercise/2-set session would double-count volume).
  const [derived] = (await db.execute(sql`
    SELECT
      (SELECT COUNT(DISTINCT ws.id) FROM workout_sessions ws
        JOIN exercise_logs el ON el.workout_session_id = ws.id AND el.deleted_at IS NULL
        WHERE ws.user_id = ${userId}::uuid AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL)::int AS sessions,
      (SELECT COALESCE(SUM(el.volume), 0) FROM exercise_logs el
        JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = ${userId}::uuid AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL
          AND el.deleted_at IS NULL)::float AS volume,
      (SELECT COUNT(sl.id) FROM set_logs sl
        JOIN exercise_logs el ON el.id = sl.exercise_log_id
        JOIN workout_sessions ws ON ws.id = el.workout_session_id
        WHERE ws.user_id = ${userId}::uuid AND ws.deleted_at IS NULL AND ws.completed_at IS NOT NULL
          AND el.deleted_at IS NULL AND sl.deleted_at IS NULL)::int AS sets
  `)).rows as { sessions: number; volume: number; sets: number }[]

  await db.execute(sql`
    INSERT INTO user_stats (user_id, total_sessions, total_volume_kg, total_sets, updated_at)
    VALUES (${userId}::uuid, ${derived.sessions}, ${derived.volume}, ${derived.sets}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      total_sessions  = EXCLUDED.total_sessions,
      total_volume_kg = EXCLUDED.total_volume_kg,
      total_sets      = EXCLUDED.total_sets,
      updated_at      = NOW()
    WHERE user_stats.total_sessions <> EXCLUDED.total_sessions
       OR user_stats.total_volume_kg <> EXCLUDED.total_volume_kg
       OR user_stats.total_sets <> EXCLUDED.total_sets
  `)
}
