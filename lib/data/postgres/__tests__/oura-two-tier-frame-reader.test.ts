import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { packFrames, hexToBody } from '@/lib/oura-ble/frame-pack'
import { readRawFrames, readRecentRawFrames, DS_BUCKET_SPAN } from '@/lib/data/postgres/slices/oura-raw-frames'

// Q-541 Task 3. The reader's whole job is that a frame is returned regardless of which tier it
// lives in, so every test here writes the SAME frames into different tiers and asserts the result
// does not move. The failure this guards is silent and looks exactly like data loss: a read left on
// the hot table alone returns a 7-day history and no error.
//
// Runs only against a real local dev Postgres — skips in CI.
const canRun = !!process.env.DATABASE_URL
const TEST_USER_ID = '00000000-0000-4000-8000-000000054101'
const TAG = 0x76
const OTHER_TAG = 0x50

// Two buckets of ring time, so "cold" and "hot" can be genuinely disjoint spans.
const OLD_BUCKET = 40
const NEW_BUCKET = 41
const oldFrames = [
  { ds: OLD_BUCKET * DS_BUCKET_SPAN + 10, hex: 'd47e16008fac1600' },
  { ds: OLD_BUCKET * DS_BUCKET_SPAN + 20, hex: 'e9161d009e662100' },
  { ds: OLD_BUCKET * DS_BUCKET_SPAN + 30, hex: 'f38b2800b0ac2800' },
]
const newFrames = [
  { ds: NEW_BUCKET * DS_BUCKET_SPAN + 5, hex: 'acf72800053e2900' },
  { ds: NEW_BUCKET * DS_BUCKET_SPAN + 15, hex: '31ce2900207e2e00' },
]

