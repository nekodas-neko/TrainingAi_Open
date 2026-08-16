// Per-field provenance merge (migration 120). Proves the precedence-ranked upsert:
// a lower-priority source may only FILL a null and can never clobber a higher-priority
// value, while each field is judged against its OWN stored source (so a manual weight does
// not freeze the ring's HRV or Health Connect's steps on the same date).
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000050c0'

describe.skipIf(!canRun)('health-data provenance — precedence-ranked merge', () => {
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
      [TEST_USER_ID, `provenance-${TEST_USER_ID}@example.com`],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('body_metrics: a lower source cannot clobber a manual field but fills unrelated nulls, per-field', async () => {
    const date = '2026-07-14'
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])

    // 1. Manual weight only.
    await repo.upsertBodyMetrics(TEST_USER_ID, [{ date, weightKg: 82.5 }], 'manual')

    // 2. Health Connect (lower) sends a DIFFERENT weight + a new steps value.
    await repo.upsertBodyMetrics(TEST_USER_ID, [{ date, weightKg: 80, steps: 8000 }], 'health_connect')

    let [row] = (await pool.query(
      `SELECT weight_kg, steps, source_map FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )).rows
    expect(Number(row.weight_kg)).toBe(82.5)             // manual weight survives the HC write
    expect(Number(row.steps)).toBe(8000)                 // HC filled the previously-null steps
    expect(row.source_map).toMatchObject({ weight_kg: 'manual', steps: 'health_connect' })

    // 3. HC sends an UPDATED steps value — steps is HC-owned, so it MUST update (the row-level
    //    model's bug would freeze it because the row also holds a manual field).
    await repo.upsertBodyMetrics(TEST_USER_ID, [{ date, steps: 9000 }], 'health_connect')
    ;[row] = (await pool.query(
      `SELECT weight_kg, steps FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )).rows
    expect(Number(row.steps)).toBe(9000)
    expect(Number(row.weight_kg)).toBe(82.5)             // still protected

    // 4. A higher-or-equal source (oura_ble) fills hrv; manual weight still untouched.
    await repo.upsertBodyMetrics(TEST_USER_ID, [{ date, hrvMs: 55 }], 'oura_ble')
    ;[row] = (await pool.query(
      `SELECT weight_kg, hrv_ms FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )).rows
    expect(Number(row.hrv_ms)).toBe(55)
    expect(Number(row.weight_kg)).toBe(82.5)
  })

  it('sleep_sessions: oura_ble beats oura_cloud on a shared field; cloud only fills nulls', async () => {
    const start = new Date('2026-07-14T22:00:00Z')
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [TEST_USER_ID])

    // BLE writes efficiency; Cloud (lower) later sends a different efficiency + a new sleep_score.
    await repo.upsertOuraSleep(TEST_USER_ID, [{
      date: '2026-07-15', sleepStart: start, sleepEnd: new Date('2026-07-15T06:00:00Z'),
      ouraId: 'ble:test-1', efficiency: 90,
    }], 'oura_ble')
    await repo.upsertOuraSleep(TEST_USER_ID, [{
      date: '2026-07-15', sleepStart: start, sleepEnd: new Date('2026-07-15T06:00:00Z'),
      ouraId: 'cloud:test-1', efficiency: 70, sleepScore: 85,
    }], 'oura_cloud')

    const [row] = (await pool.query(
      `SELECT efficiency, sleep_score FROM sleep_sessions WHERE user_id = $1 AND sleep_start = $2`,
      [TEST_USER_ID, start],
    )).rows
    expect(row.efficiency).toBe(90)   // BLE (higher) not clobbered by Cloud
    expect(row.sleep_score).toBe(85)  // Cloud filled the previously-null field
  })

  it('oura_daily: oura_ble activity survives a later oura_cloud write of the same field', async () => {
    const date = '2026-07-16'
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1`, [TEST_USER_ID])

    await repo.upsertOuraDaily(TEST_USER_ID, [{ date, activeCalories: 500 }], 'oura_ble')
    await repo.upsertOuraDaily(TEST_USER_ID, [{ date, activeCalories: 200, readinessScore: 77 }], 'oura_cloud')

    const [row] = (await pool.query(
      `SELECT active_calories, readiness_score FROM oura_daily WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )).rows
    expect(row.active_calories).toBe(500) // BLE wins the shared field
    expect(row.readiness_score).toBe(77)  // Cloud filled the null
  })

  it('a legacy row (null source_map) is corrected by any explicit source', async () => {
    const date = '2026-07-17'
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    // Simulate a pre-migration row: a value with no provenance.
    await pool.query(
      `INSERT INTO body_metrics (user_id, date, weight_kg) VALUES ($1, $2, 100)`,
      [TEST_USER_ID, date],
    )
    // Even health_connect (lowest explicit) outranks unknown/null and overwrites.
    await repo.upsertBodyMetrics(TEST_USER_ID, [{ date, weightKg: 81 }], 'health_connect')
    const [row] = (await pool.query(
      `SELECT weight_kg, source_map FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, date],
    )).rows
    expect(Number(row.weight_kg)).toBe(81)
    expect(row.source_map).toMatchObject({ weight_kg: 'health_connect' })
  })
})
