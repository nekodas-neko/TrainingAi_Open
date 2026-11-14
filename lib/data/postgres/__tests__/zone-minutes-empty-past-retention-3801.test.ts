// #3801 item 2: an all-zero daily_zone_minutes row is a day with no heart rate to count, so it reads
// as missing at any age, not only while the HR is still there to re-check it. Real minutes past the
// retention cutoff are still served from the cache. The read never rewrites the zero rows.
//
// Days are derived from the clock (rules/dates-and-timezones: never hardcode one side of a rolling
// window). Runs only against a local dev Postgres; skips where there is no DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { shiftDateStr, todayInTz } from '@trainingai/shared/date-utils'
import { zoneRetentionCutoff } from '@/lib/data/postgres/slices/oura'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000038012'
const TZ = 'Australia/Brisbane'
const PROFILE = { maxHr: 190, restingHr: 50 }

describe.skipIf(!canRun)('getZoneMinutesRange: all-zero days past retention (#3801)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const today = todayInTz(TZ)
  const cutoff = zoneRetentionCutoff(today)
  const oldZero = shiftDateStr(cutoff, -20)
  const oldReal = shiftDateStr(cutoff, -19)
  const recentZero = shiftDateStr(today, -10)

  async function row(day: string, secs: [number, number, number, number, number]) {
    await pool.query(
      `INSERT INTO daily_zone_minutes (user_id, day, zone1_sec, zone2_sec, zone3_sec, zone4_sec, zone5_sec, max_hr, resting_hr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [TEST_USER_ID, day, ...secs, PROFILE.maxHr, PROFILE.restingHr],
    )
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `zone-empty-${TEST_USER_ID}@example.com`, TZ],
    )
    await pool.query('DELETE FROM oura_heartrate WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM daily_zone_minutes WHERE user_id = $1', [TEST_USER_ID])
    await row(oldZero, [0, 0, 0, 0, 0])
    await row(oldReal, [600, 300, 120, 0, 0])
    await row(recentZero, [0, 0, 0, 0, 0])
  })

  afterAll(async () => {
    await pool.query('DELETE FROM daily_zone_minutes WHERE user_id = $1', [TEST_USER_ID])
    await pool.query('DELETE FROM users WHERE id = $1', [TEST_USER_ID])
  })

  it('leaves out an all-zero day older than the cutoff', async () => {
    const out = await repo.getZoneMinutesRange(TEST_USER_ID, oldZero, oldZero, TZ, PROFILE)
    expect(out).toEqual([])
  })

  it('leaves out an all-zero day inside the cutoff that has no heart rate', async () => {
    const out = await repo.getZoneMinutesRange(TEST_USER_ID, recentZero, recentZero, TZ, PROFILE)
    expect(out).toEqual([])
  })

  it('still serves real minutes older than the cutoff', async () => {
    const out = await repo.getZoneMinutesRange(TEST_USER_ID, oldZero, oldReal, TZ, PROFILE)
    expect(out).toEqual([{ day: oldReal, seconds: [600, 300, 120, 0, 0] }])
  })

  it('does not change the stored rows', async () => {
    const r = await pool.query(
      `SELECT day::text AS day, zone1_sec + zone2_sec + zone3_sec + zone4_sec + zone5_sec AS total
       FROM daily_zone_minutes WHERE user_id = $1 ORDER BY day`, [TEST_USER_ID])
    expect(r.rows).toEqual([
      { day: oldZero, total: 0 }, { day: oldReal, total: 1020 }, { day: recentZero, total: 0 },
    ])
  })
})
