import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// GET /api/oura-ble/rollup-state — the BLE rollup's persisted watermark (Q-91-followup).
//
// **Why this exists.** The ingest route stores raw rows and schedules a debounced rollup that runs
// off-loop; nothing tells the client when that rollup has actually written `sleep_sessions` /
// `body_metrics`. A client that has just watched a drain finish (the native `ouraStatus` event's
// `draining` flag) knows the rows are ingested but NOT that they are derived — invalidating on
// drain-end alone races the rollup and can refetch pre-rollup data and cache it, which is worse
// than the staleness it replaces. This endpoint is how the client waits for the derivation instead
// of guessing at its duration.
//
// A single-row read, deliberately not admin-gated: a rollup cursor is not user data. Rate-limited
// like its polled siblings (`battery-poll`, `live-steps`) because it IS polled — a bug in the
// caller's backoff would otherwise be free to hammer it.
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`oura-ble-rollup-state:${userId}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const state = await repo.getOuraRollupState(userId)

  // Null before the first successful rollup — a real state, not an error. The client treats an
  // absent baseline as "anything counts as progress".
  return NextResponse.json(
    { lastRolledDs: state?.lastRolledDs ?? null, epoch: state?.epoch ?? null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
