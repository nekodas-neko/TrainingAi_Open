'use client'

import { memo } from 'react'
import { walkEffortDisplay, type KindAggregate } from '@/lib/walk/segment-stats'

function KindColumn({ label, color, agg }: { label: string; color: string; agg: KindAggregate }) {
  // Same headline rule as the summary screen — this card renders the identical aggregate at a
  // different call site, so it shares the decision rather than restating it.
  const { lead, secondary } = walkEffortDisplay(agg)
  return (
    <div className="flex-1 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color }}>{label}</p>
      <p className="text-lg font-bold tabular-nums">{lead}</p>
      <p className="text-xs text-[color:var(--muted-foreground)] tabular-nums">
        {[
          ...(secondary != null ? [secondary] : []),
          agg.avgDistanceKm != null ? `${agg.avgDistanceKm.toFixed(2)} km` : '— km',
          agg.avgHr != null ? `${agg.avgHr} bpm` : '— bpm',
        ].join(' · ')}
      </p>
    </div>
  )
}

function WalkSegmentStatsCardImpl({ fast, slow }: { fast: KindAggregate; slow: KindAggregate }) {
  if (fast.count === 0 && slow.count === 0) return null

  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        Your fast / slow blocks
      </p>
      <div className="flex gap-4">
        <KindColumn label="Fast" color="var(--color-brand)" agg={fast} />
        <KindColumn label="Slow" color="var(--accent-cyan)" agg={slow} />
      </div>
    </div>
  )
}

export const WalkSegmentStatsCard = memo(WalkSegmentStatsCardImpl)
