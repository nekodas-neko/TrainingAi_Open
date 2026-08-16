// Time-budget enforcement for AI periodization prescriptions.
//
// The AI is asked to fit the session into its time budget, but that's a soft request.
// This module estimates the realistic duration (shared model: lib/workout/duration-model.ts)
// and trims sets (accessories first, never dropping an exercise) until the session fits.

import {
  setWorkSec,
  effectiveSetWorkSec,
  estimateExerciseDurationSec,
  estimateSessionDurationSec,
  estimateSessionDurationMin,
  SECONDS_PER_REP,
  SET_SETUP_SEC,
} from '@trainingai/shared/workout/duration-model'

import { sessionAnchorRole, roleCeiling } from '@trainingai/shared/ai-periodization/role-plausibility'

export {
  setWorkSec,
  effectiveSetWorkSec,
  estimateExerciseDurationSec,
  estimateSessionDurationSec,
  estimateSessionDurationMin,
  SECONDS_PER_REP,
  SET_SETUP_SEC,
}

export interface MuscleContribution { muscle: string; weight: number }

export interface TimedExercise {
  sessionExerciseId: string
  role: string
  sets: number
  reps: number
  restSec: number
  // Equipment-dependent per-exercise overhead — callers derive it via
  // transitionSecForEquipment(equipment) from the shared duration model.
  transitionSec: number
  // Optional: this exercise's muscle assignments (main=1.0, secondary=0.5), used to weigh
  // trim priority against weekly volume targets. Omitted callers (e.g. deload) get the
  // legacy role/time-cost-only ordering below.
  muscleGroups?: MuscleContribution[]
  // Measured overrides (lib/workout/time-profile.ts) — resolved by the caller from
  // the exercise's time profile + prescribed pct. Absent → constant model.
  measuredSecPerRep?: number | null
  measuredRestSec?: number | null
}

export interface MuscleVolumeState {
  // Sets already logged this week for this muscle, before this session.
  loggedBeforeSession: number
  // This muscle's weekly target (MAV) for the user's current goal/program.
  mav: number
}

// Minimum sets kept per role when trimming — compounds (primary) are never cut below 2
// working sets, so the main lift always survives; accessories can drop to a single set.
// No working exercise is ever trimmed below 2 sets — a single working set is too little
// stimulus for any role (an accessory bottoming out at 1 was how a main bodyweight pull
// mis-tagged 'accessory' got cut to one set, 2026-07-20). A session that still overruns its
// time budget at all-2s surfaces the "more exercises than the budget fits" note instead.
const SET_FLOOR: Record<string, number> = { primary: 2, secondary: 2, accessory: 2 }
const TRIM_ORDER = ['accessory', 'secondary', 'primary']

// How much of a role's built-in protection an outlier muscle imbalance must overcome to get
// trimmed ahead of a lower-priority role — see trimPriority. Accessory has none (it's already
// first); secondary and primary need progressively larger imbalances to jump the queue.
const ROLE_TRIM_BIAS: Record<string, number> = { accessory: 0, secondary: 0.3, primary: 0.5 }

function roleFloor(role: string): number {
  return SET_FLOOR[role] ?? 2
}

// How far over its weekly MAV an exercise's most-affected muscle would sit if it kept its
// current sets, as a fraction of that muscle's MAV — projected from sets already logged this
// week plus every other exercise's current (not-yet-trimmed) contribution in this session.
// Expressing it as a fraction (rather than raw sets) lets a small muscle (MAV 8) and a large
// one (MAV 18) compare on the same scale. Positive = over MAV; negative = still under MAV.
// 0 when there's no muscle data.
function muscleOverageRatio<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume: Map<string, MuscleVolumeState>,
): number {
  if (!exercise.muscleGroups?.length) return 0
  let worst: number | null = null
  for (const { muscle, weight } of exercise.muscleGroups) {
    const state = muscleVolume.get(muscle)
    if (!state || state.mav <= 0) continue
    const projected = state.loggedBeforeSession + all.reduce((sum, e) => {
      const w = e.muscleGroups?.find(m => m.muscle === muscle)?.weight ?? 0
      return sum + e.sets * w
    }, 0)
    const ratio = ((projected - state.mav) / state.mav) * weight
    if (worst === null || ratio > worst) worst = ratio
  }
  return worst ?? 0
}

