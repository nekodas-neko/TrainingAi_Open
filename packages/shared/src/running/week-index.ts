const MS_PER_DAY = 86_400_000
const DAYS_PER_WEEK = 7

/** 0-based week index since a plan's creation, floor-divided — day 0-6 is week 0, day 7-13 is
 *  week 1, etc. Clamped at 0 so a clock skew or bad input never produces a negative index (which
 *  would make `WEEKLY_GROWTH ** weekIndex` grow instead of holding at the floor). */
export function weekIndexSince(createdAt: Date, today: Date): number {
  const daysElapsed = Math.floor((today.getTime() - createdAt.getTime()) / MS_PER_DAY)
  return Math.max(0, Math.floor(daysElapsed / DAYS_PER_WEEK))
}
