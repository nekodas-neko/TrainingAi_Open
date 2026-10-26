// #2634: a day's still-period resting HR is stored when Oura's activity document for it is written and
// when heart rate for it lands, in a timezone other than Brisbane. Real Postgres; skips without one.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000002634'
const TZ = 'America/Los_Angeles'
const DAY = '2026-07-14'
// 04:00 PDT on DAY, where Oura's activity day starts.
const ACTIVITY_START = '2026-07-14T11:00:00.000Z'
const MIDDAY = Date.parse('2026-07-14T19:00:00.000Z') // 12:00 PDT

describe.skipIf(!canRun)('still-period resting HR from Oura Cloud data (#2634)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    pool = (await import('@/lib/data/postgres/client')).getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3) ON CONFLICT (id) DO NOTHING`,
      [USER, 'issue-2634@example.com', TZ])
  })
  afterAll(async () => { if (canRun) await pool.query(`DELETE FROM users WHERE id = $1`, [USER]) })
  beforeEach(async () => {
    for (const t of ['oura_heartrate', 'oura_cloud_daily', 'oura_daily_derived', 'sleep_sessions']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [USER])
    }
  })

  const derived = async () => (await pool.query(
    `SELECT still_rhr_bpm, still_rhr_coverage_min FROM oura_daily_derived WHERE user_id = $1 AND day = $2`, [USER, DAY])).rows[0]

  // 3 hours of readings every 5 minutes from local midday, 59–63 bpm (median 61).
  const readings = Array.from({ length: 37 }, (_, i) => ({ timestamp: new Date(MIDDAY + i * 5 * 60_000), bpm: 59 + (i % 5) }))

  it('stores the value when the activity document lands after the heart rate', async () => {
    const { writeOuraCloudData } = await import('@/lib/oura/cloud/ingest')
    const { stillRhrRefresher } = await import('@/lib/oura/cloud/still-rhr')
    await repo.upsertOuraCloudHeartrate(USER, readings, TZ)
    expect(await derived()).toBeUndefined()
    const writes = {
      daily: [], body: [], sleep: [], deletedSleepIds: [], retypedSleepIds: [], workouts: [], sleepPeriods: [], sessions: [],
      cloudDaily: [{ date: DAY, met: { interval: 60, items: Array(1440).fill(1.0), timestamp: ACTIVITY_START }, class5Min: null }],
    }
    await writeOuraCloudData(repo, USER, writes, undefined, stillRhrRefresher(repo))
    const row = await derived()
    expect(Number(row.still_rhr_bpm)).toBe(61)
    expect(Number(row.still_rhr_coverage_min)).toBe(185) // 37 readings × 5 minutes
  })

  it('stores the value when the heart rate lands after the activity document', async () => {
    const { refreshStillRhrAfterHeartRate } = await import('@/lib/oura/cloud/ingest')
    const { stillRhrRefresher } = await import('@/lib/oura/cloud/still-rhr')
    await repo.upsertOuraCloudDaily(USER, [{ date: DAY, met: { interval: 60, items: Array(1440).fill(1.0), timestamp: ACTIVITY_START } }])
    const write = await repo.upsertOuraCloudHeartrate(USER, readings, TZ)
    await refreshStillRhrAfterHeartRate(stillRhrRefresher(repo), USER, write, TZ)
    expect(Number((await derived()).still_rhr_bpm)).toBe(61)
  })

  it('a day with too little heart rate stays NULL', async () => {
    const { refreshStillRhr } = await import('@/lib/oura/cloud/still-rhr')
    await repo.upsertOuraCloudDaily(USER, [{ date: DAY, met: { interval: 60, items: Array(1440).fill(1.0), timestamp: ACTIVITY_START } }])
    await repo.upsertOuraCloudHeartrate(USER, readings.slice(0, 5), TZ)
    expect(await refreshStillRhr(repo, USER, [DAY])).toEqual([])
    expect(await derived()).toBeUndefined()
  })
})
