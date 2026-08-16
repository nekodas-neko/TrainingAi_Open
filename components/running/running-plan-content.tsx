'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { cachedFetchToday, cachedFetch, readTodayCacheSync, readCacheSync } from '@/lib/sqlite/cache'
import { getLocalStore } from '@/lib/local-store'
import { useActivityStore } from '@/lib/stores/activity-store'
import { invalidateRunningPlan } from '@/lib/cache-groups'
import { RUNNING_PLAN_TTL, RUNNING_BESTS_TTL, RUN_TYPE_STATS_TTL, CARDIO_WEEK_TTL } from '@trainingai/shared/cache-ttl'
import { todayInTz } from '@trainingai/shared/date-utils'
import { hapticLight } from '@/lib/haptics'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Footprints, CheckCircle2 } from 'lucide-react'
import { PrescribedRunCard, type RunPrescription } from './prescribed-run-card'
import { PlanSetupSheet } from './plan-setup-sheet'
import { WeeklyZoneTargetsCard } from './weekly-zone-targets'
import { RunningBestsCard } from './running-bests-card'
import { RunTypeStatsCard } from './run-type-stats-card'
import { RunTypeCarousel, RUN_TYPES } from './run-type-carousel'
import { recommendRunType } from '@trainingai/shared/running/recommend-run-type'
import type { WeeklyZoneTargets } from '@trainingai/shared/running/zone-targets'
import type { RunningBests } from '@trainingai/shared/health/cardio-trends'
import type { RunTypeAggregate } from '@trainingai/shared/running/run-type-stats'
import type { FitnessSnapshot, RunType } from '@trainingai/shared/running/types'
import type { ZoneQuota } from '@trainingai/shared/health/zone-quota'
import type { PrescribedRun } from '@/lib/data/repository'

interface PlanResponse {
  plan: { id: string; frameworkKey: string; fitnessSnapshot?: FitnessSnapshot } | null
  prescription: RunPrescription | null
  gateAction?: 'proceed' | 'soften' | 'rest'
  gateReasons?: string[]
  // Both GET /api/running-plan and POST .../override return the full row (repo.getPrescribedRuns
  // / repo.upsertPrescribedRun) — updatedAt is a Date server-side but arrives as an ISO string
  // once JSON-serialized, and userId isn't needed by anything this screen does.
  run?: Omit<PrescribedRun, 'userId' | 'updatedAt'> & { updatedAt: string }
  zoneTargets?: WeeklyZoneTargets
  goal?: { key: string; label: string; blurb: string } | null
  isPushSession?: boolean
}

// Reused from the Cardiovascular hub's own payload — only the quota is needed here, and
// reusing the SAME 'cardio-week' cache key avoids a second, drifting cache entry for the
// same data (CLAUDE.md: grep for an existing key before adding one).
interface CardioWeekQuota {
  quota: ZoneQuota
}

