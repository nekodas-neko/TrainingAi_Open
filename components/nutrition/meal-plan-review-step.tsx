'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, BookOpen, Loader2, RefreshCw, Sparkles, Wand2, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@trainingai/shared/utils'
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit'
import { MealMacroBars, DayMacroTotals } from './meal-macro-bars'
import { MealSourceBadge } from './meal-source-badge'
import { libraryMealForSlot, usedSavedMealIds } from './library-swap'
import { savedMealToIngredients } from '@trainingai/shared/nutrition/saved-meal-ingredients'
import type { MealTypeWindow } from '@trainingai/shared/nutrition/library-match'
import type { MealType, SavedMeal } from '@trainingai/shared/types/nutrition'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG, TTL_MEDIUM } from '@trainingai/shared/cache-ttl'
import { replaceMealInDraft, reorderDraft, type Draft, type DraftMeal } from './meal-plan-draft'

interface Props {
  draft: Draft
  onDraftChange: (draft: Draft) => void
  saveToLibrary: Record<number, boolean>
  onToggleSave: (position: number) => void
}

/**
 * The accept-or-reject step. Extracted from the setup sheet so the sheet stays a flow controller
 * rather than a flow controller plus the most detailed screen in the feature.
 *
 * Two things it must keep doing: show every ingredient beside the must-not-contain list (accepting
 * the plan is the safety check, and nothing here claims the plan was verified), and show a meal's
 * actual food next to its target rather than reconciling one into the other.
 */
