'use client'

import { useState } from 'react'
import { InfoIcon, CheckCircle2Icon, TriangleAlertIcon, CircleAlertIcon, MoonIcon, ChevronDownIcon } from 'lucide-react'
import { accentCardStyle } from '@trainingai/shared/utils'
import { TrainingStressLine } from '@/components/health/training-stress-line'
import type { TrainingLoadResponse } from '@/app/api/training-load/route'

function monotonyColor(m: number): string {
  return m > 2 ? '#ef4444' : m > 1.5 ? '#f59e0b' : '#22c55e'
}

// Monotony meter — where daily-load sameness sits on a 0→2.5 scale. Low (varied) is good;
// >2 (very monotonous) is the injury-risk end. Zones: green <1.5, amber 1.5–2, red >2.
function MonotonyMeter({ monotony, strain }: { monotony: number; strain: number | null }) {
  const pct = Math.max(2, Math.min(98, (monotony / 2.5) * 100))
  return (
    <div className="space-y-2.5">
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Monotony</span>
          <span className="font-semibold tabular-nums" style={{ color: monotonyColor(monotony) }}>{monotony.toFixed(2)}</span>
        </div>
        <div className="relative flex h-2 overflow-hidden rounded-full">
          <div className="bg-green-500/30" style={{ width: '60%' }} />
          <div className="bg-amber-500/30" style={{ width: '20%' }} />
          <div className="bg-red-500/30" style={{ width: '20%' }} />
          <div className="absolute top-1/2 h-3.5 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow" style={{ left: `${pct}%` }} />
        </div>
        <div className="mt-0.5 flex justify-between text-[9px] text-muted-foreground">
          <span>Varied</span>
          <span>Monotonous</span>
        </div>
      </div>
      {strain != null && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Weekly strain</span>
          <span className="font-semibold tabular-nums">{Math.round(strain).toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}

/**
 * ACWR / Training Load card — collapsed by default (headline: the ACWR number + zone), with
 * monotony/strain, the stress-line chart and the explainer behind an expand toggle so it no
 * longer eats a full screen.
 */
export function TrainingLoadCard({ trainingLoad }: { trainingLoad: TrainingLoadResponse | null }) {
  const [open, setOpen] = useState(false)
  const insufficient = !trainingLoad || trainingLoad.interpretation === 'insufficient_data'
  const baselining = trainingLoad?.interpretation === 'baselining'

  return (
    <div className="rounded-2xl p-4" style={accentCardStyle('#f59e0b')}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Training Load (ACWR)</h3>
          {insufficient ? (
            <p className="text-base font-semibold text-foreground">Not enough data yet</p>
          ) : baselining ? (
            <p className="text-base font-semibold text-foreground">Baselining new routine</p>
          ) : (
            <div className="mt-0.5 flex items-end gap-3">
              <p className="text-3xl font-bold tabular-nums" style={{ color: '#f59e0b' }}>{trainingLoad!.acwr!.toFixed(2)}</p>
              <p className="mb-1 flex items-center gap-1 text-sm text-muted-foreground">
                {trainingLoad!.interpretation === 'optimal'   && (<><CheckCircle2Icon className="w-3.5 h-3.5" /> Optimal zone</>)}
                {trainingLoad!.interpretation === 'high'      && (<><TriangleAlertIcon className="w-3.5 h-3.5" /> Slightly elevated</>)}
                {trainingLoad!.interpretation === 'very_high' && (<><CircleAlertIcon className="w-3.5 h-3.5" /> Overreaching risk</>)}
                {trainingLoad!.interpretation === 'low'       && (<><MoonIcon className="w-3.5 h-3.5" /> Detraining risk</>)}
              </p>
            </div>
          )}
        </div>
        <ChevronDownIcon className="h-4 w-4 flex-none text-muted-foreground transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
          {baselining && (
            <p className="text-xs text-muted-foreground">
              ACWR will be available once your program has 28 days of history
              {trainingLoad?.baselineDaysRemaining != null ? ` (${trainingLoad.baselineDaysRemaining} days remaining)` : ''}
            </p>
          )}
          <p className="text-xs text-muted-foreground">7-day avg vs 28-day baseline · green zone: 0.8–1.3</p>
          {trainingLoad?.monotony != null && (
            <MonotonyMeter monotony={trainingLoad.monotony} strain={trainingLoad.strain ?? null} />
          )}
          <TrainingStressLine />
          <div className="flex gap-2 rounded-xl bg-muted/50 p-3">
            <InfoIcon className="h-3.5 w-3.5 text-muted-foreground flex-none mt-0.5" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              ACWR = last 7 days vs your 28-day average. Under 0.8 detrains, 0.8–1.3 is the sweet spot, over 1.5 raises injury risk. Monotony flags training that&apos;s too samey.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
