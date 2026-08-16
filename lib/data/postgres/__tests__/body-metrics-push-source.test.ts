// Phase-2 durability A4: the body_metrics push branch threads payload.source instead of hardcoding
// 'manual'. An oura_ble/health_connect push must write at its real source rank so the per-field
// mergeSet preserves higher-ranked values — a hardcoded rank-4 'manual' would let a ring push stomp
// a genuine manual weight. Source is whitelisted to a known HealthSource; default 'manual'.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d017'
const TZ = 'Australia/Brisbane'
const DAY = '2026-07-08'

describe.skipIf(!canRun)('body_metrics push threads payload.source (A4)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const row = async () => {
    const { rows } = await pool.query(
      `SELECT weight_kg, hrv_ms, steps, source_map FROM body_metrics WHERE user_id = $1 AND date = $2`,
      [TEST_USER_ID, DAY],
    )
    return rows[0] as { weight_kg: number | null; hrv_ms: number | null; steps: number | null; source_map: Record<string, string> | null } | undefined
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `bm-source-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('an oura_ble push writes at oura_ble rank and does NOT stomp a prior manual weight', async () => {
    // Manual weight first (rank 4).
    await repo.pushMutations(TEST_USER_ID, [
      { id: 'b1', domain: 'body_metrics', date: DAY, payload: { weightKg: 80, source: 'manual' } },
    ])
    // Ring push: hrv (new) + a competing weight — the ring (rank 3) must NOT overwrite manual weight.
    const res = await repo.pushMutations(TEST_USER_ID, [
      { id: 'b2', domain: 'body_metrics', date: DAY, payload: { hrvMs: 45, weightKg: 79, source: 'oura_ble' } },
    ])
    expect(res.errors).toEqual([])
    const r = await row()
    expect(Number(r?.weight_kg)).toBeCloseTo(80)       // manual preserved (not stomped by the ring)
    expect(r?.source_map?.weight_kg).toBe('manual')
    expect(Number(r?.hrv_ms)).toBeCloseTo(45)           // ring filled the manual-untouched field
    expect(r?.source_map?.hrv_ms).toBe('oura_ble')
  })

  it('a push with no source defaults to manual (web/hand-entry path unchanged)', async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await repo.pushMutations(TEST_USER_ID, [
      { id: 'b3', domain: 'body_metrics', date: DAY, payload: { steps: 5000 } },
    ])
    expect((await row())?.source_map?.steps).toBe('manual')
  })

  it('an unknown source string is rejected and falls back to manual (whitelist)', async () => {
    await pool.query(`DELETE FROM body_metrics WHERE user_id = $1`, [TEST_USER_ID])
    await repo.pushMutations(TEST_USER_ID, [
      { id: 'b4', domain: 'body_metrics', date: DAY, payload: { steps: 6000, source: 'evil_source' } },
    ])
    expect((await row())?.source_map?.steps).toBe('manual')
  })
})
