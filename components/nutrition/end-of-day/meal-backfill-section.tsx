'use client'

import { useState } from 'react'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { Loader2, Send, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { MealType, FoodLogWithItem, NutritionScanResult } from '@trainingai/shared/types/nutrition'
import { logFoodEntries, scanResultToEntries } from '@trainingai/shared/nutrition/log-food'
import { hapticLight } from '@/lib/haptics'

interface Props {
  mealTypes: MealType[]
  logs: FoodLogWithItem[]
  date: string
  userId?: string
  onLogged: (log?: FoodLogWithItem) => void
}

export function MealBackfillSection({ mealTypes, logs, date, userId, onLogged }: Props) {
  // Q-413: the eaten-at resolution happens in the USER's zone, not the device's.
  const tz = useUserTimezone()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const logsByMeal = new Map<string, FoodLogWithItem[]>()
  for (const l of logs) {
    const arr = logsByMeal.get(l.mealTypeId) ?? []
    arr.push(l)
    logsByMeal.set(l.mealTypeId, arr)
  }

  async function handleLog(mt: MealType) {
    const text = (drafts[mt.id] ?? '').trim()
    if (!text || busy) return
    setBusy(mt.id)
    try {
      const region = localStorage.getItem('ta_food_region') ?? 'AU'
      const res = await fetch('/api/nutrition/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, region }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Could not identify food — try rephrasing')
        return
      }
      const entries = scanResultToEntries(data as NutritionScanResult, 1)
      const newLogs = await logFoodEntries(entries, date, mt.id, userId, tz)
      for (const log of newLogs) onLogged(log)
      setDrafts(d => ({ ...d, [mt.id]: '' }))
      hapticLight()
      toast.success(entries.length > 1 ? `${entries.length} items added to ${mt.name}` : `Added to ${mt.name}`)
    } catch {
      toast.error('Failed to log food')
    } finally {
      setBusy(null)
    }
  }

  if (mealTypes.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-6">No meals configured yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {mealTypes.map(mt => {
        const mealLogs = logsByMeal.get(mt.id) ?? []
        const logged = mealLogs.length > 0
        const isBusy = busy === mt.id
        return (
          <div key={mt.id} className="rounded-2xl border border-border bg-muted/40 overflow-hidden">
            <div className="flex items-center gap-3 px-4 pt-3.5 pb-2">
              <span className="text-xl leading-none">{mt.emoji}</span>
              <span className="text-sm font-semibold flex-1">{mt.name}</span>
              {logged ? (
                <span className="flex items-center gap-1 text-[11px] text-green-500 font-medium">
                  <Check className="w-3.5 h-3.5" /> Logged
                </span>
              ) : mt.required ? (
                <span className="text-[11px] text-amber-500 font-medium">Not logged</span>
              ) : null}
            </div>

            {logged && (
              <div className="px-4 pb-2 flex flex-col gap-1">
                {mealLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground truncate">{log.foodItem.name}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0">{Math.round(log.calories)} kcal</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2 px-4 pb-3.5 pt-1">
              <input
                type="text"
                value={drafts[mt.id] ?? ''}
                onChange={e => setDrafts(d => ({ ...d, [mt.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleLog(mt)}
                placeholder={`What did you have for ${mt.name.toLowerCase()}?`}
                disabled={isBusy}
                className="flex-1 rounded-xl border bg-background px-3 py-2.5 text-sm disabled:opacity-50"
              />
              <Button
                onClick={() => handleLog(mt)}
                disabled={!(drafts[mt.id] ?? '').trim() || isBusy}
                className="shrink-0 h-11 w-11 p-0"
                aria-label={`Log ${mt.name}`}
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
