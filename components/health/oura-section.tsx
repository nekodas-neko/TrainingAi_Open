'use client'

import { memo, useEffect, useLayoutEffect, useState } from 'react'
import { useTransitionRouter } from "@/lib/view-transition";
import { BatteryMediumIcon, BatteryFullIcon, BatteryLowIcon, BatteryChargingIcon } from 'lucide-react'
import { secondsSinceLocalMidnight } from '@trainingai/shared/date-utils'
import { cachedFetchToday, readTodayCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM, HEALTH_TRENDS_SUMMARY_TTL } from '@trainingai/shared/cache-ttl'
import type { OuraStatsResponse } from '@/app/api/oura/stats/route'
import type { HealthTrendsResponse } from '@/app/api/health/trends/route'
import { TrendSparkline } from './trend-sparkline-lazy'

function fmtMin(sec: number | null | undefined) {
  if (sec == null) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">{children}</p>
}

function StatTile({ label, value, unit, color }: { label: string; value: React.ReactNode; unit?: string; color?: string }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border/40 p-3 flex flex-col gap-0.5">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums leading-tight" style={color ? { color } : undefined}>
        {value}{unit && <span className="text-[10px] font-normal text-muted-foreground ml-0.5">{unit}</span>}
      </p>
    </div>
  )
}

interface Props {
  // Parent-fetched trends (PERF-4) — when provided, this card skips its own
  // fetch entirely instead of racing three siblings for the same key. Falls
  // back to a self-fetch when the parent hasn't resolved it (undefined).
  trends?: HealthTrendsResponse['trends']
}


export const OuraSection = memo(function OuraSection({ trends: trendsProp }: Props) {
  const router = useTransitionRouter()
  // Warm the detail routes before they're tapped — see oura-score-chip-row.
  useEffect(() => { router.prefetch('/health/readiness'); router.prefetch('/health/sleep'); }, [router])
  const [data, setData] = useState<OuraStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [trends, setTrends] = useState<HealthTrendsResponse['trends']>([])
  const [liveBattery, setLiveBattery] = useState<{ percent: number; charging: boolean | null; ageMinutes: number } | null>(null)

  // Seed synchronously from cache before paint — never in a useState lazy
  // initializer, which would read cache on the server too and risk a
  // hydration mismatch if this component is ever rendered with ssr:true.
  useLayoutEffect(() => {
    const d = readTodayCacheSync<OuraStatsResponse>('oura-stats')
    if (d) setData(d)
    if (trendsProp !== undefined) {
      setTrends(trendsProp)
    } else {
      const tr = readTodayCacheSync<HealthTrendsResponse>('health-trends-summary')
      if (tr?.trends) setTrends(tr.trends)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cachedFetchToday<OuraStatsResponse>('oura-stats', '/api/oura/stats', TTL_MEDIUM, d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
    // Live BLE battery poll — preferred over the frozen Cloud value when it's fresh.
    cachedFetchToday<{ latest: { percent: number; charging: boolean | null; ageMinutes: number } | null }>(
      'oura-ble-battery-latest', '/api/oura-ble/battery-latest', TTL_MEDIUM,
      d => { if (d?.latest !== undefined) setLiveBattery(d.latest) },
    ).catch(() => {})
    if (trendsProp !== undefined) return
    cachedFetchToday<HealthTrendsResponse>('health-trends-summary', '/api/health/trends', HEALTH_TRENDS_SUMMARY_TTL, d => {
      if (d?.trends) setTrends(d.trends)
    }).catch(() => {})
  }, [trendsProp])

  // Adopt the parent's trends once it resolves after this component's own mount.
  useEffect(() => {
    if (trendsProp !== undefined) setTrends(trendsProp)
  }, [trendsProp])


  // Skeleton only when there's no cached data to paint — seeded data renders immediately
  if (loading && !data) {
    return <div className="rounded-2xl h-32 animate-pulse bg-muted/40" />
  }

  if (!data?.connected) return null

  const { daily } = data
  // Direct-BLE poll is now the only battery source — /api/oura/stats no longer
  // calls the Oura Cloud, whose reading has been frozen since the re-key anyway.
  const battery = liveBattery != null
    ? { level: liveBattery.percent, charging: liveBattery.charging ?? false }
    : null

  // Time worn today = elapsed-so-far − non_wear (partial day; never a full 24h)
  const wornSec = daily?.nonWearTimeSec != null
    ? Math.max(0, secondsSinceLocalMidnight() - daily.nonWearTimeSec)
    : null
  const batteryIcon = battery?.charging
    ? <BatteryChargingIcon className="w-4 h-4 text-green-400" />
    : battery != null && battery.level >= 60
      ? <BatteryFullIcon className="w-4 h-4 text-green-400" />
      : battery != null && battery.level >= 25
        ? <BatteryMediumIcon className="w-4 h-4 text-amber-400" />
        : <BatteryLowIcon className="w-4 h-4 text-red-400" />

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Ring</p>
      </div>

      {/* 24h Heart Rate chart moved to the Heart & Recovery section (components/health/hr-day-card.tsx)
          so all heart data lives together (owner request). */}

      {/* Ring status card */}
      <div className="rounded-2xl bg-muted/30 border border-border/50 p-4 space-y-3">
        <SectionLabel>Ring Status</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {battery != null && (
            <div className="rounded-xl bg-muted/40 border border-border/40 p-3 flex items-center gap-2">
              {batteryIcon}
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">Battery</p>
                <p className="text-lg font-bold tabular-nums leading-tight">{battery.level}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">%</span></p>
              </div>
            </div>
          )}
          {wornSec != null && (
            <StatTile label="Time Worn" value={fmtMin(wornSec)} color="var(--color-brand)" />
          )}
        </div>
        {trends.length > 0 && (
          <TrendSparkline trends={trends} field="wornHours" label="Wear Time" color="var(--color-brand)" unit="h" />
        )}
      </div>

      {/* Readiness contributors — detail on dedicated page */}
      <button
        onClick={() => router.push('/health/readiness')}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        Readiness contributors →
      </button>

      {/* Sleep contributors — detail on dedicated page */}
      <button
        onClick={() => router.push('/health/sleep')}
        className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
      >
        Sleep contributors →
      </button>
    </div>
  )
})
