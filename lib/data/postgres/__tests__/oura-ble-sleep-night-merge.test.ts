// Regression (found on-device 2026-07-09): a single night produced multiple sleep-signal clusters
// (a >2h gap split them), each dated to the same wake day, and the read-time mergeByDate SUMMED
// their durations — 07-09 showed a 15.7h "time asleep" for a ~10h window. The rollup now collapses
// clusters < 3h apart into ONE window per night. This seeds two bursts 2.5h apart and asserts a
// single sleep row spanning both, with a sane (not doubled) duration.
//
// Runs only against a real local dev Postgres — skips cleanly in CI (no DATABASE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000e17e'

const H = 3600 * 10
const B1_START = 7_000_000, B1_END = B1_START + Math.round(1.5 * H)
const B2_START = B1_END + Math.round(2.5 * H), B2_END = B2_START + Math.round(1.5 * H) // 2.5h gap ⇒ splits, then merges
const ANCHOR_UTC = '2026-07-09T08:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — merge a night\'s split clusters into one window', () => {
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
      [TEST_USER_ID, `ble-merge-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, B2_END, ANCHOR_UTC],
    )

    const rows: string[] = []
    const params: unknown[] = []
    const add = (ds: number, tag: number, name: string, decoded: unknown) => {
      const b = params.length
      rows.push(`($1, $${b + 2}, $${b + 3}, $${b + 4}, 'aa', $${b + 5}::jsonb)`)
      params.push(ds, tag, name, JSON.stringify(decoded))
    }
    for (const [s, e] of [[B1_START, B1_END], [B2_START, B2_END]] as const) {
      for (let ds = s; ds <= e; ds += H / 12) { // every 5 min
        add(ds, 0x72, 'sleep_acm_period', { acm_mad: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1] })
        add(ds, 0x80, 'ibi_and_amplitude_event', { hr_bpm: [55, 56, 57, 58] })
        add(ds, 0x5d, 'hrv_event', { hr_bpm: [56], rmssd_ms: [45], interval_min: 5 })
      }
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

  it('emits one sleep row for the night, spanning both clusters (no summed duplicate)', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const { rows } = await pool.query(
      `SELECT oura_id, date, time_in_bed_hours, EXTRACT(EPOCH FROM (sleep_end - sleep_start)) / 3600 AS span_h
         FROM sleep_sessions WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    // One merged row, not two.
    expect(rows.length).toBe(1)
    // Spans the whole night (~5.5h from B1_START to B2_END), not just one 1.5h burst.
    expect(Number(rows[0].span_h)).toBeGreaterThan(5)
    expect(Number(rows[0].time_in_bed_hours)).toBeLessThan(16) // never exceeds the cap

    // Orphan cleanup: an old-shape BLE row for the same wake-day (e.g. a second cluster from a
    // prior rollup) must be DELETED on re-run, not left for mergeByDate to sum back in.
    const date = rows[0].date
    await pool.query(
      `INSERT INTO sleep_sessions (user_id, oura_id, date, sleep_start, sleep_end, duration_hours)
       VALUES ($1, 'ble:stale-orphan', $2, ($2::date + time '20:00'), ($2::date + time '22:00'), 2)`,
      [TEST_USER_ID, date],
    )
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')
    const { rows: after } = await pool.query(
      `SELECT count(*)::int AS n FROM sleep_sessions WHERE user_id = $1 AND oura_id LIKE 'ble:%'`,
      [TEST_USER_ID],
    )
    expect(after[0].n).toBe(1) // the orphan is gone; still exactly one BLE night
  })
})
