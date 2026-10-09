import { todayInTz } from '@trainingai/shared/date-utils'

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
import { accessoryTargetRpe, settleAccessory } from '@trainingai/shared/ai-periodization/goal-ranges'
import { expectedRpe, pctForExpectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'
import {
  applyAccumulationCeiling,
  applyIntensificationCeiling,
  applyRealisationCeiling,
  applyDeloadFloor,
  canAutoApplyTransition,
} from '@trainingai/shared/ai-periodization/phase-guards'
import { fitToBudget } from '@trainingai/shared/ai-periodization/time-budget'
import { applyBudgetStage } from '@trainingai/shared/ai-periodization/budget-stage'
import { prescriptionFigures, rowUnderFull, hasFullSessionRevert } from '@trainingai/shared/ai-periodization/prescription-figures'
import { capLoadToAnchor } from '@trainingai/shared/ai-periodization/role-plausibility'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import { budgetForPreset, requestedBudgetMin, fitBudgetMin, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import { applyAutoregulation, clampPrescribedPct } from '@trainingai/shared/ai-periodization/autoregulation'
import { shouldTriggerEmergencyDeload, emergencyDeloadTrigger } from '@trainingai/shared/ai-periodization/emergency-deload'
import { computePerExerciseDeload } from '@trainingai/shared/ai-periodization/per-exercise-deload'
import { buildTransitionRationale } from '@trainingai/shared/ai-periodization/transition-rationale'
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_SETS, DELOAD_REST } from '@trainingai/shared/ai-periodization/deload-constants'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import { PrescriptionSchema } from '@trainingai/shared/ai-periodization/prescription-schema'
import { reconcilePrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import { buildPrescriptionShadow } from '@trainingai/shared/ai-periodization/prescription-shadow'
import type { AiPrescription, AiPrescriptionExercise, PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { createDedupCache } from '@trainingai/shared/ai-periodization/generation-dedup'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'

export type GeneratePrescriptionResult =
  | {
      ok: true
      prescription: AiPrescription
      prescriptionStatus: 'pending' | 'auto_applied'
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
      // The phase is already a deload, so there is nothing to recommend: `deload_recommended` on a
      // stored prescription is what the accept route flips the phase on.
      phaseAction: 'stay',
      confidence: asWritten.confidence,
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
  const planned = withBase.map(ex => ({
    ex,
    sets: ex.baseSets.length,
    reps: ex.baseSets[0].reps,
    pct: ex.baseSets[0].pct,
    restSec: ex.baseSets[0].restSec,
  }))

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

  const exercises: AiPrescriptionExercise[] = planned.map(p => ({
    sessionExerciseId: p.ex.sessionExerciseId,
    name: p.ex.name,
    sets: fitted.get(p.ex.sessionExerciseId) ?? p.sets,
    reps: p.reps,
    pct: p.pct,
    restSec: p.restSec,
  }))

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
    confidenceReasons: ['Built from your program\u2019s own sets — the AI coach could not be reached.'],
    source: 'rules',
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
  const key = `${userId}:${programSessionId}:${todayInTz(tz)}:${excludeSessionId ?? ''}:${durationPreset ?? 'standard'}`
  return prescriptionDedup.run(
    key,
    // An explicit preset choice is a user action asking for a different plan — it must
    // never be answered from the read-through cooldown.
    { skipCooldown: Boolean(excludeSessionId) || durationPreset != null, cacheable: r => r.ok },
    () => runPrescriptionGeneration(userId, programSessionId, repo, tz, excludeSessionId, durationPreset),
  )
}

async function runPrescriptionGeneration(
  userId: string,
  programSessionId: string,
  repo: WorkoutRepository,
  tz: string,
  // The workout session whose completion triggered this call (from complete-workout's
  // post-completion hook). Excluded from the hoursSinceLastSession gap only — it has
  // completedAt ≈ now by construction, which would otherwise spuriously satisfy the
  // emergency-deload <36h condition (W5 §4.2). Absent for manual/GET-style prescribe calls.
  excludeSessionId?: string,
  durationPreset?: DurationPreset,
): Promise<GeneratePrescriptionResult> {
  const today = todayInTz(tz)

  // Validate the session belongs to the active program, then ensure it has a periodization
  // row — self-heal a valid-but-stateless session, matching the GET route (a valid session
  // with no state row previously 404'd here even though GET would create it). A genuinely
  // stale id (not in the active program) still 404s.
  const activeProgram = await repo.getActiveProgram(userId)
  const validSession = activeProgram?.sessions.find(s => s.id === programSessionId)
  if (!validSession || !activeProgram) return { ok: false, error: 'Not found', status: 404 }
  let state = await repo.ensureSessionPeriodization(userId, programSessionId)

  // Self-heal sessions_in_phase before it gates the phase-ceiling checks below
  // (SYNC-T2) — the counter was previously only reconciled at the
  // program-overview read site, so a drifted count (over-count on re-sync, no
  // decrement on delete, direct-edit inflation) could mis-gate auto-deload /
  // cycle progression here.
  await repo.reconcileSessionsInPhase(userId, activeProgram.id)
  state = (await repo.getSessionPeriodization(userId, programSessionId)) ?? state

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
  const budgetOverrideMin = requestedMin != null && requestedMin !== validSession.timeBudgetMinutes
    ? budgetForPreset(validSession.timeBudgetMinutes, durationPreset)
    : undefined
  const signals = await aggregateSignals(userId, programSessionId, repo, tz, excludeSessionId, budgetOverrideMin)
  if (!signals) return { ok: false, error: 'Could not aggregate signals', status: 404 }

  // If an emergency deload is already pending and unexpired, return it as-is rather than
  // regenerating — the trigger below is stateless and would otherwise re-fire on every
  // prescribe call.
  const pending = state.prescription
  if (
    pending?.deload && pending.phaseAction === 'deload_recommended' &&
    state.prescriptionStatus === 'pending' &&
    state.prescriptionExpiresAt != null && state.prescriptionExpiresAt > new Date()
  ) {
    return {
      ok: true,
      prescription: pending,
      prescriptionStatus: 'pending',
      estimatedSessionDurationMin: pending.estimatedSessionDurationMin,
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
    // sessions_in_phase stay untouched until the user accepts it (respond route).
    const expiresAt = new Date(Date.now() + 7 * 86_400_000)
    await repo.storePrescription(userId, programSessionId, prescription, expiresAt)

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
  )

  if (perExDeload.outcome === 'whole_session') {
    const muscles = perExDeload.matchedMuscles.join(', ')
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      `Most of this session's muscles are still sore (${muscles}) — a lighter full-session deload will serve recovery better than training through it.`,
      `Deload — most of this session's muscles are still sore (${muscles})`,
    )
    // Soreness is a per-day signal — expire tomorrow so a clean check-in
    // gets a fresh decision (the emergency offer keeps its 7-day window).
    const expiresAt = new Date(Date.now() + 86_400_000)
    await repo.storePrescription(userId, programSessionId, prescription, expiresAt)
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
      signal => generateObject({
        model: aiModel(),
        schema: PrescriptionSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
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
      await repo.storePrescription(
        userId, programSessionId, rules, new Date(Date.now() + RULES_PRESCRIPTION_TTL_MS),
      )
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
      // at the main's hardest intended effort for this phase so a secondary can match, never exceed it.
      const mainEffortCeil = expectedRpe(primaryZone.pctMax, primaryZone.repMin)
      const secondaryTargetRpe = Math.min(accessoryTargetRpe(signals.trainingGoal), mainEffortCeil)
      const effortPct = pctForExpectedRpe(secondaryTargetRpe, a.reps)
      const primaryCeil = primaryZone.pctMax ?? 85
      ex.pct = Math.min(primaryCeil, Math.max(clampPrescribedPct(a.pct, exZone), effortPct))
    } else {
      // Primary compound: the heavy anchor — phase-relative clamp, still climbs with the block.
      const exZone = intensityZoneForRole(signals.trainingGoal, parsed.phase, role)
      ex.pct = clampPrescribedPct(a.pct, exZone)
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
  parsed.reasoning = `${refitBaseline.reasoning}${budget.budgetNote}`

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
      autoregNote: autoreg.notes[ex.session_exercise_id],
      ...(deloadedIds.has(ex.session_exercise_id) && {
        deloaded: true,
        deloadNote: perExDeload.notes[ex.session_exercise_id],
        preDeload: preDeloadById.get(ex.session_exercise_id),
      }),
    })),
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    ...(budget.fullSession && { fullSession: budget.fullSession }),
    deload: parsed.deload,
    reasoning: parsed.reasoning,
    // The LLM's self-reported confidence is input only — a hallucinated 0.85 must never
    // auto-apply a prescription. The deterministic engine score is the only number that
    // gates auto-apply and the card's low-confidence confirm.
    confidence: signals.confidence,
    confidenceReasons: signals.confidenceReasons,
    durationPreset: durationPreset ?? 'standard',
    refitBaseline,
    ...(droppedIdSet.size > 0 && { droppedExerciseIds: [...droppedIdSet] }),
  }

  // Phase guards: force a transition recommendation at each phase's ceiling/floor so
  // ambiguous signals can't keep a "stay" running forever. Mutually exclusive by phase.
  const prescription = applyDeloadFloor(
    applyRealisationCeiling(
      applyIntensificationCeiling(
        applyAccumulationCeiling(aiPrescription, state.phase, state.sessionsInPhase),
        state.phase,
        state.sessionsInPhase,
      ),
      state.phase,
      state.sessionsInPhase,
    ),
    state.phase,
    state.sessionsInPhase,
  )

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
  if (autoEligible && (prescription.phaseAction === 'stay' || modelEarnedTransition)) {
    prescriptionStatus = 'auto_applied'
  }

  // An auto-applied transition has to actually MOVE the phase. Setting the status alone left
  // `session_periodization.phase` behind while the prescription was already written in the new
  // phase's zone — four of five session types sat in accumulation for five weeks against
  // intensification loads (prod audit 2026-08-02). advancePhase must run BEFORE
  // storePrescription: it nulls the stored prescription and resets the status as a side effect.
  const applyingTransition = prescriptionStatus === 'auto_applied' && modelEarnedTransition
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
        sessionsInPhase: state.sessionsInPhase,
        rm1Trend: ups > downs ? 'up' : downs > ups ? 'down' : 'flat',
        rpeDelta: signals.rpeTrend?.delta ?? null,
      },
    ) ?? undefined
    await repo.advancePhase(userId, programSessionId, prescription.phase)
  }

  const expiresAt = new Date(Date.now() + 7 * 86_400_000)
  // Content and status in ONE write. Previously this stored the prescription (which resets the
  // status to 'pending') and then set 'auto_applied' in a second statement; two concurrent
  // generations for this session could interleave between them and leave the status describing the
  // other run's prescription (Q-54).
  await repo.storePrescription(userId, programSessionId, prescription, expiresAt, prescriptionStatus)

  // BF-199 Phase 1: record what the rules prescriber would have said beside what was given.
  // Best-effort and after the store: evidence must never cost the lifter a plan.
  await (async () => repo.recordPrescriptionShadow(userId, programSessionId, buildPrescriptionShadow({
    modelPhase, modelPhaseAction, final: prescription, rules: buildRulesPrescription(signals, ''), modelExercises,
  })))().catch(err => console.error('[prescribe] shadow record failed (ignored):', err))

  return { ok: true, prescription, prescriptionStatus, estimatedSessionDurationMin }
}
