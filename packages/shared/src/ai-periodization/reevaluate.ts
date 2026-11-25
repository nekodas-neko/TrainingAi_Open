import type { AiPrescription, AiPrescriptionExercise } from '@trainingai/shared/types/ai-periodization'
import { computePerExerciseDeload, RECENTLY_TRAINED_NOTE_PREFIX, type PerExerciseDeloadInput } from './per-exercise-deload'
import { shouldTriggerEmergencyDeload, emergencyDeloadTrigger, type EmergencySignals, type EmergencyState } from './emergency-deload'
import type { IllnessFlag } from '@trainingai/shared/health/illness-radar'
import { recostPrescription, rowNumbersMoved, type FigureSignals } from './prescription-figures'
import { prescriptionAgedOut } from './prescription-expiry'
import { deloadEndDue, phaseOfLoads, type ProgramDeloadCheck } from './phase-guards'
import { phaseSetsMax } from './prompt'

// Cheap fresh-signals subset for consumption-day re-evaluation — deliberately NOT the full
// 30-signal aggregation (aggregateSignals), which is too expensive to run on every
// workout-data fetch. Only what's needed to re-check soreness/injury-driven deloads and
// the hours-since-last-session emergency condition.
export interface ReevaluationSignals {
  // #3764: lifter-reported ticks only; untouched suggestions are in the list below.
  soreMusclesInSession: string[]
  recentlyTrainedMusclesInSession?: string[]
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
  moodLog: { soreMuscles: string[]; bodyState: string[]; suggestedSoreMuscles?: string[] | null; updatedAt?: Date | string | null } | null | undefined,
  morningCheckin?: { illnessContext: string | null; updatedAt?: Date | string | null } | null,
  injuries?: { resolvedDate: string | null; updatedAt: Date | string } [] | null,
): string {
  const moodPart = moodLog ? (() => {
    const updated = moodLog.updatedAt instanceof Date ? moodLog.updatedAt.toISOString() : moodLog.updatedAt ?? ''
    const sore = moodLog.bodyState.includes('sore_muscles') ? [...moodLog.soreMuscles].sort().join(',') : ''
    // #3764: provenance decides which ticks lighten a load, so it is part of the key. Left out when
    // unknown, so a legacy check-in keeps the key it had.
    const suggested = moodLog.suggestedSoreMuscles == null ? '' : `|s:${[...moodLog.suggestedSoreMuscles].sort().join(',')}`
    return `${updated}|${sore}${suggested}`
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
// The expiry branch lives in `prescription-expiry.ts` beside the expiry it reads (#3700); re-exported
// so existing imports keep working.
export { prescriptionAgedOut } from './prescription-expiry'

// `deloadEndDue` (#3876) lives beside the deload floor it reads; re-exported for the read path.
export { deloadEndDue } from './phase-guards'

export function reevaluatePrescriptionForToday(
  prescription: AiPrescription,
  signals: ReevaluationSignals,
  // `sessionsInPhase` (#3876): absent, a finished deload is not checked (`deloadEndDue`).
  // `programDeload`: an aligned program's deload ends at the program's cap instead.
  state: EmergencyState & { sessionsInPhase?: number; programDeload?: ProgramDeloadCheck | null;
    // #3900 third review (3): a workout of this type is under way (`isSessionUnderWay`). Time passing
    // (an expiry, a deload's end) does not re-plan it, and a signal that would re-plan it (a sick or
    // heavy-soreness report) lightens its remaining rows here instead, because generation holds an
    // under-way plan and a re-plan could not land. Absent, every line below is as it was.
    underWay?: boolean },
  now = new Date(),
  // Issue 2592: the inputs `prescriptionFigures` costs a row with. Present, a deload or revert that
  // moves a row's numbers re-costs the two whole-session figures through that one function; absent
  // (the cheap path), the output is exactly what it was.
  figureSignals?: FigureSignals,
): ReevaluationResult {
  // The 7-day window in the comment above was documented intent and nothing enforced it (Q-229):
  // `prescriptionExpiresAt` was written at generation and then only ever read to suppress
  // re-offering a still-pending emergency deload — never to age out a prescription the lifter is
  // actually training against. So a session type left unused for longer than its own window kept
  // replaying its last AI-computed pct/sets/reps until an unrelated emergency or soreness signal
  // happened to fire. The owner hit it on 2026-08-14: an 8-day-old deload-era 52% served on a live
  // Intensification day.
  //
  // BF-179 — this is a DENY-list on purpose, and it used to be an allow-list naming
  // `auto_applied`/`accepted`/`consumed`. `dismissed` was in neither that set nor the `pending`
  // carve-out, so a dismissed prescription never aged out: `needsRegenerate` never fired and
  // `workout-data/route.ts` took the else-branch, which RE-STAMPS the stale prescription and writes
  // it back. The expired offer was not merely tolerated, it was refreshed. Measured in production
  // 2026-09-20: a `dismissed` row that had expired three days earlier still carried
  // `phaseAction: 'deload_recommended'` and was still setting every working set to 52%.
  //
  // That is Q-229 returning through a status its fix did not name — which is the whole argument for
  // the shape. An allow-list is wrong here by construction: the next status added to
  // `PrescriptionStatus` joins `dismissed` as a silent gap, and nothing fails. A deny-list ages out
  // by default and a new status has to argue for its exemption.
  //
  // The one exemption: `none` means there is no offer to age out at all, so regenerating on it would
  // be a loop with nothing to show for it. `pending` used to be exempt too, as an offer whose expiry
  // the emergency-deload suppression below owned. That suppression only reads an UNEXPIRED pending
  // deload, so ageing an expired offer out cannot race it, and the exemption left every expired offer
  // in place: a week-old rest day (#3700) and a pending stay, which drives load (#3714).
  const underWay = state.underWay === true
  if (!underWay && prescriptionAgedOut(state, now)) {
    return { prescription, changed: false, needsRegenerate: true }
  }
  if (!underWay && deloadEndDue(prescription, state, state.programDeload)) {
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
  const emergency = shouldTriggerEmergencyDeload(emergencySignals, state, now)
  if (emergency && !underWay) {
    return { prescription, changed: false, needsRegenerate: true }
  }

  const perEx = computePerExerciseDeload(
    signals.exercises,
    signals.soreMusclesInSession,
    signals.trainingGoal,
    state.phase,
    signals.recentlyTrainedMusclesInSession ?? [],
  )

  if (perEx.outcome === 'whole_session' && !underWay) {
    return { prescription, changed: false, needsRegenerate: true }
  }

  const illnessDeload = signals.illnessFlag === 'elevated' || signals.illnessFlag === 'fever'
  const nowDeloadedIds = perEx.outcome === 'per_exercise' ? new Set(perEx.deloadedIds) : new Set<string>()
  const notes: Record<string, string> = { ...perEx.notes }
  // Under way, the re-plan a signal calls for cannot land, so every row is lightened (the per-exercise
  // deload, applied to the whole session) with the reason the re-plan would have given.
  if (underWay && (emergency || perEx.outcome === 'whole_session')) {
    // The reason shown is the one that fired: the emergency trigger's own note (illness, or several
    // sore muscles after a recent session), never "unwell" for a session lightened for soreness.
    const emergencyNote = emergency ? emergencyDeloadTrigger(emergencySignals)?.note : undefined
    const soreNote = perEx.outcome === 'whole_session' && perEx.matchedMuscles.length > 0
      ? `Deload — ${perEx.matchedMuscles.map(m => m.toLowerCase()).join(' & ')} still sore`
      : undefined
    const wholeNote = soreNote ?? emergencyNote ?? 'Deload — several muscles are sore'
    for (const ex of signals.exercises) {
      nowDeloadedIds.add(ex.sessionExerciseId)
      if (!notes[ex.sessionExerciseId]) notes[ex.sessionExerciseId] = wholeNote
    }
  }
  if (illnessDeload) {
    for (const ex of signals.exercises) {
      nowDeloadedIds.add(ex.sessionExerciseId)
      // Soreness notes are more specific — keep them where both apply.
      if (!notes[ex.sessionExerciseId]) notes[ex.sessionExerciseId] = `Deload — illness radar: ${signals.illnessFlag}`
    }
  }
  // #2402. Only a row THIS function deloaded may be put back by it. A whole-session deload
  // (BF-198) and a deload PHASE (the rules fallback, #2512) record `deloaded` + `preDeload` on every
  // row too, but nothing here flags those rows, so "not flagged now" read as "soreness cleared" and
  // the first read of the day turned a stored 2×6 @ 50% back into the program as written. The bar
  // kept deloading while the card described the full session. `Full` is the way back for those.
  const deloadIsPrescribed = prescription.deload === true || state.phase === 'deload'
  // #3713: a revert puts back the recorded full numbers, capped to the phase the plan's loads were
  // written for. A plan stored before the cap reached `preDeload` recorded the model's raw count.
  // The cap is for a count the MODEL chose. A rules plan (the model was unavailable, #2110) carries the
  // program's own set counts, which the engine does not cap anywhere else, so reverting a deload must
  // give them back as written. Only `source: 'rules'` is recorded: a model plan has no source, so a plan
  // with none keeps the cap, as before.
  const revertSetsCap = prescription.source === 'rules'
    ? Infinity
    : phaseSetsMax(signals.trainingGoal, phaseOfLoads(prescription, state.phase)) ?? Infinity
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
    if (!isDeloaded && wasDeloaded && ex.preDeload && !deloadIsPrescribed) {
      changed = true
      return {
        ...ex,
        sets: Math.min(ex.preDeload.sets, revertSetsCap),
        reps: ex.preDeload.reps,
        pct: ex.preDeload.pct,
        restSec: ex.preDeload.restSec,
        deloaded: false,
        deloadNote: undefined,
        preDeload: undefined,
        // #4126: a record of the model's own numbers belongs to the deload this row has just left; kept, a later
        // phase change could restore it over the full-load numbers put back here.
        preSoreness: undefined,
        // #3764: a plan deloaded for an untouched suggestion goes back to full load and says why.
        ...(perEx.recentNotes[ex.sessionExerciseId] && !ex.autoregNote?.includes(RECENTLY_TRAINED_NOTE_PREFIX) && {
          autoregNote: [ex.autoregNote, perEx.recentNotes[ex.sessionExerciseId]].filter(Boolean).join(' · '),
        }),
      }
    }
    if (!isDeloaded && wasDeloaded && ex.modelDeload && ex.preSoreness) {
      // #4126: the signal that lightened this model-written row has cleared: its own numbers and note go
      // back, exactly as the model wrote them (`preDeload` is untouched: it is what `Full` restores).
      const { preSoreness, ...rest } = ex
      const { deloadNote: wroteNote, ...numbers } = preSoreness
      changed = true
      const restored: AiPrescriptionExercise = { ...rest, ...numbers }
      if (wroteNote === undefined) delete restored.deloadNote
      else restored.deloadNote = wroteNote
      return restored
    }
    if (isDeloaded && wasDeloaded && ex.modelDeload) {
      // #4087: a row deloaded because the MODEL wrote the deload (not by this function) still answers a
      // soreness or illness signal as it did before the model's deload was flagged: it takes the
      // per-exercise override, and is never heavier than that. Per field the lighter: the fewer sets and
      // the lower bar, with the override's reps and rest. `preDeload` stays the program's numbers.
      const next = {
        sets: Math.min(ex.sets, perEx.override.sets),
        reps: perEx.override.reps,
        pct: Math.min(ex.pct, perEx.override.pct),
        restSec: perEx.override.restSec,
      }
      const note = notes[ex.sessionExerciseId]
      if (next.sets !== ex.sets || next.reps !== ex.reps || next.pct !== ex.pct || next.restSec !== ex.restSec
        || (note && note !== ex.deloadNote)) {
        changed = true
        // #4126: what the row was before the first lightening, kept so the clear can put it back.
        const before = ex.preSoreness ?? { sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.restSec, deloadNote: ex.deloadNote }
        return { ...ex, ...next, preSoreness: before, ...(note && { deloadNote: note }) }
      }
      return ex
    }
    if (isDeloaded && wasDeloaded) {
      // Still sore — refresh the note (matched muscle labels can shift day to day).
      const note = notes[ex.sessionExerciseId]
      if (note && note !== ex.deloadNote) {
        changed = true
        return { ...ex, deloadNote: note }
      }
    }
    // #3764: an exercise at normal load whose main muscle is an untouched suggestion says so, whichever
    // path built the plan (the model, the rules fallback, or an older plan). A note only: no numbers move.
    const recent = perEx.recentNotes[ex.sessionExerciseId]
    if (!isDeloaded && !ex.deloaded && recent && !ex.autoregNote?.includes(RECENTLY_TRAINED_NOTE_PREFIX)) {
      changed = true
      return { ...ex, autoregNote: [ex.autoregNote, recent].filter(Boolean).join(' · ') }
    }
    return ex
  })

  const moved = changed ? { ...prescription, exercises } : prescription
  const recosted = changed && figureSignals && rowNumbersMoved(prescription.exercises, exercises)
    ? recostPrescription(moved, figureSignals)
    : moved

  return {
    prescription: recosted,
    changed,
    needsRegenerate: false,
  }
}
