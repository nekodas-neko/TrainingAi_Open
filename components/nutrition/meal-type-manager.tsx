'use client'

import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { Loader2, Trash2, Pencil, GripVertical, Plus, Bell, BellOff, StarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DragDropProvider, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import type { MealType } from '@trainingai/shared/types/nutrition'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { invalidateMealTypes, invalidateNutritionWrite } from '@/lib/cache-groups'
import { cancelMealReminder } from '@/lib/meal-reminders'
import { cachedFetch, readCacheSync } from '@/lib/sqlite/cache'
import { MealTypeReassignDialog, type ReassignTarget } from './meal-type-reassign-dialog'
import { TTL_LONG } from '@trainingai/shared/cache-ttl'

function SortableMealTypeRow({
  mt,
  index,
  onEdit,
  onDelete,
  deleting,
}: {
  mt: MealType
  index: number
  onEdit: (mt: MealType) => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const { ref, isDragging } = useSortable({ id: mt.id, index })
  return (
    <div
      ref={ref}
      className={`rounded-xl border border-border/50 bg-muted/20 transition-opacity ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <GripVertical className="w-4 h-4 text-muted-foreground/40 shrink-0 cursor-grab active:cursor-grabbing" />
        <span className="text-lg shrink-0">{mt.emoji}</span>
        <span className="text-sm font-medium flex-1">{mt.name}</span>
        {mt.required && <StarIcon className="w-3 h-3 text-amber-500/70 shrink-0" />}
        {mt.remindersEnabled ? (
          <Bell className="w-3.5 h-3.5 text-muted-foreground/60" />
        ) : (
          <BellOff className="w-3.5 h-3.5 text-muted-foreground/30" />
        )}
        <span className="text-[10px] text-muted-foreground">{mt.timeStartHour}–{mt.timeEndHour}h</span>
        <button onClick={() => onEdit(mt)} aria-label="Edit meal type" className="p-4 text-muted-foreground hover:text-foreground">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {/* Named, not a generic "Delete meal type" repeated once per row — six identically-labelled
            destructive buttons give a screen-reader user no way to tell which one they are on. */}
        <button onClick={() => onDelete(mt.id)} disabled={deleting} aria-label={`Delete ${mt.name}`} className="p-4 text-muted-foreground hover:text-destructive disabled:opacity-40">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

export function MealTypeManager() {
  const [mealTypes, setMealTypes] = useState<MealType[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', emoji: '', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true, required: true })
  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true, required: true })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reassign, setReassign] = useState<ReassignTarget | null>(null)
  const mealTypesRef = useRef(mealTypes)
  useEffect(() => { mealTypesRef.current = mealTypes }, [mealTypes])

  useLayoutEffect(() => {
    const seeded = readCacheSync<MealType[]>('nutrition-meal-types')
    if (seeded) { setMealTypes(Array.isArray(seeded) ? seeded : []); setLoading(false) }
  }, [])

  function load() {
    return cachedFetch<MealType[]>('nutrition-meal-types', '/api/nutrition/meal-types', TTL_LONG,
      d => setMealTypes(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function startEdit(mt: MealType) {
    setEditingId(mt.id)
    setEditForm({ name: mt.name, emoji: mt.emoji, timeStartHour: mt.timeStartHour, timeEndHour: mt.timeEndHour, remindersEnabled: mt.remindersEnabled, required: mt.required })
  }

  async function saveEdit() {
    if (!editingId) return
    const id = editingId
    const prevMealTypes = mealTypesRef.current
    // Optimistic: apply immediately, toast, close the row — reconcile in the background.
    setMealTypes(prev => prev.map(mt => mt.id === id ? { ...mt, ...editForm } : mt))
    setEditingId(null)
    toast.success('Updated')
    try {
      const res = await fetch(`/api/nutrition/meal-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!res.ok) throw new Error()
      invalidateMealTypes().then(load).catch(() => {})
    } catch {
      setMealTypes(prevMealTypes)
      toast.error('Failed to update')
    }
  }

  /** Local bookkeeping shared by a plain delete and a move-then-delete. */
  function forgetMealType(id: string) {
    setMealTypes(prev => prev.filter(mt => mt.id !== id))
    cancelMealReminder(id).catch(() => {})
    invalidateMealTypes().then(load).catch(() => {})
  }

  async function deleteMealType(id: string) {
    if (deletingId) return
    setDeletingId(id)
    try {
      const res = await fetch(`/api/nutrition/meal-types/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        // The 409 is not an error to report, it is the question to ask (Q-326). It carries
        // `logCount`, so the dialog opens already knowing how many entries are at stake and the
        // user never sees a button whose only outcome was a toast saying it could not work.
        if (res.status === 409 && data.code === 'MEAL_TYPE_HAS_LOGS') {
          const source = mealTypes.find(mt => mt.id === id)
          if (source) {
            setReassign({
              source,
              logCount: typeof data.logCount === 'number' ? data.logCount : 0,
              options: mealTypes.filter(mt => mt.id !== id),
            })
            return
          }
        }
        toast.error(data.error ?? 'Cannot delete — food logs reference this meal type')
        return
      }
      forgetMealType(id)
      toast.success('Deleted')
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  async function reassignAndDelete(toId: string) {
    const target = reassign
    if (!target) return
    try {
      const res = await fetch(
        `/api/nutrition/meal-types/${target.source.id}?reassignTo=${encodeURIComponent(toId)}`,
        { method: 'DELETE' },
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Could not move those entries')
        return
      }
      const moved = typeof data.moved === 'number' ? data.moved : target.logCount
      const to = target.options.find(o => o.id === toId)
      setReassign(null)
      forgetMealType(target.source.id)
      toast.success(`Moved ${moved} ${moved === 1 ? 'entry' : 'entries'}${to ? ` to ${to.name}` : ''}`)
      // The move re-stamps every affected log's meal type and time, so every food-log-derived
      // cache is stale — the day's list, the weekly summary, the timeline, adherence. `forgetMealType`
      // only clears the definitions group, which would leave all of those showing the old bucketing.
      invalidateNutritionWrite().catch(() => {})
    } catch {
      toast.error('Could not move those entries')
    }
  }

  async function addNew() {
    setSaving(true)
    try {
      const res = await fetch('/api/nutrition/meal-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newForm, sortOrder: mealTypes.length }),
      })
      if (!res.ok) throw new Error()
      const created: MealType = await res.json()
      setMealTypes(prev => [...prev, created])
      toast.success('Meal type added')
      setAddingNew(false)
      setNewForm({ name: '', emoji: '🍽️', timeStartHour: 0, timeEndHour: 24, remindersEnabled: true, required: true })
      invalidateMealTypes().then(load).catch(() => {})
    } catch {
      toast.error('Failed to add meal type')
    } finally {
      setSaving(false)
    }
  }

  // Live-reorder as the drag passes over another row (CLAUDE.md @dnd-kit/react WebView
  // rule) — onDragEnd only persists the order that's already reflected in state by then.
  const handleDragOver = useCallback(({ operation }: { operation: { source?: { id?: unknown } | null; target?: { id?: unknown } | null } }) => {
    const sourceId = operation.source?.id as string | undefined
    const targetId = operation.target?.id as string | undefined
    if (!sourceId || !targetId || sourceId === targetId) return
    setMealTypes(prev => {
      const from = prev.findIndex(mt => mt.id === sourceId)
      const to = prev.findIndex(mt => mt.id === targetId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    const orderedIds = mealTypesRef.current.map(mt => mt.id)
    fetch('/api/nutrition/meal-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    }).then(() => invalidateMealTypes()).catch(() => toast.error('Failed to save order'))
  }, [])

  if (loading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground m-4" />

  return (
    <div className="space-y-2">
      <DragDropProvider
        sensors={[PointerSensor]}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {mealTypes.map((mt, index) =>
          editingId === mt.id ? (
            <div key={mt.id} className="rounded-xl border border-border/50 bg-muted/20">
              <div className="p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editForm.emoji}
                    onChange={e => setEditForm(f => ({ ...f, emoji: e.target.value }))}
                    className="w-14 rounded-lg border bg-background px-2 py-2 text-center"
                    maxLength={2}
                  />
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                    placeholder="Meal name"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2 items-center text-xs text-muted-foreground">
                  <span>Hours</span>
                  <input
                    type="number" min={0} max={23}
                    value={editForm.timeStartHour}
                    onChange={e => setEditForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                  <span>to</span>
                  <input
                    type="number" min={1} max={24}
                    value={editForm.timeEndHour}
                    onChange={e => setEditForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
                    className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Remind me if not logged</span>
                  <Switch
                    checked={editForm.remindersEnabled}
                    onCheckedChange={val => setEditForm(f => ({ ...f, remindersEnabled: val }))}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Required (trigger end-of-day reminder)</span>
                  <Switch
                    checked={editForm.required}
                    onCheckedChange={val => setEditForm(f => ({ ...f, required: val }))}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setEditingId(null)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
                  <Button onClick={saveEdit} disabled={saving} className="flex-1">
                    {saving ? '…' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <SortableMealTypeRow
              key={mt.id}
              mt={mt}
              index={index}
              onEdit={startEdit}
              onDelete={deleteMealType}
              deleting={deletingId === mt.id}
            />
          )
        )}
      </DragDropProvider>

      {addingNew ? (
        <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newForm.emoji}
              onChange={e => setNewForm(f => ({ ...f, emoji: e.target.value }))}
              className="w-14 rounded-lg border bg-background px-2 py-2 text-center"
              maxLength={2}
            />
            <input
              type="text"
              value={newForm.name}
              onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
              className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
              placeholder="Meal type name"
              autoFocus
            />
          </div>
          <div className="flex gap-2 items-center text-xs text-muted-foreground">
            <span>Hours</span>
            <input
              type="number" min={0} max={23}
              value={newForm.timeStartHour}
              onChange={e => setNewForm(f => ({ ...f, timeStartHour: parseInt(e.target.value) || 0 }))}
              className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
            />
            <span>to</span>
            <input
              type="number" min={1} max={24}
              value={newForm.timeEndHour}
              onChange={e => setNewForm(f => ({ ...f, timeEndHour: parseInt(e.target.value) || 24 }))}
              className="w-16 rounded-lg border bg-background px-2 py-1.5 text-center text-sm"
            />
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Required (trigger end-of-day reminder)</span>
            <Switch
              checked={newForm.required}
              onCheckedChange={val => setNewForm(f => ({ ...f, required: val }))}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAddingNew(false)} className="flex-1 rounded-lg border py-2 text-sm">Cancel</button>
            <Button onClick={addNew} disabled={saving || !newForm.name.trim()} className="flex-1">
              {saving ? '…' : 'Add'}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingNew(true)}
          className="w-full rounded-xl border border-dashed border-border/60 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:border-border transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add meal type
        </button>
      )}

      <MealTypeReassignDialog
        target={reassign}
        onClose={() => setReassign(null)}
        onConfirm={reassignAndDelete}
      />
    </div>
  )
}