// Combined trim priority: the muscle-overage ratio above, offset by a role bias. This is what
// lets a genuine volume outlier jump the accessory-first queue — e.g. a primary lift whose
// muscle is 17 sets into a 16-set MAV is a poor trim candidate on role alone, but if the only
// alternative is an accessory whose muscle sits at 4 of a 14-set MAV, the primary's overage
// ratio (~0.06) minus its bias (0.5) still beats the accessory's (~-0.71), so the primary gets
// cut instead — while a merely mild imbalance never clears the bias and role order holds.
function trimPriority<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume: Map<string, MuscleVolumeState>,
): number {
  return muscleOverageRatio(exercise, all, muscleVolume) - (ROLE_TRIM_BIAS[exercise.role] ?? ROLE_TRIM_BIAS.primary)
}

// Pick the next set to remove. Without muscle-volume data: the lowest-priority role that
// still has a removable set, and within that role whichever exercise's set removal frees the
// most time (the original, purely role-ordered behaviour — used verbatim by callers, like
// deload, that don't pass muscleVolume). With muscle-volume data: ranks every removable set
// (across all roles) by trimPriority, so an outlier imbalance can pull a cut out of a
// higher-priority role — see trimPriority. Ties fall back to time-cost. Either way, role
// floors are absolute (a primary is never touched below 2 sets), and protected exercises
// (those that earned an extra set via RPE autoregulation) are trimmed LAST — only once every
// non-protected set is at its floor — so an earned set steals time from lower-value work
// rather than deleting itself. Passing them again in a second pass preserves the budget
// guarantee for hopelessly-oversized sessions.
function pickTrimTarget<T extends TimedExercise>(
  exercises: T[],
  protectedIds: Set<string>,
  muscleVolume?: Map<string, MuscleVolumeState>,
): T | null {
  const timeCost = (e: TimedExercise): number =>
    effectiveSetWorkSec(e.reps, e.measuredSecPerRep) + (e.measuredRestSec ?? e.restSec)
  const byTimeCost = <U extends TimedExercise>(best: U, e: U): U =>
    timeCost(e) > timeCost(best) ? e : best

  for (const pass of [false, true] as const) {
    if (!muscleVolume) {
      for (const role of TRIM_ORDER) {
        const eligible = exercises.filter(
          e => e.role === role && e.sets > roleFloor(role) && (pass || !protectedIds.has(e.sessionExerciseId)),
        )
        if (eligible.length === 0) continue
        return eligible.reduce(byTimeCost)
      }
      continue
    }
    const eligible = exercises.filter(
      e => e.sets > roleFloor(e.role) && (pass || !protectedIds.has(e.sessionExerciseId)),
    )
    if (eligible.length === 0) continue
    return eligible.reduce((best, e) => {
      const eP = trimPriority(e, exercises, muscleVolume)
      const bestP = trimPriority(best, exercises, muscleVolume)
      if (eP !== bestP) return eP > bestP ? e : best
      return byTimeCost(best, e)
    })
  }
  return null
}

// Mirror of ROLE_TRIM_BIAS for growth. Primaries get the largest bonus, so extra time goes
// to the main lift first unless a muscle imbalance argues otherwise.
const ROLE_GROW_BIAS: Record<string, number> = { accessory: 0, secondary: 0.3, primary: 0.5 }

// Growth priority — the inverse of trimPriority. An exercise whose most-affected muscle is
// furthest BELOW its weekly MAV is the best place to spend extra time, offset by the role
// bonus so a primary still leads on an even week. Without muscle data it degrades to pure
// role order (primary → secondary → accessory), matching how trimming degrades.
function growPriority<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume?: Map<string, MuscleVolumeState>,
): number {
  const bias = ROLE_GROW_BIAS[exercise.role] ?? 0
  if (!muscleVolume) return bias
  return -muscleOverageRatio(exercise, all, muscleVolume) + bias
}

