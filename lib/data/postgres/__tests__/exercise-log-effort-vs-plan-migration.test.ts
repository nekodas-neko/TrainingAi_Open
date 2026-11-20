// #3892: migration 202611200539 adds the per-exercise effort answer to exercise_logs. Nothing reads
// or writes the columns yet (#3745 does), so this pins the migration itself: it re-runs cleanly,
// the columns are nullable with no default, and each CHECK refuses anything outside its set.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000003892'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/202611200539_exercise_log_effort_vs_plan.sql'), 'utf8')

describe.skipIf(!canRun)('migration 202611200539 — exercise_logs effort answer (#3892)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)
  let logId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `effort-${TEST_USER_ID}@example.com`],
    )
    const session = await pool.query<{ id: string }>(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Test session', '2026-11-19T02:00:00Z') RETURNING id`, [TEST_USER_ID])
    const log = await pool.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at)
       VALUES ($1, 'Test lift', '2026-11-19T02:30:00Z') RETURNING id`, [session.rows[0].id])
    logId = log.rows[0].id
  })

  beforeEach(async () => { await lock.acquire() })
  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const setAnswer = (effort: number | null, source: string | null) =>
    pool.query(`UPDATE exercise_logs SET effort_vs_plan = $2, effort_source = $3 WHERE id = $1`,
      [logId, effort, source])

  it('re-runs cleanly and leaves nullable columns with no default', async () => {
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migrationSql())
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'exercise_logs' AND column_name IN ('effort_vs_plan', 'effort_source')
       ORDER BY column_name`)
    expect(rows).toEqual([
      { column_name: 'effort_source', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'effort_vs_plan', data_type: 'smallint', is_nullable: 'YES', column_default: null },
    ])
    const checks = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname IN
         ('exercise_logs_effort_vs_plan_check', 'exercise_logs_effort_source_check')`)
    expect(checks.rowCount).toBe(2)
  })

  it('accepts -1, 0, +1 with either source, and NULL for both', async () => {
    for (const effort of [-1, 0, 1]) {
      for (const source of ['tapped', 'default']) {
        await expect(setAnswer(effort, source)).resolves.toMatchObject({ rowCount: 1 })
      }
    }
    await expect(setAnswer(null, null)).resolves.toMatchObject({ rowCount: 1 })
  })

  it('refuses an effort of 2 and a source of "other"', async () => {
    await expect(setAnswer(2, 'tapped')).rejects.toMatchObject({
      code: '23514', constraint: 'exercise_logs_effort_vs_plan_check' })
    await expect(setAnswer(0, 'other')).rejects.toMatchObject({
      code: '23514', constraint: 'exercise_logs_effort_source_check' })
  })
})
