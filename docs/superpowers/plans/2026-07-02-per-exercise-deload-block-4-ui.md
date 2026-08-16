# Per-Exercise Deload — Block 4: UI Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-exercise deloads on the pre-workout screen (amber chip + info sheet with "Use full weights" revert), send `exerciseDeloaded` in the log payload, and badge deloaded exercises on the AI prescription card.

**Architecture:** `workout-data` passes the prescription's deload fields through onto `WorkoutExercise` (including a server-computed `preDeloadStyle` so the client never rebuilds prescription math). Reverts live in the persisted Zustand workout store keyed by session id with date-rollover reset — applied as a pure derived transform (`applyDeloadReverts`) over the fetched exercises, so the 6-hour `workout-data` cache never fights the toggle. The log payload and the optimistic local PR check read the post-transform `deloaded` flag.

**Tech Stack:** React 19, Zustand persist, shadcn Sheet, Lucide `BatteryLowIcon`, vitest.

**Depends on:** Blocks 1–3 (prescription carries `deloaded`/`deloadNote`/`preDeload`; server honours `exerciseDeloaded`).

---

### Task 1: `workout-data` passthrough

**Files:**
- Modify: `app/api/workout-data/route.ts` (`WorkoutExercise` interface lines 32–55; AI override block lines 293–303; return object lines 329–350)

- [ ] **Step 1: Extend `WorkoutExercise`**

```ts
  lastSetMode?: 'amrap' | 'plus1';
  // Per-exercise deload (soreness): chip + revert sheet on the pre-workout screen.
  // preDeloadStyle/preDeloadSets are the model's original prescription, expanded
  // server-side, so "Use full weights" is a pure client-side swap.
  deloaded?: boolean;
  deloadNote?: string;
  preDeloadStyle?: StyleSet[];
  preDeloadSets?: number;
  // Client-only: set by applyDeloadReverts when the user opted back to full weights.
  deloadReverted?: boolean;
```

- [ ] **Step 2: Capture the deload fields in the AI override block**

