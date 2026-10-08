// #2439 — the chest-strap route against a real Postgres: a strap sample dated on a past day drops
// that day's cached zone minutes and every later one, and leaves earlier days alone. The route test
// proves the call is made; this proves the call does what the issue needs.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { fromZonedTime } from 'date-fns-tz'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002439'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: '00000000-0000-4000-8000-000000002439', timezone: 'Australia/Brisbane' } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => true) }))

const dayAgo = (n: number) => shiftDateStr(todayInTz(TZ), -n)
/** Local midday on that day: clear of any boundary, and inside the route's seven-day tolerance. */
const middayOn = (day: string) => fromZonedTime(`${day}T12:00:00`, TZ).getTime()

describe.skipIf(!canRun)('POST /api/hr-ingest and the zone-minutes cache (#2439)', () => {
  let pool: import('pg').Pool
  let POST: typeof import('@/app/api/hr-ingest/route').POST

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    ;({ POST } = await import('@/app/api/hr-ingest/route'))
    await pool.query(
      `INSERT INTO users (id, email, name, timezone) VALUES ($1, 'hr-ingest-2439@local.dev', 'Strap', $2) ON CONFLICT (id) DO NOTHING`,
      [USER, TZ])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM daily_zone_minutes WHERE user_id = $1', [USER])
    await pool.query('DELETE FROM oura_heartrate WHERE user_id = $1', [USER])
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM daily_zone_minutes WHERE user_id = $1', [USER])
    for (const n of [6, 4, 3, 2, 1]) {
      await pool.query('INSERT INTO daily_zone_minutes (user_id, day, zone2_sec) VALUES ($1, $2, 600)', [USER, dayAgo(n)])
    }
  })

  const cachedDays = async () =>
    (await pool.query<{ day: string }>('SELECT day::text AS day FROM daily_zone_minutes WHERE user_id = $1 ORDER BY day', [USER]))
      .rows.map(r => r.day)

  const flush = (samples: { at: number; bpm: number }[]) => POST(new Request('http://x/api/hr-ingest', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ samples }),
  }))

  it('drops the sample\'s day and every later cached day, and keeps earlier ones', async () => {
    expect(await cachedDays()).toEqual([dayAgo(6), dayAgo(4), dayAgo(3), dayAgo(2), dayAgo(1)])
    const res = await flush([{ at: middayOn(dayAgo(3)), bpm: 128 }, { at: middayOn(dayAgo(3)) + 5_000, bpm: 130 }])
    expect(res.status).toBe(200)
    expect(await cachedDays()).toEqual([dayAgo(6), dayAgo(4)])
  })

  it('reaches back to the EARLIEST stored sample when a backlog spans several days', async () => {
    await flush([{ at: middayOn(dayAgo(1)), bpm: 120 }, { at: middayOn(dayAgo(4)), bpm: 125 }])
    expect(await cachedDays()).toEqual([dayAgo(6)])
  })

  it('leaves the cache alone when nothing was stored', async () => {
    await flush([{ at: middayOn(dayAgo(3)), bpm: 0 }])
    expect(await cachedDays()).toEqual([dayAgo(6), dayAgo(4), dayAgo(3), dayAgo(2), dayAgo(1)])
  })
})
