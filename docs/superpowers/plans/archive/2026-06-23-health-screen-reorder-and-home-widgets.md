# Health Screen Reorder + Home Widgets Expanded — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 14 body-tab card sections (plus Training and Progress) draggable via long-press edit mode; expand the home screen from 5 to 21 card widget types; add a grouped card-widget layout in Settings and a new Health Screen visibility section.

**Architecture:** Health screen drag-and-drop follows the exact same `@dnd-kit/react` `PointerSensor` + `useSortable` pattern as the home screen (`home-sortable-section.tsx`). New home card widgets follow the existing inline `case` pattern in `session-select-content.tsx`'s switch statement. Settings groups are additive — the existing `HomeWidgetsSection` component gets a grouped layout; a new `HealthScreenSection` component mirrors the pattern.

**Tech Stack:** `@dnd-kit/react`, `@dnd-kit/dom`, TypeScript, React 19, Tailwind CSS v4, localStorage for persistence, `vitest` for unit tests.

---

## File Structure

**New files:**
- `lib/health-card-order.ts` — localStorage helpers: `getHealthCardOrder`, `saveHealthCardOrder`, `getHiddenHealthCards`, `saveHiddenHealthCards`
- `lib/__tests__/health-card-order.test.ts` — unit tests for the helpers
- `components/health/sortable-health-card.tsx` — sortable wrapper for health screen cards (mirrors `home-sortable-section.tsx`, no hide button)
- `components/more/health-screen-section.tsx` — new Settings expandable row for health card visibility

**Modified files:**
- `app/health/health-content.tsx` — add edit-mode state + long-press, DragDropProvider for all three tabs, refactor tab content into `renderBodySection`/`renderTrainingSection`/`renderProgressSection` switch fns
- `app/session-select/constants.ts` — add 16 new `CARD_DEFAULT_COLORS` entries
- `app/session-select/session-select-content.tsx` — expand `CardWidgetKey` union by 16 types, add 3 new data-fetching `useEffect`s, add 16 new `case` blocks in the section switch
- `components/more/home-widgets-section.tsx` — replace flat card-widget pill list with five grouped sections; expand inline `CardWidgetKey` and `CARD_DEFAULT_COLORS`
- `components/more/profile-tab.tsx` — import and render `<HealthScreenSection />` below `<HomeWidgetsSection />`

---

## Task 1: localStorage helpers for health card order/visibility

**Files:**
- Create: `lib/health-card-order.ts`
- Create: `lib/__tests__/health-card-order.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/__tests__/health-card-order.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

import { getHealthCardOrder, saveHealthCardOrder, getHiddenHealthCards, saveHiddenHealthCards } from '../health-card-order';

const DEFAULT = ['a', 'b', 'c'];

describe('getHealthCardOrder', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns defaultOrder when nothing stored', () => {
    expect(getHealthCardOrder('body', DEFAULT)).toEqual(DEFAULT);
  });

  it('returns stored order when it matches default keys', () => {
    saveHealthCardOrder('body', ['c', 'a', 'b']);
    expect(getHealthCardOrder('body', DEFAULT)).toEqual(['c', 'a', 'b']);
  });

  it('appends new keys not in stored order', () => {
    saveHealthCardOrder('body', ['b', 'a']);
    expect(getHealthCardOrder('body', ['a', 'b', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('drops stored keys not in default', () => {
    saveHealthCardOrder('body', ['a', 'b', 'c', 'orphan']);
    expect(getHealthCardOrder('body', DEFAULT)).toEqual(['a', 'b', 'c']);
  });

  it('uses separate keys per tab', () => {
    saveHealthCardOrder('training', ['x', 'y']);
    expect(getHealthCardOrder('body', DEFAULT)).toEqual(DEFAULT);
  });
});

describe('getHiddenHealthCards', () => {
  beforeEach(() => localStorageMock.clear());

  it('returns empty set when nothing stored', () => {
    expect(getHiddenHealthCards().size).toBe(0);
  });

  it('round-trips through save/load', () => {
    saveHiddenHealthCards(new Set(['bodyFat', 'sleep']));
    const result = getHiddenHealthCards();
    expect(result.has('bodyFat')).toBe(true);
    expect(result.has('sleep')).toBe(true);
    expect(result.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

```bash
pnpm vitest run lib/__tests__/health-card-order.test.ts
```

Expected: `Cannot find module '../health-card-order'`

- [ ] **Step 3: Implement the helpers**

```typescript
// lib/health-card-order.ts
const BODY_ORDER_KEY     = "ta_health_body_order";
const TRAINING_ORDER_KEY = "ta_health_training_order";
const PROGRESS_ORDER_KEY = "ta_health_progress_order";
export const HEALTH_HIDDEN_KEY = "ta_health_hidden";

export type HealthTab = "body" | "training" | "progress";

function orderKey(tab: HealthTab): string {
  return tab === "body" ? BODY_ORDER_KEY
    : tab === "training" ? TRAINING_ORDER_KEY
    : PROGRESS_ORDER_KEY;
}

export function getHealthCardOrder(tab: HealthTab, defaultOrder: string[]): string[] {
  try {
    const raw = localStorage.getItem(orderKey(tab));
    if (!raw) return defaultOrder;
    const stored: string[] = JSON.parse(raw);
    const inDefault = stored.filter(k => defaultOrder.includes(k));
    const missing   = defaultOrder.filter(k => !stored.includes(k));
    return [...inDefault, ...missing];
  } catch {
    return defaultOrder;
  }
}

export function saveHealthCardOrder(tab: HealthTab, order: string[]): void {
  localStorage.setItem(orderKey(tab), JSON.stringify(order));
}

