// #3075 stages 4 and 5 — `listSleepSessions` maps an Oura Cloud period's movement series, low-battery
// flag and algorithm version into the generic night fields, on read, with no column of ours. A ring
// row (no period) carries none of them. Runs only against a real local dev Postgres; skips elsewhere.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL

const USER = '00000000-0000-4000-8000-000000307504'
const TZ = 'Australia/Brisbane'
const HOUR = 3_600_000
// 8 hours of 30-second epochs, every fourth one moving: 25% of the window.
const MOVEMENT = Array.from({ length: 960 }, (_, i) => (i % 4 === 0 ? '2' : '1')).join('')

describe.skipIf(!canRun)('listSleepSessions: recording detail as generic fields (#3075 stages 4 and 5)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  const NOW = Date.now()
  const dates: Record<string, string> = {}

  async function seedNight(daysBack: number, ouraId: string, period: { movement: string | null; lowBattery: boolean | null; version: string | null } | null) {
    const { formatInTimeZone } = await import('date-fns-tz')
    const end = new Date(NOW - daysBack * 24 * HOUR)
    const start = new Date(end.getTime() - 8 * HOUR)
    const date = formatInTimeZone(end, TZ, 'yyyy-MM-dd')
    dates[ouraId] = date
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, source_map)
       VALUES ($1, $2, $3, $4, 7.5, $5, $6::jsonb)`,
      [USER, date, start, end, ouraId, JSON.stringify({ duration_hours: period ? 'oura_cloud' : 'oura_ble' })])
    if (period) {
      await pool.query(
        `INSERT INTO oura_cloud_sleep_periods (user_id, oura_id, day, bedtime_start, bedtime_end, sleep_type, movement_30_sec, low_battery_alert, sleep_algorithm_version)
         VALUES ($1, $2, $3, $4, $5, 'long_sleep', $6, $7, $8)`,
        [USER, ouraId, date, start, end, period.movement, period.lowBattery, period.version])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    repo = await (await import('@/lib/data')).getRepositoryAsync()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, 'sleep-recording-3075@example.com', 'x', $2)
       ON CONFLICT (id) DO NOTHING`, [USER, TZ])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    await seedNight(3, 'cloud-full', { movement: MOVEMENT, lowBattery: false, version: 'v2' })
    await seedNight(4, 'cloud-low-battery', { movement: MOVEMENT.slice(0, 200), lowBattery: true, version: 'v2' })
    await seedNight(5, 'ble:3075', null)
  })

  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  const list = async () => {
    const all = Object.values(dates).sort()
    return repo.listSleepSessions(USER, all[0], all[all.length - 1])
  }

  it('a full Cloud night carries its restlessness and algorithm version, and is complete', async () => {
    const n = (await list()).find(r => r.ouraId === 'cloud-full')!
    expect(n.restlessMin).toBe(120)
    expect(n.movementMeasuredMin).toBe(480)
    expect(n.sourceAlgorithmVersion).toBe('v2')
    expect(n.recordingIncomplete).toBeUndefined()
  })

  it('a low-battery Cloud night reads as an incomplete recording, and its short series is refused', async () => {
    const n = (await list()).find(r => r.ouraId === 'cloud-low-battery')!
    expect(n.recordingIncomplete).toBe(true)
    expect(n.restlessMin).toBeUndefined()
    expect(n.partialNightAt).toBeNull() // the owner's mark is untouched
  })

  it('a ring night carries none of them', async () => {
    const n = (await list()).find(r => r.ouraId === 'ble:3075')!
    expect(n).not.toHaveProperty('restlessMin')
    expect(n).not.toHaveProperty('recordingIncomplete')
    expect(n).not.toHaveProperty('sourceAlgorithmVersion')
  })
})
