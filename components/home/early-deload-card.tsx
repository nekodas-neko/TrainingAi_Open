'use client'

import { memo, useState } from 'react'
import { toast } from 'sonner'
import { ActivityIcon, ChevronDownIcon, TrendingUpIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@trainingai/shared/utils'
import type { EarlyDeloadReason } from '@/lib/health/readiness-payload'

/**
 * "Why this recommendation?", in the same shape as `DeloadExplanation` on the day-to-day
 * recommendation card — the owner's report was that this one *"recommended emergency deload but
 * wouldn't tell me why"* (Q-173).
 *
 * Not the same component: that one explains a day-scoped signal set (temperature, HRV trend, sore
 * muscles), this one explains a two-number threshold check. Same visual language, different data.
 * The numbers and the thresholds both come from the server so the card can never state a bound the
 * check does not actually use.
 */
function WhyThisCard({ reason }: { reason: EarlyDeloadReason }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-amber-500/25 bg-amber-500/5">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-xs font-medium text-muted-foreground">Why this recommendation?</span>
        <ChevronDownIcon className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-xs font-semibold text-foreground">
            Both of these had to be true at once — either one alone would not have raised this.
          </p>

          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
              <span className="mt-0.5 flex-none text-foreground/70"><ActivityIcon className="h-3.5 w-3.5" /></span>
              <span>
                Readiness <span className="font-semibold text-foreground tabular-nums">{Math.round(reason.score)}</span>
                {' '}— under {reason.scoreThreshold}, the point where recovery is not keeping up with what you are asking of it.
              </span>
            </li>
            <li className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
              <span className="mt-0.5 flex-none text-foreground/70"><TrendingUpIcon className="h-3.5 w-3.5" /></span>
              <span>
                Training load <span className="font-semibold text-foreground tabular-nums">{reason.acwr.toFixed(2)}</span>
                {' '}— above {reason.acwrThreshold.toFixed(2)}. That is this week&apos;s load against your
                four-week average, so you are doing meaningfully more than your body is used to.
              </span>
            </li>
          </ul>

          <div className="space-y-1.5 border-t border-amber-500/20 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your options</p>
            <Option color="var(--accent-amber)" label="Take a deload week" desc="Starts the deload phase now instead of when the cycle reaches it. Lighter loads for a week, then the block resumes." />
            <Option color="#94a3b8" label="Dismiss" desc="Nothing changes. The card comes back if both signals are still true tomorrow." />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Option({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px] leading-snug">
      <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span> — {desc}
      </span>
    </div>
  )
}

export const EarlyDeloadCard = memo(function EarlyDeloadCard({
  onConfirm, onDismiss, reason,
}: { onConfirm: () => void; onDismiss: () => void; reason?: EarlyDeloadReason | null }) {
  const [loading, setLoading] = useState(false)
  async function handleConfirm() {
    setLoading(true)
    try {
      const res = await fetch('/api/confirm-early-deload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!res.ok) throw new Error()
      onConfirm()
    } catch {
      toast.error('Could not start deload — try again')
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4 space-y-2">
      <p className="font-semibold text-sm text-amber-700 dark:text-amber-400">Fatigue detected</p>
      <p className="text-xs text-muted-foreground">
        Your readiness is low and training load is elevated. Consider taking a deload week now.
      </p>
      {/* Absent only on a cached payload written before this field existed — the card still works,
          it just cannot show its reasoning until the next fetch. */}
      {reason && <WhyThisCard reason={reason} />}
      {/* A-8: these were bare ~28px / padding-less buttons mutating the training program
          8px apart — a mis-tap risk. Shared Button primitives with a ≥44px tap floor. */}
      <div className="flex gap-3 mt-2">
        <Button
          onClick={handleConfirm}
          disabled={loading}
          className="min-h-[44px] flex-1 text-sm font-semibold hover:opacity-90"
          style={{ background: "var(--accent-amber)", color: "#000" }}
        >
          Take deload week now
        </Button>
        <Button variant="ghost" onClick={onDismiss} className="min-h-[44px] text-sm text-muted-foreground">
          Dismiss
        </Button>
      </div>
    </div>
  )
})
