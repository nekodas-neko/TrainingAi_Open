'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@trainingai/shared/utils'
import { invalidateMealPlans, invalidateSavedMeals } from '@/lib/cache-groups'
import { RestrictionsPicker, type RestrictionSelection } from './restrictions-picker'
import { MealPlanReviewStep } from './meal-plan-review-step'
import { MyMealsPicker, type TypedMeal } from './my-meals-picker'
import type { Draft } from './meal-plan-draft'
import { MEAL_COUNT_MIN, MEAL_COUNT_MAX } from '@trainingai/shared/nutrition/meal-split'
import type { DietaryRestriction, MealPlan } from '@trainingai/shared/types/nutrition'
import type { DietaryRestrictionsResponse } from '@/app/api/nutrition/dietary-restrictions/route'

/** AU chains. A curated list, not geolocation: the store names only bias what the model suggests,
 *  and a location permission buys nothing without per-store stock data. */
const STORES = ['Coles', 'Woolworths', 'Aldi', 'IGA', 'Costco', 'Local grocer']

const PROTEINS = ['Chicken', 'Beef', 'Pork', 'Lamb', 'Salmon', 'White fish', 'Prawns', 'Eggs', 'Tofu', 'Greek yoghurt']
const CARBS = ['Rice', 'Pasta', 'Potato', 'Sweet potato', 'Oats', 'Bread', 'Quinoa', 'Couscous']
const FATS = ['Olive oil', 'Avocado', 'Nuts', 'Cheese', 'Butter', 'Seeds']
const VEG = ['Broccoli', 'Spinach', 'Capsicum', 'Mushroom', 'Carrot', 'Green beans', 'Tomato', 'Zucchini']

const STEPS = ['Stores', 'Avoid', 'Skip', 'Meals', 'Yours', 'Training', 'Review'] as const
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6
const REVIEW_STEP: StepIndex = 6

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (plan: MealPlan) => void
}

/**
 * Six steps rather than one long sheet. The deciding factor is the footer: a stepped flow keeps a
 * fixed action row that never scrolls away, and `SheetFooter` owns the bottom inset — bare
 * `pb-safe` under a primary button is this repo's most repeated on-device regression.
 */
