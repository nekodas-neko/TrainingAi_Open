// The BLE rollup must turn the ring's hypnogram phase events (0x4b/0x4e/0x5a) into a
// `sleep_phase_5_min` string (so the Health sleep ribbon renders) AND the deep/REM/light
// stage hours — from a SINGLE tag, not a triple-counting concatenation of all three.
// Seeds a night with a long 0x4b sequence and a short redundant 0x5a one, and asserts the
// long tag wins and the string/hours populate.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000b1a5'

const START_DS = 60_000_000
const END_DS = START_DS + 8 * 3600 * 10 // a realistic full-night window (>= the 3h min)
const ANCHOR_UTC = '2026-07-07T21:00:00.000Z'

const rep = (stage: string, n: number) => Array(n).fill(stage)

describe.skipIf(!canRun)('aggregateOuraRawSamples — sleep hypnogram phases', () => {
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
      [TEST_USER_ID, `ble-phase-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END_DS, ANCHOR_UTC],
    )
    // Bedtime window (0x76) so the rollup has a defined sleep session.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded)
       VALUES ($1, $2, 118, 'bedtime_period', 'deadbeef', $3)`,
      [TEST_USER_ID, END_DS, JSON.stringify({ bedtime_start_ds: START_DS, bedtime_end_ds: END_DS })],
    )

    // 0x4b (75): the real per-epoch stream — 40 codes = 10 each of deep/light/rem/awake
    // → 4 five-min buckets → '1234'.
    const long = [...rep('deep', 10), ...rep('light', 10), ...rep('rem', 10), ...rep('awake', 10)]
    // 0x5a (90): a short redundant copy — if the rollup concatenated all tags this would
    // corrupt the string; single-tag-longest selection must ignore it.
    const short = rep('light', 4)
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES
         ($1, $2, 75, 'sleep_phase_information', 'aa', $3::jsonb),
         ($1, $4, 90, 'sleep_phase_data', 'bb', $5::jsonb)`,
      [
        TEST_USER_ID,
        START_DS + 100, JSON.stringify({ header: 0, phases: long }),
        START_DS + 200, JSON.stringify({ header: 0, phases: short }),
      ],
    )
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('builds sleep_phase_5_min + stage hours from the longest single tag', async () => {
    const result = await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    expect(result.sleepSessions).toBeGreaterThanOrEqual(1)

    const { rows } = await pool.query(
      `SELECT sleep_phase_5_min, deep_sleep_hours, rem_sleep_hours, light_sleep_hours, awake_hours
         FROM sleep_sessions WHERE user_id = $1 AND oura_id = $2`,
      [TEST_USER_ID, `ble:${START_DS}`],
    )
    expect(rows.length).toBe(1)
    // The 0x4b stream wins (40 codes > 0x5a's 4) — not a concatenation of both tags.
    expect(rows[0].sleep_phase_5_min).toBe('1234')
    // 10 codes × 30s = 5 min = 0.08h per stage.
    expect(Number(rows[0].deep_sleep_hours)).toBeCloseTo(0.08, 2)
    expect(Number(rows[0].rem_sleep_hours)).toBeCloseTo(0.08, 2)
    expect(Number(rows[0].light_sleep_hours)).toBeCloseTo(0.08, 2)
    expect(Number(rows[0].awake_hours)).toBeCloseTo(0.08, 2)
  })
})
