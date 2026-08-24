'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { invalidateBodyMetricWrite } from '@/lib/cache-groups'
import { getLocalStore } from '@/lib/local-store'
import { pushThenRevalidate } from '@/lib/local-store/push-then-revalidate'
import { todayInTz } from '@trainingai/shared/date-utils'
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { cn } from '@trainingai/shared/utils'
import { metricBoundError } from '@/components/health/metric-bounds'

const QUICK_ADD_ML = [150, 250, 330, 500, 750, 1000]

interface WaterLogSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogged: (ml: number) => void
  userId?: string
}

export function WaterLogSheet({ open, onOpenChange, onLogged, userId }: WaterLogSheetProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const tz = useUserTimezone()

  async function handleSave(ml: number) {
    if (ml <= 0 || ml > 5000) return
    setSaving(true)
    const store = userId ? getLocalStore(userId) : null
    let savedLocally = false
    if (store) {
      try {
        const today = todayInTz(tz)
        const existing = (await store.getBodyMetrics(today)).find(r => r.date === today)
        const newWaterMl = (existing?.waterMl ?? 0) + ml
        await store.upsertBodyMetric({
          date: today,
          weightKg: existing?.weightKg ?? null,
          bodyFatPct: existing?.bodyFatPct ?? null,
          steps: existing?.steps ?? null,
          calories: existing?.calories ?? null,
          proteinG: existing?.proteinG ?? null,
          carbsG: existing?.carbsG ?? null,
          fatG: existing?.fatG ?? null,
          waterMl: newWaterMl,
          restingHeartRate: existing?.restingHeartRate ?? null,
          hrvMs: existing?.hrvMs ?? null,
          spo2Pct: existing?.spo2Pct ?? null,
          distanceKm: existing?.distanceKm ?? null,
          waistCm: existing?.waistCm ?? null,
          chestCm: existing?.chestCm ?? null,
          armCm: existing?.armCm ?? null,
          thighCm: existing?.thighCm ?? null,
          hipCm: existing?.hipCm ?? null,
          neckCm: existing?.neckCm ?? null,
          skeletalMusclePct: existing?.skeletalMusclePct ?? null,
          fatFreeMassKg: existing?.fatFreeMassKg ?? null,
          subcutaneousFatPct: existing?.subcutaneousFatPct ?? null,
          visceralFatIndex: existing?.visceralFatIndex ?? null,
          bodyWaterPct: existing?.bodyWaterPct ?? null,
          muscleMassKg: existing?.muscleMassKg ?? null,
          boneMassKg: existing?.boneMassKg ?? null,
          proteinPct: existing?.proteinPct ?? null,
          bmrKcal: existing?.bmrKcal ?? null,
          metabolicAge: existing?.metabolicAge ?? null,
          updatedAt: new Date().toISOString(),
          deletedAt: null,
          syncStatus: 'pending',
        })
        // Queue the delta, not the merged absolute total — the push branch applies
        // it via incrementWaterLog, matching the web route's add semantics
        // (SYNC-P7: previously the push wrote an absolute total via upsertBodyMetrics
        // while the web route added a delta, so concurrent adds on two devices would
        // last-writer-wins clobber each other instead of summing).
        await store.queueMutation({ userId: userId!, domain: 'body_metrics', date: today, payload: { waterMlDelta: ml } })
        pushThenRevalidate(userId!, invalidateBodyMetricWrite)
        toast.success(`+${ml} ml logged`)
        invalidateBodyMetricWrite().catch(() => {})
        onLogged(ml)
        onOpenChange(false)
        setValue('')
        savedLocally = true
      } catch (sqliteErr) {
        console.error('Water log SQLite write failed, falling back to API:', sqliteErr)
      } finally {
        if (savedLocally) setSaving(false)
      }
    }
    if (savedLocally) return
    // Web fallback: online-only
    try {
      const res = await fetch('/api/water-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml }),
      })
      if (!res.ok) throw new Error()
      toast.success(`+${ml} ml logged`)
      invalidateBodyMetricWrite().catch(() => {})
      onLogged(ml)
      onOpenChange(false)
      setValue('')
    } catch {
      toast.error('Failed to log water')
    } finally {
      setSaving(false)
    }
  }

  // Q-321: `validWaterMlDeltaOrNull` is one of the two validators that QUARANTINES rather than
  // coercing, so a 9,000 ml custom entry did not get clamped — it dead-lettered into a badge the
  // user cannot act on. Of the fields this check covers, it is the one that was actually costing
  // something. The quick-add buttons are all well inside the bound and need no guard.
  const boundError = metricBoundError('waterMlDelta', value)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Log Water Intake</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {QUICK_ADD_ML.map(ml => (
              <button
                key={ml}
                type="button"
                onClick={() => handleSave(ml)}
                disabled={saving}
                className="rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold hover:bg-muted/80 transition disabled:opacity-50"
              >
                +{ml} ml
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="Custom ml"
              aria-invalid={!!boundError}
              className={cn(
                "flex-1 rounded-xl border bg-muted px-4 py-3 text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand",
                boundError && "border-destructive",
              )}
            />
            <span className="text-muted-foreground font-medium">ml</span>
          </div>
          {boundError && (
            <p role="alert" className="text-xs text-destructive">{boundError}</p>
          )}
          <Button
            className="w-full h-12 font-semibold"
            onClick={() => handleSave(Number(value))}
            disabled={saving || !value.trim() || !!boundError}
          >
            {saving ? 'Saving…' : 'Log'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