// Would growing this exercise by one set push any of its muscles past its maximum
// recoverable volume for the week? MRV is passed per muscle by the caller (volumeLandmarks);
// a muscle with no MRV entry is unconstrained. This is the hard stop that stops a long
// session from buying volume the lifter can't recover from.
function wouldBreachMrv<T extends TimedExercise>(
  exercise: T,
  all: T[],
  muscleVolume: Map<string, MuscleVolumeState>,
  mrvByMuscle: Map<string, number>,
): boolean {
  if (!exercise.muscleGroups?.length) return false
  for (const { muscle, weight } of exercise.muscleGroups) {
    const mrv = mrvByMuscle.get(muscle)
    if (mrv == null || mrv <= 0) continue
    const logged = muscleVolume.get(muscle)?.loggedBeforeSession ?? 0
    const inSession = all.reduce((sum, e) => {
      const w = e.muscleGroups?.find(m => m.muscle === muscle)?.weight ?? 0
      return sum + e.sets * w
    }, 0)
    if (logged + inSession + weight > mrv) return true
  }
  return false
}

// How far below its weekly MAV a muscle must sit before the session may break role order on
// VOLUME, on muscleOverageRatio's scale (a fraction of MAV; negative = under target). At -0.25
// a muscle a quarter below its weekly target may carry more sets than its exercise's role
// would normally allow. This is the knob deciding how eagerly the app breaks role order:
// toward 0 makes the exception routine, more negative makes it rare.
export const LAGGING_RATIO = -0.25

// Role plausibility on VOLUME, applied on every generation path.
//
// Two rules, in order:
//  1. The per-role SET_CEILING, which until now was consulted only by expandToBudget — so a
//     standard-preset session was bounded by nothing and the model could return any set count
//     for any role (production had an accessory at 5 sets against a 4-set primary).
//  2. Nothing outside the anchor role carries more sets than the anchor does — UNLESS its
//     muscle is genuinely behind for the week. That exception is the point: a lagging muscle
//     is corrected with volume, and role tags shouldn't outrank the week's actual needs.
//     Load is handled separately and has no such exception (a lagging muscle needs more sets,
//     never a heavier bar).
//
// The exception reuses muscleOverageRatio rather than defining "behind" a second time. Note
// that ratio reports the exercise's most OVER-target muscle, so a movement that trains a
// lagging muscle *and* an already-maxed one does not qualify — deliberate, not an off-by-one.
export function applyRoleSetPlausibility<T extends TimedExercise>(
  exercises: T[],
  muscleVolume?: Map<string, MuscleVolumeState>,
): T[] {
  const out = exercises.map(e => ({ ...e }))
  for (const e of out) e.sets = Math.min(e.sets, roleCeiling(e.role))

  const anchor = sessionAnchorRole(out.map(e => e.role))
  if (!anchor) return out
  const anchorSets = out.reduce((m, e) => (e.role === anchor ? Math.max(m, e.sets) : m), 0)
  if (anchorSets <= 0) return out

  for (const e of out) {
    if (e.role === anchor || e.sets <= anchorSets) continue
    if (muscleVolume && muscleOverageRatio(e, out, muscleVolume) <= LAGGING_RATIO) continue
    e.sets = Math.max(roleFloor(e.role), anchorSets)
  }
  return out
}

// Add sets while the estimated duration still fits the budget — the counterpart to
// fitToBudget, for when the lifter has MORE time than the program's standard session.
// Without it a raised budget simply returned the same plan and handed the surplus back.
//
// Growth is bounded three ways, in increasing order of severity: a per-role set ceiling
// (the AI's shape is the intent — deepen it, don't redesign it), the weekly MRV headroom
// (never buy unrecoverable volume), and the budget itself. Sets go to the muscle furthest
// below its weekly target first, so extra time closes the week's gaps rather than piling
// onto whatever is already well-trained. Returns a new array; inputs are not mutated.
export function expandToBudget<T extends TimedExercise>(
  exercises: T[],
  budgetMin: number,
  muscleVolume?: Map<string, MuscleVolumeState>,
  mrvByMuscle: Map<string, number> = new Map(),
): T[] {
  const budgetSec = Math.max(0, budgetMin) * 60
  const out = exercises.map(e => ({ ...e }))
  // Upper bound: every exercise from its current sets to its ceiling. +1 guards an empty list.
  const maxIters = out.reduce((n, e) => n + Math.max(0, roleCeiling(e.role) - e.sets), 0) + 1

  for (let i = 0; i < maxIters; i++) {
    const eligible = out.filter(e =>
      e.sets < roleCeiling(e.role)
      && !(muscleVolume && wouldBreachMrv(e, out, muscleVolume, mrvByMuscle)),
    )
    if (eligible.length === 0) break

    const target = eligible.reduce((best, e) => {
      const eP = growPriority(e, out, muscleVolume)
      const bestP = growPriority(best, out, muscleVolume)
      if (eP !== bestP) return eP > bestP ? e : best
      // Tie-break on the cheapest set, so a tie buys as much work as possible.
      const cost = (x: TimedExercise) =>
        effectiveSetWorkSec(x.reps, x.measuredSecPerRep) + (x.measuredRestSec ?? x.restSec)
      return cost(e) < cost(best) ? e : best
    })

    target.sets += 1
    if (estimateSessionDurationSec(out) > budgetSec) {
      // Undo: this set didn't fit. Another (cheaper) exercise still might, but the greedy
      // pick is already the best-value candidate, so stop rather than churn.
      target.sets -= 1
      break
    }
  }
  return out
}

