// getZoneMinutesRange — reconcile-on-read daily HR-zone rollups. Runs only against a real local dev
// Postgres (skips in CI without DATABASE_URL, like the sibling integration tests).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000ff21'
const PROFILE = { maxHr: 190, restingHr: 50 } // Z1≥50, Z2≥134, Z3≥148, Z4≥162, Z5≥176

describe.skipIf(!canRun)('getZoneMinutesRange (reconcile-on-read)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const day = '2026-06-15' // a fixed PAST day (so it caches)

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `zone-minutes-${TEST_USER_ID}@example.com`],
    )
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [TEST_USER_ID])
    // 2026-06-15 10:00 local (Australia/Brisbane = UTC+10) → 00:00 UTC. Three readings:
    // 100 bpm (Z1) for 60s, then 150 bpm (Z3) for 60s, then a trailing sample.
    const base = Date.UTC(2026, 5, 15, 0, 0, 0)
    for (const [offsetSec, bpm] of [[0, 100], [60, 150], [120, 150]] as const) {
      await pool.query(
        `INSERT INTO oura_heartrate (user_id, timestamp, bpm, source) VALUES ($1, $2, $3, 'ble')
         ON CONFLICT (user_id, timestamp) DO NOTHING`,
        [TEST_USER_ID, new Date(base + offsetSec * 1000), bpm],
      )
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_heartrate WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM daily_zone_minutes WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('computes a past day\'s zone-seconds and caches the row', async () => {
    const rows = await repo.getZoneMinutesRange(TEST_USER_ID, day, day, 'Australia/Brisbane', PROFILE)
    expect(rows).toHaveLength(1)
    const secs = rows[0].seconds
    expect(secs[0]).toBeCloseTo(60, 0) // Z1: first 60s at 100 bpm
    expect(secs[2]).toBeCloseTo(60, 0) // Z3: second 60s at 150 bpm
    // the past day must have been persisted to the cache
    const cached = await pool.query(`SELECT zone1_sec, zone3_sec FROM daily_zone_minutes WHERE user_id=$1 AND day=$2`, [TEST_USER_ID, day])
    expect(cached.rows).toHaveLength(1)
    expect(cached.rows[0].zone1_sec).toBe(60)
    expect(cached.rows[0].zone3_sec).toBe(60)
  })

  it('re-reads from the cache on a second call (idempotent)', async () => {
    const rows = await repo.getZoneMinutesRange(TEST_USER_ID, day, day, 'Australia/Brisbane', PROFILE)
    expect(rows[0].seconds[0]).toBe(60)
    expect(rows[0].seconds[2]).toBe(60)
  })
})
