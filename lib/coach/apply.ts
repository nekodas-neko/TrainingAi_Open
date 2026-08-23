import { and, eq } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { fieldsMatchDomain, type CoachPatch, type CoachPatchDomain } from './patch'
import { driftAgainst } from './domains/types'
import type { ApplyOutcome, Db, DomainHandler } from './domains/types'
import { sessionExerciseHandler } from './domains/session-exercise'
import { nutritionTargetsHandler, userGoalsHandler } from './domains/goals'
import { injuryHandler } from './domains/injury'
import { programPhaseHandler } from './domains/program-phase'
import { earlyDeloadHandler } from './domains/early-deload'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'

export type { ApplyOutcome } from './domains/types'

/**
 * `today` is a parameter rather than something a handler computes, because a date computed inside
 * the write path is a date computed in whatever timezone the server happens to be in. Only
 * `early_deload` reads it — it stamps the deload's start day — but every entry point takes it so
 * the next date-bearing domain cannot quietly reintroduce the bug.
 */
export function handlerFor(domain: CoachPatchDomain, today: string = todayInTz(DEFAULT_TZ)): DomainHandler {
  const handlers: Record<CoachPatchDomain, DomainHandler> = {
    session_exercise: sessionExerciseHandler,
    nutrition_targets: nutritionTargetsHandler,
    user_goals: userGoalsHandler,
    injury: injuryHandler,
    program_phase: programPhaseHandler,
    early_deload: earlyDeloadHandler(today),
  }
  return handlers[domain]
}

/**
 * Apply the accepted subset of a Coach patch.
 *
 * The model is not in this path. It proposed the patch; the user chose which rows to accept; this
 * writes them. That separation is what makes the write testable without an LLM, and is why the
 * SDK's tool-approval flow was not used — `ToolApprovalResponse` is binary and cannot carry a
 * per-row selection.
 *
 * Per-domain work lives in `domains/`; this owns the parts that must be identical everywhere:
 * the domain/field agreement check, the `coach_changes` record, and the shape of every refusal.
 */
export async function applyCoachPatch(
  db: Db,
  userId: string,
  patch: CoachPatch,
  acceptedIds: string[],
  today?: string,
): Promise<ApplyOutcome> {
  const accepted = patch.changes.filter(c => acceptedIds.includes(c.id))
  if (accepted.length === 0) return { ok: false, reason: 'invalid', detail: 'No changes accepted' }

  // A model that mixes domains would otherwise be able to aim a calorie field at an exercise row.
  if (!fieldsMatchDomain(patch)) {
    return { ok: false, reason: 'invalid', detail: 'Those fields do not belong to that domain' }
  }

  const result = await handlerFor(patch.domain, today).apply(db, userId, patch, accepted)
  if (!result.ok) return result

  const [inserted] = await db
    .insert(s.coachChanges)
    .values({
      userId,
      domain: patch.domain,
      targetId: result.targetId,
      patch,
      acceptedIds: accepted.map(c => c.id),
      beforeState: result.beforeState,
      summary: result.summary,
    })
    .returning({ id: s.coachChanges.id })

  return { ok: true, changeId: inserted.id, summary: result.summary }
}

/**
 * Undo restores the `before_state` captured when the change was applied.
 *
 * The window — "until the next workout started after the change" — is enforced by the route,
 * which knows the user's sessions. This function does the restore.
 */
export async function undoCoachChange(db: Db, userId: string, changeId: string): Promise<ApplyOutcome> {
  const [record] = await db
    .select()
    .from(s.coachChanges)
    .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId)))
    .limit(1)

  if (!record) return { ok: false, reason: 'not_found' }
  if (record.undoneAt) return { ok: false, reason: 'invalid', detail: 'Already undone' }

  // No `today` needed: undo restores the `beforeState` captured at apply time and never reads
  // the clock.
  const handler = handlerFor(record.domain as CoachPatchDomain)
  if (!handler) return { ok: false, reason: 'invalid', detail: 'This change can no longer be undone' }

  // Q-468: refuse a moved target on the way back, exactly as apply refuses a moved base. Undo used
  // to read its `beforeState` and write it over whatever was there — measured inside the Coach's
  // own flow, two stacked changes on one exercise, undoing the FIRST returned the row to its
  // original value while the history still showed the second as in effect, and undoing both left a
  // value the user never chose.
  //
  // Comparing against `to` rather than `from` is what makes this the mirror of apply, and it
  // enforces reverse order as a consequence wherever two changes touch the same field: the older
  // one no longer matches what the target holds until the newer one has been undone.
  const accepted = (record.patch as CoachPatch | null)?.changes ?? []
  const acceptedIds = new Set(record.acceptedIds ?? [])
  const applied = acceptedIds.size > 0 ? accepted.filter(c => acceptedIds.has(c.id)) : accepted
  if (applied.length > 0) {
    const current = await handler.currentState(db, userId, record.targetId)
    // A null map means there is nothing to compare — the target is gone, or was never a row. Undo
    // still runs: a removal's undo re-inserts exactly the row that is missing.
    if (current) {
      // Only fields the handler actually reports as state. The rest — `removed`, the
      // create-on-swap fields — describe an action rather than a value that can have moved.
      const stateful = applied.filter(c => c.field in current)
      const drift = driftAgainst(stateful, current, undefined, 'to')
      if (drift.length > 0) return { ok: false, reason: 'stale', drift }
    }
  }

  const restored = await handler.undo(
    db,
    userId,
    record.targetId,
    (record.beforeState ?? {}) as Record<string, unknown>,
  )
  if (!restored.ok) return restored

  await db.update(s.coachChanges).set({ undoneAt: new Date() })
    .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId)))

  return { ok: true, changeId, summary: `Undid: ${record.summary}` }
}
