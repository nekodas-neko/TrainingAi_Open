import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin } from '@/lib/admin'
import { runRedecodeOffLoop } from '@/lib/oura-ble/rollup-worker'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { getRepositoryAsync } from '@/lib/data'

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
  // ?async=1 → return a job id immediately instead of holding the request open (Q-535).
  //
  // **Opt-in, not the default, and that is a lane seam rather than timidity.** Both existing callers
  // read the synchronous shape and report completion from it: `oura-ble-debug.tsx` falls back to
  // "redecode ran … data refreshed", and `step-backfill-console.tsx` says "Done. Backfill applied".
  // Flipping the default without their poller would make both of them state that finished work had
  // finished when it had only started — a quieter and more misleading failure than the 502 this
  // replaces. `components/**` belongs to the other implementation lane, so the poller and the
  // default flip are Q-318.
  const asyncJob = params.get('async') === '1'

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
  const repo = await getRepositoryAsync()

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
  // Both run in the rollup worker (Q-213). `fullHistory` is required: a new/fixed decoder backfills
  // every stored day, so this must bypass the incremental read window and rebuild the full
  // daily-summary table.
  //
  // Q-535: the request no longer WAITS for it. It used to, and on real data that exceeded the
  // gateway timeout — so Railway returned 502 and the tester printed "redecode failed" for work
  // that had completed (measured: `scanned=1098158`, every `sleep_sessions` row stamped after the
  // 502 landed). That is not cosmetic: a false failure invites a retry, and a retry is another
  // full-history pass of the operation whose own comment names it as the event-loop starvation that
  // took production down on 2026-08-13. The UI was encouraging the thing most likely to hurt.
  if (!asyncJob) {
    // The original synchronous path, unchanged. Still 502s on real data — that is what `?async=1`
    // exists to fix, and what Q-318 will switch the callers to.
    const { redecoded, redecodeError, aggregated, aggregateError } = await runRedecodeOffLoop(
      userId, tz, { debugDate, fullHistory: true, allowStepsDecrease }, true,
    )
    if (redecodeError) console.error('[oura-ble] redecode failed:', redecodeError)
    if (aggregateError) console.error('[oura-ble] re-aggregate failed:', aggregateError)
    return NextResponse.json({ ...(redecoded ?? { scanned: 0, updated: 0, restamped: 0 }), redecodeError, aggregated, aggregateError })
  }

  const opts = { debugDate: debugDate ?? null, fullHistory: true, allowStepsDecrease }

  // A job whose process died mid-run would otherwise hold the one-at-a-time slot forever. Reaped
  // here rather than by a sweeper — there is no cron layer in this app, and the only reader that
  // matters is the one asking whether it may start another.
  await repo.reapStaleRedecodeJobs(userId)
  const { job, alreadyRunning } = await repo.startRedecodeJob(userId, opts)
  if (alreadyRunning) {
    return NextResponse.json(
      {
        jobId: job.id, status: 'running', startedAt: job.startedAt.toISOString(), alreadyRunning: true,
        note: 'A redecode is already running; this did not start a second. Poll this job id.',
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  // Deliberately floating. The work already runs in a long-lived worker thread of a long-lived Node
  // process, and the debounced ingest rollup fires the same way — what changes here is only that the
  // HTTP response no longer depends on it. `.catch` is exhaustive: a throw that never reached the
  // job row would leave it running until the reaper, which is a worse report than an error.
  void runRedecodeOffLoop(userId, tz, { debugDate, fullHistory: true, allowStepsDecrease }, true)
    .then(async phases => {
      if (phases.redecodeError) console.error('[oura-ble] redecode failed:', phases.redecodeError)
      if (phases.aggregateError) console.error('[oura-ble] re-aggregate failed:', phases.aggregateError)
      await repo.finishRedecodeJob(job.id, phases as unknown as Record<string, unknown>, null)
    })
    .catch(async err => {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[oura-ble] redecode job threw:', err)
      await repo.finishRedecodeJob(job.id, null, message).catch(() => {})
    })

  return NextResponse.json(
    {
      jobId: job.id, status: 'running', startedAt: job.startedAt.toISOString(), alreadyRunning: false,
      note: 'Started. Poll GET ?jobId=… — this can take minutes, and the response arriving before it finishes is the point.',
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

/**
 * Poll a redecode job. `?jobId=…` for a specific one, otherwise the most recent.
 *
 * `status` is derived rather than stored: a row is running until it has a `finished_at`, and what
 * kind of finish it was depends on whether the run threw (`error`) or a phase reported one inside
 * `result`. Keeping it derived means there is no second field that can disagree with the timestamps.
 */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id
  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const repo = await getRepositoryAsync()
  await repo.reapStaleRedecodeJobs(userId)

  const idParam = new URL(req.url).searchParams.get('jobId')
  const id = idParam != null ? Number.parseInt(idParam, 10) : null
  if (idParam != null && !Number.isInteger(id)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 })
  }

  const job = id != null ? await repo.getRedecodeJob(userId, id) : await repo.getLatestRedecodeJob(userId)
  if (!job) return NextResponse.json({ job: null }, { headers: { 'Cache-Control': 'private, no-store' } })

  const phases = job.result as { redecodeError?: string | null; aggregateError?: string | null } | null
  const status = job.finishedAt == null
    ? 'running'
    : job.error != null || phases?.redecodeError != null || phases?.aggregateError != null
      ? 'failed'
      : 'done'

  return NextResponse.json(
    {
      job: {
        jobId: job.id,
        status,
        startedAt: job.startedAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
        opts: job.opts,
        error: job.error,
        ...(job.result ?? {}),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
