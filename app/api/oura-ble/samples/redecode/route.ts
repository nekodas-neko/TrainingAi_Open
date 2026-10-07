import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { runRedecodeOffLoop } from '@/lib/oura-ble/rollup-worker'
import { rateLimit } from '@/lib/rate-limit'
import { reportRollupStepErrors } from '@/lib/oura-ble/report-step-errors'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { getRepositoryAsync } from '@/lib/data'
import { redecodeJobKind, REDECODE_BUSY_FOR_BACKFILL_MESSAGE } from '@/lib/oura-ble/redecode-job-kind'

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
  // ?async=1 → start a job and return its id (Q-535). The full-history pass REQUIRES it: it runs
  // inside the one-at-a-time job slot (`oura_redecode_jobs`, migration 196), because two full-history
  // passes at once are the event-loop starvation that took production down on 2026-08-13. A request
  // that held the connection open instead never touched the slot, so it could run alongside a job
  // that held it, and a second one alongside that. Every caller already sends `?async=1`
  // (`runRedecodeJob` in components/oura-ble/redecode-job.ts), so nothing used that path.
  const asyncJob = params.get('async') === '1'

  try {
    await requireAdmin(userId, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
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

  // The job's two phases are re-runnable over the archival body_hex, so neither 500s the request
  // (a raw 500 shows as a scary "redecode failed" and hides the cause): they run independently and
  // report per-phase errors into the job row. Both run in the rollup worker (Q-213). `fullHistory` is
  // required: a new/fixed decoder backfills every stored day, so this must bypass the incremental
  // read window and rebuild the full daily-summary table.
  //
  // Q-535: the request does not WAIT for it. It used to, and on real data that exceeded the gateway
  // timeout — Railway returned 502 and the tester printed "redecode failed" for work that had
  // completed (measured: `scanned=1098158`, every `sleep_sessions` row stamped after the 502
  // landed). A false failure invites a retry, and a retry is another full-history pass. So a request
  // for the full-history pass that does not say `?async=1` is refused, with nothing started.
  if (!asyncJob) {
    return NextResponse.json(
      { error: 'The full-history redecode runs as a job. Call with ?async=1 and poll GET ?jobId=…' },
      { status: 400, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const opts = { debugDate: debugDate ?? null, fullHistory: true, allowStepsDecrease }

  // A job whose process died mid-run would otherwise hold the one-at-a-time slot forever. Reaped
  // here rather than by a sweeper — there is no cron layer in this app, and the only reader that
  // matters is the one asking whether it may start another.
  await repo.reapStaleRedecodeJobs(userId)
  const { job, alreadyRunning, refused } = await repo.startRedecodeJob(userId, opts)
  // Issue 2383: a step backfill must never follow a run that will not apply the step correction.
  // Refused rather than queued — no hidden queue, and the owner presses again once it finishes.
  // Nothing was started and no row was written, so the caller has nothing to poll.
  if (refused) {
    return NextResponse.json(
      {
        error: REDECODE_BUSY_FOR_BACKFILL_MESSAGE,
        refused: true,
        runningJobId: job.id,
        runningKind: redecodeJobKind(job.opts),
        requestedKind: redecodeJobKind(opts),
      },
      { status: 409, headers: { 'Cache-Control': 'private, no-store' } },
    )
  }
  if (alreadyRunning) {
    return NextResponse.json(
      {
        jobId: job.id, status: 'running', startedAt: job.startedAt.toISOString(), alreadyRunning: true,
        kind: redecodeJobKind(job.opts),
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
      // Same blind spot as the ingest path: a step that failed did not throw, so it reaches neither
      // this `.catch` nor `aggregateError`. The job row keeps the phases either way — this is what
      // puts the failure somewhere queryable.
      reportRollupStepErrors(phases.aggregated?.stepErrors, { userId, url: '/api/oura-ble/samples/redecode#aggregate' })
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
      kind: redecodeJobKind(job.opts),
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
  } catch (err) {
    return adminErrorResponse(err)
  }

  const repo = await getRepositoryAsync()
  await repo.reapStaleRedecodeJobs(userId)

  const idParam = new URL(req.url).searchParams.get('jobId')
  // `Number`, not `parseInt`. parseInt TRUNCATES and stops at the first non-digit, so `?jobId=1.5`
  // and `?jobId=77abc` used to poll jobs 1 and 77 — a 200 describing a different job than the caller
  // asked about, which is the same shape as a correct answer. The empty string is excluded
  // separately because `Number('')` is 0, which would poll job 0 rather than being refused.
  const id = idParam != null && idParam.trim() !== '' ? Number(idParam) : null
  if (idParam != null && (id == null || !Number.isInteger(id))) {
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
        // Issue 2383: what this run was asked to write, read from the row rather than from the
        // request that is polling it. The step-backfill screen only says "Backfill applied" when
        // this is 'step-backfill'. Placed after the spread so a result payload cannot shadow it.
        kind: redecodeJobKind(job.opts),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
