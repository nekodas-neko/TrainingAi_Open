// S1 (data-efficiency review 2026-07-16 §3.1): /api/health/trends must coalesce
// oura_daily_derived scores over the frozen-Cloud oura_daily columns per day, so
// post-re-key days stop rendering null in the 14-day sparklines.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005c1'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: TEST_USER_ID, timezone: 'Australia/Brisbane' } })),
}))

describe.skipIf(!canRun)('health/trends — derived-over-Cloud coalesce (S1)', () => {
  let pool: import('pg').Pool
  let dDerivedOnly: string, dCloudOnly: string, dBoth: string

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    const { todayInTz, shiftDateStr } = await import('@trainingai/shared/date-utils')
    pool = getPool()
    const today = todayInTz('Australia/Brisbane')
    dDerivedOnly = shiftDateStr(today, -3)  // BLE era: derived row only
    dCloudOnly   = shiftDateStr(today, -5)  // Cloud era: oura_daily only
    dBoth        = shiftDateStr(today, -7)  // both → derived must win

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `trends-coalesce-${TEST_USER_ID}@example.com`],
    )
    await pool.query(
      `INSERT INTO oura_daily (user_id, date, readiness_score, sleep_score, activity_score)
       VALUES ($1, $2, 61, 62, 63), ($1, $3, 41, 42, 43)`,
      [TEST_USER_ID, dCloudOnly, dBoth],
    )
    const repo = await getRepository()
    await repo.upsertOuraDailyDerived(TEST_USER_ID, dDerivedOnly, { readinessScore: 71, sleepScore: 72 })
    await repo.upsertOuraDailyDerived(TEST_USER_ID, dBoth, { readinessScore: 91, sleepScore: 92 })
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('fills BLE-era days from derived, keeps Cloud-era days, and prefers derived when both exist', async () => {
    const { GET } = await import('../route')
    const res = await GET()
    expect(res.status).toBe(200)
    const { trends } = await res.json() as { trends: { date: string; readinessScore: number | null; sleepScore: number | null; activityScore: number | null }[] }
    const byDate = new Map(trends.map(t => [t.date, t]))

    // Derived-only day: was null before this change.
    expect(byDate.get(dDerivedOnly)?.readinessScore).toBe(71)
    expect(byDate.get(dDerivedOnly)?.sleepScore).toBe(72)
    expect(byDate.get(dDerivedOnly)?.activityScore).toBeNull() // derived activity never written yet — honest null

    // Cloud-only day: unchanged.
    expect(byDate.get(dCloudOnly)?.readinessScore).toBe(61)
    expect(byDate.get(dCloudOnly)?.activityScore).toBe(63)

    // Both: derived wins per score; Cloud still backfills the scores derived lacks.
    expect(byDate.get(dBoth)?.readinessScore).toBe(91)
    expect(byDate.get(dBoth)?.sleepScore).toBe(92)
    expect(byDate.get(dBoth)?.activityScore).toBe(43)
  })
})
