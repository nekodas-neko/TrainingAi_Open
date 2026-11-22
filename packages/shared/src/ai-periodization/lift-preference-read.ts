/**
 * Reading a session's lift preferences for the plan (#3896 step 4). One repository read for the lifts
 * of a session, owner-scoped, live rows only, matched on `exercise_id` first and falling back to the
 * name (`listExercisePreferences` in lib/data/postgres/slices/exercise-preferences.ts).
 *
 * A failed read is a plan as written: the preference is the person's choice, not a safety bound, so
 * losing it for one plan is the smaller harm than losing the plan. It is logged, not swallowed.
 */
import { liftPreferenceFromRow, type LiftPreference } from './lift-preference'
import { resolveWorkingBasisWithSource } from '../1rm'
import type { WorkoutRepository } from '@/lib/data/repository'

export async function loadLiftPreferences(
  repo: WorkoutRepository, userId: string, exerciseNames: readonly string[],
): Promise<Map<string, LiftPreference>> {
  const out = new Map<string, LiftPreference>()
  if (exerciseNames.length === 0 || typeof repo.listExercisePreferences !== 'function') return out
  try {
    const rows = await repo.listExercisePreferences(userId, [...new Set(exerciseNames)])
    for (const [name, row] of rows ?? []) {
      const pref = liftPreferenceFromRow(row)
      if (pref) out.set(name, pref)
    }
  } catch (err) {
    console.error('[lift-preference] read failed; planning without preferences:', err)
  }
  return out
}

/**
 * The working basis of each lift that has a one-shot plate step, by the same resolver and inputs the
 * workout screen's bar uses (`buildWorkoutExercises`): last non-deload 1RM, else the larger of the
 * typed seed and the record. Read only when some lift has a step, so a session without one adds no read.
 */
export async function liftPreferenceBases(
  repo: WorkoutRepository, userId: string, prefs: ReadonlyMap<string, LiftPreference>, prMap: ReadonlyMap<string, number>,
): Promise<Map<string, number | null>> {
  const names = [...prefs].filter(([, p]) => p.oneShot?.loadStep).map(([n]) => n)
  const out = new Map<string, number | null>()
  if (names.length === 0) return out
  const [lastReal, estimates] = await Promise.all([
    repo.getLastRealOneRmBatch(userId, names),
    repo.getExerciseEstimates(userId).catch(() => []),
  ])
  for (const name of names) {
    out.set(name, resolveWorkingBasisWithSource({
      lastNonDeload1rm: lastReal.get(name)?.estimated1rm,
      seedEstimate: estimates.find(e => e.exerciseName === name)?.estimated1rm,
      allTimePr1rm: prMap.get(name),
    }).kg)
  }
  return out
}
