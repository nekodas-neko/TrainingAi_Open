import { shiftDateStr } from '../date-utils'
import type { NextSessionRecommendation } from '../types/program'
import { STREAK_LOOKBACK_DAYS } from './streak-window'

/**
 * Was `date` a training day? `undefined` means **unknown**, and that is a third answer rather than
 * a soft `false` (LA-184, LB-195).
 *
 * "Is date D a training day" is two different questions, and this answers them separately:
 *
 * - **A past date is a fact: did he train?** It comes from workout history — `trainedDays`, the
 *   `/api/streak-data` payload, which `getRecentTrainedDays` builds from sessions with at least one
 *   surviving exercise log. A past day with no session is a rest day, because that is what it was.
 * - **A future date is a projection, and this does not make one.** The owner's programs are all
 *   `type: 'rotation'` with `rest_after_n: 3` and **zero `schedule_days`**, so where tomorrow falls
 *   depends on where the rotate-then-rest cycle has got to, and a single unplanned rest day falsifies
 *   it. Presenting a guess as a target is how a card ends up confidently wrong. Projecting forward is
 *   the owner's call to make, not this function's.
 * - **Today is history first, then the recommendation.** A session already logged today settles it.
 *   Otherwise `getNextSession` is the only source, and only a recommendation that names a session
 *   says "training day": with no active program it returns `{ isRestDay: false }` and no session —
 *   a claim about nothing.
 *
 * `trainedDays` is `null` until it has loaded (or when it failed), which is unknown — never "he did
 * not train". A date older than the history window is unknown for the same reason: the payload
 * cannot say, and an absent key there would otherwise read as a rest day (the BF-176 trap).
 */
export function trainingDayForDate({
  date, today, todayRecommendation, trainedDays, historyDays = STREAK_LOOKBACK_DAYS,
}: {
  /** `YYYY-MM-DD` in the user's zone. */
  date: string
  /** `YYYY-MM-DD`, from `todayInTz`. */
  today: string
  todayRecommendation: NextSessionRecommendation | null
  /** `/api/streak-data`'s `trainedDays`, keyed `YYYY/MM/DD`. */
  trainedDays: Record<string, string[]> | null
  /** How many days back `trainedDays` covers. */
  historyDays?: number
}): boolean | undefined {
  if (date > today) return undefined

  const trained = trainedDays != null && (trainedDays[date.replace(/-/g, '/')]?.length ?? 0) > 0

  if (date === today) {
    if (trained) return true
    const rec = todayRecommendation
    if (rec == null) return undefined
    if (rec.isRestDay) return false
    return rec.session != null ? true : undefined
  }

  if (trainedDays == null) return undefined
  if (date < shiftDateStr(today, -historyDays)) return undefined
  return trained
}
