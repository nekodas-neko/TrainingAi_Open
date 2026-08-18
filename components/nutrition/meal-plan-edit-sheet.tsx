'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, BookOpen, Pencil, Wand2, ArrowUp, ArrowDown } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@trainingai/shared/utils'
import { invalidateMealPlans } from '@/lib/cache-groups'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import { sumIngredients } from '@trainingai/shared/nutrition/scan-totals'
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit'
import { MealMacroBars, DayMacroTotals } from './meal-macro-bars'
import type {
  MealPlan, MealPlanMeal, MealPlanVariant, SavedMeal, NutritionIngredient,
} from '@trainingai/shared/types/nutrition'

interface Props {
  plan: MealPlan | null
  onOpenChange: (open: boolean) => void
  onChanged: (plan: MealPlan) => void
}

/**
 * Edit the meals of a plan that is already saved.
 *
 * This is the gap the owner hit: rerolling a meal only existed during the review step, so once a
 * plan was saved, swapping one meal meant rebuilding the whole thing. It works now because
 * `meal_plan_meals` stores each meal's ingredients (Q-192) — without the food there is nothing to
 * re-scale, replace or show.
 *
 * A change is written per meal and applied to **every variant** at that variant's own targets, so a
 * training/rest plan never ends up holding two different meals in the same slot.
 */
