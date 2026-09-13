/**
 * LB-102 — the stored stress buckets get a read path.
 *
 * TN-3a has persisted 30-minute buckets since 2026-08-24 and nothing published them, so a past day
 * was unreachable from any surface — which blocked TN-3b's owner-approved pass test. `/api/body-battery`
 * takes no parameters at all (`GET()`) and computes its series live from today's ring dHRV.
 *
 * Runs only against a real local dev Postgres — skips without DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000b1020'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('GET /api/body-battery/stress-day', () => {
  let pool: import('pg').Pool
  let GET: typeof import('../stress-day/route').GET

  /** A request with whatever `date` spelling the caller used. */
  const call = async (date?: string) => {
    const { NextRequest } = await import('next/server')
    const url = date
      ? `http://localhost/api/body-battery/stress-day?date=${encodeURIComponent(date)}`
      : 'http://localhost/api/body-battery/stress-day'
    return GET(new NextRequest(url))
  }

  beforeAll(async () => {
    const { Pool } = await import('pg')
    pool = new Pool({ connectionString: process.env.DATABASE_URL })
    await pool.query(
      `INSERT INTO users (id, email, name, timezone) VALUES ($1,$2,'LB102',$3)
       ON CONFLICT (id) DO UPDATE SET timezone = EXCLUDED.timezone`,
      [USER, `lb102-${USER}@example.test`, TZ],
    )
    const { vi } = await import('vitest')
    vi.doMock('@/auth', () => ({
      auth: async () => ({ user: { id: USER, timezone: TZ } }),
    }))
    GET = (await import('../stress-day/route')).GET
  })

  afterAll(async () => {
    await pool.query('DELETE FROM oura_daytime_stress_buckets WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM users WHERE id = $1', [USER])
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM oura_daytime_stress_buckets WHERE user_id = $1', [USER])
  })

  /** Two buckets inside the user's local day, written the way the rollup writes them. */
  const seed = async (day: string, levels: number[]) => {
    for (let i = 0; i < levels.length; i++) {
      await pool.query(
        `INSERT INTO oura_daytime_stress_buckets (user_id, day, bucket_start, level)
         VALUES ($1, $2::date,
                 (($3::date + time '09:00') AT TIME ZONE $4) + make_interval(mins => $5::int),
                 $6)`,
        [USER, day, day, TZ, i * 30, levels[i]],
      )
    }
  }

  it('serves a PAST day, which is the whole point of the entry', async () => {
    await seed('2026-09-01', [-0.4, 0.2])
    const body = await (await call('2026-09-01')).json()
    expect(body.date).toBe('2026-09-01')
    expect(body.series.map((p: { level: number }) => p.level)).toEqual([-0.4, 0.2])
  })

  /**
   * `localDateString()` emits `YYYY/MM/DD`. A dash-only guard rejects every real request with a Zod
   * error before the handler runs, and it stays invisible until a client fills the param from it —
   * which cost `ai-chat`'s `localDate` a full release.
   */
  it('takes both date separators', async () => {
    await seed('2026-09-01', [-0.4])
    const dashes = await (await call('2026-09-01')).json()
    const slashes = await (await call('2026/09/01')).json()
    expect(slashes).toEqual(dashes)
  })

  it('rejects a date it cannot parse rather than guessing', async () => {
    const res = await call('not-a-date')
    expect(res.status).toBe(400)
  })

  it('answers for today when no date is given', async () => {
    const { todayInTz } = await import('@trainingai/shared/date-utils')
    const body = await (await call()).json()
    expect(body.date).toBe(todayInTz(TZ))
  })

  /**
   * The window is the USER's local day. A server-timezone window would pull the neighbouring day's
   * early buckets in and drop this day's late ones — the class the repo keeps re-finding.
   */
  it('does not leak the neighbouring day-s buckets', async () => {
    await seed('2026-09-01', [-0.4])
    await seed('2026-09-02', [0.9])
    const body = await (await call('2026-09-01')).json()
    expect(body.series).toHaveLength(1)
    expect(body.series[0].level).toBe(-0.4)
  })

  it('reports an empty day as empty rather than as an error', async () => {
    const res = await call('2026-08-15')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.series).toEqual([])
    expect(body.throughMs).toBeNull()
  })

  /**
   * Today's stored series ends at the last rollup rather than at this minute, because the rollup is
   * the only writer (TN-3a: persisting the live route's series too *"would put two numbers behind one
   * metric"*). `throughMs` is what lets a caller say so instead of implying the day stopped.
   */
  it('reports how far the stored day reaches', async () => {
    await seed('2026-09-01', [-0.4, 0.2, 0.1])
    const body = await (await call('2026-09-01')).json()
    expect(body.throughMs).toBe(body.series[body.series.length - 1].t)
    expect(body.throughMs).toBeGreaterThan(body.series[0].t)
  })

  it('answers 401 without a session', async () => {
    const { vi } = await import('vitest')
    vi.doMock('@/auth', () => ({ auth: async () => null }))
    vi.resetModules()
    const { GET: anon } = await import('../stress-day/route')
    const { NextRequest } = await import('next/server')
    const res = await anon(new NextRequest('http://localhost/api/body-battery/stress-day'))
    expect(res.status).toBe(401)
    vi.doMock('@/auth', () => ({ auth: async () => ({ user: { id: USER, timezone: TZ } }) }))
    vi.resetModules()
    GET = (await import('../stress-day/route')).GET
  })
})
