'use client'

import { useCallback, useEffect, useState } from 'react'
import { HeartPulse } from 'lucide-react'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { CARDIO_WEEK_TTL, RUNNING_PLAN_TTL } from '@trainingai/shared/cache-ttl'
import { Button } from '@/components/ui/button'
import { LogActivitySheet } from '@/components/workout/log-activity-sheet'
import { HeartProfileCard } from './heart-profile-card'
import { ZoneQuotaCard } from './zone-quota-card'
import { StepsQuotaCard } from './steps-quota-card'
import { LazyDayCreditCard } from './lazy-day-credit-card'
import { ModalityPicker } from './modality-picker'
import { TimePickerSheet } from './time-picker-sheet'
import { CardioTrendsSection } from './trends-section'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'

interface CardioWeek {
  week: { from: string; to: string }
  heart: {
    restingHr: number
    restingHrDeltaBpm: number | null
    avgHr: number | null
    avgHrDeltaBpm: number | null
    maxHr: number | null
    maxHrDeltaBpm: number | null
    isReliable: boolean
  }
  quota: ZoneQuota
  dayQuota: ZoneQuota
  guideline: { frameworkKey: string; totalMinutes: number; note: string; meets: boolean }
  steps: { today: number; todayGoal: number; week: number; weekGoal: number; weekGoalSoFar: number }
  hasRunningPlan: boolean
  trainedToday: boolean
}

interface RunningPlanPayload {
  plan: { id: string; frameworkKey: string } | null
  prescription: { type: string; durationMin: number | null } | null
  gateAction?: 'proceed' | 'soften' | 'rest'
  gateReasons?: string[]
  run?: { id: string; status: 'pending' | 'completed' | 'skipped' }
}

export function CardioContent() {
  const [data, setData] = useState<CardioWeek | null>(null)
  const [runningPlan, setRunningPlan] = useState<RunningPlanPayload | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [timePickerOpen, setTimePickerOpen] = useState(false)
  // Stable identities so the memoized ModalityPicker isn't defeated by fresh arrows each render.
  const openLogSheet = useCallback(() => setLogOpen(true), [])
  const openTimePicker = useCallback(() => setTimePickerOpen(true), [])

  const refresh = useCallback(() => {
    setLoadError(false)
    // Today-keyed: the quota is "this week so far", so a seed from a previous day would
    // paint yesterday's remaining minutes across midnight.
    cachedFetchToday<CardioWeek>('cardio-week', '/api/cardio-week', CARDIO_WEEK_TTL, (d) => setData(d), {
      onError: () => setLoadError(true),
    }).catch(() => {})
    // Reuses the SAME 'running-plan' cache key the /running screen already reads — no new
    // cache entry, no new route. Failure here is non-fatal: the picker just falls back to
    // walk/activity recommendations (handled by the runningPlanForRecommend default below).
    cachedFetchToday<RunningPlanPayload>('running-plan', '/api/running-plan', RUNNING_PLAN_TTL, (d) => setRunningPlan(d)).catch(() => {})
  }, [])

  useEffect(() => {
    const seed = readTodayCacheSync<CardioWeek>('cardio-week')
    if (seed) setData(seed)
    const runSeed = readTodayCacheSync<RunningPlanPayload>('running-plan')
    if (runSeed) setRunningPlan(runSeed)
    refresh()
  }, [refresh])

  const runningPlanForRecommend = {
    hasPlan: runningPlan?.plan != null,
    runPending: runningPlan?.run?.status === 'pending',
    prescriptionDurationMin: runningPlan?.prescription?.durationMin ?? null,
    prescriptionType: runningPlan?.prescription?.type ?? null,
    gateAction: runningPlan?.gateAction ?? null,
    gateReasons: runningPlan?.gateReasons ?? [],
  }

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-y-auto scrollbar-hide px-4 pt-safe pb-safe-action">
      <div className="flex items-center gap-2 px-0.5 pb-0.5 pt-1.5">
        <HeartPulse className="h-5 w-5" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
        {/* Matches the entry point's label on the workout screen — tapping "Cardio Hub" landing on
            a screen titled something else reads as having gone somewhere unintended. */}
        <h1 className="text-xl font-bold">Cardio Hub</h1>
      </div>

      {data == null && !loadError && (
        <div className="mt-1 space-y-2.5" aria-hidden>
          <div className="h-24 animate-pulse rounded-2xl bg-[color:var(--muted)]" />
          <div className="h-44 animate-pulse rounded-2xl bg-[color:var(--muted)]" />
        </div>
      )}

      {data == null && loadError && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[color:var(--muted-foreground)]">Couldn&apos;t load your week.</p>
          <Button variant="outline" onClick={refresh}>Retry</Button>
        </div>
      )}

      {data && (
        <>
          <HeartProfileCard
            restingHr={data.heart.restingHr}
            restingHrDeltaBpm={data.heart.restingHrDeltaBpm}
            avgHr={data.heart.avgHr}
            avgHrDeltaBpm={data.heart.avgHrDeltaBpm}
            maxHr={data.heart.maxHr}
            maxHrDeltaBpm={data.heart.maxHrDeltaBpm}
            isReliable={data.heart.isReliable}
          />
          <ZoneQuotaCard dayQuota={data.dayQuota} weekQuota={data.quota} />
          {!data.trainedToday && (
            <LazyDayCreditCard zone1Min={data.dayQuota.zones.find((z) => z.zoneId === 1)?.doneMin ?? 0} />
          )}
          <StepsQuotaCard
            today={data.steps.today}
            todayGoal={data.steps.todayGoal}
            week={data.steps.week}
            weekGoal={data.steps.weekGoal}
          />
          <p className="mt-1 px-0.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
            What do you want to do?
          </p>
          <ModalityPicker
            hasRunningPlan={data.hasRunningPlan}
            onLogActivity={openLogSheet}
            onPickTime={openTimePicker}
          />
          <CardioTrendsSection />
        </>
      )}

      <LogActivitySheet open={logOpen} onOpenChange={setLogOpen} />

      {data && (
        <TimePickerSheet
          open={timePickerOpen}
          onOpenChange={setTimePickerOpen}
          quota={data.quota}
          runningPlan={runningPlanForRecommend}
          onLogActivity={openLogSheet}
        />
      )}
    </div>
  )
}