describe.skipIf(!canRun)('two-tier raw-frame reader', () => {
  let pool: import('pg').Pool
  let db: ReturnType<typeof import('@/lib/data/postgres/client').getDb>

  const insertHot = async (frames: { ds: number; hex: string }[], tag = TAG) => {
    for (const f of frames) {
      await pool.query(
        `INSERT INTO oura_raw_samples (user_id, ring_timestamp_ds, tag, event_name, body_hex, epoch)
         VALUES ($1, $2, $3, 'test', $4, 0) ON CONFLICT DO NOTHING`,
        [TEST_USER_ID, f.ds, tag, f.hex],
      )
    }
  }

  const insertCold = async (frames: { ds: number; hex: string }[], tag = TAG) => {
    const bucket = Math.floor(frames[0].ds / DS_BUCKET_SPAN)
    const blob = packFrames(frames.map(f => ({ ds: f.ds, body: hexToBody(f.hex) })))
    await pool.query(
      `INSERT INTO oura_raw_packed
         (user_id, epoch, tag, ds_bucket, frame_count, min_ds, max_ds, body_sha256, blob)
       VALUES ($1, 0, $2, $3, $4, $5, $6, 'sha-not-checked-here', $7)`,
      [TEST_USER_ID, tag, bucket, frames.length, frames[0].ds, frames[frames.length - 1].ds, Buffer.from(blob)],
    )
  }

  const idsOf = (rows: { ds: number; bodyHex: string }[]) => rows.map(r => `${r.ds}:${r.bodyHex}`)
  /** Fixtures carry `hex`; reader rows carry `bodyHex`. Same identity, two field names. */
  const expectIds = (frames: { ds: number; hex: string }[]) => frames.map(f => `${f.ds}:${f.hex}`)

  beforeAll(async () => {
    const client = await import('@/lib/data/postgres/client')
    pool = client.getPool()
    db = client.getDb()
    await pool.query(
      `INSERT INTO users (id, email, password_hash, timezone)
       VALUES ($1, $2, 'x', 'Australia/Brisbane') ON CONFLICT (id) DO NOTHING`,
      [TEST_USER_ID, `two-tier-${TEST_USER_ID}@example.com`],
    )
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await pool.query(`DELETE FROM users WHERE id = $1`, [TEST_USER_ID])
  })

  it('returns the same frames whether they are hot, cold, or split across both', async () => {
    const expected = expectIds([...oldFrames, ...newFrames])

    await insertHot([...oldFrames, ...newFrames])
    const allHot = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(idsOf(allHot)).toEqual(expected)

    await pool.query(`DELETE FROM oura_raw_samples WHERE user_id = $1`, [TEST_USER_ID])
    await insertCold(oldFrames)
    await insertCold(newFrames)
    const allCold = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(idsOf(allCold)).toEqual(expected)

    await pool.query(`DELETE FROM oura_raw_packed WHERE user_id = $1 AND ds_bucket = $2`, [TEST_USER_ID, NEW_BUCKET])
    await insertHot(newFrames)
    const split = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(idsOf(split)).toEqual(expected)
  })

  // The packer writes the blob, verifies it, and only then deletes the hot rows — so a bucket is
  // legitimately in both tiers for that window, and stays there forever if the packer is
  // interrupted between the two. Returning those frames twice would double a day's step count.
  it('does not double-count a bucket present in both tiers', async () => {
    await insertHot(oldFrames)
    await insertCold(oldFrames)
    const rows = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(idsOf(rows)).toEqual(expectIds(oldFrames))
  })

  // Dedup is on the ingest unique key `(ds, tag, body_hex)`, not on ds — two frames may genuinely
  // share a ds with different bodies, and collapsing those would lose data rather than duplicate it.
  it('keeps two same-ds frames that differ in body', async () => {
    const twin = { ds: oldFrames[0].ds, hex: 'ffffffffffffffff' }
    await insertCold(oldFrames)
    await insertHot([twin])
    const rows = await readRawFrames(db, TEST_USER_ID, { tags: [TAG] })
    expect(idsOf(rows).sort()).toEqual(expectIds([...oldFrames, twin]).sort())
  })

  it('filters a ds range per frame, not per bucket', async () => {
    await insertCold(oldFrames)
    const rows = await readRawFrames(db, TEST_USER_ID, {
      tags: [TAG],
      startDs: oldFrames[1].ds,
      endDs: oldFrames[1].ds,
    })
    expect(idsOf(rows)).toEqual(expectIds([oldFrames[1]]))
  })

  it('filters by tag across both tiers', async () => {
    await insertCold(oldFrames)
    await insertCold(newFrames, OTHER_TAG)
    await insertHot(newFrames, OTHER_TAG)
    expect(idsOf(await readRawFrames(db, TEST_USER_ID, { tags: [TAG] }))).toEqual(expectIds(oldFrames))
    expect(idsOf(await readRawFrames(db, TEST_USER_ID, { tags: [OTHER_TAG] }))).toEqual(expectIds(newFrames))
    expect(await readRawFrames(db, TEST_USER_ID, { tags: [] })).toEqual([])
  })

  it('reads every tag when none is given', async () => {
    await insertCold(oldFrames)
    await insertHot(newFrames, OTHER_TAG)
    const rows = await readRawFrames(db, TEST_USER_ID, {})
    expect(idsOf(rows)).toEqual(expectIds([...oldFrames, ...newFrames]))
  })

  // A tag that stopped streaming before the hot window opened has no hot row at all. Without the
  // cold fallback the admin field inspector shows it as having never produced data.
  it('finds the newest frame of a tag that exists only in the cold tier', async () => {
    await insertCold(oldFrames)
    const rows = await readRecentRawFrames(db, TEST_USER_ID, [TAG], 2)
    expect(idsOf(rows)).toEqual(expectIds([oldFrames[2], oldFrames[1]]))
  })

  it('prefers hot rows and tops up from cold, newest first', async () => {
    await insertCold(oldFrames)
    await insertHot(newFrames)
    const rows = await readRecentRawFrames(db, TEST_USER_ID, [TAG], 4)
    expect(idsOf(rows)).toEqual(expectIds([newFrames[1], newFrames[0], oldFrames[2], oldFrames[1]]))
  })

  it('does not touch the cold tier when the hot tier already fills the limit', async () => {
    await insertCold(oldFrames)
    await insertHot(newFrames)
    const rows = await readRecentRawFrames(db, TEST_USER_ID, [TAG], 2)
    expect(idsOf(rows)).toEqual(expectIds([newFrames[1], newFrames[0]]))
  })

  // Found on the dev server, not in review: the summary's per-tag counts summed the two tiers
  // directly, so a bucket sitting in both — the packer's own mid-write state, and its permanent
  // state if it is interrupted — read 120 frames where there were 80. The reader's identity dedupe
  // cannot help an aggregate, so the count anti-joins on the bucket instead.
  it('counts a bucket once when it is present in both tiers', async () => {
    const { getRepository } = await import('@/lib/data')
    const repo = await getRepository()

    await insertHot([...oldFrames, ...newFrames])
    const before = await repo.getOuraRawSampleSummary(TEST_USER_ID)
    const countFor = (sum: Awaited<ReturnType<typeof repo.getOuraRawSampleSummary>>) =>
      sum.byEventName.find(b => b.tag === TAG)?.count ?? 0
    expect(countFor(before)).toBe(oldFrames.length + newFrames.length)

    // Mid-pack: the blob is written, the hot rows are not yet deleted.
    await insertCold(oldFrames)
    expect(countFor(await repo.getOuraRawSampleSummary(TEST_USER_ID))).toBe(countFor(before))

    // Post-pack: the hot rows are gone and the same frames are read from the blob.
    await pool.query(
      `DELETE FROM oura_raw_samples WHERE user_id = $1 AND ring_timestamp_ds / $2 = $3`,
      [TEST_USER_ID, DS_BUCKET_SPAN, OLD_BUCKET],
    )
    expect(countFor(await repo.getOuraRawSampleSummary(TEST_USER_ID))).toBe(countFor(before))
  })
})
