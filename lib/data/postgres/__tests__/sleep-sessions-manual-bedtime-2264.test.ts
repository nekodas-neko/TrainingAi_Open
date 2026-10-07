// #2264 — `GET /api/sleep-sessions` returns the bedtime a user entered for a night, as its own field.
// The repository already mapped `manual_sleep_start`; the route's field list dropped it, so the card
// read it as unset wherever it reads this route rather than the local store.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000226400'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

type Row = { date: string; durationHours: number | null; sleepStart: string; manualSleepStart: string | null }

describe.skipIf(!canRun)('sleep-sessions returns manualSleepStart (#2264)', () => {
  let pool: import('pg').Pool
  // Two nights on different days, derived from the clock: three and four days back.
  // One clock read, so every derived instant agrees to the millisecond.
  const NOW = Date.now()
  const endOf = (daysBack: number) => new Date(NOW - daysBack * 24 * HOUR)
  const manualAt = new Date(endOf(3).getTime() - 10 * HOUR)

  async function seedNight(end: Date, hours: number, ouraId: string, manual: Date | null) {
    const { formatInTimeZone } = await import('date-fns-tz')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, manual_sleep_start, source_map)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '{"duration_hours":"oura_ble"}'::jsonb)`,
      [USER, formatInTimeZone(end, TZ, 'yyyy-MM-dd'), new Date(end.getTime() - hours * HOUR), end, hours, ouraId, manual],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'sleep-manual-bedtime@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await seedNight(endOf(3), 4, 'ble-with-bedtime', manualAt)
    await seedNight(endOf(4), 7.5, 'ble-without', null)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function payload(): Promise<Row[]> {
    const { GET } = await import('@/app/api/sleep-sessions/route')
    const res = await GET()
    expect(res.status).toBe(200)
    return await res.json()
  }

  it('returns the entered bedtime as an ISO instant on its night', async () => {
    const rows = await payload()
    const night = rows.find(r => r.durationHours === 4)
    expect(night?.manualSleepStart).toBe(manualAt.toISOString())
  })

  it('returns null, not undefined, for a night with none', async () => {
    const rows = await payload()
    expect(rows.find(r => r.durationHours === 7.5)?.manualSleepStart).toBeNull()
  })

  it('leaves the measured window measured: the bedtime is its own field', async () => {
    const rows = await payload()
    const night = rows.find(r => r.durationHours === 4)!
    expect(night.sleepStart).not.toBe(night.manualSleepStart)
    expect(new Date(night.sleepStart).getTime()).toBe(endOf(3).getTime() - 4 * HOUR)
  })
})
