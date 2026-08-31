'use client'

import { useMemo } from 'react'
import { dateStrMidnightInTz } from '@trainingai/shared/date-utils'
import { EnergyTimelineChart } from '@/components/health/energy-timeline-chart'
import {
  TrainingSection, ActivitySection, EnergySection, SleepSection, BodySection, DayHrTrace, SectionLabel,
  type DayEntryControls,
} from './day-sections'
import { workoutKcalBySession } from './energy-summary'
import type { DayLogResult } from '@/app/api/day-log/route'
import type { EnergyBalanceResponse } from '@/app/api/nutrition/energy-balance/route'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import type { ActivityLog } from '@trainingai/shared/types'

/** Module-level so the empty fallback keeps one identity — it feeds a memoised chart. */
const EMPTY_HR: DayLogResult['hr'] = []

interface Props {
  date: string
  data: DayLogResult | null
  energy: EnergyBalanceResponse | null
  foodLogs: FoodLogWithItem[] | null
  restingHr: number | null
  tz?: string
  /** LB-1's edit/delete affordances. Every one is optional and every section already documents
   *  absent as read-only (`DayEntryControls`), which is what lets the evening wrap-up host the same
   *  markup without growing a second set of write paths. */
  controls?: DayEntryControls & {
    onDeleteActivity?: (log: ActivityLog) => void
    onSelectActivity?: (log: ActivityLog) => void
  }
  /** Rendered when the day holds nothing at all. `/health/day` browses any date and says so; the
   *  wrap-up is today and wants different words, so the host supplies them. */
  emptyLabel?: string
}

/**
 * The day's read-through: training, activity, energy, sleep, heart rate, body.
 *
 * Extracted for Q-112b so `/health/day` and the evening wrap-up draw the *same* markup off the same
 * `day-log:<date>` cache key rather than two implementations that drift. The sections themselves
 * were always shared; what was not was the order they appear in, which of them get a chart beside
 * them, and the empty case — and that is exactly the part a second host would have re-derived.
 *
 * Deliberately propless of any fetch: both hosts already own a different fetching strategy
 * (`/health/day` guards responses against a swipe that has moved on; the wrap-up is today-only and
 * uses `useCachedValue`), and folding those into one hook would have meant a date-guard the wrap-up
 * cannot exercise.
 */
