# Warm-Up Ramp-Up: Survive Backgrounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** User-confirmed via two sequential screenshots: on the exercise ready screen,
minimizing the app during the "Warm-up ramp-up" countdown and reopening it resets the
ramp-up progress back to ~0:00 while the overall session clock in the header keeps
counting correctly (17:06 → 17:12, +6s, matches real elapsed time). Root cause is
`components/workout/active-workout-screen.tsx:90–100`:

```ts
const readyStartElapsedRef = useRef<number | null>(null);
...
useEffect(() => {
  if (!timerStarted) {
    readyStartElapsedRef.current ??= sessionElapsedSecRef.current;
  } else {
    readyStartElapsedRef.current = null;
  }
}, [timerStarted]);
```

`readyStartElapsedRef` is a plain component-local `useRef`, not part of the Zustand
persisted workout store (`lib/stores/workout-store.ts`). When Android backgrounds the
app long enough to remount this component (or the WebView reloads), the ref
reinitializes to `null`; the effect then immediately re-captures it as "session-elapsed
right now" instead of "session-elapsed when I first landed on this ready screen" —
collapsing the derived `readyElapsedSec` back near zero. `sessionElapsedSec` itself is
unaffected because it's derived from `workoutStartMs`, which *is* persisted
(`useElapsedSec(workoutStartMs)` in `components/workout/session-clock.tsx`).

This is exactly the class of bug CLAUDE.md's "Zustand Persisted Store" rule exists to
prevent, just inverted: this is transient-*looking* ref state that actually needs to
survive backgrounding (it represents real wall-clock progress into the ready screen),
but nothing persists it today.

**Fix:** Move the captured baseline from a local `useRef` into the persisted workout
store, following the exact same pattern already used for `exerciseStartMs`/
`workoutStartMs`/`lastExerciseEndMs` (all `number | null` fields set via
`setTimestamps`). The triggering logic (capture-on-`!timerStarted`, clear-on-
`timerStarted`) stays byte-identical — only the storage location changes, from a ref
that dies on remount to a store field that's written to `localStorage` and survives
one.

> ⚠️ **Amended 2026-07-05 (backlog review):** the ref's death-on-unmount is today's
> *de facto* reset for navigation — `ActiveWorkoutScreen` only renders in `active`
> mode, so backing out to the workout hub kills the ref. A persisted field has no such
> reset: land on a ready screen, back out, browse for 4 minutes, launch any exercise →
> its ramp renders already complete. The same stale-carryover applies to Skip
> (`advance()` flips `timerStarted` false→false, so the effect never re-fires). Task 2
> must also clear the baseline where a ready screen is freshly initialized: call
> `onSetReadyElapsedBaselineSec(null)` (or the store setter directly) in
> `launchExercise` — next to the `exerciseStartMs: null` timestamp reset,
> `workout-screen.tsx:457` — and in `advance()`'s fresh-init branch. A
> backgrounding-triggered remount re-enters neither path (same `currentIdx`, no
> re-launch), so the fix this plan exists for is preserved. Also: use a neutral
> string, not `'Push'`, in the store test's `startWorkout` call (no-hardcoded-session-
> names rule).

