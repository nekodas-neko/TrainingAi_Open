// Issue 2802. `listBodyMetrics` returned tombstoned rows while every other body-metric read skipped
// them, so a deleted weigh-in would still have set the energy budget's resting rate and deficit.
//
// Runs only against a real local dev Postgres — skips without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002802'

describe.skipIf(!canRun)('listBodyMetrics skips tombstoned rows', () => {
  let pool: import('pg').Pool

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
    await pool.query(`INSERT INTO users (id, email, password_hash) VALUES ($1, 'bm-2802@example.com', 'x')`, [USER])
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, deleted_at) VALUES
         ($1, '2026-09-01', 80, NULL),
         ($1, '2026-09-02', 120, now())`, [USER])
  })
  afterAll(async () => {
    await pool?.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('returns the live weigh-in and not the deleted one', async () => {
    const { getRepository } = await import('@/lib/data')
    const rows = await (await getRepository()).listBodyMetrics(USER, '2026-09-01', '2026-09-03')
    expect(rows.map(r => [r.date, r.weightKg])).toEqual([['2026-09-01', 80]])
  })
})
