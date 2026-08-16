// D5 — own daytime-HRV persistence: getDaytimeHrvModel/upsertDaytimeHrvModel (migration 149).
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d020'

describe.skipIf(!canRun)('oura_daytime_hrv_model persistence', () => {
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
      [TEST_USER_ID, `daytime-hrv-model-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_daytime_hrv_model WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_daytime_hrv_model WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('returns null before any fit exists', async () => {
    expect(await repo.getDaytimeHrvModel(TEST_USER_ID)).toBeNull()
  })

  it('upserts and reads back a fitted model', async () => {
    await repo.upsertDaytimeHrvModel(TEST_USER_ID, {
      intercept: 2.1, hrCoef: -0.01, tempCoef: 0.3, residualStd: 0.15, nSamples: 120,
    })
    const row = await repo.getDaytimeHrvModel(TEST_USER_ID)
    expect(row).not.toBeNull()
    expect(row!.intercept).toBeCloseTo(2.1)
    expect(row!.hrCoef).toBeCloseTo(-0.01)
    expect(row!.tempCoef).toBeCloseTo(0.3)
    expect(row!.residualStd).toBeCloseTo(0.15)
    expect(row!.nSamples).toBe(120)
  })

  it('a second upsert replaces the row rather than duplicating it', async () => {
    await repo.upsertDaytimeHrvModel(TEST_USER_ID, {
      intercept: 1.5, hrCoef: -0.02, tempCoef: 0.4, residualStd: 0.1, nSamples: 200,
    })
    const row = await repo.getDaytimeHrvModel(TEST_USER_ID)
    expect(row!.intercept).toBeCloseTo(1.5)
    expect(row!.nSamples).toBe(200)
    const { rows } = await pool.query(`SELECT count(*) FROM oura_daytime_hrv_model WHERE user_id = $1`, [TEST_USER_ID])
    expect(Number(rows[0].count)).toBe(1)
  })
})