export function getHiddenHealthCards(): Set<string> {
  try {
    const raw = localStorage.getItem(HEALTH_HIDDEN_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

export function saveHiddenHealthCards(hidden: Set<string>): void {
  localStorage.setItem(HEALTH_HIDDEN_KEY, JSON.stringify([...hidden]));
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run lib/__tests__/health-card-order.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/health-card-order.ts lib/__tests__/health-card-order.test.ts
git commit -m "feat: add health card order/visibility localStorage helpers"
```

---

## Task 2: SortableHealthCard component

**Files:**
- Create: `components/health/sortable-health-card.tsx`

- [ ] **Step 1: Create the component**

This mirrors `components/home-sortable-section.tsx` exactly except no hide button (health screen edit mode is reorder-only).

```tsx
// components/health/sortable-health-card.tsx
"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  id: string;
  index: number;
  editMode: boolean;
  children: ReactNode;
}

export function SortableHealthCard({ id, index, editMode, children }: Props) {
  const { ref, isDragging } = useSortable({ id, index });
  return (
    <div
      ref={ref}
      className={cn("relative select-none", isDragging && "z-50 opacity-40 scale-[0.98]")}
      style={{ touchAction: isDragging ? "none" : "pan-y" }}
      data-health-card
    >
      {editMode && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10 text-muted-foreground/50 pointer-events-none">
          <GripVerticalIcon className="h-5 w-5" />
        </div>
      )}
      <div className={cn(editMode && "ml-5 ring-1 ring-white/10 rounded-2xl bg-white/[0.03] transition-[margin]")}>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/health/sortable-health-card.tsx
git commit -m "feat: add SortableHealthCard drag-handle wrapper"
```

---

## Task 3: Health screen edit mode + drag-and-drop (all three tabs)

**Files:**
- Modify: `app/health/health-content.tsx`

This is the largest task. The body tab's inline JSX (~600 lines) must be refactored into a `renderBodySection(key)` switch so the order array can be iterated. Training and Progress tabs get the same treatment with simpler, flat section lists.

### Section key definitions (add near top of file, before the component)

**Body tab** — 14 draggable sections. Each section may contain multiple individually-togglable card keys (for Settings). A section is hidden from the drag order only when ALL its card keys are in `hiddenCards`.

```typescript
type BodySectionDef = { key: string; cardKeys: string[] };

const BODY_SECTIONS: BodySectionDef[] = [
  { key: "bodyWeight",         cardKeys: ["bodyWeight"]                  },
  { key: "bodyFat",            cardKeys: ["bodyFat"]                     },
  { key: "leanMass",           cardKeys: ["leanMass"]                    },
  { key: "sleep",              cardKeys: ["sleep"]                       },
  { key: "steps",              cardKeys: ["steps", "distance"]           },
  { key: "ouraIndicators",     cardKeys: ["ouraIndicators"]              },
  { key: "waterIntake",        cardKeys: ["waterIntake"]                 },
  { key: "caloriesBurned",     cardKeys: ["caloriesBurned", "bmi"]       },
  { key: "weightTrend",        cardKeys: ["weightTrend", "energyBalance"]},
  { key: "rhr",                cardKeys: ["rhr", "hrv", "spo2"]          },
  { key: "trainingLoad",       cardKeys: ["trainingLoad"]                },
  { key: "sleepVsPerformance", cardKeys: ["sleepVsPerformance"]          },
  { key: "injury",             cardKeys: ["injury"]                      },
  { key: "ouraSection",        cardKeys: ["ouraSection"]                 },
];
const BODY_DEFAULT_ORDER = BODY_SECTIONS.map(s => s.key);

const TRAINING_DEFAULT_ORDER = [
  "calendar", "weeklyStats", "aiPeriodization", "aiVolume",
  "muscleSets", "weeklySummary", "activityHistory",
];

const PROGRESS_DEFAULT_ORDER = [
  "strengthProgress", "goalsProgress", "weightTrendProgress", "strengthTrend",
];
```

### Imports to add

```typescript
import { DragDropProvider, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { isSortableOperation } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { SortableHealthCard } from "@/components/health/sortable-health-card";
import { getHealthCardOrder, saveHealthCardOrder, getHiddenHealthCards } from "@/lib/health-card-order";
```

### State to add (inside the component, after existing state)

```typescript
const [editMode, setEditMode]     = useState(false);
const [bodyOrder, setBodyOrder]   = useState<string[]>(() =>
  typeof window !== "undefined" ? getHealthCardOrder("body", BODY_DEFAULT_ORDER) : BODY_DEFAULT_ORDER
);
const [trainingOrder, setTrainingOrder] = useState<string[]>(() =>
  typeof window !== "undefined" ? getHealthCardOrder("training", TRAINING_DEFAULT_ORDER) : TRAINING_DEFAULT_ORDER
);
const [progressOrder, setProgressOrder] = useState<string[]>(() =>
  typeof window !== "undefined" ? getHealthCardOrder("progress", PROGRESS_DEFAULT_ORDER) : PROGRESS_DEFAULT_ORDER
);
const [hiddenCards, setHiddenCards] = useState<Set<string>>(() =>
  typeof window !== "undefined" ? getHiddenHealthCards() : new Set()
);
```

Read `hiddenCards` back from localStorage on mount (needed because `useState` initialiser runs server-side too):

```typescript
useEffect(() => {
  setHiddenCards(getHiddenHealthCards());
  setBodyOrder(getHealthCardOrder("body", BODY_DEFAULT_ORDER));
  setTrainingOrder(getHealthCardOrder("training", TRAINING_DEFAULT_ORDER));
  setProgressOrder(getHealthCardOrder("progress", PROGRESS_DEFAULT_ORDER));
}, []);
```

### Long-press edit mode refs (add after state declarations)

```typescript
const editTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
const ptrStartRef       = useRef<{ x: number; y: number } | null>(null);
```

### Long-press handlers

Add these as `useCallback`s alongside the existing handler functions:

```typescript
const handleCardPointerDown = useCallback((e: React.PointerEvent) => {
  ptrStartRef.current = { x: e.clientX, y: e.clientY };
  editTimerRef.current = setTimeout(() => setEditMode(prev => !prev), 500);
}, []);

const handleCardPointerMove = useCallback((e: React.PointerEvent) => {
  if (!ptrStartRef.current || !editTimerRef.current) return;
  if (Math.abs(e.clientX - ptrStartRef.current.x) > 8 ||
      Math.abs(e.clientY - ptrStartRef.current.y) > 8) {
    clearTimeout(editTimerRef.current);
    editTimerRef.current = null;
  }
}, []);

const handleCardPointerUp = useCallback(() => {
  if (editTimerRef.current) { clearTimeout(editTimerRef.current); editTimerRef.current = null; }
  ptrStartRef.current = null;
}, []);

const handleTabContainerClick = useCallback((e: React.MouseEvent) => {
  if (!editMode) return;
  if (!(e.target as Element).closest('[data-health-card]')) setEditMode(false);
}, [editMode]);
```

### Drag-end handlers for each tab

```typescript
const handleBodyDragEnd = useCallback((event: DragEndEvent) => {
  if (event.canceled || !isSortableOperation(event.operation)) return;
  const { source } = event.operation;
  if (!source) return;
  const visible = bodyOrder.filter(k => {
    const s = BODY_SECTIONS.find(sec => sec.key === k);
    return !s || !s.cardKeys.every(ck => hiddenCards.has(ck));
  });
  const fromKey = visible[source.initialIndex];
  const toKey   = visible[source.index];
  if (!fromKey || !toKey || fromKey === toKey) return;
  const next = [...bodyOrder];
  next.splice(next.indexOf(fromKey), 1);
  next.splice(next.indexOf(toKey), 0, fromKey);
  saveHealthCardOrder("body", next);
  setBodyOrder(next);
}, [bodyOrder, hiddenCards]);

const handleTrainingDragEnd = useCallback((event: DragEndEvent) => {
  if (event.canceled || !isSortableOperation(event.operation)) return;
  const { source } = event.operation;
  if (!source) return;
  const fromKey = trainingOrder[source.initialIndex];
  const toKey   = trainingOrder[source.index];
  if (!fromKey || !toKey || fromKey === toKey) return;
  const next = [...trainingOrder];
  next.splice(next.indexOf(fromKey), 1);
  next.splice(next.indexOf(toKey), 0, fromKey);
  saveHealthCardOrder("training", next);
  setTrainingOrder(next);
}, [trainingOrder]);

const handleProgressDragEnd = useCallback((event: DragEndEvent) => {
  if (event.canceled || !isSortableOperation(event.operation)) return;
  const { source } = event.operation;
  if (!source) return;
  const fromKey = progressOrder[source.initialIndex];
  const toKey   = progressOrder[source.index];
  if (!fromKey || !toKey || fromKey === toKey) return;
  const next = [...progressOrder];
  next.splice(next.indexOf(fromKey), 1);
  next.splice(next.indexOf(toKey), 0, fromKey);
  saveHealthCardOrder("progress", next);
  setProgressOrder(next);
}, [progressOrder]);
```

### DnD sensor config (shared)

```typescript
const healthSensors = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Delay({ value: 300, tolerance: 8 })],
  }),
];
```

### Refactor body tab

The existing `{tab === "body" && <> ... </>}` block (~lines 598–1195) must be replaced with:

1. A `renderBodySection(key: string)` function that contains the same JSX, split into `case` statements.
2. The section render loop with `SortableHealthCard`.

Wrap each card's root div with the long-press handlers:

```tsx
function renderBodySection(key: string): React.ReactNode {
  const pointerProps = {
    onPointerDown: handleCardPointerDown,
    onPointerMove: handleCardPointerMove,
    onPointerUp:   handleCardPointerUp,
  };
  switch (key) {
    case "bodyWeight": return (
      <div {...pointerProps}>
        {/* Move existing body weight card JSX here verbatim (lines 600–636) */}
      </div>
    );
    case "bodyFat": return (
      <div {...pointerProps}>
        {/* Move existing body fat card JSX here verbatim (lines 637–706) */}
      </div>
    );
    case "leanMass": return (
      <div {...pointerProps}>
        {/* Move existing lean mass card JSX here verbatim (lines 708–743) */}
      </div>
    );
    case "sleep": return (
      <div {...pointerProps}>
        {/* Move existing sleep card JSX here verbatim (lines 745–797) */}
      </div>
    );
    case "steps": {
      const showSteps    = !hiddenCards.has("steps");
      const showDistance = !hiddenCards.has("distance");
      if (!showSteps && !showDistance) return null;
      return (
        <div {...pointerProps}>
          {/* Move existing steps+distance 2-col grid JSX here (lines 800–846).
              Wrap each column's content with: showSteps ? <col/> : null */}
        </div>
      );
    }
    case "ouraIndicators": return (
      <div {...pointerProps}>
        {/* Lines 849–908 */}
      </div>
    );
    case "waterIntake": return (
      <div {...pointerProps}>
        {/* Lines 911–942 */}
      </div>
    );
    case "caloriesBurned": {
      const showCals = !hiddenCards.has("caloriesBurned");
      const showBmi  = !hiddenCards.has("bmi");
      if (!showCals && !showBmi) return null;
      return (
        <div {...pointerProps}>
          {/* Lines 945–988 — show/hide individual cols */}
        </div>
      );
    }
    case "weightTrend": {
      const showTrend   = !hiddenCards.has("weightTrend");
      const showEnergy  = !hiddenCards.has("energyBalance");
      if (!showTrend && !showEnergy) return null;
      return (
        <div {...pointerProps}>
          {/* Lines 991–1048 */}
        </div>
      );
    }
    case "rhr": {
      const showRhr = !hiddenCards.has("rhr");
      const showHrv = !hiddenCards.has("hrv");
      const showSpo = !hiddenCards.has("spo2");
      if (!showRhr && !showHrv && !showSpo) return null;
      return (
        <div {...pointerProps}>
          {/* Lines 1051–1112 — filter the 3-col grid */}
        </div>
      );
    }
    case "trainingLoad": return (
      <div {...pointerProps}>
        {/* Lines 1114–1149 */}
      </div>
    );
    case "sleepVsPerformance": return (
      <div {...pointerProps}>
        {/* Lines 1151–1184 */}
      </div>
    );
    case "injury": return hiddenCards.has("injury") ? null : (
      <div {...pointerProps}>
        {/* Lines 1186–1192 */}
      </div>
    );
    case "ouraSection": return hiddenCards.has("ouraSection") ? null : (
      <div {...pointerProps}>
        {/* Line 1194 */}
      </div>
    );
    default: return null;
  }
}
```

Then replace the existing `{tab === "body" && <> ... </>}` block with:

```tsx
{tab === "body" && (
  <DragDropProvider sensors={healthSensors} onDragEnd={handleBodyDragEnd}>
    <div onClick={handleTabContainerClick}>
      {bodyOrder
        .filter(k => {
          const s = BODY_SECTIONS.find(sec => sec.key === k);
          return !s || !s.cardKeys.every(ck => hiddenCards.has(ck));
        })
        .map((k, i) => (
          <SortableHealthCard key={k} id={k} index={i} editMode={editMode}>
            {renderBodySection(k)}
          </SortableHealthCard>
        ))}
    </div>
  </DragDropProvider>
)}
```

### Refactor training tab

Replace the existing `{tab === "training" && ...}` block with:

```tsx
{tab === "training" && (
  <DragDropProvider sensors={healthSensors} onDragEnd={handleTrainingDragEnd}>
    <div className="space-y-4" onClick={handleTabContainerClick}>
      {trainingOrder.map((k, i) => (
        <SortableHealthCard key={k} id={k} index={i} editMode={editMode}>
          <div
            onPointerDown={handleCardPointerDown}
            onPointerMove={handleCardPointerMove}
            onPointerUp={handleCardPointerUp}
          >
            {renderTrainingSection(k)}
          </div>
        </SortableHealthCard>
      ))}
    </div>
  </DragDropProvider>
)}
```

`renderTrainingSection`:

```typescript
function renderTrainingSection(key: string): React.ReactNode {
  switch (key) {
    case "calendar": return (
      <div className="rounded-2xl bg-muted/60 border border-border p-4">
        <CalendarWidget onDayClick={handleDayClick} />
      </div>
    );
    case "weeklyStats": return <WeeklyStatsHub data={weeklyStats} loading={weeklyStats === null} sessions={activeSessions} />;
    case "aiPeriodization": return <AiPeriodizationStatusCard />;
    case "aiVolume": return <AiWeeklyVolumeCard />;
    case "muscleSets": return <WeeklyMuscleSetsCard muscles={muscleSets ?? []} loading={muscleSets === null} title="Muscle Volume This Week" />;
    case "weeklySummary": return <WeeklySummaryCard />;
    case "activityHistory": return <ActivityHistoryCard />;
    default: return null;
  }
}
```

### Refactor progress tab

Replace the existing `{tab === "progress" && ...}` block with:

```tsx
{tab === "progress" && (
  <DragDropProvider sensors={healthSensors} onDragEnd={handleProgressDragEnd}>
    <div className="space-y-4" onClick={handleTabContainerClick}>
      {progressOrder.map((k, i) => (
        <SortableHealthCard key={k} id={k} index={i} editMode={editMode}>
          <div
            onPointerDown={handleCardPointerDown}
            onPointerMove={handleCardPointerMove}
            onPointerUp={handleCardPointerUp}
          >
            {renderProgressSection(k)}
          </div>
        </SortableHealthCard>
      ))}
    </div>
  </DragDropProvider>
)}
```

`renderProgressSection`:

```typescript
function renderProgressSection(key: string): React.ReactNode {
  switch (key) {
    case "strengthProgress": return <StrengthProgressCard />;
    case "goalsProgress": return (
      <GoalsProgressCard
        metaToday={metaToday}
        weekToDate={weekToDate}
        userGoals={userGoals}
        progressSummary={progressSummary}
      />
    );
    case "weightTrendProgress": return (
      <div className="rounded-2xl p-4 bg-muted/30 border border-border/40">
        {/* Move existing weight trend + goal progress JSX here verbatim (lines 1221–1267) */}
      </div>
    );
    case "strengthTrend": return <StrengthTrendCard exercises={strengthTrend ?? []} loading={strengthTrend === null} />;
    default: return null;
  }
}
```

- [ ] **Step 1: Add imports to health-content.tsx**

Add to the existing imports at the top:
```typescript
import { DragDropProvider, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { isSortableOperation } from "@dnd-kit/react/sortable";
import { PointerActivationConstraints } from "@dnd-kit/dom";
import { SortableHealthCard } from "@/components/health/sortable-health-card";
import { getHealthCardOrder, saveHealthCardOrder, getHiddenHealthCards } from "@/lib/health-card-order";
```

- [ ] **Step 2: Add section definitions, state, handlers**

Between the interface declarations and the component function body (or right after the existing `useState` declarations), add all constants, state, refs, and handlers shown above.

- [ ] **Step 3: Add the `renderBodySection` switch function**

Add `renderBodySection`, moving the existing body-tab JSX blocks into their respective `case` statements. Do not change any existing card JSX — only move it. The function must be declared inside the component so it closes over all existing state (`metaToday`, `metaRecent`, `hiddenCards`, etc.).

- [ ] **Step 4: Replace body tab block**

Replace the existing `{tab === "body" && <> ... </>}` with the `DragDropProvider` + ordered map shown above.

- [ ] **Step 5: Add `renderTrainingSection` and replace training tab block**

- [ ] **Step 6: Add `renderProgressSection` and replace progress tab block**

- [ ] **Step 7: Run TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -40
```

Fix any type errors before proceeding.

- [ ] **Step 8: Start dev server and smoke-test**

```bash
pnpm dev &
```

- Navigate to `/health?tab=body`
- Long-press any card for 500ms — confirm edit mode activates (cards get left margin + grip icon)
- Drag a card up or down — confirm it reorders
- Tap outside all cards — confirm edit mode exits
- Refresh page — confirm order is preserved
- Switch tabs — confirm Training and Progress tabs also support drag

- [ ] **Step 9: Commit**

```bash
git add app/health/health-content.tsx components/health/sortable-health-card.tsx
git commit -m "feat: health screen drag-and-drop card reordering via long-press edit mode"
```

---

## Task 4: Health Screen Settings section

**Files:**
- Create: `components/more/health-screen-section.tsx`
- Modify: `components/more/profile-tab.tsx`

This section mirrors the Home Widgets `Card Widgets` group layout but controls which Body-tab cards are visible on the health screen. No color picker (health screen edit mode is reorder-only; colors are a home-screen concept).

- [ ] **Step 1: Create health-screen-section.tsx**

```tsx
// components/more/health-screen-section.tsx
"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Heart } from "lucide-react";
import { getHiddenHealthCards, saveHiddenHealthCards } from "@/lib/health-card-order";

type HealthCardKey = string;

type GroupDef = {
  label: string;
  cards: { key: HealthCardKey; label: string }[];
};

const GROUPS: GroupDef[] = [
  {
    label: "Body",
    cards: [
      { key: "bodyWeight",  label: "Body Weight" },
      { key: "bodyFat",     label: "Body Fat %" },
      { key: "leanMass",    label: "Lean Mass" },
      { key: "bmi",         label: "BMI" },
      { key: "weightTrend", label: "Weight Trend" },
    ],
  },
  {
    label: "Daily",
    cards: [
      { key: "steps",           label: "Steps" },
      { key: "distance",        label: "Distance" },
      { key: "waterIntake",     label: "Water Intake" },
      { key: "caloriesBurned",  label: "Calories Burned" },
      { key: "energyBalance",   label: "Energy Balance" },
    ],
  },
  {
    label: "Recovery",
    cards: [
      { key: "sleep",           label: "Sleep" },
      { key: "rhr",             label: "Resting HR" },
      { key: "hrv",             label: "HRV" },
      { key: "spo2",            label: "SpO₂" },
      { key: "ouraIndicators",  label: "Oura Indicators" },
      { key: "ouraSection",     label: "Oura Section" },
    ],
  },
  {
    label: "Performance",
    cards: [
      { key: "trainingLoad",       label: "Training Load" },
      { key: "sleepVsPerformance", label: "Sleep vs Performance" },
      { key: "injury",             label: "Injury" },
    ],
  },
];

export function HealthScreenSection() {
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    setHidden(getHiddenHealthCards());
  }, []);

  function toggle(key: string) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      saveHiddenHealthCards(next);
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between px-4 py-3.5 hover:bg-muted/60 transition"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "color-mix(in oklch, var(--color-brand) 15%, var(--color-muted))" }}
          >
            <Heart className="h-4 w-4" style={{ color: "var(--color-brand)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-left">Health Screen</p>
            <p className="text-[10px] text-muted-foreground">Manage visible cards</p>
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-4">
          {GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                {group.label}
              </p>
              <div className="flex gap-2 flex-wrap">
                {group.cards.map(card => {
                  const visible = !hidden.has(card.key);
                  return (
                    <button
                      key={card.key}
                      type="button"
                      onClick={() => toggle(card.key)}
                      className={`rounded-xl px-3 py-2 text-sm font-medium border transition ${
                        visible
                          ? "border-brand bg-brand/10 text-brand"
                          : "border-border bg-muted text-muted-foreground line-through opacity-60"
                      }`}
                    >
                      {card.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Import and add to profile-tab.tsx**

In `components/more/profile-tab.tsx`, find the line:

```typescript
import { HomeWidgetsSection } from './home-widgets-section'
```

Add below it:

```typescript
import { HealthScreenSection } from './health-screen-section'
```

Then find the `<HomeWidgetsSection />` usage (around line 459):

```tsx
{/* Home Widgets */}
<HomeWidgetsSection />
```

Add after it (still inside the same `divide-y` container):

```tsx
{/* Health Screen */}
<HealthScreenSection />
```

- [ ] **Step 3: Verify in dev server**

Navigate to Settings → Profile tab → scroll to the SETTINGS group. Confirm "Health Screen" expandable row appears below "Home Widgets". Expand it — confirm four groups (Body, Daily, Recovery, Performance) with pill toggles. Toggle a card off, navigate to `/health?tab=body`, confirm the card is gone. Toggle it back on, confirm it reappears.

- [ ] **Step 4: Commit**

```bash
git add components/more/health-screen-section.tsx components/more/profile-tab.tsx
git commit -m "feat: add Health Screen card visibility section in Settings"
```

---

## Task 5: Extend home card widget types and colors

**Files:**
- Modify: `app/session-select/constants.ts`
- Modify: `app/session-select/session-select-content.tsx` (type only, cases in Task 6)

The `CardWidgetKey` type is declared locally in `session-select-content.tsx` (line 43) and separately in `home-widgets-section.tsx` (line 12). Both need updating. `CARD_DEFAULT_COLORS` lives in `constants.ts` (imported by session-select-content) and also inline in `home-widgets-section.tsx` — both need updating.

- [ ] **Step 1: Update constants.ts**

Replace the entire `CARD_DEFAULT_COLORS` object in `app/session-select/constants.ts`:

```typescript
export const CARD_DEFAULT_COLORS: Record<string, string> = {
  // existing
  weightSparkline:  "#00d4ff",
  nutritionDonut:   "#bf5fff",
  sleepWidget:      "#8b5cf6",
  stepsWidget:      "#2dd4bf",
  moodWidget:       "#fbbf24",
  // home section accents (unchanged)
  streakLeft:       "#f97316",
  streakRight:      "#22c55e",
  recommendedToday: "#06b6d4",
  // new — body
  weightTrendWidget:    "#3b82f6",
  bodyFatWidget:        "#f43f5e",
  leanMassWidget:       "#22c55e",
  bmiWidget:            "#a78bfa",
  // new — daily
  distanceWidget:       "#2dd4bf",
  waterWidget:          "#38bdf8",
  caloriesBurnedWidget: "#f97316",
  energyBalanceWidget:  "#00d4ff",
  // new — recovery
  rhrWidget:            "#ef4444",
  hrvWidget:            "#f97316",
  spo2Widget:           "#06b6d4",
  ouraIndicatorsWidget: "#8b5cf6",
  ouraSectionWidget:    "#6366f1",
  // new — performance
  trainingLoadWidget:   "#f59e0b",
  sleepPerfWidget:      "#8b5cf6",
  injuryWidget:         "#ef4444",
};
```

- [ ] **Step 2: Expand CardWidgetKey in session-select-content.tsx**

Find line 43 in `app/session-select/session-select-content.tsx`:

```typescript
type CardWidgetKey = "weightSparkline" | "nutritionDonut" | "sleepWidget" | "stepsWidget" | "moodWidget";
```

Replace with:

```typescript
type CardWidgetKey =
  // existing
  | "weightSparkline" | "nutritionDonut" | "sleepWidget" | "stepsWidget" | "moodWidget"
  // body
  | "weightTrendWidget" | "bodyFatWidget" | "leanMassWidget" | "bmiWidget"
  // daily
  | "distanceWidget" | "waterWidget" | "caloriesBurnedWidget" | "energyBalanceWidget"
  // recovery
  | "rhrWidget" | "hrvWidget" | "spo2Widget" | "ouraIndicatorsWidget" | "ouraSectionWidget"
  // performance
  | "trainingLoadWidget" | "sleepPerfWidget" | "injuryWidget";
```

- [ ] **Step 3: Add section order keys for new widgets**

In `session-select-content.tsx`, find the `SectionKey` type (~line 209). The type includes `CardSectionKey = \`card_${CardWidgetKey}\``. Expanding `CardWidgetKey` automatically expands `CardSectionKey` and `SectionKey` — no change needed there. But verify the `useEffect` that syncs section order (lines 795–809) still handles the new keys correctly. It filters on `.startsWith("card_")` which is key-agnostic — no change needed.

- [ ] **Step 4: Run TypeScript check**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

At this point there will be no errors if the `loadCardWidgets` function returns `CardWidgetKey[]` from localStorage — since it JSON.parses a string[], TypeScript is satisfied.

- [ ] **Step 5: Commit**

```bash
git add app/session-select/constants.ts app/session-select/session-select-content.tsx
git commit -m "feat: extend CardWidgetKey with 16 new health card widget types"
```

---

## Task 6: Home Widgets Settings — grouped Card Widgets layout

**Files:**
- Modify: `components/more/home-widgets-section.tsx`

Replace the current flat `Card Widgets` section with five grouped sections. Also expand the inline `CardWidgetKey` type and `CARD_DEFAULT_COLORS` to match the new constants.

- [ ] **Step 1: Expand CardWidgetKey and CARD_DEFAULT_COLORS in home-widgets-section.tsx**

Replace the `CardWidgetKey` type (line 12) with the same expanded union from Task 5.

Replace the inline `CARD_DEFAULT_COLORS` constant (lines 24–30) with:

```typescript
const CARD_DEFAULT_COLORS: Record<string, string> = {
  weightSparkline:      "#00d4ff",
  nutritionDonut:       "#bf5fff",
  sleepWidget:          "#8b5cf6",
  stepsWidget:          "#2dd4bf",
  moodWidget:           "#fbbf24",
  weightTrendWidget:    "#3b82f6",
  bodyFatWidget:        "#f43f5e",
  leanMassWidget:       "#22c55e",
  bmiWidget:            "#a78bfa",
  distanceWidget:       "#2dd4bf",
  waterWidget:          "#38bdf8",
  caloriesBurnedWidget: "#f97316",
  energyBalanceWidget:  "#00d4ff",
  rhrWidget:            "#ef4444",
  hrvWidget:            "#f97316",
  spo2Widget:           "#06b6d4",
  ouraIndicatorsWidget: "#8b5cf6",
  ouraSectionWidget:    "#6366f1",
  trainingLoadWidget:   "#f59e0b",
  sleepPerfWidget:      "#8b5cf6",
  injuryWidget:         "#ef4444",
};
```

- [ ] **Step 2: Replace CARD_WIDGET_DEFS with grouped defs**

Remove `CARD_WIDGET_DEFS` (lines 50–56) and add:

```typescript
type CardGroup = {
  label: string;
  cards: { key: CardWidgetKey; label: string; icon: LucideIcon }[];
};

const CARD_WIDGET_GROUPS: CardGroup[] = [
  {
    label: "Home Only",
    cards: [
      { key: "nutritionDonut",       label: "Nutrition",           icon: Apple         },
      { key: "moodWidget",           label: "Mood",                icon: MessageCircle },
    ],
  },
  {
    label: "Body",
    cards: [
      { key: "weightSparkline",      label: "Weight",              icon: Scale         },
      { key: "weightTrendWidget",    label: "Weight Trend",        icon: TrendingUp    },
      { key: "bodyFatWidget",        label: "Body Fat",            icon: Activity      },
      { key: "leanMassWidget",       label: "Lean Mass",           icon: Activity      },
      { key: "bmiWidget",            label: "BMI",                 icon: Activity      },
    ],
  },
  {
    label: "Daily",
    cards: [
      { key: "stepsWidget",          label: "Steps",               icon: Footprints    },
      { key: "distanceWidget",       label: "Distance",            icon: Route         },
      { key: "waterWidget",          label: "Water",               icon: Droplets      },
      { key: "caloriesBurnedWidget", label: "Calories Burned",     icon: Flame         },
      { key: "energyBalanceWidget",  label: "Energy Balance",      icon: BarChart2     },
    ],
  },
  {
    label: "Recovery",
    cards: [
      { key: "sleepWidget",          label: "Sleep",               icon: Moon          },
      { key: "rhrWidget",            label: "Resting HR",          icon: Activity      },
      { key: "hrvWidget",            label: "HRV",                 icon: Activity      },
      { key: "spo2Widget",           label: "SpO₂",                icon: Activity      },
      { key: "ouraIndicatorsWidget", label: "Oura Indicators",     icon: Activity      },
      { key: "ouraSectionWidget",    label: "Oura Section",        icon: Activity      },
    ],
  },
  {
    label: "Performance",
    cards: [
      { key: "trainingLoadWidget",   label: "Training Load",       icon: BarChart2     },
      { key: "sleepPerfWidget",      label: "Sleep vs Performance",icon: Moon          },
      { key: "injuryWidget",         label: "Injury",              icon: Activity      },
    ],
  },
];
```

Add `Activity` to the import list from `lucide-react` if not already present.

- [ ] **Step 3: Replace the flat card widgets section JSX**

Find the existing `Card Widgets` section in the JSX (lines ~176–222):

```tsx
<div className="px-4 py-3">
  <p className="text-xs text-muted-foreground mb-2">Card Widgets</p>
  <div className="flex gap-2 flex-wrap">
    {CARD_WIDGET_DEFS.map(def => { ... })}
  </div>
</div>
```

Replace it with:

```tsx
<div className="px-4 py-3">
  <p className="text-xs text-muted-foreground mb-2">Card Widgets</p>
  <div className="space-y-4">
    {CARD_WIDGET_GROUPS.map(group => (
      <div key={group.label}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          {group.label}
        </p>
        <div className="flex gap-2 flex-wrap">
          {group.cards.map(def => {
            const currentColor = cardColors[def.key] ?? CARD_DEFAULT_COLORS[def.key];
            return (
              <div key={def.key} className="flex items-center gap-1">
                <ColorSwatchPicker
                  value={currentColor}
                  label={def.label}
                  className="w-6 h-6 shadow-sm"
                  onChange={hex => {
                    const next = { ...cardColors, [def.key]: hex };
                    setCardColors(next);
                    localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next));
                  }}
                />
                <button
                  type="button"
                  onClick={() => toggleHomeCardWidget(def.key)}
                  className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium border transition ${
                    homeCardWidgets.includes(def.key)
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                >
                  <def.icon className="h-4 w-4" />
                  <span>{def.label}</span>
                </button>
                {cardColors[def.key] && (
                  <button
                    className="text-[10px] text-muted-foreground underline flex-none"
                    onClick={() => {
                      const next = { ...cardColors };
                      delete next[def.key];
                      setCardColors(next);
                      localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next));
                    }}
                  >
                    reset
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
</div>
```

Also add a global "reset all card widgets" link below the groups (replaces individual reset buttons which are kept per-card for color only). Add a reset-all button below the group list:

```tsx
<div className="flex justify-end mt-2">
  <button
    type="button"
    className="text-[10px] text-muted-foreground underline"
    onClick={() => {
      setHomeCardWidgets([]);
      localStorage.setItem(CARD_WIDGETS_KEY, JSON.stringify([]));
    }}
  >
    reset all card widgets
  </button>
</div>
```

- [ ] **Step 4: Verify in dev server**

Navigate to Settings → Home Widgets → expand → confirm Card Widgets now shows 5 grouped sections. Toggle new widget on — confirm it appears on the home screen (as a placeholder/empty state since data isn't fetched yet — that's Task 7).

- [ ] **Step 5: Commit**

```bash
git add components/more/home-widgets-section.tsx
git commit -m "feat: group home card widgets by category in Settings"
```

---

## Task 7: New home card widget cases — Body + Daily groups

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

Add `case` blocks for 8 new widgets (Body + Daily groups). These all draw from `metaToday` (body metadata) already fetched by the existing `cachedFetch` call for `body-metadata`. No new API calls needed for this task.

For context, the existing `metaToday` is of type `BodyMetaRow`. Check `app/api/body-metadata/route.ts` at the start of this task to confirm which fields are available (`bodyFatPct`, `leanMassKg`, `bmiValue`, `weightTrend`, `distanceKm`, `waterIntakeMl`, `activeCalories`, `caloriesBurnedTotal`, `energyBalance`). If any are missing, they will need to be added to that route — note that in that case.

All new cases follow the exact same 3-part pattern as existing cards:
1. Guard: `if (!activeCardWidgets.includes("key")) return null;`
2. Color: `const _color = cardColors['key'] ?? CARD_DEFAULT_COLORS.key;`
3. Return JSX with `accentCardStyle(_color)`, `ColorSwatchPicker` in edit mode, `role="button"` navigating to `/health?tab=body`

The switch statement in `session-select-content.tsx` is inside `sectionOrder.map(...)` (around line 1270+). Add the new cases after the existing `case "card_moodWidget":` block.

- [ ] **Step 1: Add section-order keys for new widgets**

No code change needed — the existing `useEffect` that syncs section order already handles any `CardWidgetKey` added to `activeCardWidgets`.

- [ ] **Step 2: Add Body group cases**

After the existing `case "card_moodWidget":` block, add:

```typescript
case "card_weightTrendWidget": {
  if (!activeCardWidgets.includes("weightTrendWidget")) return null;
  const _color = cardColors['weightTrendWidget'] ?? CARD_DEFAULT_COLORS.weightTrendWidget;
  const trend = metaToday?.weightTrend ?? null; // kg/week linear regression
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Weight Trend card" onChange={hex => { const next = { ...cardColors, weightTrendWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Weight Trend</p>
        <p className="text-2xl font-bold tabular-nums">
          {trend != null ? `${trend > 0 ? "+" : ""}${trend.toFixed(2)} kg/wk` : "—"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Linear regression</p>
      </div>
    </div>
  );
}

case "card_bodyFatWidget": {
  if (!activeCardWidgets.includes("bodyFatWidget")) return null;
  const _color = cardColors['bodyFatWidget'] ?? CARD_DEFAULT_COLORS.bodyFatWidget;
  const bf = metaToday?.bodyFatPct ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Body Fat card" onChange={hex => { const next = { ...cardColors, bodyFatWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Body Fat</p>
        <p className="text-2xl font-bold tabular-nums">{bf != null ? `${bf.toFixed(1)}%` : "—"}</p>
      </div>
    </div>
  );
}

case "card_leanMassWidget": {
  if (!activeCardWidgets.includes("leanMassWidget")) return null;
  const _color = cardColors['leanMassWidget'] ?? CARD_DEFAULT_COLORS.leanMassWidget;
  const lm = metaToday?.leanMassKg ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Lean Mass card" onChange={hex => { const next = { ...cardColors, leanMassWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Lean Mass</p>
        <p className="text-2xl font-bold tabular-nums">{lm != null ? `${lm.toFixed(1)} kg` : "—"}</p>
      </div>
    </div>
  );
}

case "card_bmiWidget": {
  if (!activeCardWidgets.includes("bmiWidget")) return null;
  const _color = cardColors['bmiWidget'] ?? CARD_DEFAULT_COLORS.bmiWidget;
  const bmi = metaToday?.bmiValue ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="BMI card" onChange={hex => { const next = { ...cardColors, bmiWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">BMI</p>
        <p className="text-2xl font-bold tabular-nums">{bmi != null ? bmi.toFixed(1) : "—"}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Daily group cases**

```typescript
case "card_distanceWidget": {
  if (!activeCardWidgets.includes("distanceWidget")) return null;
  const _color = cardColors['distanceWidget'] ?? CARD_DEFAULT_COLORS.distanceWidget;
  const dist = metaToday?.distanceKm ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Distance card" onChange={hex => { const next = { ...cardColors, distanceWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Distance</p>
        <p className="text-2xl font-bold tabular-nums">{dist != null ? `${dist.toFixed(2)} km` : "—"}</p>
      </div>
    </div>
  );
}

case "card_waterWidget": {
  if (!activeCardWidgets.includes("waterWidget")) return null;
  const _color = cardColors['waterWidget'] ?? CARD_DEFAULT_COLORS.waterWidget;
  const water = metaToday?.waterIntakeMl ?? null;
  const goalMl = waterGoal ?? 2000;
  const pct = water != null ? Math.min((water / goalMl) * 100, 100) : null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Water card" onChange={hex => { const next = { ...cardColors, waterWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Water Intake</p>
        <p className="text-2xl font-bold tabular-nums">{water != null ? `${water} ml` : "—"}</p>
        {pct !== null && (
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: _color }} />
          </div>
        )}
      </div>
    </div>
  );
}

