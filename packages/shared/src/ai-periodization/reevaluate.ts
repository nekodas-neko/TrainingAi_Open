import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'
import { computePerExerciseDeload, type PerExerciseDeloadInput } from './per-exercise-deload'
import { shouldTriggerEmergencyDeload, type EmergencySignals, type EmergencyState } from './emergency-deload'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'

// Cheap fresh-signals subset for consumption-day re-evaluation — deliberately NOT the full
// 30-signal aggregation (aggregateSignals), which is too expensive to run on every
// workout-data fetch. Only what's needed to re-check soreness/injury-driven deloads and
// the hours-since-last-session emergency condition.
export interface ReevaluationSignals {
  soreMusclesInSession: string[]
  hoursSinceLastSession: number | null
  activeInjuredMusclesInSession: string[]
  trainingGoal: string
  exercises: PerExerciseDeloadInput[]
  // Latest persisted illness-radar flag. elevated/fever deload the whole session in place
  // (self-reverting via preDeload when the flag clears). Deliberately NOT an emergency-deload
  // trigger: emergency deloads regenerate the whole prescription via the LLM and touch phase
  // state on acceptance — too heavy for a transient illness signal.
  illnessFlag: IllnessFlag | null
  // Lifter reported "Sick / Unwell" in TODAY's check-in. Unlike illnessFlag (a passive
  // biometric read) this IS an emergency trigger: it is an explicit statement that they are
  // unwell, and it must reach the plan on the same fetch that follows the check-in rather
  // than waiting for the next full generation.
  selfReportedSick: boolean
}

// Fingerprint of the inputs a consumption-day re-evaluation depends on, stored on the
// prescription as `reevaluatedInputsKey` so a repeat fetch can skip the work while a
// changed check-in cannot be missed. The date is part of the key so the daily
// injury/illness re-check still happens even when soreness is unchanged; each check-in's
// own updatedAt covers an edit that keeps the same sore-muscle list / illness flag.
//
// Q-113: the Morning Check-in's illness/context flag is a second, independent source of
// selfReportedSick (see resolveSelfReportedSick) — it must be in the key too, or filling it
// in mid-day (after the mood log was already fingerprinted) would never re-trigger the
// same-day reevaluation that's supposed to catch exactly this.
//
// Q-117: injuries were entirely absent from the key. Logging, editing, or resolving an injury
// changes `activeInjuredMusclesInSession` (workout-data/route.ts), but with no fingerprint the
// re-evaluation only ever re-ran when the DATE changed — an injury logged after the day's first
// fetch (the normal order: open the app, then log an injury) would never reach today's plan.
// The max updatedAt over unresolved injuries catches add/edit AND resolve — resolving the injury
// with the latest updatedAt shrinks the unresolved set, changing which timestamp is the max (or
// dropping to 'none'), so the key changes either way.
export function reevaluationKey(
  todayStr: string,
  moodLog: { soreMuscles: string[]; bodyState: string[]; updatedAt?: Date | string | null } | null | undefined,
  morningCheckin?: { illnessContext: string | null; updatedAt?: Date | string | null } | null,
  injuries?: { resolvedDate: string | null; updatedAt: Date | string } [] | null,
): string {
  const moodPart = moodLog ? (() => {
    const updated = moodLog.updatedAt instanceof Date ? moodLog.updatedAt.toISOString() : moodLog.updatedAt ?? ''
    const sore = moodLog.bodyState.includes('sore_muscles') ? [...moodLog.soreMuscles].sort().join(',') : ''
    return `${updated}|${sore}`
  })() : 'none'
  const checkinPart = morningCheckin ? (() => {
    const updated = morningCheckin.updatedAt instanceof Date
      ? morningCheckin.updatedAt.toISOString() : morningCheckin.updatedAt ?? ''
    return `${updated}|${morningCheckin.illnessContext ?? ''}`
  })() : 'none'
  const injuryPart = injuries?.length
    ? injuries
        .filter(i => !i.resolvedDate)
        .map(i => (i.updatedAt instanceof Date ? i.updatedAt.toISOString() : i.updatedAt))
        .sort()
        .at(-1) ?? 'none'
    : 'none'
  return `${todayStr}|${moodPart}|${checkinPart}|${injuryPart}`
}

export interface ReevaluationResult {
  prescription: AiPrescription
  changed: boolean
  // A whole-session deload (soreness affecting most of the session, or an emergency
  // condition) can't be synthesized here — buildWholeSessionDeloadPrescription needs the
  // full time-budget-aware signal aggregation. Callers fire the existing async
  // regenerate (same fire-and-forget /prescribe pattern as the failed-generation retry)
  // instead of blocking the read path on the LLM.
  needsRegenerate: boolean
}

