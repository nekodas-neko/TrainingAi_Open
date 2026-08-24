'use client'

import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { toast } from "sonner"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import type { BodyMetaRow } from "@/app/api/body-metadata/route"
import type { WidgetDef } from "@/lib/home/home-prefs"
import { getLocalStore } from "@/lib/local-store"
import { pushMutations } from "@/lib/local-store/sync-engine"
import { todayInTz, todayMidnightUtc, toAestDay } from "@trainingai/shared/date-utils"
import { cn } from "@trainingai/shared/utils"
import { invalidateBodyMetricWrite, invalidateReadinessInputs } from "@/lib/cache-groups"
import type { LocalBodyMetric } from "@/lib/local-store/types"
import { metricBoundError } from "@/components/health/metric-bounds"

interface LogValueSheetProps {
  widget: WidgetDef | null
  onClose: () => void
  userId: string | undefined
  metaToday: BodyMetaRow | null
  metaRecent: BodyMetaRow[]
  setMetaToday: Dispatch<SetStateAction<BodyMetaRow | null>>
  fetchMeta: () => void
}

export function LogValueSheet({ widget, onClose, userId, metaToday, metaRecent, setMetaToday, fetchMeta }: LogValueSheetProps) {
  const tz = useUserTimezone();
  const [logValue, setLogValue] = useState("")
  const [logSaving, setLogSaving] = useState(false)

  useEffect(() => {
    if (!widget) return
    let current = metaToday?.[widget.key as keyof typeof metaToday]
    if (widget.key === "weightKg" && current == null) {
      current = metaRecent.find(r => r.weightKg != null)?.weightKg ?? null
    }
    setLogValue(current != null ? String(current) : "")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widget])

  async function handleSaveLog() {
    if (!widget || logValue.trim() === "") return;
    // Q-321: never queue a value the server will drop. This sheet had NO bounds check at all — not
    // even the `> 0` its sibling carried — across seven fields.
    if (metricBoundError(widget.key, logValue)) return;
    setLogSaving(true);
    try {
      const date = todayInTz(tz);
      const numVal = parseFloat(logValue);
      // Map widget keys to LocalBodyMetric field names
      const widgetToLocal: Partial<Record<string, keyof LocalBodyMetric>> = {
        weightKg:    'weightKg',
        steps:       'steps',
        calories:    'calories',
        protein:     'proteinG',
        carb:        'carbsG',
        fat:         'fatG',
        waterIntake: 'waterMl',
      };
      const localField = widgetToLocal[widget.key];
      const store = userId ? getLocalStore(userId) : null;
      let savedLocally = false;
      if (store && localField) {
        try {
          const leanPayload: Record<string, number | null> = { [localField]: numVal };
          await store.upsertBodyMetric({
            date,
            weightKg:         widget.key === 'weightKg'    ? numVal : null,
            bodyFatPct:       null,
            steps:            widget.key === 'steps'        ? numVal : null,
            calories:         widget.key === 'calories'     ? numVal : null,
            proteinG:         widget.key === 'protein'      ? numVal : null,
            carbsG:           widget.key === 'carb'         ? numVal : null,
            fatG:             widget.key === 'fat'          ? numVal : null,
            waterMl:          widget.key === 'waterIntake'  ? numVal : null,
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
          });
          await store.queueMutation({ userId: userId!, domain: 'body_metrics', date, payload: leanPayload });
          pushMutations(userId!).catch(() => {});
          toast.success(`${widget.label} saved`);
          onClose();
          const cutoff = new Date(todayMidnightUtc().getTime() - 30 * 24 * 60 * 60 * 1000);
          const fresh = await store.getBodyMetrics(toAestDay(cutoff));
          const todayMeta = fresh.find(r => r.date === date) ?? null;
          if (todayMeta) {
            setMetaToday({
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
            });
          }
          invalidateBodyMetricWrite().catch(() => {});
          invalidateReadinessInputs().catch(() => {});
          savedLocally = true;
        } catch (sqliteErr) {
          console.error('Body metric SQLite write failed, falling back to API:', sqliteErr);
        }
      }
      if (!savedLocally) {
        // Web fallback — feedback-first: close the sheet, toast, and paint the
        // optimistic value before the network round-trip; reconcile on rejection.
        const widgetToMeta: Partial<Record<string, keyof BodyMetaRow>> = {
          weightKg: 'weightKg', steps: 'steps', calories: 'calories',
          protein: 'protein', carb: 'carb', fat: 'fat', waterIntake: 'waterMl',
        };
        const metaField = widgetToMeta[widget.key];
        const prevMetaToday = metaToday;
        onClose();
        toast.success(`${widget.label} saved`);
        if (metaField) {
          const base: BodyMetaRow = prevMetaToday ?? {
            date, weightKg: null, bodyFat: null, calories: null, protein: null,
            carb: null, fat: null, steps: null, distanceKm: null,
            restingHeartRate: null, hrvMs: null, spo2Pct: null, waterMl: null,
            waistCm: null, chestCm: null, armCm: null, thighCm: null, hipCm: null, neckCm: null,
            skeletalMusclePct: null, fatFreeMassKg: null, subcutaneousFatPct: null, visceralFatIndex: null,
            bodyWaterPct: null, muscleMassKg: null, boneMassKg: null, proteinPct: null, bmrKcal: null, metabolicAge: null,
          };
          setMetaToday({ ...base, date, [metaField]: numVal });
        }
        try {
          const res = await fetch("/api/body-metadata", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localDate: date, [widget.key]: numVal }),
          });
          if (!res.ok) throw new Error();
          await invalidateBodyMetricWrite();
          await invalidateReadinessInputs();
          fetchMeta();
        } catch {
          toast.error("Failed to save — reverting");
          setMetaToday(prevMetaToday);
          fetchMeta();
        }
      }
    } catch { toast.error("Failed to save"); }
    finally { setLogSaving(false); }
  }

  const boundError = widget ? metricBoundError(widget.key, logValue) : null;

  return (
    <Sheet open={widget !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{widget ? `Log ${widget.label}` : "Log"}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4">
          <Button
            className="w-full h-12 bg-brand hover:opacity-90 text-primary-foreground font-semibold"
            onClick={handleSaveLog}
            disabled={logSaving || logValue.trim() === "" || !!boundError}
          >
            {logSaving ? "Saving…" : "Save"}
          </Button>
          <div className="flex items-center gap-3">
            <input
              type="number"
              inputMode="decimal"
              value={logValue}
              onChange={(e) => setLogValue(e.target.value)}
              placeholder={`Enter ${widget?.unit || "value"}`}
              autoFocus
              aria-invalid={!!boundError}
              className={cn(
                "flex-1 rounded-xl border bg-muted px-4 py-3 text-2xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand",
                boundError && "border-destructive",
              )}
            />
            {widget?.unit && (
              <span className="text-lg font-medium text-muted-foreground">{widget.unit}</span>
            )}
          </div>
          {boundError && (
            <p role="alert" className="text-xs text-destructive">{boundError}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
