'use client'
import { useLiveHr } from '@/lib/live-hr/use-live-hr'
import { HeartIcon } from 'lucide-react'

export function TestHrDisplay({ target }: { target: number | null }) {
  const { bpm, live, stale } = useLiveHr()
  const inZone = bpm != null && target != null && bpm >= target
  return (
    <div className="flex flex-col items-center gap-1" style={{ opacity: live ? 1 : 0.5 }}>
      <div className="flex items-baseline gap-2">
        <HeartIcon className="h-5 w-5" style={{ color: 'var(--color-brand)' }} aria-hidden />
        <span className="text-3xl font-bold tabular-nums">{bpm ?? '—'}</span>
        <span className="text-sm text-muted-foreground">bpm{stale ? ' (stale)' : ''}</span>
      </div>
      {target != null && (
        <p className="text-sm font-semibold" style={{ color: inZone ? 'var(--color-brand)' : 'var(--color-muted-foreground)' }}>
          {inZone ? `In target zone (≥${target} bpm)` : `Aim for ≥${target} bpm`}
        </p>
      )}
    </div>
  )
}
