// Lever 1 (ingestion culling) proof: the `decoded` JSONB is no longer persisted at
// ingest. This asserts the rollup AND the diagnostic readers reproduce their outputs
// by decoding the archival `body_hex` in-memory when `decoded IS NULL` — i.e. Lever 1
// does not depend on the persisted column. Uses real captured BLE vectors (the same
// ones pinned in lib/__tests__/oura-ble-decode.test.ts).
//
// Runs only against a real local dev Postgres — skips cleanly in CI without a DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000dec0'

// Real captured vectors (tag, hex, decode):
//   0x76 bedtime_period '74376100e6366500' -> start_ds 6371188, end_ds 6633190 (7.28h night)
//   0x5d hrv_event      '3c283e2d3a32'     -> hr [60,62,58], rmssd [40,45,50] (median 45)
//   0x80 ibi_and_amp    '9d09940b9d0d9a099a09a62e946e' -> hr [47,50,47,48,48,44,50]
//   0x6f spo2_event     '00616263ff'       -> spo2_percent [97,98,99]
const BEDTIME_HEX = '74376100e6366500'
const HRV_HEX = '3c283e2d3a32'
const IBI_HEX = '9d09940b9d0d9a099a09a62e946e'
const SPO2_HEX = '00616263ff'
const START_DS = 6371188
const END_DS = 6633190
const ANCHOR_UTC = '2026-07-14T21:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — decode-from-hex when decoded is null (Lever 1)', () => {
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
      [TEST_USER_ID, `ble-fromhex-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }

    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )

    // Every row is inserted with decoded = NULL — exactly what ingest now writes.
    const rows: { ds: number; tag: number; name: string; hex: string }[] = [
      { ds: END_DS, tag: 0x76, name: 'bedtime_period', hex: BEDTIME_HEX },
      { ds: START_DS + 50_000, tag: 0x5d, name: 'hrv_event', hex: HRV_HEX },
      { ds: START_DS + 100_000, tag: 0x5d, name: 'hrv_event', hex: HRV_HEX },
      { ds: START_DS + 150_000, tag: 0x5d, name: 'hrv_event', hex: HRV_HEX },
      { ds: START_DS + 60_000, tag: 0x80, name: 'ibi_and_amplitude_event', hex: IBI_HEX },
      { ds: START_DS + 120_000, tag: 0x80, name: 'ibi_and_amplitude_event', hex: IBI_HEX },
      { ds: END_DS - 100, tag: 0x6f, name: 'spo2_event', hex: SPO2_HEX },
    ]
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (const r of rows) {
      const b = params.length
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, NULL)`)
      params.push(r.ds, r.tag, r.name, r.hex)
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params,
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('rolls up a sleep session from body_hex alone (decoded null)', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(result.sleepSessions).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query(
      `SELECT average_hrv_ms, lowest_heart_rate, avg_heart_rate FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    // Median of the decoded rmssd samples [40,45,50] (× 3 identical rows) = 45.
    // A non-null value here can ONLY have come from decoding body_hex in-memory,
    // since the decoded column is null for every row.
    expect(Number(rows[0].average_hrv_ms)).toBe(45)
    expect(Number(rows[0].lowest_heart_rate)).toBeGreaterThan(0)
    expect(Number(rows[0].avg_heart_rate)).toBeGreaterThan(0)
  })

  it('exposes decoded-from-hex in the tester summary + raw dump', async () => {
    const summary = await repo.getOuraRawSampleSummary(TEST_USER_ID)
    // lastArrayValue over the newest 0x5d row's rmssd_ms [40,45,50] -> 50.
    expect(summary.latestHrvRmssd).toBe(50)
    const hrv = summary.latestByTag.find(r => r.tag === 0x5d)
    expect(hrv?.decoded).not.toBeNull()

    const raw = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [0x5d], 10)
    expect(raw.length).toBeGreaterThan(0)
    expect((raw[0].decoded as Record<string, unknown>)?.rmssd_ms).toEqual([40, 45, 50])
  })
})
