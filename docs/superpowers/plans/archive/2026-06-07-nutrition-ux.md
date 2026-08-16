> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Nutrition UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Saved Meals" section to the Nutrition tab, give the food logger sheet quick access to saved meals and a "Create new food" form, and add an "Add new food" escape hatch inside the Meal Builder sheet.

**Architecture:** No DB migrations needed — `saved_meals`, `saved_meal_items`, and `food_items` tables exist; all relevant API endpoints exist. The food logger `FoodLoggerSheet` already imports `SavedMealsSheet` (nested sheet that logs a whole meal) and `FoodLibrarySheet` (food search). The plan promotes these into visible entry points, adds an inline "Add Food" tab to the logger, and creates a `SavedMealsSection` component for the Nutrition tab.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, shadcn/ui Input/Button, Sonner toasts, `todayInTz()` for dates.

---

## ⚠️ Pre-Flight: Known Issues

### Gap — `FoodLoggerSheet` hides saved meals behind an invisible state toggle
`FoodLoggerSheet` already has `showSavedMeals` and `showLibrary` states that open `SavedMealsSheet` / `FoodLibrarySheet`. These are useful but only accessible if something in the CaptureStep triggers them — they are not obviously discoverable. The plan makes them a top-level tab.

### Gap — No "Add Food" UI
`POST /api/nutrition/food-items` exists but the food logger has no form for it. Users who want to log a home-cooked meal are stuck. The "Add Food" tab covers this.

### Gap — Saved Meals section not visible on Nutrition tab
`SavedMealsSheet` exists as a nested overlay but nothing on the Nutrition tab shows your saved meal templates. The `SavedMealsSection` component adds this.

### Existing API — `GET /api/nutrition/saved-meals` already works
Returns `SavedMeal[]` where each has `items: SavedMealItem[]` and `totals: { calories, proteinG, carbsG, fatG }`. No new API needed for fetching.

### Existing API — `DELETE /api/nutrition/saved-meals/[id]` 
`SavedMealsSheet` already calls `DELETE /api/nutrition/saved-meals/${meal.id}`. This endpoint must exist. Verify: `cat /home/user/TrainingAI/app/api/nutrition/saved-meals/[id]/route.ts` — if it doesn't exist the delete in `SavedMealsSheet` is already broken, but that's out of scope here.

---

## File Map

| File | Change |
|------|--------|
| `components/nutrition/saved-meals-section.tsx` | **NEW** — collapsible section listing saved meals for the Nutrition tab |
| `app/health/health-content.tsx` | Import + render `SavedMealsSection`; move "Build meal" button inside it; remove standalone "Build meal" button |
| `components/nutrition/food-logger-sheet.tsx` | Add tab bar: Recent \| Saved Meals \| Add Food; "Add Food" tab renders inline form |
| `components/nutrition/meal-builder-sheet.tsx` | Add "no results" escape hatch with inline mini-form to create new food item |

---

## Task 1: SavedMealsSection component

**Files:**
- Create: `components/nutrition/saved-meals-section.tsx`

- [ ] **Step 1: Check the existing `SavedMealsSheet` for the logging logic to reuse**

```bash
cat /home/user/TrainingAI/components/nutrition/saved-meals-sheet.tsx
```

The `quickLog` function iterates `meal.items` and POSTs each to `/api/nutrition/food-logs`. We replicate the same logic in the section component.

