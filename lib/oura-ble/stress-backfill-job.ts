import type { WorkoutRepository } from '@/lib/data/repository'
import type { RedecodeJob } from '@/lib/data/postgres/slices/oura'
import { runStressBackfillOffLoop, type RedecodePhases } from '@/lib/oura-ble/rollup-worker'
import { redecodeJobKind } from '@/lib/oura-ble/redecode-job-kind'

/**
 * Starting the daytime-stress bucket backfill (issue 2236) in the one-at-a-time job slot, and
 * describing a job for a poll. One copy, shared by the admin route
 * (`POST /api/oura-ble/samples/redecode?stressBackfill=1`) and the agent key (`/api/agent-actions`,
 * issue 2381), so the two callers cannot disagree on reaping, the job-kind rule or how a run finishes.
 */
export type StressBackfillStart =
  /** Another kind holds the slot (a redecode, a step backfill, the other stress kind). Nothing started. */
  | { state: 'refused'; job: RedecodeJob }
  /** A run of the same kind is in flight; nothing new started, follow `job`. */
  | { state: 'following'; job: RedecodeJob }
  /** Started. `done` settles when the job row is finished: the phases, or null when the run threw.
   *  It never rejects. */
  | { state: 'started'; job: RedecodeJob; done: Promise<RedecodePhases | null> }

export async function startStressBackfillJob(
  repo: WorkoutRepository, userId: string, tz: string, dryRun: boolean,
): Promise<StressBackfillStart> {
  const opts: Record<string, unknown> = { fullHistory: true, stressBackfill: true, dryRun }
  // A job whose process died mid-run would otherwise hold the slot forever (see the redecode route).
  await repo.reapStaleRedecodeJobs(userId)
  const { job, alreadyRunning, refused } = await repo.startRedecodeJob(userId, opts)
  if (refused) return { state: 'refused', job }
  if (alreadyRunning) return { state: 'following', job }

  // Reads stored data and adds rows; redecodes and re-aggregates nothing. Failure is reported into
  // the job row (`aggregateError`) by the worker, and the `.catch` covers anything that is not.
  const done = runStressBackfillOffLoop(userId, tz, dryRun)
    .then(async phases => {
      await repo.finishRedecodeJob(job.id, phases as unknown as Record<string, unknown>, null)
      return phases
    })
    .catch(async err => {
      console.error('[oura-ble] stress backfill job threw:', err instanceof Error ? err.message : String(err))
      await repo.finishRedecodeJob(job.id, null, err instanceof Error ? err.message : String(err)).catch(() => {})
      return null
    })
  return { state: 'started', job, done }
}

/**
 * The poll answer for one job. `status` is derived rather than stored: a row is running until it has
 * a `finished_at`, and what kind of finish it was depends on whether the run threw (`error`) or a
 * phase reported one inside `result`. Keeping it derived means there is no second field that can
 * disagree with the timestamps.
 */
export function describeRedecodeJob(job: RedecodeJob) {
  const phases = job.result as { redecodeError?: string | null; aggregateError?: string | null } | null
  const status = job.finishedAt == null
    ? 'running'
    : job.error != null || phases?.redecodeError != null || phases?.aggregateError != null
      ? 'failed'
      : 'done'
  return {
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
  }
}
