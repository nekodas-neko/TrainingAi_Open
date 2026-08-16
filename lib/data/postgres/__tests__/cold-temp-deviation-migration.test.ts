// Migration 155 (audit finding Q-6) — clear temperature deviations taken against a cold baseline.
//
// `updateBaseline` is a faithful ecore port that starts from meanX8 = 0. Correct for the ring, which
// carries its own accrued state; wrong for our fold, which cold-started — so the mean climbs from
// zero and the deviation against it is nonsense. Production held +17.000 degC on the second night,
// and it reached the AI health-insight prompt and the day-log surface verbatim.
//
// `computeDailySummaries` now withholds the value below BASELINE_MIN_NIGHTS, so a replay produces
// these NULLs; this migration corrects the rows already stored.
//
// Runs only against a real Postgres. CI's "Tests" job DOES set DATABASE_URL, so these run there.
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { migrationTestLock } from './migration-test-lock'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000015'

const migrationSql = () =>
  readFileSync(join(process.cwd(), 'lib/data/postgres/migrations/155_clear_cold_temp_deviation.sql'), 'utf8')

describe.skipIf(!canRun)('migration 155 — cold-baseline temperature deviation (Q-6)', () => {
  let pool: import('pg').Pool
  const lock = migrationTestLock(() => pool)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `q6-${TEST_USER_ID}@example.com`],
    )
  })

  afterEach(async () => { await lock.release() })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await lock.acquire()
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
  })

  async function seed(date: string, nHistory: number, tempDevC: number) {
    await pool.query(
      `INSERT INTO oura_daily_summary (user_id, date, n_history, temp_dev_c, temp_mean_c)
       VALUES ($1, $2, $3, $4, 35.5)`,
      [TEST_USER_ID, date, nHistory, tempDevC],
    )
  }

  const devOn = async (date: string) => {
    const { rows } = await pool.query(
      `SELECT temp_dev_c FROM oura_daily_summary WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, date])
    return rows[0].temp_dev_c as number | null
  }

  it('clears the deviation on a cold row', async () => {
    await seed('2026-07-09', 2, 17.0) // the real production value
    await pool.query(migrationSql())
    expect(await devOn('2026-07-09')).toBeNull()
  })

  it('keeps the deviation once the baseline is mature', async () => {
    await seed('2026-07-25', 19, 0.38)
    await pool.query(migrationSql())
    expect(Number(await devOn('2026-07-25'))).toBeCloseTo(0.38, 5)
  })

  it('treats exactly 14 nights as mature, matching the illness radar’s gate', async () => {
    await seed('2026-07-20', 14, 0.5)
    await seed('2026-07-19', 13, 0.9)
    await pool.query(migrationSql())
    expect(Number(await devOn('2026-07-20'))).toBeCloseTo(0.5, 5)
    expect(await devOn('2026-07-19')).toBeNull()
  })

  it('is idempotent — a second run matches nothing', async () => {
    await seed('2026-07-09', 2, 17.0)
    await seed('2026-07-25', 19, 0.38)
    await pool.query(migrationSql())
    await pool.query(migrationSql())
    expect(await devOn('2026-07-09')).toBeNull()
    expect(Number(await devOn('2026-07-25'))).toBeCloseTo(0.38, 5)
  })

  it('leaves the baseline checkpoint columns alone', async () => {
    // The fold resumes from these; changing them would break the "seed from a checkpoint reproduces
    // a full replay" property that lets the rollup process a bounded window.
    await pool.query(
      `INSERT INTO oura_daily_summary (user_id, date, n_history, temp_dev_c, temp_baseline_mean_x8, temp_baseline_dev_x8)
       VALUES ($1, '2026-07-09', 2, 17.0, 1480, 2102)`,
      [TEST_USER_ID])
    await pool.query(migrationSql())
    const { rows } = await pool.query(
      `SELECT temp_baseline_mean_x8, temp_baseline_dev_x8 FROM oura_daily_summary
        WHERE user_id = $1 AND date = '2026-07-09'`, [TEST_USER_ID])
    expect(rows[0].temp_baseline_mean_x8).toBe(1480)
    expect(rows[0].temp_baseline_dev_x8).toBe(2102)
  })
})
