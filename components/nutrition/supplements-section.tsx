"use client";

import { useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { CheckIcon, SettingsIcon } from "lucide-react";
import { ManageSupplementsSheet } from "./manage-supplements-sheet";
import { EmptyState } from "@/components/ui/empty-state";
import { supplementSubtitle } from "@/components/nutrition/supplement-subtitle";
import { applyManualToggle } from "@/components/nutrition/supplement-day-totals";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  /** Drawn as one row of a grouped section rather than as its own card (Q-395b). */
  grouped?: boolean
}

export function SupplementsSection({ supplements, loading, onChanged, userId , grouped}: Props) {
  const tz = useUserTimezone();
  const [manageOpen, setManageOpen] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [promptFor, setPromptFor] = useState<SupplementWithStatus | null>(null)
  const [promptAmount, setPromptAmount] = useState('')

  const active = supplements.filter(s => s.active)

  /**
   * BF-112: a supplement whose dose changes asks for the number instead of using the definition's.
   * **One flag, not a second flow** — a prompted log is still one contribution row; only the source
   * of the number differs. A tick without the flag omits the dose entirely, and the local backend
   * fills it from the definition, which is what freezes it against later edits (BF-3 gap 1).
   */
  async function toggleLog(s: SupplementWithStatus, promptedAmount?: number) {
    if (toggling) return
    if (s.dosePrompt && !s.loggedToday && promptedAmount == null) {
      setPromptFor(s)
      setPromptAmount(s.defaultAmount == null ? '' : String(s.defaultAmount))
      return
    }
    setToggling(s.id)
    const dose = promptedAmount == null ? null : { amount: promptedAmount, unit: s.unit ?? null }
    // The tick's own effect on the day's total. Flipping `loggedToday` alone leaves the previous
    // log's number on screen — un-ticking 5 mg still read "5 mg today", and re-ticking at 7.5 mg
    // still read 5, until the next pull.
    const logged = !s.loggedToday
    const contribution = logged
      ? { logging: true, amount: dose?.amount ?? s.defaultAmount ?? null, unit: dose?.unit ?? s.unit ?? null }
      : { logging: false, amount: s.loggedDose?.amount ?? null, unit: s.loggedDose?.unit ?? null }
    const applyOptimistic = () => onChanged(supplements.map(x => x.id === s.id
      ? { ...x, loggedToday: logged, loggedAmount: applyManualToggle(x.loggedAmount, contribution) }
      : x))
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
              ...(dose ? { amount: dose.amount, unit: dose.unit } : {}),
              updatedAt: new Date().toISOString(), deletedAt: null, syncStatus: 'pending',
            })
            await store.queueMutation({
              userId: userId!, domain: 'supplement_logs', date: today,
              payload: { supplementId: s.id, logDate: today, ...(dose ?? {}) },
            })
            await cancelSupplementReminder(s.id)
          }
          pushThenRevalidate(userId!, invalidateSupplements)
          applyOptimistic()
          invalidateSupplements().catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Supplement log SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        const method = s.loggedToday ? 'DELETE' : 'POST'
        const res = await fetch(`/api/supplements/${s.id}/log`, dose
          ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dose) }
          : { method })
        if (!res.ok) throw new Error()
        if (!s.loggedToday) await cancelSupplementReminder(s.id)
        applyOptimistic()
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
          <div className={grouped ? 'bg-muted/40 px-4 py-4' : 'rounded-2xl bg-muted/40 border border-border px-4 py-4'}>
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
                  {/* BF-112: what today recorded, falling back to the definition — the two are
                      different questions and the log's number must win, or editing the definition
                      silently rewrites what a past day shows. */}
                  {supplementSubtitle(s) && (
                    <p className="text-xs text-muted-foreground">{supplementSubtitle(s)}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* BF-112: the titration prompt. Confirming closes it and re-enters `toggleLog` with the
          number, which is the same path a plain tick takes — there is no second write path. */}
      <Dialog open={promptFor !== null} onOpenChange={open => { if (!open) setPromptFor(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{promptFor?.name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground text-center -mt-2 mb-4">How much did you take?</p>
          <div className="grid grid-cols-[1fr_auto] items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              autoFocus
              value={promptAmount}
              onChange={e => setPromptAmount(e.target.value)}
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-sm text-muted-foreground">{promptFor?.unit ?? ''}</span>
          </div>
          <div className="flex gap-2 mt-5">
            <Button variant="outline" className="flex-1" onClick={() => setPromptFor(null)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!Number.isFinite(Number(promptAmount)) || promptAmount.trim() === ''}
              onClick={() => {
                const s = promptFor
                if (!s) return
                setPromptFor(null)
                toggleLog(s, Number(promptAmount))
              }}
            >
              Log
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
