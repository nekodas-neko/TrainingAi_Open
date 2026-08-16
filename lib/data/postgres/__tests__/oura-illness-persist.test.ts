// Sub-plan E §5.5 persist: the rollup writes the illness radar per night to oura_daily_derived
// (analysis record), from the SAME baseline-z the readiness route computes live. Seeds two nights
// of raw BLE samples, runs aggregateOuraRawSamples, and asserts an illness row lands for the later
// night (the first has no prior baseline). Two nights → a cold baseline → flag "learning", which is
// exactly what should persist; the flag→fever math is covered by the illness-radar unit tests.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without a DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// The models run from recordings of themselves, so this suite needs no `.onnx` file — see
// `lib/oura-models/inference/__tests__/helpers/replay-session.ts`. The rollup itself runs for real.
vi.mock('@/lib/oura-models/inference/session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/oura-models/inference/session')>()
  const { makeReplayGetSession } = await import('@/lib/oura-models/inference/__tests__/helpers/replay-session')
  return { ...actual, getSession: makeReplayGetSession(actual.getSession) }
})


const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-0000000111ee'

const DAY_DS = 24 * 3600 * 10
const START1 = 30_000_000
const END1 = START1 + 8 * 3600 * 10
const START2 = START1 + DAY_DS
const END2 = START2 + 8 * 3600 * 10
const ANCHOR_UTC = '2026-07-14T21:00:00.000Z'

describe.skipIf(!canRun)('aggregateOuraRawSamples — illness radar persisted per night (E §5.5)', () => {
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
      [TEST_USER_ID, `ill-${TEST_USER_ID}@example.com`],
    )
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_daily_summary', 'oura_daily_derived']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, END2, ANCHOR_UTC],
    )

    const night = (startDs: number, endDs: number) => [
      { ds: endDs, tag: 118, name: 'bedtime_period', decoded: { bedtime_start_ds: startDs, bedtime_end_ds: endDs } },
      { ds: startDs + 40_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [55], rmssd_ms: [42], interval_min: 5 } },
      { ds: startDs + 80_000, tag: 0x5d, name: 'hrv_event', decoded: { hr_bpm: [56], rmssd_ms: [44], interval_min: 5 } },
      { ds: startDs + 120_000, tag: 0x80, name: 'ibi_and_amplitude_event', decoded: { hr_bpm: [50, 50, 50, 50] } },
      { ds: startDs + 60_000, tag: 0x75, name: 'sleep_temp', decoded: { temps_c: [34.5, 34.6] } },
    ]
    const rows = [...night(START1, END1), ...night(START2, END2)]
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
    for (const t of ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_daily_summary', 'oura_daily_derived']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('persists an illness_flag row for the later night', async () => {
    await repo.aggregateOuraRawSamples(TEST_USER_ID, 'Australia/Brisbane')

    // Two summary nights were produced; the illness step persists from the 2nd onward.
    const { rows: summaries } = await pool.query(
      `SELECT count(*)::int AS n FROM oura_daily_summary WHERE user_id = $1`, [TEST_USER_ID])
    expect(summaries[0].n).toBeGreaterThanOrEqual(2)

    const { rows } = await pool.query(
      `SELECT illness_flag, illness_score FROM oura_daily_derived WHERE user_id = $1 AND illness_flag IS NOT NULL`,
      [TEST_USER_ID])
    expect(rows.length).toBeGreaterThanOrEqual(1)
    // Cold baseline (2 nights) → learning, score 0 — the correct persisted state, proving the wiring.
    expect(rows[0].illness_flag).toBe('learning')
    expect(Number(rows[0].illness_score)).toBe(0)
  })
})
