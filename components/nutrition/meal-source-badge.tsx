'use client'

import { memo } from 'react'
import { BookOpen, Sparkles } from 'lucide-react'
import type { DraftMeal } from './meal-plan-draft'

interface Props {
  source: DraftMeal['source']
  matchReason: string | null
  /** The pre-BF-11g fallback: a draft with no `source` still knows whether it holds a saved meal. */
  hasSavedMeal: boolean
}

/**
 * Where this slot's food came from, and why (BF-11h, design items 10 and 11).
 *
 * **`kept` and `library` are different answers and must not share a badge.** Both carry a
 * `savedMealId`, so the original check — `savedMealId != null` → "Yours — kept" — started calling
 * a meal the planner *chose* one the user had *pinned* the moment BF-11g shipped the library pass.
 * You would read it as your own decision and never question the fit.
 *
 * The AI case is the one worth the space: `matchReason` is non-null there **only when the library
 * was actually searched**, so this can say "nothing of yours fitted this slot" without ever
 * implying a search that did not happen. A null reason renders nothing at all.
 */
export const MealSourceBadge = memo(function MealSourceBadge({ source, matchReason, hasSavedMeal }: Props) {
  const resolved = source ?? (hasSavedMeal ? 'kept' : undefined)

  if (resolved === 'kept') {
    return (
      // Without this a kept meal is indistinguishable from a suggestion, and the reroll button sits
      // on it identically — you would replace your own food by accident.
      <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
        <BookOpen className="w-3 h-3" /> Yours — kept
      </p>
    )
  }

  if (resolved === 'library') {
    return (
      <>
        <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
          <BookOpen className="w-3 h-3" /> Yours — chosen for this slot
        </p>
        {matchReason && (
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{matchReason}</p>
        )}
      </>
    )
  }

  // An AI slot with a reason means the library WAS searched and had nothing — worth saying, because
  // it is the difference between "the planner ignored my meals" and "none of them fitted here".
  if (matchReason) {
    return (
      <p className="mt-0.5 inline-flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
        <Sparkles className="mt-0.5 w-3 h-3 flex-none" />
        <span>{matchReason}</span>
      </p>
    )
  }

  return null
})
