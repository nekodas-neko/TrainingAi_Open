# Workout Timing-Recording Integrity Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** `docs/reviews/2026-07-05-workout-backlog-review.md` §5 audited the full
timing-recording chain (`setTimes`, `restTimes`, `setStartTimes`/`setEndTimes`,
`interExerciseRestSec`, `warmupEndedAtMs`, `completed_at`) that a future "assign
workout time budgets from measured data" feature will train on. The PR #231
inter-exercise-rest fix (`docs/superpowers/plans/2026-07-05-inter-exercise-rest-tracking-fix.md`)
already fixed the worst of it and **is correct — do not disturb its ordering**
(`handleCompleteSet` snapshots `lastExerciseEndMs` from the set-end array **before**
`commitExerciseSummary` clears it, `workout-screen.tsx:825-829`). This plan fixes what's
left: two data-loss **blockers** on shipped, user-facing features, plus four
measurement-quality **should-fixes** that would otherwise corrupt the measurement
window before the future budget feature starts learning from it — exactly the
reasoning that motivated fixing #231 before, not after, real usage accumulated.

**Recommended split: two PRs.**
- **PR 1 (Tasks 1-2)** — the two blockers. Both are correctness bugs on features
  already live (supersets, the exercise-edit dialog) and can ship independently the
  moment they're verified.
- **PR 2 (Tasks 3-6)** — the should-fixes. Lower urgency, same file family; bundling
  them keeps review focused on "used-for-future-planning" data quality rather than
  "actively wrong right now."

Every file:line reference below was re-verified against current `main` this session
(not copied from the review without checking) — the review is 0 days old at the time
of this plan, but line numbers drift fast in this codebase.

**No database migration is needed.** Every fix in this plan reads/writes columns and
payload fields that already exist (`set_logs.rest_time_sec`, `exercise_logs.inter_exercise_rest_sec`,
`workout_sessions.completed_at`, etc.). If an implementer concludes partway through
that a migration actually is required, claim Postgres migration number **112** (the
next free slot per the review's bookkeeping note) and flag it explicitly before
proceeding — no plan in this backlog has claimed it as of this writing.

---

## BLOCKER 1 — supersets record `rest_time_sec = 0` for every switched-back set

**Bug:** In an alternating superset (exercise A / exercise B sharing a
`supersetGroup`), every rest period recorded for a set logged *after* switching back
to an exercise comes out as `0`, corrupting both the admin Time Audit (silently shows
`n=0` for superset sessions, since it filters `restTimeSec > 0`) and
`restAdherencePct` (which does **not** filter — the zeros drag adherence toward 0 for
any user who supersets).

**Root cause** — `restStartMs` is tracked as a single flat field on `WorkoutState`
but is never carried through the per-exercise stash/restore mechanism that superset
alternation uses for every other piece of exercise-specific timing state:

- `handleLogCurrentSet` (`components/workout-screen.tsx:676`) sets
  `restStartMs: now` right after a set is logged — this is exercise A's "resume
  counting from here" rest clock, correctly captured at the moment A hands off.
- `switchToExercise` (`components/workout-screen.tsx:632-661`) then calls
  `stashExercise(currentIdx)` to save exercise A's in-progress state before loading
  exercise B. `stashExercise` (`lib/stores/workout-store.ts:239-251`) saves `sets`,
  `reps`, `perSetWeights`, `setWeights`, `currentSet`, `lapTimes`, `setStartMsArray`,
  `setEndMsArray`, `restTimes`, `rpeValues`, `accumulatedRestMs`, `exerciseStartMs`,
  `timerStarted` into `ExerciseBuffer` — **`restStartMs` is not in that list**, and
  is not a field of `ExerciseBuffer` at all (`lib/stores/workout-store.ts:11-25`).
- When B is later switched away from and A comes back around, `restoreExercise`
  (`lib/stores/workout-store.ts:252-270`) restores every buffered field **except**
  `restStartMs`, which it hardcodes to `null` (line 266) regardless of what was
  saved — because nothing was ever saved for it.
- `handleStartSet` (`components/workout-screen.tsx:617-626`) then computes
  `restMs = store.restStartMs !== null ? now - store.restStartMs : 0` (line 619) —
  since `restStartMs` is always `null` after a restore, `restMs` is always `0`, and
  `store.appendRestTime(Math.round(restMs / 1000))` (line 621) records `0`.

This fires on **every** switch-back in **every** superset session, deterministically
— not an edge case.

**Fix — carry `restStartMs` through the buffer, not a sequence-step redesign.**
Add `restStartMs: number | null` to `ExerciseBuffer`, save `s.restStartMs` in
`stashExercise`, and restore `buf.restStartMs` (instead of the hardcoded `null`) in
`restoreExercise`. This is the cleanest option because it is a 3-line change that
makes `restStartMs` behave exactly like every other per-exercise timing field already
threaded through this exact mechanism (`setStartMsArray`, `setEndMsArray`,
`restTimes`, …) — no new concept, no schema change, and it is symmetric with how the
rest of the buffer already works. Recording rest against the sequence step instead
(the alternative named in the review) would mean rebuilding how rest is attributed
end-to-end and is a materially larger, riskier change for the same outcome.

The `switchToExercise` fresh-init branch (`components/workout-screen.tsx:658`, which
also sets `restStartMs: null`) is **not** a bug and needs no change — a group member
being visited for the first time has no prior rest to resume, so `null` there is
correct (mirrors the also-correct `handleStart` reset at line 609).

**Tech Stack:** Zustand store (`lib/stores/workout-store.ts`), TypeScript, vitest
(`node` environment by default — the store's `persist` middleware needs
`localStorage`, so the new test file needs `// @vitest-environment jsdom`). No
schema/migration change.

---

## BLOCKER 2 — editing a logged exercise destroys all per-set timing

**Bug:** `PATCH /api/workout-entry` (used by the exercise-history edit dialog to
correct a weight/rep typo after the fact) unconditionally wipes every timing and RPE
column on every set of the exercise being edited, and mints brand-new set ids in the
process.

**Root cause** — `app/api/workout-entry/route.ts`, `PATCH` handler:

```ts
// line 71
await client.query('DELETE FROM set_logs WHERE exercise_log_id = $1', [exerciseLogId]);
for (let i = 0; i < weights.length; i++) {
  const intensityPct = estimated1rm > 0 ? Math.round(effectiveWeights[i] / estimated1rm * 1000) / 10 : null;
  await client.query(
    `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct)
     VALUES ($1, $2, $3, $4, $5)`,           // ← line 75-76: only these 5 columns
    [exerciseLogId, i + 1, weights[i], reps[i], intensityPct],
  );
}
```

