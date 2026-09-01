'use client'

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { FoodLogWithItem } from '@trainingai/shared/types/nutrition'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { invalidateNutritionWrite } from '@/lib/cache-groups'
import { QuantityEditor } from './quantity-editor'
import { qtyFromInput, steppedQty, type QtyUnit } from './saved-meal-qty'

interface Props {
  log: FoodLogWithItem | null
  onClose: () => void
  onSaved: (updatedLog: FoodLogWithItem) => void
  /** Removing the log. It lives here because Q-406's shared row carries no controls — without a
   *  delete in the sheet, converting the diary row would take away the only way to remove a logged
   *  food, which is LB-1's failure exactly. */
  onDelete: (logId: string) => void
  userId?: string
}

export function QuickEditLogSheet({ log, onClose, onSaved, onDelete, userId }: Props) {
  const [qty, setQty] = useState(() => log?.quantityMultiplier ?? 1)
  const [unit, setUnit] = useState<QtyUnit>('serving')
  const [saving, setSaving] = useState(false)

  const item = log?.foodItem
  const r1 = (n: number) => Math.round(n * 10) / 10
  const previewCals    = item ? Math.round(item.calories  * qty) : 0
  const previewProtein = item ? r1(item.proteinG * qty) : 0
  const previewCarbs   = item ? r1(item.carbsG   * qty) : 0
  const previewFat     = item ? r1(item.fatG     * qty) : 0

  // BF-26: the same arithmetic the builder's sheet uses, so grams and servings cannot diverge
  // between the two. `null` from either helper means "the input does not apply" — here that is a
  // no-op rather than the builder's "remove the row", because this sheet has an explicit bin.
  const servingG = item?.servingSizeG ?? 0
  function handleQtyChange(raw: string) {
    const next = qtyFromInput(raw, unit, servingG)
    if (next != null) setQty(next)
  }
  function handleStep(direction: 1 | -1) {
    const next = steppedQty(qty, unit, direction, servingG)
    if (next != null) setQty(next)
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
      <SheetContent side="bottom" surface="page" className="rounded-t-2xl flex flex-col gap-0 p-0">
        <SheetTitle className="sr-only">Edit Serving</SheetTitle>
        <div className="flex items-start justify-between px-4 pt-4 pb-3">
          <div>
            <p className="font-semibold text-base leading-tight">{item?.name}</p>
            {item?.brand && <p className="text-xs text-muted-foreground mt-0.5">{item.brand}</p>}
          </div>
        </div>

        <div className="space-y-4 px-4 pb-4">
          {item && (
            <QuantityEditor
              item={item}
              qty={qty}
              unit={unit}
              onUnitChange={setUnit}
              onQtyChange={handleQtyChange}
              onStep={handleStep}
            />
          )}

          <div className="flex gap-2">
            <button
              onClick={() => { if (log) { onClose(); onDelete(log.id) } }}
              aria-label={`Remove ${item?.name ?? 'this food'}`}
              className="flex min-h-12 w-12 flex-none items-center justify-center rounded-xl bg-destructive/10 active:bg-destructive/20 transition-colors"
            >
              <Trash2 className="h-5 w-5 text-destructive" />
            </button>
            {/* BF-26: no Cancel. Artboard 6 has none, and this sheet already has two ways out —
                the X that `SheetContent` renders and the back gesture (BF-27) — so a third sitting
                next to a bin was the ambiguous control, not a safety net. Nothing is written until
                Save, so leaving by any of them discards the edit. */}
            <Button onClick={handleSave} disabled={saving} className="h-12 flex-1 font-semibold">
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
