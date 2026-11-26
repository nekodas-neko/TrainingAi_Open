/**
 * The session read (#3889, step 1 #3893): a code rule that judges an exercise's last session from
 * its reps, sets, rest, effort answer and, on dense heart-rate days, recovery, and gives one verdict
 * for the next session.
 *
 * IN SHADOW. Nothing reads a verdict to build a prescription yet: generation stores it beside the
 * plan (`AiPrescription.sessionReads`) and the admin replay counts what it would have changed. Going
 * live is step 4 of #3889, after the owner has seen those counts.
 *
 * The rules are the owner's gradient (#3889, 20 Nov, which replaced the design's rules 1 and 2):
 *   1. Each missed set is paired with the rest BEFORE it — the previous set's `rest_time_sec`
 *      against that set's `planned_rest_sec` (a set's own value is the rest after it). That rest
 *      excuses up to 0, 1 or 2 missed reps. The first set gets no excuse.
 *   2. What is left, summed over the sets, is the unexplained miss, also read as a share of the
 *      session's target reps.
 *   3. Its size picks the band: none (the rest explains it) → same weight, rest the full time;
 *      small → same weight; clear → one step down; large → two steps down.
 *   The effort answer (#3745) moves the band one step: harder toward down; easier with a miss reads
 *   as a likely logging slip and holds. With every rep met: harder holds, easier adds a step, a beaten
 *   set adds weight as today, and on dense heart-rate days a heart rate that did not settle holds.
 *
 * Missing data never counts against the lifter: an unknown rest excuses the miss, an effort left on
 * its default is no answer, and heart rate is read only when the workout's was dense. Every path
 * that cannot judge returns `too-little-data` with the reason, never a guess.
 *
 * Every number below is a starting value from #3889's design and the owner's 20 Nov comments, kept
 * here so a later refit changes one constant.
 */
import { expectedRpe } from './expected-rpe'
import { RPE_DEAD_BAND } from './autoregulation'
import { mroundStepUp } from '../workout/load-rounding'
import { isReportedRpe } from '../workout/rpe-source'

// ── Thresholds ───────────────────────────────────────────────────────────────────────────────

/** Rest taken ÷ planned at or above this is a full rest: it excuses no missed rep. */
export const REST_FULL_RATIO = 0.8
/** At or above this (and under full) the rest excuses up to `EXCUSE_PARTIAL_REST` reps; under it, up to `EXCUSE_SHORT_REST`. */
export const REST_HALF_RATIO = 0.5
export const EXCUSE_PARTIAL_REST = 1
export const EXCUSE_SHORT_REST = 2
/** An unexplained miss of this many reps or fewer is small, unless its share is clear or large. */
export const SMALL_MISS_MAX_REPS = 1
/** A share of the target reps at or above this is a clear miss. */
export const CLEAR_MISS_SHARE = 0.15
/** A share above this is a large miss. */
export const LARGE_MISS_SHARE = 0.35
/** A first set missed by this many reps or more is a large miss, whatever its share. */
export const FIRST_SET_LARGE_MISS_REPS = 3
/** Fewer comparable sets (sets with planned reps) than this and the read cannot judge. */
export const MIN_COMPARABLE_SETS = 2
/** Dense heart-rate days only: this share of measured rests not settling holds the weight. */
export const HR_NOT_RECOVERED_SHARE = 0.5
/** The last set is pre-filled at planned + 1 (or pushed as AMRAP): it is beaten only at planned + this. */
export const LAST_SET_BEAT_OVER_PLANNED = 2
/** A set lifted heavier than planned by more than this many equipment steps is the lifter's own choice. */
export const SELF_HEAVIER_STEPS = 1
/** Hand-rated sets needed for "comfortable" (each at least `RPE_DEAD_BAND` under the expected effort). */
export const RATED_EASY_MIN_SETS = 2

// ── Inputs ───────────────────────────────────────────────────────────────────────────────────

export interface SessionReadSet {
  setNumber: number
  reps: number
  weightKg: number
  plannedReps: number | null
  plannedWeightKg: number | null
  plannedPct: number | null
  /** The rest AFTER this set (`set_logs.rest_time_sec`). */
  restTimeSec: number | null
  plannedRestSec: number | null
  rpe: number | null
  rpeSource: string | null
  /** #4159: how this set felt (−1 / 0 / +1) and who chose it. Carried as evidence beside the reps and weight; no rule here reads it. */
  setEffortVsPlan?: number | null
  setEffortSource?: string | null
  /** `set_hr_stats` for the rest after this set; read only when the workout's heart rate was dense. */
  hr?: { recoveredPreset: boolean | null; restAdequate: boolean | null; coverageOk: boolean } | null
}

