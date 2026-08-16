// D6 comparison-harness read: oura_heartrate rows filtered by source ('ble' vs 'chest_strap')
// in a wall-clock window. Runs only against a real local dev Postgres — skips cleanly in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d013'

describe.skipIf(!canRun)('getOuraHeartrateBySource', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `hr-by-source-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES
       ($1, '2026-07-27T00:00:10Z', 100, 'ble'),
       ($1, '2026-07-27T00:00:15Z', 102, 'chest_strap'),
       ($1, '2026-07-27T01:00:00Z', 90, 'ble')`,
      [TEST_USER_ID],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('filters by source and window', async () => {
    const rows = await repo.getOuraHeartrateBySource(
      TEST_USER_ID, 'ble', new Date('2026-07-27T00:00:00Z'), new Date('2026-07-27T00:30:00Z'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].bpm).toBe(100)
  })

  it('returns the other source unmixed', async () => {
    const rows = await repo.getOuraHeartrateBySource(
      TEST_USER_ID, 'chest_strap', new Date('2026-07-27T00:00:00Z'), new Date('2026-07-27T00:30:00Z'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].bpm).toBe(102)
  })

  it('excludes rows outside the window', async () => {
    const rows = await repo.getOuraHeartrateBySource(
      TEST_USER_ID, 'ble', new Date('2026-07-27T00:00:00Z'), new Date('2026-07-27T00:30:00Z'),
    )
    expect(rows.map(r => r.bpm)).not.toContain(90)
  })
})
