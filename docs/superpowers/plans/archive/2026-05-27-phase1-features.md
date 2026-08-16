> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Phase 1 Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent feature additions: interactive week overview, moveable metric widgets, additional health widgets, corrected streak logic, and full session time tracking.

**Architecture:** Each feature is self-contained. Week overview and session time require small API additions; streak is a one-line constant change; widgets use existing localStorage + a sortable UI layer; health widgets surface already-stored body_fat_pct data.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Drizzle ORM, PostgreSQL (Railway), `@dnd-kit/react@0.4`, shadcn/ui Sheet

---

## Feature A — Interactive Week Overview

**What:** Each day dot in the home screen's Mon–Sun week strip becomes tappable. Tapping opens a bottom Sheet showing that day's exercises (name, sets × reps, weight), body metrics (weight, steps, calories), and workout duration.

**Existing data:** `GET /api/day-log?date=YYYY/MM/DD` already returns `{ exercises, bodyMeta, workoutDurations }` — exactly what's needed. The Calendar widget's day overlay already does this pattern (see `app/stats/stats-content.tsx` `handleDayClick`).

### Files
- Modify: `app/session-select/session-select-content.tsx` — add tap handler + Sheet state; render week-day overlay Sheet
- No new files, no API changes

---

### Task A1: Add day-tap state and fetch to SessionSelectContent

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add overlay state near the other `useState` declarations (around line 200)**

```tsx
const [weekOverlay, setWeekOverlay] = useState<{
  date: string;
  data: import("@/app/api/day-log/route").DayLogResult | null;
  loading: boolean;
} | null>(null);
```

- [ ] **Step 2: Add the fetch handler after the existing `fetchMeta` callback**

```tsx
const handleWeekDayClick = useCallback(async (dateStr: string) => {
  // dateStr format: "yyyy/MM/dd" (matches calendarDays keys)
  setWeekOverlay({ date: dateStr, data: null, loading: true });
  try {
    const res = await fetch(`/api/day-log?date=${encodeURIComponent(dateStr)}`);
    const data = res.ok ? await res.json() : null;
    setWeekOverlay(prev => prev ? { ...prev, data, loading: false } : null);
  } catch {
    setWeekOverlay(prev => prev ? { ...prev, loading: false } : null);
  }
}, []);
```

- [ ] **Step 3: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "add week-day overlay state and fetch handler to home screen"
```

---

### Task A2: Make week day boxes tappable

**Files:**
- Modify: `app/session-select/session-select-content.tsx` — the week strip render block (currently around line 591–635)

- [ ] **Step 1: Find the day box render**

The week strip renders 7 boxes. The current element is a `<div>` (not a button). Locate the map that renders `dayLabel`, `dayNum`, and the dot/rest indicator.

- [ ] **Step 2: Wrap each day box in a `<button>` and wire the tap**

Replace the outer `<div>` for each day with:

```tsx
<button
  key={i}
  type="button"
  onClick={() => {
    const dateStr = formatInTimeZone(
      new Date(weekStart.getTime() + i * 86_400_000),
      deviceTz,
      "yyyy/MM/dd",
    );
    handleWeekDayClick(dateStr);
  }}
  className="flex flex-col items-center gap-1 flex-1 rounded-xl py-1 transition active:bg-muted/40"
>
  {/* existing day label, dot, number content unchanged */}
</button>
```

`weekStart` and `deviceTz` are already in scope in this component.

- [ ] **Step 3: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "make week strip days tappable — open day overlay on tap"
```

---

### Task A3: Render the day overlay Sheet

**Files:**
- Modify: `app/session-select/session-select-content.tsx` — add Sheet near the other bottom sheets at the end of the JSX return

- [ ] **Step 1: Add Sheet import if not already present**

`Sheet, SheetContent, SheetHeader, SheetTitle` are already imported in this file — confirm and skip if so.

- [ ] **Step 2: Add the Sheet JSX before the closing `</div>` of the return**

