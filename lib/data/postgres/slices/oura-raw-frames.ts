import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import { bodyToHex, unpackFrames } from '@/lib/oura-ble/frame-pack'

type Db = ReturnType<typeof getDb>

/**
 * Q-541 Task 3 — the two-tier raw-frame reader.
 *
 * Raw BLE frames live in two places once the packer runs: `oura_raw_samples` holds the hot window
 * (7 days, the span ingest dedup needs) and `oura_raw_packed` holds one sealed blob per
 * `(user_id, epoch, tag, ds_bucket)` for everything older. **Every frame read must consult both**,
 * and that is exactly what a per-call-site rewrite would get wrong — a read left on the hot table
 * alone silently returns a 7-day history and looks like data loss.
 *
 * So the tiers are joined here, once, and the return shape is deliberately **identical to the
 * `select` it replaces** (`ds`, `tag`, `bodyHex`, and `decoded` where the caller wanted it). A call
 * site changes which function it calls and nothing else, which is what makes the equivalence
 * testable rather than argued.
 */

/** One day of *ring* time. Bucketing on ds rather than a calendar day means a change to the
 *  ds→wall-clock derivation can never invalidate a bucket. */
export const DS_BUCKET_SPAN = 864_000

export function dsBucketOf(ds: number): number {
  return Math.floor(ds / DS_BUCKET_SPAN)
}

export interface RawFrameRow {
  ds: number
  tag: number
  bodyHex: string
  /** The legacy `decoded` JSONB. Always `null` for a packed frame, and `null` for every hot row
   *  written since Lever 1a — callers coalesce to an in-memory decode of `bodyHex`, as they already
   *  did before packing existed. */
  decoded: Record<string, unknown> | null
}

export interface RawFrameQuery {
  /** Omit to read every tag. */
  tags?: readonly number[]
  startDs?: number | null
  endDs?: number | null
}

function inRange(ds: number, startDs: number | null | undefined, endDs: number | null | undefined): boolean {
  if (startDs != null && ds < startDs) return false
  if (endDs != null && ds > endDs) return false
  return true
}

async function readColdFrames(
  db: Db,
  userId: string,
  q: RawFrameQuery,
  /** Newest-bucket-first with a hard cap, for the descending reader. Omitted = every matching
   *  bucket, ascending. */
  newestBuckets?: number,
): Promise<RawFrameRow[]> {
  const conds = [eq(s.ouraRawPacked.userId, userId)]
  if (q.tags) conds.push(inArray(s.ouraRawPacked.tag, [...q.tags]))
  // Bucket bounds, not ds bounds: a bucket that straddles the boundary must be read and then
  // filtered per frame, or the frames on the near side of it are lost.
  if (q.startDs != null) conds.push(gte(s.ouraRawPacked.dsBucket, dsBucketOf(q.startDs)))
  if (q.endDs != null) conds.push(lte(s.ouraRawPacked.dsBucket, dsBucketOf(q.endDs)))

  const base = db
    .select({ tag: s.ouraRawPacked.tag, dsBucket: s.ouraRawPacked.dsBucket, blob: s.ouraRawPacked.blob })
    .from(s.ouraRawPacked)
    .where(and(...conds))
  const blobs = newestBuckets != null
    ? await base.orderBy(desc(s.ouraRawPacked.dsBucket)).limit(newestBuckets)
    : await base.orderBy(asc(s.ouraRawPacked.dsBucket))

  const out: RawFrameRow[] = []
  for (const b of blobs) {
    for (const f of unpackFrames(b.blob)) {
      if (!inRange(f.ds, q.startDs, q.endDs)) continue
      out.push({ ds: f.ds, tag: b.tag, bodyHex: bodyToHex(f.body), decoded: null })
    }
  }
  return out
}

/**
 * Read frames from both tiers, ascending by `ds`.
 *
 * **On the dedupe:** the packer writes a blob, proves it equal, and only then deletes the hot rows
 * (plan §6), so a bucket is legitimately present in both tiers for the width of that window — and
 * stays in both forever if the packer is interrupted between phases. Returning those frames twice
 * would double a day's step count or IBI series, so the overlap has to be removed here.
 *
 * It is removed *only where the tiers actually overlap*: the set of packed `(tag, bucket)` pairs is
 * ~968 entries for all of history, and a hot row outside those buckets is kept without a lookup. A
 * blanket `Set` over every frame's identity would cost ~1.1 M strings on a full-history read, which
 * runs inside the rollup worker and is exactly where memory is not free.
 */
