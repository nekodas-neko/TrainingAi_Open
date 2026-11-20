// The deterministic tail of prescription generation: everything between "the model has
// answered" and "this is the plan". No model call, no randomness — given the same baseline
// set counts and the same signals it returns the same answer.
//
// It lives here rather than inline in generate-prescription.ts because a duration-preset
// change needs exactly this stage and nothing before it. Re-asking the model to fit a
// different budget cost ~30 s and a token spend for work that is pure arithmetic (RV-202 ②).

import {
  allocateToBudget,
  applyRoleSetPlausibility,
  shortSessionRestSec,
  SHORT_SESSION_REST_FLOOR_SEC,
  type MuscleContribution,
  type MuscleVolumeState,
} from '@trainingai/shared/ai-periodization/time-budget'
import { resolveMeasuredRestSec } from '@trainingai/shared/workout/time-profile'
import { normalizeMuscle } from '@trainingai/shared/muscles'
import { volumeLandmarks } from '@trainingai/shared/ai-periodization/volume-targets'
import { durationDirection, fitBudgetMin, fitBudgetWholeMin, type DurationPreset } from '@trainingai/shared/workout/duration-model'
import type { PrescriptionSignals } from '@trainingai/shared/ai-periodization/signals'
import { UNCLASSIFIED_EXERCISE_ROLE } from '@trainingai/shared/workout/exercise-role'
import { prescriptionFigures } from '@trainingai/shared/ai-periodization/prescription-figures'
import { phaseSetsMax } from '@trainingai/shared/ai-periodization/prompt'
import { capitalize } from '@trainingai/shared/format/capitalize'
import type { PrescriptionFigures } from '@trainingai/shared/types/ai-periodization'

/** One exercise as the budget stage receives it — its PRE-budget shape. The stage changes `sets`,
 *  and `restSec` on a shorter-than-usual day (#2284); reps/pct are read-only inputs. */
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
  /** Rest per exercise as prescribed today — shortened for accessory/secondary work when today is
   *  shorter than the session, otherwise the input rest. An entry for every input. */
  restSec: Map<string, number>
  droppedIds: Set<string>
  estimatedSessionDurationMin: number
  weeklyVolumeContribution: Record<string, number>
  /** The work time, in whole minutes, the plan was fitted against — the one budget the plan's
   *  text names (#3767). 0 when the session has no time limit. */
  fittedBudgetMin: number
  /** Appended verbatim to the model's reasoning. Empty when the plan fits with nothing
   *  dropped — kept as a separate return value so a RE-fit replaces the previous note
   *  instead of stacking a second one onto it. */
  budgetNote: string
  /** The same two figures under the `Full` override — present only when `fullShapeById` named a row. */
  fullSession?: PrescriptionFigures
}

/**
 * Weekly volume state keyed by muscle — what `trimPriority` weighs a cut against.
 *
 * Exported (RV-204) because the Workout Review runs the SAME trim on the same inputs and a
 * second construction of this map is a second place for the two to disagree.
 */
export function buildBudgetMuscleVolume(signals: PrescriptionSignals): Map<string, MuscleVolumeState> {
  return new Map<string, MuscleVolumeState>(
    Object.entries(signals.weeklyTargets).map(([muscle, mav]) => [
      muscle,
      { loggedBeforeSession: signals.weeklyLogged[muscle] ?? 0, mav },
    ]),
  )
}

/**
 * The pre-budget `TimedExercise[]` — each exercise's shape joined to its signal's transition
 * cost, muscle assignments and measured time profile. Exported for the same reason as above.
 */
