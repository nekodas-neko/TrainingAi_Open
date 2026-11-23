import { and, eq, isNull } from 'drizzle-orm'
import * as s from '@/lib/data/postgres/schema'
import { fieldsMatchDomain, type CoachPatch, type CoachPatchDomain } from './patch'
import { driftAgainst } from './domains/types'
import type { ApplyOutcome, Db, DomainHandler } from './domains/types'
import { sessionExerciseHandler } from './domains/session-exercise'
import { nutritionTargetsHandler, userGoalsHandler } from './domains/goals'
import { injuryHandler } from './domains/injury'
import { programPhaseHandler } from './domains/program-phase'
import { earlyDeloadHandler } from './domains/early-deload'
import { liftPreferenceHandler, StaleLiftPreference, type LiftPreferenceSource } from './domains/lift-preference'
import { DEFAULT_TZ, todayInTz } from '@trainingai/shared/date-utils'
import { isLockWaitTimeout, isBoundedLockTimeout } from '@/lib/api/route-errors'
import { reportServerError } from '@/lib/observability'

export type { ApplyOutcome } from './domains/types'

/**
 * `today` is a parameter rather than something a handler computes, because a date computed inside
 * the write path is a date computed in whatever timezone the server happens to be in. `early_deload`
 * and `injury` read it — they stamp a start day and a recovered day — but every entry point takes it so
 * the next date-bearing domain cannot quietly reintroduce the bug.
 */
export function handlerFor(
  domain: CoachPatchDomain,
  today: string = todayInTz(DEFAULT_TZ),
  timezone: string = DEFAULT_TZ,
  source: LiftPreferenceSource = 'coach',
): DomainHandler {
  const handlers: Record<CoachPatchDomain, DomainHandler> = {
    session_exercise: sessionExerciseHandler,
    nutrition_targets: nutritionTargetsHandler,
    user_goals: userGoalsHandler,
    injury: injuryHandler(today),
    program_phase: programPhaseHandler,
    early_deload: earlyDeloadHandler(today, timezone),
    // The bar's basis reads (1RM, estimates, records) go through the repository, as every other
    // reader of them does. Imported lazily so the Coach's apply path does not load the whole
    // repository for the domains that never need it.
    lift_preference: liftPreferenceHandler(async () => (await import('@/lib/data')).getRepository(), today, source),
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
  timezone?: string,
  /** #3890: the weekly check-in applies its lift changes through this same path, stamped as its own. */
  opts: { source?: LiftPreferenceSource } = {},
): Promise<ApplyOutcome> {
  const accepted = patch.changes.filter(c => acceptedIds.includes(c.id))
  if (accepted.length === 0) return { ok: false, reason: 'invalid', detail: 'No changes accepted' }

  // A model that mixes domains would otherwise be able to aim a calorie field at an exercise row.
  if (!fieldsMatchDomain(patch)) {
    return { ok: false, reason: 'invalid', detail: 'Those fields do not belong to that domain' }
  }

  const handler = handlerFor(patch.domain, today, timezone, opts.source)
  try {
    if (handler.transactional) return await applyInTransaction(db, userId, patch, accepted, handler)
    return await applyOutsideTransaction(db, userId, patch, accepted, handler)
  } catch (err) {
    // #4080: gave up waiting for a lock. Whether "nothing was changed" is true depends on what wrapped
    // the apply. A transactional handler (lift preference) runs wholly inside one transaction, or a
    // savepoint in a caller's, so a lock timeout (55P03) or a statement timeout (57014) anywhere in it
    // rolls everything back. The others run through `applyOutsideTransaction`: their write can commit
    // on the pool before the `coach_changes` insert or a later statement hits 57014, so a 57014 there
    // leaves the outcome unknown and must stay an error. Only 55P03 is a refusal for them: it can only
    // come from `withBoundedLockWait`, which runs before any write. A caller that holds its own
    // transaction (the weekly check-in) gets the refusal and fails as a whole.
    // Reported, so a lock that stays held shows up: 57014 is also any slow statement.
    if (handler.transactional ? isLockWaitTimeout(err) : isBoundedLockTimeout(err)) {
      reportServerError(err, { userId, url: '/api/coach/apply' })
      return { ok: false, reason: 'busy' }
    }
    throw err
  }
}

async function applyOutsideTransaction(
  db: Db, userId: string, patch: CoachPatch, accepted: CoachPatch['changes'], handler: DomainHandler,
): Promise<ApplyOutcome> {
  const result = await handler.apply(db, userId, patch, accepted)
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

/** A refusal from inside a transaction: nothing the handler wrote survives it. */
class Refused extends Error {
  constructor(readonly outcome: Exclude<ApplyOutcome, { ok: true }>) { super(outcome.reason) }
}

/**
 * #3896 step 5: the handler's writes and the `coach_changes` record in one transaction. A refusal the
 * handler returns after it has written, or a stale row it throws on, rolls back everything, so the
 * history never records a change the rows do not hold, nor the rows a change the history lacks.
 */
async function applyInTransaction(
  db: Db, userId: string, patch: CoachPatch, accepted: CoachPatch['changes'], handler: DomainHandler,
): Promise<ApplyOutcome> {
  try {
    // Pool reads the apply needs happen here, before a connection is held for the transaction.
    const prepared = await handler.prepare?.(db, userId, patch)
    return await db.transaction(async tx => {
      const t = tx as unknown as Db
      const result = await handler.apply(t, userId, patch, accepted, prepared)
      if (!result.ok) throw new Refused(result)
      const inserted = await t.insert(s.coachChanges).values({
        userId,
        domain: patch.domain,
        targetId: result.targetId,
        patch,
        acceptedIds: accepted.map(c => c.id),
        beforeState: result.beforeState,
        summary: result.summary,
      }).returning({ id: s.coachChanges.id })
      if (inserted.length !== 1) throw new Error('coach_changes insert wrote no row')
      return { ok: true as const, changeId: inserted[0].id, summary: result.summary }
    })
  } catch (err) {
    if (err instanceof Refused) return err.outcome
    if (err instanceof StaleLiftPreference) return { ok: false, reason: 'stale', drift: err.drift }
    throw err
  }
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

  if (handler.transactional) {
    try {
      return await db.transaction(async tx => {
        const t = tx as unknown as Db
        const restored = await handler.undo(t, userId, record.targetId, (record.beforeState ?? {}) as Record<string, unknown>)
        if (!restored.ok) throw new Refused(restored)
        // Conditional, so two undos racing each other cannot both restore.
        const marked = await t.update(s.coachChanges).set({ undoneAt: new Date() })
          .where(and(eq(s.coachChanges.id, changeId), eq(s.coachChanges.userId, userId), isNull(s.coachChanges.undoneAt)))
          .returning({ id: s.coachChanges.id })
        if (marked.length !== 1) throw new Refused({ ok: false, reason: 'invalid', detail: 'Already undone' })
        return { ok: true as const, changeId, summary: `Undid: ${record.summary}` }
      })
    } catch (err) {
      if (err instanceof Refused) return err.outcome
      if (err instanceof StaleLiftPreference) return { ok: false, reason: 'stale', drift: err.drift }
      // #4082: gave up waiting for the lift-write lock, or was the victim of a deadlock. The undo is one
      // transaction, so nothing of it was written; the same request can be sent again.
      if (isLockWaitTimeout(err)) {
        reportServerError(err, { userId, url: '/api/coach/apply/undo' })
        return { ok: false, reason: 'busy' }
      }
      throw err
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
