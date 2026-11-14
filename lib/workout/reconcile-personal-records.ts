import type { WorkoutRepository } from '@/lib/data/repository'
import { toAestDay } from '@trainingai/shared/date-utils'

/**
 * #3801 item 3. Compares each exercise's stored personal record with the best log
 * `reconcilePersonalRecord`'s rule accepts (`repo.bestQualifyingPersonalRecord`, the same query),
 * and on a write fills in what is missing or too low. Reached through the agent key
 * (`reconcile-personal-records` in `lib/agent-actions/jobs.ts`).
 *
 * A write only ADDS a record or RAISES one to the best log, through `upsertPersonalRecordIfBetter`,
 * which refuses anything that is not higher than what is stored. A record the rule would lower or
 * remove is reported (`wouldLower`, `wouldRemove`) and left alone: those lose a stored value, and
 * this job is for the add-only backfill the audit found. So a run never loses data, and a second
 * run writes nothing.
 */

export type PersonalRecordAction = 'add' | 'raise' | 'unchanged' | 'lower' | 'remove' | 'none'

export interface PersonalRecordReconcileRow {
  exerciseName: string
  action: PersonalRecordAction
  /** Whether this run wrote the row (only ever for `add` or `raise`, and only when not a dry run). */
  written: boolean
}

export interface PersonalRecordReconcileReport {
  dryRun: boolean
  examined: number
  summary: { add: number; raise: number; unchanged: number; wouldLower: number; wouldRemove: number; none: number; written: number }
  /** Every exercise that is not `unchanged` or `none`, with what was done to it. */
  changes: PersonalRecordReconcileRow[]
  /** Local dates (`YYYY-MM-DD`, the user's timezone) of the logs a write would take a record from, for the issue. */
  achievedOn: string[]
}

export async function reconcilePersonalRecords(
  repo: WorkoutRepository, userId: string, tz: string,
  opts: { dryRun: boolean; exercises?: string[] },
): Promise<PersonalRecordReconcileReport> {
  const stored = await repo.listPersonalRecords(userId)
  const names = opts.exercises
    ? [...new Set(opts.exercises)]
    // Every exercise the user has logged, and every stored record (so one with no qualifying log
    // left is reported as `wouldRemove` rather than missed).
    : [...new Set([...(await repo.listLoggedExerciseNames(userId)), ...stored.keys()])].sort()

  const summary = { add: 0, raise: 0, unchanged: 0, wouldLower: 0, wouldRemove: 0, none: 0, written: 0 }
  const changes: PersonalRecordReconcileRow[] = []
  const achievedOn = new Set<string>()
  for (const exerciseName of names) {
    const best = await repo.bestQualifyingPersonalRecord(userId, exerciseName)
    const current = stored.get(exerciseName)
    let action: PersonalRecordAction
    if (!best) action = current == null ? 'none' : 'remove'
    else if (current == null) action = 'add'
    else if (best.estimated1rm > current) action = 'raise'
    else if (best.estimated1rm < current) action = 'lower'
    else action = 'unchanged'

    if (action === 'add') summary.add++
    else if (action === 'raise') summary.raise++
    else if (action === 'lower') summary.wouldLower++
    else if (action === 'remove') summary.wouldRemove++
    else if (action === 'unchanged') summary.unchanged++
    else summary.none++

    let written = false
    if (best && (action === 'add' || action === 'raise')) {
      achievedOn.add(toAestDay(best.loggedAt, tz))
      if (!opts.dryRun) {
        written = await repo.upsertPersonalRecordIfBetter(userId, exerciseName, best.estimated1rm, best.loggedAt)
        if (written) summary.written++
      }
    }
    if (action !== 'unchanged' && action !== 'none') changes.push({ exerciseName, action, written })
  }
  return { dryRun: opts.dryRun, examined: names.length, summary, changes, achievedOn: [...achievedOn].sort() }
}
