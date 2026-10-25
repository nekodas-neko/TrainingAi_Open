// listFitnessTests orders newest day first, and tests on one day by when they were last written
// (oldest first): the order the sync pull gives a device's local store, so the Preview app and the
// web app list same-day baselines the same way round.
//
// Runs only against a real local dev Postgres — skips cleanly elsewhere (CI's "Tests" job has no
// DATABASE_URL) so CI stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-00000000f17e'

describe.skipIf(!canRun)('listFitnessTests order', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'list-fitness-tests-order@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [USER],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM fitness_tests WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('lists the newest day first and same-day tests oldest-written first', async () => {
    const insert = (type: string, date: string, updated: string) =>
      pool.query(
        `INSERT INTO fitness_tests (user_id, date, test_type, updated_at) VALUES ($1, $2, $3, $4)`,
        [USER, date, type, updated],
      )
    // Written out of order on purpose, so neither insertion order nor the type name decides it.
    await insert('resting_hrr', '2026-10-10', '2026-10-10T02:00:00Z')
    await insert('cooper12', '2026-10-12', '2026-10-12T01:00:00Z')
    await insert('6mwt', '2026-10-10', '2026-10-10T01:00:00Z')
    // And a second day written the other way round, so no physical order can pass both.
    await insert('6mwt', '2026-10-05', '2026-10-05T02:00:00Z')
    await insert('resting_hrr', '2026-10-05', '2026-10-05T01:00:00Z')
    const rows = await repo.listFitnessTests(USER, '2026-10-01', '2026-10-31')
    expect(rows.map(r => `${r.date}:${r.testType}`)).toEqual([
      '2026-10-12:cooper12',
      '2026-10-10:6mwt',
      '2026-10-10:resting_hrr',
      '2026-10-05:resting_hrr',
      '2026-10-05:6mwt',
    ])
  })
})