```tsx
{/* Week day overlay */}
<Sheet open={weekOverlay !== null} onOpenChange={open => { if (!open) setWeekOverlay(null); }}>
  <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] px-5">
    <SheetHeader className="mb-4">
      <SheetTitle className="text-left text-base">
        {weekOverlay?.date
          ? new Date(weekOverlay.date.replace(/\//g, "-") + "T12:00:00Z")
              .toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
          : ""}
      </SheetTitle>
    </SheetHeader>

    {weekOverlay?.loading && (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-muted animate-pulse" />)}
      </div>
    )}

    {!weekOverlay?.loading && weekOverlay?.data && (() => {
      const { exercises, bodyMeta, workoutDurations } = weekOverlay.data;
      const sessionNames = [...new Set(exercises.map(e => e.sessionName))];
      return (
        <div className="space-y-4">
          {/* Workout sections per session */}
          {sessionNames.map(sName => {
            const dur = workoutDurations[sName];
            const exs = exercises.filter(e => e.sessionName === sName);
            return (
              <div key={sName}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold" style={{ color: "var(--color-brand)" }}>{sName}</p>
                  {dur && <p className="text-xs text-muted-foreground">{dur.start} · {dur.minutes} min</p>}
                </div>
                <div className="space-y-1.5">
                  {exs.map(ex => (
                    <div key={ex.exerciseLogId} className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2">
                      <p className="text-sm font-medium truncate flex-1">{ex.name}</p>
                      <p className="text-xs text-muted-foreground flex-none ml-2">
                        {ex.sets} × {ex.reps.length > 0 ? ex.reps[0] : "?"} @ {ex.setWeights.length > 0 ? ex.setWeights[0] : "?"}kg
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Body metrics row */}
          {bodyMeta && (
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex gap-4 flex-wrap">
              {bodyMeta.weightKg   != null && <div className="text-center"><p className="text-xs text-muted-foreground">Weight</p><p className="text-sm font-semibold">{bodyMeta.weightKg}kg</p></div>}
              {bodyMeta.steps      != null && <div className="text-center"><p className="text-xs text-muted-foreground">Steps</p><p className="text-sm font-semibold">{bodyMeta.steps.toLocaleString()}</p></div>}
              {bodyMeta.calories   != null && <div className="text-center"><p className="text-xs text-muted-foreground">Calories</p><p className="text-sm font-semibold">{bodyMeta.calories}</p></div>}
            </div>
          )}

          {/* Rest day */}
          {sessionNames.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">Rest day — no workout logged</p>
          )}
        </div>
      );
    })()}
  </SheetContent>
</Sheet>
```

- [ ] **Step 3: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "render interactive week day overlay Sheet with exercises and body metrics"
```

---

## Feature B — Streak Reset After 2 Consecutive Rest Days

**What:** Currently `MAX_REST_GAP = 2` allows 2 consecutive rest days before the streak breaks (breaks after 3+). User's program is 3-on / 1-off; they want 2 consecutive rest days to reset the streak, meaning only 1 rest day is tolerated.

**Change:** `MAX_REST_GAP = 2` → `MAX_REST_GAP = 1`

### Files
- Modify: `app/session-select/session-select-content.tsx` line ~394

---

### Task B1: Update MAX_REST_GAP

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Find and change the constant**

Locate the line (around line 394):
```tsx
const MAX_REST_GAP = 2;
```
Change to:
```tsx
const MAX_REST_GAP = 1;
```

- [ ] **Step 2: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "streak: reset after 2 consecutive rest days (was 3)"
```

---

## Feature C — Full Session Time Tracking

**What:** When a user completes a workout (taps "Complete Workout" or reaches the Done screen), write `completedAt` to the `workout_sessions` row. The `completed_at` column and `completeWorkoutSession()` repo method already exist — only the API endpoint and the client-side call are missing. The Done screen can then show the total session duration.

### Files
- Create: `app/api/complete-workout/route.ts` — POST endpoint, sets `completedAt` on a workout session
- Modify: `components/workout-screen.tsx` — call the new endpoint when mode transitions to "done"
- Modify: `components/workout/done-screen.tsx` — accept and display `durationMinutes` prop

