// `getBodyMetricsBaseline` and `getMostRecentConfirmedWeightKg` read the same column from opposite
// ends of history, and two routes reached for the wrong one (Q-330). This file locks the semantics
// so the next caller can read the contract rather than the ORDER BY.
//
// The property that makes the mix-up damaging: the baseline is FROZEN at the first reading ever
// taken, so its error grows without bound as the user's weight moves. A caller that wants "what
// does this user weigh now" gets a number that never converges.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000003300'
const TZ = 'Australia/Brisbane'

describe.skipIf(!canRun)('body weight — baseline vs current', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const addWeight = (date: string, weightKg: number, bodyFatPct?: number) =>
    pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct) VALUES ($1, $2, $3, $4)`,
      [TEST_USER_ID, date, weightKg, bodyFatPct ?? null],
    )

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `weight-baseline-${TEST_USER_ID}@example.com`, TZ],
    )
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM body_metrics WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  it('reads opposite ends of the same history', async () => {
    await addWeight('2026-05-01', 70.5)
    await addWeight('2026-06-20', 71.0)
    await addWeight('2026-08-20', 71.5)

    expect((await repo.getBodyMetricsBaseline(TEST_USER_ID)).weightKg).toBe(70.5)
    expect(await repo.getMostRecentConfirmedWeightKg(TEST_USER_ID)).toBe(71.5)
  })

  // The reason a "current weight" caller cannot be left on the baseline: every new reading widens
  // the gap, so a route anchored to it is wrong by more each month rather than settling.
  it('leaves the baseline frozen as newer readings arrive', async () => {
    await addWeight('2026-05-01', 70.5)
    const baselineBefore = (await repo.getBodyMetricsBaseline(TEST_USER_ID)).weightKg
    const currentBefore = await repo.getMostRecentConfirmedWeightKg(TEST_USER_ID)
    expect(baselineBefore).toBe(currentBefore)

    await addWeight('2026-08-20', 75.5)
    expect((await repo.getBodyMetricsBaseline(TEST_USER_ID)).weightKg).toBe(baselineBefore)
    expect(await repo.getMostRecentConfirmedWeightKg(TEST_USER_ID)).toBe(75.5)
  })

  // Rows arrive out of order (a backfill, a late scale sync), so both must key off `date` and not
  // insertion order.
  it('keys off the date, not the insert order', async () => {
    await addWeight('2026-08-20', 71.5)
    await addWeight('2026-05-01', 70.5)

    expect((await repo.getBodyMetricsBaseline(TEST_USER_ID)).weightKg).toBe(70.5)
    expect(await repo.getMostRecentConfirmedWeightKg(TEST_USER_ID)).toBe(71.5)
  })

  // Weight and body fat are picked independently, so a day with only one of them logged does not
  // drag the other's baseline forward.
  it('picks the earliest weight and body-fat rows independently', async () => {
    await addWeight('2026-05-01', 70.5)
    await addWeight('2026-06-20', 71.0, 18.4)

    const baseline = await repo.getBodyMetricsBaseline(TEST_USER_ID)
    expect(baseline.weightKg).toBe(70.5)
    expect(baseline.bodyFatPct).toBe(18.4)
  })

  it('returns nulls rather than throwing when nothing is logged', async () => {
    expect(await repo.getBodyMetricsBaseline(TEST_USER_ID)).toEqual({ weightKg: null, bodyFatPct: null })
    expect(await repo.getMostRecentConfirmedWeightKg(TEST_USER_ID)).toBeNull()
  })
})
