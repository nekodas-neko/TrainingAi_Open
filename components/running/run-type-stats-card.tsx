'use client'

import { memo } from 'react'
import { BarChart3 } from 'lucide-react'
import { formatPace } from '@trainingai/shared/health/vdot'
import { TYPE_LABEL, RUN_TYPES } from './run-type-carousel'
import type { RunTypeAggregate } from '@trainingai/shared/running/run-type-stats'
import type { RunType } from '@trainingai/shared/running/types'

function TypeRow({ type, agg }: { type: RunType; agg: RunTypeAggregate }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-sm font-semibold">{TYPE_LABEL[type]}</span>
      <span className="flex items-baseline gap-2 text-xs text-[color:var(--muted-foreground)]">
        <span className="tabular-nums text-foreground">
          {agg.avgPaceSecPerKm != null ? formatPace(agg.avgPaceSecPerKm) : '—'}
        </span>
        <span className="tabular-nums">{agg.avgDistanceKm != null ? `${agg.avgDistanceKm.toFixed(1)} km` : '— km'}</span>
        <span className="tabular-nums">{agg.avgHr != null ? `${agg.avgHr} bpm` : '— bpm'}</span>
      </span>
    </div>
  )
}

function RunTypeStatsCardImpl({ stats }: { stats: Record<RunType, RunTypeAggregate> }) {
  const withData = RUN_TYPES.filter((t) => stats[t].count > 0)
  if (withData.length === 0) return null

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        <BarChart3 className="h-3 w-3" aria-hidden />
        By run type
      </p>
      <div className="divide-y divide-[color:var(--border)]">
        {withData.map((type) => <TypeRow key={type} type={type} agg={stats[type]} />)}
      </div>
    </div>
  )
}

export const RunTypeStatsCard = memo(RunTypeStatsCardImpl)
