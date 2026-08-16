// Migration 186 (Q-228) — zero the deload log that migration 168's audited window missed.
//
// 168 fixed four exercises from the whole-session AI deload of 2026-08-06, auditing 21:47-22:09 UTC.
// Incline Bench Press was exercise 1 of that same session, logged at 21:41:20 — six minutes early —
// and kept `exercise_deloaded = true` alongside `estimated_1rm = 85.75` and `target_80 = 44.5`.
//
// The migration matches on the corrupted values rather than a user id, so what matters is that it
// corrects the row it means to, leaves neighbouring rows alone, and is a no-op the second time and
// on any database that never held it.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000000228'
const EX = 'Incline Bench Press'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/186_q228_deloaded_log_1rm_straggler.sql'), 'utf8')

describe.skipIf(!canRun)('migration 186 — the Q-115 deload straggler (Q-228)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)
  let sessionId: string

  // Row shapes are the production ones, so a change to either value in the migration's WHERE
  // stops matching here too.
  async function seedLog(loggedAt: string, deloaded: boolean, est: number, t80: number) {
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, estimated_1rm, target_80, exercise_deloaded, logged_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, EX, est, t80, deloaded, loggedAt],
    )
  }

  async function read(loggedAt: string) {
    const { rows } = await pool.query(
      `SELECT estimated_1rm::float8 AS est, target_80::float8 AS t80, exercise_deloaded AS deloaded
       FROM exercise_logs WHERE workout_session_id = $1 AND logged_at = $2`,
      [sessionId, loggedAt],
    )
    return rows[0]
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await lock.acquire()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'q228@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at)
       VALUES ($1, 'Q228 Upper', '2026-08-06T21:30:00Z') RETURNING id`, [USER])
    sessionId = ws.rows[0].id

    await seedLog('2026-08-06T21:41:20.634Z', true, 85.75, 44.5)   // the straggler
    await seedLog('2026-08-06T21:55:00Z', true, 0, 0)              // a sibling 168 already fixed
    await seedLog('2026-07-30T21:59:49.754Z', false, 78.75, 63)    // the real max before it
    await seedLog('2026-08-06T21:45:00Z', false, 85.75, 44.5)      // same values, NOT flagged

    await pool.query(migrationSql())
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
    await lock.release()
  })

  it('zeroes both estimated_1rm and target_80 on the straggler', async () => {
    const row = await read('2026-08-06T21:41:20.634Z')
    expect(row.est).toBe(0)
    // target_80 is the dial pre-fill as well as the displayed target, so leaving 44.5 behind would
    // be the same lie one field along — this is the half migration 168 never had to do.
    expect(row.t80).toBe(0)
    // The flag was already correct and must stay set: it is what marks this a deload at all.
    expect(row.deloaded).toBe(true)
  })

  it('leaves the real session before it untouched', async () => {
    const row = await read('2026-07-30T21:59:49.754Z')
    expect(row.est).toBe(78.75)
    expect(row.t80).toBe(63)
  })

  it('does not touch a row carrying the same values but not flagged as a deload', async () => {
    // The WHERE needs all three of name, flag and value. Matching on the value alone would reach
    // a legitimate 85.75 that happens to sit in the same hour.
    const row = await read('2026-08-06T21:45:00Z')
    expect(row.est).toBe(85.75)
    expect(row.t80).toBe(44.5)
  })

  it('is idempotent — a second run changes nothing', async () => {
    const res = await pool.query(migrationSql())
    expect(res.rowCount).toBe(0)
    expect((await read('2026-08-06T21:41:20.634Z')).est).toBe(0)
  })
})
