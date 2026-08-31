'use client'

import { useEffect, useState } from 'react'
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MealType, NutritionTargets, FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import type { EditableNutrition } from './review-step'
import { todayInTz } from '@trainingai/shared/date-utils'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { TTL_LONG, NUTRITION_FOOD_LOGS_TTL } from '@trainingai/shared/cache-ttl'
import { NUMBER_INPUT_RESET } from '@/components/ui/input'

interface Props {
  nutrition: EditableNutrition
  preselectedMealTypeId: string | null
  onBack: () => void
  onConfirm: (mealTypeId: string, quantity: number) => Promise<void>
  logDate?: string
}

const QTY_PRESETS = [0.5, 1, 1.5, 2] as const

export function AssignStep({ nutrition, preselectedMealTypeId, onBack, onConfirm, logDate }: Props) {
  const tz = useUserTimezone();
  const [mealTypes, setMealTypes] = useState<MealType[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(preselectedMealTypeId)
  const [quantity, setQuantity] = useState(1)
  const [saving, setSaving] = useState(false)
  const [loadingTypes, setLoadingTypes] = useState(true)
  const [todayCalories, setTodayCalories] = useState<number | null>(null)
  const [calorieTarget, setCalorieTarget] = useState<number | null>(null)

  useEffect(() => {
    const seededTypes = readCacheSync<MealType[]>('nutrition-meal-types')
    if (seededTypes?.length) {
      setMealTypes(seededTypes)
      const hour = new Date().getHours()
      const match = seededTypes.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)
      setSelectedId(prev => prev ?? (match?.id ?? seededTypes[0]?.id ?? null))
      setLoadingTypes(false)
    }
    setCalorieTarget(readCacheSync<NutritionTargets>('nutrition-targets')?.calories ?? null)
    cachedFetch<MealType[]>('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG, (data) => {
      setMealTypes(data)
      const hour = new Date().getHours()
      const match = data.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)
      // functional update: onData fires twice (cached + fresh) — don't clobber a user pick
      setSelectedId(prev => prev ?? (match?.id ?? data[0]?.id ?? null))
    }).catch(() => {}).finally(() => setLoadingTypes(false))
    const targetDate = logDate ?? todayInTz(tz)
    cachedFetch<FoodLogWithItem[]>(
      `nutrition-food-logs-${targetDate}`, `/api/nutrition/food-logs?date=${targetDate}`, NUTRITION_FOOD_LOGS_TTL,
      logs => setTodayCalories(Array.isArray(logs) ? logs.reduce((sum, l) => sum + l.calories, 0) : 0),
    ).catch(() => {})
    cachedFetch<NutritionTargets>('nutrition-targets', '/api/nutrition/targets', TTL_LONG,
      t => setCalorieTarget(t?.calories ?? null),
    ).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logDate])

  const effectiveCals = Math.round(nutrition.calories * quantity)
  const effectiveProtein = Math.round(nutrition.proteinG * quantity * 10) / 10
  const effectiveCarbs = Math.round(nutrition.carbsG * quantity * 10) / 10
  const effectiveFat = Math.round(nutrition.fatG * quantity * 10) / 10

  async function handleConfirm() {
    if (!selectedId) return
    setSaving(true)
    await onConfirm(selectedId, quantity)
    setSaving(false)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm font-semibold mb-2">Meal</p>
        {loadingTypes ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {mealTypes.map(mt => (
              <button
                key={mt.id}
                onClick={() => setSelectedId(mt.id)}
                className={`flex items-center gap-1.5 h-11 rounded-full px-4 text-sm font-medium border transition-colors ${
                  selectedId === mt.id
                    ? 'bg-foreground text-background border-transparent'
                    : 'border-border/60 text-muted-foreground hover:border-border'
                }`}
              >
                <span>{mt.emoji}</span>
                <span>{mt.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold mb-2">Quantity</p>
        <div className="flex items-center gap-2 flex-wrap">
          {QTY_PRESETS.map(p => (
            <button
              key={p}
              onClick={() => setQuantity(p)}
              className={`h-11 rounded-xl px-4 text-sm font-semibold border transition-colors ${
                quantity === p
                  ? 'bg-foreground text-background border-transparent'
                  : 'border-border/60 text-muted-foreground hover:border-border'
              }`}
            >
              ×{p}
            </button>
          ))}
          <input
            type="number"
            step={0.1}
            min={0.1}
            value={quantity}
            onChange={e => setQuantity(Math.min(100, parseFloat(e.target.value) || 1))}
            // `!text-sm`, not `text-sm`: `globals.css` sets `input { font-size: 16px !important }`
            // under 640px to stop iOS zoom, so the plain class was silently doing nothing and the
            // value rendered 16px beside 14px chips — which is the "differently proportioned" half
            // of what the owner reported. Same workaround, and same reason, as `quantity-editor`.
            className={`w-20 h-11 rounded-xl border bg-background px-3 !text-sm tabular-nums text-center ${NUMBER_INPUT_RESET}`}
          />
        </div>
      </div>

      <div className="rounded-xl bg-muted/30 border border-border/40 px-4 py-3 flex gap-4 text-sm">
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <span className="text-base font-bold tabular-nums">{effectiveCals}</span>
          <span className="text-[10px] text-muted-foreground">kcal</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <span className="font-semibold tabular-nums">{effectiveProtein}g</span>
          <span className="text-[10px] text-muted-foreground">protein</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <span className="font-semibold tabular-nums">{effectiveCarbs}g</span>
          <span className="text-[10px] text-muted-foreground">carbs</span>
        </div>
        <div className="flex flex-col items-center gap-0.5 flex-1">
          <span className="font-semibold tabular-nums">{effectiveFat}g</span>
          <span className="text-[10px] text-muted-foreground">fat</span>
        </div>
      </div>

      {todayCalories !== null && calorieTarget !== null && (!logDate || logDate === todayInTz(tz)) && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Today after logging</span>
            <span className="tabular-nums font-medium">
              {todayCalories + effectiveCals} <span className="text-muted-foreground">/ {calorieTarget} kcal</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full w-full rounded-full origin-left transition-transform duration-300 motion-reduce:transition-none ${
                (todayCalories + effectiveCals) > calorieTarget ? 'bg-orange-500' : 'bg-green-500'
              }`}
              style={{ transform: `scaleX(${Math.min(100, Math.round(((todayCalories + effectiveCals) / calorieTarget) * 100)) / 100})` }}
            />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button onClick={onBack} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium">Back</button>
        <Button onClick={handleConfirm} disabled={!selectedId || saving} className="flex-1 gap-2">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Log Food'}
        </Button>
      </div>
    </div>
  )
}
