import { intensityZone } from '@trainingai/shared/ai-periodization/prompt'
import { applyStoredRoleCaps } from '@trainingai/shared/ai-periodization/role-plausibility'
import type { PeriodizationPhase } from '@trainingai/shared/types/ai-periodization'

export interface ReconcileExercise {
  sessionExerciseId: string
  name: string
  sets: number
  reps: number
  pct: number
  restSec: number
}

export interface ReconcileSignalExercise {
  sessionExerciseId: string
  name: string
  role: string
}

export interface ReconcileExercisesResult {
  exercises: ReconcileExercise[]
  droppedIds: string[]
  backfilledIds: string[]
}

// The model occasionally returns pct as a 0-1 fraction (e.g. 0.74 for 74%) instead of a
// percentage. Exactly 1 is genuinely ambiguous — "1%" (a fraction typo) vs. an
// already-percentage 100. Promoting it to 100% is the single most dangerous misread (an
// all-out top set, or for bodyweight exercises an all-out repMax every set — see
// app/api/workout-data/route.ts:344-353). Leave it at 1 and let the caller's 30-100 clamp
// resolve it to the SAFE end of the range instead.
export function normalizePctFraction(pctRaw: number): number {
  if (pctRaw > 0 && pctRaw < 1) return pctRaw * 100
  return pctRaw
}

// phase_action === 'stay' means nothing about periodization changed — the model's own
// `phase` field is not a decision in that case and must not be trusted. Any other
// phase_action means the model IS asserting a transition, so its phase stands.
export function resolvePhase(
  modelPhase: PeriodizationPhase,
  phaseAction: string,
  currentPhase: PeriodizationPhase,
): PeriodizationPhase {
  return phaseAction === 'stay' ? currentPhase : modelPhase
}

// A `transition_recommended` whose target phase equals the phase you're already in is a
// contradiction the schema can't catch, and it shipped: on 2026-07-28 three of five live
// sessions stored `phase_action: transition_recommended` with `phase: accumulation` while
// sitting in accumulation. Accepting one calls advancePhase(<current>), which resets
// sessions_in_phase to 0 and regenerates — the block can never complete. The card also
// mis-reads it, treating any transition targeting accumulation as "the deload block is
// done, start a fresh cycle". Downgrade it to the truthful action instead: there is no
// transition, so it's a stay. Recovery actions (deload/swap/rest) are untouched — their
// phase field is incidental, the action is the decision.
export function resolvePhaseAction(
  modelPhase: PeriodizationPhase,
  phaseAction: string,
  currentPhase: PeriodizationPhase,
): string {
  if (phaseAction === 'transition_recommended' && modelPhase === currentPhase) return 'stay'
  return phaseAction
}

// Read-side counterpart to resolvePhaseAction. The generation-time fix cannot correct
// prescriptions ALREADY stored (CLAUDE.md: "seeds don't fix drifted prod rows"), and those
// live for up to 7 days — long enough for the card to keep offering an impossible
// transition. Every read site that hands a stored prescription to the UI or to
// prescriptionDrivesLoad passes it through here first. Returns the same object when there
// is nothing to correct, so it's free on the common path.
export function normalizeStoredPrescription<
  T extends {
    phase: PeriodizationPhase
    phaseAction: string
    exercises?: Array<{ sessionExerciseId: string; sets: number; pct: number }>
  },
>(
  prescription: T,
  currentPhase: PeriodizationPhase,
  // Role per session-exercise id, from the program. Optional only because not every read site
  // has the session loaded; when omitted the role caps are skipped and the rest still applies.
  roleById?: Map<string, string>,
): T {
  const resolved = resolvePhaseAction(prescription.phase, prescription.phaseAction, currentPhase)

  // Single-set exercises get the same read-side treatment, and for the same reason: the
  // generation-time floor cannot reach a prescription already stored, and four of them were
  // live on 2026-07-28 — one on an auto_applied session, i.e. actually loading the bar. Nothing
  // legitimately prescribes fewer than two working sets (DELOAD_SETS is 2), so a stored 1 is
  // always the pre-floor bug rather than an intended light day.
  const needsFloor = prescription.exercises?.some(ex => ex.sets < MIN_WORKING_SETS) ?? false

  // Role caps (load + per-role set ceiling) — same reason again, one PR later: the role-ordering
  // rule shipped 2026-07-28 and the live Upper prescription, generated six days earlier, still
  // carried an accessory at 5x @77.5% against a primary at 4x @76%. Order matters: cap first,
  // then floor, so a ceiling clamp can never land below the two-set floor.
  const capped = roleById && prescription.exercises
    ? applyStoredRoleCaps(prescription.exercises, roleById)
    : prescription.exercises
  const rolesChanged = capped !== prescription.exercises

  if (resolved === prescription.phaseAction && !needsFloor && !rolesChanged) return prescription

  return {
    ...prescription,
    phaseAction: resolved,
    ...((needsFloor || rolesChanged) && {
      exercises: capped!.map(ex =>
        ex.sets < MIN_WORKING_SETS ? { ...ex, sets: MIN_WORKING_SETS } : ex),
    }),
  }
}

const BACKFILL_REST_SEC_ACCESSORY = 90
const BACKFILL_REST_SEC_COMPOUND = 120

// Floor on model-authored working sets. Mirrors time-budget.ts's SET_FLOOR — the two are
// the same rule at opposite ends of the pipeline (this bounds what the model may ask for,
// SET_FLOOR bounds what the time-budget trimmer may take away).
export const MIN_WORKING_SETS = 2

