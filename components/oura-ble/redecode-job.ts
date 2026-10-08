/**
 * Client half of the async redecode job (Q-318). The synchronous `POST /api/oura-ble/samples/redecode`
 * outlives the gateway timeout on real data, so Railway returns 502 for work that completed — and a
 * false failure invites a retry, which is another full-history re-aggregate (Q-535).
 *
 * `?async=1` returns a job id immediately; this drives the POST-then-poll loop and hands back the
 * same phases payload the synchronous route used to return, so callers render exactly what they
 * rendered before.
 */

import type { RedecodeJobKind } from '@/lib/oura-ble/redecode-job-kind'
import type { StressBackfillReport } from '@/lib/oura-ble/stress-backfill'

export interface RedecodePhases {
  scanned?: number
  updated?: number
  redecodeError?: string | null
  aggregateError?: string | null
  /** Issue 2236: present only on a finished stress-bucket backfill job. */
  stressBackfill?: StressBackfillReport | null
  aggregated?: {
    sleepSessions?: number
    bodyMetricDays?: number
    daysWritten?: string[]
    stepErrors?: string[]
  }
}

/**
 * `done.jobKind` is what the run that finished was asked to write, as the server read it from the
 * job row. A caller that reports a specific effect (the step backfill) must check it rather than
 * assume the run it followed was its own (issue 2383).
 *
 * `refused` means the server started nothing because a different kind of run holds the slot.
 * It is not `failed`: nothing went wrong and nothing was written.
 */
export type RedecodeOutcome =
  | { kind: 'done'; jobId: number; jobKind: RedecodeJobKind | null; phases: RedecodePhases }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string }

interface StartResponse {
  jobId?: number
  alreadyRunning?: boolean
  kind?: RedecodeJobKind
  refused?: boolean
  note?: string
  error?: string
}

interface PollResponse {
  job:
    | (RedecodePhases & {
        jobId: number
        status: 'running' | 'done' | 'failed'
        kind?: RedecodeJobKind
        error?: string | null
      })
    | null
  error?: string
}

const POLL_INTERVAL_MS = 3_000

function kindLabel(kind: RedecodeJobKind | undefined): string {
  if (kind === 'step-backfill') return 'step backfill'
  if (kind === 'stress-backfill') return 'stress-bucket backfill'
  if (kind === 'stress-backfill-dry-run') return 'stress-bucket backfill dry run'
  return 'redecode'
}

/**
 * Start a redecode and poll it to completion.
 *
 * `onNote` receives progress lines the caller should surface — in particular the one saying a run
 * was already in flight, so a press that started nothing never reads as a press that did. There is
 * no client-side timeout on the poll: the server's staleness reaper turns an abandoned run into
 * `failed`, so the loop always terminates on a status the server actually stands behind.
 */
export async function runRedecodeJob(
  query = '',
  onNote?: (line: string) => void,
): Promise<RedecodeOutcome> {
  const extra = query.replace(/^[?&]/, '')
  const url = `/api/oura-ble/samples/redecode?async=1${extra ? `&${extra}` : ''}`

  let start: StartResponse
  try {
    const res = await fetch(url, { method: 'POST' })
    start = await res.json().catch(() => ({}) as StartResponse)
    if (res.status === 409 && start.refused) {
      return { kind: 'refused', message: start.error ?? 'a redecode is already running' }
    }
    if (!res.ok) return { kind: 'failed', message: start.error ?? `HTTP ${res.status}` }
  } catch (err) {
    return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
  }

  if (start.jobId == null) return { kind: 'failed', message: start.error ?? 'no job id returned' }

  onNote?.(
    start.alreadyRunning
      ? `a ${kindLabel(start.kind)} (job ${start.jobId}) was already running — this started nothing; following that run`
      : `${kindLabel(start.kind)} job ${start.jobId} started — this can take minutes`,
  )

  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    let poll: PollResponse
    try {
      const res = await fetch(`/api/oura-ble/samples/redecode?jobId=${start.jobId}`)
      poll = await res.json().catch(() => ({ job: null }) as PollResponse)
      if (!res.ok) return { kind: 'failed', message: poll.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { kind: 'failed', message: err instanceof Error ? err.message : String(err) }
    }

    const job = poll.job
    if (!job) return { kind: 'failed', message: `job ${start.jobId} not found` }
    if (job.status === 'running') continue

    const { jobId, status, error, kind: jobKind, ...phases } = job
    if (status === 'failed') {
      return {
        kind: 'failed',
        message: error ?? phases.aggregateError ?? phases.redecodeError ?? 'unknown error',
      }
    }
    return { kind: 'done', jobId, jobKind: jobKind ?? null, phases }
  }
}
