/**
 * #2179 — `GET /api/body-metadata?days=N` widens `weightTrend` so a client can see a whole dosing
 * period. Absent keeps the 30-day window. Runs against a real local Postgres; skips without it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { todayInTz, shiftDateStr } from '@trainingai/shared/date-utils'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000217901'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('#2179 — weightTrend days parameter', () => {
  let pool: import('pg').Pool
  const today = todayInTz(TZ)

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, 'd2179@example.com', 'x', $2) ON CONFLICT (id) DO NOTHING`, [USER, TZ])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    // One weigh-in every 10 days back 100 days; dates derived from `today`, never a fixed window edge.
    for (let i = 0; i <= 100; i += 10) {
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2, $3)`,
        [USER, shiftDateStr(today, -i), 90 - i / 10])
    }
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const get = async (qs = '') => {
    const { GET } = await import('@/app/api/body-metadata/route')
    const { NextRequest } = await import('next/server')
    return GET(new NextRequest(`http://localhost/api/body-metadata${qs}`))
  }
  const dates = async (qs: string): Promise<string[]> =>
    ((await (await get(qs)).json()).weightTrend as { date: string }[]).map(p => p.date)

  it('keeps the 30-day default when days is absent', async () => {
    const d = await dates('')
    expect(d.length).toBeGreaterThan(0)
    expect(d.every(x => x >= shiftDateStr(today, -29))).toBe(true)
    expect(d).not.toContain(shiftDateStr(today, -100))
  })

  it('returns the whole period when days covers it, boundary day included', async () => {
    const d = await dates('?days=101')
    expect(d).toContain(shiftDateStr(today, -100))
    expect(d).toContain(today)
    expect(await dates('?days=100')).not.toContain(shiftDateStr(today, -100))
  })

  it('clamps days above the cap instead of refusing', async () => {
    const res = await get('?days=99999')
    expect(res.status).toBe(200)
  })

  it.each(['0', '-5', 'abc', '1.5', ''])('refuses days=%j with 400', async v => {
    expect((await get(`?days=${v}`)).status).toBe(400)
  })

  it('stays private, no-store', async () => {
    expect((await get('?days=60')).headers.get('Cache-Control')).toBe('private, no-store')
  })
})
