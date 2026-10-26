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
  describe('without the ring rollup (#bug: stopped when the ring moved to the Oura API)', () => {
    const snap = async (day: string) =>
      (await repo.getOuraDailyDerived(TEST_USER_ID, day, day))[0]?.bodyComp as { weight_kg: number; body_fat_pct: number } | undefined

    it('a weigh-in with body fat writes its snapshot with no BLE data present', async () => {
      await repo.upsertBodyMetrics(TEST_USER_ID, [{ date: '2026-08-01', weightKg: 78, bodyFatPct: 18 }], 'manual')
      expect(await snap('2026-08-01')).toMatchObject({ weight_kg: 78, body_fat_pct: 18, fat_mass_kg: 14 })
    })

    it('a day with no weigh-in leaves the last snapshot and writes none for itself', async () => {
      await repo.upsertBodyMetrics(TEST_USER_ID, [{ date: '2026-08-02', restingHeartRate: 55 }], 'oura_cloud')
      expect(await snap('2026-08-01')).toMatchObject({ weight_kg: 78 })
      expect(await snap('2026-08-02')).toBeUndefined()
    })

    it('the Oura Cloud write catches up weigh-ins logged since the last snapshot', async () => {
      // Rows stored without going through the write path, as when nothing ran after 17 Oct.
      await pool.query(
        `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct) VALUES ($1, '2026-08-03', 77.5, 18), ($1, '2026-08-04', 77, 17.5)`,
        [TEST_USER_ID],
      )
      expect(await snap('2026-08-03')).toBeUndefined()
      await repo.upsertBodyMetrics(TEST_USER_ID, [{ date: '2026-08-05', restingHeartRate: 54 }], 'oura_cloud')
      expect(await snap('2026-08-03')).toMatchObject({ weight_kg: 77.5 })
      expect(await snap('2026-08-04')).toMatchObject({ weight_kg: 77 })
    })

    it('a repeat Oura Cloud write leaves the latest snapshot untouched', async () => {
      const stamp = async () => (await pool.query(
        `SELECT updated_at FROM oura_daily_derived WHERE user_id = $1 AND day = '2026-08-04'`, [TEST_USER_ID],
      )).rows[0].updated_at.getTime()
      const before = await stamp()
      await new Promise(r => setTimeout(r, 20))
      await repo.upsertBodyMetrics(TEST_USER_ID, [{ date: '2026-08-06', restingHeartRate: 53 }], 'oura_cloud')
      expect(await stamp()).toBe(before)
    })

    it('an explicit weigh-in on the latest snapshot day still refreshes it', async () => {
      await repo.upsertBodyMetrics(TEST_USER_ID, [{ date: '2026-08-04', weightKg: 76.5, bodyFatPct: 17.5 }], 'manual')
      expect(await snap('2026-08-04')).toMatchObject({ weight_kg: 76.5 })
    })
  })
})
