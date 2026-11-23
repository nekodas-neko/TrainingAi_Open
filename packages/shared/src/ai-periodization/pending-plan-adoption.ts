// #3900 review (H): a plan stored `pending` on the AI plan before #3900 changed the rule. The screen PR
// removes Accept, and a pending deload, rest or swap plan does not drive the bar, so such a plan would
// leave the person silently training the base numbers (a pending emergency deload could last days).
// Where it is served, it is brought under the new rule:
//  - promoted in place (status only; and for a one-day deload, the local-midnight expiry #3900 review F
//    gives every one-day deload on the AI plan) where the new rule would have stored that same plan
//    applied: a stay, a rest-day or swap suggestion, a one-day deload;
//  - regenerated where it would not have: a phase move on an aligned program, whose loads belong to
//    the old phase (the new rule makes them in the new phase and moves the program once).
// Nothing for a day already past: a one-day deload whose midnight has gone is given that expiry and
// so ages out, and the usual expiry path plans the day in front of the person. A move on a program
// still waiting for its switch-over waits under the new rule too, so it is left pending. A session
// under way is never re-planned: generation returns its stored plan first (`sessionUnderWay`).
import { nextMidnightInTz } from '@trainingai/shared/date-utils'
import { isOneDayDeload } from '@trainingai/shared/ai-periodization/one-day-deload'
import { isSessionUnderWay } from '@trainingai/shared/ai-periodization/session-under-way'
import { AI_PRESCRIBED_DELOAD_APPLIES } from '@trainingai/shared/ai-periodization/plan-status'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'

export type PendingPlanAdoption =
  /** Store this status and expiry on the same plan. */
  | { kind: 'promote'; expiresAt: Date }
  /** A one-day deload whose new expiry has already passed: write the expiry; the plan ages out. */
  | { kind: 'end'; expiresAt: Date }
  /** A move whose loads are the old phase's: plan it again under the new rule. */
  | { kind: 'regenerate' }

/** What the new rule makes of a stored plan, or null to leave it as it is. Pure. */
export function pendingPlanAdoption(
  state: Pick<SessionPeriodization, 'prescription' | 'prescriptionStatus' | 'prescriptionExpiresAt' | 'prescriptionGeneratedAt'>,
  tz: string,
  now = new Date(),
): PendingPlanAdoption | null {
  const plan = state.prescription
  if (plan == null || state.prescriptionStatus !== 'pending') return null
  if (state.prescriptionExpiresAt == null || state.prescriptionExpiresAt <= now || state.prescriptionGeneratedAt == null) return null
  switch (plan.phaseAction) {
    case 'stay':
    case 'rest_day_recommended':
    case 'session_swap_recommended':
      return { kind: 'promote', expiresAt: state.prescriptionExpiresAt }
    case 'deload_recommended': {
      if (!AI_PRESCRIBED_DELOAD_APPLIES || !isOneDayDeload(plan)) return null
      const midnight = nextMidnightInTz(tz, state.prescriptionGeneratedAt)
      const expiresAt = midnight < state.prescriptionExpiresAt ? midnight : state.prescriptionExpiresAt
      return expiresAt > now ? { kind: 'promote', expiresAt } : { kind: 'end', expiresAt }
    }
    case 'transition_recommended':
      // A waiting program's move is one type's and still waits for its tap (#3877 item 3).
      return plan.typeOnlyMove ? null : { kind: 'regenerate' }
    default:
      return null
  }
}

// #3900 second review (2): a pending move is planned again at most once per plan per local day. The
// in-flight marker (`regenerate-in-background.ts`) only stops two runs at once, so a model that kept
// failing was tried again on every read that did not poll. The memory is the process's, keyed by the
// plan (`prescription_generated_at`) and the local day: a server restart forgets it, so the true worst
// case is one attempt per pending move per process lifetime per day, and then the 20-an-hour rate limit
// on the regeneration. A row in the database would survive a restart but would need a migration.
const regenerationTried = new Map<string, number>()

function regenerationAlreadyTried(userId: string, programSessionId: string, planAt: Date, tz: string, now: Date): boolean {
  const dayEnds = nextMidnightInTz(tz, now).getTime()
  for (const [key, ends] of regenerationTried) if (ends <= now.getTime()) regenerationTried.delete(key)
  const key = `${userId}:${programSessionId}:${planAt.getTime()}:${dayEnds}`
  if (regenerationTried.has(key)) return true
  regenerationTried.set(key, dayEnds)
  return false
}

/** Test seam: forget which moves were planned again. */
export function resetRegenerationAttempts(): void {
  regenerationTried.clear()
}

/**
 * The stored state as the AI plan serves it (`pendingPlanAdoption`). Only for an `ai_dynamic` program;
 * every other kind, and every state that is not a pending plan, is returned as it came with no query.
 * The write is a compare-and-set on the same pending plan; a failed or lost write serves the state as
 * stored (the next read tries again). `onRegenerate` is called for a move to plan again, once per plan per local day; a read that
 * passes none (a poll, or a reader that is not the workout screen) leaves it to the workout screen's read.
 */
export async function adoptPendingAiPlan<T extends SessionPeriodization>(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  program: { phaseMode?: string } | null | undefined,
  state: T,
  opts: { onRegenerate?: () => void; now?: Date } = {},
): Promise<T> {
  if (program?.phaseMode !== 'ai_dynamic') return state
  const now = opts.now ?? new Date()
  const adoption = pendingPlanAdoption(state, tz, now)
  if (adoption == null) return state
  // A workout of this type is under way: its plan is left exactly as it is (nothing promoted, ended or
  // planned again). Read only for a pending plan the rule would change.
  if (await isSessionUnderWay(repo, userId, programSessionId, now)) return state
  if (adoption.kind === 'regenerate') {
    if (opts.onRegenerate && !regenerationAlreadyTried(userId, programSessionId, state.prescriptionGeneratedAt!, tz, now)) {
      opts.onRegenerate()
    }
    return state
  }
  if (typeof repo.adoptPendingPrescription !== 'function') return state
  const status = adoption.kind === 'promote' ? 'auto_applied' : 'pending'
  try {
    const wrote = await repo.adoptPendingPrescription(userId, programSessionId, state.prescriptionGeneratedAt!, status, adoption.expiresAt)
    return wrote ? { ...state, prescriptionStatus: status, prescriptionExpiresAt: adoption.expiresAt } : state
  } catch (err) {
    console.error('[prescribe] bringing a pending plan under the AI plan\'s rule failed; serving it as stored:', err)
    return state
  }
}
