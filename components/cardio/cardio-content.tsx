'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { HeartPulse } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
import { TodaysCardioCard, type HeartHealthDayView } from './todays-cardio-card'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { useHeartHealthCompletion } from '@/lib/activity/heart-health-completion'
import { todayInTz } from '@trainingai/shared/date-utils'
import { LatestBaselineCard } from '@/components/fitness-tests/latest-baseline-card'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'
import type { HrProfile } from '@trainingai/shared/health/hr-profile'

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
    /** LA-82 — the route sends both; absent on a payload cached before it did. */
    maxHrSource?: HrProfile['maxHrSource']
    restingHrSource?: HrProfile['restingHrSource']
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
  run?: {
    id: string
    status: 'pending' | 'completed' | 'skipped'
    runType?: string
    durationMin?: number | null
    targetHrLow?: number | null
    targetHrHigh?: number | null
    targetZoneIds?: number[]
    activityLogId?: string | null
    completedAs?: 'run' | 'walk' | null
  }
  /** Issue 2093 — this week's measured days. Absent on a payload cached before it existed. */
  heartHealth?: { days: HeartHealthDayView[] }
}

export function CardioContent({ userId }: { userId?: string }) {
  const [data, setData] = useState<CardioWeek | null>(null)
  const [runningPlan, setRunningPlan] = useState<RunningPlanPayload | null>(null)
  const [loadError, setLoadError] = useState(false)
  const router = useRouter()
  const tz = useUserTimezone()
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

  const run = runningPlan?.run
  const week = runningPlan?.heartHealth?.days
  // Issue 2093: a measured day that met the rule is recorded done, whatever the activity was.
  useHeartHealthCompletion(userId, week)
  const prescriptionCard = useMemo(() => {
    if (run == null || data == null) return null
    const today = todayInTz(tz)
    return {
      durationMin: run.durationMin ?? null,
      targetZoneIds: run.targetZoneIds ?? [],
      runStatus: run.status,
      today: week?.find((d) => d.date === today) ?? null,
      week: week ?? [],
    }
  }, [run, data, week, tz])

  // No prescription id is armed any more: the measured minutes decide, so starting from this card
  // and starting from anywhere else are the same thing.
  const onRun = useCallback(() => {
    useActivityStore.getState().startActivity('run', 'Run', 'PersonSimpleRun', true)
    router.push('/activity')
  }, [router])

  const onGuidedWalk = useCallback(() => {
    router.push('/activity/guided-walk')
  }, [router])

  const onTreadmillWalk = useCallback((durationMin: number) => {
    useActivityStore.getState().logCompletedActivity('treadmill', 'Treadmill walk', 'PersonSimpleWalk', durationMin)
    router.push('/activity')
  }, [router])

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
            maxHrSource={data.heart.maxHrSource}
            restingHrSource={data.heart.restingHrSource}
            hasHrSource={data.quota.hasHrSource}
          />
          {/* BF-159. Moved off the Health tab's Training list, which is otherwise all lifting, and
              placed against the heart profile: that card is what the heart is doing lately, this is
              what it was measured at. Above the modality picker on purpose — taking a test is only a
              live option while you are deciding what to do today. */}
          <LatestBaselineCard userId={userId} />
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
          {/* Above the picker, never instead of it: the prescription is today's plan and there is
              one of it, the picker is how anything else gets logged. The first draft of RV-166's
              mockup replaced the picker, which lost "Other" and any second activity. */}
          {prescriptionCard && (
            <TodaysCardioCard
              {...prescriptionCard}
              onRun={onRun}
              onGuidedWalk={onGuidedWalk}
              onTreadmillWalk={onTreadmillWalk}
              onOtherActivity={openLogSheet}
            />
          )}
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
