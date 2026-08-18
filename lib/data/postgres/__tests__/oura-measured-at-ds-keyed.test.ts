import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { packFrames, hexToBody } from '@/lib/oura-ble/frame-pack'
import { DS_BUCKET_SPAN } from '@/lib/data/postgres/slices/oura-raw-frames'

// Q-541 Task 7 / Q-534 finding 4. Both wall-clock readers of `oura_raw_samples` were rewritten to
// convert their window to a ring `ds` range through the clock anchors, which is what let migration
// 193 drop `idx_oura_raw_samples_user_measured` (136 MB).
//
// What these tests pin is the equivalence — the window still selects the same frames — and the two
// things the rewrite additionally fixes, both of which the old column could not do: it sees packed
// frames, and it cannot go stale when the clock model changes.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054104'
const TAG = 0x5d
const DS_PER_HOUR = 36_000

describe.skipIf(!canRun)('ds-keyed wall-clock reads', () => {
  let pool: import('pg').Pool
  let repo: import('@/lib/data/repository').WorkoutRepository
  // The anchor: ds 10,000,000 was "now". Frames below it are in the past by (anchorDs - ds) / 36000
  // hours, which is what makes a wall-clock window expressible as a ds range at all.
  const ANCHOR_DS = 10_000_000
  let anchorUtc: Date

  const insertHot = async (dsList: number[], tag = TAG) => {
    for (const ds of dsList) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch, measured_at)
         VALUES ($1,$2,$3,'test',$4,0,NULL) ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, ds, tag, '5d0102030405060708'],
      )
    }
  }

  beforeAll(async () => {
    const { getPool } = await import('@/lib/data/postgres/client')
    const { getRepository } = await import('@/lib/data')
    pool = getPool(); repo = await getRepository()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1,$2,'x','Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `dskeyed-${TEST_USER_ID}@example.com`])
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id=$1`, [TEST_USER_ID])
    anchorUtc = new Date()
    await pool.query(
      `INSERT INTO oura_ble_clock_anchors (user_id, anchor_ds, anchor_utc, epoch, observed_source)
       VALUES ($1,$2,$3,0,'test')`, [TEST_USER_ID, ANCHOR_DS, anchorUtc])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  it('selects exactly the frames inside the wall-clock window, and excludes the rest', async () => {
    const inside = [ANCHOR_DS - 12 * DS_PER_HOUR, ANCHOR_DS - 47 * DS_PER_HOUR, ANCHOR_DS - 1]
    const outside = [ANCHOR_DS - 72 * DS_PER_HOUR, ANCHOR_DS - 24 * 30 * DS_PER_HOUR]
    await insertHot([...inside, ...outside])

    // A 2-day window: 48 h back. The 47 h frame is in, the 72 h one is not.
    const rows = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [TAG], 2)
    expect(rows.map(r => r.ringTimestampDs).sort((a, b) => a - b))
      .toEqual([...inside].sort((a, b) => a - b))
  })

  // `measured_at` was written at ingest from whatever anchor stood mid-drain, and a packed frame has
  // no such column at all. Deriving from ds is what makes both readable.
  it('reads a frame that exists only in the cold tier', async () => {
    const ds = ANCHOR_DS - 10 * DS_PER_HOUR
    const bucket = Math.floor(ds / DS_BUCKET_SPAN)
    const blob = packFrames([{ ds, body: hexToBody('5d0102030405060708') }])
    await pool.query(
      `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1,0,$2,$3,1,$4,$4,'x',$5)`,
      [TEST_USER_ID, TAG, bucket, ds, Buffer.from(blob)])

    const rows = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [TAG], 2)
    expect(rows.map(r => r.ringTimestampDs)).toEqual([ds])
    // body_hex, not `decoded`: the decoders are infallible by contract and return null for a body
    // they do not recognise, so asserting on the decode would be testing this fixture's hex rather
    // than whether the cold tier was read.
    expect(rows[0].bodyHex).toBe('5d0102030405060708')
    expect(rows[0].eventName).toBe('hrv_event')
  })

  // The old implementation filtered on a NULL-able stored column, so a row whose stamp was never
  // written was invisible. Every row here has measured_at = NULL and every one is still found.
  it('finds frames whose stored measured_at was never written', async () => {
    await insertHot([ANCHOR_DS - 3 * DS_PER_HOUR])
    const rows = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [TAG], 1)
    expect(rows).toHaveLength(1)
    expect(rows[0].measuredAt).not.toBeNull()
  })

  it('derives measuredAt from the anchor, not from the column', async () => {
    const ds = ANCHOR_DS - 6 * DS_PER_HOUR
    await insertHot([ds])
    // Poison the stored column with a value 100 days off. A reader that still trusted it would
    // return that; a reader that derives cannot see it.
    await pool.query(
      `UPDATE oura_raw_samples SET measured_at = now() - interval '100 days' WHERE user_id=$1`,
      [TEST_USER_ID])

    const [row] = await repo.getOuraRawSamplesForTags(TEST_USER_ID, [TAG], 1)
    const expectedMs = anchorUtc.getTime() - 6 * 3600_000
    expect(Math.abs(new Date(row.measuredAt!).getTime() - expectedMs)).toBeLessThan(2_000)
  })

  it('getLatestOuraBleMeasuredAt returns the newest frame time, derived', async () => {
    const newest = ANCHOR_DS - 1 * DS_PER_HOUR
    await insertHot([ANCHOR_DS - 20 * DS_PER_HOUR, newest])
    const at = await repo.getLatestOuraBleMeasuredAt(TEST_USER_ID)
    expect(at).not.toBeNull()
    expect(Math.abs(at!.getTime() - (anchorUtc.getTime() - 3600_000))).toBeLessThan(2_000)
  })

  // Once the backfill runs, the newest frame for a quiet ring lives in a blob. A hot-only
  // max(measured_at) would report the hot window's edge as the ring's last activity — or nothing.
  it('getLatestOuraBleMeasuredAt sees a cold-tier-only history', async () => {
    const ds = ANCHOR_DS - 40 * DS_PER_HOUR
    const bucket = Math.floor(ds / DS_BUCKET_SPAN)
    await pool.query(
      `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1,0,$2,$3,1,$4,$4,'x',$5)`,
      [TEST_USER_ID, TAG, bucket, ds, Buffer.from(packFrames([{ ds, body: hexToBody('5d01') }]))])

    const at = await repo.getLatestOuraBleMeasuredAt(TEST_USER_ID)
    expect(at).not.toBeNull()
    expect(Math.abs(at!.getTime() - (anchorUtc.getTime() - 40 * 3600_000))).toBeLessThan(2_000)
  })

  it('returns null / empty rather than guessing when there is no anchor at all', async () => {
    await pool.query(`DELETE FROM oura_ble_clock_anchors WHERE user_id=$1`, [TEST_USER_ID])
    await insertHot([ANCHOR_DS - DS_PER_HOUR])
    expect(await repo.getOuraRawSamplesForTags(TEST_USER_ID, [TAG], 7)).toEqual([])
    expect(await repo.getLatestOuraBleMeasuredAt(TEST_USER_ID)).toBeNull()
  })

  it('returns null when there are no frames at all', async () => {
    expect(await repo.getLatestOuraBleMeasuredAt(TEST_USER_ID)).toBeNull()
  })
})
