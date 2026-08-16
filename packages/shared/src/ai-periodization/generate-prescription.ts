import { todayInTz } from '@trainingai/shared/date-utils'
import { aggregateSignals } from '@trainingai/shared/ai-periodization/signals'
import { buildSystemPrompt, buildUserPrompt, intensityZoneForRole } from '@trainingai/shared/ai-periodization/prompt'
import { accessoryTargetRpe } from '@trainingai/shared/ai-periodization/goal-ranges'
import { expectedRpe, pctForExpectedRpe } from '@trainingai/shared/ai-periodization/expected-rpe'
import {
  applyAccumulationCeiling,
  applyIntensificationCeiling,
  applyRealisationCeiling,
  applyDeloadFloor,
  canAutoApplyTransition,
} from '@trainingai/shared/ai-periodization/phase-guards'
import { fitToBudget, expandToBudget, dropToBudget, applyRoleSetPlausibility, estimateSessionDurationMin, type MuscleContribution, type MuscleVolumeState } from '@trainingai/shared/ai-periodization/time-budget'
import { capLoadToAnchor } from '@trainingai/shared/ai-periodization/role-plausibility'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'
import { budgetForPreset, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import { applyAutoregulation, clampPrescribedPct } from '@trainingai/shared/ai-periodization/autoregulation'
import { shouldTriggerEmergencyDeload } from '@trainingai/shared/ai-periodization/emergency-deload'
import { computePerExerciseDeload } from '@trainingai/shared/ai-periodization/per-exercise-deload'
import { buildTransitionRationale } from '@trainingai/shared/ai-periodization/transition-rationale'
import { DELOAD_LOWER_PCT, DELOAD_REPS, DELOAD_SETS, DELOAD_REST } from '@trainingai/shared/ai-periodization/deload-constants'
import { generateObject } from 'ai'
import { aiModel, loggedGenerateObject } from '@/lib/ai/instrument'
import { z } from 'zod'
import { PrescriptionSchema } from '@trainingai/shared/ai-periodization/prescription-schema'
import { reconcilePrescription } from '@trainingai/shared/ai-periodization/reconcile-prescription'
import type { AiPrescription, AiPrescriptionExercise, PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import type { WorkoutRepository } from '@/lib/data/repository'
import { createDedupCache } from '@trainingai/shared/ai-periodization/generation-dedup'

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
// cooldown). Per-process (per Railway replica); a user's rapid requests hit one replica,
// so the open-burst is caught, and signals don't change within the window so the reused
// result is identical to a re-run.
const prescriptionDedup = createDedupCache<GeneratePrescriptionResult>(30_000)

// Whole-session deload construction shared by the emergency-deload path and the
// per-exercise deload's >50%-soreness escalation (see
// docs/superpowers/specs/2026-07-02-per-exercise-deload-design.md) — "deloaded"
// means the same numbers regardless of which trigger fired.
function buildWholeSessionDeloadPrescription(
  signals: PrescriptionSignals,
  reasoning: string,
): AiPrescription {
  const goal = signals.trainingGoal
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
      signals.effectiveTimeBudgetMin,
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
  }))

  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    exercises.map(ex => {
      const sig = sigById.get(ex.sessionExerciseId)
      return {
        sets: ex.sets, reps: ex.reps, restSec: ex.restSec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, pct) : null,
      }
    }),
  )

  const weeklyVolumeContribution: Record<string, number> = {}
  for (const ex of exercises) {
    const signal = signals.exercises.find(e => e.sessionExerciseId === ex.sessionExerciseId)
    if (!signal) continue
    for (const ma of signal.muscleAssignments) {
      const weight = ma.role === 'main' ? 1.0 : 0.5
      const muscle = ma.muscle.toLowerCase()
      weeklyVolumeContribution[muscle] = (weeklyVolumeContribution[muscle] ?? 0) + ex.sets * weight
    }
  }

  return {
    phase: 'deload',
    phaseAction: 'deload_recommended',
    exercises,
    estimatedSessionDurationMin,
    weeklyVolumeContribution,
    deload: true,
    reasoning,
    confidence: 1.0,
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

  const budgetOverrideMin = durationPreset != null && durationPreset !== 'standard'
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
    const prescription = buildWholeSessionDeloadPrescription(
      signals,
      'Emergency deload triggered due to overtraining signals.',
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
      () => generateObject({
        model: aiModel(),
        schema: PrescriptionSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
    )
    parsed = result.object
  } catch (err) {
    console.error('Gemini prescription generation failed:', err)
    return { ok: false, error: 'AI generation failed', status: 502 }
  }

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
    const role = roleById.get(ex.session_exercise_id) ?? 'primary'
    ex.reps = a.reps
    ex.sets = a.sets
    if (role === 'accessory') {
      // Accessories are prescribed to a target EFFORT (goal RPE); the load floats to hit that RPE
      // at the settled reps, so effort stays constant across rep ranges and progression comes from
      // the 1RM rising rather than a fixed % band. Compounds keep the phase-relative clamp below.
      const pct = pctForExpectedRpe(accessoryTargetRpe(signals.trainingGoal), a.reps)
      ex.pct = Math.min(85, Math.max(40, pct))
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

  // Time-budget enforcement — the AI is asked to fit the budget, but trim deterministically
  // so the session is guaranteed to fit the allocated time. Sets are cut by muscle-overage
  // priority, biased toward accessories first (see fitToBudget/trimPriority) — normally
  // accessories still go first, but a severe cross-tier imbalance (e.g. a primary's muscle
  // well past its weekly MAV while an accessory's is badly undertrained) can pull the cut out
  // of a higher-priority role instead. Role floors are absolute either way — a primary is
  // never touched below 2 sets. A set earned by autoregulation is trimmed last, so it funds
  // itself from lower-value work. Duration is estimated from the prescribed reps and rest, so
  // it reflects the actual longest-case session.
  const muscleVolume = new Map<string, MuscleVolumeState>(
    Object.entries(signals.weeklyTargets).map(([muscle, mav]) => [
      muscle,
      { loggedBeforeSession: signals.weeklyLogged[muscle] ?? 0, mav },
    ]),
  )
  const timedExercises = parsed.exercises.map(ex => {
    const sig = signals.exercises.find(e => e.sessionExerciseId === ex.session_exercise_id)
    const muscleGroups: MuscleContribution[] = (sig?.muscleAssignments ?? []).map(ma => ({
      muscle: normalizeMuscle(ma.muscle),
      weight: ma.role === 'main' ? 1.0 : 0.5,
    }))
    return {
      sessionExerciseId: ex.session_exercise_id,
      role: sig?.role ?? 'primary',
      sets: ex.sets,
      reps: ex.reps,
      restSec: ex.rest_sec,
      transitionSec: sig?.transitionSec ?? 240,
      muscleGroups,
      measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
      measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
    }
  })

  // A short session is the one case where trimming alone can't reach the budget — five
  // exercises floored at two sets still overrun a 30-minute ask, and two token sets each is
  // worse training than doing fewer exercises properly. dropToBudget drops whole exercises
  // in trim-priority order; they ride out on the prescription's existing droppedExerciseIds,
  // which every render path already honours.
  // Role plausibility on volume runs BEFORE the budget passes, so every preset gets it and the
  // plan is already the right shape when trimming/expansion start — rather than relying on them
  // to repair a shape the model chose blind.
  const plausible = applyRoleSetPlausibility(timedExercises, muscleVolume)

  const dropped = durationPreset === 'short'
    ? dropToBudget(plausible, signals.effectiveTimeBudgetMin, autoreg.earnedSetIds, muscleVolume)
    : null
  const trimmed = dropped?.exercises ?? fitToBudget(
    plausible,
    signals.effectiveTimeBudgetMin,
    autoreg.earnedSetIds,
    muscleVolume,
  )
  const droppedIdSet = new Set(dropped?.droppedIds ?? [])

  // Filling the budget is the 'long' preset's whole point: fitToBudget only removes sets, so
  // without this a 90-minute session returned the 60-minute plan and handed the surplus back.
  //
  // Gated on an EXPLICIT long request, never run on a standard session. The duration model
  // is deliberately conservative (duration-model.ts) and that under-fill IS the finish-early
  // margin — the owner's sessions land on time because of it. Expanding by default would
  // spend exactly that margin.
  let sized = trimmed
  if (durationPreset === 'long') {
    const mrvByMuscle = new Map<string, number>(
      [...new Set(timedExercises.flatMap(e => (e.muscleGroups ?? []).map(m => m.muscle)))]
        .map(muscle => [muscle, volumeLandmarks(signals.trainingGoal, muscle).mrv]),
    )
    sized = expandToBudget(trimmed, signals.effectiveTimeBudgetMin, muscleVolume, mrvByMuscle)
  }

  const fittedSets = new Map(sized.map(f => [f.sessionExerciseId, f.sets]))
  // A DROPPED exercise is absent from `sized`, so falling back to `ex.sets` would hand back the
  // model's raw, un-capped count — production stored an accessory at 5 sets (its ceiling is 4)
  // that way. Dropped entries are still kept in the prescription (droppedExerciseIds filters at
  // render), so they must carry a plausible shape too. Fall back to the role-capped counts.
  const plausibleSets = new Map(plausible.map(p => [p.sessionExerciseId, p.sets]))
  for (const ex of parsed.exercises) {
    ex.sets = fittedSets.get(ex.session_exercise_id)
      ?? plausibleSets.get(ex.session_exercise_id)
      ?? ex.sets
  }

  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  // Dropped exercises keep their prescription entry (the Workout Review "drop this cycle"
  // convention — droppedExerciseIds filters at render), so every derived total below must
  // exclude them explicitly or the session would be costed for work it won't do.
  const activeExercises = parsed.exercises.filter(ex => !droppedIdSet.has(ex.session_exercise_id))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    activeExercises.map(ex => {
      const sig = sigById.get(ex.session_exercise_id)
      return {
        sets: ex.sets, reps: ex.reps, restSec: ex.rest_sec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
      }
    }),
  )

  if (droppedIdSet.size > 0) {
    const names = parsed.exercises
      .filter(ex => droppedIdSet.has(ex.session_exercise_id)).map(ex => ex.name).join(', ')
    parsed.reasoning = `${parsed.reasoning} To fit the ${signals.effectiveTimeBudgetMin}-min working budget, ${names} ${droppedIdSet.size === 1 ? 'was' : 'were'} dropped for today — the muscles furthest ahead of their weekly target — so the remaining work keeps full sets rather than every exercise being cut to a token two.`
  } else if (estimatedSessionDurationMin > signals.effectiveTimeBudgetMin) {
    parsed.reasoning = `${parsed.reasoning} Note: even at minimum sets this session is estimated at ${estimatedSessionDurationMin} min against the ${signals.effectiveTimeBudgetMin}-min working budget — it has more exercises than the time budget fits. Consider removing an accessory from this session or raising its time budget.`
  }

  const weeklyVolumeContribution: Record<string, number> = {}
  for (const ex of activeExercises) {
    const signal = signals.exercises.find(e => e.sessionExerciseId === ex.session_exercise_id)
    if (!signal) continue
    for (const ma of signal.muscleAssignments) {
      const weight = ma.role === 'main' ? 1.0 : 0.5
      const muscle = ma.muscle.toLowerCase()
      weeklyVolumeContribution[muscle] = (weeklyVolumeContribution[muscle] ?? 0) + ex.sets * weight
    }
  }

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
    deload: parsed.deload,
    reasoning: parsed.reasoning,
    // The LLM's self-reported confidence is input only — a hallucinated 0.85 must never
    // auto-apply a prescription. The deterministic engine score is the only number that
    // gates auto-apply and the card's low-confidence confirm.
    confidence: signals.confidence,
    confidenceReasons: signals.confidenceReasons,
    durationPreset: durationPreset ?? 'standard',
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

  return { ok: true, prescription, prescriptionStatus, estimatedSessionDurationMin }
}
