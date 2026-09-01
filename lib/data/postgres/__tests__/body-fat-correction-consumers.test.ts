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

  // Step 4. The display payloads carry BOTH: `bodyFat` raw so the edit sheet cannot launder a
  // corrected value back into the archive, and `bodyFatCorrected` for what the screen should show.
  // A file-level check cannot express "this field specifically must stay raw", so it is pinned here.
  it('gives the display payloads a corrected value WITHOUT touching the raw one', async () => {
    await addScan()
    // Not the route itself — importing it pulls in next-auth, which does not load under vitest.
    // This pins the values the routes build their two fields from; that the routes actually build
    // them is verified against the running dev server.
    const cal = await repo.getBodyFatCalibration(USER)
    const { correctBodyFatPct } = await import('@trainingai/shared/health/body-fat-calibration')
    const [row] = await repo.listBodyMetrics(USER, '2026-08-27', '2026-08-27')

    // What `toRow` and `day-log` build their two fields from.
    const shown = correctBodyFatPct(row.bodyFatPct ?? null, row.bodyFatSource ?? null, cal)
    expect(shown!.rawPct).toBe(SCALE_PCT)
    expect(shown!.pct).toBe(DEXA_PCT)
    expect(shown!.corrected).toBe(true)

    // …and the raw column is what a later calibration will pair against, so it must be untouched.
    const stored = await pool.query<{ body_fat_pct: number }>(
      `SELECT body_fat_pct FROM body_metrics WHERE user_id = $1 AND date = '2026-08-27'`, [USER])
    expect(stored.rows[0].body_fat_pct).toBe(SCALE_PCT)
  })

  // `corrected` is not derivable from `pct !== rawPct`, which is why it is a separate field on the
  // payload rather than something a screen infers.
  it('reports not-corrected for an instrument the calibration does not cover', async () => {
    await addScan()
    const cal = await repo.getBodyFatCalibration(USER)
    const { correctBodyFatPct } = await import('@trainingai/shared/health/body-fat-calibration')
    const other = correctBodyFatPct(22.8, 'health_connect', cal)
    expect(other).toEqual({ pct: 22.8, rawPct: 22.8, corrected: false })
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

  // BF-42. The daily energy model computed its own BMR and never read the measurement, so the goal
  // wizard and the Energy Balance card would have shown two resting rates for one person. Worse,
  // that predicted BMR is also the FLOOR under the calibrated maintenance, so it clamped the
  // calibration up to a number the measurement contradicts.
  it('uses the measured resting rate rather than predicting one', async () => {
    const { computeEnergyBalance } = await import('@/lib/health/energy-balance-service')
    await addScan()
    await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [USER])
    const predicted = await computeEnergyBalance(repo, USER, 'Australia/Brisbane', '2026-08-27')

    // The owner's real test: 1325 kcal at 51.5 kg fat-free mass.
    await pool.query(
      `INSERT INTO measured_rmr (user_id, measured_on, rmr_kcal, ffm_kg_at_test, weight_kg_at_test)
       VALUES ($1, '2026-08-27', 1325, 51.5, 72.1)`, [USER])
    const measured = await computeEnergyBalance(repo, USER, 'Australia/Brisbane', '2026-08-27')

    // Cunningham over-predicts for this person, so the measurement pulls the resting burn DOWN.
    expect(measured.balance.restingBaseKcal).toBeLessThan(predicted.balance.restingBaseKcal)
    await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [USER])
  })

  // The measurement ages by how much the body changed, not by the calendar — and both sides of that
  // re-scaling must be on the same instrument. `ffm_kg_at_test` is the DEXA's, so today's has to be
  // the DEXA-corrected scale reading, not the raw one (BF-2 × BF-42).
  //
  // Asserted against the exact expected number rather than a direction, because the two paths differ
  // by only ~50 kcal here and a `toBeLessThan` passes for both.
  it('re-scales the measurement onto the CORRECTED fat-free mass, in the service', async () => {
    const { computeEnergyBalance } = await import('@/lib/health/energy-balance-service')
    const { personalRmr, bodyComposition } = await import('@trainingai/shared/health/body-composition')
    const { SEDENTARY_MULTIPLIER } = await import('@trainingai/shared/health/energy-baseline')
    await addScan()
    await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [USER])
    await pool.query(
      `INSERT INTO measured_rmr (user_id, measured_on, rmr_kcal, ffm_kg_at_test, weight_kg_at_test)
       VALUES ($1, '2026-08-27', 1325, 51.5, 72.1)`, [USER])

    const measured = { rmrKcal: 1325, ffmKgAtTest: 51.5 }
    const onCorrected = personalRmr(measured, bodyComposition(WEIGHT_KG, DEXA_PCT)!.ffmKg)!
    const onRaw = personalRmr(measured, bodyComposition(WEIGHT_KG, SCALE_PCT)!.ffmKg)!
    expect(Math.round(onRaw)).toBeGreaterThan(Math.round(onCorrected))

    const res = await computeEnergyBalance(repo, USER, 'Australia/Brisbane', '2026-08-27')
    expect(res.balance.restingBaseKcal).toBe(Math.round(onCorrected * SEDENTARY_MULTIPLIER))
    expect(res.balance.restingBaseKcal).not.toBe(Math.round(onRaw * SEDENTARY_MULTIPLIER))
    await pool.query(`DELETE FROM measured_rmr WHERE user_id = $1`, [USER])
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