export async function readRawFrames(db: Db, userId: string, q: RawFrameQuery = {}): Promise<RawFrameRow[]> {
  const hotConds = [eq(s.ouraRawSamples.userId, userId)]
  if (q.tags) hotConds.push(inArray(s.ouraRawSamples.tag, [...q.tags]))
  if (q.startDs != null) hotConds.push(gte(s.ouraRawSamples.ringTimestampDs, q.startDs))
  if (q.endDs != null) hotConds.push(lte(s.ouraRawSamples.ringTimestampDs, q.endDs))

  const [cold, hot] = await Promise.all([
    readColdFrames(db, userId, q),
    db
      .select({
        ds: s.ouraRawSamples.ringTimestampDs,
        tag: s.ouraRawSamples.tag,
        bodyHex: s.ouraRawSamples.bodyHex,
        decoded: s.ouraRawSamples.decoded,
      })
      .from(s.ouraRawSamples)
      .where(and(...hotConds))
      .orderBy(asc(s.ouraRawSamples.ringTimestampDs)),
  ])

  if (cold.length === 0) return hot as RawFrameRow[]
  if (hot.length === 0) return cold

  const coldBuckets = new Set<string>()
  for (const c of cold) coldBuckets.add(`${c.tag}:${dsBucketOf(c.ds)}`)
  const hotBuckets = new Set<string>()
  for (const h of hot) hotBuckets.add(`${h.tag}:${dsBucketOf(h.ds)}`)
  const overlapping = new Set([...hotBuckets].filter(k => coldBuckets.has(k)))

  // The identity set covers ONLY the overlapping buckets. Normally that is the empty set and this
  // costs nothing; the alternative — one key per cold frame — is ~1.1 M strings on a full-history
  // read, inside the rollup worker.
  const coldIdentity = new Set<string>()
  if (overlapping.size > 0) {
    for (const c of cold) {
      if (overlapping.has(`${c.tag}:${dsBucketOf(c.ds)}`)) coldIdentity.add(`${c.ds}:${c.tag}:${c.bodyHex}`)
    }
  }

  const merged: RawFrameRow[] = [...cold]
  for (const h of hot as RawFrameRow[]) {
    if (coldIdentity.size > 0 && coldIdentity.has(`${h.ds}:${h.tag}:${h.bodyHex}`)) continue
    merged.push(h)
  }
  merged.sort((a, b) => a.ds - b.ds)
  return merged
}

/**
 * The newest `limit` frames for a set of tags, descending by `ds` — the shape the admin tester's
 * summary and field inspector use.
 *
 * The hot tier is read first and the cold tier is touched **only if it comes up short**, which for a
 * live ring it never does: packing only ever seals buckets older than the hot window, so the newest
 * frames are hot by construction. The fallback exists for a tag that stopped streaming long enough
 * ago that its newest frame is already packed — without it the inspector would show that tag as
 * having no data at all.
 */
export async function readRecentRawFrames(
  db: Db,
  userId: string,
  tags: readonly number[],
  limit: number,
): Promise<RawFrameRow[]> {
  const hot = await db
    .select({
      ds: s.ouraRawSamples.ringTimestampDs,
      tag: s.ouraRawSamples.tag,
      bodyHex: s.ouraRawSamples.bodyHex,
      decoded: s.ouraRawSamples.decoded,
    })
    .from(s.ouraRawSamples)
    .where(and(eq(s.ouraRawSamples.userId, userId), inArray(s.ouraRawSamples.tag, [...tags])))
    .orderBy(desc(s.ouraRawSamples.ringTimestampDs))
    .limit(limit)

  if (hot.length >= limit) return hot as RawFrameRow[]

  const oldestHotDs = hot.length > 0 ? hot[hot.length - 1].ds : null
  // A bucket holds at least one frame, so `limit - hot.length` buckets is a hard upper bound on how
  // many can be needed — and with `limit` in the low hundreds against 968 buckets for all of
  // history, it is what stops this degenerating into a full-history unpack when the hot tier is
  // empty for these tags.
  const cold = await readColdFrames(
    db,
    userId,
    { tags, endDs: oldestHotDs != null ? oldestHotDs - 1 : null },
    limit - hot.length,
  )
  cold.sort((a, b) => b.ds - a.ds)
  return [...(hot as RawFrameRow[]), ...cold].slice(0, limit)
}
