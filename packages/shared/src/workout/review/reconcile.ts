// Pure reconciliation + deterministic guards for the Workout Review proposal.
//
// The AI is asked to drop/adjust exercises so an over-budget session fits its time budget
// while respecting weekly muscle-group targets. This module is the deterministic backstop:
// it validates the model's actions against the real session, refuses unsafe drops, clamps
// adjustments to legal ranges, and recomputes the projected duration and weekly-volume
// impact itself — the model never gets to assert a number the math doesn't support.

import { estimateExerciseDurationSec } from '@trainingai/shared/workout/duration-model'
import { resolveMeasuredRestSec, type ExerciseTimeProfile } from '@trainingai/shared/workout/time-profile'
import { normalizePctFraction } from '@trainingai/shared/ai-periodization/reconcile-prescription'

export interface SetShape { sets: number; reps: number; pct: number; restSec: number }

export interface ReviewMuscleContribution { muscle: string; weight: number }

export interface ReviewSignalExercise {
  sessionExerciseId: string
  name: string
  role: string
  position: number
  // Normalized muscle names with weights (main = 1.0, secondary = 0.5) — used for the
  // weekly-volume impact and the "last remaining coverage" drop guard.
  muscleContributions: ReviewMuscleContribution[]
  transitionSec: number
  timeProfile: ExerciseTimeProfile | null
}

export interface ReviewModelExercise {
  sessionExerciseId: string
  name: string
  action: 'keep' | 'adjust' | 'drop'
  sets: number
  reps: number
  pct: number
  restSec: number
  dropReason?: string
}

export interface ReviewProposalExercise {
  sessionExerciseId: string
  name: string
  role: string
  action: 'keep' | 'adjust' | 'drop'
  before: SetShape | null
  after: SetShape | null
  reason: string | null
  // True when a deterministic guard overrode the model's requested action (e.g. a primary
  // drop refused, or an unsafe drop kept) — surfaced so the UI can show why.
  guardAdjusted: boolean
}

export interface ReviewProposal {
  exercises: ReviewProposalExercise[]
  projectedDurationMin: number
  budgetMin: number
  fitsBudget: boolean
  weeklyImpact: Record<string, number>
  droppedIds: string[]
  adjustedIds: string[]
  invalidIds: string[]
}

// Minimum sets kept per role on an adjust — mirrors fitToBudget's SET_FLOOR so the review
// and the budget enforcer agree on what "minimum" means.
const ROLE_FLOOR: Record<string, number> = { primary: 2, secondary: 2, accessory: 1 }
function roleFloor(role: string): number {
  return ROLE_FLOOR[role] ?? 2
}

function shapesEqual(a: SetShape, b: SetShape): boolean {
  return a.sets === b.sets && a.reps === b.reps && a.pct === b.pct && a.restSec === b.restSec
}

function clampShape(raw: SetShape, role: string): SetShape {
  return {
    sets: Math.max(roleFloor(role), Math.min(10, Math.round(raw.sets))),
    reps: Math.max(1, Math.min(30, Math.round(raw.reps))),
    pct: Math.min(100, Math.max(30, Math.round(normalizePctFraction(raw.pct) * 2) / 2)),
    restSec: Math.max(30, Math.min(600, Math.round(raw.restSec))),
  }
}

function mainMuscles(ex: ReviewSignalExercise): string[] {
  return ex.muscleContributions.filter(m => m.weight >= 1).map(m => m.muscle)
}

function durationSecFor(ex: ReviewSignalExercise, shape: SetShape): number {
  return estimateExerciseDurationSec({
    sets: shape.sets,
    reps: shape.reps,
    restSec: shape.restSec,
    transitionSec: ex.transitionSec,
    measuredSecPerRep: ex.timeProfile?.secPerRep ?? null,
    measuredRestSec: ex.timeProfile ? resolveMeasuredRestSec(ex.timeProfile, shape.pct) : null,
  })
}

