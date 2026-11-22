/**
 * Reading a session's lift preferences for the plan (#3896 step 4). One repository read for the lifts
 * of a session, owner-scoped, live rows only, matched on `exercise_id` first and falling back to the
 * name (`listExercisePreferences` in lib/data/postgres/slices/exercise-preferences.ts).
 *
 * A failed read is a plan as written: the preference is the person's choice, not a safety bound, so
 * losing it for one plan is the smaller harm than losing the plan. It is logged, not swallowed.
 */
import { lastSessionBarKg, liftPreferenceFromRow, type LiftPreference } from './lift-preference'
import { resolveWorkingBasisWithSource } from '../1rm'
import type { WorkoutRepository } from '@/lib/data/repository'

/**
 * `opts.checkinWeekStart` (#3890): the local Monday of the week being planned. With it, a lift the saved
 * weekly check-in for that week holds ("Heavy", decision 8) carries `checkinHold`: the week, and the bar
 * the person last used for it (`lastSessionBarKg`, from `getLastExerciseLogsBatch`, read only when some
 * lift is held, so a person with no hold pays no extra read). The held set rides on the preferences
 * query itself. A failed last-bar read is a hold with no bar, which caps nothing.
 */
export async function loadLiftPreferences(
  repo: WorkoutRepository, userId: string, exerciseNames: readonly string[],
  opts?: { checkinWeekStart?: string },
): Promise<Map<string, LiftPreference>> {
  const out = new Map<string, LiftPreference>()
  if (exerciseNames.length === 0 || typeof repo.listExercisePreferences !== 'function') return out
  try {
    const names = [...new Set(exerciseNames)]
    const rows = opts?.checkinWeekStart
      ? await repo.listExercisePreferences(userId, names, { checkinWeekStart: opts.checkinWeekStart })
      : await repo.listExercisePreferences(userId, names)
    const held: string[] = []
    for (const [name, row] of rows ?? []) {
      const pref = liftPreferenceFromRow(row)
      if (pref) out.set(name, pref)
      if (row?.checkinHeld && opts?.checkinWeekStart) held.push(name)
    }
    if (held.length > 0) {
      const lastLogs = await repo.getLastExerciseLogsBatch(userId, held).catch(err => {
        console.error('[weekly-checkin] reading the last bar of held lifts failed; holding nothing:', err)
        return new Map()
      })
      for (const name of held) {
        const pref = out.get(name) ?? { repRange: null, restSec: null, oneShot: null }
        out.set(name, { ...pref, checkinHold: { weekStart: opts!.checkinWeekStart!, barKg: lastSessionBarKg(lastLogs.get(name)) } })
      }
    }
  } catch (err) {
    console.error('[lift-preference] read failed; planning without preferences:', err)
  }
  return out
}

/**
 * The working basis of each lift that has a one-shot plate step, by the same resolver and inputs the
 * workout screen's bar uses (`buildWorkoutExercises`): last non-deload 1RM, else the larger of the
 * typed seed and the record. Read only when some lift has a step or a check-in hold with a bar, so a
 * session without one adds no read.
 */
export async function liftPreferenceBases(
  repo: WorkoutRepository, userId: string, prefs: ReadonlyMap<string, LiftPreference>, prMap: ReadonlyMap<string, number>,
): Promise<Map<string, number | null>> {
  // #3890: a held lift with a last bar needs the basis too, to turn that bar into a pct ceiling.
  const names = [...prefs].filter(([, p]) => p.oneShot?.loadStep || p.checkinHold?.barKg != null).map(([n]) => n)
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
