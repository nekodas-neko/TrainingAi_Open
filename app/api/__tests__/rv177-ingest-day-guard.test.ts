/**
 * RV-177 — a client-sent day that the route could not use.
 *
 * Two routes wrote a `date` bounded only by its SHAPE. Measured 2026-09-25, before this existed:
 *
 *  - `sync-health` with `{date:'2026-99-99'}` among two good days wrote **neither** — the bad value
 *    reached the `date` column and failed the INSERT for the whole batch. That is the poison-pill
 *    the handler's own comment says it exists to avoid, through the one field it did not cover.
 *  - `sync-health` with `{date:'9999-12-30', weightKg:499}` answered **200** and wrote the row,
 *    which is Q-494's permanent capture of every "most recent weight" read on a second route.
 *  - `body-metadata` with `localDate:'3026-08-18'` answered **200** and wrote the year-3026 row;
 *    with `'2026-02-31'` it threw out of the route as a bodiless 500.
 *
 * Runs only against a real local dev Postgres; skips cleanly in CI without DATABASE_URL.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000177d01'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('RV-177 — an unusable day is refused, not written and not fatal', () => {
  let pool: import('pg').Pool
  const today = todayInTz(TZ)

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'rv177d@example.com', 'x', $2) ON CONFLICT (id) DO NOTHING`, [USER, TZ])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM activity_logs WHERE user_id = $1`, [USER])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM activity_logs WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const post = async (mod: string, url: string, body: unknown) => {
    const { POST } = await import(mod)
    return POST(new Request(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) as never)
  }
  const syncHealth = (body: unknown) =>
    post('@/app/api/sync-health/route', 'http://localhost/api/sync-health', body)
  const bodyMeta = (body: unknown) =>
    post('@/app/api/body-metadata/route', 'http://localhost/api/body-metadata', body)
  const days = async (): Promise<string[]> =>
    (await pool.query(`SELECT date::text AS d FROM body_metrics WHERE user_id = $1 ORDER BY date`,
      [USER])).rows.map((r: { d: string }) => r.d)

  // The headline property. One unusable record must cost exactly itself.
  it('writes the good days in a batch that also carries an impossible one', async () => {
    const a = shiftDateStr(today, -3)
    const b = shiftDateStr(today, -2)
    const res = await syncHealth({ source: 'health_connect', dailyMetrics: [
      { date: a, steps: 1000 }, { date: '2026-99-99', steps: 2000 }, { date: b, steps: 3000 } ] })
    expect(res.status).toBe(200)
    expect(await days()).toEqual([a, b])
    expect((await res.json()).rejected.join(' ')).toContain('2026-99-99')
  })

  it('refuses a far-future day rather than letting it capture the most-recent read', async () => {
    const res = await syncHealth({ source: 'health_connect',
      dailyMetrics: [{ date: '9999-12-30', weightKg: 499 }] })
    expect(res.status).toBe(200)
    expect(await days()).toEqual([])
    expect((await res.json()).rejected.join(' ')).toContain('9999-12-30')
  })

  // The control for the rule above: a first install backfills 30 days, so an old day is history,
  // not a fault. A guard that rejected these would be worse than the defect it replaced.
  it('still writes a 30-day-old backfill, and tomorrow', async () => {
    const old = shiftDateStr(today, -30)
    const tomorrow = shiftDateStr(today, 1)
    const res = await syncHealth({ source: 'health_connect',
      dailyMetrics: [{ date: old, steps: 500 }, { date: tomorrow, steps: 600 }] })
    expect(res.status).toBe(200)
    expect((await res.json()).rejected).toEqual([])
    expect(await days()).toEqual([old, tomorrow])
  })

  it('rejects a sleep record on an unusable day without failing the flush', async () => {
    const res = await syncHealth({ source: 'health_connect',
      dailyMetrics: [{ date: shiftDateStr(today, -1), steps: 100 }],
      sleepRecords: [{ date: '2026-02-31', sleepStart: '2026-02-28T22:00:00Z',
        sleepEnd: '2026-03-01T06:00:00Z', durationHours: 8 }] })
    expect(res.status).toBe(200)
    expect(await days()).toEqual([shiftDateStr(today, -1)])
  })

  // The exercise array is filtered BEFORE its range lookup, not just before its write: that query
  // is keyed on the first and last date of the batch, so one unusable day poisons the read too.
  it('saves the good exercise session in a batch carrying an impossible one', async () => {
    const good = shiftDateStr(today, -1)
    const res = await syncHealth({ source: 'health_connect', exerciseSessions: [
      { date: '2026-99-99', title: 'Bad', activityType: 'walk',
        startTime: '07:00', endTime: '07:30', durationMin: 30 },
      { date: good, title: 'Good', activityType: 'walk',
        startTime: '08:00', endTime: '08:30', durationMin: 30 } ] })
    expect(res.status).toBe(200)
    expect((await res.json()).rejected.join(' ')).toContain('2026-99-99')
    const saved = (await pool.query(
      `SELECT date::text AS d, title FROM activity_logs WHERE user_id = $1`, [USER])).rows
    expect(saved.map((r: { d: string }) => r.d)).toEqual([good])
  })

  it('answers 400 for a body-metadata day that is not a real date', async () => {
    const res = await bodyMeta({ localDate: '2026-02-31', weightKg: 82 })
    expect(res.status).toBe(400)
    expect(await days()).toEqual([])
  })

  it('answers 400 for a far-future body-metadata day', async () => {
    const res = await bodyMeta({ localDate: '3026-08-18', weightKg: 81 })
    expect(res.status).toBe(400)
    expect(await days()).toEqual([])
  })

  // The control that the two 400s above are about the DAY and nothing else on the route.
  it('still writes an ordinary body-metadata weigh-in', async () => {
    const res = await bodyMeta({ localDate: today, weightKg: 81 })
    expect(res.status).toBe(200)
    expect(await days()).toEqual([today])
  })
})