export function MealPlanReviewStep({ draft, onDraftChange, saveToLibrary, onToggleSave }: Props) {
  const [variantIdx, setVariantIdx] = useState(0)
  const [rerolling, setRerolling] = useState<number | null>(null)
  const [instructingFor, setInstructingFor] = useState<number | null>(null)
  // BF-11h item 11: the library is offered on a reroll BEFORE the model is asked. Read from the
  // same keys the rest of the app uses and seeded synchronously, so the offer is there on the first
  // paint rather than appearing a beat after the user has already tapped.
  const [library, setLibrary] = useState<SavedMeal[]>(() => [])
  const [mealTypes, setMealTypes] = useState<MealTypeWindow[]>(() => [])
  const [swapFor, setSwapFor] = useState<number | null>(null)
  const [instruction, setInstruction] = useState('')
  const variant = draft.variants[Math.min(variantIdx, draft.variants.length - 1)]

  useEffect(() => {
    const seededMeals = readCacheSync<SavedMeal[]>('saved-meals')
    if (Array.isArray(seededMeals)) setLibrary(seededMeals)
    const seededTypes = readCacheSync<MealType[]>('nutrition-meal-types')
    if (Array.isArray(seededTypes)) setMealTypes(seededTypes)
    cachedFetch<SavedMeal[]>('saved-meals', '/api/nutrition/saved-meals', TTL_MEDIUM,
      d => setLibrary(Array.isArray(d) ? d : [])).catch(() => {})
    cachedFetch<MealType[]>('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG,
      d => setMealTypes(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  /**
   * Reroll or rewrite one meal. Both go through the same route and the same request body — the only
   * difference is whether an instruction and the current meal ride along, which is what turns a
   * fresh suggestion into an edit. One builder so the two cannot drift on targets or exclusions.
   */
  async function askForMeal(meal: DraftMeal, opts?: { instruction: string }) {
    setRerolling(meal.position)
    try {
      const res = await fetch('/api/nutrition/meal-plans/generate/meal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetCalories: meal.targetCalories,
          targetProteinG: meal.targetProteinG,
          targetCarbsG: meal.targetCarbsG,
          targetFatG: meal.targetFatG,
          timingRole: meal.timingRole,
          suggestedTime: meal.suggestedTime,
          stores: draft.stores,
          excludedFoods: draft.excludedFoods,
          // Everything currently in the plan, so the replacement is not a near-copy of a sibling.
          avoidNames: variant.meals.map(m => m.name),
          ...(opts ? {
            instruction: opts.instruction,
            currentMeal: { name: meal.name, ingredients: meal.ingredients },
          } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not rewrite that meal')
        return
      }
      onDraftChange(replaceMealInDraft(draft, meal.position, await res.json()))
      setInstructingFor(null)
      setInstruction('')
    } catch {
      toast.error('Could not rewrite that meal')
    } finally {
      setRerolling(null)
    }
  }

  /**
   * Swap one slot for the best saved meal that fits it (BF-11h item 11).
   *
   * No route and no model call — `libraryMealForSlot` runs the generator's own matcher on data the
   * client already has cached. So this is instant and free where the AI reroll is neither, which is
   * the whole reason it is offered first.
   */
  function swapForLibraryMeal(meal: DraftMeal) {
    const swap = libraryMealForSlot(meal, library, mealTypes, usedSavedMealIds(variant.meals))
    if (!swap) { toast.error('Nothing in your meals fits this slot'); return }
    onDraftChange(replaceMealInDraft(draft, meal.position, {
      name: swap.meal.name,
      notes: null,
      ingredients: savedMealToIngredients(swap.meal),
      fromLibrary: { savedMealId: swap.meal.id, matchReason: swap.matchReason },
    }))
    setSwapFor(null)
  }

  /**
   * Move a meal earlier or later. Applied to the draft in memory, because this plan does not exist
   * in the database yet — the saved-plan editor sends the same change to the structure route.
   */
  function move(position: number, direction: -1 | 1) {
    const to = position + direction
    if (to < 0 || to >= variant.meals.length) return
    onDraftChange(reorderDraft(draft, position, to))
  }

  const dayActual = sumMacroTotals(variant.meals.map(m => m.actual))
  const plannedCount = variant.meals.filter(m => m.actual != null).length

  return (
    <div className="space-y-4">
      {draft.allergies.length > 0 && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-destructive">
            Must not contain
          </p>
          <p className="mt-1 text-sm font-medium">{draft.allergies.join(', ')}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
            Written by AI. Read the ingredients before you accept it.
          </p>
        </div>
      )}

      {draft.variants.length > 1 && (
        <div className="flex gap-2">
          {draft.variants.map((v, i) => (
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

      {/* The pins the server could not honour. The client caps at `mealCount - 1` while you pick and
          the reduction prompt catches a lowered count, so reaching this means both were bypassed —
          it is the last place a silently dropped pin can still be named rather than vanish. */}
      {draft.droppedPins != null && draft.droppedPins.length > 0 && (
        <p
          className="flex items-start gap-1.5 text-[11px] leading-snug"
          style={{ color: 'var(--accent-amber)' }}
        >
          <AlertTriangle className="mt-px h-3 w-3 flex-none" />
          <span>
            There was no room for {draft.droppedPins.join(', ')} — the plan has{' '}
            {draft.mealsPerDay} {draft.mealsPerDay === 1 ? 'meal' : 'meals'} a day. Go back to raise
            the count if you want {draft.droppedPins.length === 1 ? 'it' : 'them'} in.
          </span>
        </p>
      )}

      {draft.libraryMatchCount != null && draft.libraryMatchCount > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {draft.libraryMatchCount} of these came from your saved meals.
        </p>
      )}

      {draft.macrosAdjusted && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          Your saved macros did not add up to your {draft.targetCalories.toLocaleString()} kcal goal,
          so this plan keeps your protein and fat and fits carbs to{' '}
          {Math.round(draft.targetCarbsG)} g. Your saved targets are unchanged.
        </p>
      )}

      <DayMacroTotals
        actualCalories={dayActual.calories} actualProteinG={dayActual.proteinG}
        actualCarbsG={dayActual.carbsG} actualFatG={dayActual.fatG}
        targetCalories={variant.targetCalories} targetProteinG={variant.targetProteinG}
        targetCarbsG={variant.targetCarbsG} targetFatG={variant.targetFatG}
        plannedCount={plannedCount}
        totalCount={variant.meals.length}
      />

      <ul className="space-y-3">
        {variant.meals.map(m => (
          <li key={m.position} className="rounded-xl bg-muted/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{m.name}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {m.suggestedTime}
                  {m.timingRole === 'pre_workout' && ' · before training'}
                  {m.timingRole === 'post_workout' && ' · after training'}
                </p>
                <MealSourceBadge
                  source={m.source}
                  matchReason={m.matchReason ?? null}
                  hasSavedMeal={m.savedMealId != null}
                />
              </div>
              <div className="flex flex-none items-center -mr-1 -mt-1">
                {/* Buttons rather than drag: at most six items, and drag-reorder has a documented
                    history of WebView trouble in this codebase. */}
                <button
                  onClick={() => move(m.position, -1)}
                  disabled={rerolling != null || m.position === 0}
                  aria-label={`Move ${m.name} earlier`}
                  className="min-h-[44px] min-w-[40px] grid place-items-center rounded-xl active:bg-muted/40 disabled:opacity-25 transition-colors"
                >
                  <ArrowUp className="w-4 h-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => move(m.position, 1)}
                  disabled={rerolling != null || m.position === variant.meals.length - 1}
                  aria-label={`Move ${m.name} later`}
                  className="min-h-[44px] min-w-[40px] grid place-items-center rounded-xl active:bg-muted/40 disabled:opacity-25 transition-colors"
                >
                  <ArrowDown className="w-4 h-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => setSwapFor(swapFor === m.position ? null : m.position)}
                  disabled={rerolling != null}
                  aria-expanded={swapFor === m.position}
                  aria-label={`Replace ${m.name}`}
                  className="min-h-[44px] min-w-[44px] grid place-items-center rounded-xl active:bg-muted/40 disabled:opacity-40 transition-colors"
                >
                  {rerolling === m.position
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RefreshCw className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

            {/* The library is offered FIRST because it is the better answer when it exists: a meal
                the user already eats, instantly, with no model call. The AI option stays because
                "nothing of mine fits here" is a real and common answer — this replaces one button
                with a choice, not with a different button. */}
            {swapFor === m.position && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1 min-h-[44px] text-xs"
                  onClick={() => swapForLibraryMeal(m)}
                  disabled={library.length === 0}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  {library.length === 0 ? 'No saved meals' : 'One of mine'}
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1 min-h-[44px] text-xs"
                  onClick={() => { setSwapFor(null); void askForMeal(m) }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Something new
                </Button>
              </div>
            )}

            {m.notes && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.notes}</p>
            )}

            {m.ingredients.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {m.ingredients.map((ing, i) => (
                  <li key={`${ing.name}-${i}`} className="text-[11px] tabular-nums text-muted-foreground">
                    {ing.name} · {Math.round(ing.weightG)} g
                  </li>
                ))}
              </ul>
            )}

            {/* Actual against target, per macro. Drift is surfaced, never auto-corrected — a
                suggestion that misses badly should be visible rather than quietly rewritten. */}
            {m.actual ? (
              <MealMacroBars
                className="mt-2"
                actualCalories={m.actual.calories} actualProteinG={m.actual.proteinG}
                actualCarbsG={m.actual.carbsG} actualFatG={m.actual.fatG}
                targetCalories={m.targetCalories} targetProteinG={m.targetProteinG}
                targetCarbsG={m.targetCarbsG} targetFatG={m.targetFatG}
              />
            ) : (
              <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                Target {m.targetCalories.toLocaleString()} kcal · {Math.round(m.targetProteinG)}P ·{' '}
                {Math.round(m.targetCarbsG)}C · {Math.round(m.targetFatG)}F — no ingredients suggested
              </p>
            )}

            {/* Change it by saying what to change. "Suggest another" discards the meal; this keeps
                it and applies one instruction — the difference between rerolling until something
                sticks and actually editing. */}
            <button
              onClick={() => {
                setInstructingFor(instructingFor === m.position ? null : m.position)
                setInstruction('')
              }}
              disabled={rerolling != null || m.ingredients.length === 0}
              aria-expanded={instructingFor === m.position}
              className="mt-2 w-full min-h-[44px] flex items-center gap-1.5 rounded-xl bg-muted/60 px-3 text-xs font-semibold active:bg-muted/30 disabled:opacity-40 transition-colors"
            >
              <Wand2 className="w-3.5 h-3.5" />
              Change something about it
            </button>

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
                  <button
                    onClick={() => { setInstructingFor(null); setInstruction('') }}
                    className="flex-1 min-h-[44px] rounded-xl bg-muted/60 text-xs font-semibold active:bg-muted/30"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => askForMeal(m, { instruction: instruction.trim() })}
                    disabled={!instruction.trim() || rerolling != null}
                    className="flex-1 min-h-[44px] rounded-xl bg-foreground text-background text-xs font-semibold disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
                {/* Same standing rule as the allergy banner above: the model is steered, not trusted. */}
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Written by AI. Read the ingredients afterwards — an instruction steers it, it does
                  not guarantee anything.
                </p>
              </div>
            )}

            {/* Shown on every variant, not just the first: the ingredients are the same meal either
                way, so hiding the toggle behind a tab made it look absent on a split plan. */}
            <label className="mt-2 flex items-center justify-between gap-3 border-t border-border/50 pt-2">
              <span className="text-[11px] text-muted-foreground">Save to my meals</span>
              <Switch
                checked={saveToLibrary[m.position] ?? false}
                onCheckedChange={() => onToggleSave(m.position)}
                aria-label={`Save ${m.name} to my meals`}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
