/**
 * Pure, dependency-free calculations used by the achievements engine.
 * Kept separate from `lib/achievements.ts` so they can be unit-tested without
 * pulling in the database client.
 */

import { formatInTimeZone } from 'date-fns-tz'
import { shiftDateStr } from './date-utils'

/**
 * Whether a day's calorie intake counts as "hit the goal", respecting the user's
 * weight-goal direction:
 *  - cutting (target weight < current): a hit means staying at or under the target
 *  - bulking (target weight > current): a hit means meeting or exceeding the target
 *  - maintaining (no/equal target): a hit means within ±10% of the target either way
 * The 0.5 kg dead-band avoids treating tiny target/current differences as a cut/bulk.
 */
export function calorieDayHitsGoal(
  totalCals: number,
  target: number,
  targetWeight: number | null,
  currentWeight: number | null,
): boolean {
  if (target <= 0) return false
  if (targetWeight != null && currentWeight != null) {
    const diff = targetWeight - currentWeight
    if (diff < -0.5) return totalCals <= target          // cutting
    if (diff > 0.5) return totalCals >= target           // bulking
  }
  return Math.abs(totalCals - target) <= target * 0.1    // maintaining / unknown
}

/**
 * A streak of dated ENTRIES — one per day that has one, with `maxRestGap` days allowed between.
 *
 * RV-216 renamed this from `computeStreak`. It shared that name with Home's function while
 * counting a different quantity: this counts entries, Home counts the calendar days they span,
 * and on the owner's real history the two read 83 and 111 for the same input. Food, sleep and
 * calorie-goal streaks want THIS one — "log food 7 days in a row" means seven entries. The
 * training streak wants `computeDayStreak`, which is what the card and the achievements say.
 */
export function computeEntryStreak(dates: string[], tz: string, maxRestGap = 0): { best: number; current: number } {
  if (dates.length === 0) return { best: 0, current: 0 }

  const sorted = [...dates].sort()

  let best = 1, streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000)
    if (diffDays - 1 <= maxRestGap) {
      streak++
      if (streak > best) best = streak
    } else {
      streak = 1
    }
  }

  // current streak: compare date strings in the user's timezone to avoid UTC-midnight drift
  const todayStr     = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
  // Q-489: shifted on the string, not by 86,400,000 ms — on a DST fall-back day the ms offset
  // resolves to today, and a streak whose last entry was yesterday reads as broken.
  const yesterdayStr = shiftDateStr(todayStr, -1)
  const mostRecentStr = sorted[sorted.length - 1]

  if (mostRecentStr !== todayStr && mostRecentStr !== yesterdayStr) return { best, current: 0 }

  let current = 1
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = new Date(sorted[i])
    const b = new Date(sorted[i + 1])
    const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000)
    if (diff - 1 <= maxRestGap) current++
    else break
  }

  return { best, current }
}
