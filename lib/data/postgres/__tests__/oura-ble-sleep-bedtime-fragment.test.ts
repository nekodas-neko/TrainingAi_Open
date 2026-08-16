// Regression (found on-device 2026-07-09): the Ring 5's bedtime_period (0x76) events are
// ~0.5h sub-period FRAGMENTS (e.g. 01:23–01:53), not the full night. The rollup treated them
// as sleep windows, so a night collapsed to a 30-min row (too sparse for HRV/resting-HR) or a
// duplicate, and displayed sleep end times blew out. The fix ignores bedtime windows shorter
// than 3h and clusters the sleep signals into the real full-night window instead. This seeds a
// full night of sleep signals with a 0.5h bedtime fragment inside it and asserts ONE full-night
// row (spanning hours, not 30 min) with HRV — no tiny/duplicate row from the fragment.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f7a6'

const H = 3600 * 10
const NIGHT_START = 5_000_000, NIGHT_END = NIGHT_START + 9 * H // ~9h night
const FRAG_START = NIGHT_START + 3 * H, FRAG_END = FRAG_START + Math.round(0.5 * H) // 30-min fragment inside
const ANCHOR_UTC = '2026-07-09T07:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — bedtime fragment must not shrink the night', () => {
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
      [TEST_USER_ID, `ble-frag-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, NIGHT_END, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    // A 0.5h bedtime fragment INSIDE the night (the exact shape seen on-device).
    add(FRAG_END, 0x76, 'bedtime_period', { bedtime_start_ds: FRAG_START, bedtime_end_ds: FRAG_END, duration_hours: 0.5 })
    // Full night of sleep-only signals + HR/HRV every 30 min.
    for (let ds = NIGHT_START; ds <= NIGHT_END; ds += H / 2) {
      add(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })
      add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [56, 57, 58, 59] })
      add(ds, 0x5d, 'hrv_event', { hr_bpm: [57], rmssd_ms: [43], interval_min: 5 })
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

  it('produces one full-night row (not the 0.5h fragment) with HRV', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    const { rows } = await pool.query(
      `SELECT oura_id, average_hrv_ms,
              EXTRACT(EPOCH FROM (sleep_end - sleep_start)) / 3600 AS span_h
         FROM sleep_sessions WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    // Exactly one row — the fragment must not add a second (duplicate) row.
    expect(rows.length).toBe(1)
    // It spans the real night (~9h), not the 30-min fragment.
    expect(Number(rows[0].span_h)).toBeGreaterThan(3)
    // Keyed to the clustered night start, not the fragment start.
    expect(rows[0].oura_id).toBe(`ble:${NIGHT_START}`)
    expect(Number(rows[0].average_hrv_ms)).toBe(43)
  })
})
