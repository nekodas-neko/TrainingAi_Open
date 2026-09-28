// Re-fit the STORED prescription to a new time budget, with no model call (RV-202 ②).
//
// Changing the duration preset used to re-run `generatePrescriptionForSession` end to end: the
// lifter waited ~30 s and spent a Gemini call so that a deterministic arithmetic stage could run
// against a different number. The plan the model produced does not depend on the budget — the
// budget only ever decided how many of its sets survive — so the whole model half is skippable.
//
// Falls back to a full generation (the caller's job) whenever the stored plan cannot answer:
// see `refitPrescriptionToBudget`'s `ok: false, reason` values, which are NOT errors.

import { aggregateSignals } from '@trainingai/shared/ai-periodization/signals'
import { applyBudgetStage } from '@trainingai/shared/ai-periodization/budget-stage'
import { budgetForPreset, requestedBudgetMin, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import type { AiPrescription, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'

export type RefitResult =
  | {
      ok: true
      prescription: AiPrescription
      /** Unchanged by a re-fit — the budget decides the plan's shape, never whether the
       *  lifter has accepted it. */
      prescriptionStatus: PrescriptionStatus
      estimatedSessionDurationMin: number
    }
  /** Not an error — the stored plan cannot be re-fitted, so the caller generates instead. */
  | { ok: false; reason: 'no_session' | 'no_prescription' | 'no_baseline' | 'expired' | 'not_refittable' }

/** Statuses whose plan is still the one the lifter is looking at. `consumed` and `dismissed`
 *  are finished with; `none` has nothing stored. Re-fitting any of those would rewrite a plan
 *  nobody is about to train, so they fall through to a full generation instead. */
const REFITTABLE = new Set(['pending', 'accepted', 'auto_applied'])

export async function refitPrescriptionToBudget(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  durationPreset: DurationPreset,
  now = new Date(),
): Promise<RefitResult> {
  const activeProgram = await repo.getActiveProgram(userId)
  const validSession = activeProgram?.sessions.find(s => s.id === programSessionId)
  if (!validSession) return { ok: false, reason: 'no_session' }

  const state = await repo.getSessionPeriodization(userId, programSessionId)
  const stored = state?.prescription
  if (!state || !stored) return { ok: false, reason: 'no_prescription' }
  if (!REFITTABLE.has(state.prescriptionStatus)) return { ok: false, reason: 'not_refittable' }
  // An expired plan is replaced, not re-shaped — the same rule reevaluatePrescriptionForToday
  // applies on the consumption day (BF-179/Q-229). Re-fitting one would hand back a plan built
  // in a phase the lifter has since left, wearing today's budget.
  if (state.prescriptionExpiresAt != null && state.prescriptionExpiresAt <= now) {
    return { ok: false, reason: 'expired' }
  }
  const baseline = stored.refitBaseline
  // Absent on everything generated before RV-202 ②, and on whole-session deloads, which are
  // built from the DELOAD_* constants rather than a model answer and are returned unchanged
  // while they are pending.
  if (!baseline) return { ok: false, reason: 'no_baseline' }

  // Same resolution as generation: the override exists only when the request differs from the
  // session's own length, and it is read from the REQUESTED minutes so a session already at
  // MIN_PRESET_BUDGET_MIN stays honest (BF-7 PR 2b).
  const requestedMin = requestedBudgetMin(validSession.timeBudgetMinutes, durationPreset)
  const budgetOverrideMin = requestedMin !== validSession.timeBudgetMinutes
    ? budgetForPreset(validSession.timeBudgetMinutes, durationPreset)
    : undefined
  const signals = await aggregateSignals(userId, programSessionId, repo, tz, undefined, budgetOverrideMin)
  if (!signals) return { ok: false, reason: 'no_session' }

  const budget = applyBudgetStage(
    stored.exercises.map(ex => ({
      sessionExerciseId: ex.sessionExerciseId,
      name: ex.name,
      // The baseline, never the stored (already-trimmed) count — that is the whole point.
      // An exercise the baseline does not name can only be one added to the session since
      // generation, which the stored plan has no numbers for either; its own count is the
      // best available starting shape.
      sets: baseline.sets[ex.sessionExerciseId] ?? ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.restSec,
    })),
    signals,
    validSession.timeBudgetMinutes,
    durationPreset,
    new Set(baseline.earnedSetIds ?? []),
  )

  // The previous fit's drops are stripped rather than merged: an exercise dropped for a
  // 30-minute ask must come back when the lifter asks for 90.
  const carried = { ...stored }
  delete carried.droppedExerciseIds
  const prescription: AiPrescription = {
    ...carried,
    exercises: stored.exercises.map(ex => ({
      ...ex,
      sets: budget.sets.get(ex.sessionExerciseId) ?? ex.sets,
    })),
    estimatedSessionDurationMin: budget.estimatedSessionDurationMin,
    weeklyVolumeContribution: budget.weeklyVolumeContribution,
    reasoning: `${baseline.reasoning}${budget.budgetNote}`,
    durationPreset,
    ...(budget.droppedIds.size > 0 && { droppedExerciseIds: [...budget.droppedIds] }),
  }

  // The existing expiry, deliberately: this is the same plan against a different clock, and
  // re-stamping it would quietly extend a window the lifter never earned. `storePrescription`
  // resets the status unless it is passed one, and the acceptance state has not changed —
  // only the shape the budget allows.
  await repo.storePrescription(
    userId,
    programSessionId,
    prescription,
    state.prescriptionExpiresAt ?? new Date(Date.now() + 7 * 86_400_000),
    state.prescriptionStatus,
  )

  return {
    ok: true,
    prescription,
    prescriptionStatus: state.prescriptionStatus,
    estimatedSessionDurationMin: budget.estimatedSessionDurationMin,
  }
}
