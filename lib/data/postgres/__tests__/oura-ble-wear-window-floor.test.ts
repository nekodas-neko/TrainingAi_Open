// PS-30: the rollup derives `oura_daily.non_wear_time_sec` from the 15-min bins it can see, and it
// can only see rows inside the run's window. The window's floor lands mid-day, so the day containing
// the cutoff holds a sliver — and because the floor advances monotonically, that sliver is also the
// LAST value that day ever receives. In production 22 consecutive days (2026-08-14 → 09-04) recorded
// 15–90 min of wear against 7–10 h of scored sleep on the same date, each one last written exactly
// three days later, which is the 3-day incremental margin.
//
// Runs only against a real local dev Postgres — skips cleanly in CI without DATABASE_URL.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000ea70'
const TZ = 'Australia/Brisbane'

const DS_PER_HOUR = 36_000
const DS_PER_DAY = 24 * DS_PER_HOUR
const WEAR_BIN_DS = 15 * 60 * 10

// The anchor pins ds ↔ wall clock, so every date below is fixed by the fixture rather than by the
// clock the test runs on. It is deliberately in the past: the rollup treats *today* as a partial day
// (non-wear counts only elapsed time), and a fixture day that could be today would change semantics.
const ANCHOR_DS = 60_000_000
const ANCHOR_UTC = '2026-07-20T02:00:00.000Z' // = 2026-07-20 12:00 Brisbane
const MIDNIGHT_20 = ANCHOR_DS - 12 * DS_PER_HOUR
const MIDNIGHT_19 = MIDNIGHT_20 - DS_PER_DAY
const MIDNIGHT_17 = MIDNIGHT_19 - 2 * DS_PER_DAY

const TABLES = ['oura_raw_samples', 'oura_ble_clock_anchors', 'sleep_sessions', 'body_metrics', 'oura_heartrate', 'oura_daily', 'oura_rollup_state']

describe.skipIf(!canRun)('aggregateOuraRawSamples — wear time at the window floor', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const nonWear = async (date: string) => {
    const { rows } = await pool.query<{ non_wear_time_sec: number | null }>(
      `SELECT non_wear_time_sec FROM oura_daily WHERE user_id = $1 AND date = $2`, [TEST_USER_ID, date])
    return rows.length === 0 ? 'no row' : rows[0].non_wear_time_sec
  }

  // The caller's span is only half of the floor — `effectiveSinceDs` is the MINIMUM of it and the
  // persisted watermark, so a watermark left by an earlier run would widen the window back out and
  // the test would assert nothing. Clearing it makes `sinceDs` the sole input.
  const runFrom = async (cutoffDs: number) => {
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
    return repo.aggregateOuraRawSamples(TEST_USER_ID, TZ, { sinceDs: cutoffDs + 3 * DS_PER_DAY })
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()

    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', $3)
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `ble-wear-${TEST_USER_ID}@example.com`, TZ])
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc) VALUES ($1, $2, $3)`,
      [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    // One on-finger event per 15-min bin, unbroken from 07-17 00:00 to the anchor — so every whole
    // day in range is 96/96 bins worn and any shortfall in the assertions is windowing, not gaps.
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let ds = MIDNIGHT_17; ds <= ANCHOR_DS; ds += WEAR_BIN_DS) {
      const b = params.length
      values.push(`($1, $${b + 1}, 96, 'ibi_and_amplitude_event', 'aa', $${b + 2}::jsonb)`)
      params.push(ds, JSON.stringify({ hr_bpm: [50, 51], ibi_ms: [800, 810], amplitude: [1, 1] }))
    }
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded) VALUES ${values.join(',')}`,
      params)
  })

  afterAll(async () => {
    if (!canRun) return
    for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('a full-window run records every seeded day as fully worn', async () => {
    await pool.query(`DELETE FROM oura_rollup_state WHERE user_id = $1`, [TEST_USER_ID])
    await repo.aggregateOuraRawSamples(TEST_USER_ID, TZ)
    expect(await nonWear('2026-07-18')).toBe(0)
    expect(await nonWear('2026-07-19')).toBe(0)
  })

  it('does not overwrite a complete day with the sliver the window floor leaves of it', async () => {
    // Floor at 22:00 on 07-19: two hours of that day survive the cutoff. Unfiltered, those 8 bins
    // are written as the day's whole wear — 79,200 s of non-wear over a day the ring never left.
    const cutoff = MIDNIGHT_19 + 22 * DS_PER_HOUR
    // Discriminator: without it, a run that silently did nothing would satisfy the assertion below.
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1 AND date = '2026-07-20'`, [TEST_USER_ID])

    await runFrom(cutoff)

    expect(await nonWear('2026-07-20')).not.toBe('no row')
    expect(await nonWear('2026-07-19')).toBe(0)
  })

  it('still writes the floor day when the cutoff falls exactly on its local midnight', async () => {
    // The floor is only partial because it lands mid-day. On midnight the day IS fully covered, and
    // dropping it would strand a day the run is the only one in a position to write.
    await pool.query(`DELETE FROM oura_daily WHERE user_id = $1 AND date = '2026-07-19'`, [TEST_USER_ID])

    await runFrom(MIDNIGHT_19)

    expect(await nonWear('2026-07-19')).toBe(0)
  })
})
