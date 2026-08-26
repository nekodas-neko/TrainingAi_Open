'use client'

import { memo, useMemo } from 'react'
import { ChevronRight, Check, Pencil, QrCode, Trash2 } from 'lucide-react'
import { SwipeActions, type SwipeAction } from '@/components/ui/swipe-actions'
import { cn } from '@trainingai/shared/utils'
import { portionRows, sumRows } from './saved-meal-totals'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

interface Props {
  meal: SavedMeal
  /** Non-null puts the row in selection mode; it then toggles instead of opening the meal. */
  selected: boolean | null
  /**
   * Each takes the meal (Q-357). A parameterless callback forces the CALL SITE to close over the
   * row — five inline arrows per card, inside `visibleMeals.map(...)`, so every render of the sheet
   * gave all five a new identity and re-rendered every card despite the `memo()`. The card already
   * holds `meal`; handing it back lets the parent pass one stable `useCallback` per action, shared
   * by every card. This is the "move the identity into the child" half of the memo rule, and it is
   * the shape the mutation-callback contract asks for anyway.
   */
  onToggleSelected: (meal: SavedMeal) => void
  /** Opens the meal's own screen (BF-30) — where logging, the macros and the ingredients live. */
  onOpen: (meal: SavedMeal) => void
  onEdit: (meal: SavedMeal) => void
  /** Asks for the delete; it is confirmed inside the meal, never straight off a drag. */
  onRequestDelete: (meal: SavedMeal) => void
  onLabel: (meal: SavedMeal) => void
  /** This meal was copied from the meal plan (Q-398) — provenance, derived by join, never stored. */
  fromPlan?: boolean
}

/**
 * One saved meal, as one row of a list (BF-29 artboard 3; BF-30 moved the detail out).
 *
 * The row is `name · "5 items · makes 2 portions" · calories · chevron` — the shape `food-row.tsx`
 * settled on, so a list of meals lines up down its right edge the way a list of foods does. It is
 * not the literal `FoodRow`: that takes scalar props by design (Q-490), and the "From plan" badge
 * would have to arrive as a `ReactNode` and defeat its `memo()` for every other caller.
 *
 * **The calorie figure is one portion**, which is what "Log this meal" writes; the list's footnote
 * says so, because a row reading 208 for a tub that holds 416 is otherwise a lie the list cannot
 * correct.
 *
 * **The chevron points right because the row now navigates.** It opens `meal-detail-sheet.tsx`,
 * which holds the macros, the ingredients and every action. BF-29 shipped this as an in-place
 * expansion with a rotating `ChevronDown` because that detail surface did not exist yet; the glyph
 * followed the behaviour then and follows it now.
 *
 * Label, edit and delete are also reachable by swiping the row left. That gesture is an accelerator
 * and nothing more — each one is a tap away inside the meal, so a thumb that never discovers the
 * drag loses nothing.
 */
export const SavedMealCard = memo(function SavedMealCard({
  meal, selected, onToggleSelected, onOpen, onEdit, onRequestDelete, onLabel, fromPlan,
}: Props) {
  const portion = sumRows(portionRows(meal))
  const itemCount = portionRows(meal).length
  const servings = meal.servings > 0 ? meal.servings : 1
  const selecting = selected !== null

  // Artboard 3's grey line: how many things are in it, then either the batch size or the weight.
  const items = `${itemCount} item${itemCount !== 1 ? 's' : ''}`
  const secondary = servings !== 1
    ? `${items} · makes ${servings} portions`
    : portion.weightG > 0 ? `${items} · ${Math.round(portion.weightG)} g` : items

  // The tray is remade only when an action's identity changes, so a drag is not fighting a fresh
  // array on every parent render.
  const swipeActions = useMemo<SwipeAction[]>(() => [
    { key: 'label', label: 'Label', icon: <QrCode className="h-4 w-4" />, onPress: () => onLabel(meal) },
    { key: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" />, onPress: () => onEdit(meal) },
    { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onPress: () => onRequestDelete(meal), destructive: true },
  ], [meal, onLabel, onEdit, onRequestDelete])

  const activate = () => selecting ? onToggleSelected(meal) : onOpen(meal)

  const row = (
    /* A row containing another control is a div with role=button, never a nested <button> —
       Samsung's WebView strips the inner one, and selection mode puts a checkbox in here. */
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected : undefined}
      onClick={activate}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate() }
      }}
      className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted/20"
    >
      {selecting && (
        <span className={cn(
          'grid h-5 w-5 flex-none place-items-center rounded-md border',
          selected ? 'border-brand bg-brand' : 'border-border',
        )}>
          {selected && <Check className="h-3.5 w-3.5 text-black" />}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-snug">
          {meal.name}
          {/* A word, not a coloured dot: provenance has to survive the colour-only-state rule
              and a monochrome screenshot alike. */}
          {fromPlan && (
            <span className="ml-1.5 align-middle rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              From plan
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
      </span>
      <span className="w-16 flex-none text-right text-sm font-semibold tabular-nums">
        {Math.round(portion.calories).toLocaleString()}
        <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>
      </span>
      {!selecting && <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />}
    </div>
  )

  // A row being ticked should not also slide away under the thumb, so the tray is not mounted at
  // all while selecting.
  return selecting ? <div className="bg-card">{row}</div> : (
    <SwipeActions actions={swipeActions} itemLabel={meal.name}>{row}</SwipeActions>
  )
})
