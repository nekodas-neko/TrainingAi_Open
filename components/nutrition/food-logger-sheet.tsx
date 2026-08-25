'use client'

import { useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { X } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CaptureStep } from './capture-step'
import { ReviewStep, type EditableNutrition } from './review-step'
import { AssignStep } from './assign-step'
import { SavedMealsSheet } from './saved-meals-sheet'
import { FoodLibrarySheet } from './food-library-sheet'
import type { NutritionScanResult, NutritionIngredient, FoodItem, FoodLogWithItem, SavedMeal, MealType } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'
import { mealTypeForHour } from '@trainingai/shared/nutrition/log-plan-meal'
import { logMealItems } from '@trainingai/shared/nutrition/log-meal'
import { logFoodEntries, ingredientsToEntries, type NewFoodEntry } from '@trainingai/shared/nutrition/log-food'
import { readCacheSync } from '@/lib/sqlite/cache'
import { getLocalStore } from '@/lib/local-store'
import { hapticLight } from '@/lib/haptics'
import { toast } from 'sonner'

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
}

export function FoodLoggerSheet({ open, preselectedMealTypeId = null, onClose, onLogged, userId, logDate }: Props) {
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
  const [showSavedMeals, setShowSavedMeals] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  // When logging from the food library we already have the food item — skip creation
  const [libraryItemId, setLibraryItemId] = useState<string | null>(null)

  function reset() {
    resetStep()
    setScanResult(null)
    setIngredients([])
    setForm(BLANK)
    setShowSavedMeals(false)
    setShowLibrary(false)
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
          source: scanResult?.confidence ? 'ai' : 'manual', quantityMultiplier: quantity,
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
      // A physical label outlives the row behind it. Say so, rather than falling through to a
      // barcode "not found" that names the wrong thing.
      if (!meal) { toast.error('That saved meal no longer exists'); return }

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

  return (
    <>
      <Sheet open={open} onOpenChange={o => !o && handleClose()}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col p-0 bg-secondary border-t border-border/70" hideCloseButton>
          <SheetTitle className="sr-only">{STEP_LABELS[step]}</SheetTitle>
          <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
            <h2 className="text-base font-semibold">{STEP_LABELS[step]}</h2>
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
            {step === 'capture' && (
              <CaptureStep
                onScanResult={handleScanResult}
                onManual={handleManual}
                onMyFoods={() => setShowLibrary(true)}
                onSavedMeals={() => setShowSavedMeals(true)}
                preselectedMealTypeId={preselectedMealTypeId}
                onLibrarySelect={handleLibrarySelect}
                userId={userId}
                onScannedSavedMeal={handleScannedSavedMeal}
              />
            )}
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

      <SavedMealsSheet
        open={showSavedMeals}
        onOpenChange={v => { if (!v) setShowSavedMeals(false) }}
        onLogged={(log) => { reset(); onClose(); onLogged(log) }}
        userId={userId}
        logDate={logDate}
        preselectedMealTypeId={preselectedMealTypeId ?? undefined}
      />

      <FoodLibrarySheet
        open={showLibrary}
        onClose={() => setShowLibrary(false)}
        onSelect={handleLibrarySelect}
        userId={userId}
      />
    </>
  )
}