// Fit a session into a budget that trimming alone cannot reach, by DROPPING whole exercises.
//
// fitToBudget deliberately never drops an exercise — for a normal session that is right, and
// an overrun surfaces as a note. But it makes a genuinely short session impossible: five
// exercises floored at two sets each still costs ~43 min, so "I have 30 minutes" returned a
// plan that took 40+. Cutting every exercise to a token two sets is also the wrong training
// answer; doing three exercises properly beats five badly.
//
// Only for an explicit short-session request. Drops in trim-priority order (the muscle
// furthest over its weekly MAV first, accessories before compounds — the same ordering that
// governs set trimming), re-trimming after each drop so it stops as soon as the remainder
// fits. Always keeps at least one exercise. Dropped ids flow into the prescription's existing
// `droppedExerciseIds`, which every render path already honours.
export function dropToBudget<T extends TimedExercise>(
  exercises: T[],
  budgetMin: number,
  protectedIds: Set<string> = new Set(),
  muscleVolume?: Map<string, MuscleVolumeState>,
): { exercises: T[]; droppedIds: string[] } {
  const budgetSec = Math.max(0, budgetMin) * 60
  let kept = fitToBudget(exercises, budgetMin, protectedIds, muscleVolume)
  const droppedIds: string[] = []

  while (kept.length > 1 && estimateSessionDurationSec(kept) > budgetSec) {
    // Highest trim priority = least valuable to keep. Without muscle data trimPriority
    // degrades to the role bias, so accessories go first — the same order as set trimming.
    const victim = kept.reduce((worst, e) =>
      trimPriority(e, kept, muscleVolume ?? new Map()) > trimPriority(worst, kept, muscleVolume ?? new Map())
        ? e : worst)
    droppedIds.push(victim.sessionExerciseId)
    // Re-trim from the ORIGINAL set counts of the survivors: dropping an exercise frees
    // time, so sets cut to fit the old, more crowded session should be given back.
    const survivorIds = new Set(kept.filter(e => e !== victim).map(e => e.sessionExerciseId))
    kept = fitToBudget(
      exercises.filter(e => survivorIds.has(e.sessionExerciseId)),
      budgetMin, protectedIds, muscleVolume,
    )
  }

  return { exercises: kept, droppedIds }
}

// Trim sets until the estimated duration fits the budget, or no set can be removed
// without breaching a role floor (best effort — a huge session in a tiny budget keeps
// the floors). `protectedIds` are trimmed last (see pickTrimTarget). `muscleVolume` (optional)
// makes trimming volume-aware — see pickTrimTarget/muscleOverage. Returns a new array; inputs
// are not mutated.
export function fitToBudget<T extends TimedExercise>(
  exercises: T[],
  budgetMin: number,
  protectedIds: Set<string> = new Set(),
  muscleVolume?: Map<string, MuscleVolumeState>,
): T[] {
  const budgetSec = Math.max(0, budgetMin) * 60
  const out = exercises.map(e => ({ ...e }))
  // Upper bound on iterations = total removable sets; the +1 guards an empty list.
  const maxIters = out.reduce((n, e) => n + e.sets, 0) + 1
  for (let i = 0; i < maxIters; i++) {
    if (estimateSessionDurationSec(out) <= budgetSec) break
    const target = pickTrimTarget(out, protectedIds, muscleVolume)
    if (!target) break
    target.sets -= 1
  }
  return out
}
