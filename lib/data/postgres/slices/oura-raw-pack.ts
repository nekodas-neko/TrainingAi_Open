import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import { bodyToHex, hexToBody, packFrames, unpackFrames, type RawFrame } from '@/lib/oura-ble/frame-pack'
import { DS_BUCKET_SPAN } from './oura-raw-frames'

type Db = ReturnType<typeof getDb>

/**
 * Q-541 Task 4 — the packer.
 *
 * Moves a sealed bucket of raw BLE frames out of `oura_raw_samples` and into one blob in
 * `oura_raw_packed`. It is the only code in this project that deletes an archival frame, and
 * `CLAUDE.md` makes the server-side `body_hex` the source of truth, so the delete is gated on a
 * re-read of what was actually committed — never on what was intended.
 *
 * Three phases per bucket, deliberately NOT in one transaction (plan §6):
 *
 *   1. **Seal**   — the bucket is entirely older than the hot window and nothing wrote to it
 *                   recently. Never pack a bucket the ring might still deliver into.
 *   2. **Verify** — insert the blob, then read it BACK OUT OF THE DATABASE, unpack it, and prove the
 *                   frames equal. A mismatch leaves the blob, deletes nothing, and stops.
 *   3. **Delete** — only then, scoped to `(user_id, epoch, tag, ds_bucket)`.
 *
 * Bounded per call, idempotent and resumable, admin-triggered. Never automatic on deploy — same
 * posture as the other culling levers.
 */

/** 7 days of ring time. Long enough to cover any re-drain (ops-doc §2: hourly drains, plus a Full
 *  re-sync of the ring's finite buffer), and nothing else needs it — the readers span both tiers. */
export const HOT_WINDOW_DS = 7 * 86_400 * 10

/**
 * A bucket is not sealed until it has also been quiet in *wall-clock* terms.
 *
 * The ds guard alone is not enough: `ring_timestamp_ds` says when the ring recorded a frame, not
 * when we received it, and a re-drain delivers week-old ds values today. Without this, a bucket
 * being actively re-drained would look eligible on its ds and get packed mid-delivery.
 */
const QUIET_INTERVAL = '1 day'

export interface PackedBucketResult {
  epoch: number
  tag: number
  dsBucket: number
  frames: number
  bytes: number
  /** Set only when the bucket was NOT deleted, naming why. Never thrown — one bad bucket must not
   *  stop the run, same reasoning as the outbox's poison-pill rule. */
  refused?: string
}

export interface PackRunResult {
  buckets: PackedBucketResult[]
  packed: number
  refused: number
  framesMoved: number
  bytesWritten: number
  /** Buckets still eligible after this call — the caller presses again until it reaches 0. */
  remaining: number
  ms: number
}

/**
 * The independent integrity hash.
 *
 * Deliberately NOT a hash of the blob: hashing the blob on the way in and re-hashing the same blob
 * on the way out proves only that Postgres stored the bytes, which the re-read already proves. This
 * hashes the *frame sequence* instead — the thing the archive is actually about — so it is computed
 * from the source rows going in and recomputed from the UNPACKED frames coming out, and a codec bug
 * that round-trips a blob but mangles a frame cannot pass both.
 */
export function frameSequenceSha256(frames: readonly RawFrame[]): string {
  const h = createHash('sha256')
  for (const f of [...frames].sort((a, b) => a.ds - b.ds)) {
    h.update(`${f.ds}:${bodyToHex(f.body)}\n`)
  }
  return h.digest('hex')
}

/** The eligibility predicate, shared by the count and the selection so they cannot disagree. */
function eligibleBucketsQuery(userId: string, sealBelowDs: number) {
  return sql`
    SELECT epoch,
           tag,
           (ring_timestamp_ds / ${DS_BUCKET_SPAN})::bigint AS ds_bucket,
           count(*)::int                                   AS frame_count,
           max(ring_timestamp_ds)::bigint                  AS max_ds
      FROM oura_raw_samples
     WHERE user_id = ${userId}
     GROUP BY 1, 2, 3
    HAVING max(ring_timestamp_ds) < ${sealBelowDs}
       AND max(recorded_at) < now() - interval '${sql.raw(QUIET_INTERVAL)}'
  `
}

