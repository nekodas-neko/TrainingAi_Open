// Body-composition completed-form persistence (Oura on-device-models program, Sub-plan F §7.1).
// persistBodyCompFromMetrics derives fat/lean mass + Cunningham BMR from every logged
// weight+body-fat row and upserts the snapshot into oura_daily_derived.body_comp — idempotently,
// skipping rows missing either input.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000bc01'

describe.skipIf(!canRun)('persistBodyCompFromMetrics — completed-form body_comp', () => {
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
      [TEST_USER_ID, `body-comp-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct) VALUES
         ($1, '2026-07-10', 80, 20),
         ($1, '2026-07-11', 79.5, NULL),  -- no body-fat → skipped
         ($1, '2026-07-12', 79, 19)`,
      [TEST_USER_ID],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('persists a snapshot per logged day, skips rows with no body-fat, and is idempotent', async () => {
    const n1 = await repo.persistBodyCompFromMetrics(TEST_USER_ID)
    expect(n1).toBe(2) // 07-10 and 07-12; 07-11 skipped (null body-fat)

    const rows = await repo.getOuraDailyDerived(TEST_USER_ID, '2026-07-01', '2026-07-31')
    expect(rows.map(r => r.day)).toEqual(['2026-07-10', '2026-07-12'])

    const d10 = rows.find(r => r.day === '2026-07-10')!
    expect(d10.source).toBe('derived')
    expect(d10.bodyComp).toEqual({
      weight_kg: 80,
      body_fat_pct: 20,
      fat_mass_kg: 16,
      ffm_kg: 64,
      bmr_kcal: 1752,
      source: 'derived',
    })
    expect(d10.modelVersions).toEqual({ bodyComp: 'atlas_2_1_0' })

    // Re-run: same rows, no duplicates (COALESCE upsert on (user_id, day)).
    const n2 = await repo.persistBodyCompFromMetrics(TEST_USER_ID)
    expect(n2).toBe(2)
    const again = await repo.getOuraDailyDerived(TEST_USER_ID, '2026-07-01', '2026-07-31')
    expect(again.length).toBe(2)
  })
})
