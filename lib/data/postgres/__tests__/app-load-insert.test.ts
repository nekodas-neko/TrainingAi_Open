// BF-19 — the stored half of app-load telemetry: a row lands, and a missing response-start stays
// null rather than becoming a zero. (The admin report that read these back was retired in #2862.)
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000019001'

describe.skipIf(!canRun)('app-load insert (BF-19)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    for (const id of [USER]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
         ON CONFLICT (id) DO NOTHING`, [id, `app-load-${id}@example.com`])
    }
  })

  afterAll(async () => {
    if (!canRun) return
    for (const id of [USER]) {
      await pool.query(`DELETE FROM app_load_metrics WHERE user_id = $1`, [id])
      await pool.query(`DELETE FROM users WHERE id = $1`, [id])
    }
  })

  it('keeps a null response-start rather than storing a zero', async () => {
    await repo.insertAppLoadMetric({ userId: USER, route: '/', totalMs: 900, cold: true, responseStartMs: null })
    const { rows } = await pool.query(
      `SELECT response_start_ms FROM app_load_metrics WHERE user_id = $1`, [USER])
    expect(rows[0].response_start_ms).toBeNull()
  })
})