`set_logs` (`lib/data/postgres/schema.ts:180-194`) also has `set_time_sec`,
`rest_time_sec`, `set_start_ms`, `set_end_ms`, `rpe`, and `use_for_1rm` — none of
which are in the `INSERT`'s column list, so every one of them silently reverts to its
column default (`NULL`, or `false` for `use_for_1rm`) on **every** edit, even a
one-character weight correction on an otherwise-correct set. The fresh `INSERT` also
mints new random `set_logs.id` values (the old rows are gone via the `DELETE`) —
since the local-device sync pull (`getSyncDelta`, `lib/data/postgres/adapter.ts:2679-2707`)
selects `set_logs` by `updated_at > since` and the local SQLite store upserts by `id`
(`INSERT OR REPLACE ... WHERE id=?`, `lib/local-store/sqlite-backend.ts`), a device
that already has the old rows locally gains the new ones alongside them instead of
replacing them — duplicate sets on-device.

`set_logs` already has a `unique(exercise_log_id, set_number)` constraint
(`lib/data/postgres/schema.ts:194`) and the codebase already has an established
`INSERT … ON CONFLICT (exercise_log_id, set_number) DO UPDATE` pattern for exactly
this shape of upsert (`logSets`, `lib/data/postgres/adapter.ts:739-763`) — this route
is the one write path that never adopted it.

**Fix:** Replace the `DELETE` + blind re-`INSERT` with an `INSERT … ON CONFLICT
(exercise_log_id, set_number) DO UPDATE` that only overwrites `weight_kg`, `reps`,
and `intensity_pct` (the three fields the edit dialog actually collects) — everything
else (`set_time_sec`, `rest_time_sec`, `set_start_ms`, `set_end_ms`, `rpe`,
`use_for_1rm`) is simply absent from the `SET` clause, so Postgres leaves the
existing row's value untouched. Because the conflict target is the unique
`(exercise_log_id, set_number)` index, a conflicting row is **updated in place** —
its original `id` is preserved, which is exactly what fixes the on-device duplication
(the local store's `id`-keyed upsert now matches the same row it already has).
Truncated tail sets (the edit removed trailing sets) still need an explicit
`DELETE … WHERE exercise_log_id = $1 AND set_number > $N`.

⚠️ **Known residual gap, explicitly out of scope for this task:** `set_logs` has no
`deleted_at`/tombstone column at all (confirmed: absent from
`lib/data/postgres/schema.ts` and from the `getSyncDelta` set-logs selection) — a
device that already pulled a now-truncated tail set has no delta signal that tells it
to remove it locally. This gap predates this bug (it would affect any hypothetical
future path that deletes an individual `set_logs` row) and fixing it properly needs a
tombstone column + migration, which is out of scope here. Flag it as a follow-up
backlog entry rather than scope-creeping this fix into a schema change.

**Tech Stack:** Next.js API route (`app/api/workout-entry/route.ts`), `pg`
transaction, no ORM (raw SQL via `getPool()`). No schema/migration change. No route
test infra exists in this codebase (confirmed: no `app/api/**/__tests__` directory
anywhere) — verified via the local dev Postgres instead, consistent with how this
route family is tested elsewhere.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/stores/workout-store.ts` | Modify | Add `restStartMs` to `ExerciseBuffer`; thread it through `stashExercise`/`restoreExercise` |
| `lib/stores/__tests__/workout-store.test.ts` | Create | Unit tests for the stash/restore round-trip |
| `app/api/workout-entry/route.ts` | Modify | `PATCH`: upsert-in-place by `set_number` instead of delete+reinsert |
| `components/workout-screen.tsx` | Modify | Omit `interExerciseRestSec` for grouped exercises (Task 3); send `completedAtMs` (Task 4) |
| `lib/workout/time-audit.ts` | Modify | `decomposeSessions` excludes non-positive transitions; new `robustAvgSetDurationsByExercise` |
| `lib/__tests__/time-audit.test.ts` | Modify | Tests for both of the above |
| `lib/workout/complete-workout.ts` | Modify | Accept `completedAtMs`, default to server time only when absent |
| `lib/workout/__tests__/complete-workout.test.ts` | Modify | Test the client-timestamp pass-through |
| `lib/data/postgres/adapter.ts` | Modify | `completeWorkoutSession`: first-write-wins guard (`isNull(completedAt)`) |
| `lib/data/postgres/slices/periodization.ts` | Modify | `getAvgSetDurationPerExercise` reuses the robust median instead of raw `AVG` |
| `lib/ai-periodization/signals.ts` | Modify | Drop the now-dead duplicate `?? 45` fallback |
| `lib/local-store/sync-helpers.ts` | Modify | `buildWorkoutLogPayload`: include start/end arrays, omit- instead of zero-fill |
| `lib/local-store/__tests__/sync-helpers.test.ts` | Modify | Tests for the rebuild payload fix |

---

## PR 1 — Blockers

### Task 1: Fix superset rest-time recording (carry `restStartMs` through the buffer)

**Files:**
- Modify: `lib/stores/workout-store.ts`
- Create: `lib/stores/__tests__/workout-store.test.ts`

Unlike most of `workout-screen.tsx`, this bug lives entirely in the plain Zustand
store (`lib/stores/workout-store.ts`) — no React rendering involved — so it genuinely
can be unit tested, unlike the #231 fix which needed a Playwright repro.

- [ ] **Step 1: Write the failing test**

Create `lib/stores/__tests__/workout-store.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkoutStore } from '../workout-store'

