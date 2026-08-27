'use client'

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@trainingai/shared/utils'
import type { Pin, ReductionDecision } from './meal-count-reduction'

interface Props {
  mealCount: number
  /** What the count was before this change — Cancel restores it, and it is not always +1. */
  previousCount: number
  decision: ReductionDecision
  pins: Pin[]
  onKeep: (keptKeys: string[]) => void
  onCancel: () => void
}

/**
 * "You have more meals kept than slots" (BF-11h, plan §3.2).
 *
 * Shown when lowering the meal count leaves more pins than the plan can hold. It **names** what no
 * longer fits and asks which to keep — the alternative, which is what shipped before this, is a
 * silent truncation the user cannot see from any screen.
 *
 * Pre-ticked with the first `M - 1` in pick order, so agreeing is one tap. Cancel puts the count
 * back rather than applying a change the user has not answered for.
 */
export function MealCountReductionPrompt({
  mealCount, previousCount, decision, pins, onKeep, onCancel,
}: Props) {
  const [kept, setKept] = useState<string[]>(decision.preselected)
  const atLimit = kept.length >= decision.maxKeepable

  function toggle(key: string) {
    setKept(prev =>
      prev.includes(key) ? prev.filter(k => k !== key)
        : atLimit ? prev
        : [...prev, key],
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
      <p
        className="flex items-start gap-1.5 text-[11px] leading-snug"
        style={{ color: 'var(--accent-amber)' }}
      >
        <AlertTriangle className="mt-px h-3 w-3 flex-none" />
        <span>
          {mealCount === 1
            ? 'One meal a day leaves no room to keep any of your own — the plan needs the slot.'
            : `${mealCount} meals a day leaves room for ${decision.maxKeepable} of your own. One slot stays open for the plan to work with.`}
        </span>
      </p>

      {decision.maxKeepable > 0 && (
        <>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Pick which to keep. The rest still steer what the plan suggests — nothing is deleted.
          </p>
          <ul className="space-y-1.5">
            {pins.map(p => {
              const on = kept.includes(p.key)
              return (
                <li key={p.key}>
                  <button
                    onClick={() => toggle(p.key)}
                    aria-pressed={on}
                    disabled={!on && atLimit}
                    className={cn(
                      'flex w-full min-h-[44px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors',
                      on ? 'border-brand/50 bg-brand/15' : 'border-border bg-muted/50',
                      !on && atLimit && 'opacity-40',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid h-4 w-4 flex-none place-items-center rounded border text-[10px] font-bold',
                        on ? 'border-brand bg-brand text-background' : 'border-border',
                      )}
                    >
                      {on ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={onCancel}>
          Keep {previousCount} meals
        </Button>
        <Button
          className="flex-1 min-h-[44px]"
          onClick={() => onKeep(kept)}
          // Fewer than the maximum is a legitimate answer — the cap is a ceiling, not a quota.
          // Only an empty pick when something COULD be kept needs blocking, since that is more
          // likely a mis-tap than a decision.
          disabled={decision.maxKeepable > 0 && kept.length === 0}
        >
          {decision.maxKeepable === 0 ? 'Drop them all' : 'Use these'}
        </Button>
      </div>
    </div>
  )
}
