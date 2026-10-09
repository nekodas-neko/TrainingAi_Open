import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeAgentRequest } from '@/lib/agent-actions/guard'
import { AgentActionRequest, agentJobLosesData, runAgentJob } from '@/lib/agent-actions/jobs'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { getRepositoryAsync } from '@/lib/data'
import { rateLimit } from '@/lib/rate-limit'
import { readJsonLimited } from '@trainingai/shared/http/request-guards'
import { DEFAULT_TZ } from '@trainingai/shared/date-utils'
import { REDECODE_JOB_STALE_MS } from '@/lib/data/postgres/slices/oura'
import { describeRedecodeJob } from '@/lib/oura-ble/stress-backfill-job'
import type { WorkoutRepository } from '@/lib/data/repository'
import type { FinishAgentActionInput } from '@/lib/data/postgres/slices/agent-actions'

/**
 * The agent key (issue 2381, part b). An agent runs an allow-listed, idempotent maintenance job on
 * the owner's account, and every run is a row in `agent_action_log` (readable as
 * `claude_ro.agent_action_log`).
 *
 *   POST /api/agent-actions   Authorization: Bearer <AGENT_ACTIONS_SECRET>
 *     { "job": "rederive-body-battery", "actor": "orchestrator", "targetUserId": "<owner uuid>",
 *       "approval": "https://github.com/…/issues/N#issuecomment-M",   // when the run can lose data
 *       "params": { "from": "2026-09-01", "to": "2026-09-30", "dryRun": true } }
 *
 *   GET /api/agent-actions?job=stress-backfill&jobId=N   polls a job that runs in the job slot.
 *
 * Order, and why:
 *   1. The key (`authorizeAgentRequest`): synchronous, no database. A missing, wrong or unconfigured
 *      key is a 401 and leaves no trace beyond the per-IP rate-limit counter. The session cookie is
 *      never consulted.
 *   2. The body: size-capped, then a strict schema built from the allow-list. An unknown job, an
 *      unknown field or a mistyped parameter is a 400 and nothing runs.
 *   3. The owner account must still be an admin (a DB read), and the request must name it.
 *   4. From here every outcome is logged: a refusal (wrong account, rate limit, a data-losing run
 *      with no approval) is a `refused` row; a run is `running`, then finished once.
 */

const MAX_BODY_BYTES = 8 * 1024
/** Runs per job per minute, matching the admin routes these jobs come from. */
const RUNS_PER_JOB_PER_MINUTE = 4
const NO_STORE = { 'Cache-Control': 'private, no-store' }

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(req: Request) {
  const authed = authorizeAgentRequest(req)
  if (!authed.ok) return json({ error: authed.error }, authed.status)

  const read = await readJsonLimited(req, MAX_BODY_BYTES)
  if (!read.ok) {
    return read.reason === 'too_large' ? json({ error: 'Request too large' }, 413) : json({ error: 'Invalid JSON' }, 400)
  }
  const parsed = AgentActionRequest.safeParse(read.body)
  if (!parsed.success) {
    return json({ error: 'Invalid request', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, 400)
  }
  const body = parsed.data
  const owner = authed.ownerUserId

  try {
    await requireAdmin(owner)
  } catch (err) {
    return adminErrorResponse(err)
  }
  const repo = await getRepositoryAsync()

  const logged = { job: body.job, parameters: body.params, actor: body.actor, approvalRef: body.approval ?? null }
  const refuse = async (status: number, error: string) => {
    // A refusal names the owner only when the request did; a request for another account is logged
    // as global so the log never links to an account the key cannot act on.
    const row = await repo.startAgentAction({ ...logged, targetUserId: body.targetUserId === owner ? owner : null })
    await repo.finishAgentAction(row.id, { outcome: 'refused', error })
    return json({ error, actionId: row.id }, status)
  }

  if (body.targetUserId !== owner) {
    return refuse(403, 'The agent key acts on the owner account only; targetUserId is not it')
  }
  if (!rateLimit(`agent-actions:${body.job}`, RUNS_PER_JOB_PER_MINUTE, 60_000)) {
    return refuse(429, 'Too many runs of this job; wait a minute')
  }
  if (agentJobLosesData(body) && !body.approval) {
    return refuse(403, 'This run can overwrite stored data and needs an approval link to the owner\'s approval comment')
  }

  const user = await repo.getUserById(owner)
  const tz = user?.timezone ?? DEFAULT_TZ
  if (body.job === 'stress-backfill') await reapAbandonedRuns(repo, body.job)

  const row = await repo.startAgentAction({ ...logged, targetUserId: owner })
  let finishedNow = true
  try {
    const result = await runAgentJob({ repo, userId: owner, tz }, body)
    if ('pending' in result.finish) {
      finishedNow = false
      void result.finish.pending
        .then(f => repo.finishAgentAction(row.id, f))
        .catch(err => repo.finishAgentAction(row.id, { outcome: 'failed', error: errorText(err) }).catch(() => {}))
    } else {
      await repo.finishAgentAction(row.id, result.finish)
    }
    return json({ actionId: row.id, job: body.job, ...result.body }, result.status)
  } catch (err) {
    console.error(`[agent-actions] ${body.job} failed:`, err)
    if (finishedNow) await repo.finishAgentAction(row.id, { outcome: 'failed', error: errorText(err) }).catch(() => {})
    return json({ error: 'The job failed; see agent_action_log for this action', actionId: row.id }, 500)
  }
}

const StatusQuery = z.object({
  job: z.literal('stress-backfill'),
  jobId: z.string().regex(/^[1-9]\d{0,15}$/),
}).strict()

/** Poll a job that runs in the one-at-a-time slot. Owner-scoped: another account's job is not found. */
export async function GET(req: Request) {
  const authed = authorizeAgentRequest(req)
  if (!authed.ok) return json({ error: authed.error }, authed.status)

  const q = StatusQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!q.success) return json({ error: 'Expected ?job=stress-backfill&jobId=<integer>, and nothing else' }, 400)

  try {
    await requireAdmin(authed.ownerUserId)
  } catch (err) {
    return adminErrorResponse(err)
  }
  const repo = await getRepositoryAsync()
  await repo.reapStaleRedecodeJobs(authed.ownerUserId)
  const job = await repo.getRedecodeJob(authed.ownerUserId, Number(q.data.jobId))
  if (!job) return json({ job: null }, 404)
  return json({ job: describeRedecodeJob(job) })
}

/**
 * A run whose process ended before its job did stays `running` in the log. The job slot's own reaper
 * gives up on a job after `REDECODE_JOB_STALE_MS`; a log row older than that is finished as failed,
 * once, the next time someone asks to run the job.
 */
async function reapAbandonedRuns(repo: WorkoutRepository, job: string) {
  const stale = await repo.listAgentActions({ job, outcome: 'running', limit: 500 })
  const cutoff = Date.now() - REDECODE_JOB_STALE_MS
  const abandoned: FinishAgentActionInput = { outcome: 'failed', error: 'abandoned: no result recorded before the job slot gave up on it' }
  for (const r of stale) {
    if (r.startedAt.getTime() < cutoff) await repo.finishAgentAction(r.id, abandoned)
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
