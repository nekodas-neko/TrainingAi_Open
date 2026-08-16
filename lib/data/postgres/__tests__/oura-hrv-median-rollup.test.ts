// Nightly HRV / RHR quality-gated median (Oura on-device-models program, Sub-plan E §5.1).
// Proves the rollup replaced the naive RMSSD mean with `medianGated`, and that the two BLE-sourced
// gates fire: (1) the MET>1.8 active-period exclusion (shared by HRV and the RHR bins) and (2) the
// hr-band accuracy proxy that drops a 5-min 0x5d pair whose paired HR is implausible.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000ded1'

const START_DS = 50_000_000
const END_DS = START_DS + 8 * 3600 * 10
const ANCHOR_UTC = '2026-07-14T21:00:00.000Z'
const MET_DS = START_DS + 100_000 // an active MET bin (met 2.0 > 1.8) → excludes [MET_DS, MET_DS+600]

describe.skipIf(!canRun)('aggregateOuraRawSamples — HRV/RHR quality-gated median', () => {
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
      [TEST_USER_ID, `hrv-median-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )

    const rows: { ds: number; tag: number; name: string; decoded: unknown }[] = [
      { ds: END_DS, tag: 118, name: 'bedtime_period', decoded: { bedtime_start_ds: START_DS, bedtime_end_ds: END_DS } },
      // Good HRV pairs (in-band HR, no MET overlap): RMSSD {40,42,44,46,300}. Mean = 94.4 (skewed
      // by the 300 outlier); median = 44.
      { ds: START_DS + 10_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [55], rmssd_ms: [40], interval_min: 5 } },
      { ds: START_DS + 20_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [56], rmssd_ms: [42], interval_min: 5 } },
      { ds: START_DS + 30_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [57], rmssd_ms: [44], interval_min: 5 } },
      { ds: START_DS + 40_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [58], rmssd_ms: [46], interval_min: 5 } },
      { ds: START_DS + 50_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [59], rmssd_ms: [300], interval_min: 5 } },
      // Accuracy proxy: paired HR 250 is out of the 35-150 band → this pair must be dropped.
      { ds: START_DS + 60_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [250], rmssd_ms: [1000], interval_min: 5 } },
      // MET active period (met 2.0) and an HRV sample inside its 60 s window → MET-excluded.
      { ds: MET_DS, tag: 0x50, name: 'activity_information', decoded: { state: 0, met: [2.0] } },
      { ds: MET_DS + 300, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [52], rmssd_ms: [2], interval_min: 5 } },
      // RHR bins: a low bin (HR 45) overlapping the MET window → excluded; a clean low bin (HR 55).
      { ds: MET_DS + 100, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [45, 45, 45, 45] } },
      { ds: START_DS + 200_000, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [55, 55, 55, 55] } },
      { ds: START_DS + 230_000, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [65, 65, 65, 65] } },
    ]
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (const r of rows) {
      const b = params.length
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, 'aa', $${b + 4}::jsonb)`)
      params.push(r.ds, r.tag, r.name, JSON.stringify(r.decoded))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'workout_sessions']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('persists the gated MEDIAN RMSSD (44), not the outlier-skewed mean, dropping OOB-HR and MET samples', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(result.sleepSessions).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query(
      `SELECT average_hrv_ms, lowest_heart_rate FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    // median{40,42,44,46,300} = 44. A mean would be 94.4; keeping the OOB pair → 45; keeping the
    // MET pair → 43. Exactly 44 proves median + both gates.
    expect(Number(rows[0].average_hrv_ms)).toBe(44)
    // RHR: the HR-45 bin overlaps the MET window and is dropped, so the lowest surviving bin is 55.
    expect(Number(rows[0].lowest_heart_rate)).toBe(55)
  })
})
