> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Batch B — Goals & Water Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add water intake tracking with a toggleable home/body tile, persist all goals to the DB alongside localStorage, extend daily/weekly toggles to steps and water, add calorie auto-adjust from cardio, add weight and BF% goal progress indicators, add progress bars in the Goals section, and link Goals from the Body tab.

**Architecture:** Goals are currently localStorage-only; we add columns to `users` table and a `PATCH /api/user/goals` + `GET /api/user/goals` route. Water is logged atomically to a new `water_ml` column on `body_metrics` via `POST /api/water-log`. The water tile follows the exact same toggleable pattern as Steps/Sleep tiles in `session-select-content.tsx` and `health-content.tsx`. All goal writes go to localStorage immediately and PATCH to DB debounced; on mount the Goals section hydrates from the DB.

**Tech Stack:** Next.js 15 API routes, Drizzle ORM + PostgreSQL, React 19 client components, Tailwind CSS v4, Sonner toasts, existing shadcn/ui Input/Label/Button components, `date-fns-tz` for timezone-safe dates.

---

## File Structure

**New files:**
- `lib/data/postgres/migrations/051_goals_water.sql` — DB migration
- `app/api/water-log/route.ts` — POST endpoint, atomic water increment
- `app/api/user/goals/route.ts` — GET + PATCH endpoints for all goal fields
- `components/profile/water-log-sheet.tsx` — Bottom sheet with ml input + quick-add chips

**Modified files:**
- `lib/data/postgres/schema.ts` — add `water_ml` to `bodyMetrics`, add 8 goal columns to `users`
- `lib/data/repository.ts` — add `incrementWaterLog`, `getUserGoals`, `updateUserGoals` interfaces
- `lib/data/postgres/adapter.ts` — implement the 3 new repository methods
- `app/api/body-metadata/route.ts` — expose `waterMl` in `BodyMetaRow` GET response
- `app/session-select/session-select-content.tsx` — add water tile to metricTiles (new `MetaKey` + `WIDGET_DEF`), expose `loadWaterGoal`, wire water log sheet
- `app/health/health-content.tsx` — add water tile to body grid, Goals link row at bottom
- `app/profile/profile-content.tsx` — Goals section: fetch from DB, debounced PATCH, progress bars, new goal fields (water_goal_ml, target_weight_kg, target_bf_pct), daily/weekly toggles for steps and water

---

## Task 1: DB migration + schema

**Files:**
- Create: `lib/data/postgres/migrations/051_goals_water.sql`
- Modify: `lib/data/postgres/schema.ts`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 051_goals_water.sql
ALTER TABLE body_metrics ADD COLUMN IF NOT EXISTS water_ml integer;

