import { z } from 'zod'
import type { WorkoutRepository } from '@/lib/data/repository'
import { normalizeDateParamIso } from '@trainingai/shared/date-utils'
import { getPool } from '@/lib/data/postgres/client'
import { rederiveBodyBattery } from '@/lib/health/rederive-body-battery'
import { startStressBackfillJob } from '@/lib/oura-ble/stress-backfill-job'
import { redecodeJobKind } from '@/lib/oura-ble/redecode-job-kind'
import { tagBaselineSessions } from '@/lib/admin/baseline-phase-tag.mjs'
import { rederiveStylelessOneRm } from '@/lib/workout/rederive-styleless-one-rm'
import type { FinishAgentActionInput } from '@/lib/data/postgres/slices/agent-actions'

/**
 * The agent key's allow-list (issue 2381, part b). A job is reachable with the key only if it is
 * in `AGENT_JOBS`; the body schema is built from this list, so an unknown job is a 400 before
 * anything runs.
 *
 * Every entry REUSES the implementation the admin-session route runs; none of them carries logic
 * of its own (`docs/admin-actions.md` records each one's agent path). Each acts on exactly one
 * account, the owner's, because each existing job is scoped to the signed-in admin, and the key
 * does not widen that.
 *
 * Nothing that touches the ring key, the raw archive, users, invites, money or AI generation is
 * here, and nothing is reachable by name alone: adding a job means adding it to this file, with a
 * test.
 *
 * `losesData` says whether a run can overwrite or remove stored values. Such a run needs an
 * `approval` naming the owner's approval comment, or it is refused. A dry run never loses data.
 */

/** `YYYY-MM-DD` or `YYYY/MM/DD`, the same two forms every date parameter accepts. */
const DateParam = z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/, 'expected YYYY-MM-DD or YYYY/MM/DD')

export interface AgentJobContext {
  repo: WorkoutRepository
  /** The owner's account, verified by the route. */
  userId: string
  tz: string
}

/** What a finished run hands back: the HTTP answer, and the log row's finishing columns. */
export interface AgentJobResult {
  status: number
  body: Record<string, unknown>
  /** The finishing columns now, or `pending` for a job that finishes later (the stress backfill). */
  finish: FinishAgentActionInput | { pending: Promise<FinishAgentActionInput> }
}

interface AgentJobDef<P> {
  params: z.ZodType<P>
  losesData: (p: P) => boolean
  run: (ctx: AgentJobContext, p: P) => Promise<AgentJobResult>
}

const RederiveBodyBatteryParams = z.object({
  from: DateParam.optional(),
  to: DateParam.optional(),
  dryRun: z.boolean(),
}).strict()

const DryRunOnly = z.object({ dryRun: z.boolean() }).strict()

