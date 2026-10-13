import { repFactor } from '@trainingai/shared/1rm'
import type { RpeSource } from '@trainingai/shared/workout/rpe-source'
export function maxRepsAtPct(pct: number): number {
  if (pct >= 100) return 1
  if (pct <= 0) return 30
  const target = 100 / pct // = repFactor(reps) at failure
  let prev = repFactor(1)
  if (target <= prev) return 1
  for (let r = 2; r <= 30; r++) {
    const cur = repFactor(r)
    if (cur >= target) {
      return r - 1 + (target - prev) / (cur - prev)
    }
    prev = cur
  }
  return 30
}
export const EXPECTED_RPE_MIN = 5
export const EXPECTED_RPE_MAX = 10
export function rawExpectedRpe(pct: number, reps: number): number | null {
  if (!(pct > 0) || !(reps > 0)) return null
  return 10 - Math.max(0, maxRepsAtPct(pct) - reps)
}
export function isExpectedRpeRepresentable(pct: number, reps: number): boolean {
  const raw = rawExpectedRpe(pct, reps)
  return raw != null && raw >= EXPECTED_RPE_MIN
}
export function expectedRpe(pct: number, reps: number): number {
  const raw = rawExpectedRpe(pct, reps)
  if (raw == null) return 7
  return Math.min(EXPECTED_RPE_MAX, Math.max(EXPECTED_RPE_MIN, raw))
}
export function pctForExpectedRpe(targetRpe: number, reps: number): number {
  const clampedRpe = Math.min(EXPECTED_RPE_MAX, Math.max(EXPECTED_RPE_MIN, targetRpe))
  const rir = 10 - clampedRpe
  const maxReps = Math.max(1, reps + rir)
  const pct = 100 / repFactor(maxReps)
  return Math.round(pct * 2) / 2 // 0.5 precision, matching the codebase's pct rounding
}
export const RPE_PICKER_MIN = 6
export const RPE_PICKER_MAX = 10


export function expectedRpePrefill(pct: number | undefined | null, plannedReps: number | undefined | null): number {
  if (pct == null || plannedReps == null) return 7
  return Math.min(RPE_PICKER_MAX, Math.max(RPE_PICKER_MIN, Math.round(expectedRpe(pct, plannedReps))))
}

export interface RpeTrendInputSet {
  rpe: number | null; intensityPct: number | null; reps: number

  rpeSource?: RpeSource | null
}


const reportedOrExpected = (s: RpeTrendInputSet & { rpe: number; intensityPct: number }): number =>
  s.rpeSource === 'expected' ? expectedRpe(s.intensityPct, s.reps) : s.rpe
export function rpeTrendFromSets(sets: RpeTrendInputSet[]): { avgActual: number; avgExpected: number; delta: number } | null {
  const rated = sets.filter((s): s is RpeTrendInputSet & { rpe: number; intensityPct: number } =>
    s.rpe != null && s.intensityPct != null)
  if (rated.length < 3) return null
  const avgActual = rated.reduce((sum, s) => sum + reportedOrExpected(s), 0) / rated.length
  const avgExpected = rated.reduce((sum, s) => sum + expectedRpe(s.intensityPct, s.reps), 0) / rated.length
  return { avgActual, avgExpected, delta: avgActual - avgExpected }
}

export interface RpeDeltaInputSet extends RpeTrendInputSet { exerciseName: string }


export const RPE_DELTA_MIN_RATED_SETS = 2
export function perExerciseRpeDelta(sets: RpeDeltaInputSet[], minSets = RPE_DELTA_MIN_RATED_SETS): Map<string, number> {
  const byExercise = new Map<string, number[]>()
  for (const sl of sets) {
    if (sl.rpe == null || sl.intensityPct == null) continue
    if (sl.rpeSource === 'expected') continue
    if (!isExpectedRpeRepresentable(sl.intensityPct, sl.reps)) continue
    const arr = byExercise.get(sl.exerciseName) ?? []
    arr.push(sl.rpe - expectedRpe(sl.intensityPct, sl.reps))
    byExercise.set(sl.exerciseName, arr)
  }
  const out = new Map<string, number>()
  for (const [name, deltas] of byExercise) {
    if (deltas.length >= minSets) out.set(name, deltas.reduce((a, b) => a + b, 0) / deltas.length)
  }
  return out
}
