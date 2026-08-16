# Inter-Exercise Rest Tracking Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Bug:** `exercise_logs.inter_exercise_rest_sec` (the "transition time between exercises"
column the admin Time Audit — `lib/workout/time-audit.ts` — uses to validate the
`duration-model.ts` transition assumptions of 240s/120s/60s) has been **null on every
row except the first exercise of every session, for every user, since the column was
introduced** (`migrations/015_set_timing.sql`). Confirmed two ways this session:

1. **Production**: the admin Time Audit's "Transitions by equipment" table shows
   `n=0` / `outliers=0` for all three equipment classes, and every row of the
   "Per exercise" table shows `transition med: —`, despite those same rows having
   solid sample counts (17–28) for set/rest timing.
2. **Local repro**: drove a real two-exercise workout through the local dev server
   (Playwright, network interception + a `localStorage` state dump of
   `ta_workout_state` at every step — see the session transcript). The second
   exercise's `POST /api/log-exercise` payload came back with `interExerciseRestSec`
   key entirely absent (`undefined`), exactly matching production. The store dump
   pinpointed the moment it breaks:

```
[store@ex0-afterComplete]        lastExerciseEndMs=null  setEndMsArray=[]      mode=exercise-summary
[store@afterNextExercise-click]  lastExerciseEndMs=null  setEndMsArray=[]      mode=active   (exercise 2 begins)
```

**Root cause** — an ordering bug between two `components/workout-screen.tsx` functions
that both touch `setEndMsArray`:

