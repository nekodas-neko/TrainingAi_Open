// BF-83 — `/api/sleep-sessions` must say which nights can still change. The owner saw the same
// night read 6 h 15 m and then 7 h 40 m four minutes apart, with every derived number moving
// including the recent-nights average it was compared against, and nothing distinguishing the
// first reading from a finished one.
//
// The fixture is derived from the clock so it cannot rot, and the two nights differ only in where
// they sit relative to the rollup's coverage — which is the entire claim being tested.
//
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-0000000083c0'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

type Payload = { date: string; durationHours: number | null; provisional: boolean }[]

describe.skipIf(!canRun)('sleep-sessions marks a night the rollup has not derived past (BF-83)', () => {
  let pool: import('pg').Pool
  // Coverage lands 20 minutes ago. The settled night is three days back rather than five hours:
  // `mergeByDate` groups by local day and SUMS the clusters on it, so two fixtures sharing a day
  // are one row of 13.75 h, not two — which is a fixture bug that reads as the flag being absent.
  const coverage = new Date(Date.now() - 20 * 60_000)
  const settledEnd = new Date(coverage.getTime() - 3 * 24 * HOUR)
  const fillingEnd = new Date(coverage.getTime() - 10 * 60_000)

  const ANCHOR_DS = 49_700_000

  async function seedNight(end: Date, hours: number, ouraId: string) {
    const start = new Date(end.getTime() - hours * HOUR)
    const { formatInTimeZone } = await import('date-fns-tz')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, source_map)
       VALUES ($1, $2, $3, $4, $5, $6, '{"duration_hours":"oura_ble"}'::jsonb)`,
      [USER, formatInTimeZone(end, TZ, 'yyyy-MM-dd'), start, end, hours, ouraId],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'sleep-provisional@example.com', TZ],
    )
    for (const t of ['sleep_sessions', 'oura_ble_clock_anchors', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    // One anchor, so the resolved offset is exactly this pair: the watermark ds below lands on
    // `coverage` to the millisecond.
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch) VALUES ($1, $2, $3, 0)`,
      [USER, ANCHOR_DS, coverage],
    )
    await pool.query(
      `INSERT INTO oura_rollup_state (user_id, last_rolled_ds, epoch) VALUES ($1, $2, 0)`,
      [USER, ANCHOR_DS],
    )
    await seedNight(settledEnd, 7.5, 'ble-settled')
    await seedNight(fillingEnd, 6.25, 'ble-filling')
  })

  afterAll(async () => {
    for (const t of ['sleep_sessions', 'oura_ble_clock_anchors', 'oura_rollup_state']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function payload(): Promise<Payload> {
    const { GET } = await import('@/app/api/sleep-sessions/route')
    const res = await GET()
    expect(res.status).toBe(200)
    return await res.json()
  }

  it('the night ending at the coverage edge is provisional; the settled one is not', async () => {
    const rows = await payload()
    const filling = rows.find(r => r.durationHours === 6.25)
    const settled = rows.find(r => r.durationHours === 7.5)
    expect(filling?.provisional).toBe(true)
    expect(settled?.provisional).toBe(false)
  })

  // The flag has to move with the coverage rather than with the row — a stored one would need the
  // rollup to rewrite the row to change, and the row is exactly what is NOT changing here.
  it('the same row stops being provisional once the watermark advances past it', async () => {
    await pool.query(
      `UPDATE oura_rollup_state SET last_rolled_ds = $2 WHERE user_id = $1`,
      [USER, ANCHOR_DS + 90 * 60 * 10],
    )
    const rows = await payload()
    expect(rows.find(r => r.durationHours === 6.25)?.provisional).toBe(false)
  })
})