ALTER TABLE users ADD COLUMN IF NOT EXISTS steps_goal          integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS steps_goal_type     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sleep_goal_hours    numeric(4,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS calorie_goal        integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS calorie_goal_type   text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_goal_ml       integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS water_goal_type     text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_weight_kg    numeric(5,2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS target_bf_pct       numeric(4,2);
```

- [ ] **Step 2: Add columns to Drizzle schema**

Open `lib/data/postgres/schema.ts`. In the `bodyMetrics` table definition (around line 152), add `waterMl` before `createdAt`:

```typescript
  waterMl:           integer('water_ml'),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

In the `users` table definition (around line 6–23), add after `sex`:

```typescript
  stepsGoal:        integer('steps_goal'),
  stepsGoalType:    text('steps_goal_type'),
  sleepGoalHours:   doublePrecision('sleep_goal_hours'),
  calorieGoal:      integer('calorie_goal'),
  calorieGoalType:  text('calorie_goal_type'),
  waterGoalMl:      integer('water_goal_ml'),
  waterGoalType:    text('water_goal_type'),
  targetWeightKg:   doublePrecision('target_weight_kg'),
  targetBfPct:      doublePrecision('target_bf_pct'),
```

- [ ] **Step 3: Verify schema compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no errors in `schema.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/data/postgres/migrations/051_goals_water.sql lib/data/postgres/schema.ts
git commit -m "feat: add water_ml to body_metrics and goal columns to users table"
```

---

## Task 2: Repository interface + adapter

**Files:**
- Modify: `lib/data/repository.ts`
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: Add types and method signatures to repository interface**

Open `lib/data/repository.ts`. Add this type above the `WorkoutRepository` interface declaration (after the existing imports):

```typescript
export interface UserGoals {
  stepsGoal: number | null
  stepsGoalType: 'daily' | 'weekly' | null
  sleepGoalHours: number | null
  calorieGoal: number | null
  calorieGoalType: 'daily' | 'weekly' | null
  waterGoalMl: number | null
  waterGoalType: 'daily' | 'weekly' | null
  targetWeightKg: number | null
  targetBfPct: number | null
}
```

Inside `WorkoutRepository`, at the end of the `// ── Body & Activity ─` section (after `listSleepSessions`), add:

```typescript
  incrementWaterLog(userId: string, date: string, ml: number): Promise<void>
  getUserGoals(userId: string): Promise<UserGoals>
  updateUserGoals(userId: string, goals: Partial<UserGoals>): Promise<void>
```

- [ ] **Step 2: Implement the 3 methods in the adapter**

Open `lib/data/postgres/adapter.ts`. Find the end of the `listSleepSessions` method. After it, add:

```typescript
  async incrementWaterLog(userId: string, date: string, ml: number): Promise<void> {
    await this.db.insert(s.bodyMetrics)
      .values({ userId, date, waterMl: ml })
      .onConflictDoUpdate({
        target: [s.bodyMetrics.userId, s.bodyMetrics.date],
        set: { waterMl: sql`COALESCE(${s.bodyMetrics.waterMl}, 0) + ${ml}` },
      })
  }

  async getUserGoals(userId: string): Promise<UserGoals> {
    const [row] = await this.db
      .select({
        stepsGoal:       s.users.stepsGoal,
        stepsGoalType:   s.users.stepsGoalType,
        sleepGoalHours:  s.users.sleepGoalHours,
        calorieGoal:     s.users.calorieGoal,
        calorieGoalType: s.users.calorieGoalType,
        waterGoalMl:     s.users.waterGoalMl,
        waterGoalType:   s.users.waterGoalType,
        targetWeightKg:  s.users.targetWeightKg,
        targetBfPct:     s.users.targetBfPct,
      })
      .from(s.users)
      .where(eq(s.users.id, userId))
    return {
      stepsGoal:       row?.stepsGoal       ?? null,
      stepsGoalType:   (row?.stepsGoalType   as 'daily' | 'weekly' | null) ?? null,
      sleepGoalHours:  row?.sleepGoalHours   ?? null,
      calorieGoal:     row?.calorieGoal      ?? null,
      calorieGoalType: (row?.calorieGoalType as 'daily' | 'weekly' | null) ?? null,
      waterGoalMl:     row?.waterGoalMl      ?? null,
      waterGoalType:   (row?.waterGoalType   as 'daily' | 'weekly' | null) ?? null,
      targetWeightKg:  row?.targetWeightKg   ?? null,
      targetBfPct:     row?.targetBfPct      ?? null,
    }
  }

  async updateUserGoals(userId: string, goals: Partial<UserGoals>): Promise<void> {
    const set: Record<string, unknown> = {}
    if (goals.stepsGoal       !== undefined) set.stepsGoal       = goals.stepsGoal
    if (goals.stepsGoalType   !== undefined) set.stepsGoalType   = goals.stepsGoalType
    if (goals.sleepGoalHours  !== undefined) set.sleepGoalHours  = goals.sleepGoalHours
    if (goals.calorieGoal     !== undefined) set.calorieGoal     = goals.calorieGoal
    if (goals.calorieGoalType !== undefined) set.calorieGoalType = goals.calorieGoalType
    if (goals.waterGoalMl     !== undefined) set.waterGoalMl     = goals.waterGoalMl
    if (goals.waterGoalType   !== undefined) set.waterGoalType   = goals.waterGoalType
    if (goals.targetWeightKg  !== undefined) set.targetWeightKg  = goals.targetWeightKg
    if (goals.targetBfPct     !== undefined) set.targetBfPct     = goals.targetBfPct
    if (Object.keys(set).length === 0) return
    await this.db.update(s.users).set(set).where(eq(s.users.id, userId))
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/data/repository.ts lib/data/postgres/adapter.ts
git commit -m "feat: add incrementWaterLog, getUserGoals, updateUserGoals to repository"
```

---

## Task 3: Water log API route

**Files:**
- Create: `app/api/water-log/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@/lib/date-utils'

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { ml?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const ml = body.ml
  if (typeof ml !== 'number' || ml <= 0 || ml > 5000) {
    return NextResponse.json({ error: 'ml must be a positive number ≤ 5000' }, { status: 400 })
  }

  const tz = session.user.timezone ?? DEFAULT_TZ
  const date = formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')

  const repo = await getRepository()
  await repo.incrementWaterLog(userId, date, Math.round(ml))

  return NextResponse.json({ success: true, date })
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add app/api/water-log/route.ts
git commit -m "feat: add POST /api/water-log for atomic water intake increment"
```

---

## Task 4: User goals API route

**Files:**
- Create: `app/api/user/goals/route.ts`

- [ ] **Step 1: Write the GET + PATCH route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const repo = await getRepository()
  const goals = await repo.getUserGoals(userId)
  return NextResponse.json(goals)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const repo = await getRepository()
  await repo.updateUserGoals(userId, {
    stepsGoal:       typeof body.stepsGoal       === 'number' ? body.stepsGoal       : undefined,
    stepsGoalType:   body.stepsGoalType   === 'weekly' ? 'weekly' : body.stepsGoalType === 'daily' ? 'daily' : undefined,
    sleepGoalHours:  typeof body.sleepGoalHours  === 'number' ? body.sleepGoalHours  : undefined,
    calorieGoal:     typeof body.calorieGoal     === 'number' ? body.calorieGoal     : undefined,
    calorieGoalType: body.calorieGoalType === 'weekly' ? 'weekly' : body.calorieGoalType === 'daily' ? 'daily' : undefined,
    waterGoalMl:     typeof body.waterGoalMl     === 'number' ? body.waterGoalMl     : undefined,
    waterGoalType:   body.waterGoalType   === 'weekly' ? 'weekly' : body.waterGoalType === 'daily' ? 'daily' : undefined,
    targetWeightKg:  typeof body.targetWeightKg  === 'number' ? body.targetWeightKg  : undefined,
    targetBfPct:     typeof body.targetBfPct     === 'number' ? body.targetBfPct     : undefined,
  })

  return NextResponse.json({ success: true })
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add app/api/user/goals/route.ts
git commit -m "feat: add GET + PATCH /api/user/goals for persistent goal storage"
```

---

## Task 5: Expose waterMl in body-metadata API

**Files:**
- Modify: `app/api/body-metadata/route.ts`

- [ ] **Step 1: Add `waterMl` to the `BodyMetaRow` interface and `toRow` function**

In `app/api/body-metadata/route.ts`, update the `BodyMetaRow` interface to add:
```typescript
  waterMl: number | null;
```
(after `spo2Pct: number | null;`)

Update `toRow` to include:
```typescript
    waterMl:          (m as { waterMl?: number }).waterMl        ?? null,
```
(after `spo2Pct` line)

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add app/api/body-metadata/route.ts
git commit -m "feat: expose waterMl in body-metadata API response"
```

---

## Task 6: Water log bottom sheet component

**Files:**
- Create: `components/profile/water-log-sheet.tsx`

- [ ] **Step 1: Write the component**

```typescript
'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const QUICK_ADD_ML = [150, 250, 330, 500, 750, 1000]

interface WaterLogSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogged: (ml: number) => void
}

export function WaterLogSheet({ open, onOpenChange, onLogged }: WaterLogSheetProps) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSave(ml: number) {
    if (ml <= 0 || ml > 5000) return
    setSaving(true)
    try {
      const res = await fetch('/api/water-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ml }),
      })
      if (!res.ok) throw new Error()
      toast.success(`+${ml} ml logged`)
      onLogged(ml)
      onOpenChange(false)
      setValue('')
    } catch {
      toast.error('Failed to log water')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>Log Water Intake</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4 space-y-4">
          <div className="flex gap-2 flex-wrap">
            {QUICK_ADD_ML.map(ml => (
              <button
                key={ml}
                type="button"
                onClick={() => handleSave(ml)}
                disabled={saving}
                className="rounded-xl border border-border bg-muted px-4 py-2.5 text-sm font-semibold hover:bg-muted/80 transition disabled:opacity-50"
              >
                +{ml} ml
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="Custom ml"
              className="flex-1 rounded-xl border bg-muted px-4 py-3 text-xl font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <span className="text-muted-foreground font-medium">ml</span>
          </div>
          <Button
            className="w-full h-12 font-semibold"
            style={{ background: '#38bdf8', color: '#fff' }}
            onClick={() => handleSave(Number(value))}
            disabled={saving || !value.trim() || Number(value) <= 0}
          >
            {saving ? 'Saving…' : 'Log'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 3: Commit**

```bash
git add components/profile/water-log-sheet.tsx
git commit -m "feat: add WaterLogSheet component with quick-add chips"
```

---

## Task 7: Water tile on home screen

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add `waterIntake` to the types and constants**

In `session-select-content.tsx`, extend `MetaKey`:
```typescript
type MetaKey = "weightKg" | "steps" | "calories" | "protein" | "carb" | "fat" | "distanceKm" | "waterIntake";
```

Add to `WIDGET_DEFS` array after the `fat` entry:
```typescript
  { key: "waterIntake", label: "Water", unit: "ml", icon: Droplets, color: "#38bdf8" },
```

Note: `Droplets` is already imported from `lucide-react`. The `waterIntake` key maps to `waterMl` in the API response — see Step 2.

- [ ] **Step 2: Map `waterIntake` to `waterMl` when reading metaToday**

The existing `metaToday?.[def.key]` lookup needs `waterIntake` to read `waterMl` from the API row. The simplest approach: after `setMetaToday(data.today ?? null)` in the `fetchMeta` callback, create a derived value. Instead, we need `BodyMetaRow` to have a `waterIntake` key, **OR** we map it at the render site.

Since `BodyMetaRow` now has `waterMl` (added in Task 5), we must map it. In the `metricTiles` switch case rendering, where `const todayVal = metaToday?.[def.key]` is read, replace that line for the `waterIntake` key. Find the `case "metricTiles":` block around line 1203 and update the `const todayVal` line:

```typescript
const todayVal = def.key === 'waterIntake'
  ? (metaToday as (BodyMetaRow & { waterMl?: number | null }) | null)?.waterMl ?? undefined
  : metaToday?.[def.key as Exclude<MetaKey, 'waterIntake'>];
```

Also update `dailyReset` to include `waterIntake`:
```typescript
const dailyReset: MetaKey[] = ["steps", "calories", "distanceKm", "waterIntake"];
```

- [ ] **Step 3: Add water goal loading**

Add constant at top of constants block:
```typescript
const WATER_GOAL_KEY      = "ta_water_goal_ml";
const WATER_GOAL_TYPE_KEY = "ta_water_goal_type";
```

Add loading function:
```typescript
function loadWaterGoal(): number {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WATER_GOAL_KEY) : null;
    const n = raw ? parseInt(raw, 10) : NaN;
    return isNaN(n) ? 2500 : n;
  } catch { return 2500; }
}

