'use client'

import { HR_PROFILE_TTL, HR_WINDOW_TTL } from '@trainingai/shared/cache-ttl'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getActivityIcon } from '@trainingai/shared/constants/activity-icons'
import { decodeRoute } from '@/lib/activity/route-encoding'
import { formatTime12h } from '@trainingai/shared/date-utils'
import { ZoneBreakdown } from '@/components/health/zone-breakdown'
import { Sparkline } from '@/components/ui/sparkline'
import { estimateDistanceKmAtTime, pointAtDistanceKm } from '@/lib/activity/scrub'
import { buildRouteZoneSegments } from '@/lib/activity/route-hr-zones'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import type { ActivityLog } from '@trainingai/shared/types'

const ActivityRouteMap = dynamic(
  () => import('./activity-route-map').then(m => m.ActivityRouteMap),
  { ssr: false },
)
const ActivityHrChart = dynamic(
  () => import('./activity-hr-chart').then(m => m.ActivityHrChart),
  { ssr: false },
)
const HeroActivityChart = dynamic(
  () => import('./hero-activity-chart').then(m => m.HeroActivityChart),
  { ssr: false },
)
// These three pull chart.js, and were the only static chart imports left in a file that already
// loaded its other three charts dynamically. Measured against a production build the split does
// not change what the Health tab downloads — webpack was already isolating them — so this is
// internal consistency, not a bundle win. See Q-127's closing note in the journal.
const PaceBarChart = dynamic(
  () => import('./pace-bar-chart').then(m => m.PaceBarChart),
  { ssr: false },
)
const ElevationProfileChart = dynamic(
  () => import('./elevation-profile-chart').then(m => m.ElevationProfileChart),
  { ssr: false },
)
const ZoneDonutChart = dynamic(
  () => import('./zone-donut-chart').then(m => m.ZoneDonutChart),
  { ssr: false },
)

function formatPace(secPerKm: number): string {
  return `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')} /km`
}

interface HrData {
  avgHr: number | null
  maxHr: number | null
  readings: { timestamp: string; bpm: number }[]
}

interface ActivityDetailSheetProps {
  log: ActivityLog | null
  icon: string
  onOpenChange: (open: boolean) => void
}

