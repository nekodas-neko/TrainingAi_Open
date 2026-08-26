'use client'

import { useEffect, useState } from 'react'
import { Check, Link2, Loader2, Plus, X } from 'lucide-react'
import { cn } from '@trainingai/shared/utils'
import { Button } from '@/components/ui/button'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { perServing, sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import type { SavedMeal, NutritionIngredient } from '@trainingai/shared/types/nutrition'

/**
 * A meal the user typed rather than picked.
 *
 * `ingredients` arrives from the same text→nutrition estimate the food scan uses. Until it does,
 * the entry is only a steer; once it does, the meal has real macros and can be kept verbatim like
 * a library meal. `looking` and `failed` are what let the UI say which of those it currently is
 * instead of silently implying macros it does not have.
 */
export interface TypedMeal {
  text: string
  name: string
  ingredients: NutritionIngredient[]
  looking: boolean
  failed: boolean
  /** Only a resolved meal can be kept exactly; an unresolved one still steers the generator. */
  keep: boolean
  /** Where a recipe came from, when it came from a URL — attribution, and a reminder six months on. */
  sourceUrl?: string
  /**
   * Servings the source recipe makes, when it said so. The route has ALREADY divided by this, so it
   * is here to be shown, not to be applied again.
   *
   * `null` on a URL import whose page stated no yield, and that case is not cosmetic: the payload is
   * then the WHOLE recipe (a banana-bread page measured 1,956 kcal for the loaf). The row asks how
   * many it serves and divides, because assuming one plate is a silent multi-hundred-calorie error
   * that looks entirely plausible.
   */
  recipeYield?: number | null
}

interface Props {
  /** Saved-meal ids to keep in the plan, in the order they were picked. */
  selectedIds: string[]
  onChangeSelected: (ids: string[]) => void
  typedMeals: TypedMeal[]
  onChangeTyped: (meals: TypedMeal[]) => void
  /** Slots available in total, so the picker can stop the user filling every one. */
  mealCount: number
}

/**
 * "Meals you already eat" — the step that lets a plan be built around a real diet rather than
 * replacing it.
 *
 * Anything typed here gets its macros looked up (the same estimate the food scan runs on text), so
 * "chicken, rice and broccoli" becomes a meal the plan can keep exactly and resize, not just a hint
 * about the kind of food to suggest. When the lookup cannot identify the food the entry stays a
 * steer and says so.
 *
 * At least one slot is always left for the generator; a plan of entirely fixed meals has nothing to
 * generate and would silently ignore the calorie target.
 */
export function MyMealsPicker({
  selectedIds, onChangeSelected, typedMeals, onChangeTyped, mealCount,
}: Props) {
  const [meals, setMeals] = useState<SavedMeal[] | null>(null)
  const [draftText, setDraftText] = useState('')

  useEffect(() => {
    // Cache-seeded so a repeat visit paints the library immediately rather than flashing a spinner.
    // Same key and TTL the saved-meals sheet uses — a second key for the same endpoint is how
    // stale/blank first paints happen.
    const seed = readCacheSync<SavedMeal[]>('saved-meals')
    if (seed) setMeals(seed)
    cachedFetch<SavedMeal[]>('saved-meals', '/api/nutrition/saved-meals', TTL_MEDIUM,
      d => setMeals(Array.isArray(d) ? d : []))
      .catch(() => setMeals(prev => prev ?? []))
  }, [])

  const keptCount = selectedIds.length + typedMeals.filter(m => m.keep && m.ingredients.length > 0).length
  const maxKeepable = Math.max(0, mealCount - 1)
  const atLimit = keptCount >= maxKeepable

  function toggleSaved(id: string) {
    onChangeSelected(
      selectedIds.includes(id)
        ? selectedIds.filter(v => v !== id)
        : atLimit ? selectedIds : [...selectedIds, id],
    )
  }

  /** Add the typed meal immediately, then fill its macros in — the row is never blank while it waits. */
  async function addTyped() {
    const text = draftText.trim()
    if (!text || typedMeals.some(m => m.text === text)) return
    setDraftText('')

    // A recipe URL is a third input mode alongside image and text, resolving to the same shape —
    // which is why this is a few lines rather than a subsystem. `https:` only, matching the route:
    // it rejects everything else outright, and offering a mode the server refuses is worse than not
    // offering it.
    const url = asHttpsUrl(text)
    const pending: TypedMeal = {
      text, name: url ? hostOf(url) : text, ingredients: [], looking: true, failed: false, keep: false,
      sourceUrl: url ?? undefined,
    }
    const next = [...typedMeals, pending]
    onChangeTyped(next)

    // The food scan's text mode, reused rather than duplicated — it already returns the exact
    // ingredient shape the plan's portion scaler works in.
    let resolved: TypedMeal
    try {
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(url ? { url } : { text }),
      })
      const body = res.ok ? await res.json() : null
      const ingredients: NutritionIngredient[] = Array.isArray(body?.ingredients) ? body.ingredients : []
      resolved = ingredients.length > 0
        ? {
            text, name: body.name || pending.name, ingredients, looking: false, failed: false,
            // A recipe with no stated yield is the whole batch, so it cannot be kept until the user
            // says how many it serves — keeping it would put a tray in one meal slot.
            keep: !atLimit && !(url && body.recipeYield == null),
            sourceUrl: body.sourceUrl ?? url ?? undefined,
            recipeYield: url ? (body.recipeYield ?? null) : undefined,
          }
        : { ...pending, looking: false, failed: true }
    } catch {
      resolved = { ...pending, looking: false, failed: true }
    }
    // Rebuilt from the caller's latest list rather than `next` — the user may have added or removed
    // another row while this was in flight.
    onChangeTyped(replaceByText(next, text, resolved))
  }

  /** Divide a whole-recipe import down to one serving, once the user has said how many it makes. */
  function applyServes(meal: TypedMeal, serves: number) {
    updateTyped(meal.text, {
      ingredients: perServing(meal.ingredients, serves),
      recipeYield: serves,
      keep: !atLimit,
    })
  }

  function updateTyped(text: string, patch: Partial<TypedMeal>) {
    onChangeTyped(typedMeals.map(m => m.text === text ? { ...m, ...patch } : m))
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Keep meals from your library
        </p>
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          These go into the plan exactly as you saved them, with the portions adjusted to fit the
          day. The plan is built around whatever you keep.
        </p>

        {meals == null ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your meals…
          </div>
        ) : meals.length === 0 ? (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Nothing in My Foods yet. Anything you save from a food scan or from a plan shows up
            here next time.
          </p>
        ) : (
          <ul className="space-y-2">
            {meals.map(m => (
              <li key={m.id}>
                <KeepRow
                  title={m.name}
                  subtitle={`${Math.round(m.totals.calories).toLocaleString()} kcal · ${Math.round(m.totals.proteinG)}P · ${Math.round(m.totals.carbsG)}C · ${Math.round(m.totals.fatG)}F`}
                  checked={selectedIds.includes(m.id)}
                  disabled={!selectedIds.includes(m.id) && atLimit}
                  onToggle={() => toggleSaved(m.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="usual-meal" className="block text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Meals you usually eat
        </label>
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          Type anything you eat regularly and its macros get looked up, so the plan can keep it
          exactly rather than just guessing at the style. Say the portion if it matters — “200 g
          chicken with rice and broccoli”. A recipe link works too.
        </p>
        <div className="flex gap-2">
          <input
            id="usual-meal"
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addTyped() } }}
            placeholder="a meal, or a recipe link"
            className="flex-1 min-h-[48px] rounded-xl border border-border bg-muted/50 px-3 text-sm outline-none"
          />
          <Button variant="secondary" className="min-h-[48px] px-3" onClick={() => void addTyped()} disabled={!draftText.trim()}>
            <Plus className="w-4 h-4" />
            <span className="sr-only">Add this meal</span>
          </Button>
        </div>

        {typedMeals.length > 0 && (
          <ul className="mt-2 space-y-2">
            {typedMeals.map(m => {
              const totals = m.ingredients.length > 0 ? sumIngredients(m.ingredients) : null
              return (
                <li key={m.text} className="rounded-xl border border-border bg-muted/50">
                  <div className="flex items-start gap-2 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{m.name}</span>
                      {m.looking && (
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" /> Looking up macros…
                        </span>
                      )}
                      {totals && (
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {totals.calories.toLocaleString()} kcal · {Math.round(totals.proteinG)}P ·{' '}
                          {Math.round(totals.carbsG)}C · {Math.round(totals.fatG)}F · estimated
                        </span>
                      )}
                      {m.failed && (
                        <span className="block text-[11px] leading-snug text-muted-foreground">
                          Could not work out macros for this. It will still steer the kind of food
                          the plan suggests.
                        </span>
                      )}
                      {/* Attribution: it says where a meal came from six months later, and it is
                          the honest thing to do with someone else's recipe. */}
                      {m.sourceUrl && (
                        <span
                          data-testid="meal-source-attribution"
                          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground"
                        >
                          <Link2 className="w-3 h-3 flex-none" />
                          <span className="truncate">{hostOf(m.sourceUrl)}</span>
                          {m.recipeYield != null && m.recipeYield > 1 && (
                            <span className="flex-none">· from a {m.recipeYield}-serve recipe</span>
                          )}
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => onChangeTyped(typedMeals.filter(x => x.text !== m.text))}
                      className="flex-none min-h-[44px] min-w-[44px] -mr-1 -mt-1 grid place-items-center rounded-xl active:bg-muted/30"
                      aria-label={`Remove ${m.name}`}
                    >
                      <X className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </div>

                  {/* A page that states no yield gives back the WHOLE recipe, so this asks before
                      anything can be kept. Assuming one plate is a 4x calorie error that reads as
                      perfectly plausible, which is exactly why it has to be a question. */}
                  {totals && m.sourceUrl && m.recipeYield == null && (
                    <div className="border-t border-border/50 px-3 py-2">
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        These are the numbers for the whole recipe. How many does it serve?
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {[1, 2, 4, 6, 8, 12].map(n => (
                          <button
                            key={n}
                            onClick={() => applyServes(m, n)}
                            className="min-h-[36px] min-w-[44px] rounded-full border border-border bg-background/50 px-3 text-xs font-semibold tabular-nums active:bg-muted/30"
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {totals && !(m.sourceUrl && m.recipeYield == null) && (
                    <label className="flex items-center justify-between gap-3 border-t border-border/50 px-3 py-2">
                      <span className="text-[11px] text-muted-foreground">
                        Keep this meal exactly
                      </span>
                      <button
                        onClick={() => updateTyped(m.text, { keep: !m.keep })}
                        disabled={!m.keep && atLimit}
                        aria-pressed={m.keep}
                        className={cn(
                          'min-h-[36px] rounded-full border px-3 text-xs font-semibold transition-colors',
                          m.keep
                            ? 'border-brand/50 bg-brand/15 text-brand'
                            : 'border-border bg-background/50',
                          !m.keep && atLimit && 'opacity-40',
                        )}
                      >
                        {m.keep ? 'Kept' : 'Keep'}
                      </button>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {atLimit && maxKeepable > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            That is {maxKeepable} of your {mealCount} meals kept. At least one slot stays open for
            the plan to work with.
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * The input as an `https:` URL, or null.
 *
 * Parsed with `new URL()` and compared on `protocol`, never matched as a prefix string — the route
 * rejects every other scheme outright (`http:`, `file:`, `data:`), so anything else has to fall
 * through to the text branch rather than be sent and refused.
 */
function asHttpsUrl(text: string): string | null {
  try {
    const u = new URL(text)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** The site's name, as a placeholder until the recipe's own name comes back. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function replaceByText(list: TypedMeal[], text: string, next: TypedMeal): TypedMeal[] {
  return list.map(m => m.text === text ? next : m)
}

function KeepRow({ title, subtitle, checked, disabled, onToggle }: {
  title: string
  subtitle: string
  checked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        'w-full min-h-[48px] flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
        checked ? 'border-brand/50 bg-brand/15' : 'border-border bg-muted/50 active:bg-muted/30',
        disabled && 'opacity-40',
      )}
    >
      <span className={cn(
        'flex-none w-5 h-5 grid place-items-center rounded-md border',
        checked ? 'border-brand bg-brand' : 'border-border',
      )}>
        {checked && <Check className="w-3.5 h-3.5 text-black" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{title}</span>
        <span className="block text-[11px] tabular-nums text-muted-foreground">{subtitle}</span>
      </span>
    </button>
  )
}
