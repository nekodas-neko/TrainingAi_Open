// `/api/day-log` prints each workout's start and end as display strings ("7:51 am"), and it built
// them with `fmtAest` and no timezone, so every user saw Brisbane's clock. Found while fixing the
// Preview Heart rate card's missing workout band (#2903), which had been parsing these strings.
//
// The user is in a fixed-offset zone 5 hours off Brisbane (Etc/GMT-5 is UTC+5), so the two readings
// can never agree. Anchored at midday of the user's local day, derived from the clock.
//
// Runs only against a real local dev Postgres; skips cleanly where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-0000002903a1'
const TZ = 'Etc/GMT-5'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('the day log prints workout times in the user’s timezone (#2903)', () => {
  let pool: import('pg').Pool
  let localDay: string
  let sessionId = ''
  let started: Date
  let completed: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    localDay = todayInTz(TZ).replace(/-/g, '/')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'day-log-tz@example.com', TZ],
    )
    const [y, m, d] = localDay.split('/').map(Number)
    started = new Date(Date.UTC(y, m - 1, d, 12 - 5, 0, 0)) // midday at UTC+5
    completed = new Date(started.getTime() + 45 * 60_000)
    const session = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Upper', $2, $3) RETURNING id`,
      [USER, started, completed],
    )
    sessionId = session.rows[0].id
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, time_to_complete)
       VALUES ($1, 'Row', $2, 120)`,
      [sessionId, new Date(started.getTime() + 10 * 60_000)],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  it('formats start and end on the user’s clock, not Brisbane’s', async () => {
    const { formatTimeOfDay } = await import('@trainingai/shared/date-utils')
    const { GET } = await import('@/app/api/day-log/route')
    const res = await GET(new Request(`http://localhost/api/day-log?date=${localDay}`) as never)
    expect(res.status).toBe(200)
    const row = (await res.json()).workoutDurationsById[sessionId]
    expect(row.start).toBe('12:00 pm')
    expect(row.start).toBe(formatTimeOfDay(started, TZ))
    expect(row.end).toBe(formatTimeOfDay(completed, TZ))
    expect(row.start).not.toBe(formatTimeOfDay(started, 'Australia/Brisbane'))
  })
})
