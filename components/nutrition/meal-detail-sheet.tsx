'use client'

import { useRef } from 'react'
import { ChevronLeft, Loader2, Pencil, QrCode, Trash2, Utensils } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { MACRO_COLORS } from '@trainingai/shared/nutrition/macro-colors'
import { macroKcal, macroShares } from './macro-energy'
import { batchRows, portionRows, sumRows } from './saved-meal-totals'
import type { SavedMeal } from '@trainingai/shared/types/nutrition'

interface Props {
  meal: SavedMeal | null
  logging: boolean
  /**
   * Controlled, not local, because the list's swipe tray opens this sheet *into* the confirmation —
   * a drag is one thumb-flick from a scroll, so it must not delete outright, and routing it here
   * keeps one confirmation UI rather than a second copy on the row.
   */
  confirmingDelete: boolean
  onConfirmingDeleteChange: (confirming: boolean) => void
  onOpenChange: (open: boolean) => void
  onLog: (meal: SavedMeal) => void
  onEdit: (meal: SavedMeal) => void
  onDelete: (meal: SavedMeal) => void
  onLabel: (meal: SavedMeal) => void
}

/**
 * One saved meal, in full (BF-30 — artboard 4).
 *
 * **This is a nested sheet, not a route and not a row expansion**, which is the decision BF-30 asked
 * for. A route would have to dismiss the library sheet to navigate and re-open it on the way back;
 * stacked sheets are what this app already does — `MealLabelSheet` opens from this same list, and
 * `back-dismiss.tsx` makes one back press close one layer. And the content is a screen's worth: a
 * hero, three macro columns, the ingredient list and an action row do not fit inside a row of a list
 * whose whole point (BF-29) is being scannable.
 *
 * **The two figures are deliberately different scopes, and both are labelled.** The headline number
 * and the macro columns are **per portion** — that is what `Log this meal` writes. The ingredient
 * list is the **whole batch**, because that is the recipe you cook. Artboard 4 draws exactly this
 * split; it is not an inconsistency waiting to be tidied.
 */
