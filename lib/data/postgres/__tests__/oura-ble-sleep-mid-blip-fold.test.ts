// A single isolated 5-min movement blip mid-sleep is a stir, not a true awakening — the rollup must
// fold it back into the surrounding sleep stage (not subtract it as Awake time) while still
// reflecting it in restless_periods, so the "restlessness" signal isn't lost even though it no
// longer eats into duration_hours. Companion: a SUSTAINED (2-epoch) mid-sleep movement bout must
// still count as real Awake time.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000b117'

const H = 3600 * 10
const EPOCH_DS = 5 * 60 * 10
const START_DS = 9_000_000, END_DS = START_DS + 8 * H
const ANCHOR_UTC = '2026-07-09T07:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — mid-sleep wake bout folding', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `ble-blip-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    for (let k = 0; k < 96; k++) {
      const ds = START_DS + k * EPOCH_DS
      // A lone single-epoch movement blip at k=30, and a genuine sustained 2-epoch bout at k=60-61.
      const isBlip = k === 30
      const isSustained = k === 60 || k === 61
      const movement = isBlip || isSustained ? 20 : 0.1
      const hr = isBlip || isSustained ? 70 : 55
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [movement, movement, movement, movement, movement, movement] })
      add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [hr, hr, hr, hr] })
      add(ds, 0x5d, 'hrv_event', { hr_bpm: [hr], rmssd_ms: [45], interval_min: 5 })
      add(ds, 0x75, 'sleep_temp_event', { temps_c: [35] })
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${rows.join(',')}`,
      [TEST_USER_ID, ...params],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('folds the isolated blip into sleep but keeps the sustained bout as real awake time', async () => {
    // This asserts the heuristic stager's mid-sleep wake-fold behaviour (the fallback path),
    // so run the heuristic directly — the neural stager overrides it on real nights.
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane', { disableNeuralStager: true })
    const { rows } = await pool.query(
      `SELECT sleep_phase_5_min, restless_periods, duration_hours
         FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    const phases: string = rows[0].sleep_phase_5_min
    expect(phases.length).toBeGreaterThan(80)
    // The isolated blip (k=30) must NOT read as awake — it folded into the surrounding sleep stage.
    expect(phases[30]).not.toBe('4')
    // The sustained bout (k=60,61) must still read as awake — a real, un-folded awakening.
    expect(phases[60]).toBe('4')
    expect(phases[61]).toBe('4')
    // The fold is still reflected in restlessness — the frequency signal isn't silently dropped.
    expect(Number(rows[0].restless_periods)).toBeGreaterThanOrEqual(1)
  })
})
