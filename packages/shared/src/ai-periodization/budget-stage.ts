// The deterministic tail of prescription generation: everything between "the model has
// answered" and "this is the plan". No model call, no randomness — given the same baseline
// set counts and the same signals it returns the same answer.
//
// It lives here rather than inline in generate-prescription.ts because a duration-preset
// change needs exactly this stage and nothing before it. Re-asking the model to fit a
// different budget cost ~30 s and a token spend for work that is pure arithmetic (RV-202 ②).

import {
  fitToBudget,
  expandToBudget,
  dropToBudget,
  applyRoleSetPlausibility,
  estimateSessionDurationMin,
  type MuscleContribution,
  type MuscleVolumeState,
} from '@trainingai/shared/ai-periodization/time-budget'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'
import { durationDirection, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'

/** One exercise as the budget stage receives it — its PRE-budget shape. `sets` is the only
 *  field the stage changes; reps/pct/restSec are read-only inputs to the duration estimate. */
export interface BudgetStageExercise {
  sessionExerciseId: string
  name: string
  sets: number
  reps: number
  pct: number
  restSec: number
}

export interface BudgetStageResult {
  /** Final set count per exercise — an entry for every input, dropped ones included (they
   *  keep their prescription entry and are filtered at render). */
  sets: Map<string, number>
  droppedIds: Set<string>
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
  /** Appended verbatim to the model's reasoning. Empty when the plan fits with nothing
   *  dropped — kept as a separate return value so a RE-fit replaces the previous note
   *  instead of stacking a second one onto it. */
  budgetNote: string
}

export function applyBudgetStage(
  exercises: BudgetStageExercise[],
  signals: PrescriptionSignals,
  /** The session's OWN configured length, not the requested one — `durationDirection`
   *  compares the two, and `signals.effectiveTimeBudgetMin` already carries the request. */
  sessionTimeBudgetMin: number,
  durationPreset: DurationPreset | undefined,
  /** Exercises that earned a set through RPE autoregulation — trimmed last, so an earned
   *  set funds itself from lower-value work rather than deleting itself. */
  earnedSetIds: Set<string>,
): BudgetStageResult {
  // Time-budget enforcement — the AI is asked to fit the budget, but trim deterministically
  // so the session is guaranteed to fit the allocated time. Sets are cut by muscle-overage
  // priority, biased toward accessories first (see fitToBudget/trimPriority) — normally
  // accessories still go first, but a severe cross-tier imbalance (e.g. a primary's muscle
  // well past its weekly MAV while an accessory's is badly undertrained) can pull the cut out
  // of a higher-priority role instead. Role floors are absolute either way — a primary is
  // never touched below 2 sets. Duration is estimated from the prescribed reps and rest, so
  // it reflects the actual longest-case session.
  const muscleVolume = new Map<string, MuscleVolumeState>(
    Object.entries(signals.weeklyTargets).map(([muscle, mav]) => [
      muscle,
      { loggedBeforeSession: signals.weeklyLogged[muscle] ?? 0, mav },
    ]),
  )
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  const timedExercises = exercises.map(ex => {
    const sig = sigById.get(ex.sessionExerciseId)
    const muscleGroups: MuscleContribution[] = (sig?.muscleAssignments ?? []).map(ma => ({
      muscle: normalizeMuscle(ma.muscle),
      weight: ma.role === 'main' ? 1.0 : 0.5,
    }))
    return {
      sessionExerciseId: ex.sessionExerciseId,
      role: sig?.role ?? 'primary',
      sets: ex.sets,
      reps: ex.reps,
      restSec: ex.restSec,
      transitionSec: sig?.transitionSec ?? 240,
      muscleGroups,
      measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
      measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
    }
  })

  // Role plausibility on volume runs BEFORE the budget passes, so every preset gets it and the
  // plan is already the right shape when trimming/expansion start — rather than relying on them
  // to repair a shape the model chose blind.
  const plausible = applyRoleSetPlausibility(timedExercises, muscleVolume)

  // BF-7 PR 2a: branch on the DIRECTION today runs in, not on the label. `short`/`long` were only
  // ever a proxy for "shorter than the session" / "longer than the session", and reading the label
  // is what stops the ladder growing past three rungs.
  const direction = durationDirection(sessionTimeBudgetMin, durationPreset)

  // A short session is the one case where trimming alone can't reach the budget — five
  // exercises floored at two sets still overrun a 30-minute ask, and two token sets each is
  // worse training than doing fewer exercises properly. dropToBudget drops whole exercises
  // in trim-priority order; they ride out on the prescription's existing droppedExerciseIds,
  // which every render path already honours.
  const dropped = direction < 0
    ? dropToBudget(plausible, signals.effectiveTimeBudgetMin, earnedSetIds, muscleVolume)
    : null
  const trimmed = dropped?.exercises ?? fitToBudget(
    plausible,
    signals.effectiveTimeBudgetMin,
    earnedSetIds,
    muscleVolume,
  )
  const droppedIds = new Set(dropped?.droppedIds ?? [])

  // Filling the budget is the 'long' preset's whole point: fitToBudget only removes sets, so
  // without this a 90-minute session returned the 60-minute plan and handed the surplus back.
  //
  // Gated on an EXPLICIT long request, never run on a standard session. The duration model
  // is deliberately conservative (duration-model.ts) and that under-fill IS the finish-early
  // margin — the owner's sessions land on time because of it. Expanding by default would
  // spend exactly that margin.
  let sized = trimmed
  if (direction > 0) {
    const mrvByMuscle = new Map<string, number>(
      [...new Set(timedExercises.flatMap(e => (e.muscleGroups ?? []).map(m => m.muscle)))]
        .map(muscle => [muscle, volumeLandmarks(signals.trainingGoal, muscle).mrv]),
    )
    sized = expandToBudget(trimmed, signals.effectiveTimeBudgetMin, muscleVolume, mrvByMuscle)
  }

  const fittedSets = new Map(sized.map(f => [f.sessionExerciseId, f.sets]))
  // A DROPPED exercise is absent from `sized`, so falling back to the model's count would hand
  // back its raw, un-capped number — production stored an accessory at 5 sets (its ceiling is 4)
  // that way. Dropped entries are still kept in the prescription (droppedExerciseIds filters at
  // render), so they must carry a plausible shape too. Fall back to the role-capped counts.
  const plausibleSets = new Map(plausible.map(p => [p.sessionExerciseId, p.sets]))
  const sets = new Map<string, number>(
    exercises.map(ex => [
      ex.sessionExerciseId,
      fittedSets.get(ex.sessionExerciseId)
        ?? plausibleSets.get(ex.sessionExerciseId)
        ?? ex.sets,
    ]),
  )

  // Dropped exercises keep their prescription entry (the Workout Review "drop this cycle"
  // convention — droppedExerciseIds filters at render), so every derived total below must
  // exclude them explicitly or the session would be costed for work it won't do.
  const activeExercises = exercises.filter(ex => !droppedIds.has(ex.sessionExerciseId))
  const estimatedSessionDurationMin = estimateSessionDurationMin(
    activeExercises.map(ex => {
      const sig = sigById.get(ex.sessionExerciseId)
      return {
        sets: sets.get(ex.sessionExerciseId) ?? ex.sets,
        reps: ex.reps,
        restSec: ex.restSec,
        transitionSec: sig?.transitionSec ?? 240,
        measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
        measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
      }
    }),
  )

  let budgetNote = ''
  if (droppedIds.size > 0) {
    const names = exercises
      .filter(ex => droppedIds.has(ex.sessionExerciseId)).map(ex => ex.name).join(', ')
    budgetNote = ` To fit the ${signals.effectiveTimeBudgetMin}-min working budget, ${names} ${droppedIds.size === 1 ? 'was' : 'were'} dropped for today — the muscles furthest ahead of their weekly target — so the remaining work keeps full sets rather than every exercise being cut to a token two.`
  } else if (estimatedSessionDurationMin > signals.effectiveTimeBudgetMin) {
    budgetNote = ` Note: even at minimum sets this session is estimated at ${estimatedSessionDurationMin} min against the ${signals.effectiveTimeBudgetMin}-min working budget — it has more exercises than the time budget fits. Consider removing an accessory from this session or raising its time budget.`
  }

  const weeklyVolumeContribution: Record<string, number> = {}
  for (const ex of activeExercises) {
    const signal = sigById.get(ex.sessionExerciseId)
    if (!signal) continue
    for (const ma of signal.muscleAssignments) {
      const weight = ma.role === 'main' ? 1.0 : 0.5
      // Deliberately `.toLowerCase()` and not `normalizeMuscle` — this map is keyed the way
      // every existing consumer of weeklyVolumeContribution reads it. The muscleGroups above
      // normalise because trim priority joins them against `signals.weeklyTargets`.
      const muscle = ma.muscle.toLowerCase()
      weeklyVolumeContribution[muscle] = (weeklyVolumeContribution[muscle] ?? 0) + (sets.get(ex.sessionExerciseId) ?? ex.sets) * weight
    }
  }

  return { sets, droppedIds, estimatedSessionDurationMin, weeklyVolumeContribution, budgetNote }
}
