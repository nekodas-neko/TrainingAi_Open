import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'

// A single tuning number (or a short note). The body is optional on all of these.
const MAX_BODY_BYTES = 4 * 1024

// Q-541 Task 4 — admin-triggered frame packing. Moves sealed buckets of raw BLE frames out of
// `oura_raw_samples` and into one blob each in `oura_raw_packed`, deleting a hot row only after
// re-reading its blob and proving the frames equal (plan §6).
//
// GET  reports how much is packable without touching anything.
// POST packs up to `maxBuckets` (default 25, cap 200) and returns per-bucket outcomes.
//
// Never runs on deploy and never on a schedule — same posture as the other culling levers. The
// bound exists because the delete side is 1.1M rows in production: the owner presses again until
// `remaining` reaches 0, watching the DB-footprint readout between presses.
const DEFAULT_MAX_BUCKETS = 25
const MAX_BUCKETS_CAP = 200

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepositoryAsync()
  const result = await repo.countPackableBuckets(session.user.id)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  // This is the only endpoint in the app that deletes archival frames. Keep it deliberate.
  if (!rateLimit(`oura-ble-pack-raw:${session.user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let maxBuckets = DEFAULT_MAX_BUCKETS
  try {
    const read = await readJsonLimited(req, MAX_BODY_BYTES)
    if (!read.ok && read.reason === 'too_large') {
      return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    }
    const body = read.ok ? (read.body as { maxBuckets?: unknown } | null) : null
    if (typeof body?.maxBuckets === 'number' && Number.isFinite(body.maxBuckets)) {
      maxBuckets = Math.min(Math.max(Math.floor(body.maxBuckets), 1), MAX_BUCKETS_CAP)
    }
  } catch {
    // No body is the normal case — the button sends none.
  }

  try {
    const repo = await getRepositoryAsync()
    const result = await repo.packOuraRawBuckets(session.user.id, maxBuckets)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (err) {
    // A refused bucket is already reported in the result, not thrown. Reaching here means the run
    // itself failed, which must surface rather than read as "packed 0" — the caller decides whether
    // to press again, and "nothing to do" and "it broke" are different answers.
    console.error('[oura-ble] pack failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'pack failed' },
      { status: 500 },
    )
  }
}
