'use client'

import { DAY_LOG_TTL, ENERGY_BALANCE_TTL, HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { DayReadThrough } from '@/components/health/day-detail/day-read-through'
import type { DayLogResult } from '@/app/api/day-log/route'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'

interface Props {
  date: string
  tz?: string
  /** The day's meals, already fetched by the Nutrition screen that hosts this sheet. */
  logs: FoodLogWithItem[]
}

/**
 * The evening wrap-up's read-through (Q-112b) — the same component `/health/day` draws, on the same
 * `day-log:` / `energy-balance:` / `hr-profile` keys, so the two surfaces share one cached answer
 * rather than racing two of their own.
 *
 * **Its own component so the three fetches are gated by the sheet being open.** `EndOfDayReview` is
 * rendered unconditionally by `nutrition-content.tsx` — the `open` prop only drives Radix — so a
 * hook in that component's body runs on every Nutrition visit whether or not anyone opened the
 * wrap-up. `SheetContent` does not `forceMount`, so a child of it mounts only while open, and that
 * is what keeps three requests off the Nutrition tab's critical path.
 *
 * `useCachedValue`, not a hand-rolled seed-then-fetch: this sheet lives inside the persistent tab
 * shell, and an effect with an empty dep array would hold its first payload until the app was
 * killed (Q-402). `/health/day` keeps its own `cachedFetch` calls instead, because it guards
 * responses against a swipe that has already moved on — a guard this surface, being one day, has no
 * way to exercise.
 */
export function DayReadThroughSection({ date, tz, logs }: Props) {
  const dayLog = useCachedValue<DayLogResult>(`day-log:${date}`, `/api/day-log?date=${date}`, DAY_LOG_TTL)
  const energy = useCachedValue<EnergyBalanceResponse>(
    `energy-balance:${date}`, `/api/nutrition/energy-balance?date=${date}`, ENERGY_BALANCE_TTL,
  )
  const hrProfile = useCachedValue<{ maxHr: number; restingHr: number }>(
    'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
  )

  return (
    <DayReadThrough
      date={date}
      data={dayLog}
      energy={energy}
      // Free here, unlike on `/health/day`, which fetches these separately: the Nutrition screen has
      // already loaded the day's meals to render them, and the energy timeline's intake markers need
      // exactly that list (Q-414 — `loggedAt` is when the food was eaten, not when the row was
      // written).
      foodLogs={logs}
      restingHr={hrProfile?.restingHr ?? null}
      tz={tz}
      emptyLabel="Nothing logged today yet."
    />
  )
}
