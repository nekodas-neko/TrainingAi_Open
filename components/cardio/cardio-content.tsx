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
import { TodaysCardioCard } from './todays-cardio-card'
import { countedProgress } from './todays-cardio-copy'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { getLocalStore } from '@/lib/local-store'
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
}

/** Only what the card needs off today's logs — it names the activity that satisfied the
 *  prescription, and whether that activity had a heart rate (RV-166's estimated case). */
interface TodayActivity { id: string; durationMin: number | null; avgHr: number | null }

export function CardioContent({ userId }: { userId?: string }) {
  const [data, setData] = useState<CardioWeek | null>(null)
  const [runningPlan, setRunningPlan] = useState<RunningPlanPayload | null>(null)
  const [todayActivities, setTodayActivities] = useState<TodayActivity[] | null>(null)
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
    // Local-first, per the offline-first rule: activity_logs is a domain this app writes locally, so
    // the card reads what it wrote rather than waiting for a sync. Null on web/dev, where there is
    // no native SQLite — the card then states the day's verdict without the activity's own minutes.
    if (userId) {
      const store = getLocalStore(userId)
      if (store) {
        store.getActivityLogs(todayInTz(tz))
          .then((rows) => setTodayActivities(rows.map((r) => ({ id: r.id, durationMin: r.durationMin, avgHr: r.avgHr }))))
          .catch(() => {})
      }
    }
  }, [userId, tz])

  useEffect(() => {
    const seed = readTodayCacheSync<CardioWeek>('cardio-week')
    if (seed) setData(seed)
    const runSeed = readTodayCacheSync<RunningPlanPayload>('running-plan')
    if (runSeed) setRunningPlan(runSeed)
    refresh()
  }, [refresh])

  const run = runningPlan?.run
  const prescriptionCard = useMemo(() => {
    if (run == null || data == null) return null
    const zoneIds = run.targetZoneIds ?? []
    const zoneDoneMin = data.dayQuota.zones
      .filter((z) => zoneIds.includes(z.zoneId))
      .reduce((sum, z) => sum + z.doneMin, 0)
    const satisfying = run.activityLogId != null
      ? todayActivities?.find((a) => a.id === run.activityLogId) ?? null
      : null
    // The minutes count even with no heart rate (owner, 2026-09-27) — and with no zone target there
    // is nothing for a heart rate to be measured against, so the logged minutes ARE the measure.
    const walkable = todayActivities?.find((a) => a.durationMin != null) ?? null
    const fromLoggedMinutes = zoneIds.length === 0 || (walkable != null && walkable.avgHr == null)
    return {
      runType: run.runType ?? 'Cardio',
      durationMin: run.durationMin ?? null,
      targetZoneIds: zoneIds,
      targetHrLow: run.targetHrLow ?? null,
      targetHrHigh: run.targetHrHigh ?? null,
      runStatus: run.status,
      completedAs: run.completedAs ?? null,
      completedActivity: satisfying,
      progress: countedProgress(zoneDoneMin, fromLoggedMinutes ? walkable : null),
    }
  }, [run, data, todayActivities])

  // startActivity/logCompletedActivity both reset the session, prescribedRunId included, so the
  // link must follow the arm — the ordering running-plan-content.tsx documents.
  const onRunIt = useCallback(() => {
    if (!run) return
    const store = useActivityStore.getState()
    store.startActivity('run', 'Run', 'PersonSimpleRun', true)
    store.linkPrescribedRun(run.id)
    router.push('/activity')
  }, [run, router])

  const onGuidedWalk = useCallback(() => {
    if (!run) return
    // The guided walk keeps its own store, but the prescription id lives on the activity store and
    // walk-summary reads it from there — one home for the field rather than a second copy.
    useActivityStore.getState().linkPrescribedRun(run.id)
    router.push('/activity/guided-walk')
  }, [run, router])

  const onTreadmillWalk = useCallback((durationMin: number) => {
    if (!run) return
    const store = useActivityStore.getState()
    store.logCompletedActivity('treadmill', 'Treadmill walk', 'PersonSimpleWalk', durationMin)
    store.linkPrescribedRun(run.id)
    router.push('/activity')
  }, [run, router])

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
              onRunIt={onRunIt}
              onGuidedWalk={onGuidedWalk}
              onTreadmillWalk={onTreadmillWalk}
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