- [ ] **Step 2: Create `components/nutrition/saved-meals-section.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2, Trash2, Utensils } from 'lucide-react'
import { toast } from 'sonner'
import type { SavedMeal, MealType } from '@/lib/types/nutrition'
import { todayInTz } from '@/lib/date-utils'
import { cn } from '@/lib/utils'

interface Props {
  onOpenBuilder?: () => void
  onLogged: () => void
}

export function SavedMealsSection({ onOpenBuilder, onLogged }: Props) {
  const [open, setOpen] = useState(false)
  const [meals, setMeals] = useState<SavedMeal[]>([])
  const [mealTypes, setMealTypes] = useState<MealType[]>([])
  const [loading, setLoading] = useState(false)
  const [logging, setLogging] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    if (!open || meals.length > 0) return
    setLoading(true)
    Promise.all([
      fetch('/api/nutrition/saved-meals').then(r => r.json()),
      fetch('/api/nutrition/meal-types').then(r => r.json()),
    ]).then(([savedMeals, types]) => {
      setMeals(Array.isArray(savedMeals) ? savedMeals : [])
      setMealTypes(Array.isArray(types) ? types : [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [open, meals.length])

  async function quickLog(meal: SavedMeal) {
    const hour = new Date().getHours()
    const mealTypeId = mealTypes.find(m => hour >= m.timeStartHour && hour < m.timeEndHour)?.id ?? mealTypes[0]?.id
    if (!mealTypeId) { toast.error('No meal type available'); return }
    setLogging(meal.id)
    const today = todayInTz()
    try {
      for (const item of meal.items) {
        await fetch('/api/nutrition/food-logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: today,
            mealTypeId,
            foodItemId: item.foodItemId,
            quantityMultiplier: item.quantityMultiplier,
          }),
        })
      }
      toast.success(`${meal.name} logged`)
      onLogged()
    } catch {
      toast.error('Failed to log meal')
    } finally {
      setLogging(null)
    }
  }

  async function deleteMeal(meal: SavedMeal) {
    setDeleting(meal.id)
    try {
      await fetch(`/api/nutrition/saved-meals/${meal.id}`, { method: 'DELETE' })
      setMeals(prev => prev.filter(m => m.id !== meal.id))
      toast.success('Meal deleted')
    } catch {
      toast.error('Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="px-4 pb-3">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between py-2"
      >
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saved Meals</p>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-2 mt-1">
          {loading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && meals.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No saved meals yet.</p>
          )}

          {meals.map(meal => (
            <div key={meal.id} className="rounded-xl bg-muted/40 flex items-center gap-2 px-3 py-2.5">
              <button
                className="flex-1 text-left min-w-0"
                onClick={() => quickLog(meal)}
                disabled={logging === meal.id}
              >
                <p className="text-sm font-semibold truncate">{meal.name}</p>
                <p className="text-xs text-muted-foreground">
                  {Math.round(meal.totals.calories)} kcal · {Math.round(meal.totals.proteinG)}g P · {meal.items.length} items
                </p>
              </button>
              {logging === meal.id
                ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-none" />
                : (
                  <button
                    onClick={() => deleteMeal(meal)}
                    disabled={deleting === meal.id}
                    className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center flex-none"
                  >
                    {deleting === meal.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                  </button>
                )}
            </div>
          ))}

          {onOpenBuilder && (
            <button
              type="button"
              onClick={onOpenBuilder}
              className="w-full rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-semibold text-brand active:scale-95 transition flex items-center justify-center gap-2"
            >
              <Utensils className="h-3.5 w-3.5" />
              Build meal
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/nutrition/saved-meals-section.tsx
git commit -m "add SavedMealsSection component for Nutrition tab"
```

---

## Task 2: Wire SavedMealsSection into health-content.tsx

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Read the relevant part of health-content.tsx**

```bash
sed -n '905,970p' /home/user/TrainingAI/app/health/health-content.tsx
```

This shows the nutrition tab JSX including where MacroRing renders and where the standalone "Build meal" button is (around line 945-949).

- [ ] **Step 2: Add the import**

Find the existing import for `MealBuilderSheet` and add `SavedMealsSection` alongside it:

```typescript
import { MealBuilderSheet } from '@/components/nutrition/meal-builder-sheet'
import { SavedMealsSection } from '@/components/nutrition/saved-meals-section'
```

- [ ] **Step 3: Add `SavedMealsSection` before `MacroRing`, remove standalone "Build meal" button**

Find the nutrition tab JSX. The current structure is roughly:

```tsx
{/* MacroRing */}
<div ...>
  <MacroRing ... />
</div>
{/* Build meal button */}
<button onClick={() => setMealBuilderOpen(true)} ...>
  Build meal
</button>
```

Replace by inserting `SavedMealsSection` BEFORE `MacroRing` and removing the standalone "Build meal" button:

```tsx
<SavedMealsSection
  onOpenBuilder={() => setMealBuilderOpen(true)}
  onLogged={() => fetchNutrition()}
/>
{/* MacroRing */}
<div ...>
  <MacroRing ... />
</div>
{/* Remove the old standalone Build meal button entirely */}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "add Saved Meals section to Nutrition tab; move Build Meal CTA into it"
```

---

## Task 3: Food Logger Sheet — Recent | Saved Meals | Add Food tabs

**Files:**
- Modify: `components/nutrition/food-logger-sheet.tsx`

- [ ] **Step 1: Read the full FoodLoggerSheet**

```bash
cat /home/user/TrainingAI/components/nutrition/food-logger-sheet.tsx
```

Note: the sheet already has:
- `showSavedMeals` state opening `SavedMealsSheet`
- `showLibrary` state opening `FoodLibrarySheet`
- A `step` stack: `'capture' | 'review' | 'assign'`

- [ ] **Step 2: Add tab state at the top of the component**

After the existing state declarations, add:

```typescript
type LoggerTab = 'recent' | 'saved' | 'add'
const [loggerTab, setLoggerTab] = useState<LoggerTab>('recent')
```

Also add state for the "Add Food" form:
```typescript
const [addFoodForm, setAddFoodForm] = useState({
  name: '', calories: '', proteinG: '', carbsG: '', fatG: '', servingSizeG: '100',
})
const [addFoodSaving, setAddFoodSaving] = useState(false)
```

- [ ] **Step 3: Reset tab on open**

Find the `reset()` function or wherever state is cleared on sheet open. Add:
```typescript
setLoggerTab('recent')
setAddFoodForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '', servingSizeG: '100' })
```

- [ ] **Step 4: Add the tab bar and conditional content**

Find where the sheet content is rendered (the main scrollable area). Add a tab bar at the top of the sheet body, before the existing capture/scan content:

```tsx
{/* Tab bar */}
<div className="flex border-b border-border shrink-0">
  {(['recent', 'saved', 'add'] as LoggerTab[]).map(t => (
    <button
      key={t}
      onClick={() => setLoggerTab(t)}
      className={cn(
        'flex-1 py-2.5 text-xs font-semibold uppercase tracking-wide transition',
        loggerTab === t
          ? 'border-b-2 border-brand text-brand'
          : 'text-muted-foreground'
      )}
    >
      {t === 'recent' ? 'Recent' : t === 'saved' ? 'Saved Meals' : 'Add Food'}
    </button>
  ))}
</div>
```

Then wrap the existing capture/scan content in `{loggerTab === 'recent' && (...)}`.

- [ ] **Step 5: Add Saved Meals tab content**

After the `recent` tab block, add:

```tsx
{loggerTab === 'saved' && (
  <div className="flex-1 overflow-y-auto">
    <SavedMealsSection
      onLogged={() => { onLogged(); onClose() }}
    />
  </div>
)}
```

Import `SavedMealsSection`:
```typescript
import { SavedMealsSection } from '@/components/nutrition/saved-meals-section'
```

- [ ] **Step 6: Add "Add Food" tab content**