export const AGENT_JOBS = {
  /**
   * #2409 (TN-72). Recomputes past `body_battery_daily` under the current model, 31 days per call.
   * A write overwrites stored days, so it needs an approval.
   */
  'rederive-body-battery': {
    params: RederiveBodyBatteryParams,
    losesData: p => !p.dryRun,
    run: async (ctx, p) => {
      const from = p.from ? normalizeDateParamIso(p.from) : null
      const to = p.to ? normalizeDateParamIso(p.to) : null
      if ((p.from && !from) || (p.to && !to)) {
        return { status: 400, body: { error: 'Invalid date' }, finish: { outcome: 'refused', error: 'invalid date' } }
      }
      const result = await rederiveBodyBattery({ repo: ctx.repo, userId: ctx.userId, tz: ctx.tz, from, to, dryRun: p.dryRun })
      if (!result.ok) return { status: 400, body: { error: result.error }, finish: { outcome: 'refused', error: result.error } }
      const written = p.dryRun ? 0 : result.report.summary.written
      return {
        status: 200,
        body: { report: result.report },
        finish: { outcome: result.report.summary.failed > 0 ? 'failed' : 'succeeded', affectedRows: written, daysMoved: written,
          error: result.report.summary.failed > 0 ? `${result.report.summary.failed} day(s) could not be computed` : null },
      }
    },
  } satisfies AgentJobDef<z.infer<typeof RederiveBodyBatteryParams>>,

  /**
   * #2460. Tags the owner's pre-TN-75 baseline sessions `phase_type = 'baseline'`. Additive: it sets
   * only NULL tags, and a second run tags nothing.
   */
  'backfill-baseline-phase-tag': {
    params: DryRunOnly,
    losesData: () => false,
    run: async (ctx, p) => {
      const client = await getPool().connect()
      try {
        const r = await tagBaselineSessions(client, { user: ctx.userId, write: p.dryRun === false })
        const dates = [...new Set(r.matches.map((m: { local_date: string }) => m.local_date))]
        const report = {
          dryRun: p.dryRun,
          predicted: r.predicted,
          written: r.written,
          dates,
          matches: r.matches.map(summariseSession),
          nearMisses: r.nearMisses.map(summariseSession),
        }
        return {
          status: 200,
          body: { report },
          finish: { outcome: 'succeeded', affectedRows: r.written, daysMoved: p.dryRun ? 0 : dates.length },
        }
      } finally {
        client.release()
      }
    },
  } satisfies AgentJobDef<z.infer<typeof DryRunOnly>>,

  /**
   * #2236 / PR #2680. Adds the missing `oura_daytime_stress_buckets` rows. Add-only. It runs in the
   * one-at-a-time job slot, so the answer is a job id to poll (`GET /api/agent-actions?job=…`), and
   * the log row is finished when the job ends.
   */
  'stress-backfill': {
    params: DryRunOnly,
    losesData: () => false,
    run: async (ctx, p) => {
      const started = await startStressBackfillJob(ctx.repo, ctx.userId, ctx.tz, p.dryRun)
      const job = { jobId: started.job.id, kind: redecodeJobKind(started.job.opts), startedAt: started.job.startedAt.toISOString() }
      if (started.state === 'refused') {
        return {
          status: 409,
          body: { error: 'Another job holds the slot; nothing started. Wait for it, then ask again.', runningJob: job },
          finish: { outcome: 'refused', error: `job slot held by ${job.kind} job ${job.jobId}` },
        }
      }
      if (started.state === 'following') {
        return {
          status: 200,
          body: { alreadyRunning: true, job, note: 'A run of this kind is already in flight; nothing new started. Poll it.' },
          finish: { outcome: 'refused', error: `already running as job ${job.jobId}; nothing started` },
        }
      }
      const pending = started.done.then((phases): FinishAgentActionInput => {
        const report = phases?.stressBackfill as { bucketsWritten?: number; daysToGain?: number } | null | undefined
        if (!phases || phases.aggregateError || !report) {
          return { outcome: 'failed', error: phases?.aggregateError ?? 'stress backfill produced no report' }
        }
        return {
          outcome: 'succeeded',
          affectedRows: report.bucketsWritten ?? 0,
          daysMoved: p.dryRun ? 0 : (report.daysToGain ?? 0),
        }
      })
      return { status: 202, body: { alreadyRunning: false, job, note: 'Started. Poll GET /api/agent-actions?job=stress-backfill&jobId=…' }, finish: { pending } }
    },
  } satisfies AgentJobDef<z.infer<typeof DryRunOnly>>,

  /**
   * Issue 2357. Re-derives the stored 1RMs of styleless working sets without the AMRAP discount,
   * upward only, through `rederiveStylelessOneRm` (`POST /api/admin/rederive-styleless-one-rm`).
   * A write overwrites stored 1RMs, so it needs an approval.
   */
  'rederive-styleless-one-rm': {
    params: DryRunOnly,
    losesData: p => !p.dryRun,
    run: async (ctx, p) => {
      const result = await rederiveStylelessOneRm({ repo: ctx.repo, userId: ctx.userId, tz: ctx.tz, dryRun: p.dryRun })
      if (!result.ok) return { status: 409, body: { error: result.error }, finish: { outcome: 'failed', error: result.error } }
      const { summary } = result.report
      return {
        status: 200,
        body: { report: result.report },
        finish: { outcome: 'succeeded', affectedRows: summary.written, daysMoved: p.dryRun ? 0 : summary.daysMoved },
      }
    },
  } satisfies AgentJobDef<z.infer<typeof DryRunOnly>>,
} as const

export type AgentJobId = keyof typeof AGENT_JOBS
export const AGENT_JOB_IDS = Object.keys(AGENT_JOBS) as AgentJobId[]

function summariseSession(r: Record<string, unknown>) {
  return {
    workoutSessionId: r.workout_session_id,
    localDate: r.local_date,
    sessionName: r.session_name,
    exercises: Number(r.exercises),
  }
}

/**
 * `https://github.com/nekodas-neko/TrainingAi_Open/issues/N#issuecomment-M` (or `/pull/N`): a link to
 * one comment, the owner's approval. The server cannot check who wrote it; the link is the record
 * the owner audits in `agent_action_log.approval_ref`.
 */
export const ApprovalRef = z.string().max(500)
  .regex(/^https:\/\/github\.com\/nekodas-neko\/TrainingAi_Open\/(issues|pull)\/\d+#issuecomment-\d+$/,
    'approval must link to one comment on this repository')

/** An agent's name: lower-case words, e.g. `orchestrator`, `bugfix`, `implementer`. */
const Actor = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'actor is the agent name, lower-case')

function requestSchema<J extends AgentJobId>(job: J) {
  return z.object({
    job: z.literal(job),
    actor: Actor,
    /** Must be the owner's account: the request says which account it acts on, and the route checks it. */
    targetUserId: z.string().uuid(),
    approval: ApprovalRef.optional(),
    params: AGENT_JOBS[job].params,
  }).strict()
}

export const AgentActionRequest = z.discriminatedUnion('job', [
  requestSchema('rederive-body-battery'),
  requestSchema('backfill-baseline-phase-tag'),
  requestSchema('stress-backfill'),
  requestSchema('rederive-styleless-one-rm'),
])
export type AgentActionRequest = z.infer<typeof AgentActionRequest>

/** Typed dispatch: the request's params are the schema of the job it names. */
export function agentJobLosesData(req: AgentActionRequest): boolean {
  return (AGENT_JOBS[req.job].losesData as (p: typeof req.params) => boolean)(req.params)
}

export function runAgentJob(ctx: AgentJobContext, req: AgentActionRequest): Promise<AgentJobResult> {
  return (AGENT_JOBS[req.job].run as (c: AgentJobContext, p: typeof req.params) => Promise<AgentJobResult>)(ctx, req.params)
}
