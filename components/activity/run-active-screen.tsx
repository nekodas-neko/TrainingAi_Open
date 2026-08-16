'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useShallow } from 'zustand/react/shallow'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { computeSplits, computeElevationChange } from '@/lib/activity/activity-metrics'
import { useCadenceTracking } from '@/lib/activity/use-cadence-tracking'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { readTodayCacheSync, cachedFetchToday } from '@/lib/sqlite/cache'
import { RUNNING_PLAN_TTL } from '@trainingai/shared/cache-ttl'
import type { RunPrescription } from '@/components/running/prescribed-run-card'
import { chooseRunChipMode, formatDistanceChipText } from '@trainingai/shared/running/run-chip-text'
import { startRunClockChip, updateRunTextChip, stopRunChip } from '@/lib/native/run-status-chip'
import { ActivityElapsedClock } from './activity-elapsed-clock'
import { CadenceReadout } from './cadence-readout'
import { RunHrZoneHero } from './run-hr-zone-hero'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

interface RunningPlanTodayResponse {
  prescription: RunPrescription | null
}

export function RunActiveScreen() {
  const {
    title, isPaused, startMs, accumulatedPauseMs, pauseStartMs,
    rawPoints, distanceKm, currentPaceSecPerKm, activityType,
    pause, resume, finish,
  } = useActivityStore(useShallow(s => ({
    title: s.title, isPaused: s.isPaused, startMs: s.startMs,
    accumulatedPauseMs: s.accumulatedPauseMs, pauseStartMs: s.pauseStartMs,
    rawPoints: s.rawPoints, distanceKm: s.distanceKm, currentPaceSecPerKm: s.currentPaceSecPerKm,
    activityType: s.activityType, pause: s.pause, resume: s.resume, finish: s.finish,
  })))

  const { tracker: cadenceTracker, enabled: cadenceEnabled } = useCadenceTracking(activityType, startMs)

  // Today's prescription target, if this run was started from the running-plan card — seeded
  // from the same 'running-plan' cache RunningPlanContent already warmed. No new fetch/endpoint;
  // a run started without a plan simply never resolves a prescription and the hero shows no target.
  const [plan, setPlan] = useState<RunningPlanTodayResponse | null>(null)
  useEffect(() => {
    const seed = readTodayCacheSync<RunningPlanTodayResponse>('running-plan')
    if (seed) setPlan(seed)
    cachedFetchToday<RunningPlanTodayResponse>('running-plan', '/api/running-plan', RUNNING_PLAN_TTL, setPlan).catch(() => {})
  }, [])

  // Live HR runs for the whole run — unlike lifting there's no rest/set split to lever
  // battery against, so it's simply forced on for the run's duration.
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    mgr.setForced(true)
    return () => { mgr.stop().catch(() => {}) }
  }, [])

  const onFinish = useCallback(() => {
    finish(cadenceTracker?.summary() ?? null)
  }, [finish, cadenceTracker])

  // GPS watcher — a run is always distance-based (set at startActivity('run', ...)).
  useEffect(() => {
    if (isPaused) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useActivityStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => {
      cancelled = true
      watcher?.stop()
    }
  }, [isPaused])

  const splitsSoFar = useMemo(() => computeSplits(rawPoints), [rawPoints])
  const elevationSoFar = useMemo(() => computeElevationChange(rawPoints), [rawPoints])

  const paceLabel = currentPaceSecPerKm
    ? `${Math.floor(currentPaceSecPerKm / 60)}:${String(Math.round(currentPaceSecPerKm % 60)).padStart(2, '0')} /km`
    : '--:-- /km'

  const prescription = plan?.prescription ?? null
  const chipMode = useMemo(() => chooseRunChipMode(prescription), [prescription])

  // Duration/elapsed clock chip — (re)anchored whenever the run pauses/resumes,
  // since accumulatedPauseMs shifts the target finish instant forward.
  useEffect(() => {
    if (chipMode === 'distance') return
    if (isPaused || startMs == null) {
      stopRunChip()
      return
    }
    if (chipMode === 'duration' && prescription?.durationMin != null) {
      const anchorMs = startMs + accumulatedPauseMs + prescription.durationMin * 60_000
      startRunClockChip(anchorMs, title || 'Run', 'duration')
    } else {
      const anchorMs = startMs + accumulatedPauseMs
      startRunClockChip(anchorMs, title || 'Run', 'elapsed')
    }
    return () => stopRunChip()
  }, [chipMode, isPaused, startMs, accumulatedPauseMs, prescription?.durationMin, title])

  // Distance-mode text chip — re-posted whenever distance/pace/pause state changes.
  useEffect(() => {
    if (chipMode !== 'distance' || prescription?.distanceKm == null) return
    const text = formatDistanceChipText(distanceKm, prescription.distanceKm, currentPaceSecPerKm ? paceLabel : null, isPaused)
    updateRunTextChip(title || 'Run', text)
  }, [chipMode, prescription?.distanceKm, distanceKm, currentPaceSecPerKm, paceLabel, isPaused, title])

  // Always clear the chip when the screen unmounts (run finished or navigated away).
  useEffect(() => () => stopRunChip(), [])

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center gap-4 px-6 pt-safe">
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title || 'Run'}</span>
        <ActivityElapsedClock
          startMs={startMs}
          accumulatedPauseMs={accumulatedPauseMs}
          isPaused={isPaused}
          pauseStartMs={pauseStartMs}
        />

        <div className="flex w-full max-w-xs justify-around text-center">
          <div>
            <p className="text-2xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">km</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{paceLabel}</p>
            <p className="text-xs text-muted-foreground">pace</p>
          </div>
          {cadenceEnabled && <CadenceReadout tracker={cadenceTracker} />}
        </div>

        <RunHrZoneHero targetZoneIds={plan?.prescription?.targets.zoneIds} />

        {rawPoints.length > 1 && <ActivityRouteMap points={rawPoints} className="h-56 w-full" />}

        {(splitsSoFar.length > 0 || elevationSoFar.gainM > 0 || elevationSoFar.lossM > 0) && (
          <div className="w-full rounded-2xl border border-border bg-muted/40 px-4 py-3">
            {splitsSoFar.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {splitsSoFar.map(s => (
                  <span key={s.km} className="tabular-nums text-muted-foreground">
                    km {s.km}: {Math.floor(s.paceSec / 60)}:{String(s.paceSec % 60).padStart(2, '0')}
                  </span>
                ))}
              </div>
            )}
            {(elevationSoFar.gainM > 0 || elevationSoFar.lossM > 0) && (
              <p className="mt-1 text-xs text-muted-foreground">
                ↑ {elevationSoFar.gainM}m · ↓ {elevationSoFar.lossM}m
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-3 px-6 pb-safe-action-lg">
        <button
          type="button"
          onClick={isPaused ? resume : pause}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-3.5 text-sm font-bold transition active:scale-95"
        >
          {isPaused ? <PlayIcon size={18} weight="fill" /> : <PauseIcon size={18} weight="fill" />}
          {isPaused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition active:scale-95"
          style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
        >
          <StopIcon size={18} weight="fill" />
          Finish
        </button>
      </div>
    </div>
  )
}