describe('ExerciseBuffer carries restStartMs through stash/restore (superset alternation)', () => {
  beforeEach(() => {
    useWorkoutStore.getState().resetSession()
  })

  it('restoreExercise returns the restStartMs that was in effect at stash time, not null', () => {
    const store = useWorkoutStore.getState()
    store.setTimestamps({ restStartMs: 123456 })
    store.stashExercise(0)
    const restored = store.restoreExercise(0)
    expect(restored).toBe(true)
    expect(useWorkoutStore.getState().restStartMs).toBe(123456)
  })

  it('a restored restStartMs produces a non-zero rest duration on the next Start Set tap', () => {
    const store = useWorkoutStore.getState()
    const restStart = Date.now() - 45_000 // rest began 45s ago
    store.setTimestamps({ restStartMs: restStart })
    store.stashExercise(1)
    store.restoreExercise(1)

    // Mirrors handleStartSet's computation (components/workout-screen.tsx:619)
    const now = Date.now()
    const finalRestStartMs = useWorkoutStore.getState().restStartMs
    const restMs = finalRestStartMs !== null ? now - finalRestStartMs : 0
    expect(restMs).toBeGreaterThan(40_000)
  })

  it('a first-visit exercise (no buffer) still initializes to null, not a stale value', () => {
    const store = useWorkoutStore.getState()
    const restored = store.restoreExercise(5) // never stashed
    expect(restored).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `pnpm vitest run lib/stores/__tests__/workout-store.test.ts`
Expected: the first two tests FAIL — `restStartMs` comes back `null` (the hardcoded
value in `restoreExercise`), not `123456`, and the computed `restMs` is `0`.

- [ ] **Step 3: Implement the fix**

In `lib/stores/workout-store.ts`:

1. Add `restStartMs: number | null` to the `ExerciseBuffer` interface (after
   `timerStarted: boolean`, line ~24):
```ts
interface ExerciseBuffer {
  // ...existing fields...
  timerStarted: boolean
  restStartMs: number | null   // in-progress rest clock for this exercise, if any
}
```
2. In `stashExercise` (line 239-251), add `restStartMs: s.restStartMs,` to the saved
   buffer object.
3. In `restoreExercise` (line 252-270), replace the hardcoded `restStartMs: null` on
   line 266 with `restStartMs: buf.restStartMs,`.

Do **not** touch the `switchToExercise` fresh-init branch in `components/workout-screen.tsx`
(line 658) — its `restStartMs: null` is correct for a never-visited exercise.

- [ ] **Step 4: Run the test, confirm it passes**

Run: `pnpm vitest run lib/stores/__tests__/workout-store.test.ts`
Expected: all three tests PASS.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green — this only adds a field to an internal buffer type; nothing
else reads `ExerciseBuffer` structurally.

- [ ] **Step 6: End-to-end verification on the local dev server**

Using `pnpm dev` and the local dev DB (note: confirm `/api/log-exercise` actually
returns 200 rather than the known Turbopack dev-mode 500 documented in
`docs/superpowers/plans/2026-07-05-log-exercise-turbopack-dev-fix.md` / §8 of the
backlog review — if that fix hasn't landed yet, verify via `next build && next start`
against the local DB instead, or check `set_logs` rows land via direct DB query
regardless of what the UI shows):
1. In `program-editor-sheet.tsx`, link two exercises in the seeded Push session into
   a superset (or use an existing linked pair if the seed already has one).
2. Start the session, log set 1 of exercise A, confirm the UI hands off to exercise
   B (superset alternation), log set 1 of B, then log set 2 of A (the switch-back).
3. Query the local dev DB:
```sql
select el.exercise_name, sl.set_number, sl.rest_time_sec
from set_logs sl join exercise_logs el on el.id = sl.exercise_log_id
where el.workout_session_id = '<session id>'
order by sl.exercise_log_id, sl.set_number;
```
Expected: exercise A's set 2 (the switch-back set) has a non-zero, plausible
`rest_time_sec` — not `0`.

- [ ] **Step 7: Commit**

```bash
git add lib/stores/workout-store.ts lib/stores/__tests__/workout-store.test.ts
git commit -m "fix: carry restStartMs through superset exercise stash/restore"
```

⚠️ **Not exercised by this task:** real on-device timing and backgrounding during a
superset switch (this is a pure store-logic fix, equally correct in the web sandbox
and on-device — no native-only code path involved), and whether the Turbopack
`/api/log-exercise` 500 (§8 of the backlog review) is still live in this environment
— if it is, Step 6 must fall back to a production build to get a real write to
verify against.

---

### Task 2: Fix exercise-edit timing wipe (upsert set_logs in place)

**Files:**
- Modify: `app/api/workout-entry/route.ts`

No route test infra exists in this codebase; verification is against the local dev
Postgres directly.

- [ ] **Step 1: Reproduce the bug on the current code**

Against the local dev DB:
1. Log a real exercise through the app (or use an already-logged exercise from the
   seed data) with at least 2 sets, ideally one performed live so it has real
   `set_time_sec`/`rest_time_sec`/`set_start_ms`/`set_end_ms`/`rpe` values — check
   with:
```sql
select id, set_number, weight_kg, reps, set_time_sec, rest_time_sec, set_start_ms, set_end_ms, rpe, use_for_1rm
from set_logs where exercise_log_id = '<exercise_log_id>' order by set_number;
```
2. Call the route directly (e.g. via a signed-in browser session hitting the app's
   own edit dialog, or `curl` with a copied session cookie):
```bash
curl -X PATCH http://localhost:3000/api/workout-entry \
  -H "Content-Type: application/json" -H "Cookie: <session cookie>" \
  -d '{"exerciseLogId":"<id>","weights":[102.5,102.5],"reps":[5,5]}'
```
3. Re-run the same `SELECT`. Confirm (pre-fix baseline): `set_time_sec`,
   `rest_time_sec`, `set_start_ms`, `set_end_ms`, `rpe` are now `NULL`,
   `use_for_1rm` is `false`, and the `id` values have changed.

- [ ] **Step 2: Write the implementation**

In `app/api/workout-entry/route.ts`, `PATCH` handler, replace lines 70-79:

```ts
    // Replace set_logs
    await client.query('DELETE FROM set_logs WHERE exercise_log_id = $1', [exerciseLogId]);
    for (let i = 0; i < weights.length; i++) {
      const intensityPct = estimated1rm > 0 ? Math.round(effectiveWeights[i] / estimated1rm * 1000) / 10 : null;
      await client.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct)
         VALUES ($1, $2, $3, $4, $5)`,
        [exerciseLogId, i + 1, weights[i], reps[i], intensityPct],
      );
    }
```

with:

```ts
    // Upsert set_logs in place by (exercise_log_id, set_number) so timing/RPE data
    // recorded during the live workout survives a post-hoc weight/rep correction —
    // only weight_kg/reps/intensity_pct come from the edit dialog, everything else
    // stays untouched. Preserving the row id also stops the local-device sync pull
    // from gaining a duplicate set alongside the one it already has.
    for (let i = 0; i < weights.length; i++) {
      const intensityPct = estimated1rm > 0 ? Math.round(effectiveWeights[i] / estimated1rm * 1000) / 10 : null;
      await client.query(
        `INSERT INTO set_logs (exercise_log_id, set_number, weight_kg, reps, intensity_pct)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (exercise_log_id, set_number) DO UPDATE SET
           weight_kg = EXCLUDED.weight_kg,
           reps = EXCLUDED.reps,
           intensity_pct = EXCLUDED.intensity_pct`,
        [exerciseLogId, i + 1, weights[i], reps[i], intensityPct],
      );
    }
    // Truncate any tail sets the edit removed (e.g. 3 sets -> 2).
    await client.query(
      'DELETE FROM set_logs WHERE exercise_log_id = $1 AND set_number > $2',
      [exerciseLogId, weights.length],
    );
```

- [ ] **Step 3: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green (no existing test covers this route; this step just guards
against a typo breaking something else).

- [ ] **Step 4: Re-run the Step 1 repro — confirm the fix**

Same `curl` call as Step 1. Confirm:
1. `weight_kg`/`reps`/`intensity_pct` updated to the new values.
2. `set_time_sec`, `rest_time_sec`, `set_start_ms`, `set_end_ms`, `rpe`,
   `use_for_1rm` are **unchanged** from their pre-edit values.
3. The `id` column for each set is **unchanged** — proving the local-device sync
   pull (which upserts by `id`) will update the existing local row instead of
   inserting a duplicate.

- [ ] **Step 5: Verify the tail-truncation path**

`curl` the same route with fewer `weights`/`reps` entries than the exercise
currently has sets (e.g. drop from 3 to 2). Confirm via `SELECT` that the higher
`set_number` row is gone and the remaining rows kept their timing data untouched.

- [ ] **Step 6: Commit**

```bash
git add app/api/workout-entry/route.ts
git commit -m "fix: preserve per-set timing and ids when editing a logged exercise"
```

⚠️ **Not exercised:** the local SQLite/Capacitor pull-and-upsert path itself (the fix
is verified by proving the server-side `id` is stable, which is what that path keys
on — actually pulling on a real device is not exercised here) and the tombstone gap
for truncated tail sets noted above (accepted, out of scope).

---

## PR 2 — Should-fixes

### Task 3: Stop negative `inter_exercise_rest_sec` from corrupting transition totals

**Files:**
- Modify: `components/workout-screen.tsx`
- Modify: `lib/workout/time-audit.ts`
- Modify: `lib/__tests__/time-audit.test.ts`

**Bug:** In a superset, exercise B can start (`exerciseStartMs`) while exercise A's
last set is still being logged, making `interExerciseRestSec = snapExerciseStartMs -
snapLastExerciseEndMs` (`components/workout-screen.tsx:729-733`) come out negative.
`decomposeSessions` (`lib/workout/time-audit.ts:197-199`) sums it via `?? 0`, which
**includes** negative values (only the median/percentile stats elsewhere filter
`> 0` — lines 104 and 154 — so `transitionSec`/`unaccountedSec` at the session level
are corrupted while the per-exercise/per-equipment medians look fine).

**Fix:** Transition time is genuinely ill-defined mid-superset (there's no clean
"exercise ended, exercise began" boundary when two exercises overlap by design) — omit
`interExerciseRestSec` entirely for a grouped exercise, and defensively exclude
non-positive values from `decomposeSessions`'s sum so a future negative value (e.g.
from clock skew on some other path) can't silently corrupt the session total either.

- [ ] **Step 1: Write the failing tests**

Add to `lib/__tests__/time-audit.test.ts`, inside the existing `describe('decomposeSessions', ...)`:

```ts
  it('excludes a negative inter_exercise_rest_sec from the transition sum instead of subtracting it', () => {
    const t0 = 1_000_000_000_000
    const sessions: TimingSessionRow[] = [{
      workoutSessionId: 'ws1', startedAt: t0, completedAt: t0 + 3_600_000, warmupEndedAt: t0 + 600_000,
    }]
    const sets = [set({ setTimeSec: 60, restTimeSec: 120, setStartMs: t0 + 900_000 })]
    const exercises = [
      exRow({ interExerciseRestSec: 240 }),
      exRow({ interExerciseRestSec: -30, exerciseName: 'Bench' }), // superset overlap
    ]
    const [d] = decomposeSessions(sessions, sets, exercises)
    expect(d.transitionSec).toBe(240) // the -30 is excluded, not summed in as -30
  })
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: FAIL — `d.transitionSec` is currently `210` (240 + -30).

- [ ] **Step 3: Implement the `decomposeSessions` fix**

In `lib/workout/time-audit.ts`, replace line 197-199:
```ts
      const transitionSec = exercises
        .filter(e => e.workoutSessionId === ws.workoutSessionId)
        .reduce((t, e) => t + (e.interExerciseRestSec ?? 0), 0)
```
with:
```ts
      const transitionSec = exercises
        .filter(e => e.workoutSessionId === ws.workoutSessionId && (e.interExerciseRestSec ?? 0) > 0)
        .reduce((t, e) => t + e.interExerciseRestSec!, 0)
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: all PASS, including the pre-existing `decomposeSessions` tests.

- [ ] **Step 5: Implement the write-site fix (omit for grouped exercises)**

In `components/workout-screen.tsx`, `handleCompleteSet`, change the
`interExerciseRestSec` computation (lines 729-733):
```ts
    // Inter-exercise rest: time from last set end of previous exercise to "Begin Exercise" tap
    const interExerciseRestSec =
      snapLastExerciseEndMs !== null && snapExerciseStartMs !== null
        ? Math.round((snapExerciseStartMs - snapLastExerciseEndMs) / 1000)
        : undefined;
```
to:
```ts
    // Inter-exercise rest: time from last set end of previous exercise to "Begin Exercise"
    // tap. Undefined (not recorded) for a grouped/superset exercise — the next
    // exercise's clock can start while this one's last set is still being logged
    // (that's the point of alternating), so "transition time" has no clean meaning
    // mid-superset and would otherwise go negative.
    const interExerciseRestSec =
      ex.supersetGroup == null && snapLastExerciseEndMs !== null && snapExerciseStartMs !== null
        ? Math.round((snapExerciseStartMs - snapLastExerciseEndMs) / 1000)
        : undefined;
```

- [ ] **Step 6: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 7: Verify on the local dev server**

Log a superset session end-to-end (per Task 1 Step 6). Query:
```sql
select exercise_name, inter_exercise_rest_sec from exercise_logs
where workout_session_id = '<session id>' order by logged_at;
```
Expected: grouped exercises show `NULL` for `inter_exercise_rest_sec`; the first
exercise of a non-grouped run still shows `NULL` (no prior exercise, unchanged
behavior); a non-grouped exercise following another non-grouped exercise still shows
a normal positive value (regression check against the #231 fix).

- [ ] **Step 8: Commit**

```bash
git add components/workout-screen.tsx lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts
git commit -m "fix: omit inter-exercise rest for supersets instead of letting it go negative"
```

⚠️ **Not exercised:** whether any *other* path can independently produce a negative
`interExerciseRestSec` outside of the superset overlap case (none was found in this
session's read of the codebase, but the `decomposeSessions` filter is intentionally
defensive against that possibility rather than proven necessary for it).

---

### Task 4: Make `completed_at` the workout's real end time, first-write-wins

**Files:**
- Modify: `lib/workout/complete-workout.ts`
- Modify: `lib/workout/__tests__/complete-workout.test.ts`
- Modify: `lib/data/postgres/adapter.ts`
- Modify: `components/workout-screen.tsx`

**Bug:** `completeWorkoutFromPayload` (`lib/workout/complete-workout.ts:28`) always
stamps `new Date()` — server-receipt time — as `completed_at`, and
`repo.completeWorkoutSession` (`lib/data/postgres/adapter.ts:677-681`) overwrites it
unconditionally, even when the session is already completed. The client already
computes the real end time (`endMs = Date.now()`,
`components/workout-screen.tsx:956`) and uses it for `completeWorkoutLocally`
(line 989) and the calendar-event payload (line 928), but never sends it to
`/api/complete-workout`. An offline completion replayed hours later — or replayed
twice via the outbox — inflates the recorded duration and pollutes
`decomposeSessions.totalSec` and the `sessionLoad = rpe × durationMin` health-trends
metric.

Usefully, `completeWorkoutFromPayload` is **already shared** between the web route
(`app/api/complete-workout/route.ts`) and the offline-outbox replay
(`pushMutations`'s `complete_workout` branch, `lib/data/postgres/adapter.ts:3130-3138`
— both call the same function with the same schema-parsed payload), so this fix does
not need separate mirroring work; fixing the shared function fixes both paths at
once, consistent with the reason it was extracted this way in the first place.

- [ ] **Step 1: Write the failing test**

Add to `lib/workout/__tests__/complete-workout.test.ts`, inside
`describe('completeWorkoutFromPayload', ...)`:

```ts
  it('uses the client-provided completedAtMs instead of server-receipt time when present', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    const completedAtMs = 1_751_600_000_000 // an arbitrary point in the past
    await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1', completedAtMs })

    expect(completeWorkoutSession).toHaveBeenCalledWith('u1', 'ws-1', new Date(completedAtMs))
  })

  it('falls back to server-receipt time when completedAtMs is absent (legacy client)', async () => {
    getWorkoutSessionById.mockResolvedValue({ id: 'ws-1', startedAt: new Date(), completedAt: null })
    getWorkoutSessionProgramSessionId.mockResolvedValue('ps-1')

    const before = Date.now()
    await completeWorkoutFromPayload('u1', { workoutSessionId: 'ws-1' })
    const stampedDate = completeWorkoutSession.mock.calls[0][2] as Date

    expect(stampedDate.getTime()).toBeGreaterThanOrEqual(before)
  })
```

- [ ] **Step 2: Run tests, confirm the first one fails**

Run: `pnpm vitest run lib/workout/__tests__/complete-workout.test.ts`
Expected: the first new test FAILs (called with a `new Date()` close to "now", not
`new Date(1_751_600_000_000)`); the second passes already (it's today's behavior).

- [ ] **Step 3: Implement the schema + function change**

In `lib/workout/complete-workout.ts`:
```ts
export const CompleteWorkoutPayloadSchema = z.object({
  workoutSessionId: z.string().uuid(),
  completedAtMs: z.number().optional(),
})
```
and change line 28 from:
```ts
  await repo.completeWorkoutSession(workoutSessionId, userId, new Date())
```
to:
```ts
  const completedAt = payload.completedAtMs ? new Date(payload.completedAtMs) : new Date()
  await repo.completeWorkoutSession(workoutSessionId, userId, completedAt)
```
(destructure `completedAtMs` alongside `workoutSessionId` at the top of the function).

- [ ] **Step 4: Add the first-write-wins guard in the adapter**

In `lib/data/postgres/adapter.ts`, change `completeWorkoutSession` (lines 677-681)
from:
```ts
  async completeWorkoutSession(workoutSessionId: string, userId: string, completedAt: Date): Promise<void> {
    await this.db.update(s.workoutSessions)
      .set({ completedAt })
      .where(and(eq(s.workoutSessions.id, workoutSessionId), eq(s.workoutSessions.userId, userId)))
  }
```
to (mirroring the existing `setWorkoutSessionWarmupEnd` `isNull` guard immediately
below it, lines 689-697):
```ts
  async completeWorkoutSession(workoutSessionId: string, userId: string, completedAt: Date): Promise<void> {
    await this.db.update(s.workoutSessions)
      .set({ completedAt })
      .where(and(
        eq(s.workoutSessions.id, workoutSessionId),
        eq(s.workoutSessions.userId, userId),
        isNull(s.workoutSessions.completedAt),
      ))
  }
```

- [ ] **Step 5: Run tests, confirm they pass**

Run: `pnpm vitest run lib/workout/__tests__/complete-workout.test.ts`
Expected: all PASS.

- [ ] **Step 6: Wire the client to send its real end time**

In `components/workout-screen.tsx`'s `completeWorkout` callback, add `completedAtMs:
endMs` to all three places the payload is sent — the primary POST body (line
993-997) and both `queueMutation` fallback payloads (lines 1002 and 1007):
```ts
    fetch("/api/complete-workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workoutSessionId: wsId, completedAtMs: endMs }),
    })
      .then((res) => {
        if (res.ok) {
          if (wsId) store_?.markSessionSynced(wsId).catch(() => {});
        } else if (wsId && userId) {
          store_?.queueMutation({ userId, domain: 'complete_workout', date: localDateString(), payload: { workoutSessionId: wsId, completedAtMs: endMs } }).catch(() => {});
        }
      })
      .catch(() => {
        if (wsId && userId) {
          store_?.queueMutation({ userId, domain: 'complete_workout', date: localDateString(), payload: { workoutSessionId: wsId, completedAtMs: endMs } }).catch(() => {});
        }
      });