---

### Task C1: Create POST /api/complete-workout

**Files:**
- Create: `app/api/complete-workout/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { workoutSessionId: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { workoutSessionId } = body;
  if (!workoutSessionId) return NextResponse.json({ error: "Missing workoutSessionId" }, { status: 400 });

  const repo = await getRepository();
  await repo.completeWorkoutSession(workoutSessionId, new Date());

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/complete-workout/route.ts
git commit -m "add POST /api/complete-workout to stamp completedAt on workout session"
```

---

### Task C2: Call the endpoint from workout-screen on completion

**Files:**
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Find the two places where `setMode("done")` is called**

1. In the `onCompleteWorkout` prop handler on `<PreWorkoutScreen>` (around line 446):
   ```tsx
   onCompleteWorkout={() => {
     ...
     setMode("done");
     handleAddToCalendar(sessionLog);
   }}
   ```

2. In `advance()` callback when all exercises are done (around line 223):
   ```tsx
   } else {
     setMode("done");
   }
   ```

- [ ] **Step 2: Add a `completeWorkout` helper after `handleAddToCalendar`**

```tsx
const completeWorkout = useCallback(() => {
  workoutEndRef.current = Date.now();
  fetch("/api/complete-workout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workoutSessionId: workoutSessionIdRef.current }),
  }).catch(() => {}); // fire-and-forget
}, []);
```

- [ ] **Step 3: Call `completeWorkout()` from both `setMode("done")` sites**

In `onCompleteWorkout`:
```tsx
onCompleteWorkout={() => {
  const tab = sessionType.toLowerCase();
  localStorage.setItem(`ta_complete_${tab}_${localDateString()}`, "1");
  workoutEndRef.current = Date.now();
  completeWorkout();
  setMode("done");
  handleAddToCalendar(sessionLog);
}}
```

In `advance()`:
```tsx
} else {
  completeWorkout();
  setMode("done");
}
```

- [ ] **Step 4: Pass duration to DoneScreen**

In the `mode === "done"` render block, compute duration and pass it:
```tsx
if (mode === "done") {
  const durationMinutes = workoutStartRef.current && workoutEndRef.current
    ? Math.round((workoutEndRef.current - workoutStartRef.current) / 60000)
    : null;
  return (
    <DoneScreen
      exercises={exercises}
      todayLogged={todayLogged}
      workoutStartMs={workoutStartRef.current}
      calendarLoading={calendarLoading}
      calendarAdded={calendarAdded}
      durationMinutes={durationMinutes}
    />
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "call complete-workout API on session end; pass duration to DoneScreen"
```

---

### Task C3: Show duration on Done screen

**Files:**
- Modify: `components/workout/done-screen.tsx`

- [ ] **Step 1: Add `durationMinutes` to the props interface**

Find the existing props interface and add:
```tsx
durationMinutes?: number | null;
```

- [ ] **Step 2: Accept and render it**

In the destructured props:
```tsx
export function DoneScreen({ ..., durationMinutes }: DoneScreenProps) {
```

Add a duration line below the "You crushed it!" heading (or wherever the stats are displayed):
```tsx
{durationMinutes != null && (
  <p className="text-sm text-muted-foreground">
    Session time: <span className="font-semibold text-foreground">{durationMinutes} min</span>
  </p>
)}
```

- [ ] **Step 3: Commit**

```bash
git add components/workout/done-screen.tsx
git commit -m "show total session duration on workout complete screen"
```

---

## Feature D — Moveable Metric Widgets

**What:** The metric tiles strip on the home screen (Weight, Steps, Calories, etc.) can be long-pressed and dragged to reorder. Order is persisted to localStorage under `ta_ss_widgets`. Uses `@dnd-kit/react` which is already installed.

**Note on @dnd-kit/react 0.4:** This is the new unified package. The sortable API is via `useSortable` from `@dnd-kit/react/sortable`. If the import fails at runtime, fall back to `@dnd-kit/sortable` (separate package install needed). Verify the import works before writing the UI.

