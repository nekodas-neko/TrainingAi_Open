'use client'
import { HR_PROFILE_TTL } from '@trainingai/shared/cache-ttl'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { cachedFetch } from '@/lib/sqlite/cache'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { StatTile } from '@/components/ui/stat-tile'
import { pullDelta } from '@/lib/local-store/sync-engine'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { omitNullFields } from '@/lib/local-store/sync-helpers'
import { invalidateActivityWrites } from '@/lib/cache-groups'
import { todayInTz, msToHHMMInTz } from '@trainingai/shared/date-utils'
import { buildIntervalPlan, type WalkConfig } from '@/lib/walk/interval-plan'
import { ZoneBreakdown } from '@/components/health/zone-breakdown'
import { useGuidedWalkStore } from '@/lib/stores/guided-walk-store'
import {
  computeTotalDistanceKm, computeSplits, computeBestEfforts, computePaceSeries,
  computeElevationChange, computeElevationProfile, computeAvgPaceSecPerKm,
} from '@/lib/activity/activity-metrics'
import { simplifyRoute, encodeRoute } from '@/lib/activity/route-encoding'
import { computeWalkSegmentStats, aggregateSegmentsByKind, walkEffortDisplay, type KindAggregate } from '@/lib/walk/segment-stats'
import { buildRouteZoneSegments } from '@/lib/activity/route-hr-zones'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import type { PhaseBand } from '@/components/activity/activity-hr-chart'
import type { WalkHrSample } from './walk-active'
import { cadenceFieldsForSave, type CadenceSummary } from '@trainingai/shared/health/cadence'

