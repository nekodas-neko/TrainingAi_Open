// Q-78 — overnight HRV vs same-day training volume.
//
// Measured over production before the view was built: r|t = +0.495, p = 0.006, n = 30; split at the
// median (48 ms), 4,376 kg mean tonnage below vs 5,799 kg above. Deliberately separate from
// `recovery-vs-strength`, which scores the same HRV against mean 1RM-percent — volume is where the
// response shows.
//
// These drive the real route against Postgres. The two properties worth pinning are the ones a
// refactor could quietly break: the day is the unit (two sessions on one date share one overnight
// reading, so they must sum into one point, not become two), and the significance gate still
// governs — this finding does NOT survive Bonferroni at n = 30 and must never render a claim on
// data that thin.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000b7e78'
const TZ = 'Australia/Brisbane'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: TZ } })),
}))

const get = async () => {
  const { GET } = await import('../route')
  const res = await GET(new Request('http://localhost/api/health-trends?view=hrv-volume') as never)
  return res.json()
}

describe.skipIf(!canRun)('health-trends hrv-volume (Q-78)', () => {
  let pool: import('pg').Pool
  let mid: Date

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    mid = todayMidnightUtc(TZ)
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `hrvvol-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM workout_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  const dayIso = (daysAgo: number) =>
    formatInTimeZone(new Date(mid.getTime() - daysAgo * 86_400_000), TZ, 'yyyy-MM-dd')

  async function hrv(daysAgo: number, ms: number) {
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, hrv_ms) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, date) DO UPDATE SET hrv_ms = EXCLUDED.hrv_ms`,
      [TEST_USER_ID, dayIso(daysAgo), ms],
    )
  }

  /** One session on `daysAgo` carrying `kg` of tonnage, as a single logged set. */
  async function session(daysAgo: number, kg: number) {
    const startedAt = new Date(mid.getTime() - daysAgo * 86_400_000 + 10 * 3_600_000)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO workout_sessions (user_id, session_name, started_at, completed_at)
       VALUES ($1, 'Session', $2, $3) RETURNING id`,
      [TEST_USER_ID, startedAt, new Date(startedAt.getTime() + 3_600_000)],
    )
    // `volume` is a stored column on exercise_logs (the write path computes it from the sets), so
    // the fixture sets it directly — the route reads the column, it does not re-derive from set_logs.
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_name, logged_at, volume)
       VALUES ($1, 'Bench Press', $2, $3)`,
      [rows[0].id, startedAt, kg],
    )
  }

  /** 40 days: HRV rises with tonnage, so the relationship is real and strongly positive. */
  async function seedCoupledDays() {
    for (let i = 1; i <= 40; i++) {
      const ms = 40 + (i % 10) * 2          // 40–58 ms
      await hrv(i, ms)
      await session(i, 2000 + (ms - 40) * 250) // 2,000–6,500 kg
    }
  }

  it('finds the coupling and reports it as significant', async () => {
    await seedCoupledDays()
    const data = await get()
    expect(data.hasSufficientData).toBe(true)
    expect(data.withheld).toBeUndefined()
    expect(data.stats.r).toBeGreaterThan(0.5)
    expect(data.stats.p).toBeLessThan(0.05)
    expect(data.insight).toMatch(/You lift .* t on days your overnight HRV is/)
  })

  it('the day is the unit — two sessions on one date sum into one point', async () => {
    await seedCoupledDays()
    const before = await get()
    // A second session on the most recent seeded day. It shares that day's single overnight HRV
    // reading, so it must raise that day's tonnage, never add a second point at the same x.
    await session(1, 3000)
    const after = await get()
    expect(after.stats.n).toBe(before.stats.n)
  })

  it('withholds the claim when there are too few paired days to support it', async () => {
    // Twelve days split hard into two buckets, so bucket eligibility (≥5 observations in ≥2
    // buckets) is satisfied and the SAMPLE gate is the one under test. n = 12 < 20. The finding
    // this view carries does not survive Bonferroni even at n = 30, so a thin window must say so
    // rather than render a sentence.
    for (let i = 1; i <= 12; i++) {
      const low = i <= 6
      await hrv(i, low ? 40 : 60)
      await session(i, low ? 2000 : 6000)
    }
    const data = await get()
    expect(data.withheld).toBe('sample')
    expect(data.insight).toMatch(/not enough to say anything either way/)
  })
})
