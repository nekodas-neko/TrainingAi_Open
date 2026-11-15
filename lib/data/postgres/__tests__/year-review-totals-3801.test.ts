// #3801 item 1: the year review counts only completed workouts, and adds minutes only for a span
// the shared plausibility rule accepts (`plausibleSessionActiveMin`). Runs the real query against a
// local dev Postgres; skips cleanly where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000003801'

describe.skipIf(!canRun)('getYearReviewTotals (#3801)', () => {
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
      [TEST_USER_ID, `year-review-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  const DAY = 24 * 60 * 60_000
  async function session(daysAgo: number, spanMin: number | null, pausedSec: number | null = null) {
    const startedAt = new Date(Date.now() - daysAgo * DAY)
    const completedAt = spanMin == null ? null : new Date(startedAt.getTime() + spanMin * 60_000)
    await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at, paused_sec)
       VALUES ($1, '#3801', $2, $3, $4)`,
      [TEST_USER_ID, startedAt, completedAt, pausedSec],
    )
  }

  it('skips never-completed workouts and adds no minutes for an implausible span', async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await session(10, 60)          // counted: 60 min
    await session(9, 50, 600)      // counted: 50 − 10 paused = 40 min
    await session(8, 240)          // counted: exactly at the 4 h bound
    await session(7, 600)          // counted as a workout, but its 10 h span adds nothing
    await session(6, null)         // never completed: not counted at all
    await session(5, null)
    const totals = await repo.getYearReviewTotals(TEST_USER_ID, new Date(Date.now() - 365 * DAY))
    expect(totals.sessionCount).toBe(4)
    expect(totals.totalMinutes).toBe(60 + 40 + 240)
  })

  it('reads zero for a user with only unfinished workouts', async () => {
    await pool.query('DELETE FROM workout_sessions WHERE user_id = $1', [TEST_USER_ID])
    await session(3, null)
    const totals = await repo.getYearReviewTotals(TEST_USER_ID, new Date(Date.now() - 365 * DAY))
    expect(totals.sessionCount).toBe(0)
    expect(totals.totalMinutes).toBe(0)
  })
})
