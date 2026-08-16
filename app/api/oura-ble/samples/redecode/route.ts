import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { runRedecodeOffLoop } from '@/lib/oura-ble/rollup-worker'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'

// Re-stamp measured_at / event_name over stored rows, then re-aggregate into the
// product tables. Under Lever 1 the decoders run during the re-aggregate (from the
// archival body_hex, not a persisted `decoded` column), so a new/fixed decoder still
// backfills retroactively here — no ring re-sync needed. The "recompute everything"
// lever for the direct-BLE pipeline.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  const params = new URL(req.url).searchParams
  // Optional ?date=YYYY-MM-DD → the re-aggregate returns a per-epoch staging diagnostic for that
  // night (see aggregateOuraRawSamples debugNight), for tuning the stager against real data.
  const debugDate = params.get('date')?.trim() || undefined
  // ?dump=1 → lightweight diagnostic ONLY: skip the full-table re-decode and reprocess just the
  // recent (35-day) window for the requested night. The full path re-decodes every stored sample
  // AND re-aggregates all history, which grows with weeks of data and times the request out at the
  // gateway ("upstream error") — that killed the per-night dump. dump mode keeps it fast.
  const dumpOnly = params.get('dump') === '1'
  // ?allowStepsDecrease=1 — one-time owner-gated D0 backfill lever: skip the steps step's normal
  // "only ever raise a stored day's count" guard so a corrected (lower) step_counter total can
  // overwrite an old, inflated flat-30-estimate value. Never touches a higher-ranked `manual` entry
  // (see aggregateOuraRawSamples's steps step / upsertBodyMetrics sourceMap merge). Requires the
  // full-history redecode path (below) — irrelevant to dumpOnly, which writes nothing.
  const allowStepsDecrease = params.get('allowStepsDecrease') === '1'

  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Full-table rewrite pass — keep it rare.
  if (!rateLimit(`oura-ble-redecode:${userId}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ

  // Lightweight dump: no full re-decode, bounded (recent-window) aggregate — just enough to return
  // the requested night's per-epoch diagnostic without timing out.
  if (dumpOnly) {
    const { aggregated, aggregateError } = await runRedecodeOffLoop(userId, tz, { debugDate, dumpOnly: true }, false)
    if (aggregateError) console.error('[oura-ble] dump re-aggregate failed:', aggregateError)
    return NextResponse.json({ scanned: 0, updated: 0, redecodeError: null, aggregated, aggregateError })
  }

  // Both phases are re-runnable over the archival body_hex, so neither should ever
  // 500 the request (a raw 500 shows as a scary "redecode failed" in the tester and
  // hides the cause). They run independently and report per-phase errors as JSON —
  // a redecode failure must not prevent the re-aggregate, and vice versa.
  //
  // Both run in the rollup worker (Q-213). This is the heaviest pair of calls in the app — a
  // redecode walks all history and the aggregate then rebuilds every day from it — and on the
  // request thread it is the same event-loop starvation that took production down on 2026-08-13,
  // self-inflicted and minutes long. The caller still waits for the result; the rest of the process
  // no longer does. `fullHistory` is required: a new/fixed decoder backfills every stored day, so
  // this must bypass the incremental read window and rebuild the full daily-summary table.
  const { redecoded, redecodeError, aggregated, aggregateError } = await runRedecodeOffLoop(
    userId,
    tz,
    { debugDate, fullHistory: true, allowStepsDecrease },
    true,
  )
  if (redecodeError) console.error('[oura-ble] redecode failed:', redecodeError)
  if (aggregateError) console.error('[oura-ble] re-aggregate failed:', aggregateError)

  return NextResponse.json({ ...(redecoded ?? { scanned: 0, updated: 0, restamped: 0 }), redecodeError, aggregated, aggregateError })
}
