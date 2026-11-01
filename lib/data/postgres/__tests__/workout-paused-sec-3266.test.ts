// #3266: a workout records how long it was paused, and the day's energy takes that out of its
// duration. This runs the real UPDATE and the real read, which the unit mocks cannot: that the
// column is written, that an older build's completion leaves it NULL, and that a replay (which the
// guarded UPDATE refuses) does not rewrite it.
//
// Runs only against a real local dev Postgres — skips cleanly in CI's "Tests" job (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const TEST_USER_ID = '00000000-0000-4000-8000-000000003266'

describe.skipIf(!canRun)('workout_sessions.paused_sec (#3266)', () => {
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
      [TEST_USER_ID, `paused-sec-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  async function freshSession(): Promise<string> {
    const r = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at) VALUES ($1, '#3266', $2) RETURNING id`,
      [TEST_USER_ID, new Date(Date.now() - 2 * 60 * 60_000)],
    )
    return r.rows[0].id
  }
  const pausedOf = async (id: string) =>
    (await pool.query('SELECT paused_sec FROM workout_sessions WHERE id = $1', [id])).rows[0].paused_sec

  it('is NULL on a session that was never completed with a pause', async () => {
    expect(await pausedOf(await freshSession())).toBeNull()
  })

  it('stores the seconds with the completion, and reads them back as the session\'s pause', async () => {
    const id = await freshSession()
    expect(await repo.completeWorkoutSession(id, TEST_USER_ID, new Date(), 600)).toBe(true)
    expect(await pausedOf(id)).toBe(600)
    const detail = await repo.getWorkoutSessionDetail(TEST_USER_ID, id)
    expect(detail?.pausedSec).toBe(600)
  })

  it('leaves it NULL when the completing build does not send one', async () => {
    const id = await freshSession()
    expect(await repo.completeWorkoutSession(id, TEST_USER_ID, new Date())).toBe(true)
    expect(await pausedOf(id)).toBeNull()
    const detail = await repo.getWorkoutSessionDetail(TEST_USER_ID, id)
    expect(detail?.pausedSec).toBeNull()
  })

  it('does not rewrite it when a replay is refused', async () => {
    const id = await freshSession()
    await repo.completeWorkoutSession(id, TEST_USER_ID, new Date(), 600)
    expect(await repo.completeWorkoutSession(id, TEST_USER_ID, new Date(), 9_999)).toBe(false)
    expect(await pausedOf(id)).toBe(600)
  })

  it('takes the pause out of the year review\'s minutes, never more than the session', async () => {
    // The total is the user's, so the other tests' sessions are cleared first.
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    const id = await freshSession()
    const completedAt = new Date(Date.now() - 60 * 60_000)
    await repo.completeWorkoutSession(id, TEST_USER_ID, completedAt, 600)
    const from = new Date(Date.now() - 24 * 60 * 60_000 * 365)
    const totals = await repo.getYearReviewTotals(TEST_USER_ID, from)
    // One hour between start and completion, ten minutes of it paused.
    expect(Number(totals.totalMinutes)).toBeCloseTo(50, 0)
  })
})