// Reconcile the model's per-exercise actions into a safe, self-consistent proposal.
// `currentParams` holds each session exercise's current programming (from the active
// prescription or the base style) — the "before" side of the diff and the basis for a
// drop's removed volume. Every session exercise appears in the output (a model omission
// becomes a keep); ids the model invented are recorded in `invalidIds` and ignored.
export function reconcileReview(params: {
  signalExercises: ReviewSignalExercise[]
  modelExercises: ReviewModelExercise[]
  currentParams: Map<string, SetShape>
  weeklyTargets: Record<string, number>
  weeklyLogged: Record<string, number>
  budgetMin: number
}): ReviewProposal {
  const { signalExercises, modelExercises, currentParams, weeklyTargets, weeklyLogged, budgetMin } = params

  const validIds = new Set(signalExercises.map(e => e.sessionExerciseId))
  const invalidIds = modelExercises
    .filter(m => !validIds.has(m.sessionExerciseId))
    .map(m => m.sessionExerciseId)
  const modelById = new Map(
    modelExercises.filter(m => validIds.has(m.sessionExerciseId)).map(m => [m.sessionExerciseId, m]),
  )

  // Iterate in session position order so the drop guard is deterministic.
  const ordered = [...signalExercises].sort((a, b) => a.position - b.position)

  const underTarget = (muscle: string): boolean => {
    const target = weeklyTargets[muscle] ?? 0
    return target > 0 && (weeklyLogged[muscle] ?? 0) < target
  }

  // Running main-muscle coverage — how many session exercises still main-train each muscle.
  // Decremented as drops are confirmed so a later drop sees the reduced coverage.
  const coverage = new Map<string, number>()
  for (const ex of ordered) {
    for (const m of mainMuscles(ex)) coverage.set(m, (coverage.get(m) ?? 0) + 1)
  }
  // A session must always retain at least one primary (main compound lift). With two
  // primaries, dropping one to fit the budget is legitimate — dropping the last is not.
  let remainingPrimaries = ordered.filter(e => e.role === 'primary').length

  const out: ReviewProposalExercise[] = []
  const droppedIds: string[] = []
  const adjustedIds: string[] = []

  for (const ex of ordered) {
    const before = currentParams.get(ex.sessionExerciseId) ?? null
    const model = modelById.get(ex.sessionExerciseId)
    const action = model?.action ?? 'keep'

    if (action === 'drop') {
      // Guard 1: keep at least one primary (main compound lift) in the session.
      if (ex.role === 'primary' && remainingPrimaries - 1 < 1) {
        out.push({
          sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
          action: 'keep', before, after: before,
          reason: 'Kept — a session needs at least one main compound lift.', guardAdjusted: true,
        })
        continue
      }
      // Guard 2: don't drop the last exercise covering an under-target muscle.
      const blockingMuscle = mainMuscles(ex).find(m => underTarget(m) && (coverage.get(m) ?? 0) - 1 < 1)
      if (blockingMuscle) {
        out.push({
          sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
          action: 'keep', before, after: before,
          reason: `Kept — it's your only ${blockingMuscle} work here and you're under your weekly ${blockingMuscle} target.`,
          guardAdjusted: true,
        })
        continue
      }
      // Drop allowed — decrement coverage (and the primary count) so later drops see it gone.
      for (const m of mainMuscles(ex)) coverage.set(m, (coverage.get(m) ?? 0) - 1)
      if (ex.role === 'primary') remainingPrimaries -= 1
      droppedIds.push(ex.sessionExerciseId)
      out.push({
        sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
        action: 'drop', before, after: null,
        reason: model?.dropReason?.trim() || 'Dropped to fit the time budget.', guardAdjusted: false,
      })
      continue
    }

    if (action === 'adjust' && model) {
      const after = clampShape(
        { sets: model.sets, reps: model.reps, pct: model.pct, restSec: model.restSec },
        ex.role,
      )
      // An "adjust" that changes nothing is just a keep — don't clutter the diff.
      if (before && shapesEqual(before, after)) {
        out.push({
          sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
          action: 'keep', before, after: before, reason: null, guardAdjusted: false,
        })
        continue
      }
      adjustedIds.push(ex.sessionExerciseId)
      out.push({
        sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
        action: 'adjust', before, after, reason: null, guardAdjusted: false,
      })
      continue
    }

    // keep (or a model omission)
    out.push({
      sessionExerciseId: ex.sessionExerciseId, name: ex.name, role: ex.role,
      action: 'keep', before, after: before, reason: null, guardAdjusted: false,
    })
  }

  // Projected duration over the surviving exercises, using each exercise's after shape.
  const byId = new Map(ordered.map(e => [e.sessionExerciseId, e]))
  let durationSec = 0
  for (const p of out) {
    if (p.action === 'drop' || !p.after) continue
    const sig = byId.get(p.sessionExerciseId)
    if (sig) durationSec += durationSecFor(sig, p.after)
  }
  const projectedDurationMin = Math.round(durationSec / 60)

  // Weekly-volume impact: net weighted set change per muscle (drops subtract, adjusts delta).
  const weeklyImpact: Record<string, number> = {}
  const addImpact = (ex: ReviewSignalExercise, setDelta: number) => {
    if (setDelta === 0) return
    for (const { muscle, weight } of ex.muscleContributions) {
      weeklyImpact[muscle] = (weeklyImpact[muscle] ?? 0) + setDelta * weight
    }
  }
  for (const p of out) {
    const sig = byId.get(p.sessionExerciseId)
    if (!sig) continue
    if (p.action === 'drop') addImpact(sig, -(p.before?.sets ?? 0))
    else if (p.action === 'adjust' && p.after) addImpact(sig, p.after.sets - (p.before?.sets ?? p.after.sets))
  }
  for (const k of Object.keys(weeklyImpact)) {
    weeklyImpact[k] = Math.round(weeklyImpact[k] * 10) / 10
    if (weeklyImpact[k] === 0) delete weeklyImpact[k]
  }

  return {
    exercises: out,
    projectedDurationMin,
    budgetMin,
    fitsBudget: projectedDurationMin <= budgetMin,
    weeklyImpact,
    droppedIds,
    adjustedIds,
    invalidIds,
  }
}
