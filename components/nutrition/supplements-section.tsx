"use client";

import { useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { CheckIcon, SettingsIcon } from "lucide-react";
import { ManageSupplementsSheet } from "./manage-supplements-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { cancelSupplementReminder } from "@/lib/supplement-reminders";
import type { SupplementWithStatus } from "@trainingai/shared/types/supplement";
import { cn } from "@trainingai/shared/utils";
import { getLocalStore } from "@/lib/local-store";
import { pushThenRevalidate } from "@/lib/local-store/push-then-revalidate";
import { todayInTz } from "@trainingai/shared/date-utils";
import { invalidateSupplements } from "@/lib/cache-groups";

interface Props {
  supplements: SupplementWithStatus[]
  loading: boolean
  onChanged: (supplements: SupplementWithStatus[]) => void
  userId?: string
}

export function SupplementsSection({ supplements, loading, onChanged, userId }: Props) {
  const tz = useUserTimezone();
  const [manageOpen, setManageOpen] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)

  const active = supplements.filter(s => s.active)

  async function toggleLog(s: SupplementWithStatus) {
    if (toggling) return
    setToggling(s.id)
    try {
      const store = userId ? getLocalStore(userId) : null
      const today = todayInTz(tz)
      let savedLocally = false
      if (store) {
        try {
          if (s.loggedToday) {
            await store.deleteSupplementLog(s.id, today)
            await store.queueMutation({
              userId: userId!, domain: 'supplement_logs', date: today,
              payload: { supplementId: s.id, logDate: today, deleted: true },
            })
          } else {
            const id = crypto.randomUUID()
            await store.upsertSupplementLog({
              id, supplementId: s.id, logDate: today,
              updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'pending',
            })
            await store.queueMutation({
              userId: userId!, domain: 'supplement_logs', date: today,
              payload: { supplementId: s.id, logDate: today },
            })
            await cancelSupplementReminder(s.id)
          }
          pushThenRevalidate(userId!, invalidateSupplements)
          onChanged(supplements.map(x => x.id === s.id ? { ...x, loggedToday: !x.loggedToday } : x))
          invalidateSupplements().catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Supplement log SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        const method = s.loggedToday ? 'DELETE' : 'POST'
        const res = await fetch(`/api/supplements/${s.id}/log`, { method })
        if (!res.ok) throw new Error()
        if (!s.loggedToday) await cancelSupplementReminder(s.id)
        onChanged(supplements.map(x => x.id === s.id ? { ...x, loggedToday: !x.loggedToday } : x))
        invalidateSupplements().catch(() => {})
      }
    } catch {
      // silent — checkbox snaps back
    } finally {
      setToggling(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
        <div className="h-12 rounded-xl bg-muted animate-pulse" />
      </div>
    )
  }

  return (
    <>
      <div>
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Supplements</p>
          <button type="button" onClick={() => setManageOpen(true)} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            <SettingsIcon className="h-3 w-3" /> Manage
          </button>
        </div>
        {active.length === 0 ? (
          <div className="rounded-2xl bg-muted/40 border border-border px-4 py-4">
            <EmptyState
              title="No supplements added yet."
              className="py-0"
              action={
                <button type="button" onClick={() => setManageOpen(true)} className="text-xs text-foreground underline">
                  Add some
                </button>
              }
            />
          </div>
        ) : (
          <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden divide-y divide-border">
            {active.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleLog(s)}
                disabled={toggling === s.id}
                aria-pressed={s.loggedToday}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                    !s.loggedToday && "border-muted-foreground/40"
                  )}
                  style={s.loggedToday ? { backgroundColor: 'var(--accent-green)', borderColor: 'var(--accent-green)' } : undefined}
                >
                  {s.loggedToday && <CheckIcon className="w-3 h-3" style={{ color: '#0a0a0a' }} />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className={cn("text-sm font-medium", s.loggedToday && "line-through text-muted-foreground")}>
                    {s.name}
                  </p>
                  {s.dose && <p className="text-xs text-muted-foreground">{s.dose}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <ManageSupplementsSheet
        open={manageOpen}
        onOpenChange={setManageOpen}
        supplements={supplements}
        onChanged={onChanged}
        userId={userId}
      />
    </>
  )
}