const ActivityHrChart = dynamic(
  () => import('@/components/activity/activity-hr-chart').then(m => m.ActivityHrChart),
  { ssr: false },
)
const ActivityRouteMap = dynamic(
  () => import('@/components/activity/activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)

const ROUTE_SIMPLIFY_TOLERANCE_M = 5

function avg(nums: number[]) { return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null }
export function WalkSummary({ config, samples, cadence, startedAtMs, userId, onDone }: {
  config: WalkConfig; samples: WalkHrSample[]; cadence?: CadenceSummary | null
  startedAtMs: number; userId?: string; onDone: () => void
}) {
  const tz = useUserTimezone();
  const router = useTransitionRouter()
  // Done is the only way off this screen, and it always goes to /activity — warm it while
  // the user reads their summary. Button pushes get no automatic prefetch (#919).
  useEffect(() => { router.prefetch('/activity') }, [router])
  const rawPoints = useGuidedWalkStore(s => s.rawPoints)
  const plan = buildIntervalPlan(config)
  const durationMin = Math.round(plan.totalSec / 60)
  const bpms = samples.map(s => s.bpm)
  const avgHr = avg(bpms)
  const maxHr = bpms.length ? Math.max(...bpms) : null
  const savedRef = useRef(false)
  const [saved, setSaved] = useState(false)
  /**
   * The server-derived calories (BF-107), which do not exist when this screen first paints.
   *
   * `saveActivityLog` computes them — the MET table behind `estWorkoutKcal` is read through
   * `node:path`, so it cannot run in a client bundle — and the two write paths deliver the result
   * differently: the web POST returns the saved row, while the device queues through the outbox and
   * only sees the number on a pull. Both are handled below; until one lands the tile shows a dash.
   */
  const [kcal, setKcal] = useState<number | null>(null)
  const [hrProfile, setHrProfile] = useState<{ maxHr: number; restingHr: number } | null>(null)

  // Per-segment HR/pace/distance/cadence — the same computation used for both the live
  // "Per interval" display below and the data actually persisted on save, so a fast/slow
  // block has real numbers to compare and average across walks later (not just an
  // ephemeral display that used to be thrown away on save).
  const segmentStats = useMemo(
    () => computeWalkSegmentStats({
      plan, startedAtMs, hrSamples: samples, rawPoints, cadenceSeries: cadence?.series ?? null,
    }),
    [plan, startedAtMs, samples, rawPoints, cadence],
  )

  // Time-in-zone + Session Load — same shared primitive the regular activity detail view uses
  // (ZoneBreakdown / zoneBreakdownFromReadings), computed from the samples already collected
  // live during the walk rather than a re-fetch.
  const zoneReadings = useMemo(
    () => samples.map(s => ({ timestamp: new Date(s.at).toISOString(), bpm: s.bpm })),
    [samples],
  )

  const phaseBands: PhaseBand[] = plan.segments
    .filter(seg => seg.kind === 'fast' || seg.kind === 'slow')
    .map(seg => ({ fromMin: seg.startSec / 60, toMin: seg.endSec / 60, kind: seg.kind as 'fast' | 'slow' }))

  // "Your average slow/fast walk" roll-up from the per-segment stats above.
  const kindAgg = useMemo(() => aggregateSegmentsByKind(segmentStats), [segmentStats])

  // Colors the route map by HR zone instead of one flat line — same helper the regular
  // activity detail sheet uses. Unlike a regular activity (which only has a bare "HH:MM"
  // start time to reconstruct from), a guided walk already has the real epoch-ms start,
  // so paceSeries/hrReadings correlate to it directly with no date/tz reconstruction.
  const paceSeries = useMemo(
    () => (rawPoints.length >= 2 ? computePaceSeries(rawPoints) : []),
    [rawPoints],
  )
  const zoneSegments = useMemo(() => {
    if (rawPoints.length < 2 || paceSeries.length === 0 || zoneReadings.length === 0 || !hrProfile) return null
    return buildRouteZoneSegments({
      points: rawPoints,
      paceSeries,
      hrReadings: zoneReadings,
      zones: computeHrZones(hrProfile),
      startTime: new Date(startedAtMs).toISOString(),
    })
  }, [rawPoints, paceSeries, zoneReadings, hrProfile, startedAtMs])

  useEffect(() => {
    cachedFetch<{ maxHr: number; restingHr: number }>(
      'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
      p => { if (p) setHrProfile({ maxHr: p.maxHr, restingHr: p.restingHr }) },
    ).catch(() => {})
  }, [])

  useEffect(() => {
    if (savedRef.current) return
    savedRef.current = true
    void saveWalk()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveWalk() {
    const date = todayInTz(tz)
    const startTime = msToHHMMInTz(startedAtMs)
    const endTime = msToHHMMInTz(startedAtMs + plan.totalSec * 1000)

    // Treadmill walks save as the `treadmill` activity type (is_distance_based=false), so the
    // cardio aggregates that filter on a non-null distance/pace exclude them automatically —
    // no downstream change needed. `=== true` because a config persisted before this field
    // existed rehydrates without it, and undefined must mean "outdoors".
    const isTreadmill = useGuidedWalkStore.getState().config.treadmill === true
    const activityType = isTreadmill ? 'treadmill' : 'walk'
    const title = isTreadmill ? 'Treadmill interval walk' : 'Interval walk'

    // GPS-derived fields, mirroring activity-store.ts's finish() computation exactly.
    // On a treadmill the watcher never started, so rawPoints is empty and every field below
    // falls to null through the existing hasRoute guard rather than a second code path.
    const rawPoints = useGuidedWalkStore.getState().rawPoints
    const hasRoute = !isTreadmill && rawPoints.length >= 2
    const distanceKm = hasRoute ? computeTotalDistanceKm(rawPoints) : null
    const routePolyline = hasRoute ? encodeRoute(simplifyRoute(rawPoints, ROUTE_SIMPLIFY_TOLERANCE_M)) : null
    const splits = hasRoute ? computeSplits(rawPoints) : null
    const bestEfforts = hasRoute ? computeBestEfforts(rawPoints) : null
    const paceSeries = hasRoute ? computePaceSeries(rawPoints) : null
    const avgPaceSecPerKm = hasRoute ? computeAvgPaceSecPerKm(distanceKm!, plan.totalSec) ?? null : null
    const elevation = hasRoute ? computeElevationChange(rawPoints) : null
    const elevationGainM = elevation?.gainM ?? null
    const elevationLossM = elevation?.lossM ?? null
    const elevationProfile = hasRoute ? computeElevationProfile(rawPoints) : null
    const cadenceFields = cadenceFieldsForSave(cadence)
    // Steps were hardcoded null here (Q-230); they integrate the strap cadence series this same walk
    // already persists. Calories are derived server-side in saveActivityLog — the MET table behind
    // estWorkoutKcal is read through node:path, so it cannot be imported into a client bundle.
    const stepsEstimate = cadence?.stepsEstimate ?? null

    // Mirrors done-activity-screen's contract exactly (One write path per domain).
    try {
      const store = userId ? getLocalStore(userId) : null
      // The local branch owns its own failure (Q-216). #1292 made `runSQL` throw when the DB is not
      // open, and without this catch that throw reached the outer handler below — which toasts an
      // error, sets `saved`, and never tries the API. Its comment said the outbox would retry, but
      // the outbox write is precisely what failed, so there was nothing queued: the walk was gone
      // and the screen said otherwise. `test-result.tsx` is the shape being copied.
      let savedLocally = false
      if (store) {
        try {
        const now = new Date().toISOString()
        const logId = crypto.randomUUID()
        await store.upsertActivityLog({
          id: logId, date, activityType, title,
          durationMin, distanceKm, steps: stepsEstimate,
          avgHr: avgHr ?? null, maxHr: maxHr ?? null,
          caloriesBurned: null, startTime, endTime, notes: null,
          routePolyline, splits, bestEfforts, paceSeries,
          avgPaceSecPerKm, elevationGainM, elevationLossM, elevationProfile,
          segments: segmentStats,
          ...cadenceFields,
          updatedAt: now, deletedAt: null, syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!, domain: 'activity_logs', date,
          // The server's Zod schema declares these fields .optional() (T | undefined),
          // not nullable — omitNullFields strips the null placeholders below so the
          // payload matches the wire contract instead of failing validation outright.
          payload: omitNullFields({
            id: logId, activityType, title,
            durationMin, distanceKm, steps: stepsEstimate,
            avgHr: avgHr ?? null, maxHr: maxHr ?? null,
            startTime, endTime, notes: null,
            routePolyline, splits, bestEfforts, paceSeries,
            avgPaceSecPerKm, elevationGainM, elevationLossM, elevationProfile,
            segments: segmentStats,
            ...cadenceFields,
          }),
        })
        invalidateActivityWrites().catch(() => {})
        setSaved(true)
        // BF-107. The push only flips the row to `synced`; the derived calories arrive on a PULL, so
        // one is forced here and the row read back. It stays inside `pushThenRevalidate`'s callback
        // rather than replacing it, because that callback runs only when something was actually
        // pushed — and because revalidating around a local write instead of after it is its own bug.
        pushThenRevalidate(userId!, async () => {
          await invalidateActivityWrites()
          await pullDelta(userId!, true)
          const rows = await store.getActivityLogs(date)
          const mine = rows.find(r => r.id === logId)
          if (mine?.caloriesBurned != null) setKcal(mine.caloriesBurned)
        })
        savedLocally = true
        } catch (e) {
          console.error('Walk SQLite write failed, falling back to API:', e)
        }
      }
      if (savedLocally) return
      // Web fallback — also the on-device recovery path when the local write above threw.
      const res = await fetch('/api/activity-logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date, activityType, title,
          startTime, endTime, durationMin,
          steps: stepsEstimate ?? undefined,
          avgHr: avgHr ?? undefined, maxHr: maxHr ?? undefined,
          distanceKm: distanceKm ?? undefined,
          routePolyline: routePolyline ?? undefined,
          splits: splits ?? undefined,
          bestEfforts: bestEfforts ?? undefined,
          paceSeries: paceSeries ?? undefined,
          avgPaceSecPerKm: avgPaceSecPerKm ?? undefined,
          elevationGainM: elevationGainM ?? undefined,
          elevationLossM: elevationLossM ?? undefined,
          elevationProfile: elevationProfile ?? undefined,
          segments: segmentStats,
        }),
      })
      if (!res.ok) throw new Error()
      // BF-107. `POST /api/activity-logs` answers `{ activityLog }` with the derived calories on it,
      // and this response was being thrown away.
      const body = await res.json().catch(() => null) as { activityLog?: { caloriesBurned?: number | null } } | null
      if (body?.activityLog?.caloriesBurned != null) setKcal(body.activityLog.caloriesBurned)
      await invalidateActivityWrites()
      setSaved(true)
    } catch {
      // Reaching here now means BOTH paths failed — the local write threw (or there is no store)
      // and the server write failed too. So there is nothing queued for the outbox to retry, and
      // claiming otherwise by setting `saved` told the lifter their walk was safe when it was gone
      // (Q-216). Leave it unsaved so the button stays live and the walk can be saved again.
      toast.error('Failed to save walk — try again')
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 pt-safe pb-safe-action-lg">
      <h2 className="text-2xl font-bold">Walk complete</h2>
      <div className="grid grid-cols-4 gap-2 text-center">
        <StatTile label="Duration" value={`${durationMin}m`} />
        <StatTile label="Avg HR" value={avgHr != null ? `${avgHr}` : '—'} />
        <StatTile label="Max HR" value={maxHr != null ? `${maxHr}` : '—'} />
        {/* BF-107. A dash until the derived figure lands, never a zero — a zero is a claim about a
            walk that burned nothing, and the number genuinely is not known at first paint. */}
        <StatTile label="kcal" value={kcal != null ? `${Math.round(kcal)}` : '—'} />
      </div>

      {rawPoints.length > 1 && (
        <ActivityRouteMap points={rawPoints} zoneSegments={zoneSegments} className="h-48 w-full" />
      )}

      {(kindAgg.fast.count > 0 || kindAgg.slow.count > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <KindAggCard label="Fast avg" color="var(--color-brand)" agg={kindAgg.fast} />
          <KindAggCard label="Slow avg" agg={kindAgg.slow} />
        </div>
      )}

      {zoneReadings.length >= 2 && (
        <div className="rounded-2xl bg-muted/40 border border-border p-4">
          <ActivityHrChart readings={zoneReadings} avgHr={avgHr} maxHr={maxHr} phaseBands={phaseBands} />
        </div>
      )}

      <div className="rounded-2xl bg-muted/40 border border-border p-4 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Per interval</p>
        {segmentStats.filter(s => s.kind === 'fast' || s.kind === 'slow').map(s => (
          <div key={s.index} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Set {s.setNumber} · {s.kind === 'fast' ? 'Fast' : 'Slow'}
            </span>
            <span className="tabular-nums" style={{ color: s.kind === 'fast' ? 'var(--color-brand)' : undefined }}>
              {(() => {
                const { lead, secondary } = walkEffortDisplay(s)
                return [lead, secondary, s.avgHr != null ? `${s.avgHr} bpm` : null]
                  .filter(Boolean).join(' · ')
              })()}
            </span>
          </div>
        ))}
      </div>

      {hrProfile && zoneReadings.length >= 2 && (
        <div className="rounded-2xl bg-muted/40 border border-border p-4">
          <ZoneBreakdown readings={zoneReadings} profile={hrProfile} />
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        {saved ? 'Saved to your activity history.' : 'Saving…'}
      </p>
      <Button className="h-12" onClick={() => { onDone(); router.push('/activity') }}>Done</Button>
    </div>
  )
}

function KindAggCard({ label, color, agg }: { label: string; color?: string; agg: KindAggregate }) {
  const { lead, secondary } = walkEffortDisplay(agg)
  return (
    <div className="rounded-2xl bg-muted/60 border border-border p-3 space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: color ?? 'var(--muted-foreground)' }}>
        {label} <span className="normal-case font-normal text-muted-foreground">({agg.count} set{agg.count === 1 ? '' : 's'})</span>
      </p>
      <p className="text-base font-bold tabular-nums">{lead}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        {[
          // Whichever of the two did not take the headline stays on this row, so nothing is lost.
          ...(secondary != null ? [secondary] : []),
          agg.avgHr != null ? `${agg.avgHr} bpm` : '— bpm',
          agg.totalDistanceKm != null ? `${agg.totalDistanceKm.toFixed(2)} km` : '—',
        ].map(t => <span key={t}>{t}</span>)}
      </div>
    </div>
  )
}
