'use client'

import { memo, useState, type CSSProperties } from 'react'
import { ChevronDown, UtensilsCrossed, Check, Loader2, Plus, X, Undo2 } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import type { MealPlan, MealPlanVariant, MealPlanMeal, MealPlanDayType } from '@trainingai/shared/types/nutrition'

interface Props {
  plan: MealPlan | null
  loading?: boolean
  /** What has actually been eaten today. Absent on a day with no logs, which is not the same as zero. */
  eaten?: { calories: number; proteinG: number; carbsG: number; fatG: number }
  /** Whether today is a training day, from the user's schedule — never re-derived here. */
  isTrainingDay?: boolean
  onCreate: () => void
  onViewPlan: (planId: string) => void
  /** Log one planned meal as eaten. Absent while meal types are still loading. */
  onLogMeal?: (meal: MealPlanMeal) => void
  /** Position of the meal currently being logged, so only its own button shows a spinner. */
  loggingPosition?: number | null
  /** Positions already logged today, so a meal is not silently logged twice. */
  loggedPositions?: Set<number>
  /** Plan-meal ids the user said they did NOT eat today (Q-187 phase 2). */
  declinedMealIds?: Set<string>
  /** Record or undo "I didn't eat this". Absent while meal types are still loading. */
  onSetDeclined?: (meal: MealPlanMeal, declined: boolean) => void
}

/**
 * The plan card's accent, from the live `--color-brand` rather than a literal (Q-395).
 *
 * `--brand` is user-selectable at runtime (`theme-color-picker.tsx`) and light mode deliberately
 * darkens it for text readability, so a hardcoded green opted out of both: pick a blue accent and
 * this card stayed green.
 *
 * The card style is built here rather than through `accentCardStyle()` because that helper needs
 * real colour channels for its gradient and returns an accent-less card for anything that is not a
 * hex — so handing it a `var()` would have silently dropped the tint. This mirrors its output with
 * `color-mix`, including the `willChange` that keeps each card on its own compositor layer (the
 * Samsung WebView bug where an SVG in one card wipes a sibling's gradient).
 */
const BRAND = 'var(--color-brand)'
const brandTint = (pct: number) => `color-mix(in oklch, var(--color-brand) ${pct}%, transparent)`
const brandCardStyle: CSSProperties = {
  backgroundColor: 'color-mix(in oklch, var(--muted) var(--card-tint-pct, 60%), transparent)',
  backgroundImage: `linear-gradient(135deg, ${brandTint(30)}, ${brandTint(12)})`,
  border: `1px solid ${brandTint(40)}`,
  willChange: 'transform',
}

/**
 * The active meal plan, as a collapsed card on the Nutrition tab.
 *
 * Deliberately shows totals and today's variant only — the meal list is behind the chevron. With a
 * training/rest split a plan is two variants and up to twelve rows, and this tab's job is logging
 * food, not reading a plan. "View plan" is the escape hatch to the full screen.
 */
