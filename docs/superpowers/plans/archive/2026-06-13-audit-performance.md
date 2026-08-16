# Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the avoidable re-renders and heavy queries in the active-workout path so the app feels smooth and saves battery on the target Samsung Galaxy S25 Ultra.

**Architecture:** The workout orchestrator subscribes to the whole Zustand store and re-renders the entire tree (plus all `SetCard`s) on every 1-second timer tick and every set-log. The fix is granular store selectors + `React.memo` on children, then removing the heaviest query (`/api/achievements`, 15 full-table scans) from the mid-workout flow.

**Tech Stack:** React 19, Zustand (`lib/stores/workout-store.ts`), Drizzle/Postgres (`lib/data/postgres/adapter.ts`).

---

## Findings addressed

| # | Sev | Location | Issue |
|---|-----|----------|-------|
| P1 | **High** | `components/workout-screen.tsx:50` | `const store = useWorkoutStore()` (no selector) → subscribes to entire store → whole 778-line tree re-renders on every `set()` and every timer tick. |
| P2 | **High** | `workout-screen.tsx:83,293,663` | `/api/achievements` (15 full-table aggregate scans) fetched on mount + on completion + on pre-screen complete, just to compute an XP delta. |
| P3 | **Medium** | `active-workout-screen.tsx`, `set-card.tsx` | No `React.memo`; inline `onRepChange={(v)=>onRepChange(i,v)}` closures recreated every render → all `SetCard`s re-render each tick. |
| P4 | **Medium** | `adapter.ts:171-198,247-257,360-367` | `upsertUser` seeds ~17 styles with individual SELECT/INSERT on every login (N+1). |
| P5 | **Medium** | `app/api/weekly-digest/route.ts:64-76` | Dead self-`fetch` to `/api/friends/leaderboard` with empty cookie; result discarded; second `getRepository()` in loop. |
| P6 | **Low** | `active-workout-screen.tsx:80` | `/api/exercise-history` fetch has no AbortController; rapid advance can land stale responses. |

---

## Task 1: Replace the whole-store subscription with granular selectors (P1)

**Files:**
- Modify: `components/workout-screen.tsx:50` and every `store.X` usage

This is the single biggest win. `useWorkoutStore()` with no selector re-renders on ALL state changes. Replace with field selectors so the component only re-renders when a field it reads actually changes.

- [ ] **Step 1: Inventory the fields used**

Run: `grep -n "store\." components/workout-screen.tsx`
Record every `store.<field>` and `store.<action>` referenced.

- [ ] **Step 2: Replace the single subscription with `useShallow` field picking**

At line 50, replace:

```ts
  const store = useWorkoutStore();
```

with a single shallow selector that picks exactly the fields/actions used (example — fill in from the Step-1 inventory):

```ts
import { useShallow } from 'zustand/react/shallow';

  const store = useWorkoutStore(
    useShallow((s) => ({
      mode: s.mode,
      currentSet: s.currentSet,
      workoutPhase: s.workoutPhase,
      workoutStartMs: s.workoutStartMs,
      workoutEndMs: s.workoutEndMs,
      workoutSessionId: s.workoutSessionId,
      setWeights: s.setWeights,
      // ...all OTHER read fields from the inventory...
      // actions are stable references in Zustand, safe to include:
      setMode: s.setMode,
      setCurrentSet: s.setCurrentSet,
      setWorkoutPhase: s.setWorkoutPhase,
      setTimestamps: s.setTimestamps,
      // ...all OTHER actions used...
    }))
  );
```

> `useShallow` does a shallow-equality check, so the component re-renders only when one of the picked values changes — not on unrelated `set()` calls. Actions in Zustand keep stable identity, so including them costs nothing. Keep all existing `store.X` usages unchanged; only the subscription changes.

- [ ] **Step 3: Verify timer fields are isolated (optional micro-step)**

The two 1-second intervals set `sessionElapsedSec`/`exerciseElapsedSec` (local `useState`, not store). They still re-render the orchestrator each second, but after Task 3 only the timer display re-renders. If they are stored in the Zustand store instead of local state, move them to local `useState` so they don't broadcast to other selector subscribers.

