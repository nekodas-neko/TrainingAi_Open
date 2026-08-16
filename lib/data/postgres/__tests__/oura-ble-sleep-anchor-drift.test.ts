// Regression for the prod 2026-07-08 sleep-write crash. BLE sleep rows are keyed
// by a stable oura_id (`ble:<startDs>`) but their sleep_start is derived from the
// movable clock anchor. When the anchor shifts between drains, the same window
// computes a NEW sleep_start; the upsert's conflict target is (user_id,
// sleep_start), so it no longer matches the existing row and tries to INSERT a
// fresh one — which collides with UNIQUE(oura_id) and throws, taking the whole
// rollup (SpO₂ included) down. The rollup now deletes its own oura_ids first.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000d21f'

describe.skipIf(!canRun)('aggregate sleep — survives an anchor shift (oura_id collision)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  // Anchor 1, then a later "drifted" anchor pairing the same ds with a slightly
  // different wall time (as a re-drain would).
  const ANCHOR_DS = 5_000_000
  const START_DS = ANCHOR_DS - 8 * 3600 * 10
  const ANCHOR_UTC_1 = '2026-07-08T09:00:00.000Z'
  const ANCHOR_UTC_2 = '2026-07-08T09:12:34.000Z' // drifted +~12 min

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id,email,password_hash,timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `sleep-drift-${TEST_USER_ID}@example.com`])
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily'])
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])

    // Seed a night's sleep signals + HR so a BLE sleep row is derived.
    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    const push = (ds: number, tag: number, name: string, d: object) => {
      const b = params.length
      rows.push(`($1,$${b + 1},$${b + 2},$${b + 3},'aa',$${b + 4}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(d))
    }
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 3000) push(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.2, 0.1, 0.1, 0.2, 0.1] })
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 300) push(ds, 0x60, 'ibi_and_amplitude_event', { hr_bpm: [52], ibi_ms: [1150], amplitude: [1] })
    for (let ds = START_DS; ds <= ANCHOR_DS; ds += 3000) push(ds, 0x5d, 'hrv_event', { hr_bpm: [52], rmssd_ms: [44], interval_min: 5 })
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id,ring_timestamp_ds,tag,event_name,body_hex,decoded) VALUES ${rows.join(',')}`,
      params)
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily'])
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('re-rolls up after the anchor drifts without an oura_id unique violation', async () => {
    // First rollup at anchor 1 → writes a ble: sleep row with sleep_start via A1.
    await pool.query(`INSERT INTO oura_ble_clock_anchors (user_id,anchor_ds,anchor_utc) VALUES ($1,$2,$3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC_1])
    const first = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(first.sleepSessions).toBeGreaterThanOrEqual(1)
    expect(first.stepErrors).toEqual([])
    const before = await pool.query(`SELECT sleep_start FROM sleep_sessions WHERE user_id=$1 AND oura_id LIKE 'ble:%'`, [TEST_USER_ID])
    expect(before.rows.length).toBe(1)

    // Anchor drifts (a later drain re-pairs the same ds with a new wall time).
    await pool.query(`UPDATE oura_ble_clock_anchors SET anchor_utc=$2 WHERE user_id=$1`, [TEST_USER_ID, ANCHOR_UTC_2])

    // Second rollup: same window, NEW sleep_start. Must not throw on UNIQUE(oura_id).
    const second = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(second.stepErrors).toEqual([])
    const after = await pool.query(`SELECT sleep_start FROM sleep_sessions WHERE user_id=$1 AND oura_id LIKE 'ble:%'`, [TEST_USER_ID])
    // Still exactly one row (owned + replaced), now stamped via the drifted anchor.
    expect(after.rows.length).toBe(1)
    expect(new Date(after.rows[0].sleep_start).getTime()).not.toBe(new Date(before.rows[0].sleep_start).getTime())
  })
})