export function ActivityDetailSheet({ log, icon, onOpenChange }: ActivityDetailSheetProps) {
  const Icon = getActivityIcon(icon)
  const routePoints = useMemo(
    () => log?.routePolyline ? decodeRoute(log.routePolyline) : [],
    [log?.routePolyline],
  )
  const [hrData, setHrData] = useState<HrData | null>(null)
  const [hrProfile, setHrProfile] = useState<{ maxHr: number; restingHr: number } | null>(null)
  const [scrubPoint, setScrubPoint] = useState<{ lat: number; lng: number } | null>(null)

  const handleScrub = (tSec: number | null) => {
    if (tSec == null || !log?.paceSeries || log.paceSeries.length === 0) {
      setScrubPoint(null)
      return
    }
    const distanceKm = estimateDistanceKmAtTime(log.paceSeries, tSec)
    setScrubPoint(pointAtDistanceKm(routePoints, distanceKm))
  }

  useEffect(() => {
    if (!log?.startTime || !log.endTime) { setHrData(null); return }
    const params = new URLSearchParams({
      date: log.date,
      startTime: log.startTime,
      endTime: log.endTime,
    })
    const key = `hr-window:${params}`
    // A logged activity's window is fixed, so re-opening the sheet should show the HR chart it
    // showed last time rather than nulling it and re-fetching. Keyed by the window, so editing
    // an activity's times misses the seed instead of painting the old trace.
    setHrData(readCacheSync<HrData>(key))
    cachedFetch<HrData>(
      key, `/api/oura/hr-window?${params}`, HR_WINDOW_TTL,
      data => { if (data) setHrData(data) },
    ).catch(() => {})
  }, [log?.id])

  // Zone profile for the time-in-zone breakdown (same source as /api/hr-profile).
  useEffect(() => {
    cachedFetch<{ maxHr: number; restingHr: number }>(
      'hr-profile', '/api/hr-profile', HR_PROFILE_TTL,
      p => { if (p) setHrProfile({ maxHr: p.maxHr, restingHr: p.restingHr }) },
    ).catch(() => {})
  }, [])

  // Colors the map's route line by HR zone instead of one flat color, so you can see where you
  // were pushing harder. Falls back to null (flat line) whenever there isn't enough data to
  // correlate distance along the route to a wall-clock HR reading.
  const zoneSegments = useMemo(() => {
    if (!hrData || hrData.readings.length === 0 || !hrProfile || !log?.startTime) return null
    // log.startTime/endTime carry no date or tz — and they are "HH:MM:SS", not "HH:MM", because
    // they come straight off a Postgres `time` column. A string like "2026-07-24T08:12:00"
    // handed to `new Date(...)` is ambiguous across JS engines (local time per spec, but not
    // reliably so in every WebView) — a wrong interpretation silently shifts every query hours
    // away from hrData.readings' real absolute timestamps, collapsing the whole route to one
    // zone. The multi-argument Date constructor is unambiguously local time in every engine
    // (same pattern the server's date+HH:MM→UTC conversion in /api/oura/hr-window uses), and
    // .toISOString() turns that into an absolute, unambiguous string for buildRouteZoneSegments.
    const [y, mo, d] = log.date.split('-').map(Number)
    const [sh, sm] = log.startTime.split(':').map(Number)
    const startDateTime = new Date(y, mo - 1, d, sh, sm, 0).toISOString()
    let endDateTime: string | undefined
    if (log.endTime) {
      const [eh, em] = log.endTime.split(':').map(Number)
      endDateTime = new Date(y, mo - 1, d, eh, em, 0).toISOString()
    }
    return buildRouteZoneSegments({
      points: routePoints,
      paceSeries: log.paceSeries ?? [],
      hrReadings: hrData.readings,
      zones: computeHrZones(hrProfile),
      startTime: startDateTime,
      endTime: endDateTime,
    })
  }, [routePoints, log?.paceSeries, hrData, hrProfile, log?.date, log?.startTime, log?.endTime])

  return (
    <Sheet open={log !== null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto px-5 pt-5">
        <SheetHeader className="mb-2">
          <SheetTitle className="flex items-center gap-2 text-left">
            <Icon size={20} weight="fill" style={{ color: 'var(--color-brand)' }} />
            {log?.title}
          </SheetTitle>
        </SheetHeader>

        {log && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {log.date}
              {log.startTime ? ` · ${formatTime12h(log.startTime)}` : ''}
              {log.endTime ? ` – ${formatTime12h(log.endTime)}` : ''}
            </p>

            <div className="grid grid-cols-3 gap-2 text-center">
              {log.durationMin != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{Math.round(log.durationMin)}</p>
                  <p className="text-[10px] text-muted-foreground">min</p>
                </div>
              )}
              {log.distanceKm != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{Number(log.distanceKm).toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">km</p>
                </div>
              )}
              {log.avgPaceSecPerKm != null && (
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{formatPace(log.avgPaceSecPerKm)}</p>
                  <p className="text-[10px] text-muted-foreground">avg pace</p>
                </div>
              )}
            </div>

            {(log.steps != null || log.avgHr != null || log.maxHr != null || log.caloriesBurned != null) && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {log.steps != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{log.steps.toLocaleString()}</p>
                    {/* Both of these are derived, not measured (Q-230): steps integrate the strap
                        cadence series, kcal is a MET/Schofield estimate from duration. Saying so is
                        the difference between a number the lifter can trust and one they cannot
                        place — and the app already distinguishes derived from measured elsewhere. */}
                    <p className="text-[10px] text-muted-foreground">steps (est.)</p>
                  </div>
                )}
                {log.avgHr != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{log.avgHr}</p>
                    <p className="text-[10px] text-muted-foreground">avg HR</p>
                  </div>
                )}
                {log.maxHr != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{log.maxHr}</p>
                    <p className="text-[10px] text-muted-foreground">max HR</p>
                  </div>
                )}
                {log.caloriesBurned != null && (
                  <div className="rounded-xl bg-muted px-2 py-3">
                    <p className="text-lg font-bold tabular-nums">{Math.round(log.caloriesBurned)}</p>
                    <p className="text-[10px] text-muted-foreground">kcal (est.)</p>
                  </div>
                )}
              </div>
            )}

            {log.cadenceSpm != null && (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cadence
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {Math.round(log.cadenceSpm)} spm avg
                    {/* Provenance in text, not colour: ring and strap sample at very different
                        rates, so which one measured this changes how precise it is. */}
                    {log.cadenceSource && ` · ${log.cadenceSource}`}
                  </p>
                </div>
                {log.cadenceSeries && log.cadenceSeries.length > 1 && (
                  <div className="rounded-xl bg-muted px-3 py-3">
                    <Sparkline
                      values={log.cadenceSeries.map(p => p.spm)}
                      responsive
                      height={48}
                      color="var(--color-brand)"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                      <span>{Math.round(Math.min(...log.cadenceSeries.map(p => p.spm)))} spm</span>
                      <span>{Math.round(Math.max(...log.cadenceSeries.map(p => p.spm)))} spm</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {(log.elevationGainM != null || log.elevationLossM != null) && (
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.elevationGainM ?? 0} m</p>
                  <p className="text-[10px] text-muted-foreground">elevation gain</p>
                </div>
                <div className="rounded-xl bg-muted px-2 py-3">
                  <p className="text-lg font-bold tabular-nums">{log.elevationLossM ?? 0} m</p>
                  <p className="text-[10px] text-muted-foreground">elevation loss</p>
                </div>
              </div>
            )}

            {hrData && hrData.readings.length > 1 && log.paceSeries && log.paceSeries.length > 0 ? (
              <HeroActivityChart
                hrReadings={hrData.readings}
                paceSeries={log.paceSeries}
                avgHr={hrData.avgHr}
                maxHr={hrData.maxHr}
                onScrub={handleScrub}
              />
            ) : hrData && hrData.readings.length > 0 ? (
              <ActivityHrChart
                readings={hrData.readings}
                avgHr={hrData.avgHr}
                maxHr={hrData.maxHr}
              />
            ) : null}

            {hrData && hrData.readings.length > 1 && (
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <ZoneBreakdown readings={hrData.readings} profile={hrProfile} />
                </div>
                <ZoneDonutChart readings={hrData.readings} profile={hrProfile} />
              </div>
            )}

            {routePoints.length > 1 && (
              <ActivityRouteMap points={routePoints} activePoint={scrubPoint} zoneSegments={zoneSegments} className="h-56 w-full" />
            )}

            {log.splits && log.splits.length > 0 && (
              <PaceBarChart splits={log.splits} bestEfforts={log.bestEfforts} />
            )}

            {log.elevationProfile && log.elevationProfile.length > 1 && (
              <ElevationProfileChart profile={log.elevationProfile} />
            )}

            {log.splits && log.splits.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Splits</p>
                <div className="overflow-hidden rounded-xl bg-muted">
                  {log.splits.map((s, i) => (
                    <div
                      key={s.km}
                      className={`flex justify-between px-3 py-1.5 text-sm ${i > 0 ? 'border-t border-border/60' : ''}`}
                    >
                      <span>Km {s.km}</span>
                      <span className="tabular-nums">{formatPace(s.paceSec)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {log.notes && (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>
                <p className="text-sm text-muted-foreground">{log.notes}</p>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
