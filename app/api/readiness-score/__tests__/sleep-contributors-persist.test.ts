// S6 (data-efficiency review 2026-07-16 §1.3): the readiness route must persist our own
// sleep score + contributors into oura_daily_derived and fall back to them in the
// response's sleepContributors when the Cloud JSONB is absent (every BLE night).
// Runs only against a real Postgres — skips without DATABASE_URL (CI's Tests job sets one).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c6'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('readiness-score — own sleep contributors persist + fallback (S6)', () => {
  let pool: import('pg').Pool
  let today: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { todayInTz, todayMidnightUtc } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    today = todayInTz('Australia/Brisbane')
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `sleep-contrib-${TEST_USER_ID}@example.com`],
    )
    // One BLE-style night ending this morning: 22:00 local → 06:00 local, no Cloud row at all.
    const mid = todayMidnightUtc('Australia/Brisbane')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, efficiency, onset_latency_sec)
       VALUES ($1, $2, $3, $4, 8, 92, 720)
       ON CONFLICT (user_id, sleep_start) DO NOTHING`,
      [TEST_USER_ID, today, new Date(mid.getTime() - 2 * 3_600_000), new Date(mid.getTime() + 6 * 3_600_000)],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID]) // cascades all rows
  })

  it('serves own contributors when Cloud sleep_contributors is null, and persists them', async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    // Response fallback: Cloud JSONB absent → our own mapped components.
    expect(body.sleepContributors).not.toBeNull()
    expect(body.sleepContributors).toHaveProperty('total_sleep')
    expect(body.sleepContributors).toHaveProperty('efficiency')
    expect(body.sleepContributors).toHaveProperty('latency')
    expect(body.sleepContributors).not.toHaveProperty('rem_sleep') // no stage data → never fabricated
    expect(body.sleepScore).toBeGreaterThan(0)

    // Persist: same score + contributors landed in oura_daily_derived for the wake day.
    const { rows } = await pool.query(
      `SELECT sleep_score, sleep_contributors FROM oura_daily_derived WHERE user_id = $1 AND day = $2`,
      [TEST_USER_ID, today],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].sleep_score).toBe(body.sleepScore)
    expect(rows[0].sleep_contributors).toEqual(body.sleepContributors)
  })
})
