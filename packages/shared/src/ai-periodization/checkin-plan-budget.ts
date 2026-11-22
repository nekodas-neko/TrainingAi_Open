// #3890: the weekly check-in's shorter session, where a stored plan is served. A save or an undo of the
// check-in touches no stored plan (the Orchestrator's ruling, 22 Nov); the budget reaches one here, by
// the same no-model re-fit a picked preset length uses (`refitPrescriptionToBudget`).
import { formatInTimeZone } from 'date-fns-tz'
import { weekStartForDay } from '@trainingai/shared/date-utils'
import { NO_TIME_LIMIT } from '@trainingai/shared/workout/duration-model'
import { refitPrescriptionToBudget } from '@trainingai/shared/ai-periodization/refit-prescription'
import type { SessionPeriodization } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * #3890: is a weekly check-in's shorter session (`min`) a budget for a session of `sessionBudgetMin`?
 * Only when it IS shorter than the session's own length, or the session has no limit. Generation and
 * the serve-time re-fit below decide it here, so the two cannot disagree.
 */
export function checkinBudgetApplies(min: number | null | undefined, sessionBudgetMin: number | undefined): boolean {
  return min != null && min > 0 && sessionBudgetMin != null && (sessionBudgetMin === NO_TIME_LIMIT || min < sessionBudgetMin)
}

/**
 * #3890: a stored plan as it is served on `now`'s local date. A save or an undo of the weekly check-in
 * touches no stored plan; the shorter session reaches one here instead, where it is read:
 *  - on a date in the check-in's applies-to week (the user's local Monday to Sunday), with a shorter
 *    session saved, the person having picked no length for the plan, and the plan not already fitted
 *    to it: re-fitted to that budget by the same no-model re-fit a picked preset length uses, and stored;
 *  - a plan the check-in fitted, read when no check-in budget applies (an undo, or a later week): fitted
 *    back to the session's own length the same way (`refitBaseline` holds the full shape).
 * Anything else is returned as it came, with no query: the check-in budgets ride on the stored-plan
 * read itself (`checkinSessionBudgets`). A plan the re-fit cannot answer for (no baseline: a whole-
 * session deload or an old plan; expired; consumed) is served as stored.
 */
export async function fitStoredPlanToCheckinBudget<T extends SessionPeriodization>(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  state: T,
  now = new Date(),
): Promise<T> {
  const stored = state.prescription
  if (!stored) return state
  const marker = stored.checkinBudgetMin
  // The person picked a length over a check-in fit: theirs wins.
  if (marker === null) return state
  const weekStart = weekStartForDay(formatInTimeZone(now, tz, 'yyyy-MM-dd'))
  const min = state.checkinSessionBudgets?.find(b => b.weekStart === weekStart)?.min ?? null
  const want = checkinBudgetApplies(min, stored.sessionTimeBudgetMinutes) ? min : null
  if (marker === undefined) {
    if (want == null) return state
    // A length the person picked for this plan wins over the week's answer.
    if (stored.durationPreset != null && stored.durationPreset !== 'standard') return state
  } else if (want === marker) {
    return state
  }
  try {
    const refit = want != null
      ? await refitPrescriptionToBudget(userId, programSessionId, repo, tz, want, now, { min: want })
      : await refitPrescriptionToBudget(userId, programSessionId, repo, tz, 'standard', now, { min: null })
    return refit.ok ? { ...state, prescription: refit.prescription } : state
  } catch (err) {
    // The person's choice, not a safety bound: a failed fit serves the plan as stored, as generation
    // plans at the session's length when the budget read fails.
    console.error('[weekly-checkin] fitting the stored plan to the shorter session failed; serving it as stored:', err)
    return state
  }
}
