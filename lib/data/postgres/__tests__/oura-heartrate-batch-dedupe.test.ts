// Q-214: a duplicated timestamp inside one chest-strap batch used to discard the whole chunk.
//
// Postgres rejects an entire command whose VALUES list hits the same ON CONFLICT row twice
// ("ON CONFLICT DO UPDATE command cannot affect row a second time"), so `upsertOuraHeartrate`
// lost up to 5,000 points per failing batch — not just the duplicate. Seen live in production on
// 2026-08-13: eight consecutive 1 Hz retries, each failing identically, samples gone for good.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000ded2'

describe.skipIf(!canRun)('upsertOuraHeartrate — duplicate timestamps within one batch', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, 'hr-dedupe@local.dev', 'HR Dedupe')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID],
    )
  })

  afterEach(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('does not throw, and keeps the rest of the batch', async () => {
    const dup = new Date('2026-08-13T00:17:13Z')
    const rows = [
      { timestamp: new Date('2026-08-13T00:17:12Z'), bpm: 71, source: 'chest_strap' },
      { timestamp: dup, bpm: 72, source: 'chest_strap' },
      { timestamp: dup, bpm: 74, source: 'chest_strap' }, // the poison row
      { timestamp: new Date('2026-08-13T00:17:14Z'), bpm: 75, source: 'chest_strap' },
    ]

    await expect(repo.upsertOuraHeartrate(TEST_USER_ID, rows)).resolves.not.toThrow()

    const { rows: stored } = await pool.query<{ bpm: number }>(
      `SELECT bpm FROM oura_heartrate WHERE user_id = $1 ORDER BY timestamp`,
      [TEST_USER_ID],
    )
    // Three distinct timestamps survive — before the fix this batch stored zero rows.
    expect(stored.map(r => Number(r.bpm))).toEqual([71, 74, 75])
  })

  it('lets the last value win on the duplicated timestamp', async () => {
    const dup = new Date('2026-08-13T02:00:00Z')
    await repo.upsertOuraHeartrate(TEST_USER_ID, [
      { timestamp: dup, bpm: 60, source: 'chest_strap' },
      { timestamp: dup, bpm: 88, source: 'chest_strap' },
    ])

    const { rows: stored } = await pool.query<{ bpm: number }>(
      `SELECT bpm FROM oura_heartrate WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(stored).toHaveLength(1)
    expect(Number(stored[0].bpm)).toBe(88)
  })

  it('still upserts an existing row when a later batch repeats its timestamp', async () => {
    const at = new Date('2026-08-13T03:00:00Z')
    await repo.upsertOuraHeartrate(TEST_USER_ID, [{ timestamp: at, bpm: 55, source: 'chest_strap' }])
    await repo.upsertOuraHeartrate(TEST_USER_ID, [
      { timestamp: at, bpm: 65, source: 'chest_strap' },
      { timestamp: at, bpm: 66, source: 'chest_strap' },
    ])

    const { rows: stored } = await pool.query<{ bpm: number }>(
      `SELECT bpm FROM oura_heartrate WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(stored).toHaveLength(1)
    expect(Number(stored[0].bpm)).toBe(66)
  })
})
