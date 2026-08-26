'use client'

import { memo, useCallback, useState } from 'react'
import { Check, Loader2, UtensilsCrossed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'

export interface RecipeCandidate {
  name: string
  ingredients: NutritionIngredient[]
}

interface Props {
  candidates: RecipeCandidate[]
  saving: boolean
  onCancel: () => void
  /** Every candidate the user kept. Each becomes its own saved meal. */
  onKeep: (kept: RecipeCandidate[]) => void
}

/**
 * A page that turned out to hold several dishes (BF-11c §5.2).
 *
 * `/api/nutrition/scan` returns `candidates`, and its prompt is explicit that separate portions are
 * separate candidates — five meal-prep containers of the same chicken and rice are five, and a page
 * listing four recipes is four. Filling the builder from `candidates[0]` and dropping the rest would
 * silently discard three of them.
 *
 * **Each kept candidate becomes its OWN saved meal**, which is what "create a meal from each item"
 * means. They are not merged into the meal being built: a page of four dinners is four recipes you
 * can log separately, and combining them would produce one meal nobody eats.
 *
 * **This does not reuse `food-row.tsx`, deliberately.** That row's trailing element is a chevron and
 * an optional calorie column; a candidate needs a keep/discard control, which is a trailing
 * *control* rather than a value. Q-406 records that adding per-row control slots is what turns the
 * shared row into a wrapper rather than a unification — the owner's one concession there was a
 * single optional string, not a node. So the candidate list is drawn here, and the shared row keeps
 * its shape.
 */
export function RecipeCandidates({ candidates, saving, onCancel, onKeep }: Props) {
  // Everything starts kept: the user asked to import this page, so discarding is the exception.
  const [dropped, setDropped] = useState<Set<number>>(new Set())

  const toggle = useCallback((index: number) => {
    setDropped(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  const keptCount = candidates.length - dropped.size

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">That page had {candidates.length} dishes</p>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Each one you keep is saved as its own meal, so you can log them separately. Tap a dish to
          leave it out.
        </p>
      </div>

      <div className="divide-y divide-border/40 overflow-hidden rounded-2xl border border-border">
        {candidates.map((c, i) => (
          <CandidateRow
            key={`${c.name}-${i}`}
            index={i}
            name={c.name}
            itemCount={c.ingredients.length}
            calories={Math.round(sumIngredients(c.ingredients).calories)}
            kept={!dropped.has(i)}
            onToggle={toggle}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Button variant="secondary" className="min-h-12 flex-1" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          className="min-h-12 flex-1 gap-1.5"
          disabled={keptCount === 0 || saving}
          onClick={() => onKeep(candidates.filter((_, i) => !dropped.has(i)))}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : keptCount === 1 ? 'Save 1 meal' : `Save ${keptCount} meals`}
        </Button>
      </div>
    </div>
  )
}

/**
 * Scalar props and a memo, because the list re-renders on every toggle — `meal-macro-bars.tsx` is
 * the reference this repo keeps for exactly that reason (Q-490).
 *
 * The kept state is a tick AND the row's opacity, never colour alone.
 */
const CandidateRow = memo(function CandidateRow({
  index, name, itemCount, calories, kept, onToggle,
}: {
  index: number
  name: string
  itemCount: number
  calories: number
  kept: boolean
  onToggle: (index: number) => void
}) {
  const press = useCallback(() => onToggle(index), [index, onToggle])
  return (
    <button
      type="button"
      onClick={press}
      aria-pressed={kept}
      className={`flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/40${kept ? '' : ' opacity-45'}`}
    >
      <span
        className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border ${kept ? 'border-brand bg-brand/15' : 'border-border'}`}
      >
        {kept && <Check className="h-3.5 w-3.5 text-brand" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-snug">{name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {itemCount} ingredient{itemCount === 1 ? '' : 's'}
          {kept ? '' : ' · left out'}
        </span>
      </span>
      <span className="w-16 flex-none text-right text-sm font-semibold tabular-nums">
        {calories}
        <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>
      </span>
      <UtensilsCrossed className="h-4 w-4 flex-none text-muted-foreground" />
    </button>
  )
})
