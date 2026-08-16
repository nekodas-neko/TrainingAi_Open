'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { haversineDistanceKm } from '@/lib/activity/activity-metrics'
import { hrReserveTarget } from '@trainingai/shared/health/hr-zones'
import { hapticSuccess } from '@/lib/haptics'
import type { LiveHrSample } from '@/lib/live-hr/types'
import type { RoutePoint } from '@/lib/activity/route-encoding'
import { hrrRecoveryStartMs, type FitnessTestProtocol } from '@trainingai/shared/fitness-tests/protocols'
import { TestTimer } from './test-timer'
import { TestHrDisplay } from './test-hr-display'
import { TestHrrGuide } from './test-hrr-guide'

export interface CapturedHr { at: number; bpm: number }
export interface TestCapture {
  hrSamples: CapturedHr[]
  distanceM: number
  startMs: number
  endMs: number
  // Epoch ms the recovery window opened (phased HRR test) — the HR-recovery drop is
  // measured from here. null for distance/self-paced tests.
  recoveryStartMs: number | null
}

export function TestActive({ protocol, profile, startedAtMs, onFinish }: {
  protocol: FitnessTestProtocol
  profile: { age: number | null; restingHr: number; hrMax: number }
  startedAtMs: number
  onFinish: (c: TestCapture) => void
}) {
  const hrRef = useRef<CapturedHr[]>([])
  const pointsRef = useRef<RoutePoint[]>([])
  const distKmRef = useRef(0)
  const finishedRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const [distanceM, setDistanceM] = useState(0)
  const [gpsError, setGpsError] = useState<string | null>(null)

  const hrMax = profile.hrMax
  const target = useMemo(
    () => (protocol.effortFrac != null ? hrReserveTarget(protocol.effortFrac, profile.restingHr, hrMax) : null),
    [protocol.effortFrac, profile.restingHr, hrMax],
  )

  const finish = () => {
    if (finishedRef.current) return
    finishedRef.current = true
    hapticSuccess()
    onFinishRef.current({
      hrSamples: hrRef.current,
      distanceM: Math.round(distKmRef.current * 1000),
      startMs: startedAtMs,
      endMs: Date.now(),
      recoveryStartMs: protocol.phases ? hrrRecoveryStartMs(protocol.phases, startedAtMs) : null,
    })
  }

  // Live-HR lifecycle — this screen owns start()/stop().
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    const unsub = mgr.subscribe((sm: LiveHrSample) => { hrRef.current.push({ at: sm.at, bpm: sm.bpm }) })
    return () => { unsub(); mgr.stop().catch(() => {}) }
  }, [])

  // GPS lifecycle — only for distance-capturing protocols.
  useEffect(() => {
    if (!protocol.captureDistance) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher(
      (pt) => {
        const pts = pointsRef.current
        if (pts.length > 0) distKmRef.current += haversineDistanceKm(pts[pts.length - 1], pt)
        pts.push(pt)
        setDistanceM(Math.round(distKmRef.current * 1000))
      },
      (msg) => setGpsError(msg),
    ).then((w) => { if (cancelled) w.stop().catch(() => {}); else watcher = w })
    return () => { cancelled = true; watcher?.stop().catch(() => {}) }
  }, [protocol.captureDistance])

  // Phased HRR: guided rest → effort → recovery. The guide leaf owns the tick and
  // auto-finishes at the end of the recovery phase (finish() stamps recoveryStartMs).
  if (protocol.phases) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe-action-lg text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{protocol.name}</p>
        <TestHrrGuide startedAtMs={startedAtMs} phases={protocol.phases} onExpire={finish} />
        <TestHrDisplay target={target} />
        <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={finish}>
          End test early
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe-action-lg text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{protocol.name}</p>
      <TestTimer startedAtMs={startedAtMs} durationSec={protocol.durationSec} onExpire={finish} />

      {protocol.captureDistance && (
        <div>
          <p className="text-4xl font-bold tabular-nums">{(distanceM / 1000).toFixed(2)}<span className="text-lg text-muted-foreground ml-1">km</span></p>
          {gpsError && <p className="mt-1 text-xs" style={{ color: 'var(--accent-amber)' }}>GPS: {gpsError}</p>}
        </div>
      )}

      <TestHrDisplay target={target} />

      <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={finish}>
        {protocol.durationSec != null ? 'End test early' : 'Finish'}
      </Button>
    </div>
  )
}
