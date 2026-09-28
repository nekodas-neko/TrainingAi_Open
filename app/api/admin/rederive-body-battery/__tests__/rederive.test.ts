// TN-72: re-derive stored Body Battery days under the current model.
//
// What must hold: a finished day is walked midnight to midnight (not stopped at the moment the
// admin call runs), the day's frozen anchor is kept rather than re-chosen, nothing is invented for a
// day with no stored row, today is left to the live route, and nothing is written without dryRun=false.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b0072'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ, isAdmin: true } })),
}))

describe.skipIf(!canRun)('rederive-body-battery (TN-72)', () => {
  let pool: import('pg').Pool
  let du: typeof import('@trainingai/shared/date-utils')
  let yesterday: string
  let twoAgo: string
  let seededSamples: number

  const call = async (qs: string) => {
    const { POST } = await import('../route')
    const res = await POST(new NextRequest(`http://localhost/api/admin/rederive-body-battery?${qs}`, { method: 'POST' }))
    expect(res.status).toBe(200)
    return res.json()
  }
  const storedRow = async (date: string) => (await pool.query(
    `SELECT anchor, end_value, model_version FROM body_battery_daily WHERE user_id = $1 AND date = $2`, [USER, date],
  )).rows[0]

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    du = await import('@trainingai/shared/date-utils')
    pool = getPool()
    const today = du.todayInTz(TZ)
    yesterday = du.shiftDateStr(today, -1)
    twoAgo = du.shiftDateStr(today, -2)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, is_admin) VALUES ($1, $2, 'x', $3, true)
       ON CONFLICT (id) DO UPDATE SET is_admin = true`,
      [USER, `tn72-${USER}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['body_battery_daily', 'oura_heartrate']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  beforeEach(async () => {
    for (const t of ['body_battery_daily', 'oura_heartrate']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    const { _resetRateLimitL1, _awaitRateLimitFlushes } = await import('@/lib/rate-limit')
    await _awaitRateLimitFlushes()
    _resetRateLimitL1()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%rederive-body-battery%'`)

    // Yesterday: a v5 row that ended at 10 from an anchor of 70, and resting HR every 5 minutes from
    // 07:00 to 23:30 — late enough that a walk stopping early would miss samples.
    await pool.query(
      `INSERT INTO body_battery_daily (user_id, date, anchor, anchor_source, end_value, day_min, day_max,
         total_charged, total_drained, resting_hr, hr_max, hr_sample_count, model_version)
       VALUES ($1, $2, 70, 'readiness', 10, 10, 70, 0, 60, 60, 170, 50, 'v5:old')`,
      [USER, yesterday],
    )
    const mid = du.dateStrMidnightInTz(yesterday, TZ).getTime()
    const values: string[] = []
    const params: unknown[] = [USER]
    for (let m = 7 * 60; m <= 23 * 60 + 30; m += 5) {
      values.push(`($1, $${params.length + 1}, $${params.length + 2}, 'ble')`)
      params.push(new Date(mid + m * 60_000).toISOString(), 58)
    }
    seededSamples = values.length
    // And a few samples TODAY, which belong to the next day: a walk that ran to `now` instead of the
    // day's end would count them and drain on them.
    for (let m = 5; m <= 25; m += 5) {
      values.push(`($1, $${params.length + 1}, $${params.length + 2}, 'ble')`)
      params.push(new Date(mid + 24 * 3_600_000 + m * 60_000).toISOString(), 150)
    }
    await pool.query(`INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ${values.join(',')}`, params)
  })

  it('dry-run reports the move and writes nothing', async () => {
    const body = await call(`from=${twoAgo}&to=${yesterday}`)
    expect(body.dryRun).toBe(true)
    const y = body.days.find((d: { date: string }) => d.date === yesterday)
    expect(y.action).toBe('written')
    expect(y.stored).toEqual({ endValue: 10, modelVersion: 'v5:old' })
    expect(body.summary.written).toBe(1)
    expect(await storedRow(yesterday)).toMatchObject({ end_value: 10, model_version: 'v5:old' })
  })

  it('walks the whole finished day and keeps the anchor that day froze', async () => {
    const body = await call(`from=${yesterday}&to=${yesterday}&dryRun=false`)
    const y = body.days[0]
    expect(y.recomputed.hrSampleCount).toBe(seededSamples)
    const row = await storedRow(yesterday)
    expect(row.anchor).toBe(70)
    expect(row.model_version).toBe(body.modelVersion)
    expect(row.end_value).toBe(y.recomputed.endValue)
  })

  it('invents nothing for a day with no stored row, and leaves today to the live route', async () => {
    const today = du.todayInTz(TZ)
    const body = await call(`from=${twoAgo}&to=${today}&dryRun=false`)
    const by = (d: string) => body.days.find((x: { date: string }) => x.date === d)
    expect(by(twoAgo)).toEqual({ date: twoAgo, action: 'no-row' })
    expect(by(today).action).toBe('today')
    expect(await storedRow(twoAgo)).toBeUndefined()
    expect(await storedRow(today)).toBeUndefined()
  })

  it('a second run over a re-derived day changes nothing', async () => {
    await call(`from=${yesterday}&to=${yesterday}&dryRun=false`)
    const again = await call(`from=${yesterday}&to=${yesterday}&dryRun=false`)
    expect(again.days[0].action).toBe('unchanged')
  })
})
