// #3671 ①. A PR's "achieved" date was the upload time. Preview uploads at finish, or later when
// offline, so a PR set at 21:00 that synced the next morning was dated the next day.
//
// Runs only against a local dev Postgres; skips in CI's "Tests" job.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000367101'
const EXERCISE = 'PR Date Test Press 3671'

describe.skipIf(!canRun)('upsertPersonalRecordIfBetter dates the record by the set (#3671)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').Repository
  const achievedAt = async () => {
    const { rows } = await pool.query(
      `SELECT achieved_at FROM personal_records WHERE user_id = $1 AND exercise_name = $2`, [USER, EXERCISE])
    return (rows[0].achieved_at as Date).getTime()
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'pr3671@example.com', 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [USER])
  })
  beforeEach(async () => { await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER]) })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM personal_records WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('stores the set\'s time on the first record and on a better one', async () => {
    // Derived from the clock: yesterday evening and the evening before, local to nowhere in particular.
    const first = new Date(Date.now() - 36 * 3_600_000)
    const second = new Date(Date.now() - 12 * 3_600_000)
    expect(await repo.upsertPersonalRecordIfBetter(USER, EXERCISE, 100, first)).toBe(true)
    expect(await achievedAt()).toBe(first.getTime())
    expect(await repo.upsertPersonalRecordIfBetter(USER, EXERCISE, 105, second)).toBe(true)
    expect(await achievedAt()).toBe(second.getTime())
    // A lower estimate changes nothing, date included.
    expect(await repo.upsertPersonalRecordIfBetter(USER, EXERCISE, 90, new Date())).toBe(false)
    expect(await achievedAt()).toBe(second.getTime())
  })
})