case "card_caloriesBurnedWidget": {
  if (!activeCardWidgets.includes("caloriesBurnedWidget")) return null;
  const _color = cardColors['caloriesBurnedWidget'] ?? CARD_DEFAULT_COLORS.caloriesBurnedWidget;
  const cals = calsBurnedToday ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Calories Burned card" onChange={hex => { const next = { ...cardColors, caloriesBurnedWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Calories Burned</p>
        <p className="text-2xl font-bold tabular-nums">{cals != null ? `${Math.round(cals)} kcal` : "—"}</p>
      </div>
    </div>
  );
}

case "card_energyBalanceWidget": {
  if (!activeCardWidgets.includes("energyBalanceWidget")) return null;
  const _color = cardColors['energyBalanceWidget'] ?? CARD_DEFAULT_COLORS.energyBalanceWidget;
  const consumed = nutrCalories ?? null;
  const burned = calsBurnedToday ?? null;
  const balance = consumed != null && burned != null ? consumed - Math.round(burned) : null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Energy Balance card" onChange={hex => { const next = { ...cardColors, energyBalanceWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Energy Balance</p>
        <p className="text-2xl font-bold tabular-nums">
          {balance != null ? `${balance > 0 ? "+" : ""}${balance} kcal` : "—"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-0.5">In − Out</p>
      </div>
    </div>
  );
}
```

Note: `waterGoal`, `calsBurnedToday`, and `nutrCalories` must be in scope. Check that they are in the component's state at the top of `session-select-content.tsx` before adding these cases.

- [ ] **Step 4: TypeScript check + dev server test**

```bash
pnpm tsc --noEmit 2>&1 | head -30
```

Enable each new widget in Settings, confirm it renders on the home screen with correct data or "—" if no data.

- [ ] **Step 5: Commit**

```bash
git add app/session-select/session-select-content.tsx app/session-select/constants.ts
git commit -m "feat: add body and daily group home card widgets (8 new types)"
```

---

## Task 8: New home card widget cases — Recovery + Performance groups

**Files:**
- Modify: `app/session-select/session-select-content.tsx`

This task adds the remaining 8 widgets. Three of them require new data fetches:
- `ouraIndicatorsWidget` + `ouraSectionWidget` → `GET /api/oura/stats` (new, fire only when either widget is active)
- `sleepPerfWidget` → `GET /api/health/sleep-vs-performance` (new, may be slow)
- `injuryWidget` → `GET /api/injuries` (new)

Recovery metrics (rhr, hrv, spo2) are already in `metaToday` (the existing `body-metadata` fetch includes them as `restingHeartRate`, `hrvMs`, `spo2Pct`).

- [ ] **Step 1: Add state for new data**

Near the existing state declarations in `session-select-content.tsx`, add:

```typescript
const [ouraStats, setOuraStats]         = useState<{ readiness?: number; sleep?: number; activity?: number; tempDeviation?: number } | null>(null);
const [sleepVsPerf, setSleepVsPerf]     = useState<{ sleepScore: number | null; perfScore: number | null } | null>(null);
const [injuryData, setInjuryData]       = useState<{ active: number } | null>(null);
```

- [ ] **Step 2: Add conditional data-fetch useEffects**

Add these three `useEffect`s alongside the existing fetch effects. Each fires only when the relevant widget is active, avoiding unnecessary API calls.

```typescript
useEffect(() => {
  if (!activeCardWidgets.includes("ouraIndicatorsWidget") &&
      !activeCardWidgets.includes("ouraSectionWidget")) return;
  cachedFetch<{ readiness?: number; sleep?: number; activity?: number; tempDeviation?: number }>(
    'oura-stats', '/api/oura/stats', TTL_SHORT,
    (d) => setOuraStats(d),
  ).catch(() => {});
}, [activeCardWidgets]);

