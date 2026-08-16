'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { NutritionScanResult, NutritionIngredient } from '@trainingai/shared/types/nutrition'
import { sumIngredientEntries } from '@trainingai/shared/nutrition/log-food'

interface EditableNutrition {
  name: string
  brand: string
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  sugarG: number
  sodiumMg: number
  satFatG: number
}

interface BaseNutrition {
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  sugarG: number
  sodiumMg: number
  satFatG: number
}

interface Props {
  result: NutritionScanResult | null
  value: EditableNutrition
  ingredients: NutritionIngredient[]
  onIngredientsChange: (ings: NutritionIngredient[]) => void
  onChange: (v: EditableNutrition) => void
  onRefine: (result: NutritionScanResult) => void
  onBack: () => void
  onNext: () => void
}

const CONFIDENCE_CONFIG: Record<string, { pct: number; bar: string; text: string; label: string }> = {
  high:   { pct: 90, bar: 'bg-green-500',  text: 'text-green-500',  label: '90%' },
  medium: { pct: 60, bar: 'bg-amber-400',  text: 'text-amber-400',  label: '60%' },
  low:    { pct: 30, bar: 'bg-orange-500', text: 'text-orange-500', label: '30%' },
}

function r1(n: number) { return Math.round(n * 10) / 10 }