function pctMidpoint(min: number, max: number): number {
  return Math.round(((min + max) / 2) * 2) / 2
}

// Reconciles the model's exercise list against the session's actual exercises
// (signals.exercises is the source of truth — it comes from the program, not the model).
// De-dupes BEFORE dropping, so a hallucinated id repeated twice is logged as dropped once,
// not twice. First occurrence wins on dedupe, matching app/api/workout-data/route.ts's own
// `aiPrescription.exercises.find(...)` (also first-match) — the two code paths can now
// never disagree about which duplicate "wins".
export function reconcilePrescriptionExercises(
  modelExercises: ReconcileExercise[],
  signalExercises: ReconcileSignalExercise[],
  trainingGoal: string,
  phase: string,
): ReconcileExercisesResult {
  const validIds = new Set(signalExercises.map(e => e.sessionExerciseId))

  const seen = new Set<string>()
  const deduped: ReconcileExercise[] = []
  for (const ex of modelExercises) {
    if (seen.has(ex.sessionExerciseId)) continue
    seen.add(ex.sessionExerciseId)
    deduped.push(ex)
  }

  const droppedIds: string[] = []
  const kept = deduped.filter(ex => {
    if (validIds.has(ex.sessionExerciseId)) return true
    droppedIds.push(ex.sessionExerciseId)
    return false
  })

  const keptIds = new Set(kept.map(ex => ex.sessionExerciseId))
  const backfilledIds: string[] = []
  const zone = intensityZone(trainingGoal, phase)
  for (const sig of signalExercises) {
    if (keptIds.has(sig.sessionExerciseId)) continue
    backfilledIds.push(sig.sessionExerciseId)
    kept.push({
      sessionExerciseId: sig.sessionExerciseId,
      name: sig.name,
      sets: Math.round((zone.setsMin + zone.setsMax) / 2),
      reps: Math.round((zone.repMin + zone.repMax) / 2),
      pct: pctMidpoint(zone.pctMin, zone.pctMax),
      restSec: sig.role === 'accessory' ? BACKFILL_REST_SEC_ACCESSORY : BACKFILL_REST_SEC_COMPOUND,
    })
  }

  return { exercises: kept, droppedIds, backfilledIds }
}

export interface ReconcileParams {
  modelPhase: PeriodizationPhase
  phaseAction: string
  currentPhase: PeriodizationPhase
  modelExercises: ReconcileExercise[]
  signalExercises: ReconcileSignalExercise[]
  trainingGoal: string
  deloadedIds: Set<string>
  deloadOverride: { sets: number; reps: number; pct: number; restSec: number }
}

export interface ReconcileResult {
  phase: PeriodizationPhase
  // The action after no-op-transition resolution — callers must persist THIS, not the
  // model's raw phase_action (see resolvePhaseAction).
  phaseAction: string
  exercises: ReconcileExercise[]
  preDeloadById: Map<string, { sets: number; reps: number; pct: number; restSec: number }>
  droppedIds: string[]
  backfilledIds: string[]
}

// The single post-parse reconciliation pass — call once, right after
// `parsed = result.object`, before autoregulation/fitToBudget/persistence.
export function reconcilePrescription(params: ReconcileParams): ReconcileResult {
  const phase = resolvePhase(params.modelPhase, params.phaseAction, params.currentPhase)
  const phaseAction = resolvePhaseAction(params.modelPhase, params.phaseAction, params.currentPhase)

  const normalizedExercises = params.modelExercises.map(ex => ({
    ...ex,
    pct: Math.min(100, Math.max(30, normalizePctFraction(ex.pct))),
    // The schema allows sets ≥ 1 and fitToBudget's SET_FLOOR of 2 only governs *trimming*,
    // so a model-authored single-set exercise passed straight through to the bar (four were
    // live on 2026-07-28). time-budget.ts states the rule — "a single working set is too
    // little stimulus for any role" — so enforce it here, where every other correction to
    // model output lives. A per-exercise deload can still legitimately go lower; the deload
    // override below is applied after this and wins.
    sets: Math.max(MIN_WORKING_SETS, ex.sets),
  }))

  const { exercises, droppedIds, backfilledIds } = reconcilePrescriptionExercises(
    normalizedExercises, params.signalExercises, params.trainingGoal, phase,
  )

  // Per-exercise deload override — iterate the DETERMINISTIC deloadedIds set, not the
  // model's echo. reconcilePrescriptionExercises already guarantees every signals.exercises
  // id is present above, so every deloaded id is guaranteed found here; the fallback branch
  // only guards a future change to that guarantee, not today's expected path.
  const byId = new Map(exercises.map(ex => [ex.sessionExerciseId, ex]))
  const preDeloadById = new Map<string, { sets: number; reps: number; pct: number; restSec: number }>()
  for (const id of params.deloadedIds) {
    let target = byId.get(id)
    if (!target) {
      const sig = params.signalExercises.find(e => e.sessionExerciseId === id)
      target = { sessionExerciseId: id, name: sig?.name ?? id, sets: 0, reps: 0, pct: 0, restSec: 0 }
      exercises.push(target)
      byId.set(id, target)
    }
    preDeloadById.set(id, { sets: target.sets, reps: target.reps, pct: target.pct, restSec: target.restSec })
    target.sets = params.deloadOverride.sets
    target.reps = params.deloadOverride.reps
    target.pct = params.deloadOverride.pct
    target.restSec = params.deloadOverride.restSec
  }

  return { phase, phaseAction, exercises, preDeloadById, droppedIds, backfilledIds }
}
