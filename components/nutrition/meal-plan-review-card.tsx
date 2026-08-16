'use client'

import { memo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { invalidateMealPlans } from '@/lib/cache-groups'
import type { MealPlan } from '@trainingai/shared/types/nutrition'

interface Props {
  plan: MealPlan
  /** Calibrated maintenance now, from the energy-balance service. Null while it is uncalibrated. */
  maintenanceKcal: number | null
  /** What the calibration currently recommends eating. */
  recommendedKcal: number | null
  onDismiss: () => void
  onRebuild: () => void
}

/** How far the recommendation must have moved before the card says the plan is out of date. */
const STALE_KCAL = 100

/**
 * The ~4-week check-in on the active plan.
 *
 * Fires on open rather than on a schedule — there is no cron layer in this app, so this copies the
 * goals-check-in pattern: the server answers "is the active plan older than the window", and this
 * card is what asks the question.
 *
 * The number it quotes comes from the same energy-balance service the Energy Balance bar reads, so
 * the card cannot tell the user something the bar contradicts.
 */
export const MealPlanReviewCard = memo(function MealPlanReviewCard({
  plan, maintenanceKcal, recommendedKcal, onDismiss, onRebuild,
}: Props) {
  const [keeping, setKeeping] = useState(false)

  const drift = recommendedKcal != null ? recommendedKcal - plan.targetCalories : 0
  const moved = recommendedKcal != null && Math.abs(drift) > STALE_KCAL

  async function keepIt() {
    setKeeping(true)
    try {
      // Stamps last_reviewed_at, which is what stops the card asking again for another window.
      const res = await fetch(`/api/nutrition/meal-plans/${plan.id}/review`, { method: 'POST' })
      if (!res.ok) throw new Error()
      await invalidateMealPlans()
      onDismiss()
    } catch {
      toast.error('Could not save that — try again')
    } finally {
      setKeeping(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-4 space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Meal plan check-in
      </p>
      <p className="text-sm font-semibold">{plan.name} is about a month old</p>

      {moved ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {maintenanceKcal != null && (
            <>Your measured maintenance is now{' '}
              <span className="font-semibold text-foreground tabular-nums">
                {maintenanceKcal.toLocaleString()} kcal
              </span>
              .{' '}
            </>
          )}
          Rebuilding would put you at{' '}
          <span className="font-semibold text-foreground tabular-nums">
            {recommendedKcal!.toLocaleString()} kcal
          </span>
          /day, {drift > 0 ? 'up' : 'down'} from {plan.targetCalories.toLocaleString()}.
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Your target has not moved much since you built it, so this is only worth rebuilding if you
          have gone off the meals themselves.
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={keepIt}
          disabled={keeping}
          className="min-h-[44px] flex-1 rounded-xl bg-muted text-xs font-semibold disabled:opacity-60 active:bg-muted/60 transition-colors"
        >
          {keeping ? <Loader2 className="h-3.5 w-3.5 animate-spin inline" /> : 'Keep it'}
        </button>
        <button
          onClick={onRebuild}
          className="min-h-[44px] flex-1 rounded-xl bg-brand text-primary-foreground text-xs font-semibold active:opacity-80 transition-opacity"
        >
          Rebuild plan
        </button>
      </div>
    </div>
  )
})
