import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { DS_BUCKET_SPAN } from '@/lib/data/postgres/slices/oura-raw-frames'
import { HOT_WINDOW_DS, resetAutoPackThrottle } from '@/lib/data/postgres/slices/oura-raw-pack'

// Q-541 Task 6. The packer was already correct and already tested; what was missing was anything
// that runs it. This is the only test that proves the ingest path does — everything else would pass
// against a packer wired to nothing, which is exactly the state that let `oura_raw_samples` regrow
// to 92 MB in the five days after the backfill.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054106'
const TAG = 0x76

const COLD_BUCKET = 400
const coldFrames = Array.from({ length: 8 }, (_, i) => ({
  ds: COLD_BUCKET * DS_BUCKET_SPAN + i * 900,
  hex: `76${i.toString(16).padStart(2, '0')}0a0b0c${i.toString(16).padStart(2, '0')}0d`,
}))
/** The batch that triggers the run — far enough above the cold bucket to seal it. */
const FRESH_DS = COLD_BUCKET * DS_BUCKET_SPAN + HOT_WINDOW_DS + 3 * DS_BUCKET_SPAN

describe.skipIf(!canRun)('the ingest path runs the packer', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository

  const packedRows = async () => Number((await pool.query(
    `SELECT count(*)::int n FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])).rows[0].n)
  const coldHotRows = async () => Number((await pool.query(
    `SELECT count(*)::int n FROM oura_raw_samples WHERE user_id=$1 AND ring_timestamp_ds / $2 = $3`,
    [TEST_USER_ID, DS_BUCKET_SPAN, COLD_BUCKET])).rows[0].n)

  /** Fire-and-forget by design, so the assertion has to wait for it rather than await it. */
  const until = async (want: () => Promise<boolean>, ms = 5_000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (await want()) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return false
  }

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    const { PostgresWorkoutRepository } = await import('@/lib/data/postgres/adapter')
    repo = new PostgresWorkoutRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `autopack-${TEST_USER_ID}@example.com`],
    )
  })
  beforeEach(async () => {
    resetAutoPackThrottle()
    for (const t of ['oura_raw_packed', 'oura_raw_samples', 'oura_ble_clock_anchors']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id=$1`, [TEST_USER_ID])
    }
    for (const f of coldFrames) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch, recorded_at)
         VALUES ($1,$2,$3,'test',$4,0, now() - interval '30 days') ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, f.ds, TAG, f.hex])
    }
  })
  afterAll(async () => {
    for (const t of ['oura_raw_packed', 'oura_raw_samples', 'oura_ble_clock_anchors']) {
      await pool.query(`DELETE FROM ${t} WHERE user_id=$1`, [TEST_USER_ID])
    }
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  it('packs the sealed bucket a fresh batch leaves behind', async () => {
    expect(await coldHotRows()).toBe(coldFrames.length)

    const n = await repo.insertOuraRawSamples(TEST_USER_ID, [
      { ringTimestampDs: FRESH_DS, tag: TAG, eventName: 'bedtime_period', bodyHex: 'aabbccdd' },
    ])
    expect(n).toBe(1)

    // Poll for the packer's FINAL state, not its first phase. The three phases commit separately
    // and deliberately (see the module docstring on `oura-raw-pack.ts`), so a packed row existing
    // proves only that phase 2 got there — phase 3's delete can still be in flight. Waiting on
    // phase 1 and then asserting phase 3 with no wait allowed it exactly zero milliseconds, which
    // holds on an idle machine and fails on a loaded CI runner: `expected 8 to be +0`, on a
    // docs-only PR (BF-18). Any assertion added here polls for the same reason.
    expect(await until(async () =>
      (await packedRows()) === 1 && (await coldHotRows()) === 0)).toBe(true)
    expect(Number((await pool.query(
      `SELECT frame_count FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])).rows[0].frame_count),
    ).toBe(coldFrames.length)                              // …intact
  })

  // The throttle is what keeps this off the hot path: one run per user per window, not one per
  // drain batch. A ring drains hourly, so without it every batch would re-scan the whole table.
  it('does not run again on the next batch in the same window', async () => {
    await repo.insertOuraRawSamples(TEST_USER_ID, [
      { ringTimestampDs: FRESH_DS, tag: TAG, eventName: 'bedtime_period', bodyHex: 'aabbccdd' },
    ])
    expect(await until(async () => (await packedRows()) === 1)).toBe(true)

    // A second sealed bucket appears, and a second batch arrives — but the window has not passed.
    await pool.query(
      `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch, recorded_at)
       VALUES ($1,$2,$3,'test','beefcafe',0, now() - interval '30 days')`,
      [TEST_USER_ID, (COLD_BUCKET + 1) * DS_BUCKET_SPAN, TAG])
    await repo.insertOuraRawSamples(TEST_USER_ID, [
      { ringTimestampDs: FRESH_DS + 10, tag: TAG, eventName: 'bedtime_period', bodyHex: 'aabbccde' },
    ])

    await new Promise(r => setTimeout(r, 300))
    expect(await packedRows()).toBe(1)
  })

  it('leaves the ingest itself unaffected when the packer cannot run', async () => {
    // A blob already sitting on the bucket with the wrong frame count makes the packer refuse. The
    // batch must still be stored and counted — the pack is opportunistic, never a precondition.
    await pool.query(
      `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1, 0, $2, $3, 999, 0, 1, 'nope', '\\x00'::bytea)`,
      [TEST_USER_ID, TAG, COLD_BUCKET])

    const n = await repo.insertOuraRawSamples(TEST_USER_ID, [
      { ringTimestampDs: FRESH_DS, tag: TAG, eventName: 'bedtime_period', bodyHex: 'aabbccdd' },
    ])
    expect(n).toBe(1)
    await new Promise(r => setTimeout(r, 500))
    expect(await coldHotRows()).toBe(coldFrames.length)    // refused, so nothing was deleted
  })
})
