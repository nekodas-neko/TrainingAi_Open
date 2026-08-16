'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import { buildIntervalPlan, segmentAt } from '@/lib/walk/interval-plan'
import { scheduleWalkCues, cancelWalkCues } from '@/lib/walk/walk-cues'
import { getLiveHrManager } from '@/lib/live-hr/manager'
import { hrReserveTarget, classifyZone } from '@trainingai/shared/health/hr-zones'
import { hapticSuccess } from '@/lib/haptics'
import type { LiveHrSample } from '@/lib/live-hr/types'
import { LeaveWalkDialog } from './leave-walk-dialog'
import { CadenceTracker } from '@/lib/activity/cadence-tracker'
import { CadenceReadout } from '@/components/activity/cadence-readout'
import type { CadenceSummary } from '@trainingai/shared/health/cadence'
import { startGpsWatcher, type GpsWatcher } from '@/lib/activity/gps-tracking'
import { startRunClockChip, stopRunChip } from '@/lib/native/run-status-chip'

const ActivityRouteMap = dynamic(
  () => import('@/components/activity/activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

export interface WalkHrSample { at: number; bpm: number }

const STALE_MS = 8_000

export function WalkActive({ userProfile, onFinish }: {
  userProfile: { age: number | null; restingHr: number; hrMax: number }
  onFinish: (samples: WalkHrSample[], cadence: CadenceSummary | null) => void
}) {
  const config = useGuidedWalkStore(s => s.config)
  const startedAtMs = useGuidedWalkStore(s => s.startedAtMs)
  const { rawPoints, distanceKm, currentPaceSecPerKm } = useGuidedWalkStore(useShallow(s => ({
    rawPoints: s.rawPoints, distanceKm: s.distanceKm, currentPaceSecPerKm: s.currentPaceSecPerKm,
  })))
  const plan = useMemo(() => buildIntervalPlan(config), [config])
  const samplesRef = useRef<WalkHrSample[]>([])
  // A guided walk is a walk, so it gets the same cadence measurement as any other foot
  // activity (sibling-surface parity with the manual activity screen).
  const cadenceRef = useRef<CadenceTracker | null>(null)
  const [cadenceTracker, setCadenceTracker] = useState<CadenceTracker | null>(null)
  const finishedRef = useRef(false)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const [elapsedSec, setElapsedSec] = useState(0)
  const [liveBpm, setLiveBpm] = useState<number | null>(null)
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null)
  const [confirmEndOpen, setConfirmEndOpen] = useState(false)

  const hrMax = userProfile.hrMax
  const targets = useMemo(() => ({
    fast: hrReserveTarget(0.70, userProfile.restingHr, hrMax),
    slow: hrReserveTarget(0.40, userProfile.restingHr, hrMax),
  }), [userProfile.restingHr, hrMax])

  // Live-HR lifecycle + sample collection. This screen owns start()/stop().
  useEffect(() => {
    const mgr = getLiveHrManager()
    mgr.start().catch(() => {})
    const unsub = mgr.subscribe((s: LiveHrSample) => {
      samplesRef.current.push({ at: s.at, bpm: s.bpm })
      setLiveBpm(s.bpm)
      setLastBeatAt(s.at)
    })
    return () => { unsub(); mgr.stop().catch(() => {}) }
  }, [])

  // Schedule background cues once on mount; cancel on unmount.
  useEffect(() => {
    if (startedAtMs != null) scheduleWalkCues(plan, startedAtMs)
    return () => { cancelWalkCues(plan) }
  }, [plan, startedAtMs])

  // GPS tracking — runs for the whole active walk (no pause/resume in this screen).
  useEffect(() => {
    if (startedAtMs == null) return
    // Treadmill: never start the watcher at all. Recording indoor GPS and discarding it later
    // would still burn battery and still risk a stray fix reaching the save path; not asking for
    // a fix is the only version with nothing to get wrong. `=== true` because a config persisted
    // before this field existed rehydrates without it, and undefined must mean "outdoors".
    if (useGuidedWalkStore.getState().config.treadmill === true) return
    let watcher: GpsWatcher | null = null
    let cancelled = false
    startGpsWatcher((point) => useGuidedWalkStore.getState().appendPoint(point)).then(w => {
      if (cancelled) w.stop(); else watcher = w
    })
    return () => { cancelled = true; watcher?.stop() }
  }, [startedAtMs])

  useEffect(() => {
    if (startedAtMs == null) return
    const tracker = new CadenceTracker()
    cadenceRef.current = tracker
    setCadenceTracker(tracker)
    void tracker.start(startedAtMs)
    return () => {
      cadenceRef.current = null
      setCadenceTracker(null)
      // Leaving this running would drain the strap for the rest of the day.
      void tracker.stop()
    }
  }, [startedAtMs])

  // 1 Hz tick resyncing from wall-clock so backgrounding never desyncs the timer.
  useEffect(() => {
    if (startedAtMs == null) return
    const tick = () => {
      const e = Math.floor((Date.now() - startedAtMs) / 1000)
      setElapsedSec(e)
      if (e >= plan.totalSec && !finishedRef.current) {
        finishedRef.current = true
        hapticSuccess()
        onFinishRef.current(samplesRef.current, cadenceRef.current?.summary() ?? null)
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAtMs, plan])

  const active = segmentAt(plan, elapsedSec)
  const kind = active?.segment.kind
  const isWork = kind === 'fast' || kind === 'slow'
  const hrLive = liveBpm != null && lastBeatAt != null && Date.now() - lastBeatAt < STALE_MS
  const verdict = liveBpm != null && isWork ? classifyZone(liveBpm, kind as 'fast' | 'slow', targets) : null
  const phaseColor = kind === 'fast' ? 'var(--color-brand)' : 'var(--color-muted-foreground)'
  const mm = active ? Math.floor(active.remainingSec / 60) : 0
  const ss = active ? active.remainingSec % 60 : 0
  const totalFast = plan.segments.filter(s => s.kind === 'fast').length

  // Status-bar pill — phase name + countdown to the phase's end, reusing the same
  // AndroidRunChip "duration" mode (and its notification slot/preference toggle) a
  // prescribed-duration run already uses: it counts down to a target instant and
  // flips to count-up if that instant is somehow passed. Re-anchored on every phase
  // change (segment.index), not every second — the countdown ticks natively.
  const phaseLabel = kind === 'fast' ? `Fast — set ${active?.segment.setNumber} of ${totalFast}`
    : kind === 'slow' ? `Slow — set ${active?.segment.setNumber} of ${totalFast}`
    : kind === 'warmup' ? 'Warm up'
    : kind === 'cooldown' ? 'Cool down'
    : null
  useEffect(() => {
    if (startedAtMs == null || !active || phaseLabel == null) {
      stopRunChip()
      return
    }
    const anchorMs = startedAtMs + active.segment.endSec * 1000
    startRunClockChip(anchorMs, phaseLabel, 'duration')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedAtMs, active?.segment.index, phaseLabel])
  useEffect(() => () => stopRunChip(), [])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 pt-safe pb-safe-action-lg text-center">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {active && active.segment.setNumber ? `Set ${active.segment.setNumber} of ${totalFast}` : active ? '—' : 'Finishing…'}
      </p>
      <p className="text-5xl font-black uppercase" style={{ color: phaseColor }}>
        {kind === 'fast' ? 'Fast' : kind === 'slow' ? 'Slow' : kind === 'warmup' ? 'Warm up' : kind === 'cooldown' ? 'Cool down' : '—'}
      </p>
      <p className="text-6xl font-bold tabular-nums">{mm}:{String(ss).padStart(2, '0')}</p>

      {/* Pace-primary once GPS pace exists (owner decision: pace is the real fast/slow
       *  signal, HR drifts set-over-set and is only a secondary confirmation). Degrades
       *  to today's HR-primary layout when no GPS lock exists (indoor/treadmill walk). */}
      {currentPaceSecPerKm != null ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">
              {Math.floor(currentPaceSecPerKm / 60)}:{String(Math.round(currentPaceSecPerKm % 60)).padStart(2, '0')}
            </span>
            <span className="text-sm text-muted-foreground">/km</span>
          </div>
          <div className="flex items-baseline gap-2" style={{ opacity: hrLive ? 1 : 0.5 }}>
            <span className="text-base font-semibold tabular-nums">{liveBpm ?? '—'}</span>
            <span className="text-xs text-muted-foreground">bpm{liveBpm != null && !hrLive ? ' (stale)' : ''}</span>
          </div>
        </>
      ) : (
        <div className="flex items-baseline gap-2" style={{ opacity: hrLive ? 1 : 0.5 }}>
          <span className="text-3xl font-bold tabular-nums">{liveBpm ?? '—'}</span>
          <span className="text-sm text-muted-foreground">bpm{liveBpm != null && !hrLive ? ' (stale)' : ''}</span>
        </div>
      )}

      <CadenceReadout tracker={cadenceTracker} />

      {distanceKm > 0 && (
        <p className="text-sm tabular-nums text-muted-foreground">{distanceKm.toFixed(2)} km</p>
      )}

      {rawPoints.length > 1 && (
        <ActivityRouteMap points={rawPoints} className="h-40 w-full max-w-xs" />
      )}

      {isWork && (
        <p className="text-sm font-semibold" style={{
          color: verdict === 'in' ? 'var(--color-brand)' : verdict ? '#eab308' : 'var(--color-muted-foreground)',
        }}>
          {verdict === 'in' ? `In zone (target ${kind === 'fast' ? `≥${targets.fast}` : `≤${targets.slow}`} bpm)`
            : verdict === 'push' ? `Push harder (aim ≥${targets.fast} bpm)`
            : verdict === 'ease' ? `Ease off (aim ≤${targets.slow} bpm)`
            : `Target ${kind === 'fast' ? `≥${targets.fast}` : `≤${targets.slow}`} bpm`}
        </p>
      )}

      <Button variant="outline" className="mt-2 h-12 w-full max-w-xs" onClick={() => setConfirmEndOpen(true)}>
        End walk
      </Button>

      <LeaveWalkDialog
        open={confirmEndOpen}
        onStay={() => setConfirmEndOpen(false)}
        onLeave={() => {
          setConfirmEndOpen(false)
          if (finishedRef.current) return
          finishedRef.current = true
          onFinishRef.current(samplesRef.current, cadenceRef.current?.summary() ?? null)
        }}
      />
    </div>
  )
}
