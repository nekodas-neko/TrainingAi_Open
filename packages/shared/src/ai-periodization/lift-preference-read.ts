/**
 * Reading a session's lift preferences for the plan (#3896 step 4). One repository read for the lifts
 * of a session, owner-scoped, live rows only, matched on `exercise_id` first and falling back to the
 * name (`listExercisePreferences` in lib/data/postgres/slices/exercise-preferences.ts).
 *
 * A failed read is a plan as written: the preference is the person's choice, not a safety bound, so
 * losing it for one plan is the smaller harm than losing the plan. It is logged, not swallowed.
 */
import { lastSessionBarKg, liftPreferenceFromRow, type LiftPreference, type LiftPreferenceRow } from './lift-preference'
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
  let out = new Map<string, LiftPreference>()
  if (exerciseNames.length === 0 || typeof repo.listExercisePreferences !== 'function') return out
  try {
    const names = [...new Set(exerciseNames)]
    const rows = opts?.checkinWeekStart
      ? await repo.listExercisePreferences(userId, names, { checkinWeekStart: opts.checkinWeekStart })
      : await repo.listExercisePreferences(userId, names)
    const read = preferencesFromRows(rows, opts?.checkinWeekStart)
    out = read.prefs
    if (read.held.length > 0) {
      const lastLogs = await repo.getLastExerciseLogsBatch(userId, read.held).catch(err => {
        console.error('[weekly-checkin] reading the last bar of held lifts failed; holding nothing:', err)
        return new Map()
      })
      for (const name of read.held) withCheckinHold(out, name, opts!.checkinWeekStart!, lastSessionBarKg(lastLogs.get(name)))
    }
  } catch (err) {
    console.error('[lift-preference] read failed; planning without preferences:', err)
  }
  return out
}

/**
 * The preferences of each lift from the repository's rows (`listExercisePreferences`), and which lifts the
 * check-in holds for `checkinWeekStart`. Pure. The one place a row becomes a `LiftPreference`: the start of
 * a generation reads it through `loadLiftPreferences`, and the store's re-read (#4007) through the same
 * function inside its transaction, so the two cannot disagree about what a row says.
 */
export function preferencesFromRows(
  rows: Iterable<[string, LiftPreferenceRow]> | null | undefined, checkinWeekStart?: string,
): { prefs: Map<string, LiftPreference>; held: string[] } {
  const prefs = new Map<string, LiftPreference>()
  const held: string[] = []
  for (const [name, row] of rows ?? []) {
    const pref = liftPreferenceFromRow(row)
    if (pref) prefs.set(name, pref)
    if (row?.checkinHeld && checkinWeekStart) held.push(name)
  }
  return { prefs, held }
}

/** A lift the check-in holds for `weekStart`, with the bar the person last used (null: holds nothing). */
export function withCheckinHold(prefs: Map<string, LiftPreference>, name: string, weekStart: string, barKg: number | null): void {
  const pref = prefs.get(name) ?? { repRange: null, restSec: null, oneShot: null }
  prefs.set(name, { ...pref, checkinHold: { weekStart, barKg } })
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
  return liftWorkingBases(repo, userId, names, prMap)
}

/**
 * Everything the store's restate (#4007) can need, read before the store takes the lift lock: the session's
 * lifts' last logged bars (for a check-in hold), the personal records, the last real 1RMs and the typed
 * estimates (for the working basis). Read for EVERY lift of the session, moved or not, because which lifts
 * moved is only known inside the lock. The restate is then a pure function of these, so nothing but the
 * transaction's own statements runs while the lock is held (`docs/lift-write-lock-order.md`).
 */
export interface RestateReads {
  lastLogs: Awaited<ReturnType<WorkoutRepository['getLastExerciseLogsBatch']>>
  records: Awaited<ReturnType<WorkoutRepository['listPersonalRecords']>>
  lastReal: Awaited<ReturnType<WorkoutRepository['getLastRealOneRmBatch']>>
  estimates: { exerciseName: string; estimated1rm: number }[]
}

/** Throws on a failed read (the caller then stores the plan as generated). A failed estimates read is `[]`, as `liftWorkingBases` has it. */
export async function loadRestateReads(repo: WorkoutRepository, userId: string, exerciseNames: readonly string[]): Promise<RestateReads> {
  const names = [...new Set(exerciseNames)]
  const [lastLogs, records, lastReal, estimates] = await Promise.all([
    repo.getLastExerciseLogsBatch(userId, names),
    repo.listPersonalRecords(userId),
    repo.getLastRealOneRmBatch(userId, names),
    repo.getExerciseEstimates(userId).catch(() => []),
  ])
  return { lastLogs, records, lastReal, estimates }
}

/** The working basis of each of `names` from reads already made. Pure. */
export function workingBasesFrom(
  reads: Pick<RestateReads, 'lastReal' | 'estimates'>, names: readonly string[], prMap: ReadonlyMap<string, number>,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  for (const name of names) {
    out.set(name, resolveWorkingBasisWithSource({
      lastNonDeload1rm: reads.lastReal.get(name)?.estimated1rm,
      seedEstimate: reads.estimates.find(e => e.exerciseName === name)?.estimated1rm,
      allTimePr1rm: prMap.get(name),
    }).kg)
  }
  return out
}

/** The working basis of each of `names`, by the resolver the workout screen's bar uses. */
export async function liftWorkingBases(
  repo: WorkoutRepository, userId: string, names: readonly string[], prMap: ReadonlyMap<string, number>,
): Promise<Map<string, number | null>> {
  if (names.length === 0) return new Map()
  const [lastReal, estimates] = await Promise.all([
    repo.getLastRealOneRmBatch(userId, [...names]),
    repo.getExerciseEstimates(userId).catch(() => []),
  ])
  return workingBasesFrom({ lastReal, estimates }, names, prMap)
}
