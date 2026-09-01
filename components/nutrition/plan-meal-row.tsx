'use client'

import { memo } from 'react'
import { Check, Loader2, Plus, X, Undo2, BookmarkPlus, Bookmark } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import type { MealPlanMeal } from '@trainingai/shared/types/nutrition'

/**
 * One meal of the active plan, as a row in the plan card's expanded list.
 *
 * Extracted from `meal-plan-section.tsx` when Q-398 added the save-to-library action: that file was
 * a single 278-line component whose meal row already carried the log/decline pair, and the standing
 * rule is to extract rather than append. It is `memo`ed because the list re-renders on every log,
 * and every prop it takes is a scalar, a stable callback, or the meal object itself.
 */
interface Props {
  meal: MealPlanMeal
  /** The brand accent, resolved by the parent so this row never re-derives it. */
  accent: string
  logging: boolean
  /** Any meal in the list is logging, which disables every row's log button as it always has. */
  busyLogging: boolean
  logged: boolean
  declined: boolean
  onLog?: (meal: MealPlanMeal) => void
  onSetDeclined?: (meal: MealPlanMeal, declined: boolean) => void
  /** Copy this meal into My Foods (Q-398). Absent while the plan is still loading. */
  onSave?: (meal: MealPlanMeal) => void
  saving: boolean
}

export const PlanMealRow = memo(function PlanMealRow({
  meal, accent, logging, busyLogging, logged, declined, onLog, onSetDeclined, onSave, saving,
}: Props) {
  const hasIngredients = meal.ingredients.length > 0
  const saved = meal.savedMealId != null

  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 text-sm font-medium truncate">
          {meal.suggestedTime && (
            <span className="mr-1.5 tabular-nums text-muted-foreground">{meal.suggestedTime}</span>
          )}
          {meal.name}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground flex-none">
          {meal.targetCalories.toLocaleString()} kcal
        </span>
      </div>
      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
        {Math.round(meal.targetProteinG)}P · {Math.round(meal.targetCarbsG)}C · {Math.round(meal.targetFatG)}F
      </p>
      {/* Plans have stored their ingredients since Q-192; before that this card could only
          say a meal's name and its macros, which is not enough to go and eat it. */}
      {hasIngredients && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">
          {meal.ingredients.map(i => `${i.name} ${Math.round(i.weightG)}g`).join(' · ')}
        </p>
      )}
      {meal.notes && (
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{meal.notes}</p>
      )}

      {/* The tap IS the confirmation, which is why this needs none of the prefilled-but-
          unconfirmed machinery the automatic version (Q-187 phase 2) does — nothing can
          count toward the day's totals unless the user said they ate it. */}
      {onLog && hasIngredients && (
        declined ? (
          /* Declined. Nothing was written to the day's food, so the totals above are
             untouched — the answer only stops this meal asking again. One tap undoes it,
             because "no" is one mis-tap away from losing the meal for the day. */
          <button
            onClick={() => onSetDeclined?.(meal, false)}
            className="mt-1.5 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-transparent text-xs font-semibold text-muted-foreground active:bg-muted/30 transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" /> Didn&apos;t eat this — undo
          </button>
        ) : (
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              onClick={() => onLog(meal)}
              disabled={busyLogging || logged}
              className={cn(
                'flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl',
                'text-xs font-semibold transition-colors disabled:opacity-60',
                logged ? 'bg-transparent text-muted-foreground' : 'bg-muted/60 active:bg-muted/30',
              )}
            >
              {logging ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Logging…</>
              ) : logged ? (
                <><Check className="w-3.5 h-3.5" style={{ color: accent }} /> Logged</>
              ) : (
                <><Plus className="w-3.5 h-3.5" /> I ate this</>
              )}
            </button>
            {/* Hidden once the meal is logged: "ate it" is derived from the food itself, so
                offering "no" beside a logged meal would be offering to contradict it. */}
            {onSetDeclined && !logged && (
              <button
                onClick={() => onSetDeclined(meal, true)}
                aria-label={`Did not eat ${meal.name}`}
                className="min-h-[44px] w-11 flex-none flex items-center justify-center rounded-xl bg-muted/40 text-muted-foreground active:bg-muted/20 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )
      )}

      {/* Q-398. Saved, this meal is an ordinary My Foods row — it logs in one tap, prints a label
          with a QR, and can be edited ingredient by ingredient — so the plan itself becomes
          disposable. Already-saved reads as a state rather than a disabled button, because what it
          answers is "have I kept this one", not "why can't I press this". */}
      {onSave && hasIngredients && (
        saved ? (
          <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <Bookmark className="w-3.5 h-3.5" style={{ color: accent }} /> In My Foods
          </p>
        ) : (
          <button
            onClick={() => onSave(meal)}
            disabled={saving}
            aria-label={`Save ${meal.name} to My Foods`}
            className="mt-1.5 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-transparent text-xs font-semibold text-muted-foreground active:bg-muted/30 transition-colors disabled:opacity-60"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              : <><BookmarkPlus className="w-3.5 h-3.5" /> Save to My Foods</>}
          </button>
        )
      )}
    </li>
  )
})
