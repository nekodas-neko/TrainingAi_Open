"use client"

import { useState, useEffect } from "react"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn, localDateString } from "@trainingai/shared/utils"
import { toast } from "sonner"
import { todayInTz, todayMidnightUtc, toAestDay } from "@trainingai/shared/date-utils"
import { getLocalStore } from "@/lib/local-store"
import { pushMutations } from "@/lib/local-store/sync-engine"
import type { BodyMetaRow } from "@/app/api/body-metadata/route"

export type LogField = "weightKg" | "steps" | "bodyFat";

export interface LogState {
  field: LogField;
  label: string;
  unit: string;
  step: number;
  value: string;
}

interface MetricLogSheetProps {
  logState: LogState | null
  userId?: string
  onClose: () => void
  onSaved: (freshMeta: BodyMetaRow | null) => void
}

export function MetricLogSheet({ logState, userId, onClose, onSaved }: MetricLogSheetProps) {
  const [value, setValue] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setValue(logState?.value ?? "")
  }, [logState])

  const valueNum = value !== "" ? parseFloat(value) : NaN
  const error =
    logState && value !== "" && (!isFinite(valueNum) || valueNum <= 0)
      ? "Enter a value above 0"
      : null

  const handleSave = async () => {
    if (!logState || value.trim() === "") return
    setSaving(true)
    try {
      const date = todayInTz()
      const numVal = parseFloat(value)
      // Map health-content field names to LocalBodyMetric field names
      const fieldMap: Record<string, keyof Pick<import('@/lib/local-store/types').LocalBodyMetric, 'weightKg' | 'bodyFatPct' | 'steps'>> = {
        weightKg: 'weightKg',
        bodyFat:  'bodyFatPct',
        steps:    'steps',
      }
      const localField = fieldMap[logState.field]
      const store = userId ? getLocalStore(userId) : null
      let savedLocally = false
      if (store && localField) {
        try {
          const leanPayload: Record<string, number | null> = { [localField]: numVal }
          await store.upsertBodyMetric({
            date,
            weightKg:         localField === 'weightKg'   ? numVal : null,
            bodyFatPct:       localField === 'bodyFatPct' ? numVal : null,
            steps:            localField === 'steps'       ? numVal : null,
            calories:         null,
            proteinG:         null,
            carbsG:           null,
            fatG:             null,
            waterMl:          null,
            restingHeartRate: null,
            hrvMs:            null,
            spo2Pct:          null,
            distanceKm:       null,
            waistCm:          null,
            chestCm:          null,
            armCm:            null,
            thighCm:          null,
            hipCm:            null,
            neckCm:           null,
            skeletalMusclePct:  null,
            fatFreeMassKg:      null,
            subcutaneousFatPct: null,
            visceralFatIndex:   null,
            bodyWaterPct:       null,
            muscleMassKg:       null,
            boneMassKg:         null,
            proteinPct:         null,
            bmrKcal:            null,
            metabolicAge:       null,
            updatedAt:        new Date().toISOString(),
            deletedAt:        null,
            syncStatus:       'pending',
          })
          await store.queueMutation({ userId: userId!, domain: 'body_metrics', date, payload: leanPayload })
          pushMutations(userId!).catch(() => {})
          toast.success(`${logState.label} saved`)
          onClose()
          const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000)
          const fresh = await store.getBodyMetrics(toAestDay(cutoff))
          const todayMeta = fresh.find(r => r.date === date) ?? null
          onSaved(todayMeta ? {
            date:             todayMeta.date,
            weightKg:         todayMeta.weightKg,
            bodyFat:          todayMeta.bodyFatPct,
            calories:         todayMeta.calories,
            protein:          todayMeta.proteinG,
            carb:             todayMeta.carbsG,
            fat:              todayMeta.fatG,
            steps:            todayMeta.steps,
            distanceKm:       null,
            restingHeartRate: todayMeta.restingHeartRate,
            hrvMs:            todayMeta.hrvMs,
            spo2Pct:          todayMeta.spo2Pct,
            waterMl:          todayMeta.waterMl,
            waistCm:          todayMeta.waistCm,
            chestCm:          todayMeta.chestCm,
            armCm:            todayMeta.armCm,
            thighCm:          todayMeta.thighCm,
            hipCm:            todayMeta.hipCm,
            neckCm:           todayMeta.neckCm,
            skeletalMusclePct:  todayMeta.skeletalMusclePct,
            fatFreeMassKg:      todayMeta.fatFreeMassKg,
            subcutaneousFatPct: todayMeta.subcutaneousFatPct,
            visceralFatIndex:   todayMeta.visceralFatIndex,
            bodyWaterPct:       todayMeta.bodyWaterPct,
            muscleMassKg:       todayMeta.muscleMassKg,
            boneMassKg:         todayMeta.boneMassKg,
            proteinPct:         todayMeta.proteinPct,
            bmrKcal:            todayMeta.bmrKcal,
            metabolicAge:       todayMeta.metabolicAge,
          } : null)
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Body metric SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        // Feedback-first (PERF-10): fires synchronously, same as the local-write
        // branch above, instead of waiting on the network round-trip.
        toast.success(`${logState.label} saved`)
        onClose()
        onSaved(null)
        const res = await fetch("/api/body-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ localDate: localDateString(), [logState.field]: numVal }),
        })
        if (!res.ok) throw new Error()
      }
    } catch { toast.error("Failed to save") }
    finally { setSaving(false) }
  }

  return (
    <Sheet open={!!logState} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Log {logState?.label}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-2 space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="number"
              step={logState?.step}
              min={0}
              value={value}
              onChange={e => setValue(e.target.value)}
              aria-invalid={!!error}
              className={cn(
                "flex-1 rounded-xl border bg-background px-4 py-3 text-lg font-bold tabular-nums",
                error && "border-destructive",
              )}
              autoFocus
            />
            <span className="text-sm text-muted-foreground">{logState?.unit}</span>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">{error}</p>
          )}
        </div>
        <SheetFooter className="flex-row gap-3 px-4">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button className="flex-1" disabled={saving || !value || !!error} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
