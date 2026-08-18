'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, RefreshCw, BookOpen, Wand2, ArrowUp, ArrowDown } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@trainingai/shared/utils'
import { sumMacroTotals } from '@trainingai/shared/nutrition/meal-macro-fit'
import { MealMacroBars, DayMacroTotals } from './meal-macro-bars'
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
  const [instruction, setInstruction] = useState('')
  const variant = draft.variants[Math.min(variantIdx, draft.variants.length - 1)]

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
                {/* Without this a kept meal is indistinguishable from a suggestion, and the reroll
                    button sits on it identically — you would replace your own food by accident. */}
                {m.savedMealId != null && (
                  <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    <BookOpen className="w-3 h-3" /> Yours — kept
                  </p>
                )}
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
                  onClick={() => askForMeal(m)}
                  disabled={rerolling != null}
                  aria-label={`Suggest a different meal instead of ${m.name}`}
                  className="min-h-[44px] min-w-[44px] grid place-items-center rounded-xl active:bg-muted/40 disabled:opacity-40 transition-colors"
                >
                  {rerolling === m.position
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <RefreshCw className="w-4 h-4 text-muted-foreground" />}
                </button>
              </div>
            </div>

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
