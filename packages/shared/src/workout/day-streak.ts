import { maxCompliantRestGapFor } from '@trainingai/shared/schedule-utils'
import type { Schedule } from '@trainingai/shared/types/program'

/**
 * RV-216 — the ONE training-streak formula, in calendar days.
 *
 * Two functions called `computeStreak` disagreed, and the reason was not a drifted copy: they
 * counted **different quantities**. Home's (`app/session-select/compute-streak.ts`) does
 * `count += 1 + consecutiveRest`, so a bridged rest day is part of the streak — a span of
 * calendar days. `lib/achievements.ts`'s does `streak++` once per dated entry, so rest days
 * bridge the gap without being counted — a count of sessions. Measured against the owner's real
 * history on 2026-09-26: **111 calendar days against 83 sessions at the same rest gap**, and the
 * reported "best 49" was the session count at a rest gap of 1. Neither was arithmetically wrong;
 * both were labelled "streak" and shown on screens he compares.
 *
 * **Calendar days is the reading the app already promises**, in three places written before this:
 * Home's card says "STREAK … days"; the four streak achievements say "7-day / 14-day / 30-day /
 * 60-day training streak"; and the StreakCard banner tells the user two rest days keep a streak
 * and the third breaks it.
 *
 * **`DEFAULT_MAX_REST_GAP` is 2 for the same reason.** The server's own rule agrees
 * (`ai-dynamic.ts` warns at 2 and breaks at >= 3), and `maxCompliantRestGapFor`'s fallback of 1
 * says in its own comment that it was chosen to preserve what "`computeStreak`'s two call sites
 * already assumed", not as an answer about what a streak is. A schedule-derived gap of 1 would
 * cut the owner's daily headline from 111 to 7 while the banner beside it promised otherwise.
 *
 * This is NOT for food, sleep or calorie-goal streaks. Those count dated entries at a gap of 0 —
 * "log food 7 days in a row" means seven entries — and `computeEntryStreak` is theirs.
 */
export const DEFAULT_MAX_REST_GAP = 2

/**
 * The rest allowance for a training streak: the banner's promise as a FLOOR, raised wherever the
 * user's own schedule legitimately implies a longer hole.
 *
 * Both halves are load-bearing and neither alone is right. A flat 2 would regress **BF-122a**,
 * which exists because someone training Mon+Tue has a five-day hole and is following their plan
 * through all of it — their streak broke every week under a literal 1, and would again under 2.
 * But `maxCompliantRestGapFor` alone returns **1** for a rotation, and that is what made More say
 * 49 while Home said 111 and the banner beside it promised two rest days were fine.
 *
 * `Math.max` of the two satisfies both: a rotation gets 2 (the promise), Mon+Tue still gets 5
 * (BF-122a), and a user with no schedule gets 2 rather than the old 1.
 */
export function streakRestGapFor(
  schedule: Pick<Schedule, 'type' | 'restAfterN' | 'days'> | null | undefined,
): number {
  return Math.max(DEFAULT_MAX_REST_GAP, maxCompliantRestGapFor(schedule))
}

export interface DayStreak {
  /** Calendar days in the streak running up to today, 0 when it is broken. */
  current: number
  /** The longest such span anywhere in the input. Always >= `current` by construction. */
  best: number
}

/**
 * @param trainedDates `YYYY-MM-DD` in the user's timezone. Order and duplicates do not matter.
 * @param todayStr     today in the user's timezone, from `todayInTz` — never a UTC slice.
 */
export function computeDayStreak(
  trainedDates: readonly string[],
  todayStr: string,
  maxRestGap: number = DEFAULT_MAX_REST_GAP,
): DayStreak {
  const days = [...new Set(trainedDates)].sort()
  if (days.length === 0) return { current: 0, best: 0 }

  // Spans of calendar days, split wherever the gap between two trained days exceeds the
  // allowance. A span is measured from its first trained day to its last, so the rest days
  // inside it are counted and the ones that ended it are not.
  const gap = (a: string, b: string) => Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  ) - 1

  let best = 1
  let spanStart = days[0]
  const spans: Array<[string, string]> = []
  for (let i = 1; i < days.length; i++) {
    if (gap(days[i - 1], days[i]) <= maxRestGap) continue
    spans.push([spanStart, days[i - 1]])
    spanStart = days[i]
  }
  spans.push([spanStart, days[days.length - 1]])
  for (const [from, to] of spans) {
    best = Math.max(best, gap(from, to) + 2)
  }

  // The current streak is the last span, and only if it reaches today — or yesterday, since a day
  // that has not ended yet must not break it. `maxRestGap` extends that grace the same way it
  // bridges a gap inside a span: an untrained today is one of the allowed rest days.
  const [lastFrom, lastTo] = spans[spans.length - 1]
  const current = gap(lastTo, todayStr) <= maxRestGap
    // Counted to TODAY, not to the last trained day: the rest days since are inside the streak,
    // which is what "111 days" means on the card.
    ? gap(lastFrom, todayStr) + 2
    : 0

  return { current, best: Math.max(best, current) }
}
