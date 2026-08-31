'use client'

import { memo, useState, type CSSProperties } from 'react'
import { ChevronDown, UtensilsCrossed, BookmarkPlus, Loader2, CheckCheck } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import type { MealPlan, MealPlanVariant, MealPlanMeal, MealPlanDayType, MealType } from '@trainingai/shared/types/nutrition'
import { fillableMeals } from './plan-day-fill'
import { PlanMealRow } from './plan-meal-row'

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
  /**
   * Log every meal a one-tap "log the day" would write, in one action (Q-187 step 4). Absent while
   * meal types are still loading.
   *
   * **Which meals those are is worked out here rather than by the caller**, from the same `variant`
   * this card renders. Deriving it outside would let the button offer a meal the list below is not
   * showing, because a split plan has two variants and `pickVariant` decides between them.
   */
  onLogAll?: (meals: MealPlanMeal[]) => void
  /** Buckets, for resolving when an untimed meal is meant to happen. */
  mealTypes?: MealType[]
  /** The day being shown, `YYYY-MM-DD`. */
  logDate?: string
  /** Today in the USER's timezone. */
  today?: string
  /** The current hour in the user's timezone. Null means it could not be read — which stops the
   *  offer on today rather than guessing, since guessing logs food nobody ate. */
  nowHour?: number | null
  /** A bulk log is running, so no other logging control should be live. */
  bulkLogging?: boolean
  /** Copy a planned meal into My Meals (Q-398). */
  onSaveMeal?: (meal: MealPlanMeal) => void
  /** Copy every meal that is not already saved, in one action. */
  onSaveAllMeals?: (meals: MealPlanMeal[]) => void
  /** Positions currently being copied, so only their own rows spin. */
  savingPositions?: Set<number>
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
  onLogAll, mealTypes, logDate, today, nowHour, bulkLogging,
  onSaveMeal, onSaveAllMeals, savingPositions,
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
  // A meal with no ingredients has nothing to copy — plans generated before Q-192 stored only names
  // and macros, and a saved meal built from those would be an empty recipe.
  const unsaved = variant.meals.filter(m => m.savedMealId == null && m.ingredients.length > 0)
  const busySaving = (savingPositions?.size ?? 0) > 0
  const fillable = onLogAll && mealTypes && logDate && today
    ? fillableMeals({
        meals: variant.meals, mealTypes, selectedDate: logDate, today,
        // -1 is "no hour has come yet": an unreadable clock must offer nothing on today, not
        // everything.
        nowHour: nowHour ?? -1,
        loggedPositions: loggedPositions ?? new Set(),
        declinedMealIds: declinedMealIds ?? new Set(),
      })
    : []
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

      {/* Q-187 step 4: the plan's automatic half, as an explicit action rather than a prefill on
          day open — a prefill that guesses wrong trains you to ignore it. It sits in the collapsed
          card because not having to expand first is the entire value; it is hidden when there is
          nothing to log, rather than sitting there disabled. */}
      {onLogAll && fillable.length > 0 && (
        <button
          onClick={() => onLogAll(fillable)}
          disabled={bulkLogging}
          className="mt-3 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl text-xs font-semibold active:opacity-80 transition-opacity disabled:opacity-60"
          style={{ backgroundColor: brandTint(22), color: BRAND }}
        >
          {bulkLogging
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Logging…</>
            : <>
                <CheckCheck className="w-3.5 h-3.5" />
                {logDate === today
                  ? `Log the ${fillable.length} ${fillable.length === 1 ? 'meal' : 'meals'} so far`
                  : `Log all ${fillable.length} ${fillable.length === 1 ? 'meal' : 'meals'}`}
              </>}
        </button>
      )}

      <button
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        className="mt-3 w-full min-h-[44px] flex items-center justify-between rounded-xl bg-muted/50 px-3 text-xs font-semibold active:bg-muted/30 transition-colors"
      >
        <span>{expanded ? 'Hide meals' : `Show ${variant.meals.length} meals`}</span>
        <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <>
          <ul className="mt-2 divide-y divide-border/50">
            {variant.meals.map(meal => (
              <PlanMealRow
                key={meal.id}
                meal={meal}
                accent={BRAND}
                logging={loggingPosition === meal.position}
                busyLogging={loggingPosition != null || bulkLogging === true}
                logged={loggedPositions?.has(meal.position) ?? false}
                declined={declinedMealIds?.has(meal.id) ?? false}
                onLog={onLogMeal}
                onSetDeclined={onSetDeclined}
                onSave={onSaveMeal}
                saving={savingPositions?.has(meal.position) ?? false}
              />
            ))}
          </ul>

          {/* One action for the whole plan, because the point of Q-398 is that the plan is a batch
              generator — saving nine meals one at a time is the thing it exists to avoid. Hidden
              once every meal is kept, rather than sitting there doing nothing. */}
          {onSaveAllMeals && unsaved.length > 0 && (
            <button
              onClick={() => onSaveAllMeals(unsaved)}
              disabled={busySaving}
              className="mt-2 w-full min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-muted/50 text-xs font-semibold active:bg-muted/30 transition-colors disabled:opacity-60"
            >
              {busySaving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                : <><BookmarkPlus className="w-3.5 h-3.5" /> Save all {unsaved.length} to My Meals</>}
            </button>
          )}
        </>
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
