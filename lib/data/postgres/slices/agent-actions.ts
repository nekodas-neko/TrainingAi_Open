// #2381 — the agent action log (`agent_action_log`, migration 202610071523).
//
// One row per maintenance action an agent or the owner ran. It is append-only: these three
// functions insert, finish once and read. There is deliberately no update or delete, and the
// migration's trigger refuses both at the database, so code added here later cannot rewrite the
// record either.
//
// Server-only and not user-scoped: a run is an operation on the system, which may target one
// account (`targetUserId`) or none (VACUUM). The callers are the agent-key routes (#2381 PR b/c),
// which are admin-only. Agents read the log through `claude_ro.agent_action_log`.
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import type { getDb } from '../client'
import * as s from '../schema'
import { redactActionParameters } from '@/lib/agent-actions/redact'

type Db = ReturnType<typeof getDb>

export type AgentActionOutcome = 'running' | 'succeeded' | 'failed' | 'refused'
export type AgentActionFinalOutcome = Exclude<AgentActionOutcome, 'running'>

export interface AgentActionRecord {
  id: string
  /** Stable action id from `docs/admin-actions.md`, e.g. `rederive-body-battery`. */
  job: string
  /** Already redacted: no key naming a credential. */
  parameters: Record<string, unknown>
  /** The agent's name, or `owner`. */
  actor: string
  /** Link to the owner's approval. Required for destructive jobs by the route, not the table. */
  approvalRef: string | null
  /** The account the job ran on; null for a global job, or after that account was deleted. */
  targetUserId: string | null
  startedAt: Date
  finishedAt: Date | null
  outcome: AgentActionOutcome
  affectedRows: number | null
  daysMoved: number | null
  error: string | null
}

export interface StartAgentActionInput {
  job: string
  parameters?: Record<string, unknown>
  actor: string
  approvalRef?: string | null
  targetUserId?: string | null
}

export interface FinishAgentActionInput {
  outcome: AgentActionFinalOutcome
  affectedRows?: number | null
  daysMoved?: number | null
  /** A short reason. Only the first line is kept, capped at the column's 2,000 characters, so a stack
   *  trace cannot land in the log and an oversized message cannot make the finishing write fail. */
  error?: string | null
}

export interface ListAgentActionsFilter {
  job?: string
  actor?: string
  outcome?: AgentActionOutcome
  targetUserId?: string
  /** Runs that started at or after this instant. */
  since?: Date
  /** Default 50, at most 500. */
  limit?: number
}

export const AGENT_ACTION_ERROR_MAX = 2000
const LIST_DEFAULT = 50
const LIST_MAX = 500

/** First line only, then capped: the column holds a reason, never a stack. */
export function shortActionError(error: string | null | undefined): string | null {
  if (error == null) return null
  const firstLine = error.split(/\r?\n/, 1)[0].trim()
  if (firstLine.length === 0) return null
  return firstLine.slice(0, AGENT_ACTION_ERROR_MAX)
}

function toRecord(r: typeof s.agentActionLog.$inferSelect): AgentActionRecord {
  return {
    id: r.id,
    job: r.job,
    parameters: r.parameters as Record<string, unknown>,
    actor: r.actor,
    approvalRef: r.approvalRef,
    targetUserId: r.targetUserId,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    outcome: r.outcome as AgentActionOutcome,
    affectedRows: r.affectedRows,
    daysMoved: r.daysMoved,
    error: r.error,
  }
}

/** Records a run as `running`. The parameters are redacted here, whatever the caller passed. */
export async function startAgentAction(db: Db, input: StartAgentActionInput): Promise<AgentActionRecord> {
  const [row] = await db.insert(s.agentActionLog)
    .values({
      job: input.job,
      parameters: redactActionParameters(input.parameters),
      actor: input.actor,
      approvalRef: input.approvalRef ?? null,
      targetUserId: input.targetUserId ?? null,
    })
    .returning()
  return toRecord(row)
}

/**
 * Finishes a running run, once. Returns null when there is no such row or it already finished: the
 * `outcome = 'running'` predicate means a second finish matches nothing, and a finished row cannot be
 * changed by any path (the trigger refuses it too).
 */
export async function finishAgentAction(
  db: Db, id: string, result: FinishAgentActionInput,
): Promise<AgentActionRecord | null> {
  const t = s.agentActionLog
  const [row] = await db.update(t)
    .set({
      outcome: result.outcome,
      // The CHECK wants finished_at >= started_at; a clock that stepped back must not fail the write.
      finishedAt: sql`greatest(now(), ${t.startedAt})`,
      affectedRows: result.affectedRows ?? null,
      daysMoved: result.daysMoved ?? null,
      error: shortActionError(result.error),
    })
    .where(and(eq(t.id, id), eq(t.outcome, 'running')))
    .returning()
  return row ? toRecord(row) : null
}

export async function getAgentAction(db: Db, id: string): Promise<AgentActionRecord | null> {
  const [row] = await db.select().from(s.agentActionLog).where(eq(s.agentActionLog.id, id)).limit(1)
  return row ? toRecord(row) : null
}

/** Newest first. */
export async function listAgentActions(db: Db, filter: ListAgentActionsFilter = {}): Promise<AgentActionRecord[]> {
  const t = s.agentActionLog
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? LIST_DEFAULT), 1), LIST_MAX)
  const rows = await db.select().from(t)
    .where(and(
      filter.job === undefined ? undefined : eq(t.job, filter.job),
      filter.actor === undefined ? undefined : eq(t.actor, filter.actor),
      filter.outcome === undefined ? undefined : eq(t.outcome, filter.outcome),
      filter.targetUserId === undefined ? undefined : eq(t.targetUserId, filter.targetUserId),
      filter.since === undefined ? undefined : gte(t.startedAt, filter.since),
    ))
    .orderBy(desc(t.startedAt), desc(t.id))
    .limit(limit)
  return rows.map(toRecord)
}
