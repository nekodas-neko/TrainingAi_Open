'use client'
import { memo, useMemo } from 'react'
import { Activity } from 'lucide-react'
import { computeHrZones } from '@trainingai/shared/health/hr-zones'
import { zoneBreakdownFromReadings, type HrReading } from '@trainingai/shared/health/zone-minutes'
import { formatTime } from '@/components/workout/utils'

interface Props {
  readings: { timestamp: string; bpm: number }[]
  profile: { maxHr: number; restingHr: number } | null
}

// Per-workout/activity time-in-zone bars + Edwards-TRIMP "Session Load" (distinct from whole-day
// "Training Stress (OTS)"). Computed client-side from readings the surface already fetched; zones
// come only from hr-zones.ts. Colour is always paired with the zone name (never colour-alone state).
export const ZoneBreakdown = memo(function ZoneBreakdown({ readings, profile }: Props) {
  const breakdown = useMemo(() => {
    if (!profile || readings.length < 2) return null
    const zones = computeHrZones(profile)
    const hr: HrReading[] = readings.map(r => ({ timestamp: new Date(r.timestamp).getTime(), bpm: r.bpm }))
    return zoneBreakdownFromReadings(hr, zones)
  }, [readings, profile])

  if (!breakdown || breakdown.totalSec <= 0) return null
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Time in Zone</p>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          Session Load <span className="font-semibold text-foreground">{breakdown.sessionLoad}</span>
        </span>
      </div>
      <ul className="space-y-1.5">
        {[...breakdown.zones].reverse().map(z => ( // Z5 at top, like the reference UI
          <li key={z.id} className="flex items-center gap-2">
            {/* Swatch + neutral label — the raw zone hex fails the 4.5:1 body-text floor in light
                theme (Z2 green / Z3 yellow), so colour only lives in the swatch + bar (A-6). */}
            <span className="flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: z.color }} aria-hidden />
              Z{z.id} {z.name}
            </span>
            <span className="relative h-4 flex-1 overflow-hidden rounded bg-muted">
              <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${z.pct}%`, backgroundColor: z.color }} />
            </span>
            <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{formatTime(Math.round(z.seconds))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
})
