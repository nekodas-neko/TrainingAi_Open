'use client'

import { useState } from 'react'
import { DAY_REVIEW_WEEK_WINDOW_TTL } from '@trainingai/shared/cache-ttl'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { Sparkline } from '@/components/ui/sparkline'
import {
  trendRows, deltaSentence, TREND_TIME_DOMAIN, type TrendRow,
} from './day-trends'
import type { WeekWindowResponse } from '@/app/api/day-review/week-window/route'

interface Props {
  date: string
}

const ARROW: Record<'up' | 'down' | 'level', string> = { up: '↑', down: '↓', level: '→' }

/**
 * One stat's row. Exported because the weekly recap draws the identical card over a five-week
 * window (Q-112e) — the only things that vary are the sparkline's domain, the phrase the delta is
 * measured against, and what to call a missing reading.
 */
export function TrendRowCard({
  row,
  timeDomain = TREND_TIME_DOMAIN,
  comparison,
  absentLabel = 'No reading today',
}: {
  row: TrendRow
  timeDomain?: [number, number]
  comparison?: string
  absentLabel?: string
}) {
  const { spec, today, delta, series } = row
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{spec.label}</p>
          {today == null
            // An absence is not a value, and must not be dressed as one: muted and regular weight,
            // where a reading is coloured and semibold. Styled alike, "No reading today" read as
            // the loudest thing on the card.
            ? <p className="text-xs text-muted-foreground">{absentLabel}</p>
            : <p className="text-sm font-semibold" style={{ color: spec.color }}>{spec.format(today)}</p>}
        </div>
        {series && (
          <Sparkline
            values={series.values}
            times={series.times}
            timeDomain={timeDomain}
            width={110}
            height={30}
            color={spec.color}
            // Exact min/max. The 0.5 default halves the visible amplitude of a small spread, which
            // on a week of body weight is most of what there is to see (Q-154).
            valuePadding={0}
            pad={4}
            showDots
            emphasizeLast
          />
        )}
      </div>
      {delta && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          <span aria-hidden="true">{ARROW[delta.direction]}</span>{' '}
          {deltaSentence(spec, delta, comparison)}
        </p>
      )}
    </div>
  )
}

/**
 * The day review's week-at-a-glance (Q-112d) — four stats, each against the seven days before today.
 *
 * **A child of the sheet rather than a hook in `EndOfDayReview`, for the same reason
 * `DayReadThroughSection` is.** That component is rendered unconditionally by `nutrition-content`;
 * `open` only drives Radix. A fetch in its body would run on every Nutrition visit whether or not
 * anyone opened the wrap-up, and `SheetContent` does not `forceMount`, so mounting here is what
 * keeps the request off the tab's critical path.
 *
 * `useCachedValue` because this sheet lives in the persistent tab shell, where a
 * `useEffect(…, [])` holds its first payload until the app is killed (Q-402) — and with an
 * `onError`, because `cachedFetch` swallows `!res.ok` including the route's own 429, which without
 * one makes the whole section vanish rather than say anything (Q-499).
 */
export function DayTrendsSection({ date }: Props) {
  const [failed, setFailed] = useState(false)
  const data = useCachedValue<WeekWindowResponse>(
    `day-review-week-window:${date}`,
    `/api/day-review/week-window?date=${date}`,
    DAY_REVIEW_WEEK_WINDOW_TTL,
    { onError: () => setFailed(true) },
  )

  if (failed && !data) {
    return (
      <section className="rounded-2xl border border-border p-3">
        <h3 className="text-sm font-semibold">Against the last week</h3>
        <p className="mt-1 text-xs text-muted-foreground">Could not load the last week.</p>
      </section>
    )
  }
  if (!data) return null

  const rows = trendRows(data)
  if (rows.length === 0) return null

  return (
    <section className="rounded-2xl border border-border p-3">
      <h3 className="text-sm font-semibold">Against the last week</h3>
      {/* One column, not two. At 412 dp a half-width card is ~170 px, which puts "Resting heart
          rate", its value and a sparkline in a column too narrow for any of them — the value wrapped
          to three lines — and a single visible row left half the grid empty. Four full-width rows in
          a sheet that already scrolls costs nothing. */}
      <div className="mt-2 flex flex-col gap-2">
        {rows.map(row => <TrendRowCard key={row.spec.key} row={row} />)}
      </div>
    </section>
  )
}
