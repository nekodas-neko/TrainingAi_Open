"use client";

import { useState } from "react";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";
import { PlusIcon, GripVerticalIcon, ClockIcon } from "lucide-react";
import type { Supplement, SupplementWithStatus } from "@trainingai/shared/types/supplement";
import { getLocalStore } from "@/lib/local-store";
import { pushThenRevalidate } from "@/lib/local-store/push-then-revalidate";
import { invalidateSupplements } from "@/lib/cache-groups";
import { cancelSupplementReminder } from "@/lib/supplement-reminders";
import { todayInTz } from "@trainingai/shared/date-utils";

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  supplements: SupplementWithStatus[]
  onChanged: (supplements: SupplementWithStatus[]) => void
  userId?: string
}

export function ManageSupplementsSheet({ open, onOpenChange, supplements, onChanged, userId }: Props) {
  const tz = useUserTimezone();
  const [editTarget, setEditTarget] = useState<Supplement | 'new' | null>(null)
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderTime, setReminderTime] = useState('08:00')
  const [saving, setSaving] = useState(false)

  function openNew() {
    setName(''); setDose(''); setReminderEnabled(false); setReminderTime('08:00')
    setEditTarget('new')
  }

  function openEdit(s: Supplement) {
    setName(s.name); setDose(s.dose ?? ''); setReminderEnabled(s.reminderEnabled)
    setReminderTime(s.reminderTime ?? '08:00')
    setEditTarget(s)
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    const store = userId ? getLocalStore(userId) : null
    const isNew = editTarget === 'new'
    const existingId = isNew ? undefined : (editTarget as Supplement).id
    let savedLocally = false
    if (store) {
      try {
        const now = new Date().toISOString()
        const id = existingId ?? crypto.randomUUID()
        const sortOrder = isNew ? supplements.length : (supplements.find(s => s.id === id)?.sortOrder ?? 0)
        const record = {
          id, name: name.trim(),
          dose: dose.trim() || null,
          reminderEnabled,
          reminderTime: reminderEnabled ? reminderTime : null,
          sortOrder,
          active: true,
          updatedAt: now,
        }
        await store.upsertSupplement(record)
        await store.queueMutation({
          userId: userId!,
          domain: 'supplements',
          date: todayInTz(tz),
          payload: { id, name: record.name, dose: record.dose, reminderEnabled, reminderTime: record.reminderTime, sortOrder, active: true },
        })
        const supplementRecord: Supplement = {
          id, userId: userId!, name: record.name, dose: record.dose,
          reminderEnabled, reminderTime: record.reminderTime,
          sortOrder, active: true, createdAt: now,
        }
        if (isNew) {
          onChanged([...supplements, { ...supplementRecord, loggedToday: false }])
        } else {
          onChanged(supplements.map(s => s.id === id ? { ...supplementRecord, loggedToday: s.loggedToday } : s))
        }
        setEditTarget(null)
        toast.success(isNew ? 'Supplement added' : 'Supplement updated')
        if (!reminderEnabled) cancelSupplementReminder(id).catch(() => {})
        pushThenRevalidate(userId!, invalidateSupplements)
        invalidateSupplements().catch(() => {})
        savedLocally = true
      } catch (sqliteErr) {
        console.error('Supplement SQLite write failed, falling back to API:', sqliteErr)
      } finally {
        if (savedLocally) setSaving(false)
      }
    }
    if (savedLocally) return
    // Web fallback
    try {
      const url = isNew ? '/api/supplements' : `/api/supplements/${existingId}`
      const method = isNew ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          dose: dose.trim() || null,
          reminderEnabled,
          reminderTime: reminderEnabled ? reminderTime : null,
          sortOrder: isNew ? supplements.length : undefined,
        }),
      })
      if (!res.ok) throw new Error()
      const saved: Supplement = await res.json()
      if (isNew) {
        onChanged([...supplements, { ...saved, loggedToday: false }])
      } else {
        onChanged(supplements.map(s => s.id === saved.id ? { ...saved, loggedToday: (supplements.find(x => x.id === saved.id)?.loggedToday ?? false) } : s))
      }
      setEditTarget(null)
      toast.success(isNew ? 'Supplement added' : 'Supplement updated')
      if (!reminderEnabled) cancelSupplementReminder(saved.id).catch(() => {})
      invalidateSupplements().catch(() => {})
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    const store = userId ? getLocalStore(userId) : null
    let savedLocally = false
    if (store) {
      try {
        const now = new Date().toISOString()
        const existing = supplements.find(s => s.id === id)
        await store.upsertSupplement({
          id,
          name: existing?.name ?? '',
          dose: existing?.dose ?? null,
          reminderEnabled: existing?.reminderEnabled ?? false,
          reminderTime: existing?.reminderTime ?? null,
          sortOrder: existing?.sortOrder ?? 0,
          active: false,
          updatedAt: now,
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'supplements',
          date: todayInTz(tz),
          payload: { id, deleted: true },
        })
        onChanged(supplements.filter(s => s.id !== id))
        setEditTarget(null)
        toast.success('Supplement deleted')
        cancelSupplementReminder(id).catch(() => {})
        pushThenRevalidate(userId!, invalidateSupplements)
        invalidateSupplements().catch(() => {})
        savedLocally = true
      } catch (sqliteErr) {
        console.error('Supplement delete SQLite write failed, falling back to API:', sqliteErr)
      }
    }
    if (savedLocally) return
    try {
      const res = await fetch(`/api/supplements/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      onChanged(supplements.filter(s => s.id !== id))
      setEditTarget(null)
      toast.success('Supplement deleted')
      cancelSupplementReminder(id).catch(() => {})
      invalidateSupplements().catch(() => {})
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function toggleActive(s: SupplementWithStatus) {
    const store = userId ? getLocalStore(userId) : null
    let savedLocally = false
    if (store) {
      try {
        const now = new Date().toISOString()
        const updated = { ...s, active: !s.active, updatedAt: now }
        await store.upsertSupplement({
          id: s.id, name: s.name, dose: s.dose ?? null,
          reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime ?? null,
          sortOrder: s.sortOrder, active: !s.active, updatedAt: now,
        })
        await store.queueMutation({
          userId: userId!,
          domain: 'supplements',
          date: todayInTz(tz),
          payload: { id: s.id, name: s.name, dose: s.dose ?? null, reminderEnabled: s.reminderEnabled, reminderTime: s.reminderTime ?? null, sortOrder: s.sortOrder, active: !s.active },
        })
        onChanged(supplements.map(x => x.id === s.id ? { ...updated, userId: s.userId, createdAt: s.createdAt, loggedToday: s.loggedToday } : x))
        if (s.active) cancelSupplementReminder(s.id).catch(() => {})
        pushThenRevalidate(userId!, invalidateSupplements)
        invalidateSupplements().catch(() => {})
        savedLocally = true
      } catch (sqliteErr) {
        console.error('Supplement toggle SQLite write failed, falling back to API:', sqliteErr)
      }
    }
    if (savedLocally) return
    try {
      const res = await fetch(`/api/supplements/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !s.active }),
      })
      if (!res.ok) throw new Error()
      const saved: Supplement = await res.json()
      onChanged(supplements.map(x => x.id === saved.id ? { ...saved, loggedToday: x.loggedToday } : x))
      if (s.active) cancelSupplementReminder(s.id).catch(() => {})
      invalidateSupplements().catch(() => {})
    } catch {
      toast.error('Failed to update')
    }
  }

  if (editTarget !== null) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
          <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
            <SheetTitle>{editTarget === 'new' ? 'Add Supplement' : 'Edit Supplement'}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Name</p>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Creatine"
                className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1.5">Dose <span className="font-normal">(optional)</span></p>
              <input
                type="text"
                value={dose}
                onChange={e => setDose(e.target.value)}
                placeholder="e.g. 5g, 1 capsule"
                className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="rounded-xl bg-muted/60 border border-border px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Daily reminder</p>
                <p className="text-xs text-muted-foreground mt-0.5">Notify me if not logged by this time</p>
              </div>
              <Switch checked={reminderEnabled} onCheckedChange={setReminderEnabled} />
            </div>
            {reminderEnabled && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">Reminder time</p>
                <input
                  type="time"
                  value={reminderTime}
                  onChange={e => setReminderTime(e.target.value)}
                  className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
            {editTarget !== 'new' && (
              <Button variant="destructive" className="w-full" onClick={() => handleDelete((editTarget as Supplement).id)}>
                Delete
              </Button>
            )}
          </div>
          <div className="p-4 pt-0 shrink-0 flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditTarget(null)}>Back</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!name.trim() || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Manage Supplements</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {supplements.length === 0 && (
            <EmptyState title="No supplements yet. Add one below." />
          )}
          {supplements.map(s => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl bg-muted/60 border border-border px-3 py-3">
              <GripVerticalIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              <button type="button" onClick={() => openEdit(s)} className="flex-1 text-left min-w-0">
                <p className={`text-sm font-medium ${!s.active ? 'line-through text-muted-foreground' : ''}`}>{s.name}</p>
                {s.dose && <p className="text-xs text-muted-foreground">{s.dose}</p>}
                {s.reminderEnabled && s.reminderTime && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <ClockIcon className="w-3 h-3" /> {s.reminderTime}
                  </p>
                )}
              </button>
              <Switch checked={s.active} onCheckedChange={() => toggleActive(s)} />
            </div>
          ))}
        </div>
        <div className="p-4 pt-0 shrink-0">
          <Button className="w-full" onClick={openNew}>
            <PlusIcon className="h-4 w-4 mr-2" /> Add Supplement
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