Above the `exercises` map (next to `lastSetMode`'s `let`), the block at lines 293–303 becomes:

```ts
      let lastSetMode: 'amrap' | 'plus1' | undefined
      let deloaded: boolean | undefined
      let deloadNote: string | undefined
      let preDeloadStyle: StyleSet[] | null = null
      let preDeloadSets: number | undefined
      if (aiDrivesLoad) {
        const p = aiPrescription!.exercises.find(e => e.sessionExerciseId === ex.id)
        if (p) {
          progressionStyle = prescriptionStyleForExercise(p)
          defaultSets = p.sets
          styleName = `AI · ${aiPhaseLabel}`
          if (p.deloaded) {
            deloaded = true
            deloadNote = p.deloadNote
            if (p.preDeload) {
              preDeloadStyle = prescriptionStyleForExercise({ ...p, ...p.preDeload })
              preDeloadSets = p.preDeload.sets
            }
          }
        }
      }
```

- [ ] **Step 3: Add to the return object**

After `lastSetMode,` (line 349):

```ts
        lastSetMode,
        deloaded,
        deloadNote,
        preDeloadStyle: preDeloadStyle ?? undefined,
        preDeloadSets,
```

- [ ] **Step 4: Typecheck and commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add app/api/workout-data/route.ts
git commit -m "Pass per-exercise deload fields through workout-data"
```

---

### Task 2: Revert state + pure transform

**Files:**
- Modify: `lib/stores/workout-store.ts` (state interface ~line 42, actions interface ~line 76, `INITIAL_STATE` ~line 114, actions ~line 207, `onRehydrateStorage` ~line 219)
- Modify: `components/workout/utils.ts`
- Test: `lib/__tests__/deload-reverts.test.ts` (create)

- [ ] **Step 1: Write the failing test for the transform**

```ts
import { describe, it, expect } from 'vitest'
import { applyDeloadReverts } from '@/components/workout/utils'
import type { WorkoutExercise } from '@/app/api/workout-data/route'

const style = (pct: number) => [{ pct, reps: 8, restSec: 120, useFor1rm: true }] as WorkoutExercise['progressionStyle']

const deloadedEx = {
  name: 'Hip Thrust',
  defaultSets: 2,
  progressionStyle: style(52),
  deloaded: true,
  deloadNote: 'Deload — glutes still sore',
  preDeloadStyle: style(72),
  preDeloadSets: 3,
} as WorkoutExercise

const normalEx = { name: 'Squat', defaultSets: 3, progressionStyle: style(70) } as WorkoutExercise

describe('applyDeloadReverts', () => {
  it('returns the array untouched with no reverts', () => {
    const out = applyDeloadReverts([deloadedEx, normalEx], [])
    expect(out[0].deloaded).toBe(true)
    expect(out[0].progressionStyle).toBe(deloadedEx.progressionStyle)
  })

  it('swaps a reverted exercise back to its original prescription', () => {
    const out = applyDeloadReverts([deloadedEx, normalEx], ['Hip Thrust'])
    expect(out[0].deloaded).toBe(false)
    expect(out[0].deloadReverted).toBe(true)
    expect(out[0].progressionStyle).toBe(deloadedEx.preDeloadStyle)
    expect(out[0].defaultSets).toBe(3)
    expect(out[1]).toBe(normalEx)
  })

  it('ignores revert names that are not deloaded or lack preDeloadStyle', () => {
    const out = applyDeloadReverts([normalEx], ['Squat'])
    expect(out[0]).toBe(normalEx)
  })
})
```

Run: `pnpm exec vitest run lib/__tests__/deload-reverts.test.ts` — expected: FAIL (not exported).

- [ ] **Step 2: Implement the transform in `components/workout/utils.ts`**

```ts
import type { WorkoutExercise } from '@/app/api/workout-data/route'

// Reverts are a client-side overlay on the server prescription: the stored
// prescription stays deloaded, this swap only affects what the workout runs
// (and clears `deloaded` so the log payload and PR paths treat it as full).
export function applyDeloadReverts(
  exercises: WorkoutExercise[],
  revertedNames: string[],
): WorkoutExercise[] {
  if (revertedNames.length === 0) return exercises
  return exercises.map(ex =>
    ex.deloaded && ex.preDeloadStyle && revertedNames.includes(ex.name)
      ? {
          ...ex,
          deloaded: false,
          deloadReverted: true,
          progressionStyle: ex.preDeloadStyle,
          defaultSets: ex.preDeloadSets ?? ex.defaultSets,
        }
      : ex,
  )
}
```

- [ ] **Step 3: Add store state (persisted, date-keyed reset)**

In `lib/stores/workout-store.ts`:

State interface (after `storedDate`):
```ts
  revertedDeloads: Record<string, string[]>  // exercise names the user opted back to full weights, keyed like todayLogged
```

Actions interface:
```ts
  toggleDeloadRevert: (sessionKey: string, name: string) => void
```

`INITIAL_STATE`:
```ts
  revertedDeloads: {},
```

Action implementation (next to `addTodayLogged`):
```ts
      toggleDeloadRevert: (sessionKey, name) => set((s) => {
        const cur = s.revertedDeloads[sessionKey] ?? []
        const next = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
        return { revertedDeloads: { ...s.revertedDeloads, [sessionKey]: next } }
      }),
```

`onRehydrateStorage` date-rollover block gains:
```ts
        if (state.storedDate !== today) {
          state.storedDate = today
          state.todayLogged = {}
          state.revertedDeloads = {}
        }
```

Also preserve it across `startWorkout`/`resetSession` the same way those already
preserve `todayLogged` (add `revertedDeloads: s.revertedDeloads` to both spreads).

- [ ] **Step 4: Run tests, typecheck, commit**

Run: `pnpm exec vitest run lib/__tests__/deload-reverts.test.ts && pnpm exec tsc --noEmit && pnpm test`
Expected: PASS.

```bash
git add components/workout/utils.ts lib/stores/workout-store.ts lib/__tests__/deload-reverts.test.ts
git commit -m "Add deload revert state and pure exercise transform

Reverts overlay the cached workout-data client-side so the 6h cache and
the stored prescription never fight the user's choice; state resets on
date rollover like todayLogged."
```

---

### Task 3: Orchestrator wiring — derived exercises, payload flag, PR guard

**Files:**
- Modify: `components/workout-screen.tsx` (state ~line 132, log payload ~line 613, optimistic PR ~line 624)

- [ ] **Step 1: Derive effective exercises**

Add to the store selector pick (the `useWorkoutStore` shallow object): `revertedDeloads: s.revertedDeloads, toggleDeloadRevert: s.toggleDeloadRevert`.

Below the `exercises` state declarations:

```ts
  const sessionKey = programSessionId ?? sessionType.toLowerCase()
  const effectiveExercises = useMemo(
    () => applyDeloadReverts(exercises, store.revertedDeloads[sessionKey] ?? []),
    [exercises, store.revertedDeloads, sessionKey],
  )
```

Import `applyDeloadReverts` from `./workout/utils` (it already imports from there).

- [ ] **Step 2: Swap consumers to `effectiveExercises`**

Every read of `exercises` **except** the `setExercises` calls and the fetch logic
switches to `effectiveExercises` — this includes the `ex` used by the logging
handler, the props passed to `PreWorkoutScreen` / `ActiveWorkoutScreen` /
children, and any `exercises[currentIdx]`, `.length`, `.map` reads. Verify with:

Run: `grep -n '\bexercises\b' components/workout-screen.tsx`
and check each hit. The fetch/seed sites (lines ~172, ~191, ~210) and the state
declaration keep the raw name.

- [ ] **Step 3: Log payload + optimistic PR guard**

In the log payload (line ~613 area):

```ts
      ...(aiDeload ? { intensityMode: 'deload' as const } : {}),
      ...(ex.deloaded ? { exerciseDeloaded: true } : {}),
      ...(wasOverride ? { wasOverride: true } : {}),
```

Optimistic local PR check (line ~624):

```ts
      if (newEst1rm > 0 && !aiDeload && !ex.deloaded) {
```

(`ex` is post-transform: a reverted exercise has `deloaded: false`, so it counts again — matching the server gate from Block 3.)

- [ ] **Step 4: Typecheck, run dev server smoke check, commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

```bash
git add components/workout-screen.tsx
git commit -m "Run workouts against revert-adjusted exercises and flag deloaded logs"
```

---

### Task 4: Pre-workout chip + deload info sheet

**Files:**
- Create: `components/workout/deload-info-sheet.tsx`
- Modify: `components/workout/pre-workout-screen.tsx` (props ~line 21, exercise card ~line 196, sheets ~line 294)
- Modify: `components/workout-screen.tsx` (pass the two new props)

- [ ] **Step 1: Create the sheet component**

Follow `exercise-stats-sheet.tsx`'s Sheet usage (same primitive, same open/close shape):

```tsx
"use client";

import { BatteryLowIcon } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { WorkoutExercise } from "@/app/api/workout-data/route";
import { mround125 } from "./utils";

interface DeloadInfoSheetProps {
  exercise: WorkoutExercise | null;
  onClose: () => void;
  onToggleRevert: (name: string) => void;
}

function lineFor(sets: number | undefined, style: WorkoutExercise["progressionStyle"], oneRm: number | null) {
  const s = style?.[0];
  if (!s) return null;
  const kg = oneRm != null && oneRm > 0 ? ` (~${mround125(oneRm * s.pct / 100)}kg)` : "";
  return `${sets ?? style?.length ?? 0}×${s.reps} @ ${s.pct}%${kg}`;
}

export function DeloadInfoSheet({ exercise, onClose, onToggleRevert }: DeloadInfoSheetProps) {
  const reverted = exercise?.deloadReverted === true;
  // progressionStyle always holds what will actually run: the deload numbers
  // normally, or the original prescription after a revert (the transform swapped it).
  const runningLine = exercise
    ? lineFor(exercise.defaultSets, exercise.progressionStyle, exercise.estimated1rm)
    : null;
  const originalLine = exercise && !reverted
    ? lineFor(exercise.preDeloadSets, exercise.preDeloadStyle ?? null, exercise.estimated1rm)
    : null;

  return (
    <Sheet open={exercise != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="pb-safe">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BatteryLowIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            {exercise?.name}
          </SheetTitle>
        </SheetHeader>
        {exercise && (
          <div className="space-y-4 px-1 pb-2">
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {exercise.deloadNote ?? "Deload — sore muscle flagged in your check-in"}
            </p>
            <div className="space-y-1 text-sm tabular-nums">
              <p>
                <span className="text-muted-foreground">{reverted ? "Running (full): " : "Deloaded to: "}</span>
                {runningLine ?? "—"}
              </p>
              {originalLine && (
                <p>
                  <span className="text-muted-foreground">Original plan: </span>
                  {originalLine}
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Deloaded sets don&apos;t count toward personal records.
            </p>
            <Button
              className="w-full h-12"
              variant={reverted ? "outline" : "default"}
              onClick={() => { onToggleRevert(exercise.name); onClose(); }}
            >
              {reverted ? "Use deload weights" : "Use full weights"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Chip on the exercise card**

In `pre-workout-screen.tsx`, add props:

```ts
  onToggleDeloadRevert?: (name: string) => void;
```

Local state next to `statsExercise`:

```ts
  const [deloadExercise, setDeloadExercise] = useState<WorkoutExercise | null>(null);
```

Inside the card's main `<button>` content, directly under the muscle-chip block
(after line ~209): the card is already a `<button>`, so the chip must NOT be a
nested `<button>` (WebView strips it) — use the `role="button"` span pattern:

```tsx
                    {(ex.deloaded || ex.deloadReverted) && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); setDeloadExercise(ex); }}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDeloadExercise(ex); } }}
                        className={cn(
                          "mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          ex.deloaded
                            ? "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        <BatteryLowIcon className="h-3 w-3" />
                        {ex.deloaded ? (ex.deloadNote ?? "Deload") : "Deload off — full weights"}
                      </span>
                    )}
```

Add `BatteryLowIcon` to the lucide import. Amber classes match the existing
deload banner styling in this file (line ~132) — consistent with the session-level
deload convention.

At the bottom, alongside `ExerciseStatsSheet` (dynamic import, same pattern):

```tsx
const DeloadInfoSheet = dynamic(
  () => import("./deload-info-sheet").then((m) => ({ default: m.DeloadInfoSheet })),
  { ssr: false },
);
```

```tsx
      <DeloadInfoSheet
        exercise={deloadExercise}
        onClose={() => setDeloadExercise(null)}
        onToggleRevert={(name) => onToggleDeloadRevert?.(name)}
      />
```

- [ ] **Step 3: Wire from the orchestrator**

In `workout-screen.tsx`, pass to `<PreWorkoutScreen>`:

```tsx
  onToggleDeloadRevert={(name) => store.toggleDeloadRevert(sessionKey, name)}
```

- [ ] **Step 4: Typecheck + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean.

```bash
git add components/workout/deload-info-sheet.tsx components/workout/pre-workout-screen.tsx components/workout-screen.tsx
git commit -m "Surface per-exercise deloads with a revert sheet on the pre-workout screen"
```

---

### Task 5: Prescription card badge

**Files:**
- Modify: `components/workout/ai-prescription-card.tsx` (exercise rows ~line 145–160)

- [ ] **Step 1: Badge deloaded rows**

Inside the `prescription.exercises.map` row (after the sets/reps span's closing
`</div>` of the flex row, still inside the exercise's outer `div`):

```tsx
                  {ex.deloaded && (
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      <BatteryLowIcon className="h-3 w-3" />
                      {ex.deloadNote ?? "Deload"}
                    </p>
                  )}
```

Add `BatteryLowIcon` to the lucide import.

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

```bash
git add components/workout/ai-prescription-card.tsx
git commit -m "Badge per-exercise deloads on the AI prescription card"
```

---

### Task 6: Runtime verification + changelog

**Files:**
- Modify: `package.json` (version), `lib/changelog.ts`

- [ ] **Step 1: Full-flow runtime check on the local dev server**

1. `pnpm dev`, log in as `test@local.dev` / `testpass123`.
2. Mood check-in with sore glutes (minority of the Legs session).
3. Session-select → Legs: prescription card shows the amber deload badge on the
   glute exercises.
4. Pre-workout screen: amber chips on the same exercises; other exercises normal.
5. Tap a chip → sheet shows note, deload vs original numbers, PR caveat.
6. "Use full weights" → chip flips to the muted "Deload off" state; start the
   workout and confirm the loaded weights use the original (heavier) pct.
7. Refresh the page mid-flow → the revert survives (store persistence).
8. Log a still-deloaded exercise → network tab shows `exerciseDeloaded: true` in
   the `/api/log-exercise` payload and `isPR: false` in the response; log a
   reverted one → no `exerciseDeloaded` field.
9. Complete the check-in with majority-sore muscles → whole-session deload offer
   renders through the existing pending card (no chips).

**Not exercisable in the sandbox (state explicitly when presenting):** native
SQLite/outbox replay of an `exerciseDeloaded` payload, safe-area rendering of the
bottom sheet, Samsung WebView chip tap behaviour inside the card — all need the
S25 APK check after deploy.

- [ ] **Step 2: Version + changelog**

Bump `package.json` minor version. Add a `lib/changelog.ts` entry (match the
existing entry shape), e.g.:

> Per-exercise deload: when your check-in reports sore muscles that affect only
> part of a session, just those exercises drop to deload weights — tap the amber
> chip to see why or lift full weights anyway. Mostly-sore sessions now get a
> whole-session deload offer. Deloaded sets never count toward PRs.

- [ ] **Step 3: Commit**

```bash
git add package.json lib/changelog.ts
git commit -m "Bump version and changelog for per-exercise deload"
```

---

## Self-Review Notes

- **Spec coverage (Block 4 scope):** chip (amber, Lucide, distinct from session banner), tap sheet with note + side-by-side numbers + revert, revert persisted in the workout store keyed by session with date rollover, `exerciseDeloaded` in the log payload (and omitted after revert), optimistic local PR guard, prescription-card badge, changelog — all covered. The recommendation-card "reasoning line" from the spec is satisfied by the per-exercise badges on the prescription card (same surface, clearer attribution).
- **Type consistency:** `deloadReverted` is produced only by `applyDeloadReverts` (Task 2) and consumed by the chip + sheet (Task 4); `preDeloadStyle`/`preDeloadSets` come from Task 1's route change; `toggleDeloadRevert(sessionKey, name)` signature matches store → orchestrator → sheet chain.
- **Known judgement call:** revert is keyed by exercise *name* (matching `todayLogged`'s convention in this codebase) rather than session-exercise id. Acceptable here because names are unique within a session's exercise list.
