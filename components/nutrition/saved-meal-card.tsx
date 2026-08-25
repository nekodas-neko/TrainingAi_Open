'use client'

import { memo, useMemo, useState } from 'react'
import { ChevronDown, Check, Loader2, Pencil, QrCode, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SwipeActions, type SwipeAction } from '@/components/ui/swipe-actions'
import { cn } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { macroKcal, macroShares } from './macro-energy'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { oneServingItems } from '@trainingai/shared/nutrition/saved-meal-ingredients'

interface Props {
  meal: SavedMeal
  logging: boolean
  /** Non-null puts the card in selection mode; the whole card then toggles instead of expanding. */
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
  onLog: (meal: SavedMeal) => void
  onEdit: (meal: SavedMeal) => void
  onDelete: (meal: SavedMeal) => void
  onLabel: (meal: SavedMeal) => void
  /** This meal was copied from the meal plan (Q-398) — provenance, derived by join, never stored. */
  fromPlan?: boolean
}

/**
 * One saved meal: a scannable row that opens to its ingredients (BF-29, artboard 3).
 *
 * The collapsed row is `name · "5 items · makes 2 portions" · calories · chevron` — the shape
 * `food-row.tsx` settled on, so a list of meals lines up down its right edge the way a list of
 * foods does. It is not the literal `FoodRow`: that takes scalar props by design (Q-490), and the
 * two things this row has beyond it — the "From plan" badge and an expanded/collapsed state —
 * would have to arrive as a `ReactNode` and defeat its `memo()` for every other caller.
 *
 * **Every number shown collapsed is per portion**, which is what "Log this meal" writes; the
 * footnote on the list says so, because a row reading 208 for a tub that holds 416 is otherwise a
 * lie the list cannot correct.
 *
 * Label, edit and delete are reached by swiping the row left. That gesture is an accelerator, not
 * the only route — the same three sit in the expanded panel, because a touch-only product cannot
 * put delete behind a drag and nothing else.
 */