useEffect(() => {
  if (!activeCardWidgets.includes("sleepPerfWidget")) return;
  cachedFetch<{ sleepScore: number | null; perfScore: number | null }>(
    'sleep-vs-performance', '/api/health/sleep-vs-performance', TTL_SHORT,
    (d) => setSleepVsPerf(d),
  ).catch(() => {});
}, [activeCardWidgets]);

useEffect(() => {
  if (!activeCardWidgets.includes("injuryWidget")) return;
  cachedFetch<{ injuries: { status: string }[] }>(
    'injuries', '/api/injuries', TTL_MEDIUM,
    (d) => setInjuryData({ active: d.injuries?.filter(i => i.status === "active").length ?? 0 }),
  ).catch(() => {});
}, [activeCardWidgets]);
```

`TTL_SHORT` is imported from `@/components/sync-provider`. If only `TTL_MEDIUM` is currently imported, add `TTL_SHORT` to that import.

- [ ] **Step 3: Add Recovery group cases**

```typescript
case "card_rhrWidget": {
  if (!activeCardWidgets.includes("rhrWidget")) return null;
  const _color = cardColors['rhrWidget'] ?? CARD_DEFAULT_COLORS.rhrWidget;
  const rhr = metaToday?.restingHeartRate ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Resting HR card" onChange={hex => { const next = { ...cardColors, rhrWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Resting HR</p>
        <p className="text-2xl font-bold tabular-nums">{rhr != null ? `${rhr} bpm` : "—"}</p>
      </div>
    </div>
  );
}

