"use client";

import { useState, useEffect } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@trainingai/shared/utils";
import { todayInTz } from "@trainingai/shared/date-utils";
import type { Injury } from "@trainingai/shared/types/injury";
import { getLocalStore } from "@/lib/local-store";
import { pushThenRevalidate } from "@/lib/local-store/push-then-revalidate";
import { invalidateInjuryWrites } from "@/lib/cache-groups";

const MUSCLE_OPTIONS = [
  'chest', 'shoulders', 'biceps', 'triceps', 'forearms',
  'abs', 'obliques', 'hip flexors',
  'quads', 'hamstrings', 'glutes', 'calves', 'adductors',
  'traps', 'upper back', 'lats', 'lower back',
]

type Severity = 'mild' | 'moderate' | 'severe'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  injury?: Injury | null
  onSaved: (injury: Injury) => void
  onDeleted?: (id: string) => void
  userId?: string
}

export function InjurySheet({ open, onOpenChange, injury, onSaved, onDeleted, userId }: Props) {
  const tz = useUserTimezone();
  const [muscle, setMuscle] = useState('')
  const [severity, setSeverity] = useState<Severity>('mild')
  const [startedDate, setStartedDate] = useState(todayInTz(tz))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (injury) {
      setMuscle(injury.muscleName)
      setSeverity(injury.severity)
      setStartedDate(injury.startedDate)
      setNotes(injury.notes ?? '')
    } else {
      setMuscle('')
      setSeverity('mild')
      setStartedDate(todayInTz(tz))
      setNotes('')
    }
  }, [injury, open, tz])

  async function handleSave() {
    if (!muscle) return
    setSaving(true)
    try {
      const store = userId ? getLocalStore(userId) : null
      let savedLocally = false
      if (store) {
        try {
          const now = new Date().toISOString()
          const id = injury?.id ?? crypto.randomUUID()
          const record = {
            id, muscleName: muscle, notes: notes.trim() || null,
            severity, startedDate, resolvedDate: injury?.resolvedDate ?? null,
            createdAt: injury?.createdAt ?? now, updatedAt: now,
            deletedAt: null, syncStatus: 'pending' as const,
          }
          await store.upsertInjury(record)
          await store.queueMutation({
            userId: userId!, domain: 'injuries', date: startedDate,
            payload: { id, muscleName: muscle, notes: notes.trim() || null, severity, startedDate },
          })
          pushThenRevalidate(userId!, invalidateInjuryWrites)
          onSaved({ id, userId: userId!, muscleName: muscle, notes: notes.trim() || null,
            severity, startedDate, resolvedDate: null, createdAt: record.createdAt, updatedAt: record.updatedAt })
          onOpenChange(false)
          toast.success(injury ? 'Injury updated' : 'Injury logged')
          invalidateInjuryWrites().catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Injury SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        const url = injury ? `/api/injuries/${injury.id}` : '/api/injuries'
        const method = injury ? 'PATCH' : 'POST'
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ muscleName: muscle, severity, startedDate, notes: notes.trim() || null }),
        })
        if (!res.ok) throw new Error()
        const saved: Injury = await res.json()
        onSaved(saved)
        onOpenChange(false)
        toast.success(injury ? 'Injury updated' : 'Injury logged')
        invalidateInjuryWrites().catch(() => {})
      }
    } catch {
      toast.error('Failed to save injury')
    } finally {
      setSaving(false)
    }
  }

  async function handleResolve() {
    if (!injury) return
    setSaving(true)
    try {
      const store = userId ? getLocalStore(userId) : null
      const resolvedDate = todayInTz(tz)
      let savedLocally = false
      if (store) {
        try {
          const now = new Date().toISOString()
          await store.upsertInjury({ ...injury, resolvedDate, updatedAt: now,
            deletedAt: null, syncStatus: 'pending' })
          await store.queueMutation({
            userId: userId!, domain: 'injuries', date: injury.startedDate,
            payload: { id: injury.id, resolvedDate },
          })
          pushThenRevalidate(userId!, invalidateInjuryWrites)
          onSaved({ ...injury, resolvedDate })
          onOpenChange(false)
          toast.success('Injury marked as resolved')
          invalidateInjuryWrites().catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Injury resolve SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        const res = await fetch(`/api/injuries/${injury.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolvedDate }),
        })
        if (!res.ok) throw new Error()
        const saved: Injury = await res.json()
        onSaved(saved)
        onOpenChange(false)
        toast.success('Injury marked as resolved')
        invalidateInjuryWrites().catch(() => {})
      }
    } catch {
      toast.error('Failed to update injury')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!injury) return
    setSaving(true)
    try {
      const store = userId ? getLocalStore(userId) : null
      let savedLocally = false
      if (store) {
        try {
          await store.deleteInjury(injury.id)
          await store.queueMutation({
            userId: userId!, domain: 'injuries', date: injury.startedDate,
            payload: { id: injury.id, deleted: true },
          })
          pushThenRevalidate(userId!, invalidateInjuryWrites)
          onDeleted?.(injury.id)
          onOpenChange(false)
          toast.success('Injury deleted')
          invalidateInjuryWrites().catch(() => {})
          savedLocally = true
        } catch (sqliteErr) {
          console.error('Injury delete SQLite write failed, falling back to API:', sqliteErr)
        }
      }
      if (!savedLocally) {
        const res = await fetch(`/api/injuries/${injury.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        onDeleted?.(injury.id)
        onOpenChange(false)
        toast.success('Injury deleted')
        invalidateInjuryWrites().catch(() => {})
      }
    } catch {
      toast.error('Failed to delete injury')
    } finally {
      setSaving(false)
    }
  }

  const severityColors: Record<Severity, string> = {
    mild: 'bg-green-500/15 text-green-500 border-green-500/30',
    moderate: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    severe: 'bg-red-500/15 text-red-500 border-red-500/30',
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>{injury ? 'Edit Injury' : 'Log Injury'}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Muscle picker */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Muscle</p>
            <div className="flex flex-wrap gap-2">
              {MUSCLE_OPTIONS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMuscle(m)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors capitalize",
                    muscle === m
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Severity</p>
            <div className="flex gap-2">
              {(['mild', 'moderate', 'severe'] as Severity[]).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSeverity(s)}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-semibold border capitalize transition-colors",
                    severity === s ? severityColors[s] : "border-border text-muted-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Start date */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Started</p>
            <input
              type="date"
              value={startedDate}
              onChange={e => setStartedDate(e.target.value)}
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Notes <span className="font-normal">(optional)</span></p>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. left shoulder, rotator cuff"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {injury && !injury.resolvedDate && (
            <Button variant="outline" className="w-full" onClick={handleResolve} disabled={saving}>
              ✓ Mark as Resolved
            </Button>
          )}
          {injury && (
            <Button variant="destructive" className="w-full" onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          )}
        </div>
        <div className="p-4 pt-0 shrink-0">
          <Button className="w-full" onClick={handleSave} disabled={!muscle || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