export function MealDetailSheet({
  meal, logging, confirmingDelete, onConfirmingDeleteChange, onOpenChange, onLog, onEdit, onDelete, onLabel,
}: Props) {
  /**
   * The sheet is never torn out mid-open — `open` is controlled and the last meal is held through
   * the close.
   *
   * Returning `null` when `meal` goes null took the **library sheet** down with this one: `Edit`
   * closes this layer and opens the builder in the layer underneath, and both vanished. Unmounting
   * skips Radix's close path and strands the history entry `back-dismiss.tsx` pushed. Radix's
   * `Portal` already gates the inner tree on `open`, so keeping the element mounted costs nothing.
   */
  const lastMeal = useRef<SavedMeal | null>(null)
  if (meal) lastMeal.current = meal
  const shown = meal ?? lastMeal.current

  const servings = shown && shown.servings > 0 ? shown.servings : 1
  const portion = sumRows(shown ? portionRows(shown) : [])
  const batch = shown ? batchRows(shown) : []
  const shares = macroShares(portion)
  const energy = macroKcal(portion).total

  const macros = [
    { key: 'protein', label: 'Protein', grams: portion.proteinG, share: shares.protein, color: MACRO_COLORS.protein },
    { key: 'carbs', label: 'Carbs', grams: portion.carbsG, share: shares.carbs, color: MACRO_COLORS.carbs },
    { key: 'fat', label: 'Fat', grams: portion.fatG, share: shares.fat, color: MACRO_COLORS.fat },
  ]

  function close() {
    onConfirmingDeleteChange(false)
    onOpenChange(false)
  }

  return (
    <Sheet open={meal !== null} onOpenChange={o => { if (!o) close() }}>
      {/* Nothing has ever been opened yet — the very first render, before any row is tapped. */}
      {shown && (
      <SheetContent side="bottom" className="flex h-[92vh] flex-col" hideCloseButton>
        <SheetHeader className="shrink-0 px-1 pb-0">
          <div className="flex items-center gap-2">
            <button onClick={close} aria-label="Back" className="-ml-1.5 rounded-lg p-2.5 text-muted-foreground">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-left">{shown.name}</SheetTitle>
              <p className="truncate text-left text-xs tabular-nums text-muted-foreground">
                {servings === 1 ? 'One portion' : `Makes ${servings} portions`} · {batch.length}{' '}
                ingredient{batch.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1">
          {/* The hero. A meal with a photo shows it; one without gets the affordance that says where
              photos come from — the builder, which already owns the picker and the size cap (Q-327).
              A second picker here would be a second write path to the same column. */}
          {shown.imageDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.imageDataUri} alt="" className="mb-4 h-40 w-full rounded-2xl object-cover" />
          ) : (
            // The same tile the rows use, at hero scale — artboard 4's band is the row's placeholder
            // grown, not a second design. It is a button because it is also where a photo is added.
            <button
              onClick={() => onEdit(shown)}
              className="mb-4 flex w-full flex-col items-center gap-2 rounded-2xl py-5"
              style={{ backgroundImage: 'linear-gradient(140deg, var(--meal-tile-from), var(--meal-tile-to))' }}
              aria-label={`Add a photo to ${shown.name}`}
            >
              {/* The glyph directly, not a nested `MealThumb` — the band already carries the
                  gradient, and the tile's own is an inline style a class cannot strip. */}
              <Utensils className="h-8 w-8 text-white/45" strokeWidth={1.6} />
              <span className="text-xs font-semibold text-white/70">Add a photo</span>
            </button>
          )}

          <div className="mb-4 text-center">
            <p className="text-4xl font-bold tabular-nums leading-none">{Math.round(portion.calories)}</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              per portion
            </p>
          </div>

          {energy > 0 && (
            <div className="mb-5 grid grid-cols-3 gap-2">
              {macros.map(m => (
                <div key={m.key} className="rounded-xl bg-muted/50 py-3 text-center">
                  {/* The percentage is share of the calories the macros account for — `macroShares`,
                      which is the one Atwater conversion (LB-9). Never `* 4` / `* 9` here. */}
                  <p className="text-sm font-bold tabular-nums" style={{ color: m.color }}>
                    {Math.round(m.share * 100)}%
                  </p>
                  <p className="text-sm font-semibold tabular-nums">
                    {Math.round(m.grams * 10) / 10} g
                  </p>
                  <p className="text-[11px] text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="mb-2 flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              Ingredients
            </p>
            {servings !== 1 && (
              <p className="text-[11px] text-muted-foreground">whole batch</p>
            )}
          </div>
          {batch.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">This meal has no ingredients saved.</p>
          ) : (
            <div className="divide-y divide-border/50 overflow-hidden rounded-2xl border border-border">
              {batch.map(r => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-snug">{r.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {r.weightG > 0 ? `${Math.round(r.weightG)} g` : '—'}
                      {r.weightG > 0 && r.servings !== 1 && ` · ${Math.round(r.servings * 10) / 10} servings`}
                    </span>
                  </span>
                  <span className="w-16 flex-none text-right text-sm font-semibold tabular-nums">
                    {Math.round(r.calories)}
                    <i className="ml-0.5 text-[10px] font-normal not-italic text-muted-foreground">kcal</i>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {confirmingDelete ? (
          <div className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-4 py-3">
            <p className="text-xs font-medium">Delete “{shown.name}”?</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
              Meals you have already logged keep their food. Any meal plan built from this one keeps
              its own copy.
            </p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" size="sm" className="min-h-[44px] flex-1" onClick={() => onConfirmingDeleteChange(false)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" className="min-h-[44px] flex-1" onClick={() => onDelete(shown)}>
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2 pt-2">
            <Button onClick={() => onLog(shown)} disabled={logging} className="h-12 flex-1 gap-1.5 font-semibold">
              {logging && <Loader2 className="h-4 w-4 animate-spin" />}
              Log this meal
            </Button>
            <Button
              variant="secondary" className="h-12 min-w-[48px] px-3"
              onClick={() => onLabel(shown)} aria-label={`Print a label for ${shown.name}`}
            >
              <QrCode className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary" className="h-12 min-w-[48px] px-3"
              onClick={() => onEdit(shown)} aria-label={`Edit ${shown.name}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            {/* Artboard 4 puts delete behind an overflow in the hero. This app has no dropdown-menu
                primitive and inventing one for a single call site is a worse trade than a third
                button — the row is still under the 48 dp floor for all four. */}
            <Button
              variant="secondary" className="h-12 min-w-[48px] px-3"
              onClick={() => onConfirmingDeleteChange(true)} aria-label={`Delete ${shown.name}`}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </SheetContent>
      )}
    </Sheet>
  )
}
