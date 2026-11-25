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
import { applyBudgetStage, reasoningWithBudgetNote } from '@trainingai/shared/ai-periodization/budget-stage'
import { phaseOfLoads } from '@trainingai/shared/ai-periodization/phase-guards'
import { budgetForPreset, requestedBudgetMin, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import type { AiPrescription, PrescriptionStatus } from '@trainingai/shared/types/ai-periodization'
import type { WorkoutRepository } from '@/lib/data/repository'
import { setsWithDelta, appliedAfterBudgetRest } from '@trainingai/shared/ai-periodization/lift-preference'
import { phaseSetsMax } from '@trainingai/shared/ai-periodization/prompt'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'

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
  | { ok: false; reason: 'no_session' | 'no_prescription' | 'no_baseline' | 'expired' | 'not_refittable' | 'session_changed' }

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
  // #3890: set by `fitStoredPlanToCheckinBudget` only. The minutes this fit is for the weekly check-in,
  // or null to give a check-in fit back. Left out (a length the person picked), a plan the check-in had
  // fitted is marked as theirs, so the check-in no longer re-fits it.
  checkin?: { min: number | null },
): Promise<RefitResult> {
  // #3927: the program and the session's structure stamp from one snapshot, so the re-fit stores only
  // while the session is still the one this program describes (the guard generation uses, #3895).
  const { program: activeProgram, structure } = await repo.getActiveProgramWithStructureStamp(userId, programSessionId)
  const validSession = activeProgram?.sessions.find(s => s.id === programSessionId)
  if (!validSession || !activeProgram) return { ok: false, reason: 'no_session' }

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
  const signals = await aggregateSignals(userId, programSessionId, repo, tz, undefined, budgetOverrideMin, { program: activeProgram })
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
      // Same reason as `sets`: a plan generated for a shorter day stored its shortened rest (#2284).
      restSec: baseline.restSec?.[ex.sessionExerciseId] ?? ex.restSec,
    })),
    signals,
    validSession.timeBudgetMinutes,
    durationPreset,
    new Set(baseline.earnedSetIds ?? []),
    // #2403: re-cost the session Full trains too, or the re-fit leaves it describing the old budget.
    new Map(stored.exercises.flatMap(ex =>
      ex.deloaded && ex.preDeload ? [[ex.sessionExerciseId, ex.preDeload] as const] : [])),
    // #3713: the phase the loads were written for, not `stored.phase`, which a cap guard rewrites to
    // the next phase on an offer (a pending move to deload would re-fit to deload's 3 sets at the old
    // phase's loads).
    phaseOfLoads(stored, state.phase),
    // #3896: a one-shot ±1 set the plan applied goes back on after the re-fit, as generation put it on
    // after the fit. The baseline holds the count before it, so the re-fit can never apply it twice.
    (id, sets) => {
      const delta = stored.exercises.find(ex => ex.sessionExerciseId === id)?.liftPreference?.setsDelta
      if (!delta) return null
      const role = signals.exercises.find(e => e.sessionExerciseId === id)?.role ?? UNCLASSIFIED_EXERCISE_ROLE
      return setsWithDelta(sets, delta, role, phaseSetsMax(signals.trainingGoal, phaseOfLoads(stored, state.phase)))
    },
  )

  // The previous fit's drops are stripped rather than merged: an exercise dropped for a
  // 30-minute ask must come back when the lifter asks for 90.
  const carried = { ...stored }
  delete carried.droppedExerciseIds
  delete carried.fullSession
  delete carried.checkinBudgetMin
  // A check-in fit records its minutes and a fit back clears them; a picked length over a check-in fit
  // records null, so the check-in leaves that plan alone.
  const checkinBudgetMin = checkin ? (checkin.min ?? undefined) : stored.checkinBudgetMin !== undefined ? null : undefined
  const fullRest = Object.fromEntries(
    stored.exercises.map(ex => [ex.sessionExerciseId, baseline.restSec?.[ex.sessionExerciseId] ?? ex.restSec]),
  )
  const restShortened = stored.exercises.some(ex =>
    (budget.restSec.get(ex.sessionExerciseId) ?? fullRest[ex.sessionExerciseId]) !== fullRest[ex.sessionExerciseId])
  const prescription: AiPrescription = {
    ...carried,
    exercises: stored.exercises.map(ex => {
      const restSec = budget.restSec.get(ex.sessionExerciseId) ?? fullRest[ex.sessionExerciseId]
      // The re-fit can shorten a preferred rest too; the record must not claim it was used (#3896).
      // #4126: a re-fit re-derives a lightened row's sets and rest, so what it had before the soreness would
      // be stale; the row stays as the re-fit leaves it.
      const { liftPreference: recorded, preSoreness: _stale, ...exRest } = ex
      const liftPreference = appliedAfterBudgetRest(recorded, restSec)
      return {
        ...exRest,
        sets: budget.sets.get(ex.sessionExerciseId) ?? ex.sets,
        restSec,
        ...(liftPreference && { liftPreference }),
      }
    }),
    refitBaseline: {
      ...baseline,
      ...((baseline.restSec || restShortened) && { restSec: fullRest }),
    },
    estimatedSessionDurationMin: budget.estimatedSessionDurationMin,
    weeklyVolumeContribution: budget.weeklyVolumeContribution,
    ...(budget.fullSession && { fullSession: budget.fullSession }),
    reasoning: reasoningWithBudgetNote(baseline.reasoning, budget.budgetNote),
    durationPreset,
    sessionTimeBudgetMinutes: validSession.timeBudgetMinutes,
    ...(budget.droppedIds.size > 0 && { droppedExerciseIds: [...budget.droppedIds] }),
    ...(checkinBudgetMin !== undefined && { checkinBudgetMin }),
  }

  // The existing expiry, deliberately: this is the same plan against a different clock, and
  // re-stamping it would quietly extend a window the lifter never earned. `storePrescription`
  // resets the status unless it is passed one, and the acceptance state has not changed —
  // only the shape the budget allows.
  // #3927: stored only while the slot is in the phase it was read in and the session is the one the
  // program above describes. A Coach change or an editor save between the read and this store voided
  // the slot; the re-fit, made from the plan it voided, is then not written over the void, and the
  // caller generates for the session as it is.
  const stamped = await repo.storePrescription(
    userId,
    programSessionId,
    prescription,
    state.prescriptionExpiresAt ?? new Date(Date.now() + 7 * 86_400_000),
    state.prescriptionStatus,
    { phase: state.phase, phaseStartedAt: state.phaseStartedAt, structure },
    // #4098 review: the weekly check-in's fit is made by a READ (`fitStoredPlanToCheckinBudget`): its store waits
    // for a row at most `readLockWait` and a miss serves the plan as stored (`session_changed`).
    checkin ? { read: true } : undefined,
  )
  if (!stamped) return { ok: false, reason: 'session_changed' }

  return {
    ok: true,
    prescription,
    prescriptionStatus: state.prescriptionStatus,
    estimatedSessionDurationMin: budget.estimatedSessionDurationMin,
  }
}