export function RunningPlanContent({ userId }: { userId: string }) {
  const router = useTransitionRouter()
  // Starting the prescribed run hands off to /activity — the screen's primary action, and
  // a button push gets no automatic prefetch (#919).
  useEffect(() => { router.prefetch('/activity') }, [router])
  // Both back-exits go to /cardio and neither was warmed, so leaving this screen was slower than
  // entering the run from it.
  useEffect(() => { router.prefetch('/cardio') }, [router])
  const [data, setData] = useState<PlanResponse | null>(null)
  const [bests, setBests] = useState<RunningBests | null>(null)
  const [typeStats, setTypeStats] = useState<Record<RunType, RunTypeAggregate> | null>(null)
  const [quota, setQuota] = useState<ZoneQuota | null>(null)
  const [localStatus, setLocalStatus] = useState<'pending' | 'completed' | 'skipped' | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [overriding, setOverriding] = useState(false)
  // Which carousel card is showing — seeded once from the current prescription's type (not
  // the recommendation, so first paint matches PrescribedRunCard below); null until seeded.
  const [carouselIndex, setCarouselIndex] = useState<number | null>(null)
  const [carouselDuration, setCarouselDuration] = useState<number | null>(null)
  // A-3: the body only renders once `data` resolves — a first-ever visit while offline
  // or when the route errors otherwise showed a lone "Running" header forever. Track a
  // failure so we can show an error-with-retry (and a skeleton while loading).
  const [loadError, setLoadError] = useState(false)
  // Guards against a slow refresh() GET straggling in after a faster, later override POST
  // and clobbering it back to the pre-override prescription — only the most-recently-fired
  // request's response is ever applied to state.
  const requestSeqRef = useRef(0)

  const refresh = useCallback(() => {
    setLoadError(false)
    const seq = ++requestSeqRef.current
    // B1: today-key variant — the payload's `run`/`prescription` are created for TODAY,
    // and the 7-day offline seed floor otherwise painted yesterday's "run done" (or
    // yesterday's gate) across midnight. cachedFetchToday treats a past-dated seed as a
    // miss instead of flashing stale today-data.
    cachedFetchToday<PlanResponse>('running-plan', '/api/running-plan', RUNNING_PLAN_TTL, (d) => {
      if (seq === requestSeqRef.current) setData(d)
    }, { onError: () => setLoadError(true) }).catch(() => {})
  }, [])

  // Seed synchronously from cache, then revalidate.
  useEffect(() => {
    const seed = readTodayCacheSync<PlanResponse>('running-plan')
    if (seed) setData(seed)
    refresh()
  }, [refresh])

  // All-time bests — not date-scoped, so the plain (non-today) cache variant.
  useEffect(() => {
    const seed = readCacheSync<RunningBests>('running-bests')
    if (seed) setBests(seed)
    cachedFetch<RunningBests>('running-bests', '/api/running-bests', RUNNING_BESTS_TTL, setBests).catch(() => {})
  }, [])

  // Avg pace/distance/HR per run type — also all-time, plain (non-today) cache variant.
  useEffect(() => {
    const seed = readCacheSync<Record<RunType, RunTypeAggregate>>('run-type-stats')
    if (seed) setTypeStats(seed)
    cachedFetch<Record<RunType, RunTypeAggregate>>('run-type-stats', '/api/running-plan/run-type-stats', RUN_TYPE_STATS_TTL, setTypeStats).catch(() => {})
  }, [])

  // Zone quota, for the carousel's "what would help most this week" recommendation.
  useEffect(() => {
    const seed = readTodayCacheSync<CardioWeekQuota>('cardio-week')
    if (seed) setQuota(seed.quota)
    cachedFetchToday<CardioWeekQuota>('cardio-week', '/api/cardio-week', CARDIO_WEEK_TTL, (d) => setQuota(d.quota)).catch(() => {})
  }, [])

  // Sync the carousel to today's ACTUAL prescription whenever it changes — not the
  // recommendation, so paint matches the card below. Re-syncs on every prescription update
  // (not just the first), since the initial stale-cache seed is commonly replaced by a
  // different prescription once refresh()'s network fetch resolves; requestSeqRef already
  // guards `data` against stale/racy responses, and a user-driven swipe's own applyOverride
  // response carries the matching type back, so this can't clobber an in-flight selection.
  useEffect(() => {
    if (!data?.prescription) return
    const idx = RUN_TYPES.indexOf(data.prescription.type)
    setCarouselIndex(idx >= 0 ? idx : 1)
    setCarouselDuration(data.prescription.durationMin ?? 30)
  }, [data?.prescription])

  const recommendation = quota ? recommendRunType(quota) : null

  // Local-first read of today's prescribed-run status so an offline skip/complete shows
  // immediately (the server payload is only a fallback / hydration source).
  useEffect(() => {
    const store = getLocalStore(userId)
    if (!store) return
    const today = todayInTz()
    store.getPrescribedRuns(today).then((runs) => {
      const todays = runs.find((r) => r.date === today)
      if (todays) setLocalStatus(todays.status)
    }).catch(() => {})
  }, [userId, data])

  // Manually pick a different run structure/duration for today — the carousel-native
  // alternative to a separate Skip concept (Q-98-followup). Resets status to pending if it had
  // already been skipped by old data (the Skip button itself is gone — swiping to a different
  // type IS the "not this one" action now).
  const applyOverride = useCallback(async (runType: RunType, durationMin: number) => {
    setOverriding(true)
    const seq = ++requestSeqRef.current
    try {
      const res = await fetch('/api/running-plan/override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runType, durationMin }),
      })
      if (!res.ok) { toast.error("Couldn't update your run — try again"); return }
      const updated: PlanResponse = await res.json()
      if (seq === requestSeqRef.current) {
        setData((prev) => (prev ? { ...prev, ...updated } : updated))
        setLocalStatus('pending')
      }
      // Q-98: write through the local store the same way markRun does. Without this, the
      // local-first status effect (it re-runs on every `data` change, including the setData
      // above) re-reads the STALE 'skipped' row markRun left behind and clobbers the reset back
      // to skipped — invisible on web (getLocalStore() returns null there) but permanent on the
      // APK. The override already reached the server via the POST above, so this is marked
      // synced rather than queued as a pending outbox mutation.
      if (updated.run) {
        const store = getLocalStore(userId)
        if (store) {
          await store.upsertPrescribedRun({
            ...updated.run,
            deletedAt: null,
            syncStatus: 'synced',
          }).catch(() => {})
        }
      }
      await invalidateRunningPlan()
    } catch {
      toast.error("Couldn't update your run — try again")
    } finally {
      setOverriding(false)
    }
  }, [userId])

  const handleIndexChange = useCallback((index: number) => {
    setCarouselIndex(index)
    hapticLight()
    applyOverride(RUN_TYPES[index], carouselDuration ?? 30)
  }, [carouselDuration, applyOverride])

  const handleDurationChange = useCallback((durationMin: number) => {
    setCarouselDuration(durationMin)
    applyOverride(RUN_TYPES[carouselIndex ?? 1], durationMin)
  }, [carouselIndex, applyOverride])

  const onStart = useCallback(() => {
    // Hand off to the guided-activity flow to execute + log the run. startActivity resets
    // the whole session (including prescribedRunId), so it must fire first — linking the
    // prescription id after is what lets completion route back to this row (device round-trip).
    const store = useActivityStore.getState()
    store.startActivity('run', 'Run', 'PersonSimpleRun', true)
    if (data?.run?.id) store.linkPrescribedRun(data.run.id)
    router.push('/activity')
  }, [router, data?.run?.id])

  const status = localStatus ?? data?.run?.status ?? 'pending'

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-4 pt-safe pb-safe">
      <div className="flex items-center gap-2">
        <Footprints className="h-6 w-6" style={{ color: 'var(--accent-cyan)' }} aria-hidden />
        <h1 className="text-xl font-bold">Running</h1>
      </div>

      {data == null && !loadError && (
        <div className="mt-2 space-y-3" aria-hidden>
          <div className="h-24 animate-pulse rounded-2xl bg-[color:var(--muted)]" />
          <div className="h-10 w-2/3 animate-pulse rounded-xl bg-[color:var(--muted)]" />
        </div>
      )}

      {data == null && loadError && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-[color:var(--muted-foreground)]">Couldn&apos;t load your running plan.</p>
          <Button variant="outline" onClick={refresh}>Retry</Button>
        </div>
      )}

      {data && data.plan == null && (
        <div className="mt-6 flex flex-col items-center gap-3 text-center">
          <Footprints className="h-10 w-10 text-[color:var(--muted-foreground)]" aria-hidden />
          <p className="text-sm text-[color:var(--muted-foreground)]">
            No running plan yet. Set one up and the app will prescribe your next run.
          </p>
          <Button onClick={() => setSetupOpen(true)}>Set up my running plan</Button>
        </div>
      )}

      {data?.plan && bests && <RunningBestsCard bests={bests} />}
      {data?.plan && typeStats && <RunTypeStatsCard stats={typeStats} />}

      {data?.plan && data.prescription && status !== 'completed' && carouselIndex !== null && (
        <>
          <RunTypeCarousel
            index={carouselIndex}
            onIndexChange={handleIndexChange}
            durationMin={carouselDuration ?? data.prescription.durationMin ?? 30}
            onDurationChange={handleDurationChange}
            fitness={data.plan.fitnessSnapshot ?? { maxHr: 190, restingHr: 60, vo2max: null, thresholdHr: null, weeklyBaseMinutes: 60, source: 'age-estimate' }}
            recommendedType={recommendation?.type ?? null}
            recommendedReason={recommendation?.reason ?? null}
            disabled={overriding}
          />
          {/* No more pending-vs-skipped branch: Q-98-followup drops the separate Skip button
              concept entirely — swiping to a different type on the carousel above already IS
              "not this one", and a pre-existing 'skipped' row from before this change renders
              exactly like 'pending' here (there's nothing left to distinguish it with). */}
          <PrescribedRunCard
            prescription={data.prescription}
            gateAction={data.gateAction ?? 'proceed'}
            gateReasons={data.gateReasons ?? []}
            isPushSession={data.isPushSession}
            onStart={onStart}
          />
        </>
      )}

      {data?.plan && status === 'completed' && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-6 text-center">
          <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--accent-green)' }} aria-hidden />
          <p className="text-sm font-medium">Today&apos;s run is done — nice work.</p>
          <Button variant="outline" onClick={() => router.push('/cardio')}>Back to Cardio</Button>
        </div>
      )}

      {data?.plan && data.zoneTargets && (
        <WeeklyZoneTargetsCard zoneTargets={data.zoneTargets} goalLabel={data.goal?.label} />
      )}

      <PlanSetupSheet open={setupOpen} onOpenChange={setSetupOpen} onCreated={refresh} />
    </div>
  )
}
