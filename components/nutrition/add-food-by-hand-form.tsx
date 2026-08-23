'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface AddFoodByHandValues {
  name: string
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
}

/**
 * The "the search didn't find it, type it in" form inside the saved-meal builder.
 *
 * Extracted from `saved-meals-sheet.tsx` (Q-406), which sat at **793 of the 800-line ceiling** and
 * therefore could not absorb a single line of the Q-395 rework. It is a pure move: the same markup,
 * the same five fields, the same required-fields rule, and the same "Add & use" behaviour.
 *
 * **The form's own state lives here rather than in the sheet.** It was five strings and a reset in
 * a component that already carries ten handlers and the whole builder; nothing outside this form
 * ever read them, and the sheet only needs the parsed result. `onSubmit` receives numbers, so the
 * `parseFloat`-or-zero rule that used to sit in the sheet's handler is next to the inputs that
 * produce it instead of two hundred lines away.
 */
export function AddFoodByHandForm({
  saving, initialName, onCancel, onSubmit,
}: {
  saving: boolean
  /** Prefilled from the search query, which is what the user just typed and failed to find. */
  initialName: string
  onCancel: () => void
  /** Resolve to `true` when the food was created, so the form only clears on success. */
  onSubmit: (values: AddFoodByHandValues) => Promise<boolean>
}) {
  const [form, setForm] = useState({ name: initialName, calories: '', proteinG: '', carbsG: '', fatG: '' })

  async function submit() {
    const name = form.name.trim()
    const calories = parseFloat(form.calories)
    const ok = await onSubmit({
      name,
      calories,
      proteinG: parseFloat(form.proteinG) || 0,
      carbsG: parseFloat(form.carbsG) || 0,
      fatG: parseFloat(form.fatG) || 0,
    })
    if (ok) setForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' })
  }

  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add new food</p>
      <div className="space-y-2">
        <input
          type="text"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="Food name"
          className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 ring-brand"
        />
        <input
          type="number"
          inputMode="decimal"
          value={form.calories}
          onChange={e => setForm(f => ({ ...f, calories: e.target.value }))}
          placeholder="Calories per serving *"
          className="w-full rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:ring-1 ring-brand"
        />
        <div className="grid grid-cols-3 gap-2">
          {([['proteinG', 'Protein g'], ['carbsG', 'Carbs g'], ['fatG', 'Fat g']] as [keyof typeof form, string][]).map(([field, placeholder]) => (
            <input
              key={field}
              type="number"
              inputMode="decimal"
              value={form[field]}
              onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
              placeholder={placeholder}
              className="w-full rounded-xl border bg-background px-2 py-2 text-sm outline-none focus:ring-1 ring-brand"
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button
          size="sm"
          className="flex-1"
          disabled={saving || !form.name.trim() || !form.calories}
          onClick={() => void submit()}
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
          Add &amp; use
        </Button>
      </div>
    </div>
  )
}
