// TN-46 — GET /api/health/dose-vitals joins administered doses with each night's vitals and the
// baseline stored for that night. Doses come from the log's own amount (never the vial's dose),
// vial-dosed only, and a deleted log is not a dose.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

const USER = '00000000-0000-4000-8000-0000000a0046'
const TZ = 'Australia/Brisbane'
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: USER, timezone: TZ } })) }))

const canRun = !!process.env.DATABASE_URL

describe.skipIf(!canRun)('GET /api/health/dose-vitals (TN-46)', () => {
  let pool: import('pg').Pool
  let today: string
  let dayAgo: (n: number) => string

  const clear = async () => {
    for (const t of ['supplement_logs', 'supplements', 'oura_daily_summary']) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const du = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = du.todayInTz(TZ)
    dayAgo = (n: number) => du.shiftDateStr(today, -n)
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'tn46-dose-vitals@example.com', TZ])
    await clear()
    await pool.query(`DELETE FROM rate_limits WHERE key LIKE $1`, [`%${USER}%`])
    const { rows: [med] } = await pool.query(
      `INSERT INTO supplements (user_id, name, dose) VALUES ($1, 'Retatrutide', '10mg') RETURNING id`, [USER])
    const { rows: [daily] } = await pool.query(
      `INSERT INTO supplements (user_id, name, dose) VALUES ($1, 'Creatine', '5g') RETURNING id`, [USER])
    await pool.query(
      `INSERT INTO supplement_logs (supplement_id, user_id, log_date, amount, unit, vial_strength_mg, source) VALUES
         ($1, $3, $4, 1, 'mg', 10, 'manual'),
         ($2, $3, $5, 5, 'g', NULL, 'manual')`,
      [med.id, daily.id, USER, dayAgo(3), dayAgo(1)])
    // A deleted dose is not a dose.
    await pool.query(
      `INSERT INTO supplement_logs (supplement_id, user_id, log_date, amount, unit, vial_strength_mg, source, deleted_at)
       VALUES ($1, $2, $3, 0.5, 'mg', 10, 'meal', now())`, [med.id, USER, dayAgo(2)])
    await pool.query(
      `INSERT INTO oura_daily_summary (user_id, date, rhr_low_bpm, rhr_avg_bpm, hrv_avg_ms, rhr_baseline_mean_x8, hrv_baseline_mean_x8)
       VALUES ($1, $2, 56.3, 65.5, 39, 423, 449)`, [USER, dayAgo(1)])
  })

  afterAll(async () => { if (canRun) { await clear(); await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) } })

  it('returns the vial-dosed administrations and each night beside its own baseline', async () => {
    const { GET } = await import('../route')
    const res = await GET(new NextRequest('http://localhost/api/health/dose-vitals?days=14'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.doses).toEqual([{ supplementName: 'Retatrutide', date: dayAgo(3), amount: 1, unit: 'mg' }])
    expect(body.nights).toEqual([{ date: dayAgo(1), restingHr: 56.3, hrvMs: 39, restingHrBaseline: 52.9, hrvBaseline: 56.1 }])
    expect(body.effectLookbackDays).toBe(5)
  })
})