export function MealPlanEditSheet({ plan, onOpenChange, onChanged }: Props) {
  const [variantIdx, setVariantIdx] = useState(0)
  const [busyPosition, setBusyPosition] = useState<number | null>(null)
  const [pickingFor, setPickingFor] = useState<number | null>(null)
  const [renamingFor, setRenamingFor] = useState<number | null>(null)
  const [renameText, setRenameText] = useState('')
  const [instructingFor, setInstructingFor] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const [savedMeals, setSavedMeals] = useState<SavedMeal[]>([])

  useEffect(() => {
    if (!plan) return
    setVariantIdx(0); setPickingFor(null); setRenamingFor(null)
    const seed = readCacheSync<SavedMeal[]>('saved-meals')
    if (seed) setSavedMeals(seed)
    cachedFetch<SavedMeal[]>('saved-meals', '/api/nutrition/saved-meals', TTL_MEDIUM,
      d => setSavedMeals(Array.isArray(d) ? d : [])).catch(() => {})
  }, [plan])

  if (!plan) return null
  const variant: MealPlanVariant | undefined = plan.variants[Math.min(variantIdx, plan.variants.length - 1)]
  if (!variant) return null

  /**
   * Write one meal into every variant. Each variant PATCHes its own row with the ingredients
   * rescaled to that row's target — the same shape the generator produces, so a plan edited here
   * and a plan generated fresh behave identically.
   */
  async function applyToAllVariants(
    position: number,
    next: { name: string; notes: string | null; ingredients: NutritionIngredient[]; savedMealId: string | null },
  ) {
    setBusyPosition(position)
    try {
      const targets = plan!.variants.flatMap(v => {
        const meal = v.meals.find(m => m.position === position)
        return meal ? [meal] : []
      })
      await Promise.all(targets.map(meal =>
        fetch(`/api/nutrition/meal-plans/meals/${meal.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: next.name,
            notes: next.notes,
            // Sent UNSCALED, with the server portioning against this meal's own stored targets.
            // Scaling here would skip the top-up, which is exactly the case a saved meal needs:
            // a finished dish put into a slot it has no source for cannot be resized into shape,
            // only added to.
            ingredients: next.ingredients,
            scaleToTarget: true,
            savedMealId: next.savedMealId,
          }),
        }).then(r => { if (!r.ok) throw new Error() })
      ))

      const res = await fetch(`/api/nutrition/meal-plans/${plan!.id}`)
      if (!res.ok) throw new Error()
      const updated: MealPlan = await res.json()
      await invalidateMealPlans()
      onChanged(updated)
    } catch {
      toast.error('Could not update that meal')
    } finally {
      setBusyPosition(null)
      setPickingFor(null)
      setRenamingFor(null)
    }
  }

  /**
   * Reroll or rewrite one meal. Both go through the same route and the same request shape — the
   * only difference is whether an instruction and the current meal are attached, which is what
   * turns a fresh suggestion into an edit. Sharing the builder means the two can never drift on
   * targets, stores or exclusions.
   */
  async function askForMeal(meal: MealPlanMeal, opts?: { instruction: string }) {
    setBusyPosition(meal.position)
    try {
      const res = await fetch('/api/nutrition/meal-plans/generate/meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCalories: meal.targetCalories,
          targetProteinG: meal.targetProteinG,
          targetCarbsG: meal.targetCarbsG,
          targetFatG: meal.targetFatG,
          suggestedTime: meal.suggestedTime ?? undefined,
          stores: plan!.stores,
          excludedFoods: plan!.excludedFoods,
          avoidNames: variant!.meals.map(m => m.name),
          ...(opts ? {
            instruction: opts.instruction,
            currentMeal: { name: meal.name, ingredients: meal.ingredients },
          } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not rewrite that meal')
        setBusyPosition(null)
        return
      }
      const fresh = await res.json() as { name: string; notes: string | null; ingredients: NutritionIngredient[] }
      // A rewrite is no longer the library meal it may have started as — its ingredients changed.
      await applyToAllVariants(meal.position, { ...fresh, savedMealId: null })
      setInstructingFor(null)
      setInstruction('')
    } catch {
      toast.error('Could not rewrite that meal')
      setBusyPosition(null)
    }
  }

  /**
   * Move one meal up or down.
   *
   * Sent as the whole new order to the structure route rather than as a swap, because that route
   * re-splits the day's macros over the result — a meal that moves past the training time gets a
   * different carb target, and any "swap these two names" shortcut would leave the targets behind.
   */
  async function move(position: number, direction: -1 | 1) {
    const count = variant!.meals.length
    const to = position + direction
    if (to < 0 || to >= count) return
    const order = [...Array(count).keys()]
    ;[order[position], order[to]] = [order[to], order[position]]
    setBusyPosition(position)
    try {
      const res = await fetch(`/api/nutrition/meal-plans/${plan!.id}/structure`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not move that meal')
        return
      }
      const { plan: updated } = await res.json() as { plan: MealPlan }
      await invalidateMealPlans()
      onChanged(updated)
    } catch {
      toast.error('Could not move that meal')
    } finally {
      setBusyPosition(null)
    }
  }

  function applySavedMeal(position: number, saved: SavedMeal) {
    const ingredients = savedMealToIngredients(saved)
    if (ingredients.length === 0) {
      toast.error(`"${saved.name}" has no ingredients to work from`)
      return
    }
    void applyToAllVariants(position, {
      name: saved.name, notes: null, ingredients, savedMealId: saved.id,
    })
  }

  const dayActual = sumMacroTotals(
    variant.meals.map(m => m.ingredients.length > 0 ? sumIngredients(m.ingredients) : null),
  )
  const plannedCount = variant.meals.filter(m => m.ingredients.length > 0).length

  return (
    <Sheet open={plan != null} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit meals</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-hide">
          {plan.variants.length > 1 && (
            <div className="flex gap-2">
              {plan.variants.map((v, i) => (
                <button
                  key={v.dayType}
                  onClick={() => setVariantIdx(i)}
                  aria-pressed={i === variantIdx}
                  className={cn(
                    'min-h-[36px] flex-1 rounded-xl border px-3 text-xs font-semibold capitalize transition-colors',
                    i === variantIdx
                      ? 'border-brand/50 bg-brand/15 text-brand'
                      : 'border-border bg-muted/50',
                  )}
                >
                  {v.dayType} day
                </button>
              ))}
            </div>
          )}

          {plannedCount === 0 ? (
            <p className="rounded-xl bg-muted/50 p-3 text-[11px] leading-snug text-muted-foreground">
              This plan was built before meals kept their ingredients, so there is nothing to
              re-scale. Swapping a meal below replaces it with one that does.
            </p>
          ) : (
            <DayMacroTotals
              actualCalories={dayActual.calories} actualProteinG={dayActual.proteinG}
              actualCarbsG={dayActual.carbsG} actualFatG={dayActual.fatG}
              targetCalories={variant.targetCalories} targetProteinG={variant.targetProteinG}
              targetCarbsG={variant.targetCarbsG} targetFatG={variant.targetFatG}
              plannedCount={plannedCount}
              totalCount={variant.meals.length}
            />
          )}

          <ul className="space-y-3">
            {variant.meals.map(m => {
              const actual = m.ingredients.length > 0 ? sumIngredients(m.ingredients) : null
              const busy = busyPosition === m.position
              return (
                <li key={m.id} className="rounded-xl bg-muted/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{m.name}</p>
                      <p className="text-[11px] tabular-nums text-muted-foreground">
                        {m.suggestedTime ?? `Meal ${m.position + 1}`}
                        {m.savedMealId && ' · from your meals'}
                      </p>
                    </div>
                    <div className="flex flex-none items-center gap-1">
                      {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                      {/* Buttons, not drag: the list is 1-6 items and drag-reorder has a documented
                          history of WebView trouble in this codebase. */}
                      <button
                        onClick={() => move(m.position, -1)}
                        disabled={busyPosition != null || m.position === 0}
                        aria-label={`Move ${m.name} earlier`}
                        className="w-11 h-11 grid place-items-center rounded-lg active:bg-muted/40 disabled:opacity-25 transition-colors"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => move(m.position, 1)}
                        disabled={busyPosition != null || m.position === variant.meals.length - 1}
                        aria-label={`Move ${m.name} later`}
                        className="w-11 h-11 grid place-items-center rounded-lg active:bg-muted/40 disabled:opacity-25 transition-colors"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {m.ingredients.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {m.ingredients.map((ing, i) => (
                        <li key={`${ing.name}-${i}`} className="text-[11px] tabular-nums text-muted-foreground">
                          {ing.name} · {Math.round(ing.weightG)} g
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                      No ingredients stored for this meal.
                    </p>
                  )}

                  {actual ? (
                    <MealMacroBars
                      className="mt-2"
                      actualCalories={actual.calories} actualProteinG={actual.proteinG}
                      actualCarbsG={actual.carbsG} actualFatG={actual.fatG}
                      targetCalories={m.targetCalories} targetProteinG={m.targetProteinG}
                      targetCarbsG={m.targetCarbsG} targetFatG={m.targetFatG}
                    />
                  ) : (
                    <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                      Target {m.targetCalories.toLocaleString()} kcal · {Math.round(m.targetProteinG)}P ·{' '}
                      {Math.round(m.targetCarbsG)}C · {Math.round(m.targetFatG)}F
                    </p>
                  )}

                  <div className="mt-2 flex gap-2 border-t border-border/50 pt-2">
                    <Button
                      variant="secondary" className="flex-1 min-h-[44px] text-xs"
                      disabled={busyPosition != null}
                      onClick={() => askForMeal(m)}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Suggest another
                    </Button>
                    <Button
                      variant="secondary" className="flex-1 min-h-[44px] text-xs"
                      disabled={busyPosition != null}
                      onClick={() => setPickingFor(pickingFor === m.position ? null : m.position)}
                      aria-expanded={pickingFor === m.position}
                    >
                      <BookOpen className="w-3.5 h-3.5 mr-1.5" /> My meals
                    </Button>
                    <Button
                      variant="secondary" className="min-h-[44px] px-3"
                      disabled={busyPosition != null}
                      onClick={() => {
                        setRenamingFor(renamingFor === m.position ? null : m.position)
                        setRenameText(m.name)
                      }}
                      aria-label={`Rename ${m.name}`}
                      aria-expanded={renamingFor === m.position}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  {/* Change it by saying what to change. "Suggest another" throws the meal away;
                      this keeps it and applies one instruction, which is the difference between
                      rerolling until something sticks and actually editing. */}
                  <div className="mt-2">
                    <Button
                      variant="secondary" className="w-full min-h-[44px] text-xs justify-start"
                      disabled={busyPosition != null || m.ingredients.length === 0}
                      onClick={() => {
                        setInstructingFor(instructingFor === m.position ? null : m.position)
                        setInstruction('')
                      }}
                      aria-expanded={instructingFor === m.position}
                    >
                      <Wand2 className="w-3.5 h-3.5 mr-1.5" />
                      {m.ingredients.length === 0 ? 'Nothing to change yet' : 'Change something about it'}
                    </Button>
                  </div>

                  {instructingFor === m.position && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={instruction}
                        onChange={e => setInstruction(e.target.value)}
                        maxLength={200}
                        placeholder="e.g. make it vegetarian, swap the rice for potato"
                        aria-label={`What to change about ${m.name}`}
                        className="w-full min-h-[44px] rounded-xl border border-border bg-background/50 px-3 text-sm outline-none"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="secondary" className="flex-1 min-h-[44px] text-xs"
                          onClick={() => { setInstructingFor(null); setInstruction('') }}
                        >
                          Cancel
                        </Button>
                        <Button
                          className="flex-1 min-h-[44px] text-xs"
                          disabled={!instruction.trim() || busyPosition != null}
                          onClick={() => askForMeal(m, { instruction: instruction.trim() })}
                        >
                          Apply
                        </Button>
                      </div>
                      {/* Same standing rule as the review step: the model is steered, never trusted. */}
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Written by AI. Read the ingredients afterwards — an instruction steers it, it
                        does not guarantee anything.
                      </p>
                    </div>
                  )}

                  {renamingFor === m.position && (
                    <div className="mt-2 flex gap-2">
                      <input
                        value={renameText}
                        onChange={e => setRenameText(e.target.value)}
                        aria-label="Meal name"
                        className="flex-1 min-h-[44px] rounded-xl border border-border bg-background/50 px-3 text-sm outline-none"
                      />
                      <Button
                        className="min-h-[44px]"
                        disabled={!renameText.trim() || renameText.trim() === m.name}
                        onClick={() => applyToAllVariants(m.position, {
                          name: renameText.trim(), notes: m.notes,
                          ingredients: m.ingredients, savedMealId: m.savedMealId,
                        })}
                      >
                        Save
                      </Button>
                    </div>
                  )}

                  {pickingFor === m.position && (
                    <div className="mt-2 space-y-1.5">
                      {savedMeals.length === 0 ? (
                        <p className="text-[11px] leading-snug text-muted-foreground">
                          Nothing in your library yet. Save a meal from a food scan and it appears here.
                        </p>
                      ) : savedMeals.map(sm => (
                        <button
                          key={sm.id}
                          onClick={() => applySavedMeal(m.position, sm)}
                          className="w-full min-h-[44px] rounded-xl border border-border bg-background/50 px-3 py-2 text-left active:bg-muted/30"
                        >
                          <span className="block text-sm font-medium truncate">{sm.name}</span>
                          <span className="block text-[11px] tabular-nums text-muted-foreground">
                            {Math.round(sm.totals.calories).toLocaleString()} kcal ·{' '}
                            {Math.round(sm.totals.proteinG)}P · {Math.round(sm.totals.carbsG)}C ·{' '}
                            {Math.round(sm.totals.fatG)}F — portions get resized to fit
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <SheetFooter>
          <Button className="w-full" onClick={() => onOpenChange(false)} disabled={busyPosition != null}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