export interface SessionReadInput {
  sets: readonly SessionReadSet[]
  /** The after-the-last-set answer: −1 easier, 0 as expected, +1 harder, and who chose it. */
  effort: { vsPlan: number | null; source: string | null } | null
  /** `workout_hr_stats.hr_dense` as stored; anything but `true` means heart rate is not read. */
  hrDense: boolean | null
  /** The equipment's plate step (`weightStepFor`). */
  weightStepKg: number
  /** The top of the goal's rep band for this role; unknown means "add reps" cannot fire. */
  repCeiling?: number | null
  /** The session was an override of the plan: not comparable with what was asked. */
  overridden?: boolean
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────

export type SetClass = 'met' | 'beat' | 'miss' | 'miss-self-heavier' | 'unplanned'
export type MissBand = 'none' | 'small' | 'clear' | 'large'
export type SessionVerdict =
  | 'too-little-data' | 'reduce' | 'hold-rest-more' | 'hold-recovery' | 'progress-load' | 'progress-reps' | 'hold'
/** What the next bar would be built from: today's basis, the last session's bar held, or steps from it. */
export type NextLoad = 'as-today' | 'hold' | 'down-1' | 'down-2' | 'up-1'
export type TooLittleDataWhy = 'no-sets' | 'too-few-planned-sets' | 'overridden'

export interface SessionReadSetResult {
  setNumber: number
  cls: SetClass
  missReps: number
  /** Missed reps the rest before the set explains (or all of them when that rest is unknown or the weight was the lifter's choice). */
  excusedReps: number
  /** Rest before ÷ planned rest before; null for the first set and wherever either figure is missing. */
  restBeforeRatio: number | null
}

export interface SessionRead {
  verdict: SessionVerdict
  nextLoad: NextLoad
  /** Set only for `too-little-data`. */
  why?: TooLittleDataWhy
  /** Null when no set was missed. */
  band: MissBand | null
  unexplainedReps: number
  targetReps: number
  /** The effort answer that counted (tapped only), else null. */
  effort: -1 | 0 | 1 | null
  /** A set was excused by a short rest before it. */
  restShort: boolean
  /** Easier than expected with a miss: likely a logging slip (owner, 20 Nov). */
  easierWithMiss: boolean
  /** Dense heart rate was read. */
  hrRead: boolean
  sets: SessionReadSetResult[]
}

/** A read as stored beside a plan (`AiPrescription.sessionReads`). */
export interface StoredSessionRead extends SessionRead {
  sessionExerciseId: string
  exerciseName: string
  /** The workout the read judged. */
  workoutSessionId: string
  /** #3890: last week's check-in answered "Heavy" for this lift, so the read never adds load
   *  (`holdUnderCheckin`). Absent otherwise. */
  checkinHeld?: true
}

// ── The rules ────────────────────────────────────────────────────────────────────────────────

/** Missed reps the rest before a set can excuse, from rest taken ÷ planned. */
export function restExcuse(ratio: number): number {
  if (ratio >= REST_FULL_RATIO) return 0
  if (ratio >= REST_HALF_RATIO) return EXCUSE_PARTIAL_REST
  return EXCUSE_SHORT_REST
}

function ratioOf(rest: number | null, planned: number | null): number | null {
  if (rest == null || planned == null || !(planned > 0) || rest < 0) return null
  return rest / planned
}

/** The band of an unexplained miss: by its reps or its share, whichever is the larger (the owner's "or"). */
export function missBand(unexplainedReps: number, targetReps: number, firstSetMissReps: number): MissBand {
  if (unexplainedReps <= 0) return 'none'
  const share = targetReps > 0 ? unexplainedReps / targetReps : 1
  if (share > LARGE_MISS_SHARE || firstSetMissReps >= FIRST_SET_LARGE_MISS_REPS) return 'large'
  if (unexplainedReps > SMALL_MISS_MAX_REPS || share >= CLEAR_MISS_SHARE) return 'clear'
  return 'small'
}

const BAND_ORDER: MissBand[] = ['none', 'small', 'clear', 'large']
/** Harder than expected moves a miss one band toward down. "None" (the rest explains it) stays. */
function harder(band: MissBand): MissBand {
  if (band === 'none') return band
  return BAND_ORDER[Math.min(BAND_ORDER.length - 1, BAND_ORDER.indexOf(band) + 1)]
}

/** Effort counts only when the lifter chose it. */
function countedEffort(effort: SessionReadInput['effort']): -1 | 0 | 1 | null {
  if (!effort || effort.source !== 'tapped') return null
  return effort.vsPlan === -1 || effort.vsPlan === 0 || effort.vsPlan === 1 ? effort.vsPlan : null
}


function tooLittle(why: TooLittleDataWhy, sets: SessionReadSetResult[] = []): SessionRead {
  return {
    verdict: 'too-little-data', nextLoad: 'as-today', why, band: null, unexplainedReps: 0, targetReps: 0,
    effort: null, restShort: false, easierWithMiss: false, hrRead: false, sets,
  }
}

/**
 * One set against the plan: the per-set rule of the read, and of the weekly check-in's "missed rep"
 * (`unexcusedMissAtPlan`), so the two cannot disagree about what a miss is. `prev` is the set before
 * (its rest is the rest before this one); `isFirst` and `isLast` place it in the session, by set number.
 *   - unplanned: no planned reps (a freeform or extra set).
 *   - met / beat: the planned reps, or more (the last set beats at +2, any other at +1).
 *   - miss-self-heavier: short, at more than one plate step over the planned weight (the lifter's choice;
 *     every rep excused).
 *   - miss: short. The first set has no rest before it, so nothing is excused; an unknown rest excuses
 *     every rep (design §3A.4); a short rest excuses up to `restExcuse` reps.
 */
export function classifySet(
  set: SessionReadSet, prev: SessionReadSet | null, isLast: boolean, isFirst: boolean, weightStepKg: number,
): SessionReadSetResult {
  const restBeforeRatio = prev ? ratioOf(prev.restTimeSec, prev.plannedRestSec) : null
  const planned = set.plannedReps
  if (planned == null || !(planned > 0)) {
    return { setNumber: set.setNumber, cls: 'unplanned', missReps: 0, excusedReps: 0, restBeforeRatio }
  }
  if (set.reps >= planned) {
    const beat = isLast ? set.reps >= planned + LAST_SET_BEAT_OVER_PLANNED : set.reps >= planned + 1
    return { setNumber: set.setNumber, cls: beat ? 'beat' : 'met', missReps: 0, excusedReps: 0, restBeforeRatio }
  }
  const missReps = planned - set.reps
  const step = weightStepKg > 0 ? weightStepKg : 0
  const selfHeavier = set.plannedWeightKg != null && set.plannedWeightKg > 0 &&
    set.weightKg > set.plannedWeightKg + SELF_HEAVIER_STEPS * step + 1e-6
  if (selfHeavier) return { setNumber: set.setNumber, cls: 'miss-self-heavier', missReps, excusedReps: missReps, restBeforeRatio }
  let excusedReps: number
  if (isFirst) excusedReps = 0
  // We don't call a weight too heavy on a miss we can't explain (design §3A.4).
  else if (restBeforeRatio == null) excusedReps = missReps
  else excusedReps = Math.min(missReps, restExcuse(restBeforeRatio))
  return { setNumber: set.setNumber, cls: 'miss', missReps, excusedReps, restBeforeRatio }
}

/** Every set of a session, in set-number order, by `classifySet`. */
export function classifySets(sets: readonly SessionReadSet[], weightStepKg: number): { set: SessionReadSet; result: SessionReadSetResult }[] {
  const sorted = [...sets].sort((a, b) => a.setNumber - b.setNumber)
  return sorted.map((set, i) => ({
    set, result: classifySet(set, i > 0 ? sorted[i - 1] : null, i === sorted.length - 1, i === 0, weightStepKg),
  }))
}

/**
 * #3890 decision 9 (the Orchestrator's rule, 22 Nov): a session holds a missed rep the check-in may act on
 * when a set fell short of its planned reps AT the planned weight or lighter, the short rest before it
 * does not excuse the reps it lost, and the session was not an override. Built on `classifySet`, so a miss
 * here is a miss to the read: a set loaded heavier than planned (by any amount, a stricter bar than the
 * read's one-step `miss-self-heavier`), a set with no planned weight, a miss the rest before it explains
 * and an unknown rest (which the read excuses) are not.
 */
export function unexcusedMissAtPlan(sets: readonly SessionReadSet[], weightStepKg: number, overridden: boolean): boolean {
  if (overridden) return false
  return classifySets(sets, weightStepKg).some(({ set, result }) =>
    result.cls === 'miss' && result.missReps > result.excusedReps &&
    set.plannedWeightKg != null && set.plannedWeightKg > 0 && set.weightKg <= set.plannedWeightKg + 1e-6)
}

export function readSession(input: SessionReadInput): SessionRead {
  const sets = [...input.sets].sort((a, b) => a.setNumber - b.setNumber)
  if (input.overridden) return tooLittle('overridden')
  if (sets.length === 0) return tooLittle('no-sets')

  const hrRead = input.hrDense === true
  const step = input.weightStepKg > 0 ? input.weightStepKg : 0
  const results: SessionReadSetResult[] = []
  let targetReps = 0
  let unexplainedReps = 0
  let firstSetMissReps = 0
  let restShort = false
  let anyMiss = false
  let anyBeat = false
  let comparable = 0
  let measuredRests = 0
  let unsettledRests = 0
  let easyRated = 0
  let allExactlyMet = true

  sets.forEach((set, i) => {
    const prev = i > 0 ? sets[i - 1] : null
    const result = classifySet(set, prev, i === sets.length - 1, i === 0, step)
    results.push(result)
    if (result.cls === 'unplanned') return
    const planned = set.plannedReps!
    comparable++
    targetReps += planned

    if (hrRead && prev?.hr?.coverageOk && (prev.hr.recoveredPreset != null || prev.hr.restAdequate != null)) {
      measuredRests++
      if (prev.hr.recoveredPreset === false || prev.hr.restAdequate === false) unsettledRests++
    }
    // #4061: Preview no longer rates sets, so new sets add nothing to `easyRated`; the tapped answer is
    // not read here (shadow only, #4068).
    // Effort per set counts only when the lifter gave it (`'asked'` never reached `set_logs`: #3889 step 2 stored `effort_vs_plan`).
    if (set.rpe != null && isReportedRpe(set.rpeSource)) {
      const pct = set.plannedPct
      if (pct != null && pct > 0 && set.rpe <= expectedRpe(pct, set.reps) - RPE_DEAD_BAND) easyRated++
    }

    if (result.cls === 'met' || result.cls === 'beat') {
      if (result.cls === 'beat') { anyBeat = true; allExactlyMet = false }
      return
    }
    anyMiss = true
    allExactlyMet = false
    if (result.cls === 'miss-self-heavier') return
    if (i === 0) firstSetMissReps = result.missReps
    else if (result.restBeforeRatio != null && result.excusedReps > 0) restShort = true
    unexplainedReps += result.missReps - result.excusedReps
  })

  if (comparable < MIN_COMPARABLE_SETS) return tooLittle('too-few-planned-sets', results)

  const effort = countedEffort(input.effort)
  const base = { unexplainedReps, targetReps, effort, restShort, hrRead, sets: results, easierWithMiss: false }

  if (anyMiss) {
    let band = missBand(unexplainedReps, targetReps, firstSetMissReps)
    if (effort === -1 && band !== 'none') {
      return { ...base, verdict: 'hold', nextLoad: 'hold', band, easierWithMiss: true }
    }
    if (effort === 1) band = harder(band)
    if (band === 'large') return { ...base, verdict: 'reduce', nextLoad: 'down-2', band }
    if (band === 'clear') return { ...base, verdict: 'reduce', nextLoad: 'down-1', band }
    if (band === 'none' && restShort) return { ...base, verdict: 'hold-rest-more', nextLoad: 'hold', band }
    // Small: same weight. None with no short rest (only unknown-rest or self-chosen-weight misses):
    // nothing to judge, so the basis is today's (design §3A.4 rule 6).
    return { ...base, verdict: 'hold', nextLoad: band === 'small' ? 'hold' : 'as-today', band }
  }

  // Every planned set met or beaten.
  if (measuredRests > 0 && unsettledRests / measuredRests >= HR_NOT_RECOVERED_SHARE) {
    return { ...base, verdict: 'hold-recovery', nextLoad: 'hold', band: null }
  }
  if (effort === 1) return { ...base, verdict: 'hold', nextLoad: 'hold', band: null }
  if (anyBeat) return { ...base, verdict: 'progress-load', nextLoad: 'as-today', band: null }
  if (effort === -1) return { ...base, verdict: 'progress-load', nextLoad: 'up-1', band: null }
  const topReps = Math.max(...sets.map(s => s.plannedReps ?? 0))
  if (
    allExactlyMet && easyRated >= RATED_EASY_MIN_SETS &&
    input.repCeiling != null && topReps < input.repCeiling
  ) {
    return { ...base, verdict: 'progress-reps', nextLoad: 'hold', band: null }
  }
  // Met as planned: exact adherence is about 1RM-neutral, so today's basis stands (rule 6).
  return { ...base, verdict: 'hold', nextLoad: 'as-today', band: null }
}

/**
 * The next bar under the read, against today's. `todayBar` is what today's rule builds (the pct of
 * the last estimate); `heldBar` the last session's own bar at the same pct. Down never goes above
 * today's bar and up never below it, so the read can only add to what today's rule already does.
 */
export function nextBarUnderRead(nextLoad: NextLoad, todayBar: number, heldBar: number, stepKg: number): number {
  switch (nextLoad) {
    case 'as-today': return todayBar
    case 'hold': return heldBar
    case 'down-1': return Math.min(todayBar, heldBar - stepKg)
    case 'down-2': return Math.min(todayBar, heldBar - 2 * stepKg)
    case 'up-1': return Math.max(todayBar, heldBar + stepKg)
  }
}

// ── Replay (read-only counts for the owner, #3893 item 3) ───────────────────────────────────

/** One stored exercise log as the replay and the generation loader read it. */
export interface SessionReadLog {
  exerciseLogId: string
  workoutSessionId: string
  programSessionId: string | null
  exerciseName: string
  loggedAt: Date
  estimated1rm: number | null
  exerciseDeloaded: boolean
  exerciseType: string | null
  session: {
    completed: boolean
    isEarlyDeload: boolean
    wasOverride: boolean
    intensityMode: string | null
    phaseType: string | null
    hrDense: boolean | null
  }
  effortVsPlan: number | null
  effortSource: string | null
  sets: SessionReadSet[]
}

/** A log the read judges: completed, a real estimate, not deloaded or a baseline (the `listRecent1rm` filter). */
export function isReadableLog(log: SessionReadLog): boolean {
  const s = log.session
  return s.completed && !log.exerciseDeloaded && (log.estimated1rm ?? 0) > 0 &&
    !s.isEarlyDeload && s.intensityMode !== 'deload' && s.phaseType !== 'deload' && s.phaseType !== 'baseline'
}

export function readLog(log: SessionReadLog, weightStepKg: number, repCeiling?: number | null): SessionRead {
  return readSession({
    sets: log.sets,
    effort: { vsPlan: log.effortVsPlan, source: log.effortSource },
    hrDense: log.session.hrDense,
    weightStepKg,
    repCeiling,
    overridden: log.session.wasOverride,
  })
}

export interface ReplayExerciseCounts {
  sessions: number
  verdicts: Partial<Record<SessionVerdict, number>>
  /** Readable, but no bar to compare (bodyweight, or no planned bar on the first set). */
  notComparable: number
  sameNextWeight: number
  heavierNextWeight: number
  lighterNextWeight: number
}

/**
 * For each readable log: would the next session's bar, at the same pct as this one's first set,
 * have differed under the read, and which way. Counts only: no weights, reps or health values leave.
 */
export function replaySessionReads(
  logs: readonly SessionReadLog[],
  stepFor: (exerciseName: string) => number,
): { skipped: number; perExercise: Record<string, ReplayExerciseCounts> } {
  const perExercise: Record<string, ReplayExerciseCounts> = {}
  let skipped = 0
  for (const log of logs) {
    if (!isReadableLog(log)) { skipped++; continue }
    const step = stepFor(log.exerciseName)
    const read = readLog(log, step)
    const row = perExercise[log.exerciseName] ??= {
      sessions: 0, verdicts: {}, notComparable: 0, sameNextWeight: 0, heavierNextWeight: 0, lighterNextWeight: 0,
    }
    row.sessions++
    row.verdicts[read.verdict] = (row.verdicts[read.verdict] ?? 0) + 1
    const first = [...log.sets].sort((a, b) => a.setNumber - b.setNumber)
      .find(s => s.plannedPct != null && s.plannedPct > 0 && s.plannedWeightKg != null && s.plannedWeightKg > 0)
    if (!first || log.exerciseType === 'bodyweight') { row.notComparable++; continue }
    // Today's rule: the pct of the last estimate, rounded up to the plate step (`prescribedBar`).
    const today = mroundStepUp((log.estimated1rm! * first.plannedPct!) / 100, step)
    const next = nextBarUnderRead(read.nextLoad, today, first.plannedWeightKg!, step)
    if (Math.abs(next - today) < 1e-6) row.sameNextWeight++
    else if (next > today) row.heavierNextWeight++
    else row.lighterNextWeight++
  }
  return { skipped, perExercise }
}
