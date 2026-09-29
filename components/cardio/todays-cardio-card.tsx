'use client'

import { memo, useState } from 'react'
import { Footprints, PersonStanding, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  cardioCriterion, cardioStatus, completedLine, STATUS_LABEL,
  type CountedProgress,
} from './todays-cardio-copy'

/** The presets the walk chooser offers. 30 is drawn first because it clears a 25-minute target
 *  outright — the common case is meant to be two taps. */
export const TREADMILL_PRESET_MIN = [20, 30, 45] as const

export interface TodaysCardioCardProps {
  runType: string
  durationMin: number | null
  targetZoneIds: number[]
  targetHrLow: number | null
  targetHrHigh: number | null
  runStatus: 'pending' | 'completed' | 'skipped'
  completedAs: 'run' | 'walk' | null
  /** The activity that satisfied it, when the local store could name it. */
  completedActivity: { durationMin: number | null } | null
  progress: CountedProgress
  onRunIt: () => void
  onGuidedWalk: () => void
  onTreadmillWalk: (durationMin: number) => void
}

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--accent-green)',
  'in-progress': 'var(--accent-cyan)',
}

function ChooserRow({ onClick, icon, title, note }: {
  onClick: () => void
  icon: React.ReactNode
  title: string
  note: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-2.5 text-left"
    >
      <span className="shrink-0 text-[color:var(--accent-cyan)]" aria-hidden>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold">{title}</span>
        <span className="block text-[11px] leading-snug text-[color:var(--muted-foreground)]">{note}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--muted-foreground)]" aria-hidden />
    </button>
  )
}

export const TodaysCardioCard = memo(function TodaysCardioCard(p: TodaysCardioCardProps) {
  const [walkOpen, setWalkOpen] = useState(false)
  const status = cardioStatus(p.runStatus, p.progress.min)
  const { headline, detail } = cardioCriterion(p)
  const target = p.durationMin
  const isDone = status === 'done'

  return (
    // A landmark because the hub already has a "Guided walk" button and a "What do you want to do?"
    // heading — without one, nothing on this card can be addressed unambiguously.
    <section aria-label="Today's cardio" className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-3.5">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
          Today&apos;s cardio
        </p>
        <span
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: STATUS_COLOR[status] ?? 'var(--muted-foreground)' }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <p className="text-sm font-bold">{headline}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-[color:var(--muted-foreground)]">
        {isDone ? completedLine(p.completedAs, p.completedActivity) : detail}
      </p>

      {!isDone && target != null && target > 0 && (
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]">
              Counted so far
            </span>
            <span>
              <b style={{ color: p.progress.min >= target ? 'var(--accent-green)' : undefined }}>{p.progress.min}</b>
              <span className="text-[color:var(--muted-foreground)]"> / {target} min</span>
            </span>
          </div>
          {/* The track sets display:flex so the fill is a block — an inline child cannot be sized. */}
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.round((p.progress.min / target) * 100))}%`,
                background: p.progress.min >= target ? 'var(--accent-green)' : 'var(--accent-cyan)',
              }}
            />
          </div>
          {p.progress.source === 'estimated' && (
            <p className="mt-1 text-[10px] text-[color:var(--muted-foreground)]">
              Estimated from your logged minutes — no heart rate for this walk.
            </p>
          )}
        </div>
      )}

      {!isDone && !walkOpen && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" onClick={p.onRunIt}>Run it</Button>
          <Button size="sm" variant="outline" onClick={() => setWalkOpen(true)}>Walk it</Button>
        </div>
      )}

      {!isDone && walkOpen && (
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-semibold">How are you walking?</p>
            <button
              type="button"
              onClick={() => setWalkOpen(false)}
              className="font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted-foreground)]"
            >
              Back
            </button>
          </div>
          <p className="text-[11px] leading-snug text-[color:var(--muted-foreground)]">
            Either counts toward the {target ?? 0} minutes.
          </p>
          <ChooserRow
            onClick={p.onGuidedWalk}
            icon={<Footprints className="h-4 w-4" />}
            title="Guided walk"
            note="App paces you and counts zone minutes live"
          />
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--background)] p-2.5">
            <p className="flex items-center gap-2 text-xs font-semibold">
              <PersonStanding className="h-4 w-4 shrink-0 text-[color:var(--accent-cyan)]" aria-hidden />
              Treadmill walk
              <span className="font-normal text-[color:var(--muted-foreground)]">· just log it</span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {TREADMILL_PRESET_MIN.map((m) => (
                <Button key={m} size="sm" variant="secondary" onClick={() => p.onTreadmillWalk(m)}>
                  {m} min
                </Button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-snug text-[color:var(--muted-foreground)]">
              Zone minutes still come from your heart rate while you walk.
            </p>
          </div>
        </div>
      )}
    </section>
  )
})
