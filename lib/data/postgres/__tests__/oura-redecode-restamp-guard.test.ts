// Q-46 → Q-541 Task 7. This file used to assert that `redecodeOuraRawSamples` re-stamped
// `measured_at` correctly and, crucially, wrote NOTHING on a second pass with the same anchor.
//
// The re-stamp is gone. Every reader now derives the wall-clock time from the clock anchors and the
// event name from `tag`, so both columns are dead and the pass had nothing left to correct — and
// that pass is what filled the disk on 2026-08-17. `measured_at` was indexed, so an UPDATE that
// changed the value could never be a HOT update: production recorded 1,324,792 updates against
// 740,966 rows with **19** HOT, and one full re-stamp rewrote 681,005 rows without adding a frame.
// Q-46's `IS DISTINCT FROM` guard bounded that but could not remove it, because the Q-71/Q-536 clock
// fixes made every row genuinely distinct.
//
// So the invariant worth guarding inverted, and this file now pins the stronger one: the redecode
// does not write to `oura_raw_samples` **at all**. A guard that has to be right about when to skip a
// write is a guard that can be wrong; no write cannot.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f046'
const ANCHOR_DS = 50_000_000
const ANCHOR_UTC = '2026-07-15T09:00:00.000Z'

describe.skipIf(!canRun)('redecodeOuraRawSamples writes nothing to oura_raw_samples', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool()
    repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone) VALUES ($1, $2, 'x', 'Australia/Brisbane')
       ON CONFLICT (id) DO NOTHING`, [TEST_USER_ID, `restamp-${TEST_USER_ID}@example.com`])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1, $2, $3, 0, 'test')`, [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    // Rows deliberately carrying a WRONG stored measured_at and a WRONG stored event_name — the
    // exact state the old pass existed to repair. Nothing should touch them now.
    for (let i = 0; i < 5; i++) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, measured_at)
         VALUES ($1, $2, 118, 'stale_name', $3, '2001-01-01T00:00:00.000Z')
         ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, ANCHOR_DS - i * 1000, `76${i.toString(16).padStart(2, '0')}0000`])
    }
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  const snapshot = async () => (await pool.query(
    `SELECT ring_timestamp_ds, tag, event_name, measured_at, body_hex
       FROM oura_raw_samples WHERE user_id = $1 ORDER BY ring_timestamp_ds`,
    [TEST_USER_ID])).rows

  it('leaves every row byte-for-byte unchanged, twice over', async () => {
    const before = await snapshot()
    expect(before).toHaveLength(5)

    const first = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(first).toEqual({ scanned: 0, updated: 0, restamped: 0 })
    expect(await snapshot()).toEqual(before)

    const second = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(second).toEqual({ scanned: 0, updated: 0, restamped: 0 })
    expect(await snapshot()).toEqual(before)
  })

  // The stale columns above stay stale on disk and it does not matter: the readers derive. This is
  // what makes leaving the pass out safe rather than merely cheap.
  it('serves the DERIVED name and time, over rows whose stored columns are wrong', async () => {
    await repo.redecodeOuraRawSamples(TEST_USER_ID)
    const rows = await repo.getOuraRawSamplesByTags(TEST_USER_ID, [118], 5)
    expect(rows).toHaveLength(5)
    for (const r of rows) {
      expect(r.eventName).toBe('bedtime_period')      // not the stored 'stale_name'
      expect(r.measuredAt).not.toBeNull()
      expect(new Date(r.measuredAt!).getUTCFullYear()).toBe(2026)  // not the stored 2001
    }
  })
})