// Re-derives per-exercise deload flags against TODAY's soreness/injury signals, never
// touching the LLM's sets/reps/pct otherwise (AI-2/AI-3). A prescription generated after
// the previous session is consumed up to 7 days later — soreness that has since cleared
// must drop its deload, and newly-sore muscles must pick one up, without re-running Gemini.
// Past that window it is no longer re-evaluated but replaced: see the expiry branch below.
export function reevaluatePrescriptionForToday(
  prescription: AiPrescription,
  signals: ReevaluationSignals,
  state: EmergencyState,
  now = new Date(),
): ReevaluationResult {
  // The 7-day window in the comment above was documented intent and nothing enforced it (Q-229):
  // `prescriptionExpiresAt` was written at generation and then only ever read to suppress
  // re-offering a still-pending emergency deload — never to age out a prescription the lifter is
  // actually training against. So a session type left unused for longer than its own window kept
  // replaying its last AI-computed pct/sets/reps until an unrelated emergency or soreness signal
  // happened to fire. The owner hit it on 2026-08-14: an 8-day-old deload-era 52% served on a live
  // Intensification day.
  //
  // Only an applied prescription ages out here. `pending` is an *offer* whose own expiry the
  // emergency-deload suppression below already owns, and re-deriving it here would fight that.
  if (
    (state.prescriptionStatus === 'auto_applied' || state.prescriptionStatus === 'accepted' ||
      state.prescriptionStatus === 'consumed') &&
    state.prescriptionExpiresAt != null && state.prescriptionExpiresAt <= now
  ) {
    return { prescription, changed: false, needsRegenerate: true }
  }

  // Only the cheaply-derivable emergency condition (hours-since-last-session combined with
  // today's soreness) is re-checked here — this is exactly the AI-3 fix: at generation time
  // hoursSinceLastSession was always ~0 (just-completed session), an always-false condition.
  // The other emergency triggers (ACWR, RPE trend, rep-completion, consecutive-days) need
  // the full signal aggregation and are left to the next real prescribe call.
  const emergencySignals: EmergencySignals = {
    consecutiveSessionDaysOfThisType: 0,
    hoursSinceLastSession: signals.hoursSinceLastSession,
    soreMusclesInSession: signals.soreMusclesInSession,
    activeInjuredMusclesInSession: signals.activeInjuredMusclesInSession,
    acwr: null,
    rpeTrend: null,
    repCompletionRate: null,
    selfReportedSick: signals.selfReportedSick,
  }
  if (shouldTriggerEmergencyDeload(emergencySignals, state, now)) {
    return { prescription, changed: false, needsRegenerate: true }
  }

  const perEx = computePerExerciseDeload(
    signals.exercises,
    signals.soreMusclesInSession,
    signals.trainingGoal,
    state.phase,
  )

  if (perEx.outcome === 'whole_session') {
    return { prescription, changed: false, needsRegenerate: true }
  }

  const illnessDeload = signals.illnessFlag === 'elevated' || signals.illnessFlag === 'fever'
  const nowDeloadedIds = perEx.outcome === 'per_exercise' ? new Set(perEx.deloadedIds) : new Set<string>()
  const notes: Record<string, string> = { ...perEx.notes }
  if (illnessDeload) {
    for (const ex of signals.exercises) {
      nowDeloadedIds.add(ex.sessionExerciseId)
      // Soreness notes are more specific — keep them where both apply.
      if (!notes[ex.sessionExerciseId]) notes[ex.sessionExerciseId] = `Deload — illness radar: ${signals.illnessFlag}`
    }
  }
  let changed = false
  const exercises: AiPrescriptionExercise[] = prescription.exercises.map(ex => {
    const wasDeloaded = ex.deloaded === true
    const isDeloaded = nowDeloadedIds.has(ex.sessionExerciseId)

    if (isDeloaded && !wasDeloaded) {
      changed = true
      return {
        ...ex,
        preDeload: { sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.restSec },
        sets: perEx.override.sets,
        reps: perEx.override.reps,
        pct: perEx.override.pct,
        restSec: perEx.override.restSec,
        deloaded: true,
        deloadNote: notes[ex.sessionExerciseId],
      }
    }
    if (!isDeloaded && wasDeloaded && ex.preDeload) {
      changed = true
      return {
        ...ex,
        sets: ex.preDeload.sets,
        reps: ex.preDeload.reps,
        pct: ex.preDeload.pct,
        restSec: ex.preDeload.restSec,
        deloaded: false,
        deloadNote: undefined,
        preDeload: undefined,
      }
    }
    if (isDeloaded && wasDeloaded) {
      // Still sore — refresh the note (matched muscle labels can shift day to day).
      const note = notes[ex.sessionExerciseId]
      if (note && note !== ex.deloadNote) {
        changed = true
        return { ...ex, deloadNote: note }
      }
    }
    return ex
  })

  return {
    prescription: changed ? { ...prescription, exercises } : prescription,
    changed,
    needsRegenerate: false,
  }
}
