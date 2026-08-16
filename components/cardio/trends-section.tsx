'use client'

import { memo, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { CARDIO_TRENDS_TTL } from '@trainingai/shared/cache-ttl'
import type { WeeklyZoneStack, EfficiencyPoint, CadenceTrendPoint } from '@trainingai/shared/health/cardio-trends'

const ZoneStackChart = dynamic(() => import('./zone-stack-chart').then((m) => ({ default: m.ZoneStackChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})
const EfficiencyChart = dynamic(() => import('./efficiency-chart').then((m) => ({ default: m.EfficiencyChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})
const CadenceTrendChart = dynamic(() => import('./cadence-trend-chart').then((m) => ({ default: m.CadenceTrendChart })), {
  ssr: false, loading: () => <div className="h-40 w-full" />,
})

interface CardioTrendsResponse {
  weeklyZoneStacks: WeeklyZoneStack[]
  efficiencyCurve: EfficiencyPoint[]
  cadenceTrend: CadenceTrendPoint[]
}

const CACHE_KEY = 'cardio-trends'

const VIEWS = [
  { key: 'zones', label: 'Zone minutes' },
  { key: 'efficiency', label: 'Efficiency' },
  { key: 'cadence', label: 'Cadence' },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

export const CardioTrendsSection = memo(function CardioTrendsSection() {
  const [view, setView] = useState<ViewKey>('zones')
  const [data, setData] = useState<CardioTrendsResponse | null>(null)

  useEffect(() => {
    const seeded = readCacheSync<CardioTrendsResponse>(CACHE_KEY)
    setData(seeded)
    cachedFetch<CardioTrendsResponse>(CACHE_KEY, '/api/cardio-trends', CARDIO_TRENDS_TTL, setData)
  }, [])

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trends</h3>

      <div className="mb-3 flex gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-none rounded-full border px-3 py-1 text-xs font-semibold transition ${
              view === v.key
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border bg-muted text-muted-foreground'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {!data ? (
        <div className="h-40 w-full animate-pulse rounded-xl bg-muted" />
      ) : view === 'zones' ? (
        data.weeklyZoneStacks.length > 0 ? (
          <ZoneStackChart weeks={data.weeklyZoneStacks} />
        ) : (
          <p className="text-xs text-muted-foreground">Not enough history yet — keep logging zone minutes.</p>
        )
      ) : view === 'efficiency' ? (
        data.efficiencyCurve.length > 0 ? (
          <EfficiencyChart points={data.efficiencyCurve} />
        ) : (
          <p className="text-xs text-muted-foreground">No GPS runs with HR data yet.</p>
        )
      ) : data.cadenceTrend.length > 0 ? (
        <CadenceTrendChart points={data.cadenceTrend} />
      ) : (
        <p className="text-xs text-muted-foreground">No cadence readings yet.</p>
      )}
    </div>
  )
})
