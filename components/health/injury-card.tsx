"use client";

import { memo, useState } from "react";
import { useUserTimezone } from '@/components/shell/user-timezone-provider'
import { PlusIcon } from "lucide-react";
import { MuscleHeatmap, type MuscleActivation } from "@/components/muscle-heatmap";
import { InjurySheet } from "./injury-sheet";
import { cn } from "@trainingai/shared/utils";
import { differenceInDays } from "date-fns";
import { todayInTz } from "@trainingai/shared/date-utils";
import type { Injury } from "@trainingai/shared/types/injury";
import type { MuscleRecoveryEntry } from "@/app/api/muscle-recovery/route";

interface Props {
  injuries: Injury[]
  loading: boolean
  onInjuriesChange: (injuries: Injury[]) => void
  userId?: string
  recoveryMuscles?: MuscleRecoveryEntry[]
}

const SEVERITY_CHIP: Record<string, string> = {
  mild: "bg-green-500/15 text-green-500",
  moderate: "bg-amber-500/15 text-amber-500",
  severe: "bg-red-500/15 text-red-500",
}

export const InjuryCard = memo(function InjuryCard({ injuries, loading, onInjuriesChange, userId, recoveryMuscles = [] }: Props) {
  const tz = useUserTimezone()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Injury | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const active = injuries.filter(i => !i.resolvedDate)
  const resolved = injuries.filter(i => i.resolvedDate)

  const injuredMuscleNames = new Set(active.map(i => i.muscleName.toLowerCase()))

  // Build heatmap: recovery status (green=recovered, orange=still recovering), injuries override as red
  const heatmapAssignments: MuscleActivation[] = [
    ...recoveryMuscles
      .filter(r => !injuredMuscleNames.has(r.muscle.toLowerCase()))
      .map(r => ({
        muscle: r.muscle,
        role: (r.hoursAgo != null && r.hoursAgo < 48 ? "secondary" : "main") as "main" | "secondary",
      })),
    ...active.map(i => ({ muscle: i.muscleName, role: "injured" as const })),
  ]

  function handleSaved(saved: Injury) {
    setEditing(null)
    const exists = injuries.find(i => i.id === saved.id)
    if (exists) {
      onInjuriesChange(injuries.map(i => i.id === saved.id ? saved : i))
    } else {
      onInjuriesChange([...injuries, saved])
    }
  }

  function handleDeleted(id: string) {
    onInjuriesChange(injuries.filter(i => i.id !== id))
  }

  if (loading) {
    return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Injuries</p>
        <div className="h-40 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <>
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Muscle Status</p>
          <button
            type="button"
            onClick={() => { setEditing(null); setSheetOpen(true) }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <PlusIcon className="h-3.5 w-3.5" /> Add injury
          </button>
        </div>
        {recoveryMuscles.length > 0 && (
          <div className="flex items-center gap-3 mb-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#22c55e' }} />Recovered</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#f59e0b' }} />Recovering</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} />Injured</span>
          </div>
        )}

        {(heatmapAssignments.length > 0) && (
          <MuscleHeatmap assignments={heatmapAssignments} compact={false} className="mb-3" />
        )}

        {active.length > 0 ? (
          <>
            <div className="space-y-2">
              {active.map(i => {
                const days = differenceInDays(new Date(todayInTz(tz)), new Date(i.startedDate))
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => { setEditing(i); setSheetOpen(true) }}
                    className="w-full flex items-center gap-3 rounded-xl bg-muted/60 px-3 py-2.5 text-left hover:bg-muted/80 transition-colors"
                  >
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium capitalize">{i.muscleName}</span>
                      {i.notes && <span className="text-xs text-muted-foreground ml-1.5">— {i.notes}</span>}
                    </span>
                    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0", SEVERITY_CHIP[i.severity])}>
                      {i.severity}
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">Day {days + 1}</span>
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">No active injuries</p>
        )}

        {resolved.length > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved(v => !v)}
            className="mt-3 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
        )}
        {showResolved && resolved.map(i => (
          <div key={i.id} className="mt-1 flex items-center gap-3 rounded-xl px-3 py-2 opacity-50">
            <span className="flex-1 text-sm line-through capitalize">{i.muscleName}</span>
            <span className="text-[10px] text-muted-foreground">Resolved {i.resolvedDate}</span>
          </div>
        ))}
      </div>

      <InjurySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        injury={editing}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        userId={userId}
      />
    </>
  )
})
