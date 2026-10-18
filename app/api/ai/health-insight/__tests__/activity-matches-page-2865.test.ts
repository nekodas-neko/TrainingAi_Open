// #2865 — the Activity insight quoted 73/100 and 3 sessions while the Activity page showed 79 and 4.
//
// The insight built its own strength window from UTC midnight and scored without the zone-minute,
// move-hour and ACWR lanes. In Brisbane (UTC+10) a session before 10 am, seven days ago, sat inside
// the page's window and outside the insight's. This pins the insight to the page's numbers: today
// it must quote exactly what /api/readiness-score serves, and a past day the score that route
// stored and the same local-midnight window.
//
// Fixtures sit at local midday, except the two sessions that ARE the boundary case: 06:00 local is
// after local midnight and before UTC midnight, which is the whole of the defect. The clock is
// frozen (Date only, so the pool's timers still run), so nothing here rolls with the real date.
//
// Runs only against a real Postgres — skips without DATABASE_URL (CI's Tests job sets one). No
// model is involved: the route has made no AI call since RV-201, and `ai` is deliberately unmocked
// so a regression that reached the SDK would fail here rather than spend the shared key.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TZ = 'Australia/Brisbane'
const TEST_USER_ID = '00000000-0000-4000-8000-000000002865'
const TODAY = '2026-09-16'
// 12:00 local on TODAY. Brisbane has no DST, so the offset is fixed at +10.
const NOW = new Date('2026-09-16T02:00:00.000Z')

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

/** `day` at `hh`:00 Brisbane time. */
const local = (day: string, hh: number) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00.000+10:00`)

describe.skipIf(!canRun)('Activity insight reads the page’s numbers (#2865)', () => {
  let pool: import('pg').Pool
  let shiftDateStr: (d: string, n: number) => string

  const insight = async (date: string) => {
    const { POST } = await import('../route')
    const res = await POST(new Request('http://localhost/api/ai/health-insight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ section: 'activity', date }),
    }))
    expect(res.status).toBe(200)
    return ((await res.json()) as { insight: string }).insight
  }

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW })
    const { getPool } = await import('@/lib/data/postgres/client')
    ;({ shiftDateStr } = await import('@trainingai/shared/date-utils'))
    pool = getPool()
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)`,
      [TEST_USER_ID, `activity-insight-${TEST_USER_ID}@example.com`, TZ],
    )
    // Ten days of resting HR give the page a baseline, which is what turns on its zone-minute and
    // move-hour lanes — two of the three lanes the insight used to leave out.
    for (let i = 0; i <= 10; i++) {
      const day = shiftDateStr(TODAY, -i)
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, resting_heart_rate, weight_kg, steps, active_calories)
         VALUES ($1, $2, 55, 80, $3, $4)`,
        [TEST_USER_ID, day, i === 0 ? 6500 : 9000, i === 0 ? 320 : 450],
      )
    }
    // Today's intraday HR, a sample a minute from local midnight to now, with a brisk half hour.
    const from = local(TODAY, 0).getTime()
    for (let t = from; t < NOW.getTime(); t += 60_000) {
      const minute = (t - from) / 60_000
      const bpm = minute >= 540 && minute < 570 ? 135 : 72
      await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, $3, 'ble')`,
        [TEST_USER_ID, new Date(t), bpm],
      )
    }
    const session = async (startedAt: Date, kg: number) => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'Session', $2, $3) RETURNING id`,
        [TEST_USER_ID, startedAt, new Date(startedAt.getTime() + 3_600_000)],
      )
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, volume) VALUES ($1, 'Bench Press', $2, $3)`,
        [rows[0].id, startedAt, kg],
      )
    }
    await session(local(shiftDateStr(TODAY, -8), 6), 2000)  // in yesterday's window only — boundary
    await session(local(shiftDateStr(TODAY, -7), 6), 3000)  // in both windows — boundary; UTC dropped it
    await session(local(shiftDateStr(TODAY, -3), 12), 4000)
    await session(local(shiftDateStr(TODAY, -1), 12), 5000)
    await session(local(TODAY, 9), 6000)                     // today's own window only
  })

  afterAll(async () => {
    vi.useRealTimers()
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades
  })

  it('today: quotes the page’s Activity score and session count', async () => {
    const { GET } = await import('@/app/api/readiness-score/route')
    const page = await (await GET()).json()

    // Not vacuous: the page has a score, the lanes the insight used to skip are live, and the
    // window holds the 06:00 session from seven days ago that the UTC window dropped.
    expect(page.activityScore).not.toBeNull()
    expect(page.activitySignals.zoneMinutes).not.toBeNull()
    expect(page.activitySignals.sessions7d).toBe(4)

    const text = await insight(TODAY)
    expect(text).toContain(`Activity is ${page.activityScore}/100`)
    expect(text).toContain(`${page.activitySignals.sessions7d} session(s)`)
    expect(text).toContain(`${Math.round(page.activitySignals.volume7dKg)} kg total volume`)
  })

  it('a past day: quotes the stored score and counts from that day’s local midnight', async () => {
    const yesterday = shiftDateStr(TODAY, -1)
    await pool.query(
      `INSERT INTO oura_daily_derived (user_id, day, activity_score) VALUES ($1, $2, 64)
       ON CONFLICT (user_id, day) DO UPDATE SET activity_score = 64`,
      [TEST_USER_ID, yesterday],
    )
    const text = await insight(yesterday)
    expect(text).toContain('Activity is 64/100')
    // Eight days back at 06:00 counts, today's 09:00 session does not.
    expect(text).toContain('4 session(s)')
    expect(text).toContain('14000 kg total volume')
  })
})
