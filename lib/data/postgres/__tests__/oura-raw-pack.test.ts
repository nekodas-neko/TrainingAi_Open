import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { bodyToHex, hexToBody, packFrames, unpackFrames } from '@/lib/oura-ble/frame-pack'
import { DS_BUCKET_SPAN, readRawFrames } from '@/lib/data/postgres/slices/oura-raw-frames'
import {
  HOT_WINDOW_DS, frameSequenceSha256, packOuraRawBuckets, countPackableBuckets, verifyStoredBucket,
} from '@/lib/data/postgres/slices/oura-raw-pack'

// Q-541 Task 4. The packer holds the only DELETE of an archival frame in this project, so what these
// tests are actually about is the refusals: every case where the blob is not provably equal must
// leave the hot rows exactly where they are. A test that only proves the happy path would pass
// against a packer that deletes unconditionally.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054102'
const TAG = 0x76

// Bucket 200 is cold (well below the hot window); the newest frame sits far above it.
const COLD_BUCKET = 200
const NEWEST_DS = COLD_BUCKET * DS_BUCKET_SPAN + HOT_WINDOW_DS + 5 * DS_BUCKET_SPAN
const coldFrames = Array.from({ length: 12 }, (_, i) => ({
  ds: COLD_BUCKET * DS_BUCKET_SPAN + i * 700,
  hex: `76${i.toString(16).padStart(2, '0')}00ff0011${i.toString(16).padStart(2, '0')}22`,
}))

describe.skipIf(!canRun)('the raw-frame packer', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>

  const insertHot = async (frames: { ds: number; hex: string }[], recordedAt = "now() - interval '30 days'") => {
    for (const f of frames) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch, recorded_at)
         VALUES ($1, $2, $3, 'test', $4, 0, ${recordedAt}) ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, f.ds, TAG, f.hex],
      )
    }
  }
  /** One frame far in the future, so the cold bucket is genuinely outside the hot window. */
  const insertNewest = () => insertHot([{ ds: NEWEST_DS, hex: 'aabbccdd' }], 'now()')

  const hotCount = async () => Number((await pool.query(
    `SELECT count(*)::int n FROM oura_raw_samples WHERE user_id=$1 AND ring_timestamp_ds / $2 = $3`,
    [TEST_USER_ID, DS_BUCKET_SPAN, COLD_BUCKET])).rows[0].n)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool(); db = client.getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `packer-${TEST_USER_ID}@example.com`],
    )
  })
  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id=$1`, [TEST_USER_ID])
  })
  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id=$1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id=$1`, [TEST_USER_ID])
  })

  it('packs a sealed bucket and the frames read back identically', async () => {
    await insertHot(coldFrames)
    await insertNewest()
    const before = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })

    const res = await packOuraRawBuckets(db, TEST_USER_ID)
    expect(res.refused).toBe(0)
    expect(res.packed).toBe(1)
    expect(res.framesMoved).toBe(coldFrames.length)
    expect(res.remaining).toBe(0)

    expect(await hotCount()).toBe(0)                       // the hot rows are gone…
    const after = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(after).toEqual(before)                          // …and nothing downstream can tell

    // The blob is genuinely smaller than the rows it replaced (12 frames × ~328 B/row).
    const [row] = (await pool.query(
      `SELECT frame_count, min_ds, max_ds, octet_length(blob) AS bytes FROM oura_raw_packed WHERE user_id=$1`,
      [TEST_USER_ID])).rows
    expect(row.frame_count).toBe(coldFrames.length)
    expect(Number(row.min_ds)).toBe(coldFrames[0].ds)
    expect(Number(row.max_ds)).toBe(coldFrames[coldFrames.length - 1].ds)
    expect(Number(row.bytes)).toBeLessThan(coldFrames.length * 328 / 4)
  })

  it('never packs a bucket inside the hot window', async () => {
    // Only recent frames: the newest IS the bucket, so nothing can be sealed.
    await insertHot([{ ds: NEWEST_DS, hex: 'aabbccdd' }], 'now()')
    const res = await packOuraRawBuckets(db, TEST_USER_ID)
    expect(res.packed).toBe(0)
    expect(res.remaining).toBe(0)
    expect((await countPackableBuckets(db, TEST_USER_ID)).buckets).toBe(0)
  })

  // The ds guard alone is not enough: ring_timestamp_ds says when the ring RECORDED a frame, not
  // when we received it, and a re-drain delivers week-old ds values today.
  it('never packs a bucket that was written to recently, however old its ds', async () => {
    await insertHot(coldFrames, 'now()')
    await insertNewest()
    const res = await packOuraRawBuckets(db, TEST_USER_ID)
    expect(res.packed).toBe(0)
    expect(await hotCount()).toBe(coldFrames.length)
  })

  // The heart of the safety contract: a blob that does not describe the source rows must never
  // license the delete.
  it('refuses to delete when the stored blob has been corrupted', async () => {
    await insertHot(coldFrames)
    await insertNewest()

    // Pre-write a blob for this bucket that holds DIFFERENT frames. The packer's insert is
    // ON CONFLICT DO NOTHING, so this is what the verify step will read back.
    const wrong = packFrames(coldFrames.slice(0, 12).map((f, i) => ({ ds: f.ds, body: hexToBody(i === 3 ? 'deadbeef' : f.hex) })))
    await pool.query(
      `INSERT INTO oura_raw_packed (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1, 0, $2, $3, $4, $5, $6, $7, $8)`,
      [TEST_USER_ID, TAG, COLD_BUCKET, coldFrames.length, coldFrames[0].ds,
       coldFrames[coldFrames.length - 1].ds, 'a-hash-that-does-not-describe-it', Buffer.from(wrong)],
    )

    const res = await packOuraRawBuckets(db, TEST_USER_ID)
    expect(res.packed).toBe(0)
    expect(res.refused).toBe(1)
    expect(res.buckets[0].refused).toMatch(/sha256|differ/)
    expect(await hotCount()).toBe(coldFrames.length)      // every frame still there
  })

  it('is idempotent — a second run finds nothing left and deletes nothing more', async () => {
    await insertHot(coldFrames)
    await insertNewest()
    await packOuraRawBuckets(db, TEST_USER_ID)
    const second = await packOuraRawBuckets(db, TEST_USER_ID)
    expect(second.packed).toBe(0)
    expect(second.framesMoved).toBe(0)
    const [{ n }] = (await pool.query(`SELECT count(*)::int n FROM oura_raw_packed WHERE user_id=$1`, [TEST_USER_ID])).rows
    expect(n).toBe(1)
  })

  it('is bounded per call and reports what is left', async () => {
    const twoBuckets = [
      ...coldFrames,
      ...coldFrames.map(f => ({ ds: f.ds + DS_BUCKET_SPAN, hex: f.hex })),
    ]
    await insertHot(twoBuckets)
    await insertNewest()
    const first = await packOuraRawBuckets(db, TEST_USER_ID, 1)
    expect(first.packed).toBe(1)
    expect(first.remaining).toBe(1)
    const second = await packOuraRawBuckets(db, TEST_USER_ID, 1)
    expect(second.packed).toBe(1)
    expect(second.remaining).toBe(0)
  })

  it('scopes the delete to one user', async () => {
    const OTHER = '00000000-0000-4000-8000-000000054103'
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [OTHER, `packer-other-${OTHER}@example.com`])
    try {
      for (const f of coldFrames) {
        await pool.query(
          `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch, recorded_at)
           VALUES ($1,$2,$3,'test',$4,0, now() - interval '30 days') ON CONFLICT DO NOTHING`,
          [OTHER, f.ds, TAG, f.hex])
      }
      await insertHot(coldFrames)
      await insertNewest()
      await packOuraRawBuckets(db, TEST_USER_ID)
      const [{ n }] = (await pool.query(
        `SELECT count(*)::int n FROM oura_raw_samples WHERE user_id=$1`, [OTHER])).rows
      expect(n).toBe(coldFrames.length)
    } finally {
      await pool.query(`DELETE FROM oura_raw_samples WHERE user_id=$1`, [OTHER])
      await pool.query(`DELETE FROM oura_raw_packed WHERE user_id=$1`, [OTHER])
      await pool.query(`DELETE FROM users WHERE id=$1`, [OTHER])
    }
  })
})

