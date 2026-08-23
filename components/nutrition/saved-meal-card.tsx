'use client'

import { memo, useState } from 'react'
import { ChevronDown, Check, Loader2, Pencil, QrCode, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@trainingai/shared/utils'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'
import { oneServingItems } from '@trainingai/shared/nutrition/saved-meal-ingredients'

interface Props {
  meal: SavedMeal
  logging: boolean
  /** Non-null puts the card in selection mode; the whole card then toggles instead of expanding. */
  selected: boolean | null
  onToggleSelected: () => void
  onLog: () => void
  onEdit: () => void
  onDelete: () => void
  onLabel: () => void
  /** This meal was copied from the meal plan (Q-398) — provenance, derived by join, never stored. */
  fromPlan?: boolean
}

/**
 * One saved meal, with its ingredients broken down.
 *
 * The old row showed a name, a totals line, and ingredient names with a bare "×1" multiplier — the
 * multiplier being the only number, and the least useful one, since it says nothing about how much
 * food that actually is. Every ingredient now carries its weight and its own macros, because the
 * library is what meal plans get built from and "is this the 30 g or the 60 g scoop" is the
 * question people actually have.
 *
 * Delete is confirmed inline. It used to fire on the first tap of a small icon sitting between two
 * other small icons, and the only feedback was a toast after the fact.
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
  // like a third of what it contributes.
  const energy = totals.proteinG * 4 + totals.carbsG * 4 + totals.fatG * 9
  const pct = (kcal: number) => energy > 0 ? (kcal / energy) * 100 : 0
  const selecting = selected !== null

  return (
    <div className={cn(
      'rounded-2xl border bg-card overflow-hidden transition-colors',
      selected ? 'border-brand/60 bg-brand/5' : 'border-border/50',
    )}>
      {/* A card containing other controls is a div with role=button, never a nested <button> —
          Samsung's WebView strips the inner one. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={selecting ? undefined : expanded}
        aria-pressed={selecting ? selected : undefined}
        onClick={() => selecting ? onToggleSelected() : setExpanded(v => !v)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            selecting ? onToggleSelected() : setExpanded(v => !v)
          }
        }}
        className="w-full px-4 py-3 text-left active:bg-muted/20 transition-colors"
      >
        <div className="flex items-start gap-3">
          {selecting && (
            <span className={cn(
              'mt-0.5 flex-none w-5 h-5 grid place-items-center rounded-md border',
              selected ? 'border-brand bg-brand' : 'border-border',
            )}>
              {selected && <Check className="w-3.5 h-3.5 text-black" />}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {meal.name}
              {/* A word, not a coloured dot: provenance has to survive the colour-only-state rule
                  and a monochrome screenshot alike. */}
              {fromPlan && (
                <span className="ml-1.5 align-middle rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                  From plan
                </span>
              )}
            </p>
            {servings !== 1 && (
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Makes {servings} portions
              </p>
            )}
            <div className="mt-1 flex items-center gap-2">
              {/* The calorie figure is the one number people scan this list for, so it gets to look
                  like a value rather than another item in a dot-separated run-on. */}
              <span className="rounded-full bg-foreground px-2.5 py-1 text-xs font-bold tabular-nums text-background">
                {Math.round(totals.calories).toLocaleString()} kcal
              </span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {totals.weightG > 0 && `${Math.round(totals.weightG)} g · `}
                {rows.length} item{rows.length !== 1 ? 's' : ''}
                {servings !== 1 && ' · per portion'}
              </span>
            </div>
          </div>
          {!selecting && (
            <ChevronDown className={cn(
              'w-4 h-4 flex-none mt-0.5 text-muted-foreground transition-transform',
              expanded && 'rotate-180',
            )} />
          )}
        </div>

        {/* Macro split, with the numbers beside it — the bar alone would be colour-only state. */}
        {energy > 0 && (
          <>
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
              <span style={{ width: `${pct(totals.proteinG * 4)}%`, backgroundColor: MACRO_COLORS.protein }} />
              <span style={{ width: `${pct(totals.carbsG * 4)}%`, backgroundColor: MACRO_COLORS.carbs }} />
              <span style={{ width: `${pct(totals.fatG * 9)}%`, backgroundColor: MACRO_COLORS.fat }} />
            </div>
            <div className="mt-1.5 flex gap-3 text-[11px] font-semibold tabular-nums">
              <span style={{ color: MACRO_COLORS.protein }}>P {Math.round(totals.proteinG)}g</span>
              <span style={{ color: MACRO_COLORS.carbs }}>C {Math.round(totals.carbsG)}g</span>
              <span style={{ color: MACRO_COLORS.fat }}>F {Math.round(totals.fatG)}g</span>
            </div>
          </>
        )}
      </div>

      {expanded && !selecting && (
        <div className="border-t border-border/30 px-4 py-2">
          {rows.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">This meal has no ingredients saved.</p>
          ) : (
            <ul className="divide-y divide-border/20">
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

      {!selecting && (
        confirmingDelete ? (
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
              <Button variant="destructive" size="sm" className="flex-1 min-h-[44px]" onClick={onDelete}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2">
            <Button
              onClick={onLog}
              disabled={logging}
              size="sm"
              className="flex-1 min-h-[44px] gap-1.5"
            >
              {logging && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Log this meal
            </Button>
            <Button
              variant="secondary" size="sm" className="min-h-[44px] min-w-[44px] px-3"
              onClick={onLabel} aria-label={`Print a label for ${meal.name}`}
            >
              <QrCode className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="secondary" size="sm" className="min-h-[44px] min-w-[44px] px-3"
              onClick={onEdit} aria-label={`Edit ${meal.name}`}
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
        )
      )}
    </div>
  )
})
