// Robust timing statistics over logged workout history. Read-time derivation only —
// nothing here is stored (Stored Counters rule). Consumed by /api/admin/time-audit
// to validate the duration-model constants against real data, and by
// buildMeasuredTimeBudget (below) to feed learned transition + warmup medians back
// into the AI plan via lib/ai-periodization/signals.ts.

import {
  transitionSecForEquipment,
  TRANSITION_SEC_BARBELL, TRANSITION_SEC_STANDARD, TRANSITION_SEC_BODYWEIGHT, TRANSITION_SEC_DEFAULT,
} from '@trainingai/shared/workout/duration-model'

export interface TimingSetRow {
  workoutSessionId: string
  exerciseName: string
  equipment: string[]
  setNumber: number
  reps: number
  setTimeSec: number | null
  restTimeSec: number | null
  setStartMs: number | null
}

export interface TimingExerciseRow {
  workoutSessionId: string
  exerciseName: string
  equipment: string[]
  interExerciseRestSec: number | null
}

export interface TimingSessionRow {
  workoutSessionId: string
  startedAt: number            // epoch ms
  completedAt: number | null   // epoch ms
  warmupEndedAt: number | null // epoch ms
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function quantileSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const idx = (sorted.length - 1) * q
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// Below this many kept samples, a median is a guess, not a signal — the UI dims
// the number rather than hiding it (a thin sample is still worth seeing, just not
// worth trusting at face value).
export const MIN_TRUSTED_SAMPLES = 5

// A "session" shorter than this is an accidental open/immediate-quit tap, not a
// real workout — even a single solo-logged set takes longer than this in practice.
// Chosen conservatively (well under any plausible single-set session) so a real,
// unusually short session is never dropped.
export const MIN_SESSION_SEC = 120

// A warmup longer than this is implausible as actual warming up — it's almost
// always dead time before the first logged set (stepped away, phone). Cap the
// reported warmup here; the overflow rolls into unaccounted (an honest bucket for
// untracked time) rather than inflating "warmup". The raw value is retained and
// surfaced as an anomaly. A *relative* outlier band can't catch this — a 22-vs-12
// min warmup is only ~1.8×, and warmup has no median to band against anyway.
export const MAX_PLAUSIBLE_WARMUP_SEC = 900 // 15 min
export const MAX_PLAUSIBLE_UNACCOUNTED_SEC = 600 // 10 min
export const SET_TIME_SANITY_CEILING_SEC = 600   // 10 min — beyond this a single set is a runaway timer
export const REST_TIME_SANITY_CEILING_SEC = 900  // 15 min — beyond this a single rest is a runaway timer

export type SessionAnomalyType = 'warmup_over_cap' | 'excessive_unaccounted' | 'runaway_set' | 'runaway_rest'
export interface SessionAnomaly { type: SessionAnomalyType; sec: number; detail: string }

// A user-set monitoring baseline is a *lower bound*, never a widener: if the
// baseline is more recent than the rolling window would already be, it wins
// (excludes the pre-baseline "learning period"); otherwise the window's own
// start is unaffected. `null` baseline means no lower bound at all.
export function clampWindowStart(windowStart: Date, baselineMidnightUtc: Date | null): Date {
  if (baselineMidnightUtc == null) return windowStart
  return baselineMidnightUtc.getTime() > windowStart.getTime() ? baselineMidnightUtc : windowStart
}

export interface RobustStats {
  count: number        // values kept
  outlierCount: number // values excluded as tracking errors
  median: number | null
  p25: number | null
  p75: number | null
}

// A value outside [median × 0.25, median × 4] is a tracking error (timer left
// running, app backgrounded), not signal — exclude it but report the count.
export function robustStats(values: number[]): RobustStats {
  const m = median(values)
  if (m === null) return { count: 0, outlierCount: 0, median: null, p25: null, p75: null }
  const kept = values.filter(v => v >= m * 0.25 && v <= m * 4)
  const sorted = [...kept].sort((a, b) => a - b)
  return {
    count: kept.length,
    outlierCount: values.length - kept.length,
    median: median(kept),
    p25: quantileSorted(sorted, 0.25),
    p75: quantileSorted(sorted, 0.75),
  }
}

// Per-exercise average set duration for planning consumers (the AI prescription
// prompt today; the future time-budget feature) — reuses the exact same
// outlier-exclusion policy as the admin Time Audit (robustStats) instead of a raw
// AVG, so "timer left running" outliers can't inflate what a consumer is told this
// exercise normally takes. Omits an exercise with no rows entirely; the caller
// decides its own no-data default.
export function robustAvgSetDurationsByExercise(
  rows: { exerciseName: string; setTimeSec: number }[],
): Record<string, number> {
  const byName = new Map<string, number[]>()
  for (const r of rows) {
    const arr = byName.get(r.exerciseName) ?? []
    arr.push(r.setTimeSec)
    byName.set(r.exerciseName, arr)
  }
  const result: Record<string, number> = {}
  for (const [name, times] of byName) {
    const m = robustStats(times).median
    if (m != null) result[name] = m
  }
  return result
}

export interface ExerciseTimingStats {
  exerciseName: string
  equipment: string[]
  setCount: number
  outlierSetCount: number
  medianSetSec: number | null
  medianSecPerRep: number | null
  medianRestSec: number | null
  restP75Sec: number | null
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  modelTransitionSec: number
}

export function computeExerciseStats(sets: TimingSetRow[], exercises: TimingExerciseRow[]): ExerciseTimingStats[] {
  const names = [...new Set([...sets.map(s => s.exerciseName), ...exercises.map(e => e.exerciseName)])]
  return names.map(name => {
    const exSets = sets.filter(s => s.exerciseName === name)
    const equipment = exSets[0]?.equipment ?? exercises.find(e => e.exerciseName === name)?.equipment ?? []
    const setTimes = exSets.map(s => s.setTimeSec).filter((v): v is number => v != null && v > 0)
    const setStats = robustStats(setTimes)
    const secPerRep = exSets
      .filter(s => s.setTimeSec != null && s.setTimeSec > 0 && s.reps > 0)
      .map(s => s.setTimeSec! / s.reps)
    const restTimes = exSets.map(s => s.restTimeSec).filter((v): v is number => v != null && v > 0)
    const restStats = robustStats(restTimes)
    const transitions = exercises
      .filter(e => e.exerciseName === name && e.interExerciseRestSec != null && e.interExerciseRestSec > 0)
      .map(e => e.interExerciseRestSec!)
    const transStats = robustStats(transitions)
    return {
      exerciseName: name,
      equipment,
      setCount: setStats.count,
      outlierSetCount: setStats.outlierCount,
      medianSetSec: setStats.median,
      medianSecPerRep: robustStats(secPerRep).median,
      medianRestSec: restStats.median,
      restP75Sec: restStats.p75,
      transitionCount: transStats.count,
      outlierTransitionCount: transStats.outlierCount,
      medianTransitionSec: transStats.median,
      transitionP75Sec: transStats.p75,
      modelTransitionSec: transitionSecForEquipment(equipment),
    }
  }).sort((a, b) => b.setCount - a.setCount)
}

export type EquipmentClass = 'barbell' | 'standard' | 'bodyweight' | 'unknown'

export function equipmentClassOf(equipment: string[]): EquipmentClass {
  if (equipment.length === 0) return 'unknown'
  if (equipment.includes('barbell')) return 'barbell'
  if (equipment.every(e => e === 'bodyweight')) return 'bodyweight'
  return 'standard'
}

const MODEL_SEC_BY_CLASS: Record<EquipmentClass, number> = {
  barbell: TRANSITION_SEC_BARBELL,
  standard: TRANSITION_SEC_STANDARD,
  bodyweight: TRANSITION_SEC_BODYWEIGHT,
  unknown: TRANSITION_SEC_DEFAULT,
}

export interface EquipmentTimingStats {
  equipmentClass: EquipmentClass
  transitionCount: number
  outlierTransitionCount: number
  medianTransitionSec: number | null
  transitionP75Sec: number | null
  currentModelSec: number
}

export function computeEquipmentStats(exercises: TimingExerciseRow[]): EquipmentTimingStats[] {
  const classes: EquipmentClass[] = ['barbell', 'standard', 'bodyweight', 'unknown']
  return classes.map(cls => {
    const values = exercises
      .filter(e => equipmentClassOf(e.equipment) === cls && e.interExerciseRestSec != null && e.interExerciseRestSec > 0)
      .map(e => e.interExerciseRestSec!)
    const stats = robustStats(values)
    return {
      equipmentClass: cls,
      transitionCount: stats.count,
      outlierTransitionCount: stats.outlierCount,
      medianTransitionSec: stats.median,
      transitionP75Sec: stats.p75,
      currentModelSec: MODEL_SEC_BY_CLASS[cls],
    }
  }).filter(s => s.transitionCount > 0 || s.equipmentClass !== 'unknown')
}

export interface SessionDecomposition {
  workoutSessionId: string
  startedAt: number
  totalSec: number
  warmupSec: number | null
  rawWarmupSec: number | null
  warmupOverflowSec: number
  workSec: number
  restSec: number
  transitionSec: number
  unaccountedSec: number
  anomalies: SessionAnomaly[]
}

// The whole-session mirror of the per-exercise robust-median exclusion: that
// median already *ignores* a runaway set/rest, but nothing previously said "this
// session had a timer left running." Absolute ceilings are the right tool here —
// independent of any exercise's own median — same reasoning as the warmup cap.
function detectSessionAnomalies(
  rawWarmupSec: number | null,
  unaccountedSec: number,
  wsSets: TimingSetRow[],
): SessionAnomaly[] {
  const anomalies: SessionAnomaly[] = []
  if (rawWarmupSec != null && rawWarmupSec > MAX_PLAUSIBLE_WARMUP_SEC) {
    const overMin = Math.round((rawWarmupSec - MAX_PLAUSIBLE_WARMUP_SEC) / 60)
    anomalies.push({
      type: 'warmup_over_cap',
      sec: rawWarmupSec,
      detail: `${Math.round(rawWarmupSec / 60)}m warmup — ${overMin}m over cap`,
    })
  }
  if (unaccountedSec > MAX_PLAUSIBLE_UNACCOUNTED_SEC) {
    anomalies.push({
      type: 'excessive_unaccounted',
      sec: unaccountedSec,
      detail: `${Math.round(unaccountedSec / 60)}m unaccounted`,
    })
  }
  const setTimes = wsSets.map(s => s.setTimeSec).filter((v): v is number => v != null)
  const maxSetTime = setTimes.length > 0 ? Math.max(...setTimes) : null
  if (maxSetTime != null && maxSetTime > SET_TIME_SANITY_CEILING_SEC) {
    anomalies.push({
      type: 'runaway_set',
      sec: maxSetTime,
      detail: `${Math.round(maxSetTime / 60)}m single set`,
    })
  }
  const restTimes = wsSets.map(s => s.restTimeSec).filter((v): v is number => v != null)
  const maxRestTime = restTimes.length > 0 ? Math.max(...restTimes) : null
  if (maxRestTime != null && maxRestTime > REST_TIME_SANITY_CEILING_SEC) {
    anomalies.push({
      type: 'runaway_rest',
      sec: maxRestTime,
      detail: `${Math.round(maxRestTime / 60)}m single rest`,
    })
  }
  return anomalies
}

// Warmup varies more session-to-session than a single set does (mood, how cold the
// gym is), so it needs more samples than MIN_TRUSTED_SAMPLES before its median is
// worth planning on. Below this many completed sessions the plan keeps the flat 15%
// fraction rather than a thin, noisy learned number.
export const WARMUP_LEARN_MIN_SESSIONS = 8

// The learned time inputs the planner substitutes for the duration-model constants,
// each gated on having enough trusted samples. Anything below threshold is simply
// omitted here and the caller falls back to the constant — a partial budget (e.g.
// transitions learned but warmup not yet) is expected and safe.
export interface MeasuredTimeBudget {
  // Per-exercise median transition (bar-load + walk-over + warm-up ramps), keyed by
  // exercise name — the most specific signal, used first.
  transitionSecByExercise: Record<string, number>
  // Fallback median transition per equipment class, for an exercise without enough
  // of its own history but whose class does.
  transitionSecByClass: Partial<Record<EquipmentClass, number>>
  // Learned warmup median in seconds, or null below WARMUP_LEARN_MIN_SESSIONS sessions.
  warmupSec: number | null
}

export function buildMeasuredTimeBudget(
  sessions: TimingSessionRow[],
  sets: TimingSetRow[],
  exercises: TimingExerciseRow[],
): MeasuredTimeBudget {
  const transitionSecByExercise: Record<string, number> = {}
  for (const stat of computeExerciseStats(sets, exercises)) {
    if (stat.transitionCount >= MIN_TRUSTED_SAMPLES && stat.medianTransitionSec != null) {
      transitionSecByExercise[stat.exerciseName] = stat.medianTransitionSec
    }
  }

  const transitionSecByClass: Partial<Record<EquipmentClass, number>> = {}
  for (const stat of computeEquipmentStats(exercises)) {
    if (stat.transitionCount >= MIN_TRUSTED_SAMPLES && stat.medianTransitionSec != null) {
      transitionSecByClass[stat.equipmentClass] = stat.medianTransitionSec
    }
  }

  const warmups = decomposeSessions(sessions, sets, exercises)
    .map(s => s.warmupSec)
    .filter((v): v is number => v != null && v > 0)
  const warmupSec = warmups.length >= WARMUP_LEARN_MIN_SESSIONS ? robustStats(warmups).median : null

  return { transitionSecByExercise, transitionSecByClass, warmupSec }
}

// Transition seconds for one exercise, most-specific-first: its own learned median →
// its equipment class's learned median → the duration-model constant. A null/absent
// measured budget (or one below threshold for this exercise) falls straight through to
// the constant, so this is always safe to call.
export function resolveTransitionSec(
  exerciseName: string,
  equipment: string[] | undefined,
  measured?: MeasuredTimeBudget | null,
): number {
  if (measured) {
    const perExercise = measured.transitionSecByExercise[exerciseName]
    if (perExercise != null) return perExercise
    const perClass = measured.transitionSecByClass[equipmentClassOf(equipment ?? [])]
    if (perClass != null) return perClass
  }
  return transitionSecForEquipment(equipment)
}

export function decomposeSessions(
  sessions: TimingSessionRow[],
  sets: TimingSetRow[],
  exercises: TimingExerciseRow[],
): SessionDecomposition[] {
  return sessions
    .filter(ws => ws.completedAt != null && (ws.completedAt - ws.startedAt) / 1000 >= MIN_SESSION_SEC)
    .map(ws => {
      const totalSec = Math.round((ws.completedAt! - ws.startedAt) / 1000)
      const wsSets = sets.filter(s => s.workoutSessionId === ws.workoutSessionId)
      const firstSetStart = wsSets
        .map(s => s.setStartMs)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)[0] ?? null
      const warmupEnd = ws.warmupEndedAt ?? firstSetStart
      const rawWarmupSec = warmupEnd != null ? Math.max(0, Math.round((warmupEnd - ws.startedAt) / 1000)) : null
      const warmupSec = rawWarmupSec != null ? Math.min(rawWarmupSec, MAX_PLAUSIBLE_WARMUP_SEC) : null
      const warmupOverflowSec = rawWarmupSec != null ? Math.max(0, rawWarmupSec - MAX_PLAUSIBLE_WARMUP_SEC) : 0
      const workSec = wsSets.reduce((t, s) => t + (s.setTimeSec ?? 0), 0)
      const restSec = wsSets.reduce((t, s) => t + (s.restTimeSec ?? 0), 0)
      const transitionSec = exercises
        .filter(e => e.workoutSessionId === ws.workoutSessionId && (e.interExerciseRestSec ?? 0) > 0)
        .reduce((t, e) => t + e.interExerciseRestSec!, 0)
      const unaccountedSec = totalSec - (warmupSec ?? 0) - workSec - restSec - transitionSec
      return {
        workoutSessionId: ws.workoutSessionId,
        startedAt: ws.startedAt,
        totalSec,
        warmupSec,
        rawWarmupSec,
        warmupOverflowSec,
        workSec,
        restSec,
        transitionSec,
        unaccountedSec,
        anomalies: detectSessionAnomalies(rawWarmupSec, unaccountedSec, wsSets),
      }
    })
    .sort((a, b) => b.startedAt - a.startedAt)
}