- `handleCompleteSet` (fires when the *current* exercise's last set is logged) calls
  `store.commitExerciseSummary({...})` (line 831) to switch to the exercise-summary
  screen. That store action (`lib/stores/workout-store.ts:272-283`) resets
  `setEndMsArray: []` as part of clearing per-set working state for the summary view.
- `advance()` (fires later, when the user taps "Next Exercise" to leave the summary
  screen) is where `lastExerciseEndMs` for the *upcoming* exercise gets set — but it
  reads the value from `store.setEndMsArray[store.setEndMsArray.length - 1] ?? null`
  (line 508) — which `commitExerciseSummary` **already wiped to `[]`** one screen
  earlier. The read always resolves to `null`.
- Every exercise's `interExerciseRestSec` is computed in `handleCompleteSet`
  (line 736-739) as `snapLastExerciseEndMs !== null && snapExerciseStartMs !== null ?
  ... : undefined` — since `lastExerciseEndMs` is unconditionally `null` for every
  exercise after the first (per the bug above), the condition never holds and the
  field is always `undefined`.

This is deterministic — it fires on **every** exercise transition, not a
backgrounding/timing edge case — which is exactly why the admin audit shows 0 samples
rather than a noisy-but-nonzero count.

**Fix:** Capture the last set's end time into `lastExerciseEndMs` **inside
`handleCompleteSet`**, before `commitExerciseSummary` clears anything — using
`snapSetEndTimes` (already snapshotted at the top of `handleCompleteSet`, line 705,
*before* any clearing happens). Then remove `advance()`'s now-redundant (and broken)
capture entirely — `lastExerciseEndMs` will already be correct by the time `advance()`
runs, for all three of its branches (solo-mode exit, next-exercise, workout-complete),
since all three are only ever reached after `handleCompleteSet` has already set it.
This also fixes the identical bug for solo-mode logs, which go through the same
`handleCompleteSet` → `commitExerciseSummary` → (eventually) `advance()` sequence.

**Side benefit (unplanned, don't scope-creep into it):** the "Skip exercise" path
(`handleInjurySwap`'s `alt === null` branch, `advance()` called directly without ever
calling `handleCompleteSet`) will now correctly leave `lastExerciseEndMs` untouched
(pointing at the last *actually completed* exercise) instead of overwriting it from
whatever was in `setEndMsArray` at skip time. This is a strict improvement, not a
behavior this plan needs to test — no set was ever logged for a skipped exercise, so
there was never a meaningful value to preserve either way.

**Tech Stack:** Next.js 15, React, Zustand, TypeScript. No DB/migration changes —
`inter_exercise_rest_sec` already exists and is already wired through `log-exercise.ts`
and `adapter.ts` correctly (verified this session); only the *client-side value being
sent* was ever wrong.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `components/workout-screen.tsx` | Modify | Set `lastExerciseEndMs` in `handleCompleteSet`; remove the broken reads in `advance()` |

---

### Task 1: Fix the capture ordering

**Files:**
- Modify: `components/workout-screen.tsx`

No existing unit-test infra covers this component (no `*.test.tsx` exists for
`workout-screen.tsx` or any workout screen today — this is a cross-render,
cross-store-mutation-order bug, which is exactly why it shipped silently and is why a
pure-function unit test wouldn't have caught it). Verification is a scripted
Playwright repro against the local dev server, mirroring how this bug was found.

- [ ] **Step 1: Reproduce the bug on the current code (confirms the repro is valid)**

Using a Playwright script against `pnpm dev` (webpack, not `--turbopack` — Turbopack
has a known unrelated dev-mode quirk that 500s `/api/log-exercise`, documented in
`docs/overview/history-latest.md` session 186) and the local dev DB:
1. Log in as `test@local.dev` / `testpass123`.
2. Start the seeded "Push" session, log all 3 sets of exercise 1 (Barbell Bench
   Press), tap "Complete →", tap "Next Exercise".
3. Log all 3 sets of exercise 2 (Barbell Overhead Press).
4. Intercept the `POST /api/log-exercise` request bodies. Confirm exercise 2's
   payload has `interExerciseRestSec` **absent** (this is the pre-fix baseline).

- [ ] **Step 2: Write the implementation**

In `components/workout-screen.tsx`:

1. In `handleCompleteSet`, immediately before the `store.commitExerciseSummary({...})`
   call (line 831), add:
```ts
    // lastExerciseEndMs must be captured HERE, before commitExerciseSummary clears
    // setEndMsArray — advance() used to read it later and always got null (the bug
    // behind inter_exercise_rest_sec being silently absent on every exercise_logs
    // row past the first, since the column shipped in migration 015).
    store.setTimestamps({ lastExerciseEndMs: snapSetEndTimes[snapSetEndTimes.length - 1] ?? null });
    store.commitExerciseSummary({
```
   (`snapSetEndTimes` is already in scope — snapshotted at the top of the function,
   line 705, before any clearing.)

2. In `advance()` (lines 506-564), delete the now-dead/broken capture and its three
   use sites:
   - Delete line 508: `const lastSetEndMs = store.setEndMsArray[store.setEndMsArray.length - 1] ?? null;`
   - Delete line 512: `store.setTimestamps({ lastExerciseEndMs: lastSetEndMs });` (solo-mode branch)
   - Delete line 546: `store.setTimestamps({ lastExerciseEndMs: lastSetEndMs });` (next-exercise branch)
   - Delete line 553: `store.setTimestamps({ lastExerciseEndMs: lastSetEndMs });` (workout-complete branch)
   - Remove `store.setEndMsArray` from the `useCallback` dependency array at the end
     of `advance()` (line 564) if it's no longer referenced anywhere else in the
     function — check before removing.

3. Run `npx tsc --noEmit` — confirm nothing else references the deleted `lastSetEndMs`
   local.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green (this is a pure control-flow reorder — no new logic, so no test
should need updating).

- [ ] **Step 4: Re-run the Step 1 repro — confirm it now passes**

Same Playwright script as Step 1. Expected: exercise 2's `POST /api/log-exercise`
payload now has `interExerciseRestSec` present and **positive** (a small number in
this scripted repro, since sets are logged back-to-back with no real rest — the
point is that it's a defined, non-negative number, not `undefined`).

Additionally verify directly against the local dev DB:
```sql
select exercise_name, inter_exercise_rest_sec from exercise_logs
where workout_session_id = '<the session id from the repro>'
order by logged_at;
```
Expected: the first exercise's row is `NULL` (correct — no prior exercise), every
subsequent row has a non-null value.

- [ ] **Step 5: Manual verification of the solo-log and skip paths**

1. **Solo log**: log a solo exercise (outside a program session) twice in a row from
   the exercise picker. Confirm the second solo log's `inter_exercise_rest_sec` is
   populated.
2. **Skip**: start a session, skip exercise 1 (via the injury-swap "Skip" button or
   the pre-workout skip control), log exercise 2 fully. Confirm this doesn't crash
   and `inter_exercise_rest_sec` on exercise 2 is either `NULL` (no prior real
   exercise to measure from) or reflects an earlier real completion — not garbage.

- [ ] **Step 6: Commit**

```bash
git add components/workout-screen.tsx
git commit -m "fix: capture lastExerciseEndMs before commitExerciseSummary clears setEndMsArray"
```

⚠️ **Not exercised by this plan:** real on-device timing (the fix is a pure ordering
change, equally testable in the browser sandbox as on-device — no native-only
behavior involved) and the actual admin Time Audit numbers against a realistic volume
of *newly-collected* production data (will only be meaningful days/weeks after this
ships and real workouts accumulate transition samples).
