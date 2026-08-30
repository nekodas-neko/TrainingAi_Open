// LB-25 — `/api/day-log` carries the day's body temperature, and the DEVIATION is gated.
//
// Two things are pinned here, and the second is the reason this entry was not a one-line "add a
// stat".
//
// 1. **`devC` is suppressed while the baseline is uncentred.** The stored deviations are positive on
//    every night measured in production (39 of 39, min +0.14 °C) because the baseline sits ~0.36 °C
//    low — which is exactly why TN-6a suspends the readiness temperature ladder over the same
//    values. A screen reading "+0.5 °C vs baseline" from a number the scoring engine refuses to
//    score would be the app contradicting itself, so the route reuses
//    `isTemperatureBaselineCentred` rather than inventing a second notion of trust. `meanC` is not
//    gated: an absolute skin temperature is a measurement, not a derivation from the bad baseline.
//
// 2. **The route is driven with the SLASH form, because that is what the client sends.**
//    `normalizeDateParam` returns `YYYY/MM/DD` while `oura_daily_summary` is dash-keyed and
//    `shiftDateStr` splits on `-`. Feeding the slash form to either is how zone-minutes and
//    training-stress went feature-dead (J-8/J-9), and `tsc` cannot see it — both forms are `string`,
//    so the lookup would simply never match and the field would be silently null forever.
//
// The fixture is derived from the clock and anchored on the user's local day — a hardcoded date is a
// time bomb. Runs only against a real local dev Postgres; skips cleanly in CI.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000000b25'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

describe.skipIf(!canRun)('day-log body temperature (LB-25)', () => {
  let pool: import('pg').Pool
  let today: string      // YYYY-MM-DD, the user's local day
  let slashDay: string   // YYYY/MM/DD — the form the client actually sends
  let shiftDateStr: (d: string, n: number) => string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const du = await import('@trainingai/shared/date-utils')
    shiftDateStr = du.shiftDateStr
    pool = getPool()
    today = du.todayInTz(TZ)
    slashDay = today.replace(/-/g, '/')

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [USER, 'day-log-body-temp@example.com', TZ],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_daily_summary WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  /** Seed `n` nights ending today, each with the same deviation, plus a mean temperature. */
  async function seedNights(n: number, devC: number, meanC = 35.9) {
    for (let i = 0; i < n; i++) {
      await pool.query(
        `INSERT INTO oura_daily_summary (user_id, date, temp_mean_c, temp_dev_c)
         VALUES ($1, $2::date, $3, $4)
         ON CONFLICT (user_id, date) DO UPDATE SET temp_mean_c = EXCLUDED.temp_mean_c, temp_dev_c = EXCLUDED.temp_dev_c`,
        [USER, shiftDateStr(today, -i), meanC, devC],
      )
    }
  }

  async function bodyTemp() {
    const { GET } = await import('@/app/api/day-log/route')
    const res = await GET(new Request(`http://localhost/api/day-log?date=${slashDay}`) as never)
    expect(res.status).toBe(200)
    return (await res.json()).bodyTemp
  }

  it('gives both numbers when the baseline is centred', async () => {
    // Twelve nights clears `TEMP_CENTRED_MIN_NIGHTS` (10), and a 0.05 mean is inside ±0.15.
    await seedNights(12, 0.05, 36.02)
    expect(await bodyTemp()).toEqual({ meanC: 36.02, devC: 0.05 })
  })

  it('withholds the deviation, but not the temperature, when the baseline is not centred', async () => {
    // The production shape: every night positive, mean far outside ±0.15.
    await seedNights(12, 0.5, 36.02)
    expect(await bodyTemp()).toEqual({ meanC: 36.02, devC: null })
  })

  it('withholds it for too few nights to judge, rather than assuming centred', async () => {
    // Nine nights, all perfectly centred — still below the minimum, so the answer is "cannot say".
    await seedNights(9, 0, 36.02)
    expect(await bodyTemp()).toEqual({ meanC: 36.02, devC: null })
  })

  it('is null when the ring recorded no temperature for the day', async () => {
    expect(await bodyTemp()).toBeNull()
  })
})
