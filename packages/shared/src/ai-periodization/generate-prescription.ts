import { isBusyError } from '@trainingai/shared/errors'
import { nextMidnightInTz, startOfWeekInTz, todayInTz } from '@trainingai/shared/date-utils'
import { prescriptionExpiresAt } from '@trainingai/shared/ai-periodization/prescription-expiry'

/**
 * How long a rules fallback plan is held (LB-165).
 *
 * Long enough to cover the session the lifter is about to do, short enough that one provider
 * blip is not a day of uninformed plans — the seven-day hold a normal `storePrescription` takes
 * is the thing RV-202 was right to refuse. Expressed as a duration rather than a local-day
 * boundary deliberately: a day boundary needs calendar arithmetic and a timezone, and neither
 * buys anything here over "a few hours from now".
 */
const RULES_PRESCRIPTION_TTL_MS = 6 * 60 * 60 * 1000
import { aggregateSignals } from '@trainingai/shared/ai-periodization/signals'
import { buildSystemPrompt, buildUserPrompt, intensityZoneForRole } from '@trainingai/shared/ai-periodization/prompt'
import { settleAccessory } from '@trainingai/shared/ai-periodization/goal-ranges'
import { pctForExpectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'
import {
  applyDeloadFloor,
  canAutoApplyTransition,
  deloadExitPhase,
  isDeloadPlan,
  typeDeloadFinished,
} from '@trainingai/shared/ai-periodization/phase-guards'
import { fitToBudget } from '@trainingai/shared/ai-periodization/time-budget'
import { applyBudgetStage, reasoningWithBudgetNote } from '@trainingai/shared/ai-periodization/budget-stage'
import { prescriptionFigures, rowUnderFull, hasFullSessionRevert } from '@trainingai/shared/ai-periodization/prescription-figures'
import { capLoadToAnchor } from '@trainingai/shared/ai-periodization/role-plausibility'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import { budgetForPreset, requestedBudgetMin, fitBudgetMin, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import { applyAutoregulation, clampPrescribedPct } from '@trainingai/shared/ai-periodization/autoregulation'
import { shouldTriggerEmergencyDeload, emergencyDeloadTrigger } from '@trainingai/shared/ai-periodization/emergency-deload'
import { holdsOneDayDeload } from '@trainingai/shared/ai-periodization/one-day-deload'
import { computePerExerciseDeload } from '@trainingai/shared/ai-periodization/per-exercise-deload'
import { buildTransitionRationale } from '@trainingai/shared/ai-periodization/transition-rationale'
import { syncProgramPhase, applyProgramPhaseCap, programMoveTarget, collectVotes, programDeloadFinished, NEXT_PROGRAM_PHASE } from '@trainingai/shared/ai-periodization/program-phase'
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_SETS, DELOAD_REST } from '@trainingai/shared/ai-periodization/deload-constants'
import { generateObject } from 'ai'
import { loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import { PrescriptionSchema } from '@trainingai/shared/ai-periodization/prescription-schema'
import { reconcilePrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import { buildPrescriptionShadow } from '@trainingai/shared/ai-periodization/prescription-shadow'
import { loadSessionReads } from '@trainingai/shared/ai-periodization/session-read-plan'
import { checkinBudgetApplies } from '@trainingai/shared/ai-periodization/checkin-plan-budget'
import { loadLiftPreferences } from '@trainingai/shared/ai-periodization/lift-preference-read'
import { holdPlanRows } from '@trainingai/shared/ai-periodization/checkin-plan-hold'
import { clampReps, preferenceAppliesIn, appliedAfterBudgetRest } from '@trainingai/shared/ai-periodization/lift-preference'
import {
  applyLiftPreferenceToPlanRow, applyPlanSetsDelta, mergeApplied, secondaryTargetRpe,
} from '@trainingai/shared/ai-periodization/lift-preference-plan'
import type { AppliedLiftPreference } from '@trainingai/shared/types/ai-periodization'
import type { AiPrescription, AiPrescriptionExercise, PeriodizationPhase, PrescriptionGeneratedFor } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { createDedupCache } from '@trainingai/shared/ai-periodization/generation-dedup'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'

function liftPreferenceField(applied: AppliedLiftPreference | undefined): { liftPreference?: AppliedLiftPreference } {
  return applied ? { liftPreference: applied } : {}
}

export type GeneratePrescriptionResult =
  | {
      ok: true
      prescription: AiPrescription
      prescriptionStatus: 'pending' | 'auto_applied' | 'accepted'
      estimatedSessionDurationMin: number
    }
  | { ok: false; error: string; status: number }

// ── Generation dedup (B3) ───────────────────────────────────────────────────────
// Opening a workout fires /prescribe from TWO paths within ~1s (the client in
// workout-screen.tsx AND workout-data's server-side fire-and-forget), and each AI
// generation takes ~2.6s — so without this the same (user, session, day) prescription
// is generated 2-3× per open (confirmed via the ai_call_log double-trip panel:
// prescription was the #1 token spender AND the worst double-trip). The dedup collapses
// concurrent calls (in-flight) and near-simultaneous repeats (a 30s read-through
// cooldown). Per-process (per Railway replica), so the two open-time triggers landing on
// different replicas miss it; `runPrescriptionGeneration` carries a stored-row twin for that
// (RV-184). Signals don't change within the window, so the reused result is identical to a re-run.
const JUST_GENERATED_MS = 30_000
const prescriptionDedup = createDedupCache<GeneratePrescriptionResult>(JUST_GENERATED_MS)

// Whole-session deload construction shared by the emergency-deload path and the
// per-exercise deload's >50%-soreness escalation (see
// docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md) — "deloaded"
// means the same numbers regardless of which trigger fired.
export function buildWholeSessionDeloadPrescription(
  signals: PrescriptionSignals,
  reasoning: string,
  // #2405: what fired the deload, stamped on every row so the sheet can say it. Absent, the row
  // carries no note rather than an invented one.
  deloadNote?: string,
): AiPrescription {
  const goal = signals.trainingGoal
  // BF-198: what `Full` reverts to. The per-exercise deload records the numbers it replaced as
  // `preDeload` (reevaluate.ts); this builder recorded nothing, so on a whole-session deload the
  // `Full` toggle had nothing to restore and every set was still logged as a deload, earning no
  // 1RM. There are no model numbers to keep here, so the full session is the program's own — the
  // same plan the rules prescriber builds. An exercise with no base style gets none, and stays
  // deloaded under `Full`, which is also what the per-exercise path does without a record.
  const fullById = new Map(
    (buildProgramAsWrittenPrescription(signals, reasoning)?.exercises ?? [])
      .map(e => [e.sessionExerciseId, { sets: e.sets, reps: e.reps, pct: e.pct, restSec: e.restSec }]),
  )
  const pct = DELOAD_LOWER_PCT[goal] ?? 50
  const reps = DELOAD_REPS[goal] ?? 8

  const fittedDeload = new Map(
    fitToBudget(
      signals.exercises.map(ex => ({
        sessionExerciseId: ex.sessionExerciseId,
        role: ex.role,
        sets: DELOAD_SETS,
        reps,
        restSec: DELOAD_REST,
        transitionSec: ex.transitionSec,
        measuredSecPerRep: ex.timeProfile?.secPerRep ?? null,
        measuredRestSec: ex.timeProfile ? resolveMeasuredRestSec(ex.timeProfile, pct) : null,
      })),
      fitBudgetMin(signals),
    ).map(f => [f.sessionExerciseId, f.sets]),
  )

  const exercises: AiPrescriptionExercise[] = signals.exercises.map(ex => ({
    sessionExerciseId: ex.sessionExerciseId,
    name: ex.name,
    sets: fittedDeload.get(ex.sessionExerciseId) ?? DELOAD_SETS,
    reps,
    pct,
    restSec: DELOAD_REST,
    // Whole-session deloads previously left `deloaded` unset per exercise, so every
    // downstream consumer keyed on it — 1RM estimation, the client's PR-flash gate, the
    // server's shouldCountTowardPr gate — treated these sets as genuine max-effort work.
    // Stamping it here gives every consumer one consistent signal instead of two (Q-115).
    deloaded: true,
    ...(deloadNote ? { deloadNote } : {}),
    preDeload: fullById.get(ex.sessionExerciseId),
  }))

  const { estimatedSessionDurationMin, weeklyVolumeContribution } = prescriptionFigures(exercises, signals)

  return {
    phase: 'deload',
    phaseAction: 'deload_recommended',
    exercises,
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    // #2403: what Full trains — the program's own numbers wherever one was recorded.
    ...(hasFullSessionRevert(exercises) && {
      fullSession: prescriptionFigures(exercises.map(rowUnderFull), signals),
    }),
    deload: true,
    reasoning,
    confidence: 1.0,
  }
}

/**
 * The program's own numbers, fitted to today's time budget — what to prescribe when the model
 * call fails (RV-202).
 *
 * **Deliberately NOT `buildWholeSessionDeloadPrescription`.** That builder was the only
 * deterministic plan this layer had, and reaching for it on a model failure would prescribe a
 * DELOAD to everyone whose Gemini call timed out: a training decision, made by an outage. This
 * one prescribes what the lifter's own program already says, which is the honest degraded
 * answer — the same numbers they would get with the AI turned off.
 *
 * What the model would have added and this cannot: phase transitions, RPE autoregulation, and
 * per-exercise deloads. So `phaseAction` stays `'stay'`, `deload` is false, and `confidence` is
 * deliberately low rather than 1.0 — the plan is sound but uninformed, and the card's
 * low-confidence path should treat it that way.
 *
 * An exercise with no `baseSets` (no style, or an empty one) is SKIPPED rather than given an
 * invented number. A prescription that quietly fabricates a load is worse than a shorter one.
 */
export function buildRulesPrescription(
  signals: PrescriptionSignals,
  reasoning: string,
): AiPrescription | null {
  const asWritten = buildProgramAsWrittenPrescription(signals, reasoning)
  // #2402. The phase is already a deload (accepted earlier), and the bar deloads every exercise in
  // it and logs every set as one. The program as written would put numbers and an Intensity toggle
  // ("Full · As prescribed") on the card for a session that never runs. This is the OPPOSITE of the
  // trap above: an outage still never CREATES a deload, but where the phase already is one the
  // fallback has to say so. Nothing to build from stays null, so the caller's error path is kept.
  if (asWritten && signals.phase === 'deload') {
    return {
      ...buildWholeSessionDeloadPrescription(signals, reasoning),
      // The phase is already a deload, so there is nothing to recommend: `deload_recommended` marks
      // a one-day offer to accept (#3799), and this is the planned week itself.
      phaseAction: 'stay',
      confidence: asWritten.confidence,
      sessionTimeBudgetMinutes: signals.sessionTimeBudgetMinutes,
      confidenceReasons: ['Your deload week as the program runs it \u2014 the AI coach could not be reached.'],
      source: 'rules',
    }
  }
  return asWritten
}

/**
 * The program's own numbers for every phase, fitted to today's time budget. `buildRulesPrescription`
 * wraps this and swaps in the deload where the phase already is one; the whole-session deload
 * builder reads THIS for what `Full` reverts to, so the two cannot call each other forever.
 */
export function buildProgramAsWrittenPrescription(
  signals: PrescriptionSignals,
  reasoning: string,
): AiPrescription | null {
  const withBase = signals.exercises.filter(ex => ex.baseSets.length > 0)
  // Nothing to build from: every exercise is style-less. The caller keeps its error path.
  if (withBase.length === 0) return null

  // One row per exercise, from its own style. `pct`/`reps`/`restSec` come from the FIRST set —
  // the prescription shape is one triple per exercise, not per set, so a style whose sets differ
  // is represented by its opening set, which is the one the lifter warms into.
  const asWritten = withBase.map(ex => ({
    ex,
    sets: ex.baseSets.length,
    reps: ex.baseSets[0].reps,
    pct: ex.baseSets[0].pct,
    restSec: ex.baseSets[0].restSec,
  }))
  // #3896: a lift's preference holds here too, so a failed model call honours it. Reps are clamped
  // into the range and the load derived the same way as after the model (D3, D4). Not in a deload or
  // baseline phase: the deload builder reads this for what `Full` reverts to, and a deload's own rows
  // never carry a preference.
  const preferencesApply = preferenceAppliesIn({ deload: signals.phase === 'deload', baseline: signals.phase === 'baseline' })
  const appliedById = new Map<string, AppliedLiftPreference>()
  const planned = asWritten.map(p => {
    const lp = preferencesApply ? p.ex.liftPreference : undefined
    if (!lp) return p
    const { row, applied } = applyLiftPreferenceToPlanRow(p, lp.preference, {
      trainingGoal: signals.trainingGoal, phase: signals.phase, role: p.ex.role,
      bodyweight: p.ex.exerciseType === 'bodyweight', basisKg: lp.basisKg, equipment: p.ex.equipment,
    })
    if (Object.keys(applied).length > 0) appliedById.set(p.ex.sessionExerciseId, applied)
    return row
  })
  // #3890: the week's check-in hold, as after the model: a ceiling on a held lift's bar, last on the load.
  const held = holdPlanRows(
    planned.map(p => ({ id: p.ex.sessionExerciseId, pct: p.pct })),
    id => {
      const ex = withBase.find(e => e.sessionExerciseId === id)
      const lp = preferencesApply ? ex?.liftPreference : undefined
      return lp && ex ? { preference: lp.preference, basisKg: lp.basisKg, equipment: ex.equipment, bodyweight: ex.exerciseType === 'bodyweight' } : undefined
    },
  )
  for (const p of planned) p.pct = held.pct.get(p.ex.sessionExerciseId) ?? p.pct

  const fitted = new Map(
    fitToBudget(
      planned.map(p => ({
        sessionExerciseId: p.ex.sessionExerciseId,
        role: p.ex.role,
        sets: p.sets,
        reps: p.reps,
        restSec: p.restSec,
        transitionSec: p.ex.transitionSec,
        measuredSecPerRep: p.ex.timeProfile?.secPerRep ?? null,
        measuredRestSec: p.ex.timeProfile ? resolveMeasuredRestSec(p.ex.timeProfile, p.pct) : null,
      })),
      fitBudgetMin(signals),
    ).map(f => [f.sessionExerciseId, f.sets]),
  )

  const exercises: AiPrescriptionExercise[] = planned.map(p => {
    const fittedSets = fitted.get(p.ex.sessionExerciseId) ?? p.sets
    // #3896: the one-shot ±1 set goes on after the fit, so the trim cannot undo it.
    const withDelta = preferencesApply
      ? applyPlanSetsDelta(fittedSets, p.ex.liftPreference?.preference, { trainingGoal: signals.trainingGoal, phase: signals.phase, role: p.ex.role })
      : null
    const applied = withDelta != null
      ? mergeApplied(appliedById.get(p.ex.sessionExerciseId), {
          setsDelta: p.ex.liftPreference!.preference.oneShot!.setsDelta!,
          oneShotSetAt: p.ex.liftPreference!.preference.oneShot!.setAt.toISOString(),
        })
      : appliedById.get(p.ex.sessionExerciseId)
    return {
      sessionExerciseId: p.ex.sessionExerciseId,
      name: p.ex.name,
      sets: withDelta ?? fittedSets,
      reps: p.reps,
      pct: p.pct,
      restSec: p.restSec,
      ...(applied && { liftPreference: applied }),
    }
  })

  const { estimatedSessionDurationMin, weeklyVolumeContribution } = prescriptionFigures(exercises, signals)

  return {
    // The stored phase, unchanged: a rules plan never moves the lifter through periodization.
    // `signals.phase` is the persisted string, narrowed the same way the model's echo is at the
    // two sites below — periodization state is written by this engine, so the value is ours.
    phase: signals.phase as PeriodizationPhase,
    phaseAction: 'stay',
    exercises,
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    deload: false,
    reasoning,
    confidence: 0.3,
    sessionTimeBudgetMinutes: signals.sessionTimeBudgetMinutes,
    confidenceReasons: ['Built from your program\u2019s own sets — the AI coach could not be reached.'],
    source: 'rules',
    ...(held.record && { checkinHold: held.record }),
  }
}

// Core of the AI-periodization prescription generation, extracted from
// app/api/ai-periodization/session/[sessionId]/prescribe/route.ts so it can run
// in-process from two callers: the /prescribe route (client trigger / manual refresh)
// AND the workout-completion path (lib/workout/complete-workout.ts), which fires it at
// the END of a session so the next prescription is queued immediately instead of the
// session sitting in the chip-less 'consumed' gap until the next open. Purely server-side
// and request-free (auth + rate-limit stay in the route); the caller passes userId, the
// program session id, a repository, and the user's timezone.
// Public entry point — dedups concurrent/rapid-repeat generations for the same
// (user, session, day) before delegating to the real generation below (see the
// dedup notes above the maps). Keeps the same signature so callers are unchanged.
export async function generatePrescriptionForSession(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  excludeSessionId?: string,
  durationPreset?: DurationPreset,
): Promise<GeneratePrescriptionResult> {
  // excludeSessionId is part of the key: a completion-path result (which excludes the
  // just-finished session from the recency gap) is NOT interchangeable with an open-path
  // result, so only calls with identical semantics dedup together. The completion path
  // skips the read-through cooldown (it must always produce the NEXT prescription) but
  // still shares in-flight dedup.
  // durationPreset is in the key for the same reason — a 30-minute plan and a 90-minute
  // plan are different answers, and sharing a cached result would silently serve one for
  // the other within the 30s cooldown (the user switching presets is exactly that fast).
  // #3895 review: what the session is made of, read before anything the plan is built from. A Coach
  // change, its undo or an editor save while the plan is being made voids the slot, and the plan is
  // then not stored (`storePrescription` re-checks this in the same statement), so the session's next
  // read regenerates against the session as it is. Read before the dedup, so a call that joins a
  // running generation shares its stamp along with its result.
  // #3927: the stamp and the program the plan is built from come from one snapshot, and the signals
  // reuse that program rather than reading it again. Read apart, a Coach apply landing between them and
  // undone before the store left the stamp matching, so a plan made for the swapped session was stored.
  const { program: activeProgram, structure } = await repo.getActiveProgramWithStructureStamp(userId, programSessionId)
  const configuredBudget = activeProgram?.sessions.find(s => s.id === programSessionId)?.timeBudgetMinutes
  // #3890: a shorter session the weekly check-in asked for this week. Read before the dedup key, so a
  // plan made before the check-in was saved is not served for one made after it. Null for nearly
  // everyone, and then the key is exactly main's.
  const checkinBudgetMin = durationPreset == null ? await checkinSessionBudgetMin(repo, userId, tz) : null
  // #3927: the stamp is in the key, so a call after a Coach change or an editor save made inside the
  // 30 s cooldown generates for the session as it is now, rather than being answered with the plan made
  // before the change.
  const key = `${userId}:${programSessionId}:${todayInTz(tz)}:${excludeSessionId ?? ''}:${durationPreset ?? 'standard'}:${configuredBudget}:${structure}${checkinBudgetMin != null ? `:checkin${checkinBudgetMin}` : ''}`
  return prescriptionDedup.run(
    key,
    // An explicit preset choice is a user action asking for a different plan — it must
    // never be answered from the read-through cooldown.
    { skipCooldown: Boolean(excludeSessionId) || durationPreset != null, cacheable: r => r.ok },
    // #4082 review: a program move that gave up waiting for a person's other write (a check-in, a Coach
    // apply) wrote nothing: answered as "busy, try again", never cached (`cacheable` is ok only) and never
    // a 500. The move's lock is taken inside the repository call, after the model call has returned.
    () => runPrescriptionGeneration(userId, programSessionId, repo, tz, activeProgram, structure, excludeSessionId, durationPreset, checkinBudgetMin)
      .catch((err): GeneratePrescriptionResult => {
        if (isBusyError(err)) return { ok: false, error: err.message, status: 409 }
        throw err
      }),
  )
}

/**
 * #3890: the shorter session this week's check-in asked for (`applies_week_start` = this local Monday).
 * A failed read is the session's own budget: it is the person's choice, not a safety bound, and losing it
 * for one plan is the smaller harm than losing the plan.
 */
async function checkinSessionBudgetMin(repo: WorkoutRepository, userId: string, tz: string): Promise<number | null> {
  if (typeof repo.getCheckinSessionBudgetMin !== 'function') return null
  try {
    return await repo.getCheckinSessionBudgetMin(userId, startOfWeekInTz(tz))
  } catch (err) {
    console.error('[weekly-checkin] reading the session budget failed; planning at the session length:', err)
    return null
  }
}

async function runPrescriptionGeneration(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  activeProgram: Awaited<ReturnType<WorkoutRepository['getActiveProgram']>>,
  structure: string | null,
  // The workout session whose completion triggered this call (from complete-workout's
  // post-completion hook). Excluded from the hoursSinceLastSession gap only — it has
  // completedAt ≈ now by construction, which would otherwise spuriously satisfy the
  // emergency-deload <36h condition (W5 §4.2). Absent for manual/GET-style prescribe calls.
  excludeSessionId?: string,
  durationPreset?: DurationPreset,
  checkinBudgetMin?: number | null,
): Promise<GeneratePrescriptionResult> {
  // A one-day prescription ends at the midnight that closes the day it was asked for. Read from the
  // start, not the store: a generation that straddles midnight would otherwise live all of the next
  // day (#3716).
  const startedAt = new Date()
  const today = todayInTz(tz)

  // Validate the session belongs to the active program, then ensure it has a periodization
  // row — self-heal a valid-but-stateless session, matching the GET route (a valid session
  // with no state row previously 404'd here even though GET would create it). A genuinely
  // stale id (not in the active program) still 404s.
  const validSession = activeProgram?.sessions.find(s => s.id === programSessionId)
  if (!validSession || !activeProgram) return { ok: false, error: 'Not found', status: 404 }
  let state = await repo.ensureSessionPeriodization(userId, programSessionId)

  // Self-heal sessions_in_phase before it gates the phase-ceiling checks below
  // (SYNC-T2) — the counter was previously only reconciled at the
  // program-overview read site, so a drifted count (over-count on re-sync, no
  // decrement on delete, direct-edit inflation) could mis-gate auto-deload /
  // cycle progression here.
  //
  // #3766: the program's phase is read (and the switch-over run, when it is due) in the same step,
  // which reconciles first.
  let programPhase = await syncProgramPhase(repo, userId, activeProgram.id, tz)
  state = (await repo.getSessionPeriodization(userId, programSessionId)) ?? state
  // #3876 (owner, 19 Nov): a deload ends by itself after its two sessions, with no tap and whether or
  // not auto-apply is on. It used to wait for "Move to accumulation", which was easy to miss and cost
  // a week each time. The exit runs before planning, so the plan is made in the phase the type moves
  // to and its loads are that phase's.
  //  - While the program waits for its switch-over, the type's own deload ends (`typeDeloadFinished`).
  //    The switch-over date was stamped by the sync above, so leaving cannot lose it; the sync runs
  //    again because a type leaving its deload can make the switch-over due.
  //  - Once aligned, the deload is the program's and it ends at its cap (`programDeloadFinished`).
  //    `applyProgramPhaseCap` would only offer that move, ceiling-forced, so it waited for a tap and the
  //    owner's decision did not hold after the switch-over. Any other capped move still needs one.
  // Both exits move only the deload this call read: a racing generation that moved it first leaves
  // this one a no-op, and it plans in the phase that one moved to.
  if (typeDeloadFinished(state, programPhase.aligned)) {
    await repo.exitDeload(
      userId, programSessionId, deloadExitPhase(state.preEmergencyDeloadPhase, programPhase.phase), state.phaseStartedAt,
    )
    programPhase = await syncProgramPhase(repo, userId, activeProgram.id, tz)
    state = (await repo.getSessionPeriodization(userId, programSessionId)) ?? state
  } else if (programDeloadFinished(programPhase)) {
    await repo.advanceProgramPhase(
      userId, programSessionId, NEXT_PROGRAM_PHASE.deload, { phase: 'deload', phaseStartedAt: programPhase.phaseStartedAt! },
    )
    programPhase = await syncProgramPhase(repo, userId, activeProgram.id, tz)
    state = (await repo.getSessionPeriodization(userId, programSessionId)) ?? state
  }
  // The deload count this plan was made at, stored on it: `workout-data` regenerates a plan in a
  // finished deload only when it was made before the count got there (`deloadEndDue`), so a plan made
  // after this exit check does not ask for another generation on every read.
  // #3893: the session read of each exercise's last session, in shadow. It is stored beside the plan
  // and read by nothing that builds it; a failed read stores no read and the plan is unchanged.
  // #3896: the session's lift preferences, read once for the session read and the plan.
  // #3890: with this week's check-in hold ("Heavy") in the same read, for the week the plan is made in.
  const liftPreferences = await loadLiftPreferences(
    repo, userId, (validSession.exercises ?? []).map(e => e.exerciseName), { checkinWeekStart: startOfWeekInTz(tz) },
  )
  const sessionReads = await loadSessionReads(repo, userId, activeProgram, validSession, tz, liftPreferences).catch(() => null)
  const storePrescription = (p: AiPrescription, expiresAt: Date, status: 'pending' | 'auto_applied', storeFor: PrescriptionGeneratedFor) =>
    repo.storePrescription(userId, programSessionId, {
      ...p,
      ...(sessionReads && sessionReads.length > 0 ? { sessionReads } : {}),
      sessionsInPhaseAtPlan: state.sessionsInPhase,
      // An aligned program's deload ends at its cap, not the type's count: the same once-only stamp,
      // in the program's weeks.
      ...(programPhase.aligned && { programWeeksDoneAtPlan: programPhase.trainingWeeksDone }),
    }, expiresAt, status, storeFor)
  // #3766: the phase this plan is made in. A program move while it is being made (another session's
  // tap or auto-apply) voids this slot; the plan is then not stored (`storePrescription` checks the
  // slot is still in this phase and start), so the slot regenerates in the new phase.
  // #3895 review: and the session's structure as it was when this generation started.
  const generatedFor: PrescriptionGeneratedFor = { phase: state.phase, phaseStartedAt: state.phaseStartedAt, structure }

  if (state.phase === 'baseline' && !state.baselineComplete) {
    return { ok: false, error: 'Baseline not complete', status: 400 }
  }

  // RV-184. Opening a workout fires two plain generations: `workout-data`'s server-side one and
  // the client's POST. On different replicas they miss the per-process cooldown above.
  // Production 2026-09-15 has the pair: identical input, the second starting 5.4 s after the
  // first had finished, which a shared cache would have answered. The stored row is visible to
  // every replica, so a plain call (no preset, no completion exclusion: exactly the calls the
  // cooldown would have collapsed) returns a plan generated under 30 s ago instead of asking the
  // model again. Anything it cannot vouch for falls through to generation as before: a preset or
  // custom-length plan, or a slot already consumed or dismissed.
  const fresh = state.prescription
  if (
    fresh && excludeSessionId == null && durationPreset == null &&
    (fresh.sessionTimeBudgetMinutes != null
      ? fresh.sessionTimeBudgetMinutes === validSession.timeBudgetMinutes
      : validSession.timeBudgetMinutes > 0) &&
    (fresh.durationPreset == null || fresh.durationPreset === 'standard') &&
    (state.prescriptionStatus === 'pending' || state.prescriptionStatus === 'auto_applied') &&
    state.prescriptionGeneratedAt != null &&
    Date.now() - state.prescriptionGeneratedAt.getTime() < JUST_GENERATED_MS
  ) {
    return {
      ok: true,
      prescription: fresh,
      prescriptionStatus: state.prescriptionStatus,
      estimatedSessionDurationMin: fresh.estimatedSessionDurationMin,
    }
  }

  // BF-7 PR 2b — "is this the default?" is now a comparison, not a label test. `!== 'standard'` was
  // the same question while the only way to say "the session's own length" was that word; a number
  // equal to the anchor means it too, and must produce no override for the same reason. Reading the
  // REQUESTED budget (not the clamped one) keeps a session at `MIN_PRESET_BUDGET_MIN` honest — the
  // same trap PR 2a's `requestedBudgetMin` was split out for.
  const requestedMin = durationPreset != null
    ? requestedBudgetMin(validSession.timeBudgetMinutes, durationPreset)
    : undefined
  const presetOverrideMin = requestedMin != null && requestedMin !== validSession.timeBudgetMinutes
    ? budgetForPreset(validSession.timeBudgetMinutes, durationPreset)
    : undefined
  // #3890: the week's shorter session, only when it IS shorter than the session's own budget (or the
  // session has no limit), and only
  // when the person did not pick a length for today (a preset is the more recent, more specific ask; the
  // check-in read is skipped for it). Clamped as a numeric preset is (`budgetForPreset`), so it can never
  // ask for less than any preset can.
  const checkinFitMin = presetOverrideMin == null && checkinBudgetApplies(checkinBudgetMin, validSession.timeBudgetMinutes)
    ? checkinBudgetMin!
    : null
  const budgetOverrideMin = presetOverrideMin ?? (
    checkinFitMin != null ? budgetForPreset(validSession.timeBudgetMinutes, checkinFitMin) : undefined
  )
  const signals = await aggregateSignals(userId, programSessionId, repo, tz, excludeSessionId, budgetOverrideMin, { program: activeProgram, liftPreferences })
  if (!signals) return { ok: false, error: 'Could not aggregate signals', status: 404 }
  if (programPhase.aligned && programPhase.phase != null) {
    signals.programPhase = { trainingWeeksDone: programPhase.trainingWeeksDone, capWeeks: programPhase.capWeeks }
  }

  // If a one-day deload is already offered or accepted and unexpired, return it as-is rather than
  // regenerating — the trigger below is stateless and would otherwise re-fire on every
  // prescribe call, and an accepted one would come back as a fresh offer (#3799).
  const held = state.prescription
  if (held && holdsOneDayDeload(state)) {
    return {
      ok: true,
      prescription: held,
      prescriptionStatus: state.prescriptionStatus === 'accepted' ? 'accepted' : 'pending',
      estimatedSessionDurationMin: held.estimatedSessionDurationMin,
    }
  }

  // Emergency deload check — only for severe systemic overtraining.
  // Muscle-specific soreness and mild recovery issues are handled by the AI's
  // session_swap_recommended / rest_day_recommended phase_action in the normal path.
  const isEmergencyDeload = shouldTriggerEmergencyDeload(signals, state)

  if (isEmergencyDeload) {
    // #2405: said what it was. The reasoning used to read "overtraining signals" for a sick check-in.
    const trigger = emergencyDeloadTrigger(signals)
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      trigger ? `Emergency deload: ${trigger.reason}.` : 'Emergency deload triggered.',
      trigger?.note,
    )
    // Offered, not imposed: only stores the prescription. Persisted phase state and
    // sessions_in_phase stay untouched, and accepting it lightens this session only (#3799).
    // #3700: a deload fired by the lifter's own sick report answers today only, so it ends at the
    // next local midnight and the next open asks again. The other triggers describe the block and
    // keep the week.
    const expiresAt = prescriptionExpiresAt(prescription, tz, startedAt, { illnessTriggered: trigger?.kind === 'illness' })
    if (await storePrescription(prescription, expiresAt, 'pending', generatedFor) === false) return PHASE_MOVED

    return {
      ok: true,
      prescription,
      prescriptionStatus: 'pending',
      estimatedSessionDurationMin: prescription.estimatedSessionDurationMin,
    }
  }

  // Per-exercise deload — deterministic soreness handling (see
  // docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md).
  // Runs after the emergency check: a systemic emergency outranks soreness.
  const perExDeload = computePerExerciseDeload(
    signals.exercises.map(e => ({
      sessionExerciseId: e.sessionExerciseId,
      name: e.name,
      muscleAssignments: e.muscleAssignments,
    })),
    signals.soreMusclesInSession,
    signals.trainingGoal,
    state.phase,
    signals.recentlyTrainedMusclesInSession,
  )

  if (perExDeload.outcome === 'whole_session') {
    const muscles = perExDeload.matchedMuscles.join(', ')
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      `Most of this session's muscles are still sore (${muscles}) — a lighter full-session deload will serve recovery better than training through it.`,
      `Deload — most of this session's muscles are still sore (${muscles})`,
    )
    // Soreness is a per-day signal — expire at the next local midnight so a clean check-in
    // gets a fresh decision. It was `now + 24h`, which kept an evening deload alive through the
    // next day's morning check-in (#3700).
    const expiresAt = nextMidnightInTz(tz, startedAt)
    if (await storePrescription(prescription, expiresAt, 'pending', generatedFor) === false) return PHASE_MOVED
    return {
      ok: true,
      prescription,
      prescriptionStatus: 'pending',
      estimatedSessionDurationMin: prescription.estimatedSessionDurationMin,
    }
  }

  const deloadedIds = perExDeload.outcome === 'per_exercise' ? perExDeload.deloadedIds : new Set<string>()

  // Normal AI prescription
  const systemPrompt = buildSystemPrompt(signals.trainingGoal)
  const deloadedNames = signals.exercises
    .filter(e => deloadedIds.has(e.sessionExerciseId))
    .map(e => e.name)
  const userPrompt = buildUserPrompt(signals, state, today, deloadedNames.length > 0 ? deloadedNames : undefined)

  let parsed: z.infer<typeof PrescriptionSchema>
  try {
    const result = await loggedGenerateObject(
      { section: 'prescription', userId, fingerprint: { programSessionId, today } },
      (signal, settings) => generateObject({
        ...settings,
        schema: PrescriptionSchema,
        system: systemPrompt,
        prompt: userPrompt,
        abortSignal: signal,
      }),
    )
    parsed = result.object
  } catch (err) {
    console.error('Gemini prescription generation failed:', err)
    // RV-202 — answer with the program's own numbers rather than 502.
    //
    // The 502 was not a quiet failure: the client ignores the non-ok response and polls
    // `PRESCRIPTION_POLL_MAX = 10` times at 3 s, so the lifter watched "Preparing your AI
    // workout…" for about thirty seconds and then got the base program anyway. This arrives at
    // the same numbers immediately.
    //
    // **Persisted, with a SHORT expiry — and the comment here used to say the opposite.**
    //
    // RV-202 left this unstored, reasoning that `storePrescription` holds a plan for seven days
    // so the model would get no further attempt until it expired. That reasoning is still right
    // about seven days, and the conclusion it reached was wrong, because it assumed the returned
    // plan reached someone: *"this plan is only what today's caller is handed"*. LB-165 measured
    // the caller. `workout-data` fires this generation as a background single-flight and never
    // reads its result; both `/prescribe` clients check `res.ok` and refetch. Nothing painted it.
    // And `isAiPrescriptionPending` keys on `prescriptionStatus === 'consumed'`, which only
    // `storePrescription` clears — so not storing also left the screen saying "Preparing your AI
    // workout…" forever. The lifter's experience was unchanged by RV-202: the same ten 3 s polls
    // and the same amber banner.
    //
    // Storing it is what makes it visible, and the seven-day objection is answered by the expiry
    // rather than by refusing to store: `RULES_PRESCRIPTION_TTL_MS` covers the session in front of
    // the lifter and lets the model be tried again the same day. `reevaluate` re-generates once
    // `prescriptionExpiresAt` passes, and `workout-data` serves a stored plan without checking
    // expiry, so the short TTL costs nothing on the read side.
    const rules = buildRulesPrescription(
      signals,
      // #2402: in a deload phase the plan IS the deload, and "your program as written" would
      // contradict its own numbers.
      state.phase === 'deload'
        ? 'Your AI coach could not be reached, so this is your deload week as the program runs it.'
        : 'Your AI coach could not be reached, so this is your program as written.',
    )
    if (rules) {
      const stored = await storePrescription(rules, new Date(Date.now() + RULES_PRESCRIPTION_TTL_MS), 'pending', generatedFor)
      if (stored === false) return PHASE_MOVED
      return {
        ok: true,
        prescription: rules,
        prescriptionStatus: 'pending',
        estimatedSessionDurationMin: rules.estimatedSessionDurationMin,
      }
    }
    // No exercise in the session carries a progression style, so there are no numbers to fall
    // back to. The old error is still the honest answer here.
    return { ok: false, error: 'AI generation failed', status: 502 }
  }

  // BF-199 Phase 1: the model's own phase answer, before reconciliation rewrites `parsed`.
  const modelPhase = String(parsed.phase)
  const modelPhaseAction = String(parsed.phase_action)

  // #3766: the phase belongs to the program, and this answer is one session type's vote. The move
  // stands only when at least half of the session types trained this week agree (each with its answer
  // for the session it trained) and none asks to stay for a recovery reason; otherwise it is a stay,
  // settled HERE so the loads below are clamped to the phase the program is actually in. This answer
  // joins the vote once this type has trained this week. A program still waiting for its switch-over
  // moves nothing.
  const votedMove = parsed.phase_action === 'transition_recommended' && parsed.phase !== state.phase
  let programMove: PeriodizationPhase | null = null
  if (programPhase.aligned && programPhase.phase != null) {
    const answers = await repo.listModelPhaseAnswers(userId, [...programPhase.trainedThisWeek], state.phaseStartedAt)
    programMove = programMoveTarget(collectVotes(programPhase, answers), state.phase)
  }
  if (votedMove && programMove !== parsed.phase) {
    parsed.phase_action = 'stay'
    parsed.phase = state.phase as typeof parsed.phase
    parsed.reasoning = `${parsed.reasoning} The phase belongs to the whole program: it moves when at least half of this week's session types agree, so this session stays in ${state.phase} for now.`.trim()
  }
  // OR-209. And its per-exercise numbers, copied now because the loop below overwrites
  // `parsed.exercises` in place. This is the only moment the raw answer exists.
  const modelExercises = parsed.exercises.map(ex => ({
    sessionExerciseId: ex.session_exercise_id, sets: ex.sets, reps: ex.reps, pct: ex.pct, restSec: ex.rest_sec,
  }))

  // Single post-parse reconciliation pass — resolves the phase for a "stay" response,
  // normalizes ambiguous pct fractions, drops hallucinated ids, de-dupes, backfills any
  // model-omitted exercise, and applies the deterministic per-exercise deload override by
  // id (not by iterating the model's echo). See
  // docs/superpowers/plans/2026-07-05-ai-prescription-response-reconciliation.md.
  const reconciled = reconcilePrescription({
    modelPhase: parsed.phase as PeriodizationPhase,
    phaseAction: parsed.phase_action,
    currentPhase: state.phase,
    modelExercises: parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
    })),
    signalExercises: signals.exercises.map(e => ({
      sessionExerciseId: e.sessionExerciseId,
      name: e.name,
      role: e.role,
    })),
    trainingGoal: signals.trainingGoal,
    deloadedIds,
    deloadOverride: perExDeload.override,
  })
  if (reconciled.droppedIds.length > 0) {
    console.warn('[prescribe] dropped hallucinated session_exercise_id(s):', reconciled.droppedIds)
  }
  if (reconciled.backfilledIds.length > 0) {
    console.warn('[prescribe] backfilled model-omitted session_exercise_id(s):', reconciled.backfilledIds)
  }
  // reconciled.phase is typed as the app-wide PeriodizationPhase (includes 'baseline'),
  // but parsed.phase is the AI schema's narrower enum (no 'baseline' — the route already
  // 400s before this point if state.phase === 'baseline' && !baselineComplete, so a
  // 'baseline' value can't actually reach here).
  parsed.phase = reconciled.phase as typeof parsed.phase
  // A no-op transition (target phase === current phase) is downgraded to 'stay' by
  // resolvePhaseAction — persist the resolved action, never the model's raw one.
  parsed.phase_action = reconciled.phaseAction as typeof parsed.phase_action
  parsed.exercises = reconciled.exercises.map(ex => ({
    session_exercise_id: ex.sessionExerciseId,
    name: ex.name,
    sets: ex.sets,
    reps: ex.reps,
    pct: ex.pct,
    rest_sec: ex.restSec,
  }))
  const preDeloadById = reconciled.preDeloadById

  // #3896: a lift's stored preference, enforced after the model. Nothing the model said gates it; the
  // prompt only told it the range. Not in a deload or a baseline (design §3a), and never on a row the
  // per-exercise deload cut. The reps are clamped into the range before autoregulation, which then
  // judges the lift against the range rather than the goal's band, so it cannot climb back out of it.
  const preferencesApply = preferenceAppliesIn({
    deload: isDeloadPlan(state.phase, parsed.phase_action) || parsed.phase === 'deload',
    baseline: state.phase === 'baseline',
  })
  const signalById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  const preferenceFor = (id: string) =>
    preferencesApply && !deloadedIds.has(id) ? signalById.get(id)?.liftPreference : undefined
  for (const ex of parsed.exercises) {
    const range = preferenceFor(ex.session_exercise_id)?.preference.repRange
    if (range) ex.reps = clampReps(ex.reps, range)
  }
  const appliedById = new Map<string, AppliedLiftPreference>()

  // RPE-based autoregulation — adjust each exercise by the RPE × 1RM quadrant (back off a
  // regressing hard lift, push an easy progressing one). Runs before the time budget so an
  // earned set can steal time from lower-value work rather than overrun the session.
  const autoreg = applyAutoregulation(
    parsed.exercises
      .filter(ex => !deloadedIds.has(ex.session_exercise_id))
      .map(ex => ({
        sessionExerciseId: ex.session_exercise_id,
        sets: ex.sets,
        reps: ex.reps,
        pct: ex.pct,
      })),
    signals.exercises
      .filter(e => !deloadedIds.has(e.sessionExerciseId))
      .map(e => ({
        sessionExerciseId: e.sessionExerciseId,
        role: e.role,
        rpeDelta: e.rpeDelta,
        rm1Trend: e.rm1Trend,
        repCompletionRate: e.repCompletionRate,
        // #4061: the delta came from the lifter's tap, so a cut's note says "felt harder", not "RPE".
        ...(e.effortAnswer !== undefined && { effortFromAnswer: true as const }),
        // #4079: Harder or Easier only; a tapped As expected is no signal and earns no note.
        ...((e.effortAnswer === 1 || e.effortAnswer === -1) && { effortAnswer: e.effortAnswer }),
        ...(preferenceFor(e.sessionExerciseId)?.preference.repRange && {
          repBand: {
            repMin: preferenceFor(e.sessionExerciseId)!.preference.repRange!.min,
            repMax: preferenceFor(e.sessionExerciseId)!.preference.repRange!.max,
          },
        }),
      })),
    signals.trainingGoal,
    parsed.phase,
  )
  const autoregById = new Map(autoreg.exercises.map(a => [a.sessionExerciseId, a]))
  const roleById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e.role]))
  for (const ex of parsed.exercises) {
    const a = autoregById.get(ex.session_exercise_id)
    if (!a) continue
    const role = roleById.get(ex.session_exercise_id) ?? UNCLASSIFIED_EXERCISE_ROLE
    ex.reps = a.reps
    ex.sets = a.sets
    if (role === 'accessory') {
      // Accessories are prescribed to a target EFFORT (goal RPE); the load floats to hit that RPE
      // at the settled reps, so effort stays constant across rep ranges and progression comes from
      // the 1RM rising rather than a fixed % band. Compounds keep the phase-relative clamp below.
      // BF-221: the reps it floats against are held to the goal's accessory band first.
      const settled = settleAccessory(signals.trainingGoal, a.reps)
      ex.reps = settled.reps
      ex.pct = settled.pct
    } else if (role === 'secondary') {
      // Secondary compounds are worked at least as hard as an accessory (owner steer 2026-07-20)
      // — they previously had NO effort floor, so the moderate band could pass a light AI pick
      // through at ~RPE 6 (a bent-over row at 68%). Float the load up to at least the effort floor,
      // keep the AI/band pick if it's already harder, and cap at the primary zone's ceiling so a
      // secondary can climb toward — but never out-load — the heavy anchor.
      const exZone = intensityZoneForRole(signals.trainingGoal, parsed.phase, role)
      const primaryZone = intensityZoneForRole(signals.trainingGoal, parsed.phase, 'primary')
      // The accessory effort floor is goal-agnostic (RPE ~8). On goals whose primary runs
      // deliberately light in a phase (strength/power accumulation sit near RPE 6), flooring a
      // secondary at RPE 8 would push it ABOVE the main — inverting the role order. Cap the floor
      // at the main's hardest intended effort for this phase so a secondary can match, never exceed it
      // (`secondaryTargetRpe`, shared with a lift preference's load so the two cannot drift).
      const effortPct = pctForExpectedRpe(secondaryTargetRpe(signals.trainingGoal, parsed.phase), a.reps)
      const primaryCeil = primaryZone.pctMax ?? 85
      ex.pct = Math.min(primaryCeil, Math.max(clampPrescribedPct(a.pct, exZone), effortPct))
    } else {
      // Primary compound: the heavy anchor — phase-relative clamp, still climbs with the block.
      const exZone = intensityZoneForRole(signals.trainingGoal, parsed.phase, role)
      ex.pct = clampPrescribedPct(a.pct, exZone)
    }
    // #3896: the lift's preference, over the role's own rule. With a rep range the reps are the
    // lifter's (autoregulation's climb included, inside the range) and the load is the role's target
    // effort at those reps (D3, D4); then the preferred rest and any one-shot plate step.
    const lp = preferenceFor(ex.session_exercise_id)
    if (lp) {
      const sig = signalById.get(ex.session_exercise_id)!
      const { row, applied } = applyLiftPreferenceToPlanRow(
        { sets: ex.sets, reps: lp.preference.repRange ? a.reps : ex.reps, pct: ex.pct, restSec: ex.rest_sec },
        lp.preference,
        {
          trainingGoal: signals.trainingGoal, phase: parsed.phase, role,
          bodyweight: sig.exerciseType === 'bodyweight', basisKg: lp.basisKg, equipment: sig.equipment,
        },
      )
      ex.reps = row.reps
      ex.pct = row.pct
      ex.rest_sec = row.restSec
      if (Object.keys(applied).length > 0) appliedById.set(ex.session_exercise_id, applied)
    }
  }

  // Role order on LOAD is absolute — see capLoadToAnchor. A second pass over the settled
  // percentages, deliberately not folded into the loop above: that loop runs in list order and
  // the anchor is not necessarily first, so an in-loop cap would silently no-op on some
  // sessions. Roles come from `signals` (the program's real exercise_role), never list order.
  // Exercises with no program role are excluded rather than defaulted to 'primary': a default
  // would let an unknown movement invent an anchor for a session that has none, defeating the
  // no-primary case entirely.
  const cappedPct = new Map(
    capLoadToAnchor(
      parsed.exercises.flatMap(ex => {
        const role = roleById.get(ex.session_exercise_id)
        return role ? [{ id: ex.session_exercise_id, role, pct: ex.pct }] : []
      }),
    ).map(e => [e.id, e.pct]),
  )
  for (const ex of parsed.exercises) {
    ex.pct = cappedPct.get(ex.session_exercise_id) ?? ex.pct
  }

  // #3890: the week's check-in hold ("Heavy"), last on the load and enforced in code: a held lift's bar
  // is no heavier than the bar the person last used for it. A ceiling only, after every rule above
  // (the model, autoregulation, the preference, the anchor cap), and before the time budget so the plan
  // is costed at the load it carries. Never in a deload or baseline, nor on a row the deload cut
  // (`preferenceFor`), nor on a bodyweight lift. Every other row is left exactly as it was.
  const checkinHeld = holdPlanRows(
    parsed.exercises.map(ex => ({ id: ex.session_exercise_id, pct: ex.pct })),
    id => {
      const lp = preferenceFor(id)
      const sig = signalById.get(id)
      return lp && sig ? { preference: lp.preference, basisKg: lp.basisKg, equipment: sig.equipment, bodyweight: sig.exerciseType === 'bodyweight' } : undefined
    },
  )
  for (const ex of parsed.exercises) ex.pct = checkinHeld.pct.get(ex.session_exercise_id) ?? ex.pct

  // The deterministic tail — role plausibility, the budget passes and everything derived from
  // them — is shared with the no-model duration re-fit (budget-stage.ts).
  //
  // The set counts going IN are what a re-fit has to start from, so they are captured here and
  // stored on the prescription. The budget passes are lossy in one direction: fitToBudget only
  // REMOVES sets, and a return to the session's own length runs neither drop nor expand, so
  // re-fitting a trimmed plan could never give the sets back (short → standard would keep the
  // 2-set short plan and label it standard).
  const refitBaseline: NonNullable<AiPrescription['refitBaseline']> = {
    sets: Object.fromEntries(parsed.exercises.map(ex => [ex.session_exercise_id, ex.sets])),
    reasoning: parsed.reasoning,
    ...(autoreg.earnedSetIds.size > 0 && { earnedSetIds: [...autoreg.earnedSetIds] }),
    // #3713: the phase the stage below caps against. A cap guard may rewrite `phase` after it.
    phase: parsed.phase as PeriodizationPhase,
  }

  const budget = applyBudgetStage(
    parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
    })),
    signals,
    validSession.timeBudgetMinutes,
    durationPreset,
    autoreg.earnedSetIds,
    // #2403: the same rows the prescription below records as `preDeload`, so the figures for the
    // session Full trains come out of the one stage that costs this one.
    new Map([...preDeloadById].filter(([id]) => deloadedIds.has(id))),
    parsed.phase,
    // #3896: the one-shot ±1 set, on the fitted count and costed with the session.
    (id, sets) => {
      const lp = preferenceFor(id)
      const next = applyPlanSetsDelta(sets, lp?.preference, { trainingGoal: signals.trainingGoal, phase: parsed.phase, role: roleById.get(id) ?? UNCLASSIFIED_EXERCISE_ROLE })
      if (next != null) {
        appliedById.set(id, mergeApplied(appliedById.get(id), {
          setsDelta: lp!.preference.oneShot!.setsDelta!, oneShotSetAt: lp!.preference.oneShot!.setAt.toISOString(),
        })!)
      }
      return next
    },
  )
  for (const ex of parsed.exercises) {
    ex.sets = budget.sets.get(ex.session_exercise_id) ?? ex.sets
    const rest = budget.restSec.get(ex.session_exercise_id) ?? ex.rest_sec
    // A shortened rest (#2284) is kept on the baseline at its full length, so re-fitting this plan
    // back to the session's own length gives the rest back as well as the sets.
    if (rest !== ex.rest_sec) {
      refitBaseline.restSec = { ...refitBaseline.restSec, [ex.session_exercise_id]: ex.rest_sec }
    }
    ex.rest_sec = rest
  }
  const droppedIdSet = budget.droppedIds
  const estimatedSessionDurationMin = budget.estimatedSessionDurationMin
  const weeklyVolumeContribution = budget.weeklyVolumeContribution
  parsed.reasoning = reasoningWithBudgetNote(refitBaseline.reasoning, budget.budgetNote)

  const aiPrescription: AiPrescription = {
    phase: parsed.phase as PeriodizationPhase,
    phaseAction: parsed.phase_action,
    exercises: parsed.exercises.map(ex => ({
      sessionExerciseId: ex.session_exercise_id,
      name: ex.name,
      sets: ex.sets,
      reps: ex.reps,
      pct: ex.pct,
      restSec: ex.rest_sec,
      autoregNote: joinNotes(autoreg.notes[ex.session_exercise_id], perExDeload.recentNotes[ex.session_exercise_id]),
      // The budget's rest (above) wins over a preferred rest, so the record says so.
      ...liftPreferenceField(appliedAfterBudgetRest(appliedById.get(ex.session_exercise_id), ex.rest_sec)),
      ...(deloadedIds.has(ex.session_exercise_id) && {
        deloaded: true,
        deloadNote: perExDeload.notes[ex.session_exercise_id],
        preDeload: preDeloadById.get(ex.session_exercise_id),
      }),
    })),
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    ...(budget.fullSession && { fullSession: budget.fullSession }),
    // #3877: from the phase and the action, not the model's flag.
    deload: isDeloadPlan(state.phase, parsed.phase_action),
    reasoning: parsed.reasoning,
    // The LLM's self-reported confidence is input only — a hallucinated 0.85 must never
    // auto-apply a prescription. The deterministic engine score is the only number that
    // gates auto-apply and the card's low-confidence confirm.
    confidence: signals.confidence,
    confidenceReasons: signals.confidenceReasons,
    durationPreset: durationPreset ?? 'standard',
    sessionTimeBudgetMinutes: validSession.timeBudgetMinutes,
    // #3890: recorded only when the check-in's budget shaped the plan, so a serve-time re-fit knows it
    // is already fitted (and an undo knows to give the length back). Absent for everyone else.
    ...(checkinFitMin != null && { checkinBudgetMin: checkinFitMin }),
    ...(checkinHeld.record && { checkinHold: checkinHeld.record }),
    refitBaseline,
    ...(droppedIdSet.size > 0 && { droppedExerciseIds: [...droppedIdSet] }),
  }

  // Phase guards: force a transition recommendation at the phase's cap so ambiguous signals can't
  // keep a "stay" running forever. #3766: the cap is the program's, in training weeks. Other session
  // types' agreement can also carry the move to a session whose own answer was a plain stay. A
  // program still waiting for its switch-over keeps only the old per-type way out of a deload.
  const prescription = programPhase.aligned
    ? withProgramMove(applyProgramPhaseCap(aiPrescription, programPhase), programMove, state.phase)
    : typeOnly(applyDeloadFloor(aiPrescription, state.phase, state.sessionsInPhase))

  // A transition may only be auto-applied when the MODEL chose it — `parsed` still holds the
  // pre-guard answer, and the exercise percentages were clamped against `parsed.phase`. When a
  // ceiling forces the transition instead (the model said "stay"), the guards rewrite
  // `prescription.phase` afterwards and the loads are still the OLD phase's, so applying it
  // automatically would advance the phase into a session prescribed a zone too light. A forced
  // transition means the signals were ambiguous, which is exactly when the lifter should decide.
  const modelEarnedTransition = canAutoApplyTransition(
    parsed.phase_action,
    parsed.phase,
    prescription.phaseAction,
    prescription.phase,
  )

  const autoEligible = prescription.confidence >= 0.6 && signals.autoApplyPrescriptions

  // Determine status. `stay` and an earned transition auto-apply; every other action —
  // deload, rest day, session swap, and any ceiling-forced transition — is always surfaced.
  // Deloads deliberately stay manual (owner call 2026-08-02): cutting to ~50% for 2 sets is
  // disruptive enough that it should be a decision, not a surprise.
  let prescriptionStatus: 'pending' | 'auto_applied' = 'pending'
  // #3877: a program still waiting for its switch-over has no program phase to move, so an earned
  // transition there is offered rather than applied. Applying it went through the program move,
  // which a waiting program refuses, and the plan was then not stored at all (a 409 and no plan).
  // The offer's tap moves this type alone (`typeOnly`).
  if (autoEligible && (prescription.phaseAction === 'stay' || (modelEarnedTransition && programPhase.aligned))) {
    prescriptionStatus = 'auto_applied'
  }

  // An auto-applied transition has to actually MOVE the phase. Setting the status alone left
  // `session_periodization.phase` behind while the prescription was already written in the new
  // phase's zone — four of five session types sat in accumulation for five weeks against
  // intensification loads (prod audit 2026-08-02). advancePhase must run BEFORE
  // storePrescription: it nulls the stored prescription and resets the status as a side effect.
  const applyingTransition = prescriptionStatus === 'auto_applied' && modelEarnedTransition
  let storeFor = generatedFor
  if (applyingTransition) {
    // There is no session-level 1RM trend — it is per exercise. Summarise by majority so the
    // rationale never claims a direction the underlying lifts do not support.
    const ups = signals.exercises.filter(e => e.rm1Trend === 'up').length
    const downs = signals.exercises.filter(e => e.rm1Trend === 'down').length
    prescription.transitionRationale = buildTransitionRationale(
      state.phase,
      prescription.phase,
      signals.trainingGoal,
      {
        trainingWeeksInPhase: programPhase.trainingWeeksDone,
        rm1Trend: ups > downs ? 'up' : downs > ups ? 'down' : 'flat',
        rpeDelta: signals.rpeTrend?.delta ?? null,
      },
    ) ?? undefined
    // With the phase it was planned from: a program another session moved meanwhile is left alone.
    const moved = await repo.advanceProgramPhase(userId, programSessionId, prescription.phase, generatedFor)
    storeFor = { phase: prescription.phase, phaseStartedAt: moved?.phaseStartedAt ?? generatedFor.phaseStartedAt, structure }
  }

  // #3700: a rest-day recommendation is sized on today's readiness and ends at the next local
  // midnight; a plan sized on the block keeps its week.
  const expiresAt = prescriptionExpiresAt(prescription, tz, startedAt)
  // Content and status in ONE write. Previously this stored the prescription (which resets the
  // status to 'pending') and then set 'auto_applied' in a second statement; two concurrent
  // generations for this session could interleave between them and leave the status describing the
  // other run's prescription (Q-54).
  if (await storePrescription(prescription, expiresAt, prescriptionStatus, storeFor) === false) {
    return PHASE_MOVED
  }

  // BF-199 Phase 1: record what the rules prescriber would have said beside what was given.
  // Best-effort and after the store: evidence must never cost the lifter a plan.
  await (async () => repo.recordPrescriptionShadow(userId, programSessionId, buildPrescriptionShadow({
    modelPhase, modelPhaseAction, final: prescription, rules: buildRulesPrescription(signals, ''), modelExercises,
  })))().catch(err => console.error('[prescribe] shadow record failed (ignored):', err))

  return { ok: true, prescription, prescriptionStatus, estimatedSessionDurationMin }
}