export function buildTimedExercises(
  exercises: BudgetStageExercise[],
  signals: PrescriptionSignals,
) {
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))
  return exercises.map(ex => {
    const sig = sigById.get(ex.sessionExerciseId)
    const muscleGroups: MuscleContribution[] = (sig?.muscleAssignments ?? []).map(ma => ({
      muscle: normalizeMuscle(ma.muscle),
      weight: ma.role === 'main' ? 1.0 : 0.5,
    }))
    return {
      sessionExerciseId: ex.sessionExerciseId,
      role: sig?.role ?? UNCLASSIFIED_EXERCISE_ROLE,
      sets: ex.sets,
      reps: ex.reps,
      restSec: ex.restSec,
      transitionSec: sig?.transitionSec ?? 240,
      muscleGroups,
      measuredSecPerRep: sig?.timeProfile?.secPerRep ?? null,
      measuredRestSec: sig?.timeProfile ? resolveMeasuredRestSec(sig.timeProfile, ex.pct) : null,
    }
  })
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
  /** #2403: the full numbers (`preDeload`) of each row a deload cut, so the result can carry the
   *  figures for the session the `Full` override trains. Omitted or empty: no `fullSession`. */
  fullShapeById?: ReadonlyMap<string, { sets: number; reps: number; pct: number; restSec: number }>,

  phase?: string | null,
): BudgetStageResult {
  // Time-budget enforcement — the AI is asked to fit the budget, but trim deterministically
  // so the session is guaranteed to fit the allocated time. Sets are cut by muscle-overage
  // priority, biased toward accessories first (see fitToBudget/trimPriority) — normally
  // accessories still go first, but a severe cross-tier imbalance (e.g. a primary's muscle
  // well past its weekly MAV while an accessory's is badly undertrained) can pull the cut out
  // of a higher-priority role instead. Role floors are absolute either way — a primary is
  // never touched below 2 sets. Duration is estimated from the prescribed reps and rest, so
  // it reflects the actual longest-case session.
  const muscleVolume = buildBudgetMuscleVolume(signals)
  const sigById = new Map(signals.exercises.map(e => [e.sessionExerciseId, e]))

  // BF-7 PR 2a: branch on the DIRECTION today runs in, not on the label. `short`/`long` were only
  // ever a proxy for "shorter than the session" / "longer than the session", and reading the label
  // is what stops the ladder growing past three rungs.
  const direction = durationDirection(sessionTimeBudgetMin, durationPreset)

  // #2284: on a shorter day, accessory and secondary rest is shortened before anything is fitted,
  // so the fit sees the session the lifter will actually run. A MEASURED rest is scaled by the same
  // ratio — it was learned against the longer timer, and planning on it unscaled would leave the
  // fit exactly where it was, so the shorter rest would buy no exercise back (the whole point,
  // measured before the owner chose it). It keeps the same floor unless he already rests under it.
  const restSec = new Map(exercises.map(ex => [
    ex.sessionExerciseId,
    shortSessionRestSec(ex.restSec, sigById.get(ex.sessionExerciseId)?.role ?? UNCLASSIFIED_EXERCISE_ROLE, direction),
  ]))
  const inputById = new Map(exercises.map(ex => [ex.sessionExerciseId, ex]))
  const timedExercises = buildTimedExercises(exercises, signals).map(t => {
    const before = inputById.get(t.sessionExerciseId)?.restSec ?? t.restSec
    const after = restSec.get(t.sessionExerciseId) ?? t.restSec
    if (after === before || before <= 0) return t
    const measured = t.measuredRestSec == null
      ? null
      : t.measuredRestSec <= SHORT_SESSION_REST_FLOOR_SEC
        ? t.measuredRestSec
        : Math.max(SHORT_SESSION_REST_FLOOR_SEC, t.measuredRestSec * (after / before))
    return { ...t, restSec: after, measuredRestSec: measured }
  })
  const timedById = new Map(timedExercises.map(t => [t.sessionExerciseId, t]))

  // Fitted against the budget less the lifter's p75 margin (#2132); shown against the working one.
  const fitMin = fitBudgetMin(signals)

  // Role plausibility on volume runs BEFORE the budget passes, so every preset gets it and the
  // plan is already the right shape when trimming/expansion start — rather than relying on them
  // to repair a shape the model chose blind.
  // #3713: the phase's set range is held in code, not just stated in the prompt.
  const setsCap = phaseSetsMax(signals.trainingGoal, phase)
  const plausible = applyRoleSetPlausibility(timedExercises, muscleVolume, setsCap)

  //
  const mrvByMuscle = new Map<string, number>(
    [...new Set(timedExercises.flatMap(e => (e.muscleGroups ?? []).map(m => m.muscle)))]
      .map(muscle => [muscle, volumeLandmarks(signals.trainingGoal, muscle).mrv]),
  )
  const allocated = allocateToBudget(plausible, fitMin, {
    protectedIds: earnedSetIds,
    frozenIds: new Set(fullShapeById?.keys() ?? []),
    muscleVolume,
    mrvByMuscle,
    phase,
    phaseSetsMax: setsCap,
  })
  const sized = allocated.exercises
  const droppedIds = new Set(allocated.droppedIds)

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
  // As the stage leaves them — trimmed sets, today's rest, and the measured rest scaled with it.
  const asStaged = activeExercises.map(ex => ({
    sessionExerciseId: ex.sessionExerciseId,
    sets: sets.get(ex.sessionExerciseId) ?? ex.sets,
    reps: ex.reps,
    pct: ex.pct,
    restSec: restSec.get(ex.sessionExerciseId) ?? ex.restSec,
    measuredRestSec: timedById.get(ex.sessionExerciseId)?.measuredRestSec ?? null,
  }))
  const { estimatedSessionDurationMin, weeklyVolumeContribution } = prescriptionFigures(asStaged, signals)

  // #3767: the plan names ONE time budget, and it is the one the fit above actually used. Naming
  // the working budget here (51 on a 60-minute session) while fitting against the planning budget
  // (51 less the lifter's p75 margin, e.g. 39) is how a plan said "to fit the 51-min working
  // budget, X was dropped" while estimating itself at 35 — true of neither number. The estimate is
  // the same median-pace figure the fit compared against `fitMin`, so it can never exceed this one.
  // Rounded down, as the prompt states it to the model (`fitBudgetWholeMin`), so the two agree.
  const fittedBudgetMin = fitBudgetWholeMin(signals)
  const marginTaken = fitMin < signals.effectiveTimeBudgetMin
  const budgetPhrase = marginTaken
    ? `about ${fittedBudgetMin} min of work (the session's time less warm-up, and less a margin so a slower-than-usual day still finishes on time)`
    : `about ${fittedBudgetMin} min of work (the session's time less warm-up)`

  const notes: string[] = []
  const shortened = activeExercises.filter(ex => (restSec.get(ex.sessionExerciseId) ?? ex.restSec) < ex.restSec)
  if (shortened.length > 0) {
    notes.push(`Rest on ${shortened.map(ex => ex.name).join(', ')} is cut by a quarter for the shorter session (never under ${SHORT_SESSION_REST_FLOOR_SEC} s); the main lift keeps its full rest.`)
  }
  if (droppedIds.size > 0) {
    const names = exercises
      .filter(ex => droppedIds.has(ex.sessionExerciseId)).map(ex => ex.name).join(', ')
    notes.push(`To keep today's plan to ${budgetPhrase}, ${names} ${droppedIds.size === 1 ? 'was' : 'were'} dropped for today — accessories go first, then whatever trains the muscles furthest ahead of their weekly target — so the remaining work keeps more of its sets rather than every exercise being cut to a token two.`)
  }
  // The estimate is a whole minute rounded to nearest, so it is compared with the fit's figure
  // rounded the same way: a 46 against 45.8 planned is the fit landing on budget, not an overrun.
  if (fittedBudgetMin > 0 && estimatedSessionDurationMin > Math.round(fitMin)) {
    // The estimate is at the lifter's median pace and the planned figure already holds back a
    // margin for a slower day. Past the planned figure but inside the working budget, a usual day
    // still finishes on time and only a slower one runs over; past the working budget, even a usual
    // day does.
    const overrun = estimatedSessionDurationMin > signals.effectiveTimeBudgetMin
      ? 'expect to run over'
      : 'a slower-than-usual day may run over'
    notes.push(droppedIds.size > 0
      ? `Even so, the ${activeExercises.length} exercises kept are estimated at ${estimatedSessionDurationMin} min of work against the ${fittedBudgetMin} planned — a session is never cut below ${activeExercises.length}, so ${overrun}.`
      : `Note: even at minimum sets this session is estimated at ${estimatedSessionDurationMin} min of work against the ${fittedBudgetMin} planned, so ${overrun} — it has more exercises than the time budget fits. Consider removing an accessory from this session or raising its time budget.`)
  }
  const budgetNote = notes.map(n => ` ${n}`).join('')

  // #2403: the session `Full` trains. A deloaded row goes back to its recorded full numbers — which
  // the stage never touched, so neither are their rest or measured rest — and every other row runs
  // as staged. Only when the caller has a row to put back; otherwise there is no second session.
  const fullSession = fullShapeById && fullShapeById.size > 0
    ? prescriptionFigures(asStaged.map(row => {
        const full = fullShapeById.get(row.sessionExerciseId)
        return full ? { sessionExerciseId: row.sessionExerciseId, ...full } : row
      }), signals)
    : undefined

  return {
    sets, restSec, droppedIds, estimatedSessionDurationMin, weeklyVolumeContribution, fittedBudgetMin, budgetNote,
    ...(fullSession && { fullSession }),
  }
}

