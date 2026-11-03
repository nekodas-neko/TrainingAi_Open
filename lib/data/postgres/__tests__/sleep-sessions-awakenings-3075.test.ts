// #3075 stage 3 — `GET /api/sleep-sessions` counts an Oura Cloud night's awakenings from its own
// hypnogram, with Oura's restlessness value as the fallback; a ring night keeps what the ring wrote.
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000307500'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
// 3 awake runs after onset (2, 1 and 3 epochs); latency and the final wake-up are not awakenings.
const HYPNOGRAM = '4'.repeat(10) + '2'.repeat(60) + '44' + '1'.repeat(40) + '4' + '3'.repeat(30) + '444' + '2'.repeat(20) + '4'.repeat(8)

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

type Row = { durationHours: number | null; restlessPeriods: number | null }

describe.skipIf(!canRun)('sleep-sessions awakenings from the hypnogram (#3075 stage 3)', () => {
  let pool: import('pg').Pool
  const NOW = Date.now()
  const endOf = (daysBack: number) => new Date(NOW - daysBack * 24 * HOUR)

  async function seedNight(daysBack: number, hours: number, ouraId: string, source: string, restless: number, hypnogram: string | null) {
    const { formatInTimeZone } = await import('date-fns-tz')
    const end = endOf(daysBack)
    const start = new Date(end.getTime() - hours * HOUR)
    const date = formatInTimeZone(end, TZ, 'yyyy-MM-dd')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, restless_periods, source_map)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [USER, date, start, end, hours, ouraId, restless, JSON.stringify({ duration_hours: source })])
    if (!ouraId.startsWith('ble:')) {
      await pool.query(
        `INSERT INTO oura_cloud_sleep_periods (user_id, oura_id, day, bedtime_start, bedtime_end, sleep_type, sleep_phase_30_sec)
         VALUES ($1, $2, $3, $4, $5, 'long_sleep', $6)`, [USER, ouraId, date, start, end, hypnogram])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'sleep-awakenings-3075@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await seedNight(3, 8, 'cloud-with-hypnogram', 'oura_cloud', 180, HYPNOGRAM)
    await seedNight(4, 7.5, 'cloud-without', 'oura_cloud', 99, null)
    await seedNight(5, 7, 'ble:1', 'oura_ble', 2, null)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function payload(): Promise<Row[]> {
    const { GET } = await import('@/app/api/sleep-sessions/route')
    const res = await GET()
    expect(res.status).toBe(200)
    return await res.json()
  }

  it('an Oura Cloud night with a hypnogram reports our count, not Oura\'s restlessness value', async () => {
    expect((await payload()).find(r => r.durationHours === 8)?.restlessPeriods).toBe(3)
  })

  it('an Oura Cloud night with no usable hypnogram keeps Oura\'s value', async () => {
    expect((await payload()).find(r => r.durationHours === 7.5)?.restlessPeriods).toBe(99)
  })

  it('a ring night keeps the count the ring wrote', async () => {
    expect((await payload()).find(r => r.durationHours === 7)?.restlessPeriods).toBe(2)
  })
})