- [ ] **Step 4: Type-check and smoke-test**

Run: `pnpm exec tsc --noEmit`
Expected: PASS. Then `pnpm dev`, start a workout, log a set, advance exercises — behaviour identical, no console errors.

- [ ] **Step 5: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "Subscribe to the workout store with a shallow selector to cut whole-tree re-renders"
```

---

## Task 2: Memoize SetCard and stabilize its callbacks (P3)

**Files:**
- Modify: `components/workout/set-card.tsx`
- Modify: `components/workout/active-workout-screen.tsx` (inline arrow props ≈380, 470)

- [ ] **Step 1: Wrap SetCard in React.memo**

At the bottom of `components/workout/set-card.tsx`, change the export so the component is memoized:

```ts
import { memo } from 'react';
// ...existing component defined as `function SetCard(props: SetCardProps) { ... }`
export default memo(SetCard);
```

(If it's currently `export default function SetCard`, rename to `function SetCard` and add the `memo` export.)

- [ ] **Step 2: Stop creating new closures per card**

In `active-workout-screen.tsx`, the props like `onRepChange={(v) => onRepChange(i, v)}` create a new function each render, defeating `memo`. Change `SetCard` to accept the index and call back with it:

In `set-card.tsx`, change the prop type so the card passes its own index up:

```ts
  index: number;
  onRepChange: (index: number, value: number) => void;
```

and inside the card call `onRepChange(index, value)` instead of `onRepChange(value)`. Then in `active-workout-screen.tsx` pass the stable handler directly:

```tsx
  <SetCard index={i} onRepChange={onRepChange} /* ...other props... */ />
```

Apply the same pattern to any other inline arrow props (`onWeightChange`, etc.).

- [ ] **Step 3: Type-check and smoke-test**

Run: `pnpm exec tsc --noEmit`
Then `pnpm dev`: editing reps/weight on one set card must still update only that card; logging still works.

- [ ] **Step 4: Commit**

```bash
git add components/workout/set-card.tsx components/workout/active-workout-screen.tsx
git commit -m "Memoize SetCard and stabilize its callbacks to stop per-tick re-renders"
```

---

## Task 3: Stop fetching /api/achievements mid-workout (P2)

**Files:**
- Modify: `components/workout-screen.tsx:82-87, 290-296, 661-666`

The achievements payload runs 15 lifetime aggregate scans — the heaviest queries in the app — purely to compute an XP delta, and fires three times around a workout (the worst time, on battery). 

- [ ] **Step 1: Read the three call sites and what they use the result for**

Run: `grep -n "/api/achievements\|xp\|XP\|level\|earned" components/workout-screen.tsx`
Determine which fields of the response are actually displayed (likely an "XP earned / leveled up" toast on the done screen).

- [ ] **Step 2: Remove the redundant pre-workout fetches**

Delete the mount-time fetch (≈82-87) and the pre-screen-complete fetch (≈290-296). Keep only the single post-completion fetch on the done screen if the XP toast is shown there. If the toast needs a delta, capture the "before" XP once from the already-cached `achievements:${userId}` value (`readCacheSync`) instead of a fresh network round-trip:

```ts
import { readCacheSync } from '@/lib/sqlite/cache';
// at done-screen render:
const before = readCacheSync(`achievements:${user.id}`);
```

- [ ] **Step 3: (Recommended follow-up, separate commit) denormalize lifetime counters**

For a durable fix, add running counters so achievements never full-scans:
- Migration: add `total_volume`, `total_sets`, `total_sessions` columns to a `user_stats` table (or `users`).
- Update them inside `logExerciseAndSets` / `complete-workout` transactions.
- Rewrite the heavy aggregates in `lib/achievements.ts` to read the counters.

This is a larger change — write it as its own plan if pursued. The render-frequency fix (Steps 1-2) already removes the queries from the hot path.

- [ ] **Step 4: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/workout-screen.tsx
git commit -m "Stop refetching the heavy achievements payload during the active workout"
```

---

