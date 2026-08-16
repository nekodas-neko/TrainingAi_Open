// Phase-2 durability B1: server infra for the dedicated Track-B timeseries backup.
//  - oura_heartrate.updated_at + onConflictDoUpdate (a re-decoded/corrected bpm reaches the
//    backup; an unchanged re-roll does NOT bump updated_at — no sync churn).
//  - oura_bucket server table + upsertOuraBucket (same re-decode-durable, churn-free semantics).
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
// Was …d013, which oura-heartrate-by-source.test.ts also used. Two DB-touching files on one id delete each
// other's rows in parallel workers; `scripts/check-test-user-ids.js` keeps them distinct.
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d0a2'
const TZ = 'Australia/Brisbane'
const TS = new Date('2026-07-08T02:00:00Z')

describe.skipIf(!canRun)('Track-B timeseries server infra (B1)', () => {
  let pool: import('pg').Pool
  let db: Awaited<ReturnType<typeof import('@/lib/data/postgres/client').getDb>>
  let oura: typeof import('@/lib/data/postgres/slices/oura')

  const hrRow = async () => {
    const { rows } = await pool.query(
      `SELECT bpm, source, updated_at FROM oura_heartrate WHERE user_id = $1 AND timestamp = $2`,
      [TEST_USER_ID, TS.toISOString()],
    )
    return rows[0] as { bpm: number; source: string | null; updated_at: string } | undefined
  }
  const bucketRow = async () => {
    const { rows } = await pool.query(
      `SELECT hr_mean, sample_count, updated_at FROM oura_bucket WHERE user_id = $1 AND tier = 'coarse' AND bucket_start_ms = 1783468800000`,
      [TEST_USER_ID],
    )
    return rows[0] as { hr_mean: number | null; sample_count: number | null; updated_at: string } | undefined
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    oura = await import('@/lib/data/postgres/slices/oura')
    pool = client.getPool()
    db = client.getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ts-b1-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_bucket WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_bucket WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('heartrate: insert stamps updated_at; unchanged re-roll does NOT bump it', async () => {
    await oura.upsertOuraHeartrate(db, TEST_USER_ID, [{ timestamp: TS, bpm: 60, source: 'ble' }])
    const first = await hrRow()
    expect(first?.bpm).toBe(60)
    expect(first?.updated_at).toBeTruthy()

    // Re-roll identical value — setWhere skips the update, updated_at unchanged (no churn).
    await oura.upsertOuraHeartrate(db, TEST_USER_ID, [{ timestamp: TS, bpm: 60, source: 'ble' }])
    const second = await hrRow()
    expect(new Date(second!.updated_at).getTime()).toBe(new Date(first!.updated_at).getTime())
  })

  it('heartrate: a corrected bpm updates the value AND advances updated_at (re-decode reaches backup)', async () => {
    const before = await hrRow()
    await new Promise(r => setTimeout(r, 5)) // ensure now() differs
    await oura.upsertOuraHeartrate(db, TEST_USER_ID, [{ timestamp: TS, bpm: 62, source: 'ble' }])
    const after = await hrRow()
    expect(after?.bpm).toBe(62)
    expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime())
  })

  it('bucket: insert then idempotent re-roll (unchanged) does not bump updated_at; a changed metric does', async () => {
    const row = {
      tier: 'coarse', bucketStartMs: 1783468800000, bucketStartDs: 44000000, localDate: '2026-07-08',
      hrMean: 65, hrMin: 55, hrMax: 120, hrvRmssdMs: 40, spo2Pct: 97, perfusionIndex: 1.2,
      skinTempC: 33.5, metMean: 1.4, metMinutes: 12, motionMad: 0.3, ibiMs: '900,910', sampleCount: 30,
    }
    await oura.upsertOuraBucket(db, TEST_USER_ID, [row])
    const first = await bucketRow()
    expect(first?.hr_mean).toBe(65)

    await oura.upsertOuraBucket(db, TEST_USER_ID, [row]) // identical — no bump
    const second = await bucketRow()
    expect(new Date(second!.updated_at).getTime()).toBe(new Date(first!.updated_at).getTime())

    await new Promise(r => setTimeout(r, 5))
    await oura.upsertOuraBucket(db, TEST_USER_ID, [{ ...row, hrMean: 70, sampleCount: 33 }]) // changed
    const third = await bucketRow()
    expect(third?.hr_mean).toBe(70)
    expect(third?.sample_count).toBe(33)
    expect(new Date(third!.updated_at).getTime()).toBeGreaterThan(new Date(first!.updated_at).getTime())
  })
})