```tsx
{loggerTab === 'add' && (
  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
    <p className="text-xs text-muted-foreground">Create a new food item and add it to your library.</p>

    <div className="space-y-2">
      <input
        type="text"
        placeholder="Food name *"
        value={addFoodForm.name}
        onChange={e => setAddFoodForm(p => ({ ...p, name: e.target.value }))}
        className="w-full rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Calories *"
          value={addFoodForm.calories}
          onChange={e => setAddFoodForm(p => ({ ...p, calories: e.target.value }))}
          className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Serving size (g)"
          value={addFoodForm.servingSizeG}
          onChange={e => setAddFoodForm(p => ({ ...p, servingSizeG: e.target.value }))}
          className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Protein (g)"
          value={addFoodForm.proteinG}
          onChange={e => setAddFoodForm(p => ({ ...p, proteinG: e.target.value }))}
          className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Carbs (g)"
          value={addFoodForm.carbsG}
          onChange={e => setAddFoodForm(p => ({ ...p, carbsG: e.target.value }))}
          className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Fat (g)"
          value={addFoodForm.fatG}
          onChange={e => setAddFoodForm(p => ({ ...p, fatG: e.target.value }))}
          className="rounded-xl border bg-muted/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
    </div>

    <button
      className="w-full h-11 rounded-xl bg-brand text-white font-semibold text-sm disabled:opacity-50"
      disabled={addFoodSaving || !addFoodForm.name.trim() || !addFoodForm.calories}
      onClick={async () => {
        setAddFoodSaving(true)
        try {
          const res = await fetch('/api/nutrition/food-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: addFoodForm.name.trim(),
              calories: Number(addFoodForm.calories),
              proteinG: Number(addFoodForm.proteinG) || 0,
              carbsG: Number(addFoodForm.carbsG) || 0,
              fatG: Number(addFoodForm.fatG) || 0,
              servingSizeG: Number(addFoodForm.servingSizeG) || 100,
              source: 'manual',
              region: 'AU',
            }),
          })
          if (!res.ok) throw new Error()
          toast.success(`${addFoodForm.name.trim()} added to your library`)
          setAddFoodForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '', servingSizeG: '100' })
          setLoggerTab('recent')
        } catch {
          toast.error('Failed to create food item')
        } finally {
          setAddFoodSaving(false)
        }
      }}
    >
      {addFoodSaving ? 'Saving…' : 'Add to Library'}
    </button>
  </div>
)}
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
git add components/nutrition/food-logger-sheet.tsx
git commit -m "food logger: add Recent / Saved Meals / Add Food tab bar"
```

---

## Task 4: Meal Builder — "Add new food" escape hatch

**Files:**
- Modify: `components/nutrition/meal-builder-sheet.tsx`

- [ ] **Step 1: Read the current search results section**

```bash
sed -n '100,160p' /home/user/TrainingAI/components/nutrition/meal-builder-sheet.tsx
```

Find where `searchResults.length > 0` renders the results list. Just below it (after the closing `}` of the results block) is where we add the "no results" escape.

- [ ] **Step 2: Add inline "add food" state**

At the top of the `MealBuilderSheet` component, after existing state declarations, add:

```typescript
const [showAddFood, setShowAddFood] = useState(false)
const [addFoodForm, setAddFoodForm] = useState({
  name: '', calories: '', proteinG: '', carbsG: '', fatG: '',
})
const [addFoodSaving, setAddFoodSaving] = useState(false)
```

- [ ] **Step 3: Reset on open**

In the `useEffect(() => { if (!open) return; ... }, [open])` that resets state, add:
```typescript
setShowAddFood(false)
setAddFoodForm({ name: '', calories: '', proteinG: '', carbsG: '', fatG: '' })
```

- [ ] **Step 4: Add the escape hatch after search results**

Find this JSX block:
```tsx
{searchResults.length > 0 && (
  <div className="rounded-xl border divide-y divide-border/30 overflow-hidden">
    ...
  </div>
)}
```

Immediately after its closing `)}`, add:

```tsx
{query.trim() && searchResults.length === 0 && !showAddFood && (
  <div className="rounded-xl border border-dashed border-muted-foreground/30 px-3 py-3 text-center">
    <p className="text-xs text-muted-foreground mb-1.5">No results for "{query}"</p>
    <button
      type="button"
      onClick={() => {
        setShowAddFood(true)
        setAddFoodForm(p => ({ ...p, name: query.trim() }))
      }}
      className="text-xs font-semibold text-brand underline"
    >
      + Add "{query}" as new food
    </button>
  </div>
)}

{showAddFood && (
  <div className="rounded-xl border bg-muted/30 px-3 py-3 space-y-2">
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New food item</p>
    <input
      type="text"
      placeholder="Food name *"
      value={addFoodForm.name}
      onChange={e => setAddFoodForm(p => ({ ...p, name: e.target.value }))}
      className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
    />
    <div className="grid grid-cols-2 gap-2">
      <input
        type="number"
        inputMode="decimal"
        placeholder="Calories *"
        value={addFoodForm.calories}
        onChange={e => setAddFoodForm(p => ({ ...p, calories: e.target.value }))}
        className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="number"
        inputMode="decimal"
        placeholder="Protein (g)"
        value={addFoodForm.proteinG}
        onChange={e => setAddFoodForm(p => ({ ...p, proteinG: e.target.value }))}
        className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="number"
        inputMode="decimal"
        placeholder="Carbs (g)"
        value={addFoodForm.carbsG}
        onChange={e => setAddFoodForm(p => ({ ...p, carbsG: e.target.value }))}
        className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="number"
        inputMode="decimal"
        placeholder="Fat (g)"
        value={addFoodForm.fatG}
        onChange={e => setAddFoodForm(p => ({ ...p, fatG: e.target.value }))}
        className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
      />
    </div>
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setShowAddFood(false)}
        className="flex-1 h-9 rounded-lg border text-sm font-medium"
      >
        Cancel
      </button>
      <button
        type="button"
        disabled={addFoodSaving || !addFoodForm.name.trim() || !addFoodForm.calories}
        onClick={async () => {
          setAddFoodSaving(true)
          try {
            const res = await fetch('/api/nutrition/food-items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: addFoodForm.name.trim(),
                calories: Number(addFoodForm.calories),
                proteinG: Number(addFoodForm.proteinG) || 0,
                carbsG: Number(addFoodForm.carbsG) || 0,
                fatG: Number(addFoodForm.fatG) || 0,
                servingSizeG: 100,
                source: 'manual',
                region: 'AU',
              }),
            })
            if (!res.ok) throw new Error()
            const newItem = await res.json()
            addIngredient(newItem)
            setShowAddFood(false)
            setQuery('')
            setSearchResults([])
            toast.success(`${newItem.name} added`)
          } catch {
            toast.error('Failed to create food item')
          } finally {
            setAddFoodSaving(false)
          }
        }}
        className="flex-1 h-9 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50"
      >
        {addFoodSaving ? 'Saving…' : 'Add & Use'}
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add components/nutrition/meal-builder-sheet.tsx
git commit -m "meal builder: add new food escape hatch when search returns no results"
```

---

## Push

```bash
git push -u origin main
```

---

## Testing Checklist

**Saved Meals section on Nutrition tab:**
- Open Health → Nutrition tab
- "Saved Meals" collapsible section visible above MacroRing
- Expand it → if no saved meals yet, "No saved meals yet." message + "Build meal" button
- After building/saving a meal, it appears in the list
- Tap a meal → logs all items to today's food log, toast confirms
- Long-press the trash icon → meal is deleted

**Food logger tabs:**
- Open the food logger (log food button)
- Three tabs visible at top: Recent | Saved Meals | Add Food
- "Recent" tab: existing behaviour unchanged
- "Saved Meals" tab: shows saved meal templates, tap to log
- "Add Food" tab: form with name + calories + macros, submit → creates food item, switches to Recent tab

**Meal Builder escape hatch:**
- Open Health → Nutrition tab → expand Saved Meals → Build meal
- Search for something that doesn't exist (e.g. "xyz123")
- "No results for xyz123" + "+ Add xyz123 as new food" link appears
- Tap the link → inline form opens with name pre-filled
- Fill in calories → "Add & Use" → new food added as ingredient, search cleared