### Files
- Create: `components/sortable-widget-tile.tsx` — single draggable metric tile
- Modify: `app/session-select/session-select-content.tsx` — wrap tiles in sortable context

---

### Task D1: Verify @dnd-kit/react sortable imports

**Files:**
- No file changes — just a build check

- [ ] **Step 1: Check what @dnd-kit/react exports**

```bash
node -e "const m = require('/home/user/TrainingAI/node_modules/@dnd-kit/react'); console.log(Object.keys(m))" 2>/dev/null || echo "module not loadable in CJS"
ls /home/user/TrainingAI/node_modules/@dnd-kit/
```

If `@dnd-kit/sortable` is NOT present and `@dnd-kit/react` has no sortable export, install it:
```bash
cd /home/user/TrainingAI && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Confirm sortable import**

```bash
node -e "require('/home/user/TrainingAI/node_modules/@dnd-kit/sortable')" && echo "ok" || echo "not found"
```

Use `@dnd-kit/core` + `@dnd-kit/sortable` if present; otherwise use `@dnd-kit/react`.

---

### Task D2: Create SortableWidgetTile component

**Files:**
- Create: `components/sortable-widget-tile.tsx`

This component wraps a metric tile with drag handle behaviour using `useSortable`.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";

interface Props {
  id: string;
  children: React.ReactNode;
  editMode: boolean;
}

export function SortableWidgetTile({ id, children, editMode }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {editMode && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-1 right-1 z-10 rounded p-0.5 text-muted-foreground touch-none"
        >
          <GripVerticalIcon className="h-3 w-3" />
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sortable-widget-tile.tsx
git commit -m "add SortableWidgetTile wrapper for drag-to-reorder metric tiles"
```

---

### Task D3: Wire sortable context into home screen metric tiles

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

- [ ] **Step 1: Add imports at the top**

```tsx
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableWidgetTile } from "@/components/sortable-widget-tile";
```

- [ ] **Step 2: Add edit mode state near the other widget state declarations**

```tsx
const [widgetEditMode, setWidgetEditMode] = useState(false);
```

- [ ] **Step 3: Add DnD sensors**

```tsx
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
);
```

- [ ] **Step 4: Add drag-end handler**

```tsx
const handleWidgetDragEnd = useCallback((event: import("@dnd-kit/core").DragEndEvent) => {
  const { active, over } = event;
  if (over && active.id !== over.id) {
    setActiveWidgets(prev => {
      const oldIndex = prev.indexOf(active.id as typeof prev[number]);
      const newIndex = prev.indexOf(over.id as typeof prev[number]);
      const next = arrayMove(prev, oldIndex, newIndex);
      localStorage.setItem(WIDGETS_KEY, JSON.stringify(next));
      return next;
    });
  }
}, []);
```

- [ ] **Step 5: Wrap the metric tiles render in DndContext + SortableContext**

Find the metric tiles render (the `.map()` over `activeWidgets` that renders each tile). Wrap it:

```tsx
<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleWidgetDragEnd}>
  <SortableContext items={activeWidgets} strategy={horizontalListSortingStrategy}>
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
      {activeWidgets
        .filter(key => WIDGET_DEFS.find(d => d.key === key))
        .map(key => {
          const def = WIDGET_DEFS.find(d => d.key === key)!;
          // ... existing tile render code, unchanged ...
          return (
            <SortableWidgetTile key={key} id={key} editMode={widgetEditMode}>
              {/* existing tile JSX */}
            </SortableWidgetTile>
          );
        })}
    </div>
  </SortableContext>
</DndContext>
```

- [ ] **Step 6: Add edit mode toggle button**

In the metric tiles section header (near where "Widget Picker" was), add a small edit button:
```tsx
<button
  type="button"
  onClick={() => setWidgetEditMode(e => !e)}
  className="text-xs text-muted-foreground underline"
>
  {widgetEditMode ? "Done" : "Reorder"}
</button>
```

