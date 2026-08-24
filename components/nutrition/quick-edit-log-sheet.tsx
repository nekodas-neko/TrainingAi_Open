'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { useSheetBackDismiss } from '@/lib/hooks/use-sheet-back-dismiss'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateNutritionWrite } from '@/lib/cache-groups'

interface Props {
  log: FoodLogWithItem | null
  onClose: () => void
  onSaved: (updatedLog: FoodLogWithItem) => void
  userId?: string
}

const PRESETS = [0.5, 1, 1.5, 2, 3]

export function QuickEditLogSheet({ log, onClose, onSaved, userId }: Props) {
  const [qty, setQty] = useState(() => log?.quantityMultiplier ?? 1)
  const [saving, setSaving] = useState(false)
  useSheetBackDismiss(!!log, onClose)

  const item = log?.foodItem
  const r1 = (n: number) => Math.round(n * 10) / 10
  const previewCals    = item ? Math.round(item.calories  * qty) : 0
  const previewProtein = item ? r1(item.proteinG * qty) : 0
  const previewCarbs   = item ? r1(item.carbsG   * qty) : 0
  const previewFat     = item ? r1(item.fatG     * qty) : 0

  function adjustQty(delta: number) {
    setQty(q => Math.max(0.5, r1(q + delta)))
  }

  async function handleSave() {
    setSaving(true)
    const store = userId ? getLocalStore(userId) : null
    let savedLocally = false
    if (store && log) {
      try {
        const now = new Date().toISOString()
        await store.upsertFoodLog({
          id: log.id,
          date: log.date,
          mealTypeId: log.mealTypeId,
          foodItemId: log.foodItemId,
          quantityMultiplier: qty,
          loggedAt: log.loggedAt instanceof Date ? log.loggedAt.toISOString() : String(log.loggedAt),
          updatedAt: now,
          deletedAt: null,
          syncStatus: 'pending',
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'food_logs',
          date: log.date,
          payload: { id: log.id, mealTypeId: log.mealTypeId, foodItemId: log.foodItemId, quantityMultiplier: qty, loggedAt: log.loggedAt instanceof Date ? log.loggedAt.toISOString() : String(log.loggedAt) },
        })
        const updatedLog: FoodLogWithItem = {
          ...log,
          quantityMultiplier: qty,
          calories: previewCals, proteinG: previewProtein, carbsG: previewCarbs, fatG: previewFat,
        }
        toast.success('Updated')
        onClose()
        invalidateNutritionWrite().catch(() => {})
        onSaved(updatedLog)
        pushThenRevalidate(userId!, invalidateNutritionWrite)
        savedLocally = true
      } catch (sqliteErr) {
        console.error('Food log edit SQLite write failed, falling back to API:', sqliteErr)
      }
    }
    if (savedLocally) { setSaving(false); return }
    // Web fallback
    try {
      const res = await fetch(`/api/nutrition/food-logs/${log!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantityMultiplier: qty }),
      })
      if (!res.ok) throw new Error()
      const updatedLog: FoodLogWithItem = {
        ...log!,
        quantityMultiplier: qty,
        calories: previewCals, proteinG: previewProtein, carbsG: previewCarbs, fatG: previewFat,
      }
      toast.success('Updated')
      await invalidateNutritionWrite()
      onSaved(updatedLog)
      onClose()
    } catch {
      toast.error('Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={!!log} onOpenChange={o => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-2xl flex flex-col gap-0 p-0">
        <SheetTitle className="sr-only">Edit Serving</SheetTitle>
        <div className="flex items-start justify-between px-4 pt-4 pb-3">
          <div>
            <p className="font-semibold text-base leading-tight">{item?.name}</p>
            {item?.brand && <p className="text-xs text-muted-foreground mt-0.5">{item.brand}</p>}
            <p className="text-xs text-muted-foreground mt-0.5">{item?.servingSizeG}g per serving</p>
          </div>
        </div>

        <div className="px-4 space-y-4 pb-4">
          {/* Quantity stepper */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => adjustQty(-0.5)}
              disabled={qty <= 0.5}
              aria-label="Decrease quantity"
              className="w-11 h-11 rounded-xl border text-xl font-bold flex items-center justify-center disabled:opacity-30 active:bg-muted transition-colors"
            >−</button>
            <div className="flex-1 text-center">
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={qty}
                onChange={e => setQty(Math.min(100, Math.max(0.5, parseFloat(e.target.value) || 0.5)))}
                className="w-24 rounded-xl border bg-background px-3 py-2 text-center text-xl font-bold tabular-nums"
              />
              <p className="text-xs text-muted-foreground mt-1">servings</p>
            </div>
            <button
              onClick={() => adjustQty(0.5)}
              aria-label="Increase quantity"
              className="w-11 h-11 rounded-xl border text-xl font-bold flex items-center justify-center active:bg-muted transition-colors"
            >+</button>
          </div>

          {/* Preset chips */}
          <div className="flex gap-2">
            {PRESETS.map(p => (
              <button
                key={p}
                onClick={() => setQty(p)}
                className={`flex-1 rounded-full py-1.5 text-xs font-semibold border transition-colors ${
                  qty === p
                    ? 'bg-foreground text-background border-foreground'
                    : 'border-border text-muted-foreground active:bg-muted'
                }`}
              >
                ×{p}
              </button>
            ))}
          </div>

          {/* Live macro preview */}
          <div className="rounded-xl bg-muted/40 p-3 grid grid-cols-4 gap-1 text-center">
            {[
              { label: 'kcal',    val: previewCals,    unit: '' },
              { label: 'protein', val: previewProtein, unit: 'g' },
              { label: 'carbs',   val: previewCarbs,   unit: 'g' },
              { label: 'fat',     val: previewFat,     unit: 'g' },
            ].map(({ label, val, unit }) => (
              <div key={label}>
                <p className="text-base font-bold tabular-nums">{val}{unit}</p>
                <p className="text-[10px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium">
              Cancel
            </button>
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
