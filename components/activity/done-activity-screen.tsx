'use client'

import { HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Textarea } from '@/components/ui/textarea'
import { useActivityStore } from '@/lib/stores/activity-store'
import { useShallow } from 'zustand/react/shallow'
import { invalidateActivityWrites, invalidateRunningPlan } from '@/lib/cache-groups'
import { decodeRoute } from '@/lib/activity/route-encoding'
import { todayInTz, msToHHMMInTz } from '@trainingai/shared/date-utils'
import { getLocalStore } from '@/lib/local-store'
import { pushMutations } from '@/lib/local-store/sync-engine'
import { omitNullFields } from '@/lib/local-store/sync-helpers'
import { calculateSteps } from '@/lib/activity/treadmill-utils'
import { buildRouteZoneSegments } from '@/lib/activity/route-hr-zones'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import { cachedFetch } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

// Fire-and-forget: a failed link must never block the "Activity saved" toast the user is
// already seeing — the run just stays 'pending' and can still be marked via Skip/Complete.
async function linkPrescribedRun(userId: string | undefined, prescribedRunId: string, activityLogId: string) {
  const store = userId ? getLocalStore(userId) : null
  if (store) {
    const today = todayInTz()
    const runs = await store.getPrescribedRuns(today)
    const existing = runs.find((r) => r.id === prescribedRunId)
    if (existing) {
      await store.upsertPrescribedRun({ ...existing, status: 'completed', activityLogId, updatedAt: new Date().toISOString(), syncStatus: 'pending' })
    }
    await store.queueMutation({ userId: userId!, domain: 'prescribed_run', date: today, payload: { id: prescribedRunId, status: 'completed', activityLogId } })
    await invalidateRunningPlan()
    return
  }
  await fetch(`/api/running-plan/runs/${prescribedRunId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', activityLogId }),
  }).catch(() => {})
  await invalidateRunningPlan()
}

export function DoneActivityScreen({ userId }: { userId?: string }) {
  const router = useRouter()

  // Same as done-screen: every activity ends here and all three exits go to /workout-select, so
  // warm it while the summary is being read. Button pushes get no automatic prefetch (#919).
  useEffect(() => { router.prefetch('/workout-select') }, [router])
  const { activityType, title, activityLabel, startMs, endMs, draftSummary, resetSession, prescribedRunId } = useActivityStore(
    useShallow(s => ({
      activityType: s.activityType, title: s.title, activityLabel: s.activityLabel,
      startMs: s.startMs, endMs: s.endMs, draftSummary: s.draftSummary, resetSession: s.resetSession,
      prescribedRunId: s.prescribedRunId,
    }))
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [treadmillDistKm, setTreadmillDistKm] = useState('')
  const [treadmillMetrics, setTreadmillMetrics] = useState<{
    steps: number | null; avgHr: number | null; maxHr: number | null
  }>({ steps: null, avgHr: null, maxHr: null })
  const [heightCm, setHeightCm] = useState<number | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)
  const hrFetchedRef = useRef(false)
  const [hrReadings, setHrReadings] = useState<{ timestamp: string; bpm: number }[]>([])
  // avg/max over the activity's own HR window. The effect below already fetches this response for
  // the route colouring and used to throw these two fields away, so every GPS run and walk saved
  // null HR while the data sat in a response we had already paid for (Q-41 finding 2).
  const [windowHr, setWindowHr] = useState<{ avgHr: number | null; maxHr: number | null } | null>(null)
  const [hrProfile, setHrProfile] = useState<{ maxHr: number; restingHr: number } | null>(null)

  useEffect(() => {
    if (activityType !== 'treadmill') return
    cachedFetch<{ user?: { heightCm?: number | null } }>(
      'more-user-profile', '/api/user/profile', TTL_MEDIUM,
      data => setHeightCm(data.user?.heightCm ?? null),
    ).catch(() => {})
  }, [activityType])

  // HR time series + zone profile for the route map, and the window's avg/max for the saved row.
  // The treadmill distance handler above fetches its own avg/max on a different trigger (typing a
  // distance); when both exist the treadmill one wins, since it is what the user just saw.
  useEffect(() => {
    if (!startMs || !endMs) return
    const params = new URLSearchParams({
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
    })
    fetch(`/api/oura/hr-window?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { readings?: { timestamp: string; bpm: number }[]; avgHr?: number | null; maxHr?: number | null } | null) => {
        if (data?.readings) setHrReadings(data.readings)
        if (data) setWindowHr({ avgHr: data.avgHr ?? null, maxHr: data.maxHr ?? null })
      })
      .catch(() => {})
    cachedFetch<{ maxHr: number; restingHr: number }>(
      'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
      p => { if (p) setHrProfile(p) },
    ).catch(() => {})
  }, [startMs, endMs])

  const routePoints = useMemo(
    () => draftSummary?.routePolyline ? decodeRoute(draftSummary.routePolyline) : [],
    [draftSummary?.routePolyline],
  )

  // Colors the map's route line by HR zone instead of one flat color — same logic as the
  // activity detail sheet's historical view. startMs/endMs are already real timestamps here
  // (no bare "HH:MM" to combine with a date), so they're used directly.
  const zoneSegments = useMemo(() => {
    if (hrReadings.length === 0 || !hrProfile || !startMs) return null
    return buildRouteZoneSegments({
      points: routePoints,
      paceSeries: draftSummary?.paceSeries ?? [],
      hrReadings,
      zones: computeHrZones(hrProfile),
      startTime: new Date(startMs).toISOString(),
      endTime: endMs ? new Date(endMs).toISOString() : undefined,
    })
  }, [routePoints, draftSummary?.paceSeries, hrReadings, hrProfile, startMs, endMs])

  if (!draftSummary) return null

  async function handleTreadmillDistanceChange(raw: string) {
    setTreadmillDistKm(raw)
    const km = parseFloat(raw)
    if (isNaN(km) || km <= 0) {
      setTreadmillMetrics({ steps: null, avgHr: null, maxHr: null })
      return
    }

    const steps = heightCm ? calculateSteps(km, heightCm) : null

    let avgHr: number | null = null
    let maxHr: number | null = null
    if (!hrFetchedRef.current && startMs && endMs) {
      setLoadingMetrics(true)
      try {
        const res = await fetch(
          `/api/oura/hr-window?start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${encodeURIComponent(new Date(endMs).toISOString())}`
        )
        if (res.ok) {
          const data = await res.json()
          avgHr = data.avgHr
          maxHr = data.maxHr
          hrFetchedRef.current = true
        }
      } catch {}
      setLoadingMetrics(false)
    } else {
      avgHr = treadmillMetrics.avgHr
      maxHr = treadmillMetrics.maxHr
    }

    setTreadmillMetrics({ steps, avgHr, maxHr })
  }

  async function handleSave() {
    // Defence in depth, and it must speak. This used to be a bare `return`: with no activity type
    // the whole save — local write, outbox, web fallback — was skipped and the user got no toast,
    // no error and no navigation, so a completed activity vanished with the screen still looking
    // normal (Q-450). The entry guard in `activity-screen.tsx` now makes a typeless recording
    // unreachable, but a session already in flight when that JS lands still arrives here, and
    // "silently discard the thing they just did" is never the right answer for it.
    if (!activityType || !startMs || !endMs || !draftSummary) {
      toast.error("This activity can't be saved — it has no activity type. Start it again from Log Activity.")
      return
    }
    setSaving(true)
    const store = userId ? getLocalStore(userId) : null
    const today = todayInTz()
    const treadmillDistKmParsed = activityType === 'treadmill' && treadmillDistKm
      ? (parseFloat(treadmillDistKm) || undefined)
      : undefined
    const saveDistanceKm = treadmillDistKmParsed ?? draftSummary.distanceKm ?? undefined
    // Treadmill keeps its distance/stride estimate; every other foot-based activity now falls back
    // to the strap-cadence integration, which is the only step source a GPS walk/run ever had
    // (Q-230). Calories are derived server-side in saveActivityLog.
    const saveSteps = activityType === 'treadmill'
      ? treadmillMetrics.steps ?? draftSummary.cadenceStepsEstimate ?? undefined
      : draftSummary.cadenceStepsEstimate ?? undefined
    // Every activity type gets HR, not just treadmill. Read synchronously from state — the fetch
    // already happened on mount, so the save stays instant (no await before the local write).
    const saveAvgHr = treadmillMetrics.avgHr ?? windowHr?.avgHr ?? undefined
    const saveMaxHr = treadmillMetrics.maxHr ?? windowHr?.maxHr ?? undefined
    let savedLocally = false
    if (store) {
      try {
        const now = new Date().toISOString()
        const logId = crypto.randomUUID()
        const actTitle = title.trim() || activityLabel
        const noteText = notes.trim() || null
        await store.upsertActivityLog({
          id: logId, date: today, activityType, title: actTitle,
          durationMin: draftSummary.durationMin,
          distanceKm: saveDistanceKm ?? null,
          steps: saveSteps ?? null,
          avgHr: saveAvgHr ?? null,
          maxHr: saveMaxHr ?? null,
          caloriesBurned: null,
          startTime: msToHHMMInTz(startMs),
          endTime: msToHHMMInTz(endMs),
          notes: noteText,
          routePolyline: draftSummary.routePolyline ?? null,
          splits: draftSummary.splits ?? null,
          bestEfforts: draftSummary.bestEfforts ?? null,
          paceSeries: draftSummary.paceSeries ?? null,
          avgPaceSecPerKm: draftSummary.avgPaceSecPerKm ?? null,
          elevationGainM: draftSummary.elevationGainM ?? null,
          elevationLossM: draftSummary.elevationLossM ?? null,
          elevationProfile: draftSummary.elevationProfile ?? null,
          cadenceSpm: draftSummary.cadenceSpm ?? null,
          cadenceSeries: draftSummary.cadenceSeries ?? null,
          cadenceSource: draftSummary.cadenceSource ?? null,
          segments: null, // guided-walk-only field; regular activities have no fast/slow phases
          updatedAt: now,
          deletedAt: null,
          syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'activity_logs',
          date: today,
          // The server's Zod schema declares these fields .optional() (T | undefined),
          // not nullable — omitNullFields strips a missing value's null placeholder so
          // the payload matches the wire contract instead of failing validation outright.
          payload: omitNullFields({
            id: logId, activityType, title: actTitle,
            durationMin: draftSummary.durationMin,
            distanceKm: saveDistanceKm ?? null,
            steps: saveSteps ?? null,
            caloriesBurned: null,
            avgHr: saveAvgHr ?? null,
            maxHr: saveMaxHr ?? null,
            startTime: msToHHMMInTz(startMs),
            endTime: msToHHMMInTz(endMs),
            notes: noteText,
            routePolyline: draftSummary.routePolyline ?? null,
            splits: draftSummary.splits ?? null,
            bestEfforts: draftSummary.bestEfforts ?? null,
            paceSeries: draftSummary.paceSeries ?? null,
            avgPaceSecPerKm: draftSummary.avgPaceSecPerKm ?? null,
            elevationGainM: draftSummary.elevationGainM ?? null,
            elevationLossM: draftSummary.elevationLossM ?? null,
            elevationProfile: draftSummary.elevationProfile ?? null,
            cadenceSpm: draftSummary.cadenceSpm ?? null,
            cadenceSeries: draftSummary.cadenceSeries ?? null,
            cadenceSource: draftSummary.cadenceSource ?? null,
          }),
        })
        invalidateActivityWrites().catch(() => {})
        toast.success('Activity saved')
        resetSession()
        router.push('/workout-select')
        pushMutations(userId!).catch(() => {})
        savedLocally = true
        if (activityType === 'run' && prescribedRunId) {
          linkPrescribedRun(userId, prescribedRunId, logId).catch(() => {})
        }
      } catch (sqliteErr) {
        console.error('Activity log SQLite write failed, falling back to API:', sqliteErr)
      }
    }
    if (savedLocally) return
    // Web fallback
    try {
      const res = await fetch('/api/activity-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: today,
          activityType,
          title: title.trim() || activityLabel,
          startTime: msToHHMMInTz(startMs),
          endTime: msToHHMMInTz(endMs),
          durationMin: draftSummary.durationMin,
          distanceKm: saveDistanceKm,
          avgHr: saveAvgHr,
          maxHr: saveMaxHr,
          steps: saveSteps,
          routePolyline: draftSummary.routePolyline,
          splits: draftSummary.splits,
          bestEfforts: draftSummary.bestEfforts,
          paceSeries: draftSummary.paceSeries,
          avgPaceSecPerKm: draftSummary.avgPaceSecPerKm,
          elevationGainM: draftSummary.elevationGainM,
          elevationLossM: draftSummary.elevationLossM,
          elevationProfile: draftSummary.elevationProfile,
          notes: notes.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error()
      const { activityLog } = await res.json()
      if (activityType === 'run' && prescribedRunId) {
        linkPrescribedRun(userId, prescribedRunId, activityLog.id).catch(() => {})
      }
      await invalidateActivityWrites()
      toast.success('Activity saved')
      resetSession()
      router.push('/workout-select')
    } catch {
      toast.error('Failed to save activity')
    } finally {
      setSaving(false)
    }
  }

  function handleDiscard() {
    resetSession()
    router.push('/workout-select')
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pb-safe-action-lg pt-safe">
      <h1 className="mb-4 text-xl font-bold">{title || activityLabel}</h1>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
          <p className="text-lg font-bold tabular-nums">{draftSummary.durationMin.toFixed(1)}</p>
          <p className="text-[10px] text-muted-foreground">min</p>
        </div>
        {draftSummary.distanceKm != null && (
          <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.distanceKm.toFixed(2)}</p>
            <p className="text-[10px] text-muted-foreground">km</p>
          </div>
        )}
        {draftSummary.avgPaceSecPerKm != null && (
          <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
            <p className="text-lg font-bold tabular-nums">
              {Math.floor(draftSummary.avgPaceSecPerKm / 60)}:{String(Math.round(draftSummary.avgPaceSecPerKm % 60)).padStart(2, '0')}
            </p>
            <p className="text-[10px] text-muted-foreground">avg /km</p>
          </div>
        )}
      </div>

      {activityType === 'treadmill' && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Distance covered
          </p>
          <div className="flex items-center gap-2 rounded-xl border bg-muted/60 px-4 py-3">
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="100"
              value={treadmillDistKm}
              onChange={e => handleTreadmillDistanceChange(e.target.value)}
              placeholder="0.0"
              className="flex-1 bg-transparent text-lg tabular-nums focus:outline-none"
            />
            <span className="text-sm text-muted-foreground">km</span>
          </div>

          {!heightCm && treadmillDistKm && (
            <p className="mt-1 text-xs text-amber-400">
              Add your height in Profile to get step count.
            </p>
          )}

          {(treadmillMetrics.steps != null || treadmillMetrics.avgHr != null) && (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              {treadmillMetrics.steps != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.steps.toLocaleString()}</p>
                  <p className="text-[10px] text-muted-foreground">steps</p>
                </div>
              )}
              {treadmillMetrics.avgHr != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.avgHr}</p>
                  <p className="text-[10px] text-muted-foreground">avg bpm</p>
                </div>
              )}
              {treadmillMetrics.maxHr != null && (
                <div className="rounded-xl bg-muted/60 border border-border px-2 py-2">
                  <p className="text-base font-bold tabular-nums">{treadmillMetrics.maxHr}</p>
                  <p className="text-[10px] text-muted-foreground">max bpm</p>
                </div>
              )}
            </div>
          )}
          {loadingMetrics && (
            <p className="mt-1 text-xs text-muted-foreground">Fetching heart rate…</p>
          )}
        </div>
      )}

      {(draftSummary.elevationGainM != null || draftSummary.elevationLossM != null) && (
        <div className="mb-4 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.elevationGainM ?? 0} m</p>
            <p className="text-[10px] text-muted-foreground">elevation gain</p>
          </div>
          <div className="rounded-xl bg-muted/60 border border-border px-2 py-3">
            <p className="text-lg font-bold tabular-nums">{draftSummary.elevationLossM ?? 0} m</p>
            <p className="text-[10px] text-muted-foreground">elevation loss</p>
          </div>
        </div>
      )}

      {routePoints.length > 1 && (
        <ActivityRouteMap points={routePoints} zoneSegments={zoneSegments} className="mb-4 h-56 w-full" />
      )}

      {draftSummary.splits && draftSummary.splits.length > 0 && (
        <div className="mb-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Splits</p>
          {draftSummary.splits.map(s => (
            <div key={s.km} className="flex justify-between rounded-lg bg-muted/60 border border-border px-3 py-1.5 text-sm">
              <span>Km {s.km}</span>
              <span className="tabular-nums">{Math.floor(s.paceSec / 60)}:{String(Math.round(s.paceSec % 60)).padStart(2, '0')} /km</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-1.5">
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" rows={2} />
      </div>

      <div className="mt-auto flex gap-3 pt-2">
        <button
          type="button"
          onClick={handleDiscard}
          disabled={saving}
          className="flex-1 rounded-xl border py-3.5 text-sm font-bold transition active:scale-95 disabled:opacity-50"
        >
          Discard
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 rounded-xl py-3.5 text-sm font-bold transition active:scale-95 disabled:opacity-50"
          style={{ background: 'var(--color-brand)', color: "var(--brand-foreground)" }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