export const MealPlanSection = memo(function MealPlanSection({
  plan, loading, eaten, isTrainingDay, onCreate, onViewPlan,
  onLogMeal, loggingPosition, loggedPositions, declinedMealIds, onSetDeclined,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  if (loading && plan == null) {
    return <div className="h-28 rounded-2xl bg-muted/50 animate-pulse" aria-label="Loading meal plan" aria-busy="true" />
  }

  if (plan == null) {
    return (
      <button
        onClick={onCreate}
        className="w-full min-h-[48px] flex items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/40 px-4 py-4 text-left active:bg-muted/20 transition-colors"
      >
        <UtensilsCrossed className="w-4 h-4 text-muted-foreground flex-none" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">Build a meal plan</span>
          <span className="block text-[11px] text-muted-foreground">
            Meals built around your calorie target and when you train
          </span>
        </span>
      </button>
    )
  }

  const variant = pickVariant(plan, isTrainingDay)
  const dayLabel = variant.dayType === 'all' ? null
    : variant.dayType === 'training' ? 'Training day' : 'Rest day'

  return (
    <div className="rounded-2xl p-4" style={brandCardStyle}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: BRAND }}>
            Active plan
          </p>
          <p className="mt-0.5 text-sm font-semibold truncate">{plan.name}</p>
        </div>
        {dayLabel && (
          <span
            className="flex-none text-[9px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full"
            style={{ backgroundColor: brandTint(13), color: BRAND }}
          >
            {dayLabel}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums leading-none">
          {eaten
            ? `${Math.round(eaten.calories).toLocaleString()} / ${variant.targetCalories.toLocaleString()}`
            : variant.targetCalories.toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground">
          kcal · {plan.mealsPerDay} {plan.mealsPerDay === 1 ? 'meal' : 'meals'}
        </span>
      </div>

      {/* Eaten against planned, per macro. The bars used to be drawn full-width regardless of the
          number beside them — a thing that reads as progress and was not one. With no logs yet
          they are empty rather than full, which is the honest reading of an untouched day. */}
      <div className="mt-3 space-y-2">
        <MacroRow label="Protein" eaten={eaten?.proteinG} target={variant.targetProteinG} color={MACRO_COLORS.protein} />
        <MacroRow label="Carbs" eaten={eaten?.carbsG} target={variant.targetCarbsG} color={MACRO_COLORS.carbs} />
        <MacroRow label="Fat" eaten={eaten?.fatG} target={variant.targetFatG} color={MACRO_COLORS.fat} />
      </div>

      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="mt-3 w-full min-h-[44px] flex items-center justify-between rounded-xl bg-muted/50 px-3 text-xs font-semibold active:bg-muted/30 transition-colors"
      >
        <span>{expanded ? 'Hide meals' : `Show ${variant.meals.length} meals`}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <ul className="mt-2 divide-y divide-border/50">
          {variant.meals.map(meal => (
            <li key={meal.id} className="py-2.5">
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
              {meal.ingredients.length > 0 && (
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
              {onLogMeal && meal.ingredients.length > 0 && (
                declinedMealIds?.has(meal.id) ? (
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
                      onClick={() => onLogMeal(meal)}
                      disabled={loggingPosition != null || loggedPositions?.has(meal.position)}
                      className={cn(
                        'flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl',
                        'text-xs font-semibold transition-colors disabled:opacity-60',
                        loggedPositions?.has(meal.position)
                          ? 'bg-transparent text-muted-foreground'
                          : 'bg-muted/60 active:bg-muted/30',
                      )}
                    >
                      {loggingPosition === meal.position ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Logging…</>
                      ) : loggedPositions?.has(meal.position) ? (
                        <><Check className="w-3.5 h-3.5" style={{ color: BRAND }} /> Logged</>
                      ) : (
                        <><Plus className="w-3.5 h-3.5" /> I ate this</>
                      )}
                    </button>
                    {/* Hidden once the meal is logged: "ate it" is derived from the food itself, so
                        offering "no" beside a logged meal would be offering to contradict it. */}
                    {onSetDeclined && !loggedPositions?.has(meal.position) && (
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
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => onViewPlan(plan.id)}
        className="mt-3 w-full min-h-[44px] rounded-xl bg-muted/50 text-xs font-semibold active:bg-muted/30 transition-colors"
      >
        Manage plan
      </button>
    </div>
  )
})

/**
 * Which variant applies today. A plan with no split has one 'all' variant; a split plan is keyed
 * off the caller's `isTrainingDay`, which comes from the user's existing schedule. Falls back to
 * the first variant so an unexpected shape renders something rather than nothing.
 */
function pickVariant(plan: MealPlan, isTrainingDay?: boolean): MealPlanVariant {
  const byType = (t: MealPlanDayType) => plan.variants.find(v => v.dayType === t)
  return (
    byType('all')
    ?? (isTrainingDay ? byType('training') : byType('rest'))
    ?? plan.variants[0]
  )
}

function MacroRow(
  { label, eaten, target, color }:
  { label: string; eaten?: number; target: number; color: string },
) {
  const pct = eaten == null || target <= 0 ? 0 : Math.min(100, (eaten / target) * 100)
  const over = eaten != null && target > 0 && eaten > target
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <div
        className="h-1.5 flex-1 overflow-hidden rounded-full"
        style={{ backgroundColor: `${color}33` }}
        role="progressbar"
        aria-label={`${label}: ${Math.round(eaten ?? 0)} of ${Math.round(target)} grams`}
        aria-valuenow={Math.round(eaten ?? 0)}
        aria-valuemin={0}
        aria-valuemax={Math.round(target)}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className={cn(
        'w-16 shrink-0 text-right text-[11px] tabular-nums',
        over ? 'font-semibold' : 'text-muted-foreground',
      )}>
        {/* Over target is marked with a symbol as well as weight, never colour alone. */}
        {eaten == null ? `${Math.round(target)} g` : `${Math.round(eaten)}/${Math.round(target)} g`}
        {over && ' ↑'}
      </span>
    </div>
  )
}
