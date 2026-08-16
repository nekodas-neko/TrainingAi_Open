// Migration 152 (audit finding Q-13) — backfill volume for bodyweight logs that recorded zero.
//
// The migration targets specific production row ids, so what is testable here is the behaviour that
// runs everywhere: it must be inert on a database that does not carry those rows (every fresh, dev
// and CI database), and it must never overwrite a volume that is already non-zero.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000013'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/152_bodyweight_volume.sql'), 'utf8')

/** One of the ids the migration targets, with the volume it backfills. */
const TARGET_ID = '101055ec-6184-470c-a8ae-ed046b1fc03b'
const TARGET_VOLUME = 344

describe.skipIf(!canRun)('migration 152 — bodyweight volume backfill (Q-13)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `q13-${TEST_USER_ID}@example.com`],
    )
  })

  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await lock.acquire()
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
  })

  /** Seeds an exercise log with the given id and volume, returning its id. */
  async function seedLog(id: string, volume: number) {
    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Q13', now(), now()) RETURNING id`,
      [TEST_USER_ID],
    )
    await pool.query(
      `INSERT INTO exercise_logs (id, workout_session_id, exercise_name, volume, logged_at)
       VALUES ($1::uuid, $2, 'Pull-Up', $3::double precision, now())`,
      [id, ws.rows[0].id, volume],
    )
  }

  it('is inert on a database without the targeted rows', async () => {
    // Every fresh, dev and CI database is in this state — it must match nothing rather than error.
    await seedLog('11111111-1111-4111-8111-111111111111', 0)
    await pool.query(migrationSql())
    const [row] = (await pool.query(
      `SELECT volume FROM exercise_logs WHERE id = '11111111-1111-4111-8111-111111111111'`)).rows
    expect(Number(row.volume)).toBe(0)
  })

  it('fills a targeted row that is still sitting at zero', async () => {
    await seedLog(TARGET_ID, 0)
    await pool.query(migrationSql())
    const [row] = (await pool.query(`SELECT volume FROM exercise_logs WHERE id = $1`, [TARGET_ID])).rows
    expect(Number(row.volume)).toBeCloseTo(TARGET_VOLUME, 2)
  })

  it('never overwrites a volume that is already non-zero, and re-runs as a no-op', async () => {
    // The guard is what makes this safe to re-apply and safe against a row edited since.
    await seedLog(TARGET_ID, 999)
    await pool.query(migrationSql())
    let [row] = (await pool.query(`SELECT volume FROM exercise_logs WHERE id = $1`, [TARGET_ID])).rows
    expect(Number(row.volume)).toBe(999)

    await pool.query(`UPDATE exercise_logs SET volume = 0 WHERE id = $1`, [TARGET_ID])
    await pool.query(migrationSql())
    await pool.query(migrationSql())
    ;[row] = (await pool.query(`SELECT volume FROM exercise_logs WHERE id = $1`, [TARGET_ID])).rows
    expect(Number(row.volume)).toBeCloseTo(TARGET_VOLUME, 2)
  })
})
