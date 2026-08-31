// BF-2 step 3. The correction is applied per consumer rather than inside `listBodyMetrics`, so
// what has to be proven is that each consumer actually moves — a per-site correction is exactly
// the shape where one site silently keeps reading raw. `scripts/check-body-fat-correction.js`
// stops a NEW deriver from being added without one; these are the three that exist.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-0000000bfc10'
// The owner's real 2026-08-27 pair.
const DEXA_PCT = 28.5
const SCALE_PCT = 25.3
const WEIGHT_KG = 71.7

describe.skipIf(!canRun)('BF-2 — every consumer of a stored body fat sees the corrected value', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone, sex, height_cm, date_of_birth, activity_level, fitness_goal)
       VALUES ($1, 'bf-consumers@example.com', 'x', 'Australia/Brisbane', 'male', 158, '1993-06-15', 'sedentary', 'recomp')
       ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg, body_fat_pct, source_map)
       VALUES ($1, '2026-08-27', $2, $3, '{"body_fat_pct":"scale_ble"}'::jsonb)`,
      [USER, WEIGHT_KG, SCALE_PCT])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await pool.end()
  })

  const addScan = () => pool.query(
    `INSERT INTO dexa_scans (user_id, scanned_on, pct_fat, source) VALUES ($1, '2026-08-27', $2, 'manual')
     ON CONFLICT (user_id, scanned_on) DO UPDATE SET pct_fat = EXCLUDED.pct_fat`, [USER, DEXA_PCT])
  const dropScan = () => pool.query(`DELETE FROM dexa_scans WHERE user_id = $1`, [USER])

  // The read the whole design rests on staying archival: the correction is applied downstream, so
  // the stored column keeps the number the scale actually reported. If this ever changes, the
  // health screen's log sheet — which seeds from this read and POSTs back at rank `manual` — would
  // overwrite the raw value and collapse the next calibration toward zero.
  it('leaves the stored reading raw, and carries its provenance alongside', async () => {
    await addScan()
    const [row] = await repo.listBodyMetrics(USER, '2026-08-27', '2026-08-27')
    expect(row.bodyFatPct).toBe(SCALE_PCT)
    expect(row.bodyFatSource).toBe('scale_ble')
  })

  it('moves the body_comp snapshot the rollup persists', async () => {
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await dropScan()
    await repo.persistBodyCompFromMetrics(USER)
    const raw = await pool.query<{ body_comp: { body_fat_pct: number; ffm_kg: number; bmr_kcal: number } }>(
      `SELECT body_comp FROM oura_daily_derived WHERE user_id = $1 AND day = '2026-08-27'`, [USER])
    expect(raw.rows[0].body_comp.body_fat_pct).toBe(SCALE_PCT)

    await addScan()
    await repo.persistBodyCompFromMetrics(USER)
    const corrected = await pool.query<{ body_comp: { body_fat_pct: number; ffm_kg: number; bmr_kcal: number } }>(
      `SELECT body_comp FROM oura_daily_derived WHERE user_id = $1 AND day = '2026-08-27'`, [USER])
    expect(corrected.rows[0].body_comp.body_fat_pct).toBe(DEXA_PCT)
    // Lean mass falls, so the Cunningham BMR falls with it — the whole point of the correction.
    expect(corrected.rows[0].body_comp.ffm_kg).toBeLessThan(raw.rows[0].body_comp.ffm_kg)
    expect(corrected.rows[0].body_comp.bmr_kcal).toBeLessThan(raw.rows[0].body_comp.bmr_kcal)
  })

  it('moves the energy-balance resting burn', async () => {
    const { computeEnergyBalance } = await import('@/lib/health/energy-balance-service')
    await dropScan()
    const before = await computeEnergyBalance(repo, USER, 'Australia/Brisbane', '2026-08-27')
    await addScan()
    const after = await computeEnergyBalance(repo, USER, 'Australia/Brisbane', '2026-08-27')
    expect(after.balance.restingBaseKcal).toBeLessThan(before.balance.restingBaseKcal)
    // 3.2 points × 71.7 kg × 0.216 kcal/point × 1.2 sedentary ≈ 59 kcal/day. Asserted as a band
    // rather than a constant so a change to the multiplier is a visible failure, not silent drift.
    const delta = before.balance.restingBaseKcal - after.balance.restingBaseKcal
    expect(delta).toBeGreaterThanOrEqual(50)
    expect(delta).toBeLessThanOrEqual(70)
  })

  // A reading from an instrument the calibration does not cover must be untouched at every
  // consumer, not just at `correctBodyFatPct`.
  it('leaves an uncalibrated instrument alone all the way through', async () => {
    await addScan()
    await pool.query(
      `UPDATE body_metrics SET source_map = '{"body_fat_pct":"health_connect"}'::jsonb
       WHERE user_id = $1 AND date = '2026-08-27'`, [USER])
    await pool.query(`DELETE FROM oura_daily_derived WHERE user_id = $1`, [USER])
    await repo.persistBodyCompFromMetrics(USER)
    const res = await pool.query<{ body_comp: { body_fat_pct: number } }>(
      `SELECT body_comp FROM oura_daily_derived WHERE user_id = $1 AND day = '2026-08-27'`, [USER])
    expect(res.rows[0].body_comp.body_fat_pct).toBe(SCALE_PCT)
    await pool.query(
      `UPDATE body_metrics SET source_map = '{"body_fat_pct":"scale_ble"}'::jsonb
       WHERE user_id = $1 AND date = '2026-08-27'`, [USER])
  })
})
