// Regression: the SleepNet high-res SpO₂ channel was fed only from firmware %
// events (0x6f), which the Ring 5 never emits — it sends raw R/PI (0x8b) instead.
// The assembler therefore saw an all-empty SpO₂ channel (dump showed `spo2=0` on
// every real night). It now derives % from 0x8b via spo2PctFromR, mirroring the
// body_metrics rollup's source precedence, so the model's SpO₂ input is populated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005b3'

// Brisbane is UTC+10. Anchor: ring ds 3_000_000 ↔ 2026-07-08T00:00:00Z (10:00 Brisbane).
const ANCHOR_DS = 90_000_000
const ANCHOR_UTC = '2026-07-08T00:00:00.000Z'
const LOCAL_MIDNIGHT_DS = ANCHOR_DS - 10 * 3600 * 10 // 07-08 00:00 Brisbane
const START_DS = LOCAL_MIDNIGHT_DS - 2 * 3600 * 10   // 07-07 22:00 local
const END_DS = LOCAL_MIDNIGHT_DS + 6 * 3600 * 10     // 07-08 06:00 local (wake day = 07-08)
const SPO2_COUNT = 9

describe.skipIf(!canRun)('SleepNet SpO₂ input — derived from raw R/PI (0x8b)', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `sleepnet-spo2-${TEST_USER_ID}@example.com`])
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily'])
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1,$2,$3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    const push = (ds: number, tag: number, name: string, decoded: object) => {
      const b = params.length
      rows.push(`($1,$${b + 1},$${b + 2},$${b + 3},'aa',$${b + 4}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    // Sleep-signal window (0x72) spanning the whole night so one session forms.
    for (let ds = START_DS; ds <= END_DS; ds += 3000)
      push(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.2, 0.1, 0.1, 0.2, 0.1] })
    // SpO₂ raw R/PI (0x8b) evenly spread INSIDE the window — the Ring 5's only SpO₂ source.
    const step = Math.floor((END_DS - START_DS) / (SPO2_COUNT + 1))
    for (let k = 1; k <= SPO2_COUNT; k++)
      push(START_DS + k * step, 0x8b, 'spo2_r_pi_event', { r: [0.78], perfusion_index: [0.02] })
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      params)
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily'])
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('feeds the assembler SpO₂ derived from 0x8b (channel no longer empty)', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { debugDate: '2026-07-08' })
    // Every 0x8b sample sits inside the window → all reach the assembler's SpO₂ channel.
    expect(result.debugNight?.sleepNet?.counts.spo2).toBe(SPO2_COUNT)
  })
})
