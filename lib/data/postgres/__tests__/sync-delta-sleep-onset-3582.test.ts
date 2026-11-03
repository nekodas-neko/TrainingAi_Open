// #3582 — the sync pull carries an Oura Cloud night's derived onset, final wake and awakenings
// (computed on read from the 30-second hypnogram, no column), and omits them for every other night.
// Runs only against a real local dev Postgres — skips cleanly everywhere else.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const USER = '00000000-0000-4000-8000-000000358200'
const HOUR = 3_600_000
// 10 awake epochs of latency, 3 awake runs (2, 1, 3 epochs) after onset, 8 awake epochs after the last sleep epoch.
const HYPNOGRAM = '4'.repeat(10) + '2'.repeat(60) + '44' + '1'.repeat(40) + '4' + '3'.repeat(30) + '444' + '2'.repeat(20) + '4'.repeat(8)

describe.skipIf(!canRun)('getSyncDelta sleep onset (#3582)', () => {
  let pool: import('pg').Pool
  const end = (daysBack: number) => new Date(Date.now() - daysBack * 24 * HOUR)

  async function seed(daysBack: number, hours: number, ouraId: string, restless: number, hypnogram: string | null) {
    const e = end(daysBack); const s = new Date(e.getTime() - hours * HOUR)
    const date = e.toISOString().slice(0, 10)
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, date, sleep_start, sleep_end, duration_hours, oura_id, restless_periods, source_map)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)`, [USER, date, s, e, hours, ouraId, restless])
    if (!ouraId.startsWith('ble:')) {
      await pool.query(
        `INSERT INTO oura_cloud_sleep_periods (user_id, oura_id, day, bedtime_start, bedtime_end, sleep_type, sleep_phase_30_sec)
         VALUES ($1,$2,$3,$4,$5,'long_sleep',$6)`, [USER, ouraId, date, s, e, hypnogram])
    }
    return { start: s, hours }
  }

  let withHyp: { start: Date; hours: number }
  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    pool = getPool()
    await pool.query(`INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,'sync-onset-3582@example.com','x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`, [USER])
    await pool.query(`DELETE FROM sleep_sessions WHERE user_id = $1`, [USER])
    await pool.query(`DELETE FROM oura_cloud_sleep_periods WHERE user_id = $1`, [USER])
    withHyp = await seed(3, 8, 'cloud-hyp', 180, HYPNOGRAM)
    await seed(4, 7.5, 'cloud-none', 99, null)
    await seed(5, 7, 'cloud-bad', 50, 'x'.repeat(200))
    await seed(6, 7, 'ble:1', 2, null)
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
    return delta.sleepSessions as Record<string, unknown>[]
  }

  it('an Oura Cloud night with a usable hypnogram carries onset, final wake and our awakening count', async () => {
    const r = (await rows()).find(x => x.ouraId === 'cloud-hyp')!
    expect(new Date(r.onsetAt as string).getTime()).toBe(withHyp.start.getTime() + 10 * 30_000)
    expect(new Date(r.finalWakeAt as string).getTime()).toBe(withHyp.start.getTime() + (HYPNOGRAM.length - 8) * 30_000)
    expect(r.computedAwakenings).toBe(3)
    expect(r.restlessPeriods).toBe(180) // Oura's own value stays on the row
  })

  it('never ships the hypnogram itself or the period start', async () => {
    for (const r of await rows()) { expect(r).not.toHaveProperty('sleepPhase30Sec'); expect(r).not.toHaveProperty('bedtimeStart') }
  })

  it('a Cloud night without a usable hypnogram, and a ring night, omit the three fields', async () => {
    const all = await rows()
    for (const id of ['cloud-none', 'cloud-bad', 'ble:1']) {
      const r = all.find(x => x.ouraId === id)!
      expect(r).toBeDefined()
      expect(r).not.toHaveProperty('onsetAt'); expect(r).not.toHaveProperty('finalWakeAt'); expect(r).not.toHaveProperty('computedAwakenings')
    }
    expect(all.find(x => x.ouraId === 'ble:1')!.restlessPeriods).toBe(2)
  })

  it('/api/sync/pull serialises them as ISO strings and a number', async () => {
    const r = JSON.parse(JSON.stringify(await rows())).find((x: Record<string, unknown>) => x.ouraId === 'cloud-hyp')
    expect(typeof r.onsetAt).toBe('string'); expect(Number.isNaN(Date.parse(r.onsetAt))).toBe(false)
    expect(typeof r.computedAwakenings).toBe('number')
  })
})