case "card_hrvWidget": {
  if (!activeCardWidgets.includes("hrvWidget")) return null;
  const _color = cardColors['hrvWidget'] ?? CARD_DEFAULT_COLORS.hrvWidget;
  const hrv = metaToday?.hrvMs ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="HRV card" onChange={hex => { const next = { ...cardColors, hrvWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">HRV</p>
        <p className="text-2xl font-bold tabular-nums">{hrv != null ? `${Math.round(hrv)} ms` : "—"}</p>
      </div>
    </div>
  );
}

case "card_spo2Widget": {
  if (!activeCardWidgets.includes("spo2Widget")) return null;
  const _color = cardColors['spo2Widget'] ?? CARD_DEFAULT_COLORS.spo2Widget;
  const spo2 = metaToday?.spo2Pct ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="SpO₂ card" onChange={hex => { const next = { ...cardColors, spo2Widget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">SpO₂</p>
        <p className="text-2xl font-bold tabular-nums">{spo2 != null ? `${spo2.toFixed(1)}%` : "—"}</p>
      </div>
    </div>
  );
}

case "card_ouraIndicatorsWidget": {
  if (!activeCardWidgets.includes("ouraIndicatorsWidget")) return null;
  const _color = cardColors['ouraIndicatorsWidget'] ?? CARD_DEFAULT_COLORS.ouraIndicatorsWidget;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Oura Indicators card" onChange={hex => { const next = { ...cardColors, ouraIndicatorsWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Oura Indicators</p>
        {ouraStats ? (
          <div className="flex gap-3 flex-wrap">
            {[
              { label: "Readiness", value: ouraStats.readiness },
              { label: "Sleep",     value: ouraStats.sleep     },
              { label: "Activity",  value: ouraStats.activity  },
            ].map(m => (
              <div key={m.label}>
                <p className="text-[10px] text-muted-foreground">{m.label}</p>
                <p className="text-lg font-bold">{m.value ?? "—"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Oura data</p>
        )}
      </div>
    </div>
  );
}

case "card_ouraSectionWidget": {
  if (!activeCardWidgets.includes("ouraSectionWidget")) return null;
  const _color = cardColors['ouraSectionWidget'] ?? CARD_DEFAULT_COLORS.ouraSectionWidget;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Oura Section card" onChange={hex => { const next = { ...cardColors, ouraSectionWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Oura Scores</p>
        {ouraStats ? (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Readiness", value: ouraStats.readiness },
              { label: "Sleep",     value: ouraStats.sleep     },
              { label: "Activity",  value: ouraStats.activity  },
            ].map(m => (
              <div key={m.label} className="text-center">
                <p className="text-xl font-bold">{m.value ?? "—"}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-widest">{m.label}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sync Oura to see scores</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add Performance group cases**

```typescript
case "card_trainingLoadWidget": {
  if (!activeCardWidgets.includes("trainingLoadWidget")) return null;
  const _color = cardColors['trainingLoadWidget'] ?? CARD_DEFAULT_COLORS.trainingLoadWidget;
  // readinessScore is already fetched; it contains ACWR / training load
  const acwr = readinessScore?.acwr ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Training Load card" onChange={hex => { const next = { ...cardColors, trainingLoadWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Training Load (ACWR)</p>
        <p className="text-2xl font-bold tabular-nums">{acwr != null ? acwr.toFixed(2) : "—"}</p>
      </div>
    </div>
  );
}

case "card_sleepPerfWidget": {
  if (!activeCardWidgets.includes("sleepPerfWidget")) return null;
  const _color = cardColors['sleepPerfWidget'] ?? CARD_DEFAULT_COLORS.sleepPerfWidget;
  const sleeping = sleepVsPerf === null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Sleep vs Performance card" onChange={hex => { const next = { ...cardColors, sleepPerfWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Sleep vs Performance</p>
        {sleeping ? (
          <div className="h-6 w-24 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="flex gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground">Sleep</p>
              <p className="text-lg font-bold">{sleepVsPerf?.sleepScore ?? "—"}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Perf</p>
              <p className="text-lg font-bold">{sleepVsPerf?.perfScore ?? "—"}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

case "card_injuryWidget": {
  if (!activeCardWidgets.includes("injuryWidget")) return null;
  const _color = cardColors['injuryWidget'] ?? CARD_DEFAULT_COLORS.injuryWidget;
  const active = injuryData?.active ?? null;
  return (
    <div className="px-4 pb-3 relative">
      {sectionEditMode && (
        <div className="absolute top-4 right-12 z-20" onClick={e => e.stopPropagation()}>
          <ColorSwatchPicker value={_color} label="Injury card" onChange={hex => { const next = { ...cardColors, injuryWidget: hex }; setCardColors(next); localStorage.setItem(CARD_COLORS_KEY, JSON.stringify(next)); }} />
        </div>
      )}
      <div role="button" tabIndex={0} onClick={() => { if (!sectionEditMode) router.push("/health?tab=body"); }} className={cn("w-full rounded-2xl p-4 text-left active:scale-95 transition cursor-pointer", sectionEditMode && "pointer-events-none")} style={accentCardStyle(_color)}>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Active Injuries</p>
        <p className="text-2xl font-bold tabular-nums">{active != null ? active : "—"}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{active === 0 ? "All clear" : `${active} active`}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Check variable names against the actual state**

Before committing, verify these variable names are actually in scope in `session-select-content.tsx`:
- `metaToday?.restingHeartRate` — check the `BodyMetaRow` type in `app/api/body-metadata/route.ts`
- `metaToday?.hrvMs` — same
- `metaToday?.spo2Pct` — same
- `readinessScore` — check what the readiness score state variable is named
- `nutrCalories`, `calsBurnedToday`, `waterGoal` — check existing state

If any field name differs, use the correct name from the actual type.

- [ ] **Step 6: TypeScript check + dev server test**

```bash
pnpm tsc --noEmit 2>&1 | head -40
```

Enable each new widget in Settings, confirm it renders. For oura/sleep-vs-perf/injury: shows "—" or loading state gracefully if data isn't available in local dev DB.

- [ ] **Step 7: Commit**

```bash
git add app/session-select/session-select-content.tsx
git commit -m "feat: add recovery and performance home card widgets with conditional data fetching"
```

---

## Self-Review

### Spec coverage check

| Spec section | Plan coverage |
|---|---|
| §1 Health screen edit mode (long-press, 300ms dnd, drag handle, colour overlay) | Task 3 — long-press at 500ms, DnD at 300ms, `SortableHealthCard` adds grip + edit ring |
| §1 Persistence: `ta_health_body/training/progress_order` | Task 1 (helpers) + Task 3 (drag-end handlers) |
| §1 Hidden cards preserved in order array | Task 1 `getHealthCardOrder` merges stored + default; Task 3 filters visible for drag but saves full order |
| §2 Extend `CardWidgetKey` with 16 new types | Task 5 |
| §2 Home screen switch cases for new widgets | Tasks 7–8 |
| §2 Colour picker in edit mode per card | All cases in Tasks 7–8 include `ColorSwatchPicker` block |
| §2 Tap navigates to health screen | All cases include `router.push("/health?tab=body")` |
| §3 Settings: Card Widgets grouped layout | Task 6 |
| §3 `reset` link for all card widgets | Task 6 (reset-all button added below groups) |
| §4 Settings: Health Screen expandable row | Task 4 |
| §4 `ta_health_hidden` persistence | Task 1 + Task 4 |
| §5 All 19 body tab card keys referenced | Task 3 (14 sections × their card keys), Task 4 (groups cover all 19) |
| §6 Data dependencies: body-metadata reuse | Tasks 7–8 — reuse `metaToday` |
| §6 New fetches: oura/stats, sleep-vs-perf, injuries | Task 8, conditional on active widgets |
| §6 Skeleton for slow sleep-vs-perf fetch | Task 8 `sleepPerfWidget` shows animate-pulse while `sleepVsPerf === null` |
| §7 Out of scope: no animated transition | Not implemented — plain ring overlay only |
| §7 Out of scope: no colour picker on health screen | Health screen section (Task 4) has no colour picker |

### Placeholder scan

No TBD or "implement later" language. All code blocks are complete and ready to copy in.

### Type consistency

- `HealthTab` defined in `lib/health-card-order.ts`, imported in `health-content.tsx`
- `CardWidgetKey` expanded identically in `session-select-content.tsx` (Task 5) and `home-widgets-section.tsx` (Task 6)
- `BODY_SECTIONS` / `BODY_DEFAULT_ORDER` / etc. defined as module-level constants in `health-content.tsx` before the component
- All handler names consistent across state declarations, `useCallback`s, and JSX props

### One gap identified and addressed

The spec lists `weightTrendWidget` in the `CardWidgetKey` additions (§2) but omits it from the `CARD_DEFAULT_COLORS` table (§2, table). A color (`#3b82f6`) was assigned in Task 5.

The field names `restingHeartRate`, `hrvMs`, `spo2Pct`, `waterIntakeMl`, `distanceKm`, `bmiValue`, `leanMassKg`, `weightTrend` on `BodyMetaRow` are assumed from health screen usage — Task 8 Step 5 explicitly asks the implementer to verify these against the actual type before committing.
