// Q-46: `redecodeOuraRawSamples` re-stamped `measured_at` on every row of every page, guarded by
// nothing. `measured_at` is indexed, so an UPDATE writing back the value already there still
// cannot be HOT — it rewrites an entry in all four of this table's indexes. Production reached
// 1,324,792 updates against 740,966 rows with 19 HOT, and ~130 MB of its 306 MB of indexes is
// bloat from exactly that.
//
// The assertion that matters is the SECOND pass: same anchor, same rows, zero writes.
//
// Runs only against a real local dev Postgres — skips in CI.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-00000000f046'
const ANCHOR_DS = 50_000_000
const ANCHOR_UTC = '2026-07-15T09:00:00.000Z'

describe.skipIf(!canRun)('redecodeOuraRawSamples — measured_at re-stamp guard', () => {
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
       VALUES ($1, $2, $3, 0, 'drain')`, [TEST_USER_ID, ANCHOR_DS, ANCHOR_UTC])

    // 40 rows with a deliberately wrong measured_at, so the first pass has real work to do.
    const values: string[] = []
    const params: unknown[] = [TEST_USER_ID]
    for (let i = 0; i < 40; i++) {
      const b = params.length
      params.push(ANCHOR_DS - i * 600, 0x60, 'heart_rate', `aa${i.toString(16).padStart(2, '0')}`)
      values.push(`($1, $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, NULL, '2000-01-01T00:00:00Z', 0)`)
    }
    await pool.query(
      `INSERT INTO oura_raw_samples
         (user_id, ring_timestamp_ds, tag, event_name, body_hex, decoded, measured_at, epoch)
       VALUES ${values.join(',')}`, params)
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id = $1`, [TEST_USER_ID])
  })

  it('re-stamps rows whose measured_at is wrong, then writes nothing on a second pass', async () => {
    const first = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(first.scanned).toBe(40)
    expect(first.restamped).toBe(40)   // all 40 were seeded wrong

    // The whole point. Same anchor, same rows, nothing left to change — so nothing may be written.
    // Before the guard this was 40 again, every pass, forever.
    const second = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(second.scanned).toBe(40)
    expect(second.restamped).toBe(0)
  })

  it('still corrects measured_at against the anchor', async () => {
    const { rows } = await pool.query(
      `SELECT ring_timestamp_ds, measured_at FROM oura_raw_samples
        WHERE user_id = $1 ORDER BY ring_timestamp_ds DESC LIMIT 1`, [TEST_USER_ID])
    // The newest row sits exactly at the anchor, so it must carry the anchor's wall-clock time.
    expect(Number(rows[0].ring_timestamp_ds)).toBe(ANCHOR_DS)
    expect(new Date(rows[0].measured_at).toISOString()).toBe(ANCHOR_UTC)
  })

  it('re-stamps again once the anchor moves', async () => {
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1, $2, $3, 0, 'drain')`,
      [TEST_USER_ID, ANCHOR_DS, '2026-07-15T10:00:00.000Z'])

    const afterMove = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(afterMove.restamped).toBe(40)   // a real correction still happens

    const settled = await repo.redecodeOuraRawSamples(TEST_USER_ID)
    expect(settled.restamped).toBe(0)      // and settles again
  })
})