// A minutes figure — "within the 39-minute budget", "about 45 min". Seconds ("90 s rest") never
// match. Code owns what the plan says about the session's time (`budgetNote`), so a model clause
// stating minutes is removed (#3767) — but only that clause, and never one about rest between sets
// ("Rest 3 minutes between heavy sets" is a prescription, not a session length).
const MINUTES_FIGURE = /\b\d+(?:\.\d+)?\s*-?\s*(?:min|mins|minute|minutes)\b/i
const ABOUT_REST = /\brest(?:s|ed|ing)?\b/i
const statesSessionMinutes = (text: string) => MINUTES_FIGURE.test(text) && !ABOUT_REST.test(text)

// Sentence ends: terminal punctuation, then space, then a capital or an opening quote. "approx. 40
// min" and "72.5%" therefore stay inside one sentence, so a removal never leaves "Sets held at
// approx." behind.
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=["'(A-Z])/
// Clause joints inside a sentence: ", and", ", but", ", so", ", while", ";", " — ".
const CLAUSE_BREAK = /(,\s+(?:and|but|so|while)\s+|;\s+|\s+—\s+)/

/** One sentence with its minutes clauses removed; '' when nothing of it is left. */
function withoutMinutesClauses(sentence: string): string {
  if (!statesSessionMinutes(sentence)) return sentence
  const end = /[.!?]$/.exec(sentence)?.[0] ?? ''
  const body = end ? sentence.slice(0, -1) : sentence
  // split with a capture group interleaves the joints: [clause, joint, clause, joint, clause].
  const parts = body.split(CLAUSE_BREAK)
  const clauses = parts.filter((_, i) => i % 2 === 0)
  let out = ''
  for (let i = 0; i < clauses.length; i++) {
    if (statesSessionMinutes(clauses[i])) continue
    // The joint before a clause goes with it, unless it now opens the sentence.
    out += out === '' ? clauses[i].trim() : `${parts[2 * i - 1]}${clauses[i]}`
  }
  if (out === '') return ''
  // A later clause that now opens the sentence starts with a capital.
  return `${capitalize(out.trim())}${end}`
}

/**
 * The model's reasoning with every clause that states the session's minutes removed, then the
 * code-owned budget note appended. The one place a plan's reasoning is assembled, for generation
 * and re-fit alike, so a re-fit of a plan stored before #3767 drops the model's minutes too.
 */
export function reasoningWithBudgetNote(modelReasoning: string, budgetNote: string): string {
  const kept = modelReasoning.trim().split(SENTENCE_BREAK).map(withoutMinutesClauses).filter(Boolean).join(' ')
  return `${kept}${budgetNote}`.trim()
}
