'use client'

import { useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { useLocalDay } from '@/components/shell/local-day-provider'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { useRevalidateOnReturn } from '@/lib/hooks/use-revalidate-on-return'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { HrDayChart } from './hr-day-chart'
import { noHrDataCopy } from './hr-source-copy'
import { useStressDay } from '@/lib/hooks/use-stress-day'
import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'

interface HrReading { timestamp: string; bpm: number; source: string | null }
interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

/**
 * Self-fetching 24h heart-rate card. Moved out of the Oura-ring section into the Heart & Recovery
 * section so all heart data lives together (owner request). Shares the same cache keys the ring
 * section used, so no extra network cost.
 *
 * Issue 2906: the shell mounts this once and never unmounts it, and it used to fetch on mount, on
 * a date change it could not see (the date was computed during render) and on an invalidated key,
 * so it kept saying "no heart rate recorded yet" after readings had landed some other way (Health
 * Connect upload, a sync from another device). Now `useCachedValue` seeds from the cache, fetches
 * and refetches on invalidation, and `useRevalidateOnReturn` revalidates behind the cached value
 * when the app resumes or the Health tab is shown again. The body is keyed by the local day so a
 * rollover starts a fresh card on the new day's keys instead of painting yesterday's readings.
 */
export function HrDayCard() {
  const today = useLocalDay()
  return <HrDayCardBody key={today} today={today} />
}

function HrDayCardBody({ today }: { today: string }) {
  const tz = useUserTimezone();
  const [failed, setFailed] = useState(false)
  const reloadToken = useRevalidateOnReturn()
  // TN-3b — the owner wants stress readable against heart rate on the same clock. Same key the
  // standalone strip uses, so `cachedFetch` de-dupes and this costs no extra request.
  const { data: stress } = useStressDay(today)

  // LB-176. Without `onError` the card explained an absence that did not happen — *"the ring
  // records periodically while worn"* is a fact about the ring, printed because a request failed.
  // RV-106 (a ring sync leaving this card on pre-sync data) is covered by `useCachedValue`'s own
  // invalidation subscription.
  const hr = useCachedValue<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(
    `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
    { onError: () => setFailed(true), reloadToken },
  )
  const ws = useCachedValue<{ sessions: WorkoutSession[] }>(
    `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
    { reloadToken },
  )
  const hrReadings = hr?.readings ?? []
  const sleepWindow = hr?.sleep ?? null
  const workoutSessions = ws?.sessions ?? []

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Heart Rate · Today</p>
      {hrReadings.length > 0 ? (
        <HrDayChart readings={hrReadings} date={today} workoutSessions={workoutSessions} sleepWindow={sleepWindow} stressSeries={stress?.series} stressTimezone={tz} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {failed && !hr
            ? "Couldn't load today's heart rate."
            : noHrDataCopy(null, 'day')}
        </p>
      )}
    </div>
  )
}