export function ReviewStep({ result, value, ingredients, onIngredientsChange, onChange, onRefine, onBack, onNext }: Props) {
  const [correction, setCorrection] = useState('')
  const [refining, setRefining] = useState(false)

  // Snapshot base macros per gram so the serving size field can scale everything
  const baseRef = useRef<BaseNutrition | null>(
    value.servingSizeG > 0
      ? { servingSizeG: value.servingSizeG, calories: value.calories, proteinG: value.proteinG, carbsG: value.carbsG, fatG: value.fatG, fiberG: value.fiberG, sugarG: value.sugarG, sodiumMg: value.sodiumMg, satFatG: value.satFatG }
      : null
  )

  // Re-sync base snapshot when a new scan result arrives (e.g. after AI refinement).
  // Ingredients themselves are owned by the parent and reset on each new result.
  useEffect(() => {
    if (value.servingSizeG > 0) {
      baseRef.current = {
        servingSizeG: value.servingSizeG,
        calories:  value.calories,
        proteinG:  value.proteinG,
        carbsG:    value.carbsG,
        fatG:      value.fatG,
        fiberG:    value.fiberG,
        sugarG:    value.sugarG,
        sodiumMg:  value.sodiumMg,
        satFatG:   value.satFatG,
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  function set<K extends keyof EditableNutrition>(key: K, v: EditableNutrition[K]) {
    onChange({ ...value, [key]: v })
  }

  function handleServingChange(newG: number) {
    const b = baseRef.current
    if (!b || b.servingSizeG <= 0 || newG <= 0) { set('servingSizeG', newG); return }
    const scale = newG / b.servingSizeG
    onChange({
      ...value,
      servingSizeG: newG,
      calories:  Math.round(b.calories * scale),
      proteinG:  r1(b.proteinG * scale),
      carbsG:    r1(b.carbsG   * scale),
      fatG:      r1(b.fatG     * scale),
      fiberG:    r1(b.fiberG   * scale),
      sugarG:    r1(b.sugarG   * scale),
      sodiumMg:  Math.round(b.sodiumMg * scale),
      satFatG:   r1(b.satFatG  * scale),
    })
  }

  function handleIngredientWeightChange(idx: number, newWeightG: number) {
    const updated = ingredients.map((ing, i) => i === idx ? { ...ing, weightG: Math.max(0, newWeightG) } : ing)
    onIngredientsChange(updated)
    const totals = sumIngredientEntries(updated)
    // Update base so subsequent serving-size scaling starts from the new totals
    baseRef.current = { ...baseRef.current!, ...totals }
    onChange({ ...value, ...totals })
  }

  async function handleRefine() {
    if (!correction.trim() || refining) return
    setRefining(true)
    try {
      const context = `Previous estimate: ${value.name}${value.brand ? ` (${value.brand})` : ''}, ${value.servingSizeG}g — ${value.calories} kcal, ${value.proteinG}g protein, ${value.carbsG}g carbs, ${value.fatG}g fat.`
      // Same region-hint source the initial scan already uses (capture-step.tsx) — the
      // scan route's response never echoes region back, so read it fresh rather than
      // relying on a (never-populated) result.region.
      const region = localStorage.getItem('ta_food_region') ?? 'AU'
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${context} User correction: "${correction.trim()}". Please recalculate with the updated information.`, region }),
      })
      if (!res.ok) throw new Error()
      const refined: NutritionScanResult = await res.json()
      if ('error' in refined) throw new Error(String((refined as { error: string }).error))
      onRefine(refined)
      setCorrection('')
    } catch {
      toast.error('Could not refine — try rephrasing')
    } finally {
      setRefining(false)
    }
  }

  function numField(label: string, key: keyof EditableNutrition, unit: string, step = 0.1) {
    return (
      <div className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
        <span className="text-sm text-muted-foreground flex-1">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number" step={step} min={0}
            value={value[key] as number}
            onChange={e => set(key, parseFloat(e.target.value) || 0)}
            className="w-20 rounded-lg border bg-background px-2 py-1 text-sm text-right tabular-nums"
          />
          <span className="text-xs text-muted-foreground w-6">{unit}</span>
        </div>
      </div>
    )
  }

  const canSave = value.name.trim().length > 0 && value.calories > 0

  return (
    <div className="flex flex-col gap-4 p-4">
      {result?.confidence && (() => {
        const cfg = CONFIDENCE_CONFIG[result.confidence]
        if (!cfg) return null
        return (
          <div className="rounded-xl bg-muted/40 px-3 py-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">AI confidence</span>
              <span className={`text-xs font-bold tabular-nums ${cfg.text}`}>{cfg.label}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${cfg.bar} transition-all`} style={{ width: `${cfg.pct}%` }} />
            </div>
            {result.notes && <p className="text-[11px] text-muted-foreground leading-snug">{result.notes}</p>}
          </div>
        )
      })()}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Food name</label>
        <input
          type="text" value={value.name}
          onChange={e => set('name', e.target.value)}
          className="rounded-xl border bg-background px-4 py-2.5 text-sm"
          placeholder="Food name" autoFocus={!result}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Brand (optional)</label>
        <input
          type="text" value={value.brand}
          onChange={e => set('brand', e.target.value)}
          className="rounded-xl border bg-background px-4 py-2.5 text-sm"
          placeholder="Brand"
        />
      </div>

      {/* Ingredients — only shown for multi-ingredient AI scans */}
      {ingredients.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Ingredients <span className="opacity-60">— each is logged as its own item; adjust weights to update macros</span></p>
          <div className="rounded-xl border bg-muted/20 px-4 pt-2 pb-1">
            {ingredients.map((ing, idx) => (
              <div key={ing.clientId ?? idx} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                <span className="text-sm flex-1 truncate">{ing.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number" step={5} min={0}
                    value={ing.weightG}
                    onChange={e => handleIngredientWeightChange(idx, parseFloat(e.target.value) || 0)}
                    className="w-20 rounded-lg border bg-background px-2 py-1 text-sm text-right tabular-nums"
                  />
                  <span className="text-xs text-muted-foreground w-4">g</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Macro totals */}
      <div className="rounded-xl border bg-muted/20 px-4 pt-2 pb-1">
        <div className="flex items-center gap-3 py-2 border-b border-border/30">
          <span className="text-sm flex-1">
            Serving size
            {ingredients.length === 0 && <span className="text-[10px] text-muted-foreground ml-1">scales macros</span>}
          </span>
          <div className="flex items-center gap-1">
            <input
              type="number" step={1} min={1}
              value={value.servingSizeG}
              onChange={e => handleServingChange(parseFloat(e.target.value) || 0)}
              readOnly={ingredients.length > 0}
              className={`w-20 rounded-lg border px-2 py-1 text-sm text-right tabular-nums ${ingredients.length > 0 ? 'bg-muted/40 text-muted-foreground' : 'bg-background'}`}
            />
            <span className="text-xs text-muted-foreground w-6">g</span>
          </div>
        </div>
        {numField('Calories', 'calories', 'kcal', 1)}
        {numField('Protein', 'proteinG', 'g')}
        {numField('Carbohydrates', 'carbsG', 'g')}
        {numField('Fat', 'fatG', 'g')}
        {numField('Fiber', 'fiberG', 'g')}
        {numField('Sugar', 'sugarG', 'g')}
        {numField('Sodium', 'sodiumMg', 'mg', 1)}
        {numField('Saturated fat', 'satFatG', 'g')}
      </div>

      {/* AI correction box — only shown when result came from AI */}
      {result && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Correct the AI estimate</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={correction}
              onChange={e => setCorrection(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRefine()}
              placeholder={`e.g. "actually it's 200g chicken not 300g"`}
              disabled={refining}
              className="flex-1 rounded-xl border bg-background px-3 py-2 text-sm disabled:opacity-50"
            />
            <Button
              onClick={handleRefine}
              disabled={!correction.trim() || refining}
              className="shrink-0 gap-1.5"
            >
              {refining
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </Button>
          </div>
        </div>
      )}


      <div className="flex gap-2 pt-2">
        <button onClick={onBack} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium">Back</button>
        <Button onClick={onNext} disabled={!canSave} className="flex-1">
          Next
        </Button>
      </div>
    </div>
  )
}

export type { EditableNutrition }
