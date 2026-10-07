import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/auth'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'

// GET /api/oura-ble/rollup-watermark — how far the SERVER's BLE rollup has folded, in wall-clock ms
// (#2579, the interim split from #2248).
//
// **Why this exists.** The device's raw store (`oura_raw.db`) grows without a bound because its
// prune deletes only rows marked `rolled_up`, and nothing on the device marks them: the on-device
// rollup that was meant to (device-primary plan, Task 3) is not built. Until it is, the server is
// the only thing folding raw frames, and it keeps every one of them in its never-pruned archive. So
// the device marks a row `rolled_up` — meaning **"folded on the server"**, not "folded here" — when
// it is older than this watermark by a safety margin (`lib/oura-ble/raw-rolled-up-from-server.ts`).
//
// The value is `repo.getSleepCoverageEnd`: the rollup watermark (`oura_rollup_state`) resolved to
// wall-clock through the clock offsets. Wall-clock, not ring deciseconds, because the device's raw
// rows carry no epoch and their `ds` is not comparable across a ring re-key; `measured_at` is.
// Null when no rollup has completed, or when the stored watermark belongs to an earlier clock epoch
// — both mean "nothing is known to be folded", and the device then marks nothing.
//
// Session-scoped: it answers only for the caller and takes no parameters at all, so a `userId` (or
// anything else) in the query is a 400 rather than silently ignored. Rate-limited like its polled
// sibling `rollup-state`; the caller runs at most once per throttle window, so the limit only bites
// on a bug.
const QuerySchema = z.object({}).strict()

export async function GET(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) {
    return NextResponse.json({ error: 'This endpoint takes no parameters' }, { status: 400 })
  }

  if (!rateLimit(`oura-ble-rollup-watermark:${userId}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const repo = await getRepositoryAsync()
  const end = await repo.getSleepCoverageEnd(userId)
  const ms = end ? end.getTime() : null

  return NextResponse.json(
    { rolledThroughMs: ms != null && Number.isFinite(ms) ? ms : null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
