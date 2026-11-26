// #4154: migration 202611252323 adds the per-set effort answer to set_logs. Nothing reads or
// writes the columns yet (#4155 does), so this pins the migration itself: it re-runs cleanly, the
// columns are nullable with no default, an existing row reads NULL, and the CHECKs refuse a bad
// value and one column without the other.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock, runMigrationSql } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000004154'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/202611252323_set_log_effort_vs_plan.sql'), 'utf8')

describe.skipIf(!canRun)('migration 202611252323 — set_logs effort answer (#4154)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)
  let logId: string
  let setId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `set-effort-${TEST_USER_ID}@example.com`],
    )
    const session = await pool.query<{ id: string }>(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Test session', '2026-11-25T02:00:00Z') RETURNING id`, [TEST_USER_ID])
    const log = await pool.query<{ id: string }>(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at)
       VALUES ($1, 'Test lift', '2026-11-25T02:30:00Z') RETURNING id`, [session.rows[0].id])
    logId = log.rows[0].id
    // A set written without the new columns stands in for every row that exists today.
    const set = await pool.query<{ id: string }>(
      `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps)
       VALUES ($1, 1, 60, 5) RETURNING id`, [logId])
    setId = set.rows[0].id
  })

  beforeEach(async () => { await lock.acquire() })
  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const setAnswer = (effort: number | null, source: string | null) =>
    pool.query(`UPDATE set_logs SET effort_vs_plan = $2, effort_source = $3 WHERE id = $1`,
      [setId, effort, source])

  it('re-runs cleanly and leaves nullable columns with no default', async () => {
    await runMigrationSql(pool, migrationSql())
    await runMigrationSql(pool, migrationSql())
    const { rows } = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'set_logs' AND column_name IN ('effort_vs_plan', 'effort_source')
       ORDER BY column_name`)
    expect(rows).toEqual([
      { column_name: 'effort_source', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'effort_vs_plan', data_type: 'smallint', is_nullable: 'YES', column_default: null },
    ])
    const checks = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname IN
         ('set_logs_effort_vs_plan_check', 'set_logs_effort_source_check', 'set_logs_effort_pair_check')`)
    expect(checks.rowCount).toBe(3)
  })

  it('reads NULL for both on an existing row', async () => {
    const { rows } = await pool.query(
      `SELECT effort_vs_plan, effort_source FROM set_logs WHERE id = $1`, [setId])
    expect(rows[0]).toEqual({ effort_vs_plan: null, effort_source: null })
  })

  it('accepts -1, 0, +1 with either source, and NULL for both', async () => {
    for (const effort of [-1, 0, 1]) {
      for (const source of ['tapped', 'default']) {
        await expect(setAnswer(effort, source)).resolves.toMatchObject({ rowCount: 1 })
      }
    }
    await expect(setAnswer(null, null)).resolves.toMatchObject({ rowCount: 1 })
  })

  it('accepts a new set inserted with each allowed pair', async () => {
    let n = 10
    for (const effort of [-1, 0, 1]) {
      for (const source of ['tapped', 'default']) {
        await expect(pool.query(
          `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, effort_vs_plan, effort_source)
           VALUES ($1, $2, 60, 5, $3, $4)`, [logId, n++, effort, source])).resolves.toMatchObject({ rowCount: 1 })
      }
    }
  })

  it('refuses an effort of 2 and a source of "other"', async () => {
    await expect(setAnswer(2, 'tapped')).rejects.toMatchObject({
      code: '23514', constraint: 'set_logs_effort_vs_plan_check' })
    await expect(setAnswer(0, 'other')).rejects.toMatchObject({
      code: '23514', constraint: 'set_logs_effort_source_check' })
  })

  it('refuses one column without the other', async () => {
    await expect(setAnswer(1, null)).rejects.toMatchObject({
      code: '23514', constraint: 'set_logs_effort_pair_check' })
    await expect(setAnswer(null, 'tapped')).rejects.toMatchObject({
      code: '23514', constraint: 'set_logs_effort_pair_check' })
  })
})
