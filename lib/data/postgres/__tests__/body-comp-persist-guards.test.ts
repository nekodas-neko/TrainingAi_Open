// persistBodyCompFromMetrics skips deleted weigh-ins, loads the calibration only when there is a row
// to persist, and does not write when that load fails.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-00000000bc02'

describe.skipIf(!canRun)('persistBodyCompFromMetrics guards', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>
  let persist: typeof import('@/lib/data/postgres/slices/oura').persistBodyCompFromMetrics
  const days = async () =>
    (await pool.query<{ day: string }>(`SELECT day::text FROM oura_daily_derived WHERE user_id = $1 ORDER BY day`, [USER]))
      .rows.map(r => r.day)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    persist = (await import('@/lib/data/postgres/slices/oura')).persistBodyCompFromMetrics
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER, `body-comp-${USER}@example.com`],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('leaves a deleted weigh-in out', async () => {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct, deleted_at) VALUES
         ($1, '2026-07-10', 80, 20, now()),
         ($1, '2026-07-11', 79, 19, NULL)`, [USER])
    expect(await persist(db, USER, async () => null)).toBe(1)
    expect(await days()).toEqual(['2026-07-11'])
  })

  it('does not load the calibration when there is nothing to persist', async () => {
    const load = vi.fn(async () => null)
    expect(await persist(db, USER, load)).toBe(0)
    expect(load).not.toHaveBeenCalled()
  })

  it('loads it once for many rows, and writes nothing when the load fails', async () => {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct) VALUES
         ($1, '2026-07-10', 80, 20), ($1, '2026-07-11', 79, 19)`, [USER])
    const load = vi.fn(async () => null)
    await persist(db, USER, load)
    expect(load).toHaveBeenCalledTimes(1)

    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await expect(persist(db, USER, async () => { throw new Error('read failed') })).rejects.toThrow('read failed')
    expect(await days()).toEqual([])
  })
})
