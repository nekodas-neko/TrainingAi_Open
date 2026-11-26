// #4166: the sync pull returns each set's "how did it feel" answer (`effort_vs_plan`, `effort_source`)
// beside its reps and weight, on a real Postgres (skips without DATABASE_URL). Fake user and lift only;
// no model call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000004166'

describe.skipIf(!canRun)('sync pull carries set answers (#4166)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const session = randomUUID()
  const exercise = randomUUID()
  const [answered, unanswered, removed] = [randomUUID(), randomUUID(), randomUUID()]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    repo = await (await import('@/lib/data')).getRepository()
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, `sync-set-effort-${USER}@example.com`],
    )
    await pool.query(`INSERT INTO workout_sessions (id, user_id, session_name, started_at) VALUES ($1, $2, 'Pull Test', now())`, [session, USER])
    await pool.query(`INSERT INTO exercise_logs (id, workout_session_id, exercise_name, logged_at) VALUES ($1, $2, 'Pull Test Squat', now())`, [exercise, session])
    await pool.query(
      `INSERT INTO set_logs (id, exercise_log_id, set_number, weight_kg, reps, effort_vs_plan, effort_source) VALUES
         ($1, $4, 1, 50, 5, 1, 'tapped'), ($2, $4, 2, 50, 5, NULL, NULL), ($3, $4, 3, 50, 5, NULL, NULL)`,
      [answered, unanswered, removed, exercise],
    )
    await pool.query(`UPDATE set_logs SET deleted_at = now() WHERE id = $1`, [removed])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('returns the answer on the set that holds it, null on a set with none, null on a removed set', async () => {
    const delta = await repo.getSyncDelta(USER, new Date(0))
    const byId = new Map((delta.setLogs as Record<string, unknown>[]).map(r => [r.id, r]))
    expect(byId.get(answered)).toMatchObject({ effortVsPlan: 1, effortSource: 'tapped' })
    expect(byId.get(unanswered)).toMatchObject({ effortVsPlan: null, effortSource: null })
    expect(byId.get(removed)).toMatchObject({ effortVsPlan: null, effortSource: null })
    expect(byId.get(removed)?.deletedAt).toBeTruthy()
  })
})