## Task 4: Remove the dead weekly-digest self-fetch (P5)

**Files:**
- Modify: `app/api/weekly-digest/route.ts:64-76`

- [ ] **Step 1: Read the block**

Run: `sed -n '55,85p' app/api/weekly-digest/route.ts` (or Read the file). Confirm the `fetch(\`${APP_URL}/api/friends/leaderboard\`, { headers: { Cookie: '' } })` result is discarded and `friendsContext` is built only from `friendIds.length`.

- [ ] **Step 2: Delete the fetch and reuse the outer repo**

Remove the entire `fetch(...leaderboard...)` block. Replace the in-loop `getRepository()` (line 67) usage with the `repo` already created earlier in the handler. Build `friendsContext` directly from `friendIds.length` (which is already available).

- [ ] **Step 3: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add app/api/weekly-digest/route.ts
git commit -m "Remove dead self-fetch and duplicate repo init from weekly-digest"
```

---

## Task 5: Batch the per-login seeding (P4)

**Files:**
- Modify: `lib/data/postgres/adapter.ts:171-198, 247-257, 360-367` (`upsertUser` seeding)

- [ ] **Step 1: Read the seeding block**

Run: `sed -n '160,260p' lib/data/postgres/adapter.ts` (Read the relevant span). Identify the ~17 per-style `SELECT ... LIMIT 1` existence checks and the per-set `for`-loop `INSERT`s.

- [ ] **Step 2: Gate seeding behind a single check**

Replace the 17 existence checks with ONE query: `SELECT 1 FROM progression_styles WHERE user_id = $1 LIMIT 1`. If a row exists, skip seeding entirely (the user is already seeded). Only when absent, seed all styles.

- [ ] **Step 3: Batch the style-set inserts**

Replace the per-set `for`-loop `INSERT`s with a single multi-row `db.insert(s.styleSets).values([...])` call built from the full set array. Apply the same to the phase-set seeding (≈247-257, 360-367).

- [ ] **Step 4: Type-check and verify login still seeds correctly**

Run: `pnpm exec tsc --noEmit`. Then against the local DB, drop `/var/lib/postgresql/local-dev`, re-run `pnpm db:local`, register a fresh user, and confirm the expected styles/sets appear exactly once.

- [ ] **Step 5: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Gate and batch per-login progression-style seeding to cut DB round-trips"
```

---

## Task 6 (Low): Abort stale exercise-history fetches (P6)

**Files:**
- Modify: `components/workout/active-workout-screen.tsx:80-88`

- [ ] **Step 1: Add an AbortController to the effect**

```ts
  useEffect(() => {
    if (!exercise?.name) return;
    const ctrl = new AbortController();
    fetch(`/api/exercise-history?name=${encodeURIComponent(exercise.name)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(/* existing handler */)
      .catch(() => {});   // aborted or network error
    return () => ctrl.abort();
  }, [exercise?.name]);
```

- [ ] **Step 2: Type-check and commit**

Run: `pnpm exec tsc --noEmit`

```bash
git add components/workout/active-workout-screen.tsx
git commit -m "Abort in-flight exercise-history fetch when the exercise changes"
```

---

## Verification before completion (whole plan)

- [ ] Run: `pnpm exec tsc --noEmit && pnpm lint && pnpm test` — all PASS.
- [ ] Manual (Chrome DevTools, throttle CPU 4x): with React DevTools "Highlight updates" on, start a workout — before the fix the whole tree flashes every second; after Tasks 1-2 only the timer text + active card flash.
- [ ] Manual: log a full workout — XP toast still appears on the done screen (Task 3), and `/api/achievements` no longer fires mid-workout (Network tab).
- [ ] Push: `git push -u origin claude/app-comprehensive-audit-goew61`.

## Local testing notes (per CLAUDE.md)
- **Pull:** `git pull origin claude/app-comprehensive-audit-goew61`
- **What to look for:** smoother active-workout screen on device; fewer network calls during a workout; faster login.
- **Regression to check:** weight/rep edits, set logging, exercise advance, and the done-screen XP toast all still work after the selector + memo changes.
