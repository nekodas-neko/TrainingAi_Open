'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { todayInTz } from '@trainingai/shared/date-utils'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { HrDayChart } from './hr-day-chart'
import type { HrSleepWindow } from '@trainingai/shared/health/hr-sleep-band'

interface HrReading { timestamp: string; bpm: number; source: string | null }
interface WorkoutSession { sessionName: string; startedAt: string; completedAt: string | null }

/**
 * Self-fetching 24h heart-rate card. Moved out of the Oura-ring section into the Heart & Recovery
 * section so all heart data lives together (owner request). Shares the same cache keys the ring
 * section used, so no extra network cost.
 */
export function HrDayCard() {
  const today = todayInTz()
  const [hrReadings, setHrReadings] = useState<HrReading[]>([])
  const [sleepWindow, setSleepWindow] = useState<HrSleepWindow | null>(null)
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([])

  // Seed synchronously from cache before paint (never in a useState lazy initializer — hydration).
  useLayoutEffect(() => {
    const hr = readCacheSync<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(`oura-hr-day:${today}`)
    if (hr?.readings?.length) setHrReadings(hr.readings)
    if (hr?.sleep) setSleepWindow(hr.sleep)
    const ws = readCacheSync<{ sessions: WorkoutSession[] }>(`workout-sessions-day:${today}`)
    if (ws?.sessions?.length) setWorkoutSessions(ws.sessions)
  }, [today])

  useEffect(() => {
    cachedFetch<{ readings: HrReading[]; sleep: HrSleepWindow | null }>(
      `oura-hr-day:${today}`, `/api/oura/hr-day?date=${today}`, TTL_MEDIUM,
      d => {
        if (d?.readings?.length) setHrReadings(d.readings)
        setSleepWindow(d?.sleep ?? null)
      },
    ).catch(() => {})
    cachedFetch<{ sessions: WorkoutSession[] }>(
      `workout-sessions-day:${today}`, `/api/workout-sessions/day?date=${today}`, TTL_MEDIUM,
      d => { if (d?.sessions?.length) setWorkoutSessions(d.sessions) },
    ).catch(() => {})
  }, [today])

  return (
    <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Heart Rate · Today</p>
      {hrReadings.length > 0 ? (
        <HrDayChart readings={hrReadings} date={today} workoutSessions={workoutSessions} sleepWindow={sleepWindow} />
      ) : (
        <p className="text-xs text-muted-foreground">No HR captured yet today — the ring records periodically while worn.</p>
      )}
    </div>
  )
}
