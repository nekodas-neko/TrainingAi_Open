// Q-144: `getCalendarData` and `getRecentTrainedDays` used to hardcode `AT TIME ZONE
// 'Australia/Brisbane'` (and, in the calendar's case, a hand-rolled `- 10 hours` window boundary),
// so a user in any other zone had their sessions bucketed into Brisbane days.
//
// The case this locks in: 20:00 in New York is already the next day in Brisbane, so an evening
// workout appeared on the calendar a day late. For a New York user that is 14 of every 24 hours —
// most training hours — on both the calendar and the streak.
//
// The fixture instant is DERIVED FROM THE CLOCK, never hardcoded: `getRecentTrainedDays` anchors
// its window on today's local midnight, so a fixed date is one side of a rolling window and would
// eventually fall out of range and start passing vacuously (CLAUDE.md, Date Arithmetic).
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL

const NY_USER_ID = '00000000-0000-4000-8000-00000000744a'
const NY_TZ = 'America/New_York'
const BNE_TZ = 'Australia/Brisbane'

// Two days ago in New York, at 20:00 local — late enough that Brisbane has already rolled over.
const nyDayStr = formatInTimeZone(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), NY_TZ, 'yyyy-MM-dd')
const EVENING_IN_NY = fromZonedTime(`${nyDayStr}T20:00:00`, NY_TZ)

const expectedNyKey = formatInTimeZone(EVENING_IN_NY, NY_TZ, 'yyyy/MM/dd')
const expectedBneKey = formatInTimeZone(EVENING_IN_NY, BNE_TZ, 'yyyy/MM/dd')
const [year, month] = nyDayStr.split('-').map(Number)

describe.skipIf(!canRun)('calendar and streak bucket by the user\'s own timezone (Q-144)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  let sessionId: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [NY_USER_ID, `q144-${NY_USER_ID}@example.com`, NY_TZ],
    )

    const ws = await pool.query(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Evening Session', $2, $2) RETURNING id`,
      [NY_USER_ID, EVENING_IN_NY],
    )
    sessionId = ws.rows[0].id

    // Both reads inner-join exercise_logs, so the session only counts as "trained" with one.
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at)
       VALUES ($1, 'Bench Press', $2)`,
      [sessionId, EVENING_IN_NY],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM exercise_logs WHERE workout_session_id = $1`, [sessionId])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [NY_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [NY_USER_ID])
  })

  it('is a fixture where the two zones genuinely disagree', () => {
    // If this ever stops holding, every assertion below is trivially true and proves nothing.
    expect(expectedBneKey).not.toBe(expectedNyKey)
  })

  it('files the workout on the day the user actually trained', async () => {
    const { trainedDays } = await repo.getCalendarData(NY_USER_ID, year, month, NY_TZ)
    expect(Object.keys(trainedDays)).toContain(expectedNyKey)
    expect(Object.keys(trainedDays)).not.toContain(expectedBneKey)
  })

  it('still buckets a Brisbane user into Brisbane days — the old behaviour, where it is correct', async () => {
    // Guards against "fixed" meaning "now wrong for everyone else": the same instant genuinely is
    // the next day in Brisbane, so passing that zone must still return the later key.
    const bneMonth = Number(formatInTimeZone(EVENING_IN_NY, BNE_TZ, 'MM'))
    const bneYear = Number(formatInTimeZone(EVENING_IN_NY, BNE_TZ, 'yyyy'))
    const { trainedDays } = await repo.getCalendarData(NY_USER_ID, bneYear, bneMonth, BNE_TZ)
    expect(Object.keys(trainedDays)).toContain(expectedBneKey)
  })

  it('keys the streak window by the user\'s timezone too', async () => {
    // 90 days matches the real caller's window and comfortably contains a 2-day-old fixture.
    const trainedDays = await repo.getRecentTrainedDays(NY_USER_ID, 90, NY_TZ)
    expect(Object.keys(trainedDays)).toContain(expectedNyKey)
    expect(Object.keys(trainedDays)).not.toContain(expectedBneKey)
  })
})
