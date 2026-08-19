'use client'

import { HR_PROFILE_TTL, HR_WINDOW_TTL } from '@trainingai/shared/cache-ttl'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { useCachedValue } from '@/lib/hooks/use-cached-value'
import { useState, useEffect, useMemo } from 'react'
import { formatTimeOfDay, formatDayShort, toAestDay, msToHHMMInTz } from '@trainingai/shared/date-utils';
import { getLocalStore } from '@/lib/local-store'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { omitNullFields } from '@/lib/local-store/sync-helpers'
import dynamic from 'next/dynamic'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from 'sonner'
import { useAutoDetectionStore } from '@/lib/stores/auto-detection-store'
import { decodeRoute } from '@/lib/activity/route-encoding'
import { invalidateActivityWrites, invalidateOuraWorkoutReview } from '@/lib/cache-groups'
import { buildRouteZoneSegments } from '@/lib/activity/route-hr-zones'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false }
)

interface HrWindow {
  avgHr: number | null
  maxHr: number | null
  readings: { timestamp: string; bpm: number }[]
}

function HrSparkline({ readings, startMs, endMs }: { readings: { timestamp: string; bpm: number }[]; startMs: number; endMs: number }) {
  const durationMs = endMs - startMs
  if (durationMs <= 0 || readings.length < 2) return null
  const bpms = readings.map(r => r.bpm)
  const minBpm = Math.min(...bpms)
  const maxBpm = Math.max(...bpms)
  const range = maxBpm - minBpm || 1
  const W = 300, H = 56, PAD = 4
  const points = readings
    .map(r => {
      const x = PAD + ((new Date(r.timestamp).getTime() - startMs) / durationMs) * (W - PAD * 2)
      const y = H - PAD - ((r.bpm - minBpm) / range) * (H - PAD * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
  return (
    <div className="mb-4 rounded-xl bg-muted/60 border border-border p-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Heart Rate</p>
        <p className="text-[10px] text-muted-foreground">{minBpm}–{maxBpm} bpm</p>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id="hr-sparkline-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(239,68,68)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(239,68,68)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon
          points={`${PAD},${H} ${points.join(' ')} ${(PAD + ((new Date(readings[readings.length - 1].timestamp).getTime() - startMs) / durationMs) * (W - PAD * 2)).toFixed(1)},${H}`}
          fill="url(#hr-sparkline-grad)"
        />
        <polyline points={points.join(' ')} fill="none" stroke="rgb(239,68,68)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

interface Props {
  sessionId: string | null
  /** Needed for the local-store write — without it this sheet is the one activity-save surface
   *  that cannot save offline (its two siblings, `done-activity-screen` and `walk-summary`, both
   *  take it). Optional so the web/dev path still renders. */
  userId?: string
  onClose: () => void
}

export function ExerciseReviewSheet({ sessionId, userId, onClose }: Props) {
  const userTz = useUserTimezone()
  const pendingSessions = useAutoDetectionStore(s => s.pendingSessions)
  const removeSession = useAutoDetectionStore(s => s.removeSession)
  const session = pendingSessions.find(p => p.id === sessionId) ?? null

  const [saving, setSaving] = useState(false)
  const [activityType, setActivityType] = useState<'walk' | 'run'>('walk')
  const [hrData, setHrData] = useState<HrWindow>({ avgHr: null, maxHr: null, readings: [] })
  const hrProfile = useCachedValue<{ maxHr: number; restingHr: number }>(
    'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
  )

  useEffect(() => {
    if (!session) return
    setActivityType(session.activityType)

    const query = `start=${encodeURIComponent(new Date(session.startMs).toISOString())}&end=${encodeURIComponent(new Date(session.endMs).toISOString())}`
    const key = `hr-window:${query}`
    // The window belongs to a session that has already finished, so a previously-fetched trace
    // is the right thing to paint while the revalidation lands — re-opening the sheet used to
    // blank the sparkline and re-fetch. Keyed by the window itself, so an edited window misses.
    setHrData(readCacheSync<HrWindow>(key) ?? { avgHr: null, maxHr: null, readings: [] })
    cachedFetch<HrWindow>(
      key, `/api/oura/hr-window?${query}`, HR_WINDOW_TTL,
      data => { if (data) setHrData({ avgHr: data.avgHr, maxHr: data.maxHr, readings: data.readings ?? [] }) },
    ).catch(() => {})
  }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!session) return
    setSaving(true)
    try {
      // The calendar day this activity is FILED under, in the user's timezone. This used to be
      // built from getFullYear()/getMonth()/getDate() — the device's zone — which files a
      // 9pm Brisbane walk under the previous day for a device set to UTC, and no later fix can
      // recover which day was meant because it is persisted, not rendered.
      const dateStr = toAestDay(new Date(session.startMs), userTz)
      const label = activityType === 'run' ? 'Run' : 'Walk'
      const timeLabel = formatTimeOfDay(session.startMs, userTz)
      const title = `${label} at ${timeLabel}`
      const routePolyline = session.source === 'phone' ? session.routePolyline ?? null : null

      const store = userId ? getLocalStore(userId) : null
      let savedLocally = false
      if (store) {
        try {
          const logId = crypto.randomUUID()
          await store.upsertActivityLog({
            id: logId, date: dateStr, activityType, title,
            durationMin: session.durationMin,
            distanceKm: session.distanceKm ?? null,
            steps: null,
            avgHr: hrData.avgHr,
            maxHr: hrData.maxHr,
            // Derived server-side in saveActivityLog (Q-230).
            caloriesBurned: null,
            startTime: msToHHMMInTz(session.startMs, userTz),
            endTime: msToHHMMInTz(session.endMs, userTz),
            notes: null,
            routePolyline,
            splits: null, bestEfforts: null, paceSeries: null, avgPaceSecPerKm: null,
            elevationGainM: null, elevationLossM: null, elevationProfile: null,
            cadenceSpm: null, cadenceSeries: null, cadenceSource: null,
            segments: null,
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            syncStatus: 'pending',
          })
          await store.queueMutation({
            userId: userId!,
            domain: 'activity_logs',
            date: dateStr,
            // The route's Zod schema declares these .optional() (T | undefined), not nullable —
            // omitNullFields drops the null placeholders so the payload matches the wire contract.
            payload: omitNullFields({
              id: logId, activityType, title,
              durationMin: session.durationMin,
              distanceKm: session.distanceKm ?? null,
              avgHr: hrData.avgHr,
              maxHr: hrData.maxHr,
              // Derived server-side in saveActivityLog (Q-230).
            caloriesBurned: null,
              startTime: msToHHMMInTz(session.startMs, userTz),
              endTime: msToHHMMInTz(session.endMs, userTz),
              routePolyline,
            }),
          })
          pushMutations(userId!).catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Activity log SQLite write failed, falling back to API:', sqliteErr)
        }
      }

      if (!savedLocally) {
        const res = await fetch('/api/activity-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: dateStr,
            activityType,
            title,
            startTime: msToHHMMInTz(session.startMs, userTz),
            endTime: msToHHMMInTz(session.endMs, userTz),
            durationMin: session.durationMin,
            distanceKm: session.distanceKm,
            routePolyline: routePolyline ?? undefined,
            avgHr: hrData.avgHr ?? undefined,
            maxHr: hrData.maxHr ?? undefined,
          }),
        })
        if (!res.ok) throw new Error()
      }

      if (session.source === 'oura' && session.ouraWorkoutId) {
        fetch('/api/oura/workouts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: session.ouraWorkoutId }),
        }).catch(() => {})
      }

      // If saving a phone session, also mark any overlapping Oura sessions as
      // reviewed so the same walk doesn't reappear after the next Oura sync.
      if (session.source === 'phone') {
        const allSessions = useAutoDetectionStore.getState().pendingSessions
        for (const other of allSessions) {
          if (other.source !== 'oura' || !other.ouraWorkoutId) continue
          const overlaps = other.startMs < session.endMs && other.endMs > session.startMs
          if (!overlaps) continue
          fetch('/api/oura/workouts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: other.ouraWorkoutId }),
          }).catch(() => {})
          removeSession(other.id)
        }
      }

      removeSession(session.id)
      await Promise.all([invalidateActivityWrites(), invalidateOuraWorkoutReview()])
      toast.success('Activity saved')
      onClose()
    } catch {
      toast.error('Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  function handleDismiss() {
    if (!session) return
    if (session.source === 'oura' && session.ouraWorkoutId) {
      fetch('/api/oura/workouts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: session.ouraWorkoutId }),
      }).catch(() => {})
      invalidateOuraWorkoutReview().catch(() => {})
    }
    removeSession(session.id)
    onClose()
  }

  const routePoints = useMemo(
    () => session?.routePolyline ? decodeRoute(session.routePolyline) : [],
    [session?.routePolyline],
  )

  // Colors the map's route line by HR zone. These passively-detected sessions never have a
  // pace series, so this always uses the constant-pace fallback (start/end time + route only).
  const zoneSegments = useMemo(() => {
    if (!session || hrData.readings.length === 0 || !hrProfile) return null
    return buildRouteZoneSegments({
      points: routePoints,
      paceSeries: [],
      hrReadings: hrData.readings,
      zones: computeHrZones(hrProfile),
      startTime: new Date(session.startMs).toISOString(),
      endTime: new Date(session.endMs).toISOString(),
    })
  }, [routePoints, hrData.readings, hrProfile, session])

  return (
    <Sheet open={!!sessionId} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="h-[85vh] overflow-y-auto rounded-t-2xl px-6">
        {session && (
          <>
            <SheetHeader className="mb-4 pt-4">
              <SheetTitle>
                {session.activityType === 'run' ? 'Run' : 'Walk'} Detected
              </SheetTitle>
              <p className="text-sm text-muted-foreground">
                {/* Both halves of this line must agree on a timezone — the date used to render in
                    the DEVICE's zone next to a correctly-zoned formatTimeOfDay. */}
                {formatDayShort(toAestDay(new Date(session.startMs), userTz))}
                {' · '}
                {formatTimeOfDay(session.startMs, userTz)}
              </p>
            </SheetHeader>

            <div className="mb-4 flex gap-2">
              {(['walk', 'run'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setActivityType(t)}
                  className="flex-1 rounded-xl py-2 text-sm font-bold transition"
                  style={activityType === t
                    ? { background: 'var(--color-brand)', color: "var(--brand-foreground)" }
                    : { background: 'var(--color-muted)', opacity: 0.7 }}
                >
                  {t === 'walk' ? 'Walk' : 'Run'}
                </button>
              ))}
            </div>

            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                <p className="text-lg font-bold tabular-nums">{Math.round(session.durationMin)}</p>
                <p className="text-[10px] text-muted-foreground">min</p>
              </div>
              <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                <p className="text-lg font-bold tabular-nums">{session.distanceKm > 0 ? session.distanceKm.toFixed(2) : '—'}</p>
                <p className="text-[10px] text-muted-foreground">km</p>
              </div>
              {hrData.avgHr != null ? (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{hrData.avgHr}</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              ) : (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-3 opacity-40">
                  <p className="text-lg font-bold">—</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              )}
            </div>

            {hrData.readings.length > 1 && (
              <HrSparkline readings={hrData.readings} startMs={session.startMs} endMs={session.endMs} />
            )}

            {routePoints.length > 1 && (
              <ActivityRouteMap points={routePoints} zoneSegments={zoneSegments} className="mb-4 h-56 w-full" />
            )}
            {session.source === 'oura' && (
              <p className="mb-4 text-center text-xs text-muted-foreground">
                Route not available &mdash; phone wasn&apos;t tracking
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleDismiss}
                disabled={saving}
                className="flex-1 rounded-xl border py-3.5 text-sm font-bold transition disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 rounded-xl py-3.5 text-sm font-bold transition disabled:opacity-50"
                style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
              >
                {saving ? 'Saving…' : `Save as ${activityType === 'run' ? 'Run' : 'Walk'}`}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