function loadWaterGoalType(): "daily" | "weekly" {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WATER_GOAL_TYPE_KEY) : null;
    return raw === "weekly" ? "weekly" : "daily";
  } catch { return "daily"; }
}
```

Add state:
```typescript
const [waterGoal, setWaterGoal] = useState(2500);
const [waterGoalType, setWaterGoalType] = useState<"daily" | "weekly">("daily");
const [waterLogOpen, setWaterLogOpen] = useState(false);
```

In `useLayoutEffect`, add loading:
```typescript
setWaterGoal(loadWaterGoal());
setWaterGoalType(loadWaterGoalType());
```

Also in the `onVisible` re-read block, add:
```typescript
setWaterGoal(loadWaterGoal());
setWaterGoalType(loadWaterGoalType());
```

- [ ] **Step 4: Wire water log sheet in the `metricTiles` case + Log button**

In the existing `metricTiles` switch case, the inner Log button calls `openLog(def)`. For `waterIntake`, we want `setWaterLogOpen(true)` instead. Update the Log button `onClick`:

```typescript
onClick={e => {
  e.stopPropagation();
  if (def.key === 'waterIntake') {
    setWaterLogOpen(true);
  } else {
    openLog(def);
  }
}}
```

- [ ] **Step 5: Add `WaterLogSheet` to the JSX and import it**

Add import at top of file:
```typescript
import { WaterLogSheet } from '@/components/profile/water-log-sheet'
```

Add before the closing `</div>` of the component (near the other sheets):
```typescript
<WaterLogSheet
  open={waterLogOpen}
  onOpenChange={setWaterLogOpen}
  onLogged={() => { invalidateCache('body-metadata'); fetchMeta(); }}