```

- [ ] **Step 7: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 8: Verify first-write-wins against the local dev DB**

1. Complete a real workout through the app; confirm `workout_sessions.completed_at`
   is close to the actual wall-clock finish time (sanity check — should already be
   true today, this just confirms the payload change didn't break the happy path).
2. Directly exercise the replay guard (auth makes a plain `curl` replay awkward —
   easiest is a short one-off script run via `npx tsx`, importing
   `completeWorkoutFromPayload` directly against the local dev DB, since
   `DATABASE_URL` already points at the local Postgres instance in this
   environment):
```ts
import { completeWorkoutFromPayload } from './lib/workout/complete-workout'
const wsId = '<a completed session id>'
await completeWorkoutFromPayload('<test user id>', { workoutSessionId: wsId, completedAtMs: Date.now() })
```
   Run it twice with different `completedAtMs` values against the same already-completed
   session. Confirm via `SELECT completed_at FROM workout_sessions WHERE id = '<wsId>'`
   that the value does **not** change on the second call.

- [ ] **Step 9: Commit**

```bash
git add lib/workout/complete-workout.ts lib/workout/__tests__/complete-workout.test.ts lib/data/postgres/adapter.ts components/workout-screen.tsx
git commit -m "fix: record the workout's real end time instead of server-receipt time"
```

⚠️ **Not exercised:** a real offline-then-replay scenario on-device (Capacitor
outbox), and whether any other caller of `repo.completeWorkoutSession` exists beyond
`completeWorkoutFromPayload` (none found in this session's search — confirmed single
call site).

---

### Task 5: Use the robust median, not raw AVG, for the AI prompt's set-duration signal

**Files:**
- Modify: `lib/workout/time-audit.ts`
- Modify: `lib/__tests__/time-audit.test.ts`
- Modify: `lib/data/postgres/slices/periodization.ts`
- Modify: `lib/ai-periodization/signals.ts`

**Bug:** `getAvgSetDurationPerExercise` (`lib/data/postgres/slices/periodization.ts:289-311`)
computes `AVG(set_time_sec)` in raw SQL (line 294) with no outlier handling, then
feeds it to the AI prescription prompt as `avg_set_duration`
(`lib/ai-periodization/prompt.ts:141`, sourced via
`lib/ai-periodization/signals.ts:107,166`). The admin Time Audit's `robustStats`
(`lib/workout/time-audit.ts:61-73`) deliberately excludes a "timer left running"
6-minute set as a tracking error before computing anything — the exact same
`set_time_sec` column feeds both consumers with two contradictory filtering
policies, so one bad set inflates what the AI is told about how long this exercise
normally takes. Separately, `result[name] = row?.avgSec ?? 45` (line 308) means the
function always returns a number for every requested exercise, silently conflating
"no data" with "genuinely averages 45s" — the caller's own `?? 45`
(`lib/ai-periodization/signals.ts:166`) is already dead code because of this.

**Fix:** Extract a pure, testable grouping+robust-median helper into
`lib/workout/time-audit.ts` (next to `robustStats`, which it reuses) and have the
repository function fetch raw per-set rows instead of pre-aggregating in SQL, then
apply the shared robust-median logic in application code — one filtering policy,
one place, matching the "One Formula, One Place" rule.

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/time-audit.test.ts`:

