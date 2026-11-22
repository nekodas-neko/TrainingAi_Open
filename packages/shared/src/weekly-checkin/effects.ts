/**
 * #3890: what each weekly check-in answer does. One rule per answer, here and nowhere else
 * (decisions 8 and 9, the issue's "What the answers do" table):
 *
 *   Heavy                        → held: by itself. The plan holds the lift for the week the check-in
 *                                  applies to: no heavier than last session's bar (`CHECKIN_HOLD_LIVE`,
 *                                  `checkin-plan-hold.ts`). Also fed to the session read (in shadow).
 *   Heavy, and a missed rep      → lowered_one_step: one plate lighter next time, by itself, written
 *                                  through the Coach's lift-preference writer (`nextLoadStep: lighter`,
 *                                  the existing one-plate step), with a `coach_changes` row and undo.
 *   Light                        → offered_step_up: an offer only; nothing changes until accepted, and
 *                                  an accepted step up is the same writer's `nextLoadStep: heavier`.
 *   About right                  → none.
 *   Pain, swap                   → offers only (the engine in lib/weekly-checkin/).
 *   Days off, a shorter session  → applied as typed (`daysOffDates`, and the time budget read).
 *
 * Pure. The model is not in this path.
 */
import { daysBetweenDateStrs, shiftDateStr } from '../date-utils'
import type { SessionRead } from '../ai-periodization/session-read'

export const CHECKIN_ANSWERS = ['heavy', 'about_right', 'light'] as const

/**
 * Whether a `held` lift's hold is enforced by the live plan. True since the hold was made live: during
 * the week the check-in applies to, no prescribed bar of a held lift is heavier than the bar the person
 * last used for it, on every path that sets a load (the per-lift preference reader's `checkinHold`,
 * applied by `checkin-plan-hold.ts`, the static-style path and the stored-plan serve). The card may say
 * the lift is held.
 */
export const CHECKIN_HOLD_LIVE = true
export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number]
export type CheckinEffect = 'held' | 'lowered_one_step' | 'offered_step_up' | 'none'

/** The effect of one lift's answer. `missedRep` is what the engine saw that week (null: no read). */
export function effectForAnswer(answer: CheckinAnswer, missedRep: boolean | null): CheckinEffect {
  if (answer === 'heavy') return missedRep === true ? 'lowered_one_step' : 'held'
  if (answer === 'light') return 'offered_step_up'
  return 'none'
}

/** Whether an effect is applied without a tap (so a redo or an undo must take it back). */
export function isAutomaticEffect(effect: CheckinEffect): boolean {
  return effect === 'held' || effect === 'lowered_one_step'
}

/**
 * The dates the "days off" answer marks as rest: ISO weekdays (1 = Monday … 7 = Sunday) of the week
 * starting `appliesWeekStart`, only those strictly after `today`. Today and earlier are left alone: a
 * rest day for today is the person's own choice on Home (`chooseRestDay`), and a past day has nothing
 * to rest from. Sorted, no duplicates.
 */
export function daysOffDates(appliesWeekStart: string, weekdays: readonly number[], today: string): string[] {
  const dates = [...new Set(weekdays)]
    .filter(d => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .map(d => shiftDateStr(appliesWeekStart, d - 1))
  return dates.filter(d => daysBetweenDateStrs(today, d) > 0)
}

/**
 * A "Heavy" answer feeds the session read (#3890 build order, step 2): the lift's read for next week
 * never calls for more load. A read that would add load or reps (or keep today's rising basis) holds
 * the last session's bar instead; a read that already holds or lowers is left as it is, so a heavy
 * answer can only take load off, never add it. A read that cannot judge (`too-little-data`) has no
 * bar to hold to and is left alone. The session read is in shadow until #3889 step 4; the plan's own
 * hold is `checkin-plan-hold.ts`. The read is stored beside the plan with `checkinHeld`.
 */
export function holdUnderCheckin<R extends SessionRead>(read: R): R & { checkinHeld?: true } {
  if (read.verdict === 'too-little-data') return read
  const progressing = read.verdict === 'progress-load' || read.verdict === 'progress-reps'
  if (!progressing && read.nextLoad !== 'as-today' && read.nextLoad !== 'up-1') return { ...read, checkinHeld: true }
  return { ...read, verdict: progressing ? 'hold' : read.verdict, nextLoad: 'hold', checkinHeld: true }
}