**Tech Stack:** Next.js 15, React, Zustand (`persist` + `createJSONStorage`), TypeScript, vitest (jsdom environment override for this one test file — the store's `persist` middleware touches `localStorage` at creation time, which doesn't exist under vitest's default `node` environment).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/stores/workout-store.ts` | Modify | Add persisted `readyElapsedBaselineSec` field + setter |
| `lib/stores/__tests__/workout-store.test.ts` | Create | Unit tests for the new field/setter (first test file for this store) |
| `components/workout/active-workout-screen.tsx` | Modify | Replace the `useRef` with the store field via new props |
| `components/workout-screen.tsx` | Modify | Thread the store field + setter down to `ActiveWorkoutScreen` |

---

### Task 1: Persist the ready-screen baseline in the workout store

**Files:**
- Modify: `lib/stores/workout-store.ts`
- Create: `lib/stores/__tests__/workout-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/stores/__tests__/workout-store.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkoutStore } from '@/lib/stores/workout-store'

describe('readyElapsedBaselineSec', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkoutStore.setState({ readyElapsedBaselineSec: null })
  })

  it('defaults to null', () => {
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('setReadyElapsedBaselineSec sets and clears the value', () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(42)
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBe(42)
    useWorkoutStore.getState().setReadyElapsedBaselineSec(null)
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('startWorkout resets it to null', () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(99)
    useWorkoutStore.getState().startWorkout('Push')
    expect(useWorkoutStore.getState().readyElapsedBaselineSec).toBeNull()
  })

  it('survives being read from a fresh store instance (simulates remount) once persisted', async () => {
    useWorkoutStore.getState().setReadyElapsedBaselineSec(15)
    // Zustand's persist middleware writes asynchronously; give it a tick.
    await new Promise(r => setTimeout(r, 0))
    const raw = localStorage.getItem('ta_workout_state')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.state.readyElapsedBaselineSec).toBe(15)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/stores/__tests__/workout-store.test.ts`
Expected: FAIL — `readyElapsedBaselineSec`/`setReadyElapsedBaselineSec` don't exist

- [ ] **Step 3: Write the implementation**

In `lib/stores/workout-store.ts`:

1. Add to the `WorkoutState` interface, in the "Timestamps" block (after `lastExerciseEndMs`, line 62):
```ts
  // Session-elapsed-seconds value captured the moment the ready screen (pre-set,
  // warm-up ramp-up) was entered — NOT a timestamp, so it lives outside setTimestamps.
  // Persisted (not a useRef) so it survives an app-backgrounding remount; see
  // active-workout-screen.tsx's readyElapsedSec derivation.
  readyElapsedBaselineSec: number | null
```

2. Add to `WorkoutActions` (after `setTimestamps`, line 99):
```ts
  setReadyElapsedBaselineSec: (v: number | null) => void
```

3. Add to `INITIAL_STATE` (after `lastExerciseEndMs: null,`, line 149):
```ts
  readyElapsedBaselineSec: null,
```

4. Add to `startWorkout`'s returned object (after `lastExerciseEndMs: null,`, line 189) —
   a fresh workout should never inherit a stale baseline from a previous one:
```ts
        readyElapsedBaselineSec: null,
```

5. Add the setter implementation (next to `setTimestamps`, line 236):
```ts
      setReadyElapsedBaselineSec: (readyElapsedBaselineSec) => set({ readyElapsedBaselineSec }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/stores/__tests__/workout-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stores/workout-store.ts lib/stores/__tests__/workout-store.test.ts
git commit -m "feat: persist the ready-screen elapsed baseline instead of a component ref"
```

---

### Task 2: Wire the persisted field into the ready screen

**Files:**
- Modify: `components/workout/active-workout-screen.tsx`
- Modify: `components/workout-screen.tsx`

- [ ] **Step 1: Replace the ref in `active-workout-screen.tsx`**

1. Add two new props to `ActiveWorkoutScreenProps` (near `exerciseStartMs`, line 34):
```ts
  readyElapsedBaselineSec: number | null;
  onSetReadyElapsedBaselineSec: (v: number | null) => void;
```
Destructure both in the function signature alongside `exerciseStartMs`.

2. Delete the ref (lines 90, 94–100):
```ts
  const readyStartElapsedRef = useRef<number | null>(null);
  ...
  useEffect(() => {
    if (!timerStarted) {
      readyStartElapsedRef.current ??= sessionElapsedSecRef.current;
    } else {
      readyStartElapsedRef.current = null;
    }
  }, [timerStarted]);
```
Replace with:
```ts
  useEffect(() => {
    if (!timerStarted) {
      if (readyElapsedBaselineSec == null) onSetReadyElapsedBaselineSec(sessionElapsedSecRef.current);
    } else {
      if (readyElapsedBaselineSec != null) onSetReadyElapsedBaselineSec(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerStarted]);
```
(Keep `sessionElapsedSecRef` — it still exists to avoid re-running this effect on every
session-clock tick; only `timerStarted` should retrigger it, matching the original.)

3. Update the `readyElapsedSec` derivation (line 155–157) to read the prop instead of the ref:
```ts
  const readyElapsedSec = !timerStarted && readyElapsedBaselineSec != null
    ? Math.max(0, sessionElapsedSec - readyElapsedBaselineSec)
    : 0;
```

(If `2026-07-05-warmup-rampup-equipment-aware.md` has already landed on this branch's
base, `WARMUP_SECTION_SEC`/`warmupSectionCount` will already be reordered around this
line — leave that reordering untouched, only change what `readyElapsedSec` reads from.)

- [ ] **Step 2: Thread the store field through `workout-screen.tsx`**

Find where `<ActiveWorkoutScreen` is rendered (props list includes `exerciseStartMs={store.exerciseStartMs}` — grep for it) and add:
```tsx
        readyElapsedBaselineSec={store.readyElapsedBaselineSec}
        onSetReadyElapsedBaselineSec={store.setReadyElapsedBaselineSec}
```

- [ ] **Step 3: Run full verification**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 4: Manual verification against the local dev DB (simulates backgrounding)**

Native backgrounding can't be triggered in this sandbox (no Capacitor/Android runtime),
but the bug and the fix both hinge purely on whether the baseline survives a component
remount — a hard page reload is a faithful stand-in and is achievable via `pnpm dev` +
a browser:
1. Start a workout, reach a barbell exercise's ready screen, let the ramp-up run for
   ~20–30s (note the `0:2x / 4:00`-ish reading and the header session clock).
2. Hard-reload the page (F5 / Playwright `page.reload()`) — this remounts every
   component exactly like an Android WebView recreation would.
3. Confirm: the ramp-up timer resumes from roughly where it left off (not reset to
   `0:00`), and the header session clock still shows correctly-advanced elapsed time.
   Before the fix, step 3 shows the ramp-up reset to `0:00` while the header keeps
   advancing — reproduce that on the pre-fix code first to confirm the repro is valid,
   then confirm it's gone after the fix.

- [ ] **Step 5: Commit**

```bash
git add components/workout/active-workout-screen.tsx components/workout-screen.tsx
git commit -m "fix: warm-up ramp-up timer survives app backgrounding"
```
