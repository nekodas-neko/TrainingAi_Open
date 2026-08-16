'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { CaptureStep } from './capture-step'
import { ReviewStep, type EditableNutrition } from './review-step'
import { AssignStep } from './assign-step'
import { SavedMealsSheet } from './saved-meals-sheet'
import { FoodLibrarySheet } from './food-library-sheet'
import type { NutritionScanResult, NutritionIngredient, FoodItem, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { todayInTz } from '@trainingai/shared/date-utils'
import { logFoodEntries, ingredientsToEntries, type NewFoodEntry } from '@trainingai/shared/nutrition/log-food'
import { useSheetBackDismiss } from '@/lib/hooks/use-sheet-back-dismiss'
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
  useSheetBackDismiss(open, () => { reset(); onClose() })
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

      const today = logDate ?? todayInTz()
      const logs = await logFoodEntries(entries, today, mealTypeId, userId)

      hapticLight()
      toast.success(entries.length > 1 ? `${entries.length} items logged` : `${form.name} logged`)
      reset()
      onClose()
      for (const log of logs) onLogged(log)
    } catch {
      toast.error('Failed to log food')
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
