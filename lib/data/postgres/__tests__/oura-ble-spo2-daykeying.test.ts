// Regression for the prod 2026-07-08 SpO₂ bug: a single overnight sleep
// (07-07 22:49 → 07-08 06:46) has its 6,840 raw SpO₂ samples split by the
// calendar midnight — 1,057 before, 5,783 after. The old rollup keyed SpO₂ via
// the sleep-signal window and orphaned the post-midnight 5,783 entirely, so the
// day with MOST of the night's data (07-08) got no SpO₂. SpO₂ is now keyed by
// each sample's own local calendar day, so both days populate.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000005b2'

// Brisbane is UTC+10. Anchor: ring ds 3_000_000 ↔ 2026-07-08T00:00:00Z, i.e.
// 2026-07-08 10:00 Brisbane. Ring clock: 1 ds = 100 ms.
const ANCHOR_DS = 80_000_000
const ANCHOR_UTC = '2026-07-08T00:00:00.000Z'
// A ds at Brisbane local midnight (07-08 00:00 = 07-07 14:00Z) is 10h before the
// anchor → ANCHOR_DS - 10*3600*10.
const LOCAL_MIDNIGHT_DS = ANCHOR_DS - 10 * 3600 * 10
const BEFORE_MIDNIGHT_DS = LOCAL_MIDNIGHT_DS - 3600 * 10 // 07-07 23:00 local
const AFTER_MIDNIGHT_DS = LOCAL_MIDNIGHT_DS + 3600 * 10  // 07-08 01:00 local

describe.skipIf(!canRun)('SpO₂ day-keying — night split across midnight', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `spo2-daykey-${TEST_USER_ID}@example.com`])
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily'])
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1,$2,$3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    // A sleep-signal window (0x72) spanning the night so a sleep session forms —
    // its wake day is 07-08, but SpO₂ must NOT all collapse onto (or off of) it.
    const rows: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    const push = (ds: number, tag: number, name: string, decoded: object) => {
      const b = params.length
      rows.push(`($1,$${b + 1},$${b + 2},$${b + 3},'aa',$${b + 4}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    for (let ds = BEFORE_MIDNIGHT_DS; ds <= AFTER_MIDNIGHT_DS; ds += 3000)
      push(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.2, 0.1, 0.1, 0.2, 0.1] })
    // SpO₂ raw R/PI: a handful before midnight (→07-07), the majority after (→07-08).
    for (let k = 0; k < 3; k++) push(BEFORE_MIDNIGHT_DS + k * 300, 0x8b, 'spo2_r_pi_event', { r: [0.78], perfusion_index: [0.02] })
    for (let k = 0; k < 20; k++) push(AFTER_MIDNIGHT_DS + k * 300, 0x8b, 'spo2_r_pi_event', { r: [0.78], perfusion_index: [0.02] })
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

  it('populates SpO₂ on BOTH calendar days the night straddles', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const { rows } = await pool.query(
      `SELECT date::text, spo2_pct FROM body_metrics WHERE user_id = $1 AND spo2_pct IS NOT NULL ORDER BY date`,
      [TEST_USER_ID])
    const byDay = Object.fromEntries(rows.map(r => [r.date, Number(r.spo2_pct)]))
    // r=0.78 → ~93% under the gen4 quadratic; both days present (07-08 is the one
    // that orphaned before this fix).
    expect(byDay['2026-07-07']).toBeCloseTo(93.1, 0)
    expect(byDay['2026-07-08']).toBeCloseTo(93.1, 0)
  })
})
