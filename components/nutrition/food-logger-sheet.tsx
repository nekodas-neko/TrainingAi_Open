'use client'

import { useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { X } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { ReviewStep, type EditableNutrition } from './review-step'
import { AssignStep } from './assign-step'
import { SavedMealsSheet } from './saved-meals-sheet'
import type { NutritionScanResult, NutritionIngredient, FoodItem, FoodLogWithItem, SavedMeal, MealType } from '@trainingai/shared/types/nutrition'
import type { SharedMeal } from '@trainingai/shared/nutrition/label-payload'
import { saveSharedMealToLibrary } from './save-shared-meal'
import { todayInTz } from '@trainingai/shared/date-utils'
import { mealTypeForHour } from '@trainingai/shared/nutrition/log-plan-meal'
import { logMealItems } from '@trainingai/shared/nutrition/log-meal'
import { scanOriginToSource, logFoodEntries, ingredientsToEntries, type NewFoodEntry } from '@trainingai/shared/nutrition/log-food'
import { readCacheSync } from '@/lib/sqlite/cache'
import { getLocalStore } from '@/lib/local-store'
import { hapticLight } from '@/lib/haptics'
import { toast } from 'sonner'

/**
 * `capture` is drawn by `SavedMealsSheet`, not by the sheet below (LB-16).
 *
 * That sheet owns the list, the builder and four nested sheets, so the capture screen went to it
 * rather than the ownership layer coming here. The consequence worth stating: at `capture` this
 * component renders **no sheet of its own** — one screen is one sheet is one back-stack layer, and
 * an empty shell behind the list would have been a wasted press for the user to discover.
 */
type Step = 'capture' | 'review' | 'assign'

const STEP_LABELS: Record<Step, string> = {
  capture: 'Log Food',
  review: 'Review',
  assign: 'Assign to Meal',
}

const BLANK: EditableNutrition = {
  name: '', brand: '', servingSizeG: 100, calories: 0,
  proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sugarG: 0, sodiumMg: 0, satFatG: 0,
}

function scanToEditable(s: NutritionScanResult): EditableNutrition {
  return {
    name: s.name ?? '',
    brand: s.brand ?? '',
    servingSizeG: s.servingSizeG ?? 100,
    calories: s.calories ?? 0,
    proteinG: s.proteinG ?? 0,
    carbsG: s.carbsG ?? 0,
    fatG: s.fatG ?? 0,
    fiberG: s.fiberG ?? 0,
    sugarG: s.sugarG ?? 0,
    sodiumMg: s.sodiumMg ?? 0,
    satFatG: s.satFatG ?? 0,
    imageDataUri: s.imageDataUri ?? null,
  }
}

function itemToEditable(item: FoodItem): EditableNutrition {
  return {
    name: item.name,
    brand: item.brand ?? '',
    servingSizeG: item.servingSizeG,
    calories: item.calories,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
    fiberG: item.fiberG ?? 0,
    sugarG: item.sugarG ?? 0,
    sodiumMg: item.sodiumMg ?? 0,
    satFatG: item.satFatG ?? 0,
  }
}

interface Props {
  open: boolean
  preselectedMealTypeId?: string | null
  onClose: () => void
  onLogged: (newLog?: FoodLogWithItem) => void
  userId?: string
  logDate?: string
  /**
   * Open on the `Meals` tab rather than `Recent` (Q-395c, LB-16, BF-37).
   *
   * `/nutrition`'s library button used to open `SavedMealsSheet` directly. It cannot: a food's tap
   * needs the **assign** step, which lives here. It now selects a tab rather than opening a second
   * sheet, so the button is a deep link into one screen rather than a second way in.
   */
  openLibrary?: boolean
}

export function FoodLoggerSheet({ open, preselectedMealTypeId = null, onClose, onLogged, userId, logDate, openLibrary }: Props) {
  // Q-413: the eaten-at resolution happens in the USER's zone, not the device's.
  const tz = useUserTimezone()
  const [stepStack, setStepStack] = useState<Step[]>(['capture'])
  const step = stepStack[stepStack.length - 1]

  const pushStep = (newStep: Step) => setStepStack(prev => [...prev, newStep])
  const popStep = () => setStepStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
  const resetStep = () => setStepStack(['capture'])

  const [scanResult, setScanResult] = useState<NutritionScanResult | null>(null)
  const [ingredients, setIngredients] = useState<NutritionIngredient[]>([])
  const [form, setForm] = useState<EditableNutrition>(BLANK)

  // When logging from the food library we already have the food item — skip creation
  const [libraryItemId, setLibraryItemId] = useState<string | null>(null)

  function reset() {
    resetStep()
    setScanResult(null)
    setIngredients([])
    setForm(BLANK)
    setLibraryItemId(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function withClientIds(ings: NutritionIngredient[] | undefined): NutritionIngredient[] {
    return (ings ?? []).map(ing => ({ ...ing, clientId: crypto.randomUUID() }))
  }

  function handleScanResult(result: NutritionScanResult) {
    setScanResult(result)
    setIngredients(withClientIds(result.ingredients))
    setForm(scanToEditable(result))
    setLibraryItemId(null)
    pushStep('review')
  }

  function handleRefine(result: NutritionScanResult) {
    setScanResult(result)
    setIngredients(withClientIds(result.ingredients))
    setForm(scanToEditable(result))
  }

  function handleManual() {
    setScanResult(null)
    setIngredients([])
    setForm(BLANK)
    setLibraryItemId(null)
    pushStep('review')
  }

  function handleLibrarySelect(item: FoodItem) {
    setLibraryItemId(item.id)
    setIngredients([])
    setForm(itemToEditable(item))
    setScanResult(null)
    pushStep('assign')
  }

  async function handleConfirm(mealTypeId: string, quantity: number) {
    try {
      let entries: NewFoodEntry[]
      if (libraryItemId) {
        // Existing library item — log it as-is without recreating.
        entries = [{
          foodItemId: libraryItemId,
          name: form.name.trim(), brand: form.brand.trim() || undefined,
          servingSizeG: form.servingSizeG, calories: form.calories,
          proteinG: form.proteinG, carbsG: form.carbsG, fatG: form.fatG,
          fiberG: form.fiberG, sugarG: form.sugarG, sodiumMg: form.sodiumMg, satFatG: form.satFatG,
          source: 'manual', quantityMultiplier: quantity,
        }]
      } else if (ingredients.length > 1) {
        // Multi-ingredient meal — log each component as its own entry.
        entries = ingredientsToEntries(ingredients, quantity)
      } else {
        entries = [{
          name: form.name.trim(), brand: form.brand.trim() || undefined,
          servingSizeG: form.servingSizeG, calories: form.calories,
          proteinG: form.proteinG, carbsG: form.carbsG, fatG: form.fatG,
          fiberG: form.fiberG, sugarG: form.sugarG, sodiumMg: form.sodiumMg, satFatG: form.satFatG,
          source: scanOriginToSource(scanResult?.origin, scanResult?.confidence),
          quantityMultiplier: quantity,
          imageDataUri: form.imageDataUri ?? null,
        }]
      }

      const today = logDate ?? todayInTz(tz)
      const logs = await logFoodEntries(entries, today, mealTypeId, userId, tz)

      hapticLight()
      toast.success(entries.length > 1 ? `${entries.length} items logged` : `${form.name} logged`)
      reset()
      onClose()
      for (const log of logs) onLogged(log)
    } catch {
      toast.error('Failed to log food')
    }
  }

  /**
   * A scanned saved-meal label (Q-389).
   *
   * Resolves LOCAL-FIRST because a label is scanned in a kitchen, which is exactly where the network
   * is not — and `logMealItems` is offline-first on the other side, so a server-only lookup here
   * would be the one link that breaks it.
   *
   * `logMealItems` iterates `oneServingItems`, so this logs **one serving**, never the whole batch.
   * That is the contract the printed label depends on: the owner removed the per-serving line, so
   * the label cannot say which basis its figures are on and the app has to settle it instead.
   */
  async function handleScannedSavedMeal(mealId: string) {
    try {
      const store = userId ? getLocalStore(userId) : null
      let meal = store ? (await store.getSavedMeals()).find(m => m.id === mealId) ?? null : null
      if (!meal) {
        const res = await fetch('/api/nutrition/saved-meals')
        if (res.ok) {
          const list = (await res.json()) as SavedMeal[]
          meal = list.find(m => m.id === mealId) ?? null
        }
      }
      // **Two different things land here and the old copy asserted the wrong one** (BF-57). This
      // branch resolves an id against the SCANNING user's own meals, so it is reached both when the
      // owner deleted their meal and when someone else's pre-BF-57 label is scanned — where the meal
      // exists perfectly well and simply is not theirs. "No longer exists" is false in the second
      // case, and it is the case that matters now that labels get handed to people. Name both, and
      // point at the fix: a re-printed label carries the meal itself and needs no account at all.
      if (!meal) {
        toast.error('That meal is not in your library', {
          description: 'It was deleted, or the label was printed by someone else. Newer labels carry the whole meal — ask them to share a fresh one.',
        })
        return
      }

      // The same cache key the nutrition screens fill (TTL_LONG), so this is warm offline. The
      // local store's own getMealTypes returns a narrower row type than mealTypeForHour wants.
      let mealTypes = readCacheSync<MealType[]>('nutrition-meal-types') ?? []
      if (mealTypes.length === 0) {
        const r = await fetch('/api/nutrition/meal-types')
        if (r.ok) mealTypes = (await r.json()) as MealType[]
      }
      const bucket = preselectedMealTypeId ?? mealTypeForHour(mealTypes, new Date().getHours())
      if (!bucket) { toast.error('No meal type available'); return }

      const logs = await logMealItems(meal, logDate ?? todayInTz(tz), bucket, userId, tz)
      hapticLight()
      toast.success(`${meal.name} logged`)
      reset()
      onClose()
      for (const log of logs) onLogged(log)
    } catch (err) {
      console.error('Scanned meal log failed:', err)
      toast.error('Failed to log that meal')
    }
  }

  /**
   * A scanned label that carries the whole recipe (BF-57).
   *
   * Nothing is fetched and nothing is resolved: the payload *is* the meal, which is what makes this
   * work in a kitchen with no signal and for someone who has never had an account here. It saves a
   * COPY into the scanner's own library rather than logging it, because the two are different asks
   * — a shared recipe is something you keep and cook again, and logging it immediately would put a
   * meal in today's diary that nobody said they had eaten.
   */
  async function handleScannedSharedMeal(shared: SharedMeal) {
    try {
      const { name } = await saveSharedMealToLibrary(shared, userId, tz)
      hapticLight()
      toast.success(`${name} saved to your meals`, {
        description: shared.rolled > 0
          // Said out loud rather than buried: the numbers are exact, but a scanner who later opens
          // the meal will find fewer ingredient rows than the author's, and finding that out by
          // surprise reads as data loss.
          ? `Calories and macros are exact. ${shared.rolled} ingredient${shared.rolled === 1 ? '' : 's'} arrived grouped into one entry.`
          : undefined,
      })
      reset()
      onClose()
    } catch (err) {
      console.error('Shared meal save failed:', err)
      toast.error('Could not save that meal')
    }
  }

  return (
    <>
      {/* Not `open` — `step !== 'capture'`. The capture screen is the sheet below, so opening this
          one too would stack an empty shell behind it and cost a back press to get through. */}
      <Sheet open={open && step !== 'capture'} onOpenChange={o => !o && handleClose()}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col p-0 bg-secondary border-t border-border/70" hideCloseButton>
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
            <SheetTitle asChild><h2 className="text-base font-semibold">{STEP_LABELS[step]}</h2></SheetTitle>
            <button onClick={handleClose} aria-label="Close" className="p-2.5 text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Step indicator (only on review/assign steps) */}
          {step !== 'capture' && (
            <div className="flex gap-1 px-4 pb-3 shrink-0">
              {(['capture', 'review', 'assign'] as Step[]).map((s, i) => (
                <div
                  key={s}
                  className={`h-1 flex-1 rounded-full transition-colors ${
                    step === s ? 'bg-foreground' : i < ['capture', 'review', 'assign'].indexOf(step) ? 'bg-foreground/40' : 'bg-muted'
                  }`}
                />
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {step === 'review' && (
              <ReviewStep
                result={scanResult}
                value={form}
                ingredients={ingredients}
                onIngredientsChange={setIngredients}
                onChange={setForm}
                onRefine={handleRefine}
                onBack={() => popStep()}
                onNext={() => pushStep('assign')}
              />
            )}
            {step === 'assign' && (
              <AssignStep
                nutrition={form}
                preselectedMealTypeId={preselectedMealTypeId}
                onBack={() => popStep()}
                onConfirm={handleConfirm}
                logDate={logDate}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* The capture screen itself (LB-16). Closing it closes the logger: it is the first step, so
          there is nothing behind it to go back to. */}
      <SavedMealsSheet
        open={open && step === 'capture'}
        onOpenChange={v => { if (!v) handleClose() }}
        onLogged={(log) => { reset(); onClose(); onLogged(log) }}
        userId={userId}
        logDate={logDate}
        preselectedMealTypeId={preselectedMealTypeId ?? undefined}
        onSelectFood={handleLibrarySelect}
        onScanResult={handleScanResult}
        onManual={handleManual}
        onScannedSavedMeal={handleScannedSavedMeal}
        onScannedSharedMeal={handleScannedSharedMeal}
        openOnMeals={openLibrary}
      />
    </>
  )
}
