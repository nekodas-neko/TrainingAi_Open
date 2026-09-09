// LB-64: the five-week series behind the weekly recap, which `/api/weekly-digest` computed and
// threw away because it returns only the model's prose.
//
// Runs against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000000b64'
// A fixed-offset zone, not Brisbane: the week-bucketing bug this window class keeps hitting only
// shows when local midnight is not UTC midnight, and Etc/GMT-10 is stable (no DST) so the case
// fires on every run rather than half the year.
const TZ = 'Etc/GMT-10'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

describe.skipIf(!canRun)('weekly-review month window (LB-64)', () => {
  let pool: import('pg').Pool
  let shiftDateStr: typeof import('@trainingai/shared/date-utils').shiftDateStr
  let weekStartForDay: typeof import('@trainingai/shared/date-utils').weekStartForDay
  let startOfWeekInTz: typeof import('@trainingai/shared/date-utils').startOfWeekInTz
  /** The last COMPLETED week — what the recap reviews, and what an absent param must resolve to. */
  let lastWeek: string

  const call = async (params = '') => {
    const { GET } = await import('../route')
    return (await GET(new Request(`http://localhost/api/weekly-review/month-window${params}`))).json()
  }

  const metric = (date: string, cols: { rhr?: number; steps?: number; weight?: number }) =>
    pool.query(
      `INSERT INTO body_metrics (user_id, date, resting_heart_rate, steps, weight_kg)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date) DO UPDATE SET
         resting_heart_rate = EXCLUDED.resting_heart_rate,
         steps = EXCLUDED.steps, weight_kg = EXCLUDED.weight_kg`,
      [TEST_USER_ID, date, cols.rhr ?? null, cols.steps ?? null, cols.weight ?? null],
    )

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const d = await import('@trainingai/shared/date-utils')
    pool = getPool()
    shiftDateStr = d.shiftDateStr
    weekStartForDay = d.weekStartForDay
    startOfWeekInTz = d.startOfWeekInTz
    lastWeek = d.shiftDateStr(d.startOfWeekInTz(TZ), -7)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [TEST_USER_ID, `month-window-${TEST_USER_ID}@example.com`, TZ],
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
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%weekly-review-month-window%'`)
  })

  it('returns five ascending weeks ending at the anchor, and echoes the week', async () => {
    const body = await call(`?weekStart=${lastWeek}`)
    expect(body.weekStart).toBe(lastWeek)
    expect(body.weeks.map((w: { weekStart: string }) => w.weekStart)).toEqual([
      shiftDateStr(lastWeek, -28), shiftDateStr(lastWeek, -21), shiftDateStr(lastWeek, -14),
      shiftDateStr(lastWeek, -7), lastWeek,
    ])
  })

  it('defaults to the last COMPLETED week, never the one in progress', async () => {
    // A Monday morning against an in-progress week reads as a ~100% drop; the digest reviews the
    // finished week for exactly that reason and this must agree with it.
    const body = await call()
    expect(body.weekStart).toBe(shiftDateStr(startOfWeekInTz(TZ), -7))
    expect(body.weekStart).not.toBe(startOfWeekInTz(TZ))
  })

  it('snaps any day of a week to its Monday rather than answering for a different week', async () => {
    const thursday = shiftDateStr(lastWeek, 3)
    const body = await call(`?weekStart=${thursday}`)
    expect(body.weekStart).toBe(weekStartForDay(thursday))
    expect(body.weekStart).toBe(lastWeek)
  })

  it('refuses a malformed week rather than silently substituting one', async () => {
    const { GET } = await import('../route')
    const res = await GET(new Request('http://localhost/api/weekly-review/month-window?weekStart=not-a-date'))
    expect(res.status).toBe(400)
  })

  it('means the daily metrics per week and leaves an unrecorded week null, never 0', async () => {
    // Two days in the recap week, none in the week before it.
    await metric(lastWeek, { rhr: 50, steps: 8000, weight: 70 })
    await metric(shiftDateStr(lastWeek, 1), { rhr: 54, steps: 10000, weight: 71 })

    const body = await call(`?weekStart=${lastWeek}`)
    const recap = body.weeks[4]
    expect(recap.restingHeartRate).toBe(52)
    expect(recap.steps).toBe(9000)   // mean DAILY steps, not the week's total
    expect(recap.weightKg).toBe(70.5)

    const empty = body.weeks[3]
    expect(empty.restingHeartRate).toBeNull()
    expect(empty.steps).toBeNull()
    expect(empty.weightKg).toBeNull()
  })

  it('sums session volume across a week rather than taking the last session', async () => {
    const session = async (day: string, volume: number) => {
      const { rows } = await pool.query(
        `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
         VALUES ($1, 'LB-64', $2::timestamptz, $2::timestamptz) RETURNING id`,
        [TEST_USER_ID, `${day}T02:00:00Z`],
      )
      const ws = rows[0].id
      const ex = await pool.query(
        `INSERT INTO exercise_logs (workout_session_id, exercise_name, volume, logged_at)
         VALUES ($1, 'Bench', $2, $3::timestamptz) RETURNING id`,
        [ws, volume, `${day}T02:00:00Z`],
      )
      return ex.rows[0].id
    }
    await session(lastWeek, 1000)
    await session(shiftDateStr(lastWeek, 2), 500)

    const body = await call(`?weekStart=${lastWeek}`)
    expect(body.weeks[4].sessionVolumeKg).toBe(1500)
  })

  it('averages the PRIOR weeks only, excluding the week being judged', async () => {
    // A window that contains the value being judged pulls its own baseline toward it, which is what
    // makes a delta read smaller than it is.
    await metric(shiftDateStr(lastWeek, -28), { rhr: 60 })
    await metric(shiftDateStr(lastWeek, -21), { rhr: 60 })
    await metric(shiftDateStr(lastWeek, -14), { rhr: 60 })
    await metric(shiftDateStr(lastWeek, -7), { rhr: 60 })
    await metric(lastWeek, { rhr: 40 })

    const body = await call(`?weekStart=${lastWeek}`)
    expect(body.priorAverages.restingHeartRate).toBe(60)
    expect(body.weeks[4].restingHeartRate).toBe(40)
  })

  it('leaves priorAverages null when the prior weeks recorded nothing', async () => {
    await metric(lastWeek, { rhr: 45 })
    const body = await call(`?weekStart=${lastWeek}`)
    expect(body.priorAverages.restingHeartRate).toBeNull()
  })
})
