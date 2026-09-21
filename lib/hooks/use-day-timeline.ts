'use client'

import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { TTL_SHORT } from '@trainingai/shared/cache-ttl'
import type { TimelineEvent } from '@/app/api/day-timeline/route'

/**
 * The prefix every cache key for the day timeline sits under.
 *
 * **Load-bearing, and the reason is invalidation rather than tidiness.** `invalidateCache` matches
 * `key LIKE 'prefix%'`, and six write groups in `lib/cache-groups.ts` already clear
 * `home-day-timeline`. A date-scoped key underneath that prefix is therefore cleared by all six for
 * free. A fresh `day-timeline:` prefix would be a SECOND invalidation contract that every one of
 * those writers would have to remember — and missed invalidation is this repo's most repeated bug
 * class. `stress-day-timeline-key.test.ts` pins both halves.
 *
 * The bare prefix is Home's own key: a date-less, today-scoped variant. The name keeps "home" for
 * that reason — renaming it would mean touching all six groups, which is the cost this avoids.
 */
export const DAY_TIMELINE_KEY_PREFIX = 'home-day-timeline'

/** The cache key for one day's timeline. */
export function dayTimelineKey(date: string): string {
  return `${DAY_TIMELINE_KEY_PREFIX}:${date}`
}

/**
 * One day's typed, timestamped events — any date, not just today (TN-35).
 *
 * Home reads the bare today-scoped key through its own path; this is the date-scoped read the day
 * screen needs so a PAST day can be opened, which is what TN-35's pass test requires.
 */
export function useDayTimeline(date: string): { events: TimelineEvent[] } | null {
  return useCachedValue<{ events: TimelineEvent[] }>(
    dayTimelineKey(date),
    `/api/day-timeline?date=${date}`,
    TTL_SHORT,
  ) ?? null
}
