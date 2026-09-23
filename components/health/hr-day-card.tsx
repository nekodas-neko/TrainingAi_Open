'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { todayInTz } from '@trainingai/shared/date-utils'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { useInvalidationRefetch } from '@/lib/hooks/use-invalidation-refetch'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { HrDayChart } from './hr-day-chart'
import { useStressDay } from '@/lib/hooks/use-stress-day'
import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'

interface HrReading { timestamp: string; bpm: number; source: string | null }
interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

/**
 * Self-fetching 24h heart-rate card. Moved out of the Oura-ring section into the Heart & Recovery
 * section so all heart data lives together (owner request). Shares the same cache keys the ring
 * section used, so no extra network cost.
 */
const HR_DAY_KEYS = ['oura-hr-day:', 'workout-sessions-day:'] as const

export function HrDayCard() {
  const tz = useUserTimezone();
  const today = todayInTz(tz)
  const [hrReadings, setHrReadings] = useState<HrReading[]>([])
  const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(null)
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([])
  // TN-3b — the owner wants stress readable against heart rate on the same clock. Same key the
  // standalone strip uses, so `cachedFetch` de-dupes and this costs no extra request.
  const { data: stress } = useStressDay(today)

  // Seed synchronously from cache before paint (never in a useState lazy initializer — hydration).
  useLayoutEffect(() => {
    const hr = readCacheSync<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`)
    if (hr?.readings?.length) setHrReadings(hr.readings)
    if (hr?.sleep) setSleepWindow(hr.sleep)
    const ws = readCacheSync<{ sessions: WorkoutSession[] }>(`workout-sessions-day:${today}`)
    if (ws?.sessions?.length) setWorkoutSessions(ws.sessions)
  }, [today])

  // RV-106: a ring sync updated Home's HR strip and left this card on pre-sync data.
  // `invalidateOuraSync()` clears `oura-hr-day:` and Home's reader is gated on a `refreshTick` the
  // `ta:oura-ble-synced` listener bumps; this one was a `cachedFetch` in an effect keyed on `today`,
  // on a card the shell mounts once and never unmounts, and `health-content`'s own subscription
  // covers `body-metadata`/`sleep-sessions`/`readiness-score` but not these keys. Neither
  // `fetchSharedHealthData` nor `fetchActiveTabHealthData` fetches them, so the `tabEpoch` pass did
  // not reach them either — recovery needed a shell remount, a midnight rollover or a restart.
  //
  // `useStressDay` above is the reference for why these two were the broken reads and it was not:
  // it goes through `useCachedValue`, which already subscribes. (RV-106 left that untraced.)
  //
  // The `.catch(() => {})` these calls carried is gone with them: per RV-84 `cachedFetch` never
  // rejects, so it was dead code standing in for error handling.
  const load = useCallback(() => {
    void cachedFetch<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => {
        if (d?.readings?.length) setHrReadings(d.readings)
        setSleepWindow(d?.sleep ?? null)
      },
    )
    void cachedFetch<{ sessions: WorkoutSession[] }>(
      `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.sessions?.length) setWorkoutSessions(d.sessions) },
    )
  }, [today])

  useEffect(() => { load() }, [load])
  useInvalidationRefetch(HR_DAY_KEYS, load)

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Heart Rate · Today</p>
      {hrReadings.length > 0 ? (
        <HrDayChart readings={hrReadings} date={today} workoutSessions={workoutSessions} sleepWindow={sleepWindow} stressSeries={stress?.series} stressTimezone={tz} />
      ) : (
        <p className="text-xs text-muted-foreground">No HR captured yet today — the ring records periodically while worn.</p>
      )}
    </div>
  )
}
