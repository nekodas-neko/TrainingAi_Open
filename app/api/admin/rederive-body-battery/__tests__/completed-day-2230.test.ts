// #2230 (TN-20) — a recompute must not overwrite a completed day with an empty one.
//
// Three things, each reproduced against Postgres before it was fixed:
//
// 1. The issue's pass test: re-running the recompute over a day the old write-through flattened
//    (0 samples, 0 charged, 0 drained, end = anchor) restores it from the stored HR samples. This
//    already held on `main`; it is pinned because #2409 is about to run the re-derive in production.
// 2. On a date with no morning night, an evening window (21:30–22:30) was the only night for the
//    date and became the wake anchor. The walk then started at 22:30, saw 16 samples, moved the
//    battery a little, passed the write guard, and replaced a measured day.
// 3. When the guard kept a stored day, the re-derive still reported it `written`, end-value delta
//    and all, although nothing changed in the table.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002230'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ, isAdmin: true } })),
}))

describe.skipIf(!canRun)('a recompute keeps a completed Body Battery day (#2230)', () => {
  let pool: import('pg').Pool
  let du: typeof import('@trainingai/shared/date-utils')
  let day: string
  let mid: number
  const at = (h: number) => new Date(mid + h * 3_600_000)

  const call = async (qs: string) => {
    const { POST } = await import('../route')
    const res = await POST(new NextRequest(`http://localhost/api/admin/rederive-body-battery?${qs}`, { method: 'POST' }))
    expect(res.status).toBe(200)
    return res.json()
  }
  const storedRow = async () => (await pool.query(
    `SELECT anchor, end_value, total_charged, total_drained, hr_sample_count, model_version
     FROM body_battery_daily WHERE user_id = $1 AND date = $2`, [USER, day],
  )).rows[0]
  const storeRow = (r: { end: number; charged: number; drained: number; samples: number }) => pool.query(
    `INSERT INTO body_battery_daily (user_id, date, anchor, anchor_source, end_value, day_min, day_max,
       total_charged, total_drained, resting_hr, hr_max, hr_sample_count, model_version)
     VALUES ($1, $2, 55, 'readiness', $3, 0, 55, $4, $5, 60, 170, $6, 'v5:old')`,
    [USER, day, r.end, r.charged, r.drained, r.samples],
  )
  const storeSleep = (startH: number, endH: number, hours: number) => pool.query(
    `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency)
     VALUES ($1, $2, $3, $4, $5, 90)`, [USER, day, at(startH), at(endH), hours],
  )
  /** A reading every 5 minutes from `fromH` to `toH`: resting overnight and evening, working by day. */
  const storeHr = async (fromH: number, toH: number) => {
    const values: string[] = []
    const params: unknown[] = [USER]
    const stamps: number[] = []
    for (let m = Math.round(fromH * 60); m <= Math.round(toH * 60); m += 5) {
      values.push(`($1, $${params.length + 1}, $${params.length + 2}, 'ble')`)
      params.push(at(m / 60).toISOString(), m > 9 * 60 && m < 18 * 60 ? 105 : 58)
      stamps.push(at(m / 60).getTime())
    }
    await pool.query(`INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${values.join(',')}`, params)
    return stamps
  }

  /** The night that ended this morning, and tonight's broken onset, dated to the same day. */
  const MORNING_NIGHT = [-2.55, 5.9, 7.83] as const
  const EVENING_WINDOW = [21.5, 22.5, 1] as const

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    du = await import('@trainingai/shared/date-utils')
    pool = getPool()
    day = du.shiftDateStr(du.todayInTz(TZ), -1)
    mid = du.dateStrMidnightInTz(day, TZ).getTime()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin, is_active) VALUES ($1, $2, 'x', $3, true, true)
       ON CONFLICT (id) DO UPDATE SET is_admin = true, is_active = true`, [USER, `n2230-${USER}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['body_battery_daily', 'oura_heartrate', 'sleep_sessions']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    for (const t of ['body_battery_daily', 'oura_heartrate', 'sleep_sessions']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%rederive-body-battery%'`)
  })

  it('restores a flattened day from its stored samples (the issue\'s pass test)', async () => {
    await storeSleep(...MORNING_NIGHT)
    await storeSleep(...EVENING_WINDOW)
    const stamps = await storeHr(6, 23.9)
    await storeRow({ end: 55, charged: 0, drained: 0, samples: 0 })

    const body = await call(`from=${day}&to=${day}&dryRun=false`)
    const d = body.days[0]
    expect(d.action).toBe('written')
    expect(d.recomputed.hrSampleCount).toBe(stamps.length)
    expect(d.recomputed.drained).toBeGreaterThan(0)

    const row = await storedRow()
    expect(row.anchor).toBe(55)
    expect(row.hr_sample_count).toBe(stamps.length)
    expect(Number(row.total_drained)).toBe(d.recomputed.drained)
    expect(row.model_version).toBe(body.modelVersion)
  })

  it('an evening window on a nightless date does not cut the day down to its last hour', async () => {
    await storeSleep(...EVENING_WINDOW)
    const stamps = await storeHr(0.5, 23.9)
    await storeRow({ end: 10, charged: 20, drained: 65, samples: 260 })

    const body = await call(`from=${day}&to=${day}&dryRun=false`)
    const d = body.days[0]
    // Before the fix the wake sat at 22:30 and the walk saw 16 of these.
    expect(d.recomputed.hrSampleCount).toBe(stamps.length)
    expect(d.recomputed.drained).toBeGreaterThan(0)
    expect((await storedRow()).hr_sample_count).toBe(stamps.length)
  })

  it('the live read at 22:43 walks the whole day too', async () => {
    await storeSleep(...EVENING_WINDOW)
    const stamps = await storeHr(0.5, 23.9)
    const until = at(22 + 43 / 60)
    const { getRepository } = await import('@/lib/data')
    const { computeBodyBatteryDay } = await import('@/lib/health/body-battery-day')
    const { response, snapshot } = await computeBodyBatteryDay({
      repo: await getRepository(), userId: USER, tz: TZ, date: day, until, computeReadinessIfMissing: false,
    })
    expect(response.wakeTime).toBe(stamps[0])
    expect(snapshot.hrSampleCount).toBe(stamps.filter(t => t <= until.getTime()).length)
  })

  it('a day the guard keeps is reported as kept, in a dry run and a real one', async () => {
    // A measured day whose recompute has no HR to walk: the guard refuses to flatten it.
    await storeSleep(...MORNING_NIGHT)
    await storeRow({ end: 10, charged: 5, drained: 50, samples: 900 })

    for (const qs of [`from=${day}&to=${day}`, `from=${day}&to=${day}&dryRun=false`]) {
      const body = await call(qs)
      expect(body.days[0].action).toBe('kept')
      expect(body.summary.written).toBe(0)
      expect(body.summary.kept).toBe(1)
      expect(body.summary.endValueDelta.mean).toBeNull()
    }
    expect(await storedRow()).toMatchObject({ end_value: 10, total_drained: 50, hr_sample_count: 900, model_version: 'v5:old' })
  })
})
