// oura_daily_derived — completed-form derived metrics (Oura on-device-models program, Sub-plan A).
// Verifies the idempotent COALESCE upsert: a partial recompute writes only its fields and never
// nulls an existing good value. Runs only against a real local dev Postgres — skips in CI (no
// DATABASE_URL), same as the sibling BLE integration tests.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000de71'
const DAY = '2026-07-15'

describe.skipIf(!canRun)('upsertOuraDailyDerived — completed-form + COALESCE upsert', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `daily-derived-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('writes a patch and reads it back', async () => {
    await repo.upsertOuraDailyDerived(TEST_USER_ID, DAY, {
      source: 'ble-derived',
      readinessScore: 72,
      sleepScore: 80,
      readinessContributors: { hrvBalance: { score: 55 } },
    })
    const [row] = await repo.getOuraDailyDerived(TEST_USER_ID, DAY, DAY)
    expect(row.readinessScore).toBe(72)
    expect(row.sleepScore).toBe(80)
    expect(row.source).toBe('ble-derived')
    expect(row.readinessContributors).toEqual({ hrvBalance: { score: 55 } })
    expect(row.illnessScore).toBeNull()
  })

  it('a partial recompute writes new fields but never nulls an existing value (COALESCE)', async () => {
    // Second pass sets illness + activity, leaves readiness/sleep undefined (not written), and
    // explicitly passes a null for sleepScore — which must NOT overwrite the stored 80.
    await repo.upsertOuraDailyDerived(TEST_USER_ID, DAY, {
      illnessScore: 12,
      illnessFlag: 'watch',
      activityScore: 65,
      sleepScore: null, // COALESCE(excluded.sleep_score, existing) => keeps 80
    })
    const [row] = await repo.getOuraDailyDerived(TEST_USER_ID, DAY, DAY)
    expect(row.readinessScore).toBe(72) // untouched (not in patch)
    expect(row.sleepScore).toBe(80) // null in patch did NOT clobber it
    expect(row.illnessScore).toBe(12) // new
    expect(row.illnessFlag).toBe('watch') // new
    expect(row.activityScore).toBe(65) // new
  })

  it('round-trips the derived BDI through the read path', async () => {
    await repo.upsertOuraDailyDerived(TEST_USER_ID, DAY, { bdiDerived: 4.3 })
    const [row] = await repo.getOuraDailyDerived(TEST_USER_ID, DAY, DAY)
    expect(row.bdiDerived).toBe(4.3)
    // A later recompute with no BDI (heuristic-fallback night) must not clobber it.
    await repo.upsertOuraDailyDerived(TEST_USER_ID, DAY, { bdiDerived: null })
    const [after] = await repo.getOuraDailyDerived(TEST_USER_ID, DAY, DAY)
    expect(after.bdiDerived).toBe(4.3)
  })
})
