> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Batches C + D + E + F + H — Remaining Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the remaining planned feature batches: weekly digest weekly cache (H), step milestones (E), per-pill colour picker (D), custom meal builder (C), and 1RM seeding + linear progression mode in the workout builder (F).

**Architecture:** All six tasks are independent — each produces shippable software on its own. Tasks 1–2 are single-file changes. Tasks 3–4 each touch 1–2 existing files plus create one new file. Tasks 5–6 extend the builder wizard and review screen without changing the DB schema. No migrations are needed: all required tables already exist.

**Tech Stack:** Next.js 15, React 19, TypeScript, Drizzle ORM, PostgreSQL, Tailwind CSS v4, shadcn/ui, Sonner toasts, `@ai-sdk/google` Gemini.

---

## ⚠️ Pre-Flight: Known Bugs & Logic Flaws — Read Before Implementing

### Bug 1 — Weekly AI summary regenerates every new day (Batch H root cause)
`WeeklySummaryCard` caches with key `ta_weekly_summary_v2_` + `localDateString()` (today's date). Visiting `/stats` on 7 different days makes 7 Gemini calls in a week. The prompt asks for "Monday through today", so weekly caching (invalidate on each new Monday) is semantically correct. The week-based key is `ta_weekly_summary_v2_` + Monday's ISO date (e.g. `2026-06-02`). The existing refresh button gives manual control. Fix is in Task 1.

### Bug 2 — Water log cache not invalidated after logging
`WaterLogSheet` posts to `/api/water-log` then calls `onLogged(ml)`. The SQLite body-metadata cache is never explicitly invalidated, so the home screen water tile can show stale data until TTL expires. Fix: call `invalidateCache('body-metadata')` inside `WaterLogSheet` before calling `onLogged`. Fix is in Task 1.

### Logic — Step achievements check best single-day value, not a streak
The 6 new step achievements (`steps_5k` → `steps_50k`) check `MAX(steps)` across all rows in `body_metrics` for the user. This is "best ever single day" logic — appropriate for milestone badges, not a daily average or streak.

### Gap — No meal build-from-scratch UI
`saved_meals` + `saved_meal_items` tables and `/api/nutrition/saved-meals` POST endpoint exist. There is no component to *build* a meal from scratch by searching the food library. Users can only save a meal by going through the food logger and using the Review step's "Save to library" toggle. Fix is in Task 4.

### Gap — No 1RM seeding for new programs
The AI builder generates percentage-based loads ("4 × 10 @ 65%") but has no knowledge of the user's actual 1RMs. New program users must guess their starting weights. Fix (Task 5): add a collapsible "Starting weights (optional)" section to the builder review screen. The user enters known 1RMs; on save, these upsert to `personal_records` so the workout screen can calculate working weights.

### Gap — "Baselining" in builder is name-only
`PHASE_STRUCTURES` in `builder-wizard.tsx` includes `"Baselining"` but it is only a text hint to the AI — it does not trigger special baseline-session logic. True baselining (a dedicated AMRAP test cycle before the program starts) is out of scope for this plan.

### Deferred — Batch G is high risk and needs its own plan
"Log all sets on Complete" requires a crash/data-loss recovery design before any implementation work begins. Do not include it here. Track it separately.

---

## Scope Note

These 6 tasks span 4 independent subsystems (AI digest, metric tiles, achievements, nutrition, workout builder). They can be implemented and deployed independently. Each task's commit is complete and shippable on its own.

---

## File Map

| File | Change |
|------|--------|
| `components/weekly-ai-summary.tsx` | Week-based cache key + `CachedSummary.weekStart` |
| `components/profile/water-log-sheet.tsx` | Invalidate body-metadata cache before `onLogged` |
| `app/api/achievements/route.ts` | MAX(steps) query + 6 step milestone defs |
| `app/session-select/session-select-content.tsx` | `PILL_COLORS_KEY`, `loadPillColors()`, override in tile render |
| `app/profile/profile-content.tsx` | `<input type="color">` next to each Home Widget toggle |
| `components/nutrition/meal-builder-sheet.tsx` | **NEW** — food search, ingredient list, name, save |
| `app/health/health-content.tsx` | "Build meal" button on nutrition tab |
| `app/api/personal-records/seed/route.ts` | **NEW** — POST; upserts 1RM entries from builder |
| `components/workout-builder/builder-review.tsx` | Collapsible "Starting weights" 1RM section |
| `lib/types/builder.ts` | Add `progressionMode: 'linear' \| 'phase'` to `BuilderInputs` |
| `components/workout-builder/builder-wizard.tsx` | "Progression Mode" step (new Step 2, renumbers rest) |
| `app/api/generate-program/route.ts` | Handle `progressionMode: 'linear'` in prompt + phase logic |

---

## Task 1: Weekly Digest Week-Cache + Water Log Cache Invalidation (Batch H)

**Files:**
- Modify: `components/weekly-ai-summary.tsx`
- Modify: `components/profile/water-log-sheet.tsx`

---

### 1a — Week-based cache in `weekly-ai-summary.tsx`

- [ ] **Step 1: Add `getWeekStartStr()` helper above the component**

Open `components/weekly-ai-summary.tsx`. After the `WEEKLY_PROMPT` constant and before `interface CachedSummary`, add:

```typescript
/** Returns "YYYY-MM-DD" for the Monday of the current local week. */
function getWeekStartStr(): string {
  const now = new Date()
  const daysFromMon = (now.getDay() + 6) % 7   // Mon=0 … Sun=6
  const monday = new Date(now)
  monday.setDate(now.getDate() - daysFromMon)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}
```

- [ ] **Step 2: Update `CachedSummary` interface**

Find:
```typescript
interface CachedSummary {
  content: string;
  date: string;
  fetchedAt: number;
}
```
Replace with:
```typescript
interface CachedSummary {
  content: string;
  weekStart: string;
  fetchedAt: number;
}
```

- [ ] **Step 3: Change `cacheKey` to week-based inside the component**

Find inside `WeeklySummaryCard`:
```typescript
const cacheKey = CACHE_KEY_PREFIX + localDateString();
```
Replace with:
```typescript
const weekStart = getWeekStartStr();
const cacheKey = CACHE_KEY_PREFIX + weekStart;
```

- [ ] **Step 4: Update cache-read validity check**

Find:
```typescript
if (cached.date === localDateString()) {
  setContent(cached.content);
  setFetchedAt(cached.fetchedAt);
  return;
}
```
Replace with:
```typescript
if (cached.weekStart === weekStart) {
  setContent(cached.content);
  setFetchedAt(cached.fetchedAt);
  return;
}
```

- [ ] **Step 5: Update cache-write to use `weekStart`**

Find:
```typescript
localStorage.setItem(cacheKey, JSON.stringify({ content: full, date: localDateString(), fetchedAt: now }));
```
Replace with:
```typescript
localStorage.setItem(cacheKey, JSON.stringify({ content: full, weekStart, fetchedAt: now }));
```

- [ ] **Step 6: Remove now-unused `localDateString` import if it came from `@/lib/utils`**

Check the import line at the top:
```typescript
import { cn, localDateString } from "@/lib/utils";
```
If `localDateString` is no longer used after step 4 and 5, remove it:
```typescript
import { cn } from "@/lib/utils";
```

- [ ] **Step 7: Verify the refresh button still works**

`handleRefresh` calls `localStorage.removeItem(cacheKey)`. Since `cacheKey` is now the week-based key, removing it correctly clears this week's cache. No change needed — verify by inspection.

---

### 1b — Water log cache invalidation

- [ ] **Step 8: Add `invalidateCache` import to `water-log-sheet.tsx`**

Open `components/profile/water-log-sheet.tsx`. After the existing imports, add:
```typescript
import { invalidateCache } from '@/lib/sqlite/cache'
```

- [ ] **Step 9: Invalidate cache before calling `onLogged`**

Find the `handleSave` success block:
```typescript
toast.success(`+${ml} ml logged`)
onLogged(ml)
onOpenChange(false)
setValue('')
```
Replace with:
```typescript
toast.success(`+${ml} ml logged`)
invalidateCache('body-metadata')
onLogged(ml)
onOpenChange(false)
setValue('')
```

- [ ] **Step 10: Commit**

```bash
git add components/weekly-ai-summary.tsx components/profile/water-log-sheet.tsx
git commit -m "cache weekly AI summary by week-start; invalidate body-metadata on water log"
```

---

## Task 2: Step Milestone Achievements (Batch E)

**Files:**
- Modify: `app/api/achievements/route.ts`

- [ ] **Step 1: Add MAX(steps) query to the parallel Promise.all**

Open `app/api/achievements/route.ts`. Find the large `Promise.all` call (around line 93). It ends with the `calorieTargetRes` query. Add a new query after it:

```typescript
  db.execute(sql`
    SELECT COALESCE(MAX(steps), 0)::int AS max_steps
    FROM body_metrics
    WHERE user_id = ${userId}::uuid AND steps IS NOT NULL
  `),
```

The destructured variable list (around line 79–92) currently ends with `calorieTargetRes`. Add `maxStepsRes` to it:

```typescript
  const [
    sessionsRes,
    volumeRes,
    setsRes,
    prCountRes,
    prValuesRes,
    earlyBirdRes,
    nightOwlRes,
    workoutDatesRes,
    foodDatesRes,
    sleepRes,
    weightCountRes,
    calorieDaysRes,
    calorieTargetRes,
    maxStepsRes,       // ← add this
  ] = await Promise.all([
    // ... all existing queries ...
    db.execute(sql`
      SELECT COALESCE(MAX(steps), 0)::int AS max_steps
      FROM body_metrics
      WHERE user_id = ${userId}::uuid AND steps IS NOT NULL
    `),
  ])
```

- [ ] **Step 2: Extract the value**

After the existing variable extractions (around line 167–174), add:

```typescript
const maxDailySteps = Number((maxStepsRes.rows[0] as { max_steps: number })?.max_steps ?? 0)
```

- [ ] **Step 3: Add 6 step milestone achievement defs**

In the `defs` array (around line 216), add a new `// STEPS` section after `// BODY METRICS`:

```typescript
// STEPS (best single-day count)
{ id: 'steps_5k',  name: 'Walker',        description: 'Hit 5,000 steps in a day',  icon: '🚶', category: 'Steps', xpReward: 25,  goal: 5000,  current: maxDailySteps },
{ id: 'steps_10k', name: 'Day Tripper',   description: 'Hit 10,000 steps in a day', icon: '👟', category: 'Steps', xpReward: 50,  goal: 10000, current: maxDailySteps },
{ id: 'steps_20k', name: 'Pacer',         description: 'Hit 20,000 steps in a day', icon: '🏃', category: 'Steps', xpReward: 100, goal: 20000, current: maxDailySteps },
{ id: 'steps_30k', name: 'Road Runner',   description: 'Hit 30,000 steps in a day', icon: '⚡', category: 'Steps', xpReward: 150, goal: 30000, current: maxDailySteps },
{ id: 'steps_40k', name: 'Iron Legs',     description: 'Hit 40,000 steps in a day', icon: '🦾', category: 'Steps', xpReward: 250, goal: 40000, current: maxDailySteps },
{ id: 'steps_50k', name: 'Ultramarathon', description: 'Hit 50,000 steps in a day', icon: '🏅', category: 'Steps', xpReward: 500, goal: 50000, current: maxDailySteps },
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/achievements/route.ts
git commit -m "add step milestone achievements (5k–50k best daily steps)"
```

---

## Task 3: Per-Pill Colour Picker (Batch D)

**Files:**
- Modify: `app/session-select/session-select-content.tsx`
- Modify: `app/profile/profile-content.tsx`

The colour overrides live in `localStorage` only — device-specific preference, no DB column needed. Key: `ta_pill_colors`, value: JSON `{ [MetaKey]: "#rrggbb" }`.

---

### 3a — Load/save overrides in `session-select-content.tsx`

- [ ] **Step 1: Add constant and loader function**

Open `app/session-select/session-select-content.tsx`. Find `const WIDGETS_KEY = "ta_ss_widgets"` (around line 59). After the existing constant block, add:

```typescript
const PILL_COLORS_KEY = "ta_pill_colors"

function loadPillColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PILL_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
```

- [ ] **Step 2: Add `pillColors` state**

Find where `homeWidgets` state is declared (search for `useState<MetaKey[]>`). Add after it:

```typescript
const [pillColors, setPillColors] = useState<Record<string, string>>(() => loadPillColors())
```

- [ ] **Step 3: Use override colour in tile render**

In the `case "metricTiles":` render (search for `sectionOrder.map` then `"metricTiles"`), find where each tile is rendered. The tile button uses `style={accentCardStyle(def.color)}`. Change it to use the override if present:

```typescript
const tileColor = pillColors[def.key] ?? def.color
// ... then in JSX:
style={accentCardStyle(tileColor)}
```

Also update the icon colour inside the tile:
```typescript
<def.icon className="h-4 w-4" style={{ color: tileColor }} />
```

- [ ] **Step 4: Export `setPillColors` via a ref so profile can update state across navigation**

Actually the cleanest approach is: profile writes to localStorage, and session-select reads from localStorage on next mount. Since profile saves to `PILL_COLORS_KEY` in localStorage and session-select re-reads on mount via `useState(() => loadPillColors())`, no cross-component state sharing is needed. The change takes effect on next home screen visit. This is the correct approach — do NOT add a ref or context.

---

### 3b — Colour picker UI in `profile-content.tsx`

- [ ] **Step 5: Add colour save helper**

Open `app/profile/profile-content.tsx`. Find the `WIDGETS_KEY` constant (around line 26). After the constants block, add:

```typescript
const PILL_COLORS_KEY = "ta_pill_colors"

function loadPillColors(): Record<string, string> {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(PILL_COLORS_KEY) : null
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
```

- [ ] **Step 6: Add `pillColors` state**

Find where `homeWidgets` state is declared in profile-content.tsx. Add after it:

```typescript
const [pillColors, setPillColors] = useState<Record<string, string>>(() => loadPillColors())
```

- [ ] **Step 7: Add colour input next to each widget toggle in the Home Widgets section**

Find the Home Widgets section in the JSX (search for `WIDGET_DEFS.map` or `homeWidgets` renders). Each row renders a widget toggle — it looks roughly like:

```tsx
<button key={def.key} onClick={() => toggleWidget(def.key)} ...>
  <def.icon ... />
  <span>{def.label}</span>
  <CheckIcon ... />
</button>
```

Add a colour dot button after the icon/label but before the toggle check:

```tsx
{WIDGET_DEFS.map(def => {
  const isEnabled = homeWidgets.includes(def.key)
  const currentColor = pillColors[def.key] ?? def.color
  return (
    <div key={def.key} className="flex items-center gap-3 py-2">
      {/* colour dot — opens native colour picker */}
      <label
        className="relative flex-none cursor-pointer"
        title={`Change ${def.label} tile colour`}
      >
        <div
          className="w-6 h-6 rounded-full border-2 border-background shadow-sm"
          style={{ background: currentColor }}
        />
        <input
          type="color"
          value={currentColor}
          onChange={e => {
            const next = { ...pillColors, [def.key]: e.target.value }
            setPillColors(next)
            localStorage.setItem(PILL_COLORS_KEY, JSON.stringify(next))
          }}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* existing toggle button — keep exactly as-is, just wrap it */}
      <button
        className="flex-1 flex items-center gap-3 text-left"
        onClick={() => toggleWidget(def.key)}
      >
        <def.icon className="h-4 w-4 flex-none" style={{ color: currentColor }} />
        <span className="text-sm">{def.label}</span>
        <div className="ml-auto">
          {isEnabled
            ? <div className="w-4 h-4 rounded-full bg-brand" />
            : <div className="w-4 h-4 rounded-full border border-muted-foreground/40" />
          }
        </div>
      </button>

      {/* reset to default — show only when overridden */}
      {pillColors[def.key] && (
        <button
          className="text-[10px] text-muted-foreground underline flex-none"
          onClick={() => {
            const next = { ...pillColors }
            delete next[def.key]
            setPillColors(next)
            localStorage.setItem(PILL_COLORS_KEY, JSON.stringify(next))
          }}
        >
          reset
        </button>
      )}
    </div>
  )
})}
```

> Note: The exact surrounding JSX differs from the above stub — match the actual existing widget row structure and add the colour elements. The key addition is the `<label>` wrapping an `<input type="color">` positioned over a coloured dot.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 9: Commit**

```bash
git add app/session-select/session-select-content.tsx app/profile/profile-content.tsx
git commit -m "per-pill colour override in Home Widgets (localStorage, input[type=color])"
```

---

## Task 4: Custom Meal Builder Sheet (Batch C)

**Files:**
- Create: `components/nutrition/meal-builder-sheet.tsx`
- Modify: `app/health/health-content.tsx`

The builder lets a user name a meal, search the food library, add items with quantities, then save to `saved_meals` + `saved_meal_items` via the existing `POST /api/nutrition/saved-meals`.

---

- [ ] **Step 1: Create `components/nutrition/meal-builder-sheet.tsx`**

```typescript
'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, X, Plus, Minus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { FoodItem } from '@/lib/types/nutrition'

interface IngredientEntry {
  item: FoodItem
  qty: number  // multiplier: 1.0 = one serving
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

export function MealBuilderSheet({ open, onOpenChange, onSaved }: Props) {
  const [mealName, setMealName] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodItem[]>([])
  const [ingredients, setIngredients] = useState<IngredientEntry[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setMealName('')
    setQuery('')
    setSearchResults([])
    setIngredients([])
  }, [open])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/nutrition/food-items?q=${encodeURIComponent(query)}`)
        const d = await res.json()
        setSearchResults(Array.isArray(d) ? d.slice(0, 20) : [])
      } catch {}
    }, 250)
    return () => clearTimeout(t)
  }, [query, open])

  function addIngredient(item: FoodItem) {
    setIngredients(prev => {
      const existing = prev.find(e => e.item.id === item.id)
      if (existing) return prev.map(e => e.item.id === item.id ? { ...e, qty: e.qty + 1 } : e)
      return [...prev, { item, qty: 1 }]
    })
  }

  function setQty(id: string, delta: number) {
    setIngredients(prev =>
      prev.flatMap(e => {
        if (e.item.id !== id) return [e]
        const next = Math.round((e.qty + delta) * 10) / 10
        return next <= 0 ? [] : [{ ...e, qty: next }]
      })
    )
  }

  const totalMacros = ingredients.reduce(
    (acc, { item, qty }) => ({
      kcal:    acc.kcal    + (item.calories ?? 0) * qty,
      protein: acc.protein + (item.proteinG ?? 0) * qty,
      carbs:   acc.carbs   + (item.carbsG ?? 0) * qty,
      fat:     acc.fat     + (item.fatG ?? 0) * qty,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  )

  async function handleSave() {
    const name = mealName.trim()
    if (!name) { toast.error('Enter a meal name'); return }
    if (ingredients.length === 0) { toast.error('Add at least one ingredient'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/nutrition/saved-meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          items: ingredients.map(e => ({ foodItemId: e.item.id, quantityMultiplier: e.qty })),
        }),
      })
      if (!res.ok) throw new Error()
      toast.success(`"${name}" saved to meal library`)
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error('Failed to save meal')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] flex flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader className="px-1 shrink-0">
          <SheetTitle>Build a Meal</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 space-y-4 pb-2">
          {/* Meal name */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Meal name</label>
            <Input
              value={mealName}
              onChange={e => setMealName(e.target.value)}
              placeholder="e.g. Post-workout shake"
              className="rounded-xl"
            />
          </div>

          {/* Ingredient search */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Add ingredients</label>
            <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2">
              <Search className="w-4 h-4 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search food library…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-muted-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Search results */}
          {searchResults.length > 0 && (
            <div className="rounded-xl border divide-y divide-border/30 overflow-hidden">
              {searchResults.map(item => (
                <button
                  key={item.id}
                  onClick={() => addIngredient(item)}
                  className="w-full flex items-center justify-between px-3 py-2.5 text-left active:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round(item.calories ?? 0)} kcal · {Math.round(item.proteinG ?? 0)}g P per serving
                    </p>
                  </div>
                  <Plus className="h-4 w-4 text-brand flex-none ml-2" />
                </button>
              ))}
            </div>
          )}

          {/* Ingredient list */}
          {ingredients.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ingredients</p>
              {ingredients.map(({ item, qty }) => (
                <div key={item.id} className="rounded-xl bg-muted/40 px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {Math.round((item.calories ?? 0) * qty)} kcal · {Math.round((item.proteinG ?? 0) * qty)}g P
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-none">
                    <button
                      onClick={() => setQty(item.id, -0.5)}
                      className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-bold tabular-nums">{qty}×</span>
                    <button
                      onClick={() => setQty(item.id, 0.5)}
                      className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setIngredients(prev => prev.filter(e => e.item.id !== item.id))}
                      className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center ml-1"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Total macros summary */}
              <div className="rounded-xl bg-brand/10 border border-brand/20 px-3 py-2 text-xs font-semibold flex gap-3">
                <span>{Math.round(totalMacros.kcal)} kcal</span>
                <span>{Math.round(totalMacros.protein)}g P</span>
                <span>{Math.round(totalMacros.carbs)}g C</span>
                <span>{Math.round(totalMacros.fat)}g F</span>
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 pt-2">
          <Button
            className="w-full h-12 font-semibold"
            onClick={handleSave}
            disabled={saving || !mealName.trim() || ingredients.length === 0}
          >
            {saving ? 'Saving…' : 'Save Meal'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Check `FoodItem` type has the fields used above**

Open `lib/types/nutrition.ts`. Confirm `FoodItem` has: `id`, `name`, `calories`, `proteinG`, `carbsG`, `fatG`. If any field name differs, update the component to match.

- [ ] **Step 3: Add "Build meal" button to nutrition tab in `health-content.tsx`**

Open `app/health/health-content.tsx`. Add import:

```typescript
import { MealBuilderSheet } from '@/components/nutrition/meal-builder-sheet'
```

Add state near the other nutrition-tab state declarations:

```typescript
const [mealBuilderOpen, setMealBuilderOpen] = useState(false);
```

Find the nutrition tab UI — there's a header row or toolbar above the meal log sections. Add a "Build meal" button there. Search for the `tab === 'nutrition'` render block and find a suitable location (e.g. near the "Log food" / `FoodLoggerSheet` trigger):

```tsx
<button
  onClick={() => setMealBuilderOpen(true)}
  className="rounded-xl border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand active:scale-95 transition"
>
  Build meal
</button>
```

At the bottom of the component's JSX (near other sheet components), mount:

```tsx
<MealBuilderSheet
  open={mealBuilderOpen}
  onOpenChange={setMealBuilderOpen}
  onSaved={() => {
    // Saved meals cache invalidation not needed unless the library is cached;
    // a future save-meal list sheet will re-fetch on open anyway.
  }}
/>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add components/nutrition/meal-builder-sheet.tsx app/health/health-content.tsx
git commit -m "add meal builder sheet — search food library, set quantities, save as template"
```

---

## Task 5: 1RM Starting Weights in Builder Review (Batch F — Part 1)

**Files:**
- Create: `app/api/personal-records/seed/route.ts`
- Modify: `components/workout-builder/builder-review.tsx`

When saving a new program, the user can optionally enter known 1RMs for the main compound exercises. These are written to `personal_records` so the workout screen can calculate working weights from day one.

---

- [ ] **Step 1: Create `app/api/personal-records/seed/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

interface SeedEntry {
  exerciseName: string
  estimated1rm: number
}

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const entries: SeedEntry[] = Array.isArray(body.entries) ? body.entries : []
  if (entries.length === 0) return NextResponse.json({ ok: true })

  const repo = await getRepository()
  await Promise.all(
    entries
      .filter(e => typeof e.exerciseName === 'string' && e.exerciseName.trim() && Number.isFinite(e.estimated1rm) && e.estimated1rm > 0)
      .map(e => repo.upsertPersonalRecord(userId, e.exerciseName.trim(), e.estimated1rm))
  )

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Add `oneRmInputs` state to `builder-review.tsx`**

Open `components/workout-builder/builder-review.tsx`. After the existing state declarations (around line 50–58), add:

```typescript
const [oneRmInputs, setOneRmInputs] = useState<Record<string, string>>({})
const [oneRmOpen, setOneRmOpen] = useState(false)
```

- [ ] **Step 3: Collect unique primary/secondary exercises**

Add a derived value inside the component (before the return statement):

```typescript
const compoundExercises: string[] = Array.from(
  new Set(
    program.sessions.flatMap(s =>
      s.exercises
        .filter(ex => ex.exerciseRole === 'primary' || ex.exerciseRole === 'secondary')
        .map(ex => ex.name)
    )
  )
)
```

- [ ] **Step 4: Add the 1RM section to the review JSX**

In the `return` JSX, after the Sessions list and before the bottom Save button section, add:

```tsx
{/* Starting weights (optional) */}
<div className="px-4 pb-3">
  <button
    type="button"
    onClick={() => setOneRmOpen(v => !v)}
    className="w-full flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 text-left"
  >
    <div>
      <p className="text-sm font-semibold">Starting weights (optional)</p>
      <p className="text-xs text-muted-foreground">Enter your 1RM for each main lift to pre-seed working weights</p>
    </div>
    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${oneRmOpen ? 'rotate-180' : ''}`} />
  </button>

  {oneRmOpen && (
    <div className="mt-2 rounded-xl bg-muted/40 divide-y divide-border/30 overflow-hidden">
      {compoundExercises.map(name => (
        <div key={name} className="flex items-center gap-3 px-4 py-2.5">
          <p className="flex-1 text-sm truncate">{name}</p>
          <div className="flex items-center gap-1 flex-none">
            <input
              type="number"
              inputMode="decimal"
              value={oneRmInputs[name] ?? ''}
              onChange={e => setOneRmInputs(prev => ({ ...prev, [name]: e.target.value }))}
              placeholder="kg"
              className="w-20 rounded-lg border bg-background px-2 py-1 text-sm tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-brand"
            />
            <span className="text-xs text-muted-foreground w-6">kg</span>
          </div>
        </div>
      ))}
      <p className="px-4 py-2 text-[10px] text-muted-foreground">
        Leave blank for any lift — it will be estimated from your first session.
      </p>
    </div>
  )}
</div>
```

Make sure `ChevronDown` is in the existing Lucide import at the top of the file — it already is.

- [ ] **Step 5: Write 1RMs to DB in `handleSave`**

In `handleSave`, after the existing `await invalidateCache('workout-data')` line, add:

```typescript
// Seed 1RMs if the user entered any
const seedEntries = Object.entries(oneRmInputs)
  .filter(([, v]) => v.trim() && Number(v) > 0)
  .map(([exerciseName, v]) => ({ exerciseName, estimated1rm: Number(v) }))

if (seedEntries.length > 0) {
  await fetch('/api/personal-records/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries: seedEntries }),
  }).catch(() => {})  // non-blocking; program save already succeeded
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add app/api/personal-records/seed/route.ts components/workout-builder/builder-review.tsx
git commit -m "builder review: optional 1RM entry seeds personal_records on program save"
```

---

## Task 6: Linear Progression Mode in Builder (Batch F — Part 2)

**Files:**
- Modify: `lib/types/builder.ts`
- Modify: `components/workout-builder/builder-wizard.tsx`
- Modify: `app/api/generate-program/route.ts`

**What "linear progression" means here:** The generated program uses a simple flat structure — no phases, no Accumulation → Intensification arc. Every session every week uses the same style (e.g. 3 × 8 @ 70% first month, add 2.5 kg per session on main lifts). The phase system is bypassed and `phaseMode` is set to `manual` on save. This is appropriate for beginners who don't need periodization yet.

---

- [ ] **Step 1: Add `progressionMode` to `BuilderInputs` in `lib/types/builder.ts`**

Find `BuilderInputs` interface. Add one field:

```typescript
export interface BuilderInputs {
  programName: string
  equipment: string[]
  sessionsPerWeek: number
  timePerSessionMinutes: number | null
  musclesToFocus: string[]
  goal: 'hypertrophy' | 'strength+hypertrophy' | 'powerbuilding' | 'strength'
  phaseStructureName: string
  progressionMode: 'linear' | 'phase'   // ← add this
  scheduleType: 'rotation' | 'weekly'
  rotationRestAfterN: number
  weeklyDays: number[]
}
```

- [ ] **Step 2: Add default to `INITIAL_INPUTS` in `builder-wizard.tsx`**

Find `const INITIAL_INPUTS: BuilderInputs = {` (around line 68). Add the new field:

```typescript
const INITIAL_INPUTS: BuilderInputs = {
  programName: '',
  equipment: [],
  sessionsPerWeek: 3,
  timePerSessionMinutes: 60,
  musclesToFocus: [],
  goal: 'hypertrophy',
  phaseStructureName: 'Phase-Based Progression',
  progressionMode: 'phase',   // ← add this; 'phase' is the existing default
  scheduleType: 'rotation',
  rotationRestAfterN: 3,
  weeklyDays: [0, 2, 4],
}
```

- [ ] **Step 3: Add "Progression Mode" as a new step (Step 6) in the wizard**

The wizard currently has steps 1–8. Insert a new step between the current Step 5 (Goal) and Step 6 (Phase Structure). This becomes new Step 6; the old Phase Structure step becomes Step 7; schedule becomes Step 8; review becomes Step 9. Adjust the total `TOTAL_STEPS` or equivalent counter.

Find `const TOTAL_STEPS = 8` (or wherever step count is tracked) and change to `9`.

Find the `step === 6` branch (Phase Structure step) and increment it to `step === 7`. Increment `step === 7` (Schedule) to `step === 8`. Increment `step === 8` (review/generate) to `step === 9`.

Add the new step 6 branch:

```tsx
{step === 6 && (
  <div className="space-y-4">
    <div className="space-y-1">
      <h2 className="text-lg font-bold">Progression style</h2>
      <p className="text-sm text-muted-foreground">How should your program load increase over time?</p>
    </div>

    <div className="space-y-3">
      {([
        {
          value: 'linear',
          label: 'Linear Progression',
          description: 'Add weight to the bar each session. Simple, effective for beginners and intermediates returning to training. No complex phases.',
        },
        {
          value: 'phase',
          label: 'Phase Periodization',
          description: 'Structured blocks (Accumulation → Intensification → Peak). More sophisticated programming for consistent progress over months.',
        },
      ] as const).map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => setInputs(prev => ({ ...prev, progressionMode: opt.value }))}
          className={cn(
            'w-full rounded-2xl border p-4 text-left transition active:scale-[0.98]',
            inputs.progressionMode === opt.value
              ? 'border-brand bg-brand/10'
              : 'border-border bg-muted/30'
          )}
        >
          <p className="font-semibold text-sm">{opt.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
        </button>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Skip Phase Structure step when `progressionMode === 'linear'`**

When `progressionMode` is `'linear'`, the Phase Structure step (now Step 7) is irrelevant. Skip it in navigation. Find the `nextStep` / `handleNext` function. After advancing from Step 6, check:

```typescript
function handleNext() {
  const nextRaw = step + 1
  // Skip phase structure step if user chose linear mode
  const next = nextRaw === 7 && inputs.progressionMode === 'linear' ? 8 : nextRaw
  if (next >= 9) {
    handleGenerate()
  } else {
    setStep(next)
  }
}

function handleBack() {
  const prevRaw = step - 1
  // Skip phase structure step backwards if user chose linear mode
  const prev = prevRaw === 7 && inputs.progressionMode === 'linear' ? 6 : prevRaw
  setStep(Math.max(1, prev))
}
```

> Note: if the wizard already uses a similar skip pattern for steps, match the existing approach rather than this stub.

- [ ] **Step 5: Update `generate-program` API to handle `progressionMode: 'linear'`**

Open `app/api/generate-program/route.ts`. Find where the POST body is destructured (search for `phaseStructureName` or `inputs.goal`). Add `progressionMode` to the destructuring:

```typescript
const { ..., progressionMode, ... } = body
```

Find the section that builds the AI prompt — specifically the part that includes phase structure context. Add a conditional block:

```typescript
const progressionContext = progressionMode === 'linear'
  ? `Progression: LINEAR. Do NOT use phases. Generate a flat program where the user simply adds weight each session. Set phaseStructureName to "Linear Progression" in your response. Use the Hypertrophy or Strength styles (based on the goal) for all exercises throughout. phaseSetId should be empty string "".`
  : `Progression: PHASE-BASED (${phaseStructureName}). Use the goal-appropriate phase set with Accumulation → Intensification → Peak structure.`
```

Insert `progressionContext` into the prompt template at the location where phase structure is described (find the line that currently mentions phase structure in the userPrompt string and replace or augment it).

Also, when `progressionMode === 'linear'`, set `phaseMode: 'manual'` in the program save payload instead of `'automatic'`. Find in `builder-review.tsx` the `handleSave` function where `phaseMode: 'automatic'` is set:

```typescript
phaseMode: inputs.progressionMode === 'linear' ? 'manual' : 'automatic',
phaseSetId: inputs.progressionMode === 'linear' ? null : program.phaseSetId,
```

> For `phaseSetId: null` — check whether the `workout-templates` POST accepts null. If not, pass `undefined` or empty string.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 7: Commit**

```bash
git add lib/types/builder.ts components/workout-builder/builder-wizard.tsx app/api/generate-program/route.ts components/workout-builder/builder-review.tsx
git commit -m "builder: add Linear vs Phase Periodization choice (step 6 of wizard)"
```

---

## Final Push

After all tasks are committed:

```bash
git push origin main
```

---

## Testing Checklist

**Task 1 — Weekly digest cache:**
- Visit `/stats` page → observe "Weekly Summary" generating (first visit of the week)
- Navigate away and back → summary loads instantly from cache (no "generating…" spinner)
- Advance system clock by 7 days (or wait until next Monday in real use) → summary regenerates
- Tap the ↺ refresh icon → removes week's cache, regenerates

**Task 1 — Water log cache:**
- Open home screen, note current water ml on tile
- Tap the water tile → log +500 ml via the sheet
- Return to home → water tile should immediately show the new total (not the stale pre-log value)

**Task 2 — Step achievements:**
- Open Profile → scroll to Achievements section
- Expand it → "Steps" category should appear with 5k/10k/20k/30k/40k/50k milestones
- Milestones reached (based on Health Connect history) should show as unlocked with full progress bar

**Task 3 — Per-pill colour:**
- Open Profile → Home Widgets section
- Each widget row shows a coloured circle dot to the left of the icon
- Tap/press the dot → native colour picker opens
- Select a colour → circle updates, save and return to home → tile now uses the new colour
- Back in Profile, a "reset" text link appears → tap → colour returns to default

**Task 4 — Meal builder:**
- Open Health → Nutrition tab
- Tap "Build meal" button → `MealBuilderSheet` opens
- Type "chicken" in search → results appear
- Tap a result → it appears in ingredient list with 1× serving
- Use +/− buttons to adjust quantity → kcal total updates
- Enter a meal name → tap "Save Meal" → toast confirms save
- Subsequent log-meal flows should show the saved meal in "Saved Meals" picker

**Task 5 — 1RM seeding:**
- Open the workout builder (Profile → config → Build button)
- Complete all wizard steps → reach Review screen
- Expand "Starting weights (optional)" → compound exercises listed with kg input fields
- Enter e.g. 120 for "Barbell Squat" → tap Save program
- Check Profile → Achievements → "squat_100" achievement should now show as unlocked if 120 > 100

**Task 6 — Linear vs phase:**
- Open workout builder wizard
- Step 6 presents "Linear Progression" vs "Phase Periodization" options
- Selecting "Linear" → Phase Structure step is skipped (goes directly from step 6 to schedule)
- Generated program has `phaseStructureName: "Linear Progression"`, no phase block in review
- Selecting "Phase Periodization" → Phase Structure step appears as before

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Batch H: weekly digest cooldown → Task 1
- ✅ Water log cache invalidation (companion bug) → Task 1
- ✅ Batch E: step milestones → Task 2
- ✅ Batch D: per-pill colour → Task 3
- ✅ Batch C: custom meal builder → Task 4
- ✅ Batch F part 1: 1RM seeding → Task 5
- ✅ Batch F part 2: linear vs phase → Task 6
- ⏭️ Batch G: deferred — high risk, separate plan

**Placeholder scan:**
- No TBD, TODO, or "handle edge cases" in any step
- All code blocks are complete
- Task 3 Step 7 notes the JSX surrounding structure may differ — flagged explicitly with "match the actual existing widget row structure". This is acceptable given the size of the file; the core addition is described completely.

**Type consistency:**
- `progressionMode: 'linear' | 'phase'` added to `BuilderInputs` (Task 6 Step 1) and default set in `INITIAL_INPUTS` (Task 6 Step 2) before it's used in the wizard JSX (Step 3) and API (Step 5).
- `upsertPersonalRecord(userId, exerciseName, estimated1rm)` — signature matches `lib/data/repository.ts:96`.
- `MealBuilderSheet` props (`open`, `onOpenChange`, `onSaved`) follow the same pattern as `WaterLogSheet`.
- `CachedSummary.weekStart` replaces `CachedSummary.date` consistently across read and write in Task 1.
