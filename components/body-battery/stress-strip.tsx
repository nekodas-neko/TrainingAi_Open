'use client'

import { ActivityIcon } from 'lucide-react'
import { Sparkline } from '@/components/ui/sparkline'
import type { BodyBatteryResponse } from '@/app/api/body-battery/route'

type Stress = NonNullable<BodyBatteryResponse['stress']>

// Level ∈ [−1,+1] with negative = stressed. The word carries the state so the amber
// hue is never the only cue (colour-only-state rule).
function stressLabel(current: number | null): string {
  if (current == null) return 'No reading'
  if (current <= -0.5) return 'High'
  if (current < 0) return 'Elevated'
  if (current < 0.5) return 'Calm'
  return 'Recovering'
}

export function StressStrip({ stress }: { stress: Stress }) {
  const amber = 'var(--accent-amber)'
  // Flip level → stress magnitude so a spike on the strip reads as more stress,
  // matching the amber cue and the "high for N min" caption.
  const values = stress.series.map(p => -p.level)

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ActivityIcon className="h-3 w-3 flex-none" style={{ color: amber }} />
        <span>Daytime stress</span>
        <span className="font-semibold" style={{ color: amber }}>{stressLabel(stress.current)}</span>
        {stress.draining && <span>· elevated now</span>}
        <div className="flex-1" />
        {stress.highMinutes != null && stress.highMinutes > 0 && (
          <span className="tabular-nums">high ~{stress.highMinutes} min today</span>
        )}
      </div>
      {values.length >= 2 && (
        <Sparkline values={values} color={amber} height={28} responsive fill />
      )}
      {stress.extraDrained > 0 && (
        <p className="text-[10px] text-muted-foreground">
          Drained{' '}
          <span className="font-semibold tabular-nums" style={{ color: amber }}>−{stress.extraDrained}</span>
          {' '}battery points today
        </p>
      )}
    </div>
  )
}
