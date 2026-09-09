"use client";

import { useEffect, useState } from "react";
import { getLocalStore } from "@/lib/local-store";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { shiftDateStr, todayInTz } from "@trainingai/shared/date-utils";
import { useCachedValue } from "@/lib/hooks/use-cached-value";
import { TTL_MEDIUM } from "@trainingai/shared/cache-ttl";
import { formatInTimeZone } from "date-fns-tz";
import {
  readingGroups, sleepAverages, circularMeanMinutes, clockFromMinutes,
  type MetricRow, type ReadingGroup, type SleepNight,
} from "./measured-overview";
import { ReadingGroupCard } from "./reading-group-card";

interface Props {
  userId?: string
  /**
   * The seven days `/api/body-metadata` returns. A fallback, not the source: the point of this card
   * is the LATEST reading of each metric, and a scale session or a composition figure is routinely
   * older than a week — read from the server alone, those metrics read as absent when they exist.
   */
  serverRecent?: MetricRow[]
}

/**
 * BF-133 — what the app has measured, beneath what the user told it.
 *
 * **Local-first, and that is required rather than preferred.** `body_metrics` is a domain the app
 * writes to the local store, and CLAUDE.md's offline-first rule is that a domain written locally
 * must be READ locally; the seven-day server window would also hide most of what this card exists to
 * show. `getLocalStore` returns null in the browser, so the server rows are the web fallback and the
 * device is where this is authoritative.
 */
export function MeasuredOverviewSection({ userId, serverRecent }: Props) {
  const tz = useUserTimezone()
  const [groups, setGroups] = useState<ReadingGroup[] | null>(null)

  useEffect(() => {
    let alive = true
    const fromServer = () => { if (alive) setGroups(readingGroups(serverRecent ?? [])) }
    const store = userId ? getLocalStore(userId) : null
    if (!store) { fromServer(); return () => { alive = false } }
    // A year is enough to catch a one-off scale session without loading the whole history; a metric
    // last read longer ago than that is not something this card should present as current. Derived
    // from the user's own day, not UTC — `body_metrics` rows are keyed by their local date.
    const cutoff = shiftDateStr(todayInTz(tz), -366)
    store.getBodyMetrics(cutoff)
      .then(rows => {
        if (!alive) return
        const local = readingGroups(rows as unknown as MetricRow[])
        // An empty local store on a fresh install is not "nothing measured".
        if (local.length > 0) setGroups(local)
        else fromServer()
      })
      .catch(fromServer)
    return () => { alive = false }
  }, [userId, serverRecent, tz])

  // The owner asked for average sleep duration and time by name. It is an average over the window
  // rather than a latest reading, so it is built beside the groups rather than inside them.
  const nights = useCachedValue<SleepNight[]>('sleep-sessions', '/api/sleep-sessions', TTL_MEDIUM)
  const sleep = Array.isArray(nights) ? sleepAverages(nights) : null
  const bedtime = Array.isArray(nights)
    // The minutes-of-day are computed in the USER's zone before the circular mean, not the device's
    // — a bare `getHours()` here renders a Brisbane bedtime as a New York one.
    ? circularMeanMinutes(nights.map(n => n.sleepStart), iso => {
        const hhmm = formatInTimeZone(new Date(iso), tz, 'HH:mm')
        const [h, m] = hhmm.split(':').map(Number)
        return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
      })
    : null

  const sleepRows = sleep ? ([
    sleep.durationHours != null && { label: 'Time asleep', value: `${sleep.durationHours.toFixed(1)} h` },
    bedtime != null && { label: 'Bedtime', value: clockFromMinutes(bedtime) },
    sleep.efficiency != null && { label: 'Efficiency', value: `${Math.round(sleep.efficiency)} %` },
    // Named for its window: this is the overnight low, not the daily resting figure above it and
    // not a workout's. The app holds all three and they are different numbers.
    sleep.lowestHeartRate != null && { label: 'Lowest heart rate overnight', value: `${Math.round(sleep.lowestHeartRate)} bpm` },
    sleep.respiratoryRate != null && { label: 'Breathing rate', value: `${sleep.respiratoryRate.toFixed(1)} /min` },
  ].filter(Boolean) as { label: string; value: string }[]) : []

  if ((groups == null || groups.length === 0) && sleepRows.length === 0) return null

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">What the app has measured</h2>
        <p className="text-xs text-muted-foreground">
          The most recent reading of each, and when it was taken. Nothing here is editable — these
          come from your scale, ring and phone.
        </p>
      </div>

      {(groups ?? []).map(group => (
        <ReadingGroupCard key={group.title} title={group.title} readings={group.readings} />
      ))}

      {sleepRows.length > 0 && sleep && (
        <div className="rounded-2xl border border-border bg-muted/40 overflow-hidden">
          <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Sleep · average of {sleep.nights} {sleep.nights === 1 ? 'night' : 'nights'}
          </p>
          <div className="divide-y divide-border/60">
            {sleepRows.map(r => (
              <div key={r.label} className="flex items-baseline gap-3 px-4 py-2.5">
                <p className="flex-1 min-w-0 text-sm">{r.label}</p>
                <p className="text-sm font-semibold tabular-nums">{r.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
