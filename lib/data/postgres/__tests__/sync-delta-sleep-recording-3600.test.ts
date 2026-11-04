// #3600 — the sync pull carries a night's generic recording fields (restlessness, incomplete-recording
// flag, algorithm version), computed on read like `listSleepSessions` (no column), and omits them for a
// night whose source gave none. Runs only against a real local dev Postgres; skips cleanly elsewhere.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { formatInTimeZone } from 'date-fns-tz'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000360000'
const HOUR = 3_600_000
// 120 epochs (60 min): 20 restless ('2'), 100 still ('1').
const MOVEMENT = '1'.repeat(40) + '2'.repeat(20) + '1'.repeat(60)

describe.skipIf(!canRun)('getSyncDelta sleep recording fields (#3600)', () => {
  let pool: import('pg').Pool
  const end = (daysBack: number) => new Date(Date.now() - daysBack * 24 * HOUR)

  async function seed(daysBack: number, ouraId: string, period: { movement: string | null; lowBattery: boolean | null; version: string | null } | null) {
    const e = end(daysBack); const s = new Date(e.getTime() - HOUR)
    const date = formatInTimeZone(e, 'Australia/Brisbane', 'yyyy-MM-dd')
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, source_map)
       VALUES ($1,$2,$3,$4,1,$5,'{}'::jsonb)`, [USER, date, s, e, ouraId])
    if (period) {
      await pool.query(
        `INSERT INTO oura_cloud_sleep_periods (user_id, oura_id, day, bedtime_start, bedtime_end, sleep_type, movement_30_sec, low_battery_alert, sleep_algorithm_version)
         VALUES ($1,$2,$3,$4,$5,'long_sleep',$6,$7,$8)`, [USER, ouraId, date, s, e, period.movement, period.lowBattery, period.version])
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'sync-recording-3600@example.com','x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    await seed(3, 'cloud-full', { movement: MOVEMENT, lowBattery: true, version: 'v2' })
    await seed(4, 'cloud-bare', { movement: null, lowBattery: null, version: null })
    await seed(5, 'no-period', null)
  })
  afterAll(async () => {
    if (!canRun) return
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM users WHERE id = $1`, [USER])
  })

  async function rows() {
    const { getRepository } = await import('@/lib/data')
    const delta = await (await getRepository()).getSyncDelta(USER, new Date(0), null)
    return JSON.parse(JSON.stringify(delta.sleepSessions)) as Record<string, unknown>[]
  }

  it('a night whose source gave a series, a flag and a version carries all four, in minutes', async () => {
    const r = (await rows()).find(x => x.ouraId === 'cloud-full')!
    expect(r.restlessMin).toBe(10)          // 20 epochs x 30 s
    expect(r.movementMeasuredMin).toBe(60)  // 120 epochs x 30 s
    expect(r.recordingIncomplete).toBe(true)
    expect(r.sourceAlgorithmVersion).toBe('v2')
  })

  it('never ships the raw series, the flag column or the period start', async () => {
    for (const r of await rows()) {
      for (const k of ['movement30Sec', 'lowBatteryAlert', 'sleepAlgorithmVersion', 'bedtimeStart']) expect(r).not.toHaveProperty(k)
    }
  })

  it('a night whose source gave none, and a night with no period, omit the four fields', async () => {
    const all = await rows()
    for (const id of ['cloud-bare', 'no-period']) {
      const r = all.find(x => x.ouraId === id)!
      expect(r).toBeDefined()
      for (const k of ['restlessMin', 'movementMeasuredMin', 'recordingIncomplete', 'sourceAlgorithmVersion']) expect(r).not.toHaveProperty(k)
    }
  })
})