export const SavedMealCard = memo(function SavedMealCard({
  meal, logging, selected, onToggleSelected, onLog, onEdit, onDelete, onLabel, fromPlan,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // A batch recipe shows ONE portion — that is what "Log this meal" writes and what a meal plan
  // takes, so showing the whole tub's macros beside a button that logs half of it would be a lie.
  const servings = meal.servings > 0 ? meal.servings : 1
  const rows = oneServingItems(meal).map(item => {
    const q = item.quantityMultiplier
    const f = item.foodItem
    return {
      id: item.id,
      name: f?.brand ? `${f.brand} ${f.name}` : f?.name ?? 'Unknown item',
      weightG: (f?.servingSizeG ?? 0) * q,
      calories: (f?.calories ?? 0) * q,
      proteinG: (f?.proteinG ?? 0) * q,
      carbsG: (f?.carbsG ?? 0) * q,
      fatG: (f?.fatG ?? 0) * q,
    }
  })

  const totals = rows.reduce((a, r) => ({
    weightG: a.weightG + r.weightG,
    calories: a.calories + r.calories,
    proteinG: a.proteinG + r.proteinG,
    carbsG: a.carbsG + r.carbsG,
    fatG: a.fatG + r.fatG,
  }), { weightG: 0, calories: 0, proteinG: 0, carbsG: 0, fatG: 0 })

  // Energy share per macro, which is what a split bar should show — grams would make fat look
  // like a third of what it contributes. The Atwater factors come from `macro-energy.ts`; this
  // wrote them out longhand and was one of the copies that module exists to end.
  const energy = macroKcal(totals).total
  const shares = macroShares(totals)
  const selecting = selected !== null

  // Artboard 3's grey line: how many things are in it, then either the batch size or the weight.
  const itemCount = `${rows.length} item${rows.length !== 1 ? 's' : ''}`
  const secondary = servings !== 1
    ? `${itemCount} · makes ${servings} portions`
    : totals.weightG > 0 ? `${itemCount} · ${Math.round(totals.weightG)} g` : itemCount

  // The tray is remade only when an action's identity changes, so a drag is not fighting a fresh
  // array on every parent render.
  const swipeActions = useMemo<SwipeAction[]>(() => [
    { key: 'label', label: 'Label', icon: <QrCode className="h-4 w-4" />, onPress: () => onLabel(meal) },
    { key: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" />, onPress: () => onEdit(meal) },
    { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onPress: () => setConfirmingDelete(true), destructive: true },
  ], [meal, onLabel, onEdit])

  const toggle = () => selecting ? onToggleSelected(meal) : setExpanded(v => !v)

  const row = (
    /* A card containing other controls is a div with role=button, never a nested <button> —
       Samsung's WebView strips the inner one. The collapsed row holds no controls of its own, but
       selection mode puts a checkbox in it, so the shape stays constant. */
    <div
      role="button"
      tabIndex={0}
      aria-expanded={selecting ? undefined : expanded}
      aria-pressed={selecting ? selected : undefined}
      onClick={toggle}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() }
      }}
      className="flex w-full items-center gap-3 px-4 py-3 text-left min-h-12 transition-colors active:bg-muted/20"
    >
      {selecting && (
        <span className={cn(
          'flex-none w-5 h-5 grid place-items-center rounded-md border',
          selected ? 'border-brand bg-brand' : 'border-border',
        )}>
          {selected && <Check className="w-3.5 h-3.5 text-black" />}
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
        {Math.round(totals.calories).toLocaleString()}
        <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>
      </span>
      {!selecting && (
        <ChevronDown className={cn(
          'w-4 h-4 flex-none text-muted-foreground transition-transform',
          expanded && 'rotate-180',
        )} />
      )}
    </div>
  )

  return (
    <div className="bg-card">
      {/* Selection mode owns the horizontal axis for nothing, but a row being ticked should not
          also slide away under the thumb — so the tray is not mounted at all while selecting. */}
      {selecting ? row : (
        <SwipeActions actions={swipeActions} itemLabel={meal.name}>{row}</SwipeActions>
      )}

      {expanded && !selecting && (
        <div className="border-t border-border/30 px-4 py-2">
          {/* Macro split, with the numbers beside it — the bar alone would be colour-only state. */}
          {energy > 0 && (
            <>
              <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                <span style={{ width: `${shares.protein * 100}%`, backgroundColor: MACRO_COLORS.protein }} />
                <span style={{ width: `${shares.carbs * 100}%`, backgroundColor: MACRO_COLORS.carbs }} />
                <span style={{ width: `${shares.fat * 100}%`, backgroundColor: MACRO_COLORS.fat }} />
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px] font-semibold tabular-nums">
                <span style={{ color: MACRO_COLORS.protein }}>P {Math.round(totals.proteinG)}g</span>
                <span style={{ color: MACRO_COLORS.carbs }}>C {Math.round(totals.carbsG)}g</span>
                <span style={{ color: MACRO_COLORS.fat }}>F {Math.round(totals.fatG)}g</span>
              </div>
            </>
          )}
          {rows.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">This meal has no ingredients saved.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border/20">
              {rows.map(r => (
                <li key={r.id} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs">{r.name}</span>
                    <span className="flex-none text-[11px] tabular-nums text-muted-foreground">
                      {r.weightG > 0 ? `${Math.round(r.weightG)} g` : '—'} · {Math.round(r.calories)} kcal
                    </span>
                  </div>
                  <div className="mt-0.5 flex gap-3 text-[10px] tabular-nums text-muted-foreground">
                    <span>P {Math.round(r.proteinG * 10) / 10}g</span>
                    <span>C {Math.round(r.carbsG * 10) / 10}g</span>
                    <span>F {Math.round(r.fatG * 10) / 10}g</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Delete is confirmed inline. It used to fire on the first tap of a small icon sitting
          between two other small icons, and the only feedback was a toast after the fact. The
          swipe tray raises the same confirmation rather than deleting outright. */}
      {!selecting && confirmingDelete && (
        <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-xs font-medium">Delete “{meal.name}”?</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
            Meals you have already logged keep their food. Any meal plan built from this one keeps
            its own copy.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1 min-h-[44px]" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" className="flex-1 min-h-[44px]" onClick={() => onDelete(meal)}>
              Delete
            </Button>
          </div>
        </div>
      )}

      {expanded && !selecting && !confirmingDelete && (
        <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2">
          <Button
            onClick={() => onLog(meal)}
            disabled={logging}
            size="sm"
            className="flex-1 min-h-[44px] gap-1.5"
          >
            {logging && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Log this meal
          </Button>
          <Button
            variant="secondary" size="sm" className="min-h-[44px] min-w-[44px] px-3"
            onClick={() => onLabel(meal)} aria-label={`Print a label for ${meal.name}`}
          >
            <QrCode className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="secondary" size="sm" className="min-h-[44px] min-w-[44px] px-3"
            onClick={() => onEdit(meal)} aria-label={`Edit ${meal.name}`}
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="secondary" size="sm" className="min-h-[44px] min-w-[44px] px-3"
            onClick={() => setConfirmingDelete(true)} aria-label={`Delete ${meal.name}`}
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      )}
    </div>
  )
})
