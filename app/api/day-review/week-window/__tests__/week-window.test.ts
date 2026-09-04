// Q-112c: the prior-7-day comparison window the day review draws its trends from.
//
// Runs against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000112c'
// A fixed-offset zone, not Brisbane: the day-bucketing bug this window class keeps hitting only
// shows when local midnight is not UTC midnight, and Etc/GMT-10 is stable (no DST) so the case
// fires on every run rather than half the year.
const TZ = 'Etc/GMT-10'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('day-review week window (Q-112c)', () => {
  let pool: import('pg').Pool
  let today: string
  let shiftDateStr: typeof import('@trainingai/shared/date-utils').shiftDateStr
  let dateStrMidnightInTz: typeof import('@trainingai/shared/date-utils').dateStrMidnightInTz

  const call = async (params = '') => {
    const { GET } = await import('../route')
    return (await GET(new Request(`http://localhost/api/day-review/week-window${params}`))).json()
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const d = await import('@trainingai/shared/date-utils')
    pool = getPool()
    shiftDateStr = d.shiftDateStr
    dateStrMidnightInTz = d.dateStrMidnightInTz
    today = d.todayInTz(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [TEST_USER_ID, `week-window-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%day-review-week-window%'`)
  })

  it('returns eight ascending days ending at the anchor, and echoes the date', async () => {
    const body = await call()
    expect(body.date).toBe(today)
    expect(body.days).toHaveLength(8)
    expect(body.days[0].date).toBe(shiftDateStr(today, -7))
    expect(body.days[7].date).toBe(today)
    expect(body.days.map((d: { date: string }) => d.date)).toEqual([...body.days].sort((a, b) => a.date < b.date ? -1 : 1).map((d: { date: string }) => d.date))
  })

  it('a day with nothing recorded is null, never zero', async () => {
    const body = await call()
    // Zero would render as "you walked no steps", which is a claim; null is the absence of one.
    expect(body.days.every((d: { steps: number | null }) => d.steps === null)).toBe(true)
    expect(body.sevenDayAverages.steps).toBeNull()
  })

  it('averages the prior seven days and excludes the anchor day itself', async () => {
    // 60 on each of the seven prior days, 100 today. The mean must be 60, not 65 — including the
    // day being judged pulls its own baseline toward it and shrinks the delta it is compared against.
    for (let i = 1; i <= 7; i++) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, resting_heart_rate) VALUES ($1, $2, 60)`,
        [TEST_USER_ID, shiftDateStr(today, -i)])
    }
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, resting_heart_rate) VALUES ($1, $2, 100)`,
      [TEST_USER_ID, today])

    const body = await call()
    expect(body.days[7].restingHeartRate).toBe(100)
    expect(body.sevenDayAverages.restingHeartRate).toBeCloseTo(60, 5)
  })

  it('sums several sessions on one day, and buckets them by the USER\'s local day', async () => {
    // 01:00 local on the anchor day. In UTC that is the PREVIOUS calendar day for this zone, so a
    // window anchored on a ms offset — or bucketed in UTC — files it under the wrong day. That is
    // the failure this window class keeps repeating, and it is why the fixture uses a +10 zone.
    const localMidnight = dateStrMidnightInTz(today, TZ)
    const oneAmLocal = new Date(localMidnight.getTime() + 3_600_000)
    for (const volume of [1000, 500]) {
      const ws = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'week window fixture', $2, $2) RETURNING id`,
        [TEST_USER_ID, oneAmLocal])
      await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
         VALUES ($1, 'Bench Press', $2, $3)`,
        [ws.rows[0].id, volume, oneAmLocal])
    }

    const body = await call()
    expect(body.days[7].date).toBe(today)
    expect(body.days[7].sessionVolumeKg, 'both sessions land on the local day and are summed').toBe(1500)
  })

  it('rejects a malformed date rather than silently answering for today', async () => {
    expect((await call('?date=nonsense')).error).toContain('Invalid date')
  })

  it('accepts the slash date form the client emits', async () => {
    const body = await call(`?date=${today.replace(/-/g, '/')}`)
    expect(body.date).toBe(today)
  })
})
