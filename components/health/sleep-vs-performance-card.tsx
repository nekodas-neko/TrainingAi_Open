'use client'

import { useState } from 'react'
import { InfoIcon, ChevronDownIcon } from 'lucide-react'
import { accentCardStyle } from '@trainingai/shared/utils'
import type { SleepCorrelationResponse } from '@/app/api/sleep-performance-correlation/route'

/**
 * Sleep vs Performance — collapsed by default (headline: the one-line insight), expanding to a
 * small bar chart of how each sleep-duration bucket moves your lifts vs baseline (up = better),
 * replacing the flat number tiles so the pattern is visible at a glance.
 */
export function SleepVsPerformanceCard({ sleepCorr }: { sleepCorr: SleepCorrelationResponse }) {
  const [open, setOpen] = useState(false)
  const buckets = sleepCorr.buckets ?? []
  const maxAbs = Math.max(1, ...buckets.map(b => Math.abs(b.avgPctChange)))

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#8b5cf6')}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sleep vs Performance</h3>
          {!sleepCorr.hasSufficientData ? (
            <p className="text-base font-semibold text-foreground">Not enough data yet</p>
          ) : (
            <p className="mt-0.5 text-sm font-medium leading-snug line-clamp-2">{sleepCorr.insight}</p>
          )}
        </div>
        <ChevronDownIcon className="mt-0.5 h-4 w-4 flex-none text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
          {!sleepCorr.hasSufficientData ? (
            <p className="text-xs text-muted-foreground">Log sleep and complete more workouts to unlock this correlation</p>
          ) : buckets.length > 0 ? (
            <div className="flex items-end justify-between gap-2" style={{ height: 96 }}>
              {buckets.map(b => {
                const positive = b.avgPctChange >= 0
                const barFrac = Math.abs(b.avgPctChange) / maxAbs
                const barPx = Math.round(barFrac * 34)
                const color = positive ? 'var(--color-brand)' : '#ef4444'
                return (
                  <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
                    {/* value above bar */}
                    <span className="text-[10px] font-bold tabular-nums" style={{ color }}>
                      {positive ? '+' : ''}{b.avgPctChange.toFixed(1)}%
                    </span>
                    {/* diverging bar around a zero baseline */}
                    <div className="flex w-full flex-col items-center justify-center" style={{ height: 40 }}>
                      <div className="flex w-6 flex-col-reverse" style={{ height: 40 }}>
                        {positive
                          ? <div className="rounded-t" style={{ height: barPx, background: color }} />
                          : <div className="mt-auto rounded-b" style={{ height: barPx, background: color }} />}
                      </div>
                    </div>
                    <div className="h-px w-full bg-border" />
                    <span className="text-[10px] font-medium text-muted-foreground">{b.label}</span>
                    <span className="text-[9px] text-muted-foreground">{b.count} sets</span>
                  </div>
                )
              })}
            </div>
          ) : null}
          <div className="flex gap-2 rounded-xl bg-muted/50 p-3">
            <InfoIcon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Each bar shows how far your estimated 1RM sits above or below your per-exercise baseline on days after that sleep duration — so heavy and light exercises compare fairly.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
