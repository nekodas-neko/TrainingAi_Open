'use client'

import { useState } from 'react'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { trendRowsFor, TREND_WEEK_TIME_DOMAIN } from '@/components/nutrition/end-of-day/day-trends'
import { TrendRowCard } from '@/components/nutrition/end-of-day/day-trends-section'
import type { MonthWindowResponse } from '@/app/api/weekly-review/month-window/route'

/**
 * The weekly recap's month-at-a-glance (Q-112e) — the same four stats the day review draws, over
 * five weekly points instead of eight daily ones, each judged against the four completed weeks
 * before it.
 *
 * **Nothing about the maths or the card is re-implemented here.** `trendRowsFor` and `TrendRowCard`
 * are the day review's, widened rather than copied: the two routes serve the same shape under
 * different names (`days`/`sevenDayAverages` against `weeks`/`priorAverages`) and a second copy of
 * a formula is a bug by definition in this repo. What varies is named at the call site — the
 * sparkline's domain, the phrase a delta is measured against, and what to call a missing week.
 *
 * **`/api/weekly-review/month-window`, not `/api/weekly-digest`.** The digest computes these numbers
 * and throws them away, but it is a POST that runs an LLM and caches prose; a chart wants the
 * numbers on a different clock from a paragraph. LB-64 shipped the read route for exactly this.
 *
 * `useCachedValue` rather than a `useEffect` fetch, because this renders inside Home — the
 * persistent tab shell, where a fetch-once effect holds its first payload until the app is killed
 * (Q-402) — and with an `onError`, because `cachedFetch` swallows `!res.ok` including the route's
 * own 429, which without one makes the section vanish rather than say anything (Q-499).
 */
export function WeekTrendsSection({ weekStart }: { weekStart: string }) {
  const [failed, setFailed] = useState(false)
  // One call site, so the TTL is the shared tier rather than a named key constant — that constant
  // belongs in `packages/shared/src/cache-ttl.ts` beside its siblings, which is Lane A's file, and
  // is worth adding the day a second site reads this key.
  const data = useCachedValue<MonthWindowResponse>(
    `weekly-review-month-window:${weekStart}`,
    `/api/weekly-review/month-window?weekStart=${weekStart}`,
    TTL_MEDIUM,
    { onError: () => setFailed(true) },
  )

  if (failed && !data) {
    return <p className="mt-3 text-xs text-muted-foreground">Couldn&apos;t load the last four weeks.</p>
  }
  if (!data) return null

  const rows = trendRowsFor({ points: data.weeks, priorAverages: data.priorAverages })
  if (rows.length === 0) return null

  return (
    <section className="mt-3">
      <h4 className="text-xs font-semibold text-muted-foreground">Against the last four weeks</h4>
      {/* One column, for the reason the daily version records: at 412 dp a half-width card cannot
          hold "Resting heart rate", its value and a sparkline. */}
      <div className="mt-2 flex flex-col gap-2">
        {rows.map(row => (
          <TrendRowCard
            key={row.spec.key}
            row={row}
            timeDomain={TREND_WEEK_TIME_DOMAIN}
            comparison="the last 4 weeks"
            absentLabel="No reading this week"
          />
        ))}
      </div>
    </section>
  )
}
