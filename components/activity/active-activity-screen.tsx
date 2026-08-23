'use client'

import { useCallback, useEffect, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { PauseIcon, PlayIcon, StopIcon } from '@phosphor-icons/react'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useShallow } from 'zustand/react/shallow'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { useCadenceTracking } from '@/lib/activity/use-cadence-tracking'
import { ActivityElapsedClock } from './activity-elapsed-clock'
import { CadenceReadout } from './cadence-readout'
import { HrReadout } from './hr-readout'
import { ActivitySecondaryMetrics } from './activity-secondary-metrics'
import { computeElevationChange } from '@/lib/activity/activity-metrics'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

export function ActiveActivityScreen() {
  const {
    activityLabel, title, activityType, isDistanceBased, isPaused,
    startMs, accumulatedPauseMs, pauseStartMs,
    rawPoints, distanceKm, currentPaceSecPerKm,
    pause, resume, finish,
  } = useActivityStore(useShallow(s => ({
    activityLabel: s.activityLabel, title: s.title, activityType: s.activityType,
    isDistanceBased: s.isDistanceBased,
    isPaused: s.isPaused, startMs: s.startMs, accumulatedPauseMs: s.accumulatedPauseMs,
    pauseStartMs: s.pauseStartMs, rawPoints: s.rawPoints, distanceKm: s.distanceKm,
    currentPaceSecPerKm: s.currentPaceSecPerKm, pause: s.pause, resume: s.resume, finish: s.finish,
  })))

  const { tracker: cadenceTracker, enabled: cadenceEnabled } = useCadenceTracking(activityType, startMs)

  const onFinish = useCallback(() => {
    finish(cadenceTracker?.summary() ?? null)
  }, [finish, cadenceTracker])

  // GPS watcher — only for distance-based activities, only while not paused.
  useEffect(() => {
    if (!isDistanceBased || isPaused) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useActivityStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => {
      cancelled = true
      watcher?.stop()
    }
  }, [isDistanceBased, isPaused])

  // Runs over points already in memory, and only once there are enough to have a gradient at all.
  // Hidden rather than shown as `0 m` — see ActivitySecondaryMetrics.
  const elevationGainM = useMemo(
    () => (rawPoints.length > 1 ? computeElevationChange(rawPoints).gainM : null),
    [rawPoints],
  )

  const paceLabel = currentPaceSecPerKm
    ? `${Math.floor(currentPaceSecPerKm / 60)}:${String(Math.round(currentPaceSecPerKm % 60)).padStart(2, '0')} /km`
    : '--:-- /km'

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6">
        <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">{title || activityLabel}</span>
        <ActivityElapsedClock
          startMs={startMs}
          accumulatedPauseMs={accumulatedPauseMs}
          isPaused={isPaused}
          pauseStartMs={pauseStartMs}
        />

        {/* Q-418: distance · pace · HR on the primary row, cadence and the running totals below it.
            Heart rate belongs up here because it is the one you act on mid-walk; it was missing
            entirely while the same strap supplying cadence was streaming beats. */}
        {(isDistanceBased || cadenceEnabled) && (
          <div className="flex w-full max-w-xs flex-col items-center gap-3">
            <div className="flex w-full justify-around text-center">
              {isDistanceBased && (
                <>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{distanceKm.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">km</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tabular-nums">{paceLabel}</p>
                    <p className="text-xs text-muted-foreground">pace</p>
                  </div>
                </>
              )}
              <HrReadout />
              {cadenceEnabled && <CadenceReadout tracker={cadenceTracker} />}
            </div>
            <ActivitySecondaryMetrics tracker={cadenceTracker} elevationGainM={elevationGainM} />
          </div>
        )}

        {isDistanceBased && rawPoints.length > 1 && (
          <ActivityRouteMap points={rawPoints} className="h-48 w-full max-w-xs" />
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
