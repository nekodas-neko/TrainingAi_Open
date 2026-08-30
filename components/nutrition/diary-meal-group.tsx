'use client'

import { memo, useCallback, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { MealThumb } from './meal-thumb'

interface Props {
  name: string
  imageDataUri: string | null
  /** How many foods the meal put in the diary — the line under its name. */
  itemCount: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  /** The ingredient rows, rendered by the caller so this stays a header and a container. */
  children: React.ReactNode
}

/**
 * A logged meal, as one diary row that opens to its ingredients (BF-39).
 *
 * The owner, three times: *"when I add a meal from ai; it breaks it down into its components and
 * floods the list. we need to be able to create an over arching food and have the ingredients and
 * macro break down inside of it."* A screenshot showed one breakfast as eight rows.
 *
 * **Collapsed by default, and that is the point** — the flood is what was reported. Both halves the
 * re-report asks for are here: the parent carries the meal's name, its photo and its totals; the
 * expansion carries the ingredients and their own rows, each still editable and deletable, because
 * a single opaque row that loses the breakdown was explicitly not what was asked for.
 *
 * **Scalar props.** It renders inside `.map()` where a call site cannot memoise an object, and one
 * would defeat `memo` silently (Q-490). `children` is the exception a container cannot avoid; the
 * caller memoises the rows it puts here.
 */
export const DiaryMealGroup = memo(function DiaryMealGroup({
  name, imageDataUri, itemCount, calories, proteinG, carbsG, fatG, children,
}: Props) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen(o => !o), [])

  return (
    <div>
      {/* A row containing nothing else, but kept a div with role=button for the same reason the
          rest of this screen is: the WebView strips a nested control, and a group header is one
          feature away from carrying one. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-muted/20"
      >
        <MealThumb src={imageDataUri} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-snug">{name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {itemCount} ingredient{itemCount === 1 ? '' : 's'}
          </span>
        </span>
        <span className="w-16 flex-none text-right text-sm font-semibold tabular-nums">
          {Math.round(calories).toLocaleString()}
          <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>
        </span>
        <ChevronDown className={`h-4 w-4 flex-none text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <div className="border-t border-border/20 bg-muted/20">
          {children}
          {/* The macro split of the meal, under its own rows. Colour paired with the letter, which
              is what keeps it off being state carried by colour alone. */}
          <div className="flex items-center gap-3 px-4 py-2">
            <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.protein }}>P {Math.round(proteinG)}g</span>
            <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.carbs }}>C {Math.round(carbsG)}g</span>
            <span className="text-xs font-semibold" style={{ color: MACRO_COLORS.fat }}>F {Math.round(fatG)}g</span>
          </div>
        </div>
      )}
    </div>
  )
})