/>
```

- [ ] **Step 6: Add `waterIntake` to profile `WIDGET_DEFS` so it appears in Home Widgets toggle**

Open `app/profile/profile-content.tsx`. In the `WIDGET_DEFS` array, add after the `fat` entry:
```typescript
  { key: "waterIntake", label: "Water",    icon: Droplets   },
```

Also extend `MetaKey` type in `profile-content.tsx` to match:
```typescript
type MetaKey = "weightKg" | "steps" | "calories" | "protein" | "carb" | "fat" | "distanceKm" | "waterIntake"
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 8: Commit**

```bash
git add app/session-select/session-select-content.tsx app/profile/profile-content.tsx
git commit -m "feat: add water intake metric tile to home screen with log sheet"
```

---

## Task 8: Water tile on body screen

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Add water state + goal loading**

In `health-content.tsx`, add state variables after the existing `logState` state:
```typescript
const [waterLogOpen, setWaterLogOpen] = useState(false);
```

Add constants near the top of the function (alongside where `latestBf` etc. are computed):
```typescript
const WATER_GOAL_KEY = "ta_water_goal_ml";
const waterGoalMl = (() => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(WATER_GOAL_KEY) : null;
    return raw ? parseInt(raw, 10) : 2500;
  } catch { return 2500; }
})();
const todayWaterMl = (metaToday as (typeof metaToday & { waterMl?: number | null }) | null)?.waterMl ?? null;
```

- [ ] **Step 2: Add water tile to the Steps/Sleep/Dist grid**

The existing grid in `health-content.tsx` around line 501 is:
```
<div className="grid grid-cols-3 gap-3">
  <div ... Steps tile />
  <button ... Sleep tile />
  <button ... Distance tile />
</div>
```

Add a **second row** of 3 tiles (water alone, or alongside future tiles). Add a water tile below the Steps/Sleep/Dist grid. Insert a new water-specific row after the grid's closing `</div>` (after the `{/* ── Calories Burned + BMI ── */}` comment):

Wait — the grid is at line 501. The calories/BMI grid is after it. Insert the water tile between the Steps/Sleep/Dist grid and the Calories/BMI grid. Add a simple single-tile row:

```tsx
{/* ── Water Intake ── */}
<div className="rounded-2xl p-4 relative overflow-hidden" style={{ ...accentCardStyle('#38bdf8'), willChange: 'transform' }}>
  <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: '#38bdf8', filter: 'blur(28px)', opacity: 0.18 }} />
  <div className="flex items-start justify-between mb-2">
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: '#38bdf8' }}>Water</p>
      {metaLoading ? (
        <div className="h-7 w-16 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p className="text-3xl font-bold tabular-nums">
          {todayWaterMl != null ? (todayWaterMl >= 1000 ? `${(todayWaterMl / 1000).toFixed(1)}L` : `${todayWaterMl}ml`) : '—'}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground mt-0.5">
        {waterGoalMl > 0 ? `Goal: ${waterGoalMl >= 1000 ? `${(waterGoalMl / 1000).toFixed(1)}L` : `${waterGoalMl}ml`}` : 'Today'}
      </p>
    </div>
    <button
      onClick={() => setWaterLogOpen(true)}
      className="rounded-xl bg-muted px-3 py-1.5 text-xs font-semibold hover:bg-muted/80 transition-colors"
    >
      Log
    </button>
  </div>
  {waterGoalMl > 0 && todayWaterMl != null && (
    <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'rgba(56,189,248,0.15)' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.min((todayWaterMl / waterGoalMl) * 100, 100).toFixed(1)}%`, background: 'linear-gradient(90deg, #38bdf8, #0ea5e9)' }}
      />
    </div>
  )}
</div>
```

- [ ] **Step 3: Import WaterLogSheet and add to JSX**

At top of `health-content.tsx`, add import:
```typescript
import { WaterLogSheet } from '@/components/profile/water-log-sheet'
```

At the end of the `tab === "body"` block (before the nutrition tab block), add:
```tsx
<WaterLogSheet
  open={waterLogOpen}
  onOpenChange={setWaterLogOpen}
  onLogged={() => fetchMeta()}
/>
```

Actually — the sheet must be outside the body tab conditional. Find where the other sheets are rendered (look for `HealthMetricSheet` usage) and add `WaterLogSheet` there.

- [ ] **Step 4: Add "→ Goals" link at the bottom of the body tab**

At the very end of the `tab === "body" && (...)` block, just before the closing `</>`, add:

```tsx
{/* ── Goals link ── */}
<a
  href="/profile#goals"
  className="flex items-center justify-between rounded-2xl px-4 py-3.5 border border-border bg-muted/40 hover:bg-muted/60 transition active:scale-95"
