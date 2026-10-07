'use client'

import { memo } from 'react'
import type { HrProfile } from '@trainingai/shared/health/hr-profile'
import { maxHrSourceNote, noHrDataCopy, restingHrSourceNote } from '@/components/health/hr-source-copy'

interface Props {
  restingHr: number
  restingHrDeltaBpm: number | null
  avgHr: number | null
  avgHrDeltaBpm: number | null
  maxHr: number | null
  maxHrDeltaBpm: number | null
  isReliable: boolean
  /** LA-82 — `/api/cardio-week` sends both; absent on a payload cached before it did. */
  maxHrSource?: HrProfile['maxHrSource']
  restingHrSource?: HrProfile['restingHrSource']
  /** #2338 — `false` only when nothing has recorded this person's heart rate (`hasHrSource`). */
  hasHrSource?: boolean | null
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

function HeartProfileCardImpl({ restingHr, restingHrDeltaBpm, avgHr, avgHrDeltaBpm, maxHr, maxHrDeltaBpm, isReliable, maxHrSource, restingHrSource, hasHrSource }: Props) {
  // LA-82. A zone quota measured against a stand-in max or resting HR has to say so — until now
  // both substitutions were silent, which is the quiet wrong answer the owner ruled out.
  const maxNote = maxHrSourceNote(maxHrSource)
  const restingNote = restingHrSourceNote(restingHrSource)
  const standIns = [
    restingNote?.standIn ? restingNote.detail : null,
    maxNote.standIn ? maxNote.detail : null,
  ].filter((d): d is string => !!d)

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
      {standIns.map(detail => (
        <p key={detail} className="mt-2.5 text-[11px] leading-snug" style={{ color: 'var(--accent-amber)' }}>
          {detail}
        </p>
      ))}
      {/* Suppressed while a stand-in is showing: "still learning your range" describes a profile
          that is being built, and a value that could not be READ is a different thing to say. */}
      {!isReliable && standIns.length === 0 && (
        <p className="mt-2.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
          {noHrDataCopy(hasHrSource, 'range')}
        </p>
      )}
    </div>
  )
}

export const HeartProfileCard = memo(HeartProfileCardImpl)
