// #3150 — `workout_hr_stats.hr_dense`, shipped ahead of the code that writes and reads it. Proves
// the column exists as a nullable boolean, defaults to NULL for a row written without it (every
// existing row), and round-trips true / false / NULL through the Drizzle schema.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000003150c'
const WS = '00000000-0000-4000-8000-00000003150d'

describe.skipIf(!canRun)('workout_hr_stats.hr_dense column (#3150)', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let s: typeof import('@/lib/data/postgres/schema')

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    s = await import('@/lib/data/postgres/schema')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-3150-column@example.com'])
    await pool.query(
      `INSERT INTO workout_sessions (id, user_id, session_name, started_at, completed_at)
       VALUES ($1, $2, 'Push', now() - interval '2 days', now() - interval '2 days' + interval '1 hour') ON CONFLICT (id) DO NOTHING`,
      [WS, USER])
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) // cascades the session and its stats
  })

  it('is a nullable boolean', async () => {
    const { rows } = await pool.query(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'workout_hr_stats' AND column_name = 'hr_dense'`)
    expect(rows).toEqual([{ data_type: 'boolean', is_nullable: 'YES', column_default: null }])
  })

  it('is NULL on a row written without it, and round-trips true and false through the schema', async () => {
    await pool.query(
      `INSERT INTO workout_hr_stats (workout_session_id, user_id, avg_bpm, readings_count) VALUES ($1, $2, 120, 60)`,
      [WS, USER])
    const read = async () => (await db.select({ hrDense: s.workoutHrStats.hrDense })
      .from(s.workoutHrStats).where(eq(s.workoutHrStats.workoutSessionId, WS)))[0].hrDense
    expect(await read()).toBeNull()
    for (const v of [false, true, null]) {
      await db.update(s.workoutHrStats).set({ hrDense: v }).where(eq(s.workoutHrStats.workoutSessionId, WS))
      expect(await read()).toBe(v)
    }
  })
})