>
  <div className="flex items-center gap-3">
    <div
      className="w-8 h-8 rounded-xl flex items-center justify-center"
      style={{ background: 'color-mix(in oklch, var(--color-brand) 15%, var(--color-muted))' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
      </svg>
    </div>
    <div>
      <p className="text-sm font-semibold text-left">Goals</p>
      <p className="text-[10px] text-muted-foreground">Steps, water, calories &amp; targets</p>
    </div>
  </div>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
    <path d="M9 18l6-6-6-6"/>
  </svg>
</a>
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 6: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "feat: add water tile and Goals link to body tab"
```

---

## Task 9: Goals section DB sync + new goal fields

**Files:**
- Modify: `app/profile/profile-content.tsx`

This task rewrites the Goals section to:
1. Fetch goals from DB on mount, hydrate localStorage
2. Write to localStorage immediately on every change + debounced PATCH to DB
3. Add water goal (ml + daily/weekly toggle)
4. Add steps daily/weekly toggle (currently steps only has a daily input)
5. Add target weight (kg) and target BF% inputs

- [ ] **Step 1: Add new state variables and localStorage keys**

In `profile-content.tsx`, after the existing state declarations (around line 133–137), add:

```typescript
const WATER_GOAL_KEY      = "ta_water_goal_ml"
const WATER_GOAL_TYPE_KEY = "ta_water_goal_type"
const STEPS_GOAL_TYPE_KEY = "ta_steps_goal_type"

const [waterGoalStr, setWaterGoalStr] = useState('')
const [waterGoalType, setWaterGoalType] = useState<'daily' | 'weekly'>('daily')
const [stepsGoalType, setStepsGoalType] = useState<'daily' | 'weekly'>('daily')
const [targetWeightStr, setTargetWeightStr] = useState('')
const [targetBfStr, setTargetBfStr] = useState('')
const [goalsDbSynced, setGoalsDbSynced] = useState(false)
```

- [ ] **Step 2: Load new localStorage keys in the existing `useEffect`**

In the `useEffect` that loads from localStorage (around line 139–170), add after `const slg = localStorage.getItem("ta_sleep_goal_hours")`:

```typescript
const wg  = localStorage.getItem(WATER_GOAL_KEY)
if (wg) setWaterGoalStr(wg)
const wgt = localStorage.getItem(WATER_GOAL_TYPE_KEY)
if (wgt === 'weekly') setWaterGoalType('weekly')
const sgt = localStorage.getItem(STEPS_GOAL_TYPE_KEY)
if (sgt === 'weekly') setStepsGoalType('weekly')
const tw = localStorage.getItem("ta_target_weight_kg")
if (tw) setTargetWeightStr(tw)
const tb = localStorage.getItem("ta_target_bf_pct")
if (tb) setTargetBfStr(tb)
```

- [ ] **Step 3: Add DB hydration `useEffect`**

After the existing localStorage `useEffect`, add a new `useEffect` that runs once on mount to fetch goals from DB and hydrate localStorage:

```typescript
useEffect(() => {
  fetch('/api/user/goals')
    .then(r => r.ok ? r.json() : null)
    .then((goals: import('@/lib/data/repository').UserGoals | null) => {
      if (!goals) return
      if (goals.stepsGoal != null) {
        const s = String(goals.stepsGoal)
        setStepsGoalStr(s)
        localStorage.setItem("ta_steps_goal", s)
      }
      if (goals.stepsGoalType) {
        setStepsGoalType(goals.stepsGoalType)
        localStorage.setItem(STEPS_GOAL_TYPE_KEY, goals.stepsGoalType)
      }
      if (goals.sleepGoalHours != null) {
        const s = String(goals.sleepGoalHours)
        setSleepGoalStr(s)
        localStorage.setItem("ta_sleep_goal_hours", s)
      }
      if (goals.calorieGoal != null) {
        const s = String(goals.calorieGoal)
        setCalorieGoalStr(s)
        localStorage.setItem(CALORIE_GOAL_KEY, s)
      }
      if (goals.calorieGoalType) {
        setCalorieGoalType(goals.calorieGoalType)
        localStorage.setItem(CALORIE_TYPE_KEY, goals.calorieGoalType)
      }
      if (goals.waterGoalMl != null) {
        const s = String(goals.waterGoalMl)
        setWaterGoalStr(s)
        localStorage.setItem(WATER_GOAL_KEY, s)
      }
      if (goals.waterGoalType) {
        setWaterGoalType(goals.waterGoalType)
        localStorage.setItem(WATER_GOAL_TYPE_KEY, goals.waterGoalType)
      }
      if (goals.targetWeightKg != null) {
        const s = String(goals.targetWeightKg)
        setTargetWeightStr(s)
        localStorage.setItem("ta_target_weight_kg", s)
      }
      if (goals.targetBfPct != null) {
        const s = String(goals.targetBfPct)
        setTargetBfStr(s)
        localStorage.setItem("ta_target_bf_pct", s)
      }
      setGoalsDbSynced(true)
    })
    .catch(() => setGoalsDbSynced(true))
}, [])
```

- [ ] **Step 4: Add debounced PATCH helper**

Add this helper near the top of the component function (after the state declarations):

```typescript
const goalsPatchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
function patchGoalsDebounced(partial: Record<string, unknown>) {
  if (goalsPatchTimer.current) clearTimeout(goalsPatchTimer.current)
  goalsPatchTimer.current = setTimeout(() => {
    fetch('/api/user/goals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    }).catch(() => {})
  }, 1000)
}
```

Also add `useRef` to the existing import from `react` if not already there. The import is already `import { useEffect, useRef, useState } from 'react'` so `useRef` is available.

- [ ] **Step 5: Replace the Goals section JSX**

Find the `{goalsExpanded && (` block (around line 586–639) and replace the entire `<div className="border-t border-border">` content with:

```tsx
<div className="border-t border-border divide-y divide-border">
  {/* Steps Goal */}
  <div className="px-4 py-3 space-y-2">
    <Label className="text-xs text-muted-foreground">Steps Goal</Label>
    <Input
      type="number"
      value={stepsGoalStr}
      onChange={e => {
        setStepsGoalStr(e.target.value)
        localStorage.setItem("ta_steps_goal", e.target.value)
        const n = parseInt(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ stepsGoal: n })
      }}
      placeholder="10000"
      min={1000}
      step={500}
      className="border-border bg-muted/60 text-sm font-medium"
    />
    <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
      <button type="button"
        onClick={() => { setStepsGoalType('daily'); localStorage.setItem(STEPS_GOAL_TYPE_KEY, 'daily'); patchGoalsDebounced({ stepsGoalType: 'daily' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${stepsGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
      <button type="button"
        onClick={() => { setStepsGoalType('weekly'); localStorage.setItem(STEPS_GOAL_TYPE_KEY, 'weekly'); patchGoalsDebounced({ stepsGoalType: 'weekly' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${stepsGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
    </div>
  </div>
  {/* Sleep Goal */}
  <div className="px-4 py-3">
    <Label className="text-xs text-muted-foreground">Sleep Goal (hours)</Label>
    <Input
      type="number"
      value={sleepGoalStr}
      onChange={e => {
        setSleepGoalStr(e.target.value)
        localStorage.setItem("ta_sleep_goal_hours", e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ sleepGoalHours: n })
      }}
      placeholder="8"
      min={4}
      max={12}
      step={0.5}
      className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
    />
  </div>
  {/* Calorie Goal */}
  <div className="px-4 py-3 space-y-2">
    <Label className="text-xs text-muted-foreground">Calorie Goal</Label>
    <Input
      type="number"
      inputMode="decimal"
      value={calorieGoalStr}
      onChange={e => {
        setCalorieGoalStr(e.target.value)
        localStorage.setItem(CALORIE_GOAL_KEY, e.target.value)
        const n = parseInt(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ calorieGoal: n })
      }}
      placeholder="e.g. 2500"
      className="border-border bg-muted/60 text-sm font-medium"
    />
    <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
      <button type="button"
        onClick={() => { setCalorieGoalType('daily'); localStorage.setItem(CALORIE_TYPE_KEY, 'daily'); patchGoalsDebounced({ calorieGoalType: 'daily' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${calorieGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
      <button type="button"
        onClick={() => { setCalorieGoalType('weekly'); localStorage.setItem(CALORIE_TYPE_KEY, 'weekly'); patchGoalsDebounced({ calorieGoalType: 'weekly' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${calorieGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
    </div>
  </div>
  {/* Water Goal */}
  <div className="px-4 py-3 space-y-2">
    <Label className="text-xs text-muted-foreground">Daily Water Goal</Label>
    <Input
      type="number"
      value={waterGoalStr}
      onChange={e => {
        setWaterGoalStr(e.target.value)
        localStorage.setItem(WATER_GOAL_KEY, e.target.value)
        const n = parseInt(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ waterGoalMl: n })
      }}
      placeholder="2500"
      min={500}
      step={250}
      className="border-border bg-muted/60 text-sm font-medium"
    />
    <div className="flex items-center gap-0.5 rounded-xl bg-muted p-0.5 text-xs font-semibold border border-border self-start">
      <button type="button"
        onClick={() => { setWaterGoalType('daily'); localStorage.setItem(WATER_GOAL_TYPE_KEY, 'daily'); patchGoalsDebounced({ waterGoalType: 'daily' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${waterGoalType === 'daily' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Daily</button>
      <button type="button"
        onClick={() => { setWaterGoalType('weekly'); localStorage.setItem(WATER_GOAL_TYPE_KEY, 'weekly'); patchGoalsDebounced({ waterGoalType: 'weekly' }) }}
        className={`rounded-lg px-4 py-1.5 transition ${waterGoalType === 'weekly' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}>Weekly</button>
    </div>
  </div>
  {/* Target Weight */}
  <div className="px-4 py-3">
    <Label className="text-xs text-muted-foreground">Target Weight (kg)</Label>
    <Input
      type="number"
      value={targetWeightStr}
      onChange={e => {
        setTargetWeightStr(e.target.value)
        localStorage.setItem("ta_target_weight_kg", e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ targetWeightKg: n })
      }}
      placeholder="e.g. 85"
      min={30}
      max={300}
      step={0.5}
      className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
    />
  </div>
  {/* Target BF% */}
  <div className="px-4 py-3">
    <Label className="text-xs text-muted-foreground">Target Body Fat %</Label>
    <Input
      type="number"
      value={targetBfStr}
      onChange={e => {
        setTargetBfStr(e.target.value)
        localStorage.setItem("ta_target_bf_pct", e.target.value)
        const n = parseFloat(e.target.value)
        if (!isNaN(n) && n > 0) patchGoalsDebounced({ targetBfPct: n })
      }}
      placeholder="e.g. 12"
      min={3}
      max={50}
      step={0.5}
      className="mt-0.5 border-0 bg-transparent p-0 h-auto text-sm font-medium focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground/50"
    />
  </div>
</div>
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 7: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "feat: Goals section persists to DB with debounced PATCH, adds water/weight/BF% goals and steps weekly toggle"
```

---

## Task 10: Goal progress bars in Goals section

**Files:**
- Modify: `app/profile/profile-content.tsx`

The progress bars need today's actual values. Profile doesn't load body-metadata by default — we'll fetch it here (lightweight, cached).

- [ ] **Step 1: Add a body-metadata fetch to profile**

In `profile-content.tsx`, add state:
```typescript
const [todayMeta, setTodayMeta] = useState<{ steps: number | null; waterMl: number | null; calories: number | null } | null>(null)
```

Add to the existing `useEffect` that fetches `/api/user/profile`:
```typescript
fetch('/api/body-metadata')
  .then(r => r.ok ? r.json() : null)
  .then((d: { today: { steps?: number | null; waterMl?: number | null; calories?: number | null } | null } | null) => {
    if (d?.today) setTodayMeta({ steps: d.today.steps ?? null, waterMl: d.today.waterMl ?? null, calories: d.today.calories ?? null })
  })
  .catch(() => {})
```

- [ ] **Step 2: Add ProgressBar helper component**

Add above the `SectionHeader` component definition:

```typescript
function GoalProgressBar({ value, goal, color = 'var(--color-brand)' }: { value: number | null; goal: number | null; color?: string }) {
  if (value == null || goal == null || goal <= 0) return null
  const pct = Math.min((value / goal) * 100, 100)
  return (
    <div className="mt-2 space-y-1">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: `color-mix(in oklch, ${color} 15%, transparent)` }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct.toFixed(1)}%`, background: color }} />
      </div>
      <p className="text-[10px] text-muted-foreground tabular-nums">{value.toLocaleString()} / {goal.toLocaleString()}{pct >= 100 ? ' ✓' : ''}</p>
    </div>
  )
}
```

- [ ] **Step 3: Add progress bars to each goal row in the Goals section JSX**

In the Steps Goal row, after the daily/weekly toggle div, add:
```tsx
<GoalProgressBar value={todayMeta?.steps ?? null} goal={parseInt(stepsGoalStr) || null} color="#22c55e" />
```

In the Calorie Goal row, after the daily/weekly toggle div, add:
```tsx
<GoalProgressBar value={todayMeta?.calories ?? null} goal={parseInt(calorieGoalStr) || null} color="#f97316" />
```

In the Water Goal row, after the daily/weekly toggle div, add:
```tsx
<GoalProgressBar value={todayMeta?.waterMl ?? null} goal={parseInt(waterGoalStr) || null} color="#38bdf8" />
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add app/profile/profile-content.tsx
git commit -m "feat: add live progress bars to Goals section showing today vs target"
```

---

## Task 11: Weight & BF% goal progress on body tiles

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Read target weight and BF% from localStorage**

In `health-content.tsx`, add derived values near where `latestBf` and `latestWeight` are computed:

```typescript
const targetWeightKg = (() => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ta_target_weight_kg") : null
    return raw ? parseFloat(raw) : null
  } catch { return null }
})()

const targetBfPct = (() => {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("ta_target_bf_pct") : null
    return raw ? parseFloat(raw) : null
  } catch { return null }
})()
```

- [ ] **Step 2: Add weight goal indicator to the Body Weight tile**

In the Body Weight tile (around line 370–398), after the `WeightSparkline` and `<p className="text-[10px] text-muted-foreground mt-1">Last 7 days</p>` line, add:

```tsx
{targetWeightKg != null && latestWeight != null && (() => {
  const diff = parseFloat((latestWeight - targetWeightKg).toFixed(1))
  return (
    <p className="text-xs font-semibold mt-1" style={{ color: diff <= 0 ? '#22c55e' : '#f97316' }}>
      {diff <= 0 ? '✓ Goal reached' : `↓ ${diff} kg to go`}
    </p>
  )
})()}
```

- [ ] **Step 3: Add BF% goal indicator to the Body Fat tile**

In the body fat tile IIFE (around line 400–461), after the `<p className="text-[10px] text-muted-foreground mt-1">From N readings</p>` line, add:

```tsx
{targetBfPct != null && latestBf != null && (() => {
  const diff = parseFloat((latestBf - targetBfPct).toFixed(1))
  return (
    <p className="text-xs font-semibold mt-1" style={{ color: diff <= 0 ? '#22c55e' : '#f43f5e' }}>
      {diff <= 0 ? '✓ Goal reached' : `↓ ${diff}% to go`}
    </p>
  )
})()}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "feat: add weight and BF% goal progress indicators on body tiles"
```

---

## Task 12: Calorie auto-adjust from calsBurnedToday

The `calsBurnedToday` field from `/api/body-metadata` represents cardio calories burned today. When this is non-null, the effective calorie budget = goal + burned.

**Files:**
- Modify: `app/health/health-content.tsx` (nutrition tab calorie display)
- Modify: `app/session-select/session-select-content.tsx` (home nutrition donut card)

- [ ] **Step 1: Adjust calorie display in the nutrition tab**

In `health-content.tsx`, the `calsBurnedToday` is already fetched from `body-metadata` and stored in state (`setCalsBurnedToday`). The nutrition targets form already reads `nutritionTargets?.calories`. We need to show an adjusted goal.

In the nutrition tab, find where `nutritionTargets?.calories` or the calorie goal is displayed (inside the `tab === "nutrition"` block). Find `<NutritionTargetsForm` or the macro ring. Look for any rendering of the calorie goal — in `MacroRing`. The `MacroRing` component receives a `target` prop. We can compute an adjusted target:

```typescript
const effectiveCalorieGoal = nutritionTargets?.calories != null && calsBurnedToday != null && calsBurnedToday > 0
  ? nutritionTargets.calories + Math.round(calsBurnedToday)
  : nutritionTargets?.calories ?? null
```

Pass `effectiveCalorieGoal` to `MacroRing`'s calorie target where `nutritionTargets?.calories` is currently passed. Find the `MacroRing` usage, change `target={nutritionTargets?.calories ?? null}` to `target={effectiveCalorieGoal}`.

Also add a small callout when the goal is boosted:
```tsx
{calsBurnedToday != null && calsBurnedToday > 0 && nutritionTargets?.calories != null && (
  <p className="text-[10px] text-muted-foreground text-center">
    +{Math.round(calsBurnedToday)} kcal from cardio · adjusted budget {effectiveCalorieGoal?.toLocaleString()} kcal
  </p>
)}
```

Place this callout just below the `MacroRing` component.

- [ ] **Step 2: Adjust calorie display in home nutrition donut card**

In `session-select-content.tsx`, in the `case "card_nutritionDonut"` block (around line 1090–1136):

The `calsBurnedToday` is not yet available in `session-select-content.tsx`. Add state:
```typescript
const [calsBurnedToday, setCalsBurnedToday] = useState<number | null>(null)
```

In `fetchMeta`'s cachedFetch callback for `'body-metadata'`, update to also set calsBurned:
```typescript
(data) => {
  setMetaToday(data.today ?? null);
  setMetaRecent(data.recent ?? []);
  setCalsBurnedToday((data as { calsBurnedToday?: number | null }).calsBurnedToday ?? null);
  setMetaLoading(false);
},
```

In the `card_nutritionDonut` case, change the `goalDisplay` computation:
```typescript
const rawGoalKcal = calorieGoal;
const burnedBoost = calsBurnedToday != null && calsBurnedToday > 0 ? Math.round(calsBurnedToday) : 0;
const boostedGoal = rawGoalKcal != null ? rawGoalKcal + burnedBoost : null;
const isWeekly = calorieType === "weekly";
const goalDisplay = isWeekly && boostedGoal ? boostedGoal * 7 : boostedGoal;
```

Replace the existing `const isWeekly`, `const goalDisplay` lines with the above block.

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1 | head -40
```

- [ ] **Step 4: Commit**

```bash
git add app/health/health-content.tsx app/session-select/session-select-content.tsx
git commit -m "feat: auto-adjust calorie budget by cardio burned calories on nutrition and home cards"
```

---

## Task 13: Create feature branch and push

- [ ] **Step 1: Check current branch and create feature branch if needed**

```bash
git branch --show-current
```

If not already on `feat/batch-b-goals-water`, create and switch:
```bash
git checkout -b feat/batch-b-goals-water
```

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/batch-b-goals-water
```

Expected: branch is pushed to remote.

---

## Task 14: Final integration check

- [ ] **Step 1: Full TypeScript check**

```bash
cd /home/user/TrainingAI && pnpm tsc --noEmit 2>&1
```

Expected: zero errors.

- [ ] **Step 2: Lint check**

```bash
cd /home/user/TrainingAI && pnpm lint 2>&1 | tail -20
```

Expected: no new errors introduced by this batch.

- [ ] **Step 3: Run tests**

```bash
cd /home/user/TrainingAI && pnpm test 2>&1
```

Expected: all pass.

- [ ] **Step 4: Final commit if anything was missed**

```bash
git add -p
git commit -m "chore: fix any remaining lint/type issues from batch B"
```

---

## Self-Review

### Spec coverage check

| Spec item | Task |
|-----------|------|
| Water tile home screen (toggleable) | Task 7 |
| Water tile body screen | Task 8 |
| Water log via custom ml sheet | Task 6 |
| Daily total in body_metrics (water_ml, atomic increment) | Task 1 + Task 3 |
| Water goal in Profile → Goals | Task 9 |
| All goals stored in DB + localStorage | Task 2 + Task 4 + Task 9 |
| Weekly/daily toggle for steps | Task 9 |
| Weekly/daily toggle for water | Task 9 |
| Sleep stays hours-only (no weekly toggle) | Task 9 (no toggle added) |
| Calorie auto-adjust from calsBurnedToday | Task 12 |
| Weight target field in Goals | Task 9 |
| Weight tile progress indicator | Task 11 |
| BF% target field in Goals | Task 9 |
| BF% tile progress indicator | Task 11 |
| Goals live progress bars | Task 10 |
| Goals link from body tab | Task 8, Step 4 |

### Notes on implementation decisions

- `waterIntake` is used as the `MetaKey` in `session-select-content.tsx` to keep the key distinct from the `waterMl` DB column name, avoiding confusion when indexing `metaToday[key]`. The render code maps `waterIntake` → `metaToday.waterMl`.
- The Goals link in `health-content.tsx` uses `href="/profile#goals"` — this is a simple anchor that navigates to profile and scrolls to the goals section. The profile page would need an `id="goals"` anchor on the Goals section div for the scroll to work. This is a nice-to-have; the link works without the anchor (it still navigates to Profile).
- Calorie auto-adjust only applies when `calsBurnedToday > 0` to avoid showing confusing "0 kcal boost" messages.
- `patchGoalsDebounced` uses a 1-second debounce — aggressive enough to feel instant but batches rapid keystrokes.
- The `goalsDbSynced` flag exists for future use (e.g. showing a spinner while DB fetch is in flight).