// No database needed — this is the equality argument on its own, and every branch of it is a
// refusal, so it is worth exercising exhaustively rather than through the packer.
describe('verifyStoredBucket', () => {
  const source = [
    { ds: 10, body: hexToBody('aabb') },
    { ds: 20, body: hexToBody('ccdd') },
  ]
  const good = () => ({
    blob: packFrames(source),
    frameCount: source.length,
    bodySha256: frameSequenceSha256(source),
  })

  it('accepts a blob that provably holds the source frames', () => {
    expect(verifyStoredBucket(good(), source)).toBeNull()
  })

  it('refuses when the row is missing entirely', () => {
    expect(verifyStoredBucket(undefined, source)).toMatch(/missing/)
  })

  it('refuses on a frame_count that disagrees with the source', () => {
    expect(verifyStoredBucket({ ...good(), frameCount: 3 }, source)).toMatch(/frame_count/)
  })

  it('refuses a blob that will not unpack', () => {
    expect(verifyStoredBucket({ ...good(), blob: Uint8Array.from([0x01, 0x02]) }, source))
      .toMatch(/will not unpack|frames, expected/)
  })

  it('refuses when the stored hash does not describe the stored blob', () => {
    expect(verifyStoredBucket({ ...good(), bodySha256: 'f'.repeat(64) }, source))
      .toMatch(/does not describe/)
  })

  // The case the hash exists for: a blob that is internally consistent — it unpacks, its count is
  // right, and its stored hash matches its own contents — but holds different frames from the rows
  // that were read. Hashing the blob instead of the frame sequence would pass this.
  it('refuses a self-consistent blob that holds different frames', () => {
    const other = [{ ds: 10, body: hexToBody('aabb') }, { ds: 20, body: hexToBody('9999') }]
    const stored = { blob: packFrames(other), frameCount: other.length, bodySha256: frameSequenceSha256(other) }
    expect(verifyStoredBucket(stored, source)).toMatch(/differ/)
    expect(unpackFrames(stored.blob).map(f => bodyToHex(f.body))).toEqual(['aabb', '9999'])
  })
})