```ts
import { /* existing imports */ robustAvgSetDurationsByExercise } from '@/lib/workout/time-audit'

describe('robustAvgSetDurationsByExercise', () => {
  it('returns the robust median per exercise, excluding a timer-left-running outlier', () => {
    const rows = [
      { exerciseName: 'Squat', setTimeSec: 58 },
      { exerciseName: 'Squat', setTimeSec: 60 },
      { exerciseName: 'Squat', setTimeSec: 62 },
      { exerciseName: 'Squat', setTimeSec: 360 }, // timer left running
      { exerciseName: 'Bench', setTimeSec: 40 },
    ]
    const out = robustAvgSetDurationsByExercise(rows)
    expect(out.Squat).toBeGreaterThanOrEqual(58)
    expect(out.Squat).toBeLessThanOrEqual(62)
    expect(out.Bench).toBe(40)
  })

  it('omits an exercise with no rows — callers decide the "no data" default themselves', () => {
    const out = robustAvgSetDurationsByExercise([{ exerciseName: 'Squat', setTimeSec: 50 }])
    expect(out).not.toHaveProperty('Deadlift')
  })
})
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: FAIL — `robustAvgSetDurationsByExercise` is not exported.

- [ ] **Step 3: Implement the pure helper**

In `lib/workout/time-audit.ts`, add after `robustStats`:

```ts
// Per-exercise average set duration for planning consumers (the AI prescription
// prompt today; the future time-budget feature) — reuses the exact same
// outlier-exclusion policy as the admin Time Audit (robustStats) instead of a raw
// AVG, so "timer left running" outliers can't inflate what a consumer is told this
// exercise normally takes. Omits an exercise with no rows entirely; the caller
// decides its own no-data default.
export function robustAvgSetDurationsByExercise(
  rows: { exerciseName: string; setTimeSec: number }[],
): Record<string, number> {
  const byName = new Map<string, number[]>()
  for (const r of rows) {
    const arr = byName.get(r.exerciseName) ?? []
    arr.push(r.setTimeSec)
    byName.set(r.exerciseName, arr)
  }
  const result: Record<string, number> = {}
  for (const [name, times] of byName) {
    const m = robustStats(times).median
    if (m != null) result[name] = m
  }
  return result
}
```

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire it into the repository function**

In `lib/data/postgres/slices/periodization.ts`, replace `getAvgSetDurationPerExercise`
(lines 289-311):
```ts
export async function getAvgSetDurationPerExercise(db: Db, userId: string, exerciseNames: string[]): Promise<Record<string, number>> {
  if (exerciseNames.length === 0) return {}
  const rows = await db
    .select({
      exerciseName: s.exerciseLogs.exerciseName,
      setTimeSec: s.setLogs.setTimeSec,
    })
    .from(s.setLogs)
    .innerJoin(s.exerciseLogs, eq(s.setLogs.exerciseLogId, s.exerciseLogs.id))
    .innerJoin(s.workoutSessions, eq(s.exerciseLogs.workoutSessionId, s.workoutSessions.id))
    .where(and(
      eq(s.workoutSessions.userId, userId),
      inArray(s.exerciseLogs.exerciseName, exerciseNames),
      isNotNull(s.setLogs.setTimeSec),
    ))
  const medians = robustAvgSetDurationsByExercise(
    rows.filter((r): r is { exerciseName: string; setTimeSec: number } => r.setTimeSec != null),
  )
  const result: Record<string, number> = {}
  for (const name of exerciseNames) {
    result[name] = medians[name] ?? 45
  }
  return result
}
```
(Add `robustAvgSetDurationsByExercise` to the `@/lib/workout/time-audit` import at
the top of the file; the `isNotNull` filter is now technically redundant with the
`.filter()` above but kept — cheaper to filter rows out in SQL than ship them over
the wire.)

- [ ] **Step 6: Drop the now-dead duplicate default**

In `lib/ai-periodization/signals.ts` line 166, `avgSetDurations[ex.exerciseName] ??
45` is unreachable now that the repository function guarantees every requested name
is present — leave the `?? 45` as defensive belt-and-suspenders only if there's a
reason to distrust the repo contract; otherwise simplify to
`avgSetDurations[ex.exerciseName]`. (Low-risk either way — note the choice made in
the commit message rather than agonizing over it.)

- [ ] **Step 7: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 8: Manual verification against the local dev DB**

No test infra exists for `lib/data/postgres/slices/periodization.ts` (DB-dependent,
confirmed no `__tests__` directory under `slices/`). At minimum, call
`getAvgSetDurationPerExercise` for a seeded exercise with several logged sets
(directly via a `psql` cross-check of the median vs. the old `AVG`, or a quick
`npx tsx` script against the local dev DB) and confirm the returned value is
sensible and, if an outlier set exists in the seed data, that it's excluded from the
result the way it would be excluded from the admin Time Audit's own numbers for the
same exercise.

- [ ] **Step 9: Commit**

```bash
git add lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts lib/data/postgres/slices/periodization.ts lib/ai-periodization/signals.ts
git commit -m "fix: feed the AI prompt a robust median set duration instead of raw AVG"
```

⚠️ **Not exercised:** a real Gemini prescription round-trip with this changed signal
(no API key / no live call in this sandbox) — this only changes what number is
computed and handed to the prompt, not the prompt-building or response-parsing code
around it.

---

### Task 6: Fix the stranded-workout rebuild path's timing omissions and zero-fill

**Files:**
- Modify: `lib/local-store/sync-helpers.ts`
- Modify: `lib/local-store/__tests__/sync-helpers.test.ts`

**Bug:** `buildWorkoutLogPayload` (`lib/local-store/sync-helpers.ts:53-86`, invoked
by the stranded-workout sweep in `pushMutations`,
`lib/local-store/sync-engine.ts:448`) rebuilds a `LogExercisePayload`-shaped mutation
from local rows for a workout that's `pending` locally with no outbox entry. Two
problems:
1. It never includes `setStartTimes`/`setEndTimes` at all, even though the local
   `set_logs` table already stores `set_start_ms`/`set_end_ms` per set
   (`LocalSetLog`, `lib/local-store/types.ts:71-86`; written by `logWorkoutLocally`,
   `lib/local-store/sqlite-backend.ts:244-330`) — the data exists locally, the
   rebuild just doesn't read it.
2. `setTimes`/`restTimes` are gated on `.some(s => s.setTimeSec != null)` (lines 74-75)
   — "at least one set has a value" — then zero-fill every set that doesn't:
   `sets.map(s => s.setTimeSec ?? 0)`. Because `logExerciseAndSets` upserts with an
   unconditional `EXCLUDED` overwrite keyed on `set_logs.id`
   (`lib/data/postgres/adapter.ts:836-851`), replaying this rebuilt payload against a
   server row that already has good timing **overwrites it with `0`** for any set
   that happens to be missing a local value. `rpeValues` already avoids this exact
   trap via an `everySetHasRpe` (`.every()`, not `.some()`) gate on line 58 — the
   other three fields just never got the same treatment.

**Fix:** Add `setStartTimes`/`setEndTimes`, and change the `setTimes`/`restTimes`
gates from `.some()` to `.every()` (matching the existing `everySetHasRpe` pattern) —
so a partially-null array is omitted entirely rather than zero-filling the gaps.

⚠️ **Scoped out of this task, flagged explicitly:** `warmupEndedAtMs` is also named
in the review as omitted from the rebuild, but it genuinely **cannot** be included
without a schema change — `LocalWorkoutSession` (`lib/local-store/types.ts:41-50`)
has no `warmupEndedAt`/`warmup_ended_at` field at all; it was never added to the
local SQLite schema when `warmup_ended_at` shipped server-side (Postgres migration
108). Adding it would need a new local SQLite migration plus `RECONCILE_TABLES`/
`RECONCILE_COLUMNS` registration per the CLAUDE.md Local SQLite Migrations rules —
a bigger, separate change. Leave it as a documented follow-up backlog item rather
than folding a schema migration into this bug-fix task.

- [ ] **Step 1: Write the failing tests**

Add to `lib/local-store/__tests__/sync-helpers.test.ts`, inside the existing
`describe('buildWorkoutLogPayload', ...)` (reuse the existing `session`/`exerciseLog`
fixtures, adding a variant):

```ts
  it('includes setStartTimes/setEndTimes when every set has them', () => {
    const withTimes = {
      ...exerciseLog,
      sets: exerciseLog.sets.map(s => ({ ...s, setStartMs: 1000 + s.setNumber, setEndMs: 2000 + s.setNumber })),
    }
    const { payload } = buildWorkoutLogPayload(session, withTimes)
    expect(payload.setStartTimes).toEqual([1001, 1002]) // set order: setNumber 1, 2
    expect(payload.setEndTimes).toEqual([2001, 2002])
  })

  it('omits setTimes/restTimes entirely when only some sets have a value, instead of zero-filling', () => {
    const partial = {
      ...exerciseLog,
      sets: [
        { ...exerciseLog.sets[0], setTimeSec: null, restTimeSec: null },
        exerciseLog.sets[1],
      ],
    }
    const { payload } = buildWorkoutLogPayload(session, partial)
    expect(payload.setTimes).toBeUndefined()
    expect(payload.restTimes).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts`
Expected: the first new test FAILs (`setStartTimes`/`setEndTimes` are `undefined` —
not built at all today); the second test currently **passes by accident** on the
existing fixture only because both sets already have values — verify by temporarily
checking the pre-fix `.some()` behavior produces `[0, <realValue>]` rather than
`undefined` with the partial fixture (confirms the test is actually exercising the
bug, not a false negative).

- [ ] **Step 3: Implement the fix**

In `lib/local-store/sync-helpers.ts`, `buildWorkoutLogPayload`, replace:
```ts
  const everySetHasRpe = sets.length > 0 && sets.every(s => s.rpe != null)
  return {
    date: el.loggedAt.slice(0, 10),
    payload: {
      // ...
      ...(sets.some(s => s.setTimeSec != null)  ? { setTimes:  sets.map(s => s.setTimeSec ?? 0) }  : {}),
      ...(sets.some(s => s.restTimeSec != null) ? { restTimes: sets.map(s => s.restTimeSec ?? 0) } : {}),
      ...(everySetHasRpe ? { rpeValues: sets.map(s => s.rpe!) } : {}),
      // ...
    },
  }
```
with:
```ts
  const everySetHasSetTimes   = sets.length > 0 && sets.every(s => s.setTimeSec != null)
  const everySetHasRestTimes  = sets.length > 0 && sets.every(s => s.restTimeSec != null)
  const everySetHasStartTimes = sets.length > 0 && sets.every(s => s.setStartMs != null)
  const everySetHasEndTimes   = sets.length > 0 && sets.every(s => s.setEndMs != null)
  const everySetHasRpe        = sets.length > 0 && sets.every(s => s.rpe != null)
  return {
    date: el.loggedAt.slice(0, 10),
    payload: {
      // ...
      ...(everySetHasSetTimes   ? { setTimes:      sets.map(s => s.setTimeSec!) }  : {}),
      ...(everySetHasRestTimes  ? { restTimes:     sets.map(s => s.restTimeSec!) } : {}),
      ...(everySetHasStartTimes ? { setStartTimes: sets.map(s => s.setStartMs!) }  : {}),
      ...(everySetHasEndTimes   ? { setEndTimes:   sets.map(s => s.setEndMs!) }    : {}),
      ...(everySetHasRpe        ? { rpeValues:     sets.map(s => s.rpe!) }         : {}),
      // ...
    },
  }
```
(Keep every other field in the returned object exactly as it is today — only these
five lines change.)

- [ ] **Step 4: Run tests, confirm they pass**

Run: `pnpm vitest run lib/local-store/__tests__/sync-helpers.test.ts`
Expected: all PASS, including the pre-existing test (both its sets have
`setTimeSec`/`restTimeSec` populated, so `.every()` behaves identically to `.some()`
for that fixture — no regression).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 6: Manual verification of the rebuild path**

This path only runs for a workout stranded `pending` with no outbox entry (a double
failure — POST failed AND `queueMutation` failed), which is hard to trigger
organically. At minimum:
1. Confirm `logExerciseFromPayload` (`lib/workout/log-exercise.ts`) still accepts a
   payload built by the new `buildWorkoutLogPayload` output shape without error —
   run the existing `sync-helpers.test.ts` fixture's payload through
   `LogExercisePayloadSchema.safeParse` in a quick scratch check and confirm it
   validates.
2. If feasible, force the stranded path (e.g. temporarily throw inside the local
   store's `queueMutation` after a `logWorkoutLocally` write, or call
   `getStrandedPendingWorkouts`/`buildWorkoutLogPayload` directly against a real
   local-store row from a logged exercise) and confirm the rebuilt payload contains
   `setStartTimes`/`setEndTimes` matching what's in the local `set_logs` table.

- [ ] **Step 7: Commit**

```bash
git add lib/local-store/sync-helpers.ts lib/local-store/__tests__/sync-helpers.test.ts
git commit -m "fix: stop the stranded-workout rebuild from zero-filling partial timing data"
```

⚠️ **Not exercised:** the stranded-workout sweep actually firing on a real device
(Capacitor SQLite outbox, a genuine double-failure network condition) and the
`warmupEndedAtMs` gap noted above, deliberately left unfixed pending a local SQLite
schema change.

---

## Not exercised by this plan as a whole

Native/on-device surfaces (Capacitor SQLite outbox, real backgrounding, Samsung
WebView rendering of the superset hand-off), a real Gemini prescription round-trip
for Task 5's changed signal, and whether the Turbopack `/api/log-exercise` dev-mode
500 documented in the backlog review (§8) is still live in this sandbox — if it is,
every "verify on the local dev server" step in this plan needs a production build
(`next build && next start`) instead to get a real write to check against.