- [ ] **Step 7: Commit**

```bash
git add app/session-select/session-select-content.tsx components/sortable-widget-tile.tsx
git commit -m "implement drag-to-reorder metric tiles on home screen"
```

---

## Feature E — Additional Health Widgets (Body Fat)

**What:** The Health page's Body tab already fetches `body_metrics` which includes `body_fat_pct`. Add a body fat trend card showing the current reading and a sparkline over recent entries. Heart rate is NOT in the schema and is not included in this phase.

### Files
- Modify: `app/health/health-content.tsx` — add body fat card to Body tab

---

### Task E1: Add body fat widget to Health Body tab

**Files:**
- Modify: `app/health/health-content.tsx`

- [ ] **Step 1: Find where `metaRecent` is used for the weight sparkline (around line 210)**

The weight sparkline renders `metaRecent` data filtered for `weightKg`. Body fat uses `bodyFatPct` from the same rows.

- [ ] **Step 2: Add body fat card after the weight sparkline card**

Find the closing `</div>` of the weight sparkline card and insert after it:

```tsx
{/* Body Fat */}
{(() => {
  const bfPoints = [...metaRecent].reverse().map(r => r.bodyFatPct).filter((v): v is number => v != null);
  const latestBf = bfPoints[bfPoints.length - 1] ?? null;
  if (latestBf == null) return null;
  return (
    <div
      className="rounded-2xl border p-4 relative overflow-hidden"
      style={{ borderColor: "rgba(191,95,255,0.2)", background: "linear-gradient(135deg, rgba(191,95,255,0.08), rgba(191,95,255,0.02))" }}
    >
      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none" style={{ background: "#bf5fff", filter: "blur(28px)", opacity: 0.15 }} />
      <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: "#bf5fff" }}>Body Fat</p>
      <p className="text-3xl font-black mb-1">{latestBf.toFixed(1)}<span className="text-base font-semibold text-muted-foreground ml-1">%</span></p>
      {bfPoints.length >= 2 && (() => {
        const min = Math.min(...bfPoints) - 0.5;
        const max = Math.max(...bfPoints) + 0.5;
        const range = max - min || 1;
        const W = 160; const H = 40;
        const step = W / (bfPoints.length - 1);
        return (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible mt-1">
            <polyline
              points={bfPoints.map((v, i) => `${(i * step).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`).join(" ")}
              fill="none" stroke="#bf5fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
        );
      })()}
      <p className="text-xs text-muted-foreground mt-1">From {bfPoints.length} reading{bfPoints.length !== 1 ? "s" : ""}</p>
    </div>
  );
})()}
```

- [ ] **Step 3: Check that `metaRecent` type includes `bodyFatPct`**

In `app/api/body-metadata/route.ts`, confirm `BodyMetaRow` includes `bodyFatPct?: number | null`. If it doesn't expose it, add it to the API response (read the route, add `bodyFatPct: row.bodyFatPct` to the mapped object, and update the `BodyMetaRow` interface).

- [ ] **Step 4: Commit**

```bash
git add app/health/health-content.tsx
git commit -m "add body fat trend card to Health Body tab"
```

---

## Execution Order

Implement in this sequence (each is independent but ordered by impact):

1. **B** (Streak) — 1 line change, instant value
2. **C** (Session time) — small API + 2 component changes
3. **A** (Week overview) — moderate UI work, high impact
4. **E** (Body fat widget) — small UI addition
5. **D** (Moveable widgets) — most complex, verify dnd-kit imports first

---

## Known Gaps / Out of Scope for This Plan

- **Heart rate widget:** Not in `body_metrics` schema. Requires HC sync update + DB migration. Deferred to a separate plan.
- **Moveable card widgets** (Weight Sparkline, Nutrition Donut, etc.): Only metric tiles are made sortable. Card widgets are fewer and rarely reordered.
- **Server-side streak:** Streak is calculated client-side from `calendarDays`. This is fast and correct; no server change needed.