export function MealPlanSetupSheet({ open, onOpenChange, onSaved }: Props) {
  const [step, setStep] = useState<StepIndex>(0)
  const [catalogue, setCatalogue] = useState<DietaryRestriction[]>([])
  const [restrictions, setRestrictions] = useState<RestrictionSelection[]>([])
  const [note, setNote] = useState('')
  const [stores, setStores] = useState<string[]>([])
  const [excluded, setExcluded] = useState<string[]>([])
  const [mealCount, setMealCount] = useState(3)
  const [trainingTime, setTrainingTime] = useState('')
  const [splitDays, setSplitDays] = useState(false)
  const [keepMealIds, setKeepMealIds] = useState<string[]>([])
  const [typedMeals, setTypedMeals] = useState<TypedMeal[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saveToLibrary, setSaveToLibrary] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!open) return
    setStep(0); setDraft(null); setKeepMealIds([]); setTypedMeals([])
    fetch('/api/nutrition/dietary-restrictions')
      .then(r => r.ok ? r.json() as Promise<DietaryRestrictionsResponse> : null)
      .then(d => {
        if (!d) return
        setCatalogue(d.catalogue)
        // Seeded from what the user already has — restrictions are a property of the person, so a
        // new plan must never start from a blank slate and quietly forget an allergy.
        setRestrictions(d.mine.map(m => ({ restrictionId: m.restrictionId, severity: m.severity })))
      })
      .catch(() => {})
  }, [open])

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter(v => v !== value) : [...list, value])

  async function handleGenerate() {
    setGenerating(true)
    try {
      // Persist the restriction set first: it is user-level data, so it should stick even if the
      // user abandons the plan at the review step.
      await fetch('/api/nutrition/dietary-restrictions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entries: restrictions }),
      }).catch(() => {})

      const res = await fetch('/api/nutrition/meal-plans/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mealCount,
          trainingTime: trainingTime || null,
          stores,
          excludedFoods: [...excluded, ...(note.trim() ? [note.trim()] : [])],
          splitTrainingRest: splitDays,
          keepSavedMealIds: keepMealIds,
          // Resolved and ticked: real macros, so the plan keeps them verbatim.
          keepMeals: typedMeals
            .filter(m => m.keep && m.ingredients.length > 0)
            .map(m => ({ name: m.name, ingredients: m.ingredients })),
          // Everything else typed is a steer only — either the lookup failed, or the user left it
          // unticked because they wanted the style rather than the exact meal.
          usualMeals: typedMeals
            .filter(m => !(m.keep && m.ingredients.length > 0))
            .map(m => m.text),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not generate a plan')
        return
      }
      const d: Draft = await res.json()
      setDraft(d)
      // Default on: agreeing costs nothing, and it is still visibly a choice per meal.
      // A meal that came from the library is already saved — defaulting its switch on would offer
      // to save it a second time.
      setSaveToLibrary(Object.fromEntries(
        d.variants[0].meals.map(m => [m.position, m.savedMealId == null]),
      ))
      setStep(REVIEW_STEP)
    } catch {
      toast.error('Could not generate a plan')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    try {
      const res = await fetch('/api/nutrition/meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.planName,
          mealsPerDay: draft.mealsPerDay,
          targetCalories: draft.targetCalories,
          targetProteinG: draft.targetProteinG,
          targetCarbsG: draft.targetCarbsG,
          targetFatG: draft.targetFatG,
          trainingTime: draft.trainingTime,
          stores: draft.stores,
          excludedFoods: draft.excludedFoods,
          restrictionsSnapshot: draft.restrictionsSnapshot,
          avoidNote: note.trim() || null,
          activate: true,
          variants: draft.variants.map(v => ({
            dayType: v.dayType,
            targetCalories: v.targetCalories,
            targetProteinG: v.targetProteinG,
            targetCarbsG: v.targetCarbsG,
            targetFatG: v.targetFatG,
            meals: v.meals.map(m => ({
              position: m.position,
              name: m.name,
              notes: m.notes,
              targetCalories: m.targetCalories,
              targetProteinG: m.targetProteinG,
              targetCarbsG: m.targetCarbsG,
              targetFatG: m.targetFatG,
              // The food itself, so the saved plan can be re-scaled and edited later rather than
              // being a list of names and numbers (Q-192).
              ingredients: m.ingredients,
              suggestedTime: m.suggestedTime,
              savedMealId: m.savedMealId ?? null,
            })),
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? 'Could not save the plan')
        return
      }
      const plan: MealPlan = await res.json()
      await saveTickedMealsToLibrary(draft, saveToLibrary)
      await invalidateMealPlans()
      onSaved(plan)
      onOpenChange(false)
      toast.success('Meal plan saved')
    } catch {
      toast.error('Could not save the plan')
    } finally {
      setSaving(false)
    }
  }

  const canAdvance = step !== REVIEW_STEP || draft != null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* side="bottom" bakes in the bottom inset — never add pb-safe* inside. */}
      <SheetContent side="bottom" className="h-[88vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>{draft ? 'Check this over' : 'New meal plan'}</SheetTitle>
        </SheetHeader>

        <div className="px-4 flex gap-1" role="presentation">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn('h-0.5 flex-1 rounded-full', i <= step ? 'bg-brand' : 'bg-muted')}
            />
          ))}
        </div>
        <p className="px-4 pt-2 text-[11px] tabular-nums text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {STEP_TITLES[step]}
        </p>

        <div className="flex-1 overflow-y-auto px-4 py-3 scrollbar-hide">
          {step === 0 && (
            <ChipGroup
              heading="Where do you shop?"
              hint="Used to bias what the plan suggests — nothing is looked up or tracked."
              options={STORES}
              selected={stores}
              onToggle={v => toggle(stores, setStores, v)}
            />
          )}

          {step === 1 && (
            <RestrictionsPicker
              catalogue={catalogue}
              selected={restrictions}
              onChange={setRestrictions}
              note={note}
              onNoteChange={setNote}
            />
          )}

          {step === 2 && (
            <div className="space-y-5">
              <p className="text-[11px] leading-snug text-muted-foreground">
                Tap anything you would rather not see in the plan.
              </p>
              <ChipGroup heading="Protein" options={PROTEINS} selected={excluded} onToggle={v => toggle(excluded, setExcluded, v)} />
              <ChipGroup heading="Carbs" options={CARBS} selected={excluded} onToggle={v => toggle(excluded, setExcluded, v)} />
              <ChipGroup heading="Fats" options={FATS} selected={excluded} onToggle={v => toggle(excluded, setExcluded, v)} />
              <ChipGroup heading="Vegetables" options={VEG} selected={excluded} onToggle={v => toggle(excluded, setExcluded, v)} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <ChipGroup
                heading="Meals per day"
                options={Array.from({ length: MEAL_COUNT_MAX - MEAL_COUNT_MIN + 1 }, (_, i) => String(MEAL_COUNT_MIN + i))}
                selected={[String(mealCount)]}
                onToggle={v => setMealCount(Number(v))}
              />
              {/* Honest about what the evidence supports — see the plan doc, decision D2. */}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                How many meals you eat makes little difference on its own once the daily totals are
                the same — pick what fits your day. Spreading protein across 3–5 meals is the part
                with support behind it.
              </p>
            </div>
          )}

          {step === 4 && (
            <MyMealsPicker
              selectedIds={keepMealIds}
              onChangeSelected={setKeepMealIds}
              typedMeals={typedMeals}
              onChangeTyped={setTypedMeals}
              mealCount={mealCount}
            />
          )}

          {step === 5 && (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  When do you usually train?
                </p>
                <input
                  type="time"
                  value={trainingTime}
                  onChange={e => setTrainingTime(e.target.value)}
                  aria-label="Usual training time"
                  className="w-full min-h-[48px] rounded-xl border border-border bg-muted/50 px-3 text-sm outline-none"
                />
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  Carbs get weighted toward the meals either side of this. Leave it blank for an
                  even split.
                </p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-medium">Different macros on rest days</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Slightly fewer carbs when you are not training. Protein stays the same.
                  </span>
                </span>
                <Switch checked={splitDays} onCheckedChange={setSplitDays} aria-label="Different macros on rest days" />
              </label>
            </div>
          )}

          {step === REVIEW_STEP && draft && (
            <MealPlanReviewStep
              draft={draft}
              onDraftChange={setDraft}
              saveToLibrary={saveToLibrary}
              onToggleSave={pos => setSaveToLibrary(s => ({ ...s, [pos]: !s[pos] }))}
            />
          )}
          {step === REVIEW_STEP && !draft && (
            <p className="text-sm text-muted-foreground">Generating your plan…</p>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          {step > 0 && (
            <Button variant="secondary" className="flex-1" onClick={() => setStep(s => (s - 1) as StepIndex)}>
              Back
            </Button>
          )}
          {step < 5 && (
            <Button className="flex-1" onClick={() => setStep(s => (s + 1) as StepIndex)}>Next</Button>
          )}
          {step === 5 && (
            <Button className="flex-1" onClick={handleGenerate} disabled={generating}>
              {generating ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Generating…</> : 'Generate plan'}
            </Button>
          )}
          {step === REVIEW_STEP && (
            <>
              <Button variant="secondary" className="flex-1" onClick={handleGenerate} disabled={generating}>
                {generating ? 'Working…' : 'Regenerate'}
              </Button>
              <Button className="flex-1" onClick={handleSave} disabled={saving || !canAdvance}>
                {saving ? 'Saving…' : 'Save plan'}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Persist each ticked meal to the saved-meal library, itemised.
 *
 * Mirrors what the food scan already does: one `food_item` per ingredient carrying its per-100g
 * values, then a `saved_meal` referencing them at the right quantity. That is what makes the saved
 * meal editable later — a single opaque "meal" item could not be adjusted ingredient by ingredient.
 *
 * `quantityMultiplier` is weight ÷ 100 because each item is stored per 100 g, matching how the
 * scan's review step assigns them.
 *
 * Best-effort and never blocks the plan: the plan itself is already saved by the time this runs, so
 * a failure here costs a library entry, not the user's plan.
 */
async function saveTickedMealsToLibrary(
  draft: Draft,
  ticked: Record<number, boolean>,
): Promise<void> {
  const meals = draft.variants[0]?.meals.filter(m => ticked[m.position] && m.ingredients.length > 0) ?? []
  if (meals.length === 0) return

  await Promise.all(meals.map(async meal => {
    try {
      const items = await Promise.all(meal.ingredients.map(async ing => {
        const res = await fetch('/api/nutrition/food-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: ing.name,
            servingSizeG: 100,
            calories: Math.round(ing.caloriesPer100g),
            proteinG: Math.round(ing.proteinPer100g * 10) / 10,
            carbsG: Math.round(ing.carbsPer100g * 10) / 10,
            fatG: Math.round(ing.fatPer100g * 10) / 10,
            source: 'ai',
          }),
        })
        if (!res.ok) throw new Error('food item')
        const item = await res.json()
        return { foodItemId: item.id as string, quantityMultiplier: Math.max(0.01, ing.weightG / 100) }
      }))
      const res = await fetch('/api/nutrition/saved-meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: meal.name, items }),
      })
      if (!res.ok) throw new Error('saved meal')
    } catch {
      toast.error(`Could not save "${meal.name}" to your meals`)
    }
  }))
  await invalidateSavedMeals()
}

const STEP_TITLES = [
  'Where you shop',
  'Anything you avoid',
  'Foods to skip',
  'Meals per day',
  'Meals you already eat',
  'Training time',
  'Check this over',
]

function ChipGroup({ heading, hint, options, selected, onToggle }: {
  heading: string
  hint?: string
  options: string[]
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        {heading}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map(o => {
          const on = selected.includes(o)
          return (
            <button
              key={o}
              onClick={() => onToggle(o)}
              aria-pressed={on}
              className={cn(
                'min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors',
                on
                  ? 'border-brand/50 bg-brand/15 text-brand'
                  : 'border-border bg-muted/50 active:bg-muted/30',
              )}
            >
              {o}
            </button>
          )
        })}
      </div>
      {hint && <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  )
}