/**
 * Pack up to `maxBuckets` sealed buckets for one user.
 *
 * Returns per-bucket outcomes rather than throwing: a bucket that fails verification is a finding to
 * surface, not a reason to abandon the ones behind it — and the failure mode that matters (deleting
 * frames that were not stored) is prevented by the verify, not by aborting the run.
 */
export async function packOuraRawBuckets(
  db: Db,
  userId: string,
  maxBuckets = 25,
): Promise<PackRunResult> {
  const startedAt = Date.now()

  // Anchor the hot window to the newest frame we hold, NOT to `now()`. A ring that has not synced
  // for a month must not become fully packable just because time passed — phase 1's whole point is
  // that a bucket the ring may still deliver into stays hot.
  const [newest] = await db
    .select({ maxDs: sql<number | null>`max(${s.ouraRawSamples.ringTimestampDs})::bigint` })
    .from(s.ouraRawSamples)
    .where(eq(s.ouraRawSamples.userId, userId))
  const newestDs = newest?.maxDs != null ? Number(newest.maxDs) : null
  if (newestDs == null) {
    return { buckets: [], packed: 0, refused: 0, framesMoved: 0, bytesWritten: 0, remaining: 0, ms: Date.now() - startedAt }
  }
  const sealBelowDs = newestDs - HOT_WINDOW_DS

  const eligible = (await db.execute(eligibleBucketsQuery(userId, sealBelowDs))).rows as {
    epoch: number; tag: number; ds_bucket: string | number; frame_count: number
  }[]
  const batch = eligible.slice(0, maxBuckets)

  const results: PackedBucketResult[] = []
  let framesMoved = 0
  let bytesWritten = 0

  for (const b of batch) {
    const dsBucket = Number(b.ds_bucket)
    const lo = dsBucket * DS_BUCKET_SPAN
    const hi = lo + DS_BUCKET_SPAN - 1
    const scope = and(
      eq(s.ouraRawSamples.userId, userId),
      eq(s.ouraRawSamples.epoch, b.epoch),
      eq(s.ouraRawSamples.tag, b.tag),
      sql`${s.ouraRawSamples.ringTimestampDs} BETWEEN ${lo} AND ${hi}`,
    )

    const rows = await db
      .select({ id: s.ouraRawSamples.id, ds: s.ouraRawSamples.ringTimestampDs, bodyHex: s.ouraRawSamples.bodyHex })
      .from(s.ouraRawSamples)
      .where(scope)
      .orderBy(asc(s.ouraRawSamples.ringTimestampDs))

    if (rows.length === 0) continue // raced with a delete; nothing to do

    let source: RawFrame[]
    try {
      source = rows.map(r => ({ ds: Number(r.ds), body: hexToBody(r.bodyHex) }))
    } catch (err) {
      // A `body_hex` that will not parse is a corrupt archival row. Refuse loudly and leave it
      // exactly where it is — packing it would launder the corruption into the cold tier.
      results.push({ epoch: b.epoch, tag: b.tag, dsBucket, frames: rows.length, bytes: 0, refused: `unparseable body_hex: ${err instanceof Error ? err.message : String(err)}` })
      continue
    }

    const blob = packFrames(source)
    const sha = frameSequenceSha256(source)

    // DO NOTHING, never DO UPDATE: an existing blob is either already verified (in which case the
    // re-read below will confirm it and the hot rows can go) or the residue of a failed verify (in
    // which case it must be re-examined, not silently overwritten).
    await db
      .insert(s.ouraRawPacked)
      .values({
        userId,
        epoch: b.epoch,
        tag: b.tag,
        dsBucket,
        frameCount: source.length,
        minDs: source[0].ds,
        maxDs: source[source.length - 1].ds,
        bodySha256: sha,
        blob,
      })
      .onConflictDoNothing()

    // Phase 2 — read back what is COMMITTED, not what was sent.
    const [stored] = await db
      .select({ blob: s.ouraRawPacked.blob, frameCount: s.ouraRawPacked.frameCount, bodySha256: s.ouraRawPacked.bodySha256 })
      .from(s.ouraRawPacked)
      .where(and(
        eq(s.ouraRawPacked.userId, userId),
        eq(s.ouraRawPacked.epoch, b.epoch),
        eq(s.ouraRawPacked.tag, b.tag),
        eq(s.ouraRawPacked.dsBucket, dsBucket),
      ))

    const refusal = verifyStoredBucket(stored, source)
    if (refusal) {
      results.push({ epoch: b.epoch, tag: b.tag, dsBucket, frames: source.length, bytes: 0, refused: refusal })
      continue
    }

    // Phase 3 — the only destructive statement in this plan, scoped to the rows that were actually
    // read and verified rather than to the bucket range.
    //
    // Task 6 is what makes the difference matter. The bucket-range delete would also remove a frame
    // that arrived *between* the select above and this statement — a frame that is therefore in
    // neither tier. The quiet guard makes that narrow, but firing the packer from the ingest path is
    // precisely arranging for it to run while frames are arriving, so narrow is not the same as
    // impossible. Deleting by primary key makes the set provably a subset of what the verify proved.
    await db.delete(s.ouraRawSamples).where(and(
      eq(s.ouraRawSamples.userId, userId),
      inArray(s.ouraRawSamples.id, rows.map(r => r.id)),
    ))

    results.push({ epoch: b.epoch, tag: b.tag, dsBucket, frames: source.length, bytes: blob.length })
    framesMoved += source.length
    bytesWritten += blob.length
  }

  const remainingRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (${eligibleBucketsQuery(userId, sealBelowDs)}) q
  `)).rows as { n: number }[]

  return {
    buckets: results,
    packed: results.filter(r => !r.refused).length,
    refused: results.filter(r => r.refused).length,
    framesMoved,
    bytesWritten,
    remaining: remainingRows[0]?.n ?? 0,
    ms: Date.now() - startedAt,
  }
}

/**
 * Exported so the equality argument can be tested without a database.
 *
 * Returns `null` when the stored blob provably holds the same frames, or a reason string. Every
 * branch is a refusal to delete — there is no path that returns `null` on doubt.
 */
export function verifyStoredBucket(
  stored: { blob: Uint8Array; frameCount: number; bodySha256: string } | undefined,
  source: readonly RawFrame[],
): string | null {
  if (!stored) return 'blob missing after insert'
  if (stored.frameCount !== source.length) {
    return `frame_count ${stored.frameCount} != ${source.length} source rows`
  }

  let unpacked: RawFrame[]
  try {
    unpacked = unpackFrames(stored.blob)
  } catch (err) {
    return `stored blob will not unpack: ${err instanceof Error ? err.message : String(err)}`
  }

  if (unpacked.length !== source.length) {
    return `blob holds ${unpacked.length} frames, expected ${source.length}`
  }

  // The hash covers the frame sequence, so this catches a blob that round-trips its own bytes while
  // holding different frames from the ones that were read.
  const storedSha = frameSequenceSha256(unpacked)
  if (storedSha !== stored.bodySha256) return `stored body_sha256 does not describe the stored blob`
  if (storedSha !== frameSequenceSha256(source)) return `stored frames differ from the source rows`

  // Belt and braces: the hash is only as good as its input serialisation, so compare the frames
  // themselves too. Sorted on both sides because a multiset equality is what is actually claimed.
  const a = [...source].sort((x, y) => x.ds - y.ds).map(f => `${f.ds}:${bodyToHex(f.body)}`)
  const c = unpacked.map(f => `${f.ds}:${bodyToHex(f.body)}`)
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== c[i]) return `frame ${i} differs: stored ${c[i]}, source ${a[i]}`
  }
  return null
}

/**
 * Q-541 Task 6 — the automatic run.
 *
 * Task 4 shipped the packer admin-triggered and deliberately never automatic, because it holds the
 * only DELETE of an archival frame. Task 5 then ran it over all history in production and verified
 * clean: **764 blobs hold 941,233 frames in 13 MB**, contiguous with the hot tier's oldest ds, and
 * nothing downstream noticed. That is the evidence the plan's ordering asked for, so the button
 * becomes a schedule.
 *
 * It has to, because a manual packer does not hold a growth curve. `oura_raw_samples` was pruned to
 * 2026-08-10 by that run and had regrown to **318,183 rows / 92 MB** five days later — ~6.5 MB/day
 * against the ~0.4 MB/day the whole database is supposed to grow at. The packing is not what was
 * missing; pressing the button was.
 *
 * There is no cron layer in this app (module-map §0), so this rides the ingest path like every other
 * retention job — with two differences that follow from what it deletes:
 *
 *   - **Per user, not per process.** The other throttles are one module-level timestamp, which with
 *     two ringed users lets the busier one starve the other indefinitely. The cost of keying it is a
 *     `Map` sized by real users.
 *   - **Claim, don't check.** This both tests and sets, so two ingest batches arriving together in
 *     one process cannot both start a run. It does not coordinate across replicas — it does not need
 *     to, because concurrent runs are safe by construction (the insert is `DO NOTHING`, the verify
 *     re-reads what is committed, and the delete names row ids) — it just avoids the wasted work.
 *
 * `OURA_AUTOPACK=off` stops it without a code deploy. Nothing else in the pipeline depends on it
 * running: the readers span both tiers, so the only consequence of it being off is the growth curve.
 */
export const AUTOPACK_THROTTLE_MS = 6 * 60 * 60 * 1000
/** Bounded, because this runs behind a device request. At 22.5 buckets/day a 6-hourly run of 8 keeps
 *  up with roughly 2.8× the production rate, so it converges rather than falling behind. */
export const AUTOPACK_MAX_BUCKETS = 8

const lastAutoPack = new Map<string, number>()

/** Exported for the tests; resets the per-user throttle so a case can fire a run of its own. */
export function resetAutoPackThrottle(): void {
  lastAutoPack.clear()
}

export function claimAutoPackSlot(
  userId: string,
  nowMs: number,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.OURA_AUTOPACK === 'off') return false
  // A user this process has not seen claims immediately — `?? 0` would instead compare against the
  // epoch, which is only indistinguishable from "claim" because `Date.now()` is large. It would make
  // the first claim after a restart depend on the clock rather than on the user.
  const last = lastAutoPack.get(userId)
  if (last !== undefined && nowMs - last < AUTOPACK_THROTTLE_MS) return false
  lastAutoPack.set(userId, nowMs)
  return true
}

/** How much is left to pack, without packing anything — for the admin readout. */
export async function countPackableBuckets(db: Db, userId: string): Promise<{ buckets: number; sealBelowDs: number | null }> {
  const [newest] = await db
    .select({ maxDs: sql<number | null>`max(${s.ouraRawSamples.ringTimestampDs})::bigint` })
    .from(s.ouraRawSamples)
    .where(eq(s.ouraRawSamples.userId, userId))
  const newestDs = newest?.maxDs != null ? Number(newest.maxDs) : null
  if (newestDs == null) return { buckets: 0, sealBelowDs: null }
  const sealBelowDs = newestDs - HOT_WINDOW_DS
  const rows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM (${eligibleBucketsQuery(userId, sealBelowDs)}) q
  `)).rows as { n: number }[]
  return { buckets: rows[0]?.n ?? 0, sealBelowDs }
}
