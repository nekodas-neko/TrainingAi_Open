'use client'

import { memo } from 'react'

interface Props {
  restingHr: number
  restingHrDeltaBpm: number | null
  avgHr: number | null
  avgHrDeltaBpm: number | null
  maxHr: number | null
  maxHrDeltaBpm: number | null
  isReliable: boolean
}

function DeltaLabel({ deltaBpm }: { deltaBpm: number | null }) {
  if (deltaBpm == null || deltaBpm === 0) return null
  return (
    <span
      className="text-[11px] font-semibold tabular-nums"
      style={{ color: deltaBpm > 0 ? 'var(--destructive)' : 'var(--accent-green)' }}
    >
      {deltaBpm > 0 ? `+${deltaBpm}` : deltaBpm}
    </span>
  )
}

function Tile({ value, label, deltaBpm }: { value: string; label: string; deltaBpm: number | null }) {
  return (
    <div className="rounded-xl bg-[color:var(--muted)] px-2 py-2.5 text-center">
      <span className="flex items-baseline justify-center gap-1">
        <span className="font-mono text-xl font-semibold tabular-nums">{value}</span>
        <DeltaLabel deltaBpm={deltaBpm} />
      </span>
      <span className="block text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">{label}</span>
    </div>
  )
}

function HeartProfileCardImpl({ restingHr, restingHrDeltaBpm, avgHr, avgHrDeltaBpm, maxHr, maxHrDeltaBpm, isReliable }: Props) {
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <p className="mb-2.5 flex items-center font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
        Your heart
        <span className="ml-auto tracking-normal normal-case">last 30 days</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        <Tile value={String(restingHr)} label="Resting" deltaBpm={restingHrDeltaBpm} />
        <Tile value={avgHr != null ? String(avgHr) : '—'} label="Avg" deltaBpm={avgHrDeltaBpm} />
        <Tile value={maxHr != null ? String(maxHr) : '—'} label="Max" deltaBpm={maxHrDeltaBpm} />
      </div>
      {!isReliable && (
        <p className="mt-2.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
          Still learning your range — wear your ring or strap for a few more days.
        </p>
      )}
    </div>
  )
}

export const HeartProfileCard = memo(HeartProfileCardImpl)