export function DayReadThrough({
  date, data, energy, foodLogs, restingHr, tz, controls, emptyLabel = 'Nothing logged on this day.',
}: Props) {
  // Q-391: the per-session addends of the Energy section's "Workouts" row, so a session card and the
  // day total on the same screen cannot disagree — they are the same numbers.
  const kcalBySession = useMemo(() => workoutKcalBySession(energy), [energy])

  // `loggedAt` means when the food was EATEN, not when the row was written (Q-413) — the whole
  // reason this chart can exist. Before it, every back-filled day spiked at whatever hour the user
  // reached for their phone.
  const intakeEvents = useMemo(
    () => (foodLogs ?? []).map(l => ({ atMs: new Date(l.loggedAt).getTime(), kcal: l.calories })),
    [foodLogs],
  )

  const hasAnything = !!data && (
    data.exercises.length > 0 || data.activityLogs.length > 0 || !!data.sleep || !!data.bodyMeta || data.hr.length > 0
  )

  return (
    <div className="space-y-4">
      {data && (
        <TrainingSection
          data={data}
          kcalBySession={kcalBySession}
          onEditExercise={controls?.onEditExercise}
          onDeleteExercise={controls?.onDeleteExercise}
          onDeleteSession={controls?.onDeleteSession}
          onExerciseTap={controls?.onExerciseTap}
        />
      )}
      {data && (
        <ActivitySection
          data={data}
          onDeleteActivity={controls?.onDeleteActivity}
          onSelectActivity={controls?.onSelectActivity}
        />
      )}
      <EnergySection energy={energy} />
      {energy?.balance && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
          <EnergyTimelineChart
            dayStartMs={dateStrMidnightInTz(date, tz).getTime()}
            restingHr={restingHr}
            restingBaseKcal={energy.balance.restingBaseKcal}
            activeKcal={energy.balance.activeKcal}
            hr={data?.hr ?? EMPTY_HR}
            intake={intakeEvents}
          />
        </div>
      )}
      <SleepSection sleep={data?.sleep ?? null} tz={tz} />
      <BodyTempRow temp={data?.bodyTemp ?? null} />
      {data && data.hr.length > 1 && (
        <div>
          <SectionLabel>Heart rate through the day</SectionLabel>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
            <DayHrTrace points={data.hr} />
            <HrRange points={data.hr} />
          </div>
        </div>
      )}
      <BodySection body={data?.bodyMeta ?? null} />
      {data && !hasAnything && (
        <p className="py-16 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </div>
  )
}

/**
 * The day's heart-rate range, from the points the trace already has (Q-112b — "a stat pair beside
 * the trace, not a new fetch").
 *
 * **Labelled as 15-minute averages, not as the day's min and max, because that is what they are.**
 * `/api/day-log` buckets the per-minute series by MEAN bpm (`route.ts:271`) — deliberately, so one
 * spike cannot become a whole bucket. Averaging is exactly what removes the extremes: a three-minute
 * resting dip to 48 surfaces here as about 55, and a workout peak of 175 as about 150. Calling these
 * "Lowest" and "Highest" would print a number the payload cannot support, on a screen whose whole
 * job is telling the user what their day was. The true daily min/max exist server-side
 * (`oura_bucket.hr_min` / `hr_max`) and would be a route change — filed rather than guessed at.
 */
function HrRange({ points }: { points: DayLogResult['hr'] }) {
  let low = points[0].bpm
  let high = points[0].bpm
  for (const p of points) {
    if (p.bpm < low) low = p.bpm
    if (p.bpm > high) high = p.bpm
  }
  return (
    <div className="mt-3 flex items-baseline justify-center gap-6 border-t border-white/10 pt-3">
      <span className="text-[11px] text-muted-foreground">
        Low <span className="text-[15px] font-bold tabular-nums text-foreground">{low}</span> bpm
      </span>
      <span className="text-[11px] text-muted-foreground">
        High <span className="text-[15px] font-bold tabular-nums text-foreground">{high}</span> bpm
      </span>
      <span className="text-[10px] text-muted-foreground/80">15-min averages</span>
    </div>
  )
}

/**
 * Body temperature for the night (LB-25).
 *
 * **The deviation is rendered only when the route sends one, and it often will not.** `/api/day-log`
 * withholds `devC` while the temperature baseline is uncentred — the same condition that suspends
 * the readiness temperature ladder (TN-6a), because the stored deviations are positive on every
 * night measured. Nothing is drawn in its place: an empty slot or a "—" would read as missing data,
 * when the truth is that the app has a number and does not trust it. The mean is unaffected — an
 * absolute skin temperature is a measurement, not a derivation from the bad baseline.
 */
function BodyTempRow({ temp }: { temp: DayLogResult['bodyTemp'] }) {
  if (!temp || temp.meanC == null) return null
  return (
    <div className="flex items-baseline justify-center gap-6 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3">
      <span className="text-[11px] text-muted-foreground">
        Body temp{' '}
        <span className="text-[15px] font-bold tabular-nums text-foreground">{temp.meanC.toFixed(1)}</span>
        {' '}°C
      </span>
      {temp.devC != null && (
        <span className="text-[11px] text-muted-foreground">
          vs usual{' '}
          <span className="text-[15px] font-bold tabular-nums text-foreground">
            {temp.devC > 0 ? '+' : ''}{temp.devC.toFixed(2)}
          </span>
          {' '}°C
        </span>
      )}
    </div>
  )
}