/** #3766: while the program waits for its switch-over, a move on offer is this type's alone (the
 *  route moves only this type), and the screens say so. */
function typeOnly(prescription: AiPrescription): AiPrescription {
  return prescription.phaseAction === 'transition_recommended' ? { ...prescription, typeOnlyMove: true } : prescription
}

/** #3766: the program moved while this plan was being made, so it was not stored. The slot was voided
 *  by that move, and the next open (or the client's retry) plans it in the new phase. #3895 review: the
 *  same answer when the session itself was changed meanwhile (`generatedFor.structure`). */
const PHASE_MOVED = {
  ok: false as const,
  error: 'The program or this session changed while this plan was being made. Reopen the session for a fresh one.',
  status: 409,
}

/** #3766: the other session types already carry a program move this session's answer did not ask
 *  for. Offered like a cap: the loads are the current phase's, so it waits for a tap. */
function withProgramMove(
  prescription: AiPrescription, move: PeriodizationPhase | null, currentPhase: PeriodizationPhase,
): AiPrescription {
  if (move == null || move === currentPhase || prescription.phaseAction !== 'stay') return prescription
  return {
    ...prescription,
    phase: move,
    phaseAction: 'transition_recommended',
    reasoning: `At least half of this week's session types point to moving the program to ${move}. ${prescription.reasoning}`.trim(),
  }
}

/** #3764: a neutral "Trained recently" note rides in `autoregNote`, the one note field the card
 *  already shows on an exercise at normal load, beside any autoregulation note. */
function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const kept = notes.filter((n): n is string => !!n)
  return kept.length > 0 ? kept.join(' · ') : undefined
}
