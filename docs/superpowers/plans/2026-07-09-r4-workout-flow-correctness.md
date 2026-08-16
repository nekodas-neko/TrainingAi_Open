# R4 — Workout-Flow Correctness

**Source review:** `docs/reviews/2026-07-06-full-app-overview-review.md` §5 (batch R4), verified
against current `main` on 2026-07-09 (the workout screen has had render-store-discipline and
timing work land since the review — all line numbers below are re-confirmed against current
code). **Branch:** `fix/workout-flow-correctness`.

Almost all of this is **server/JS + client work** — it ships via Railway into the WebView with
no APK rebuild. But the highest-value fixes (Chunk 1) touch `components/workout-screen.tsx`, the
~1,280-line orchestrator that holds all workout state/refs/callbacks and carries real regression
risk. **The merge gate is a `pnpm dev` exercise of the full workout flow** — single-exercise
session, a superset with unequal set counts, a baseline (AMRAP) session, and a double-tap on
Log/Complete. Three items are **device-only** verifiable (persisted-store rollover WK-13, the
per-set-weight timer clobber WK-7, and the superset rest-ring beep WK-3 rely on real timer/store
behaviour) — mark them NOT-verified-on-device in the journal if no S25 is available in-session.

**Goal:** stop the workout flow from silently losing completions, orphaning superset sets,
double-writing logs, and persisting stale 1RMs/recaps — the data-integrity failures §5 found in
the orchestrator and its write/recap/history paths.

> **Cross-references (do NOT re-plan here):**
> - **WK-5 = CACHE-F2** — the log-exercise ad-hoc `invalidateCache()` list (`workout-screen.tsx:852-857`)
>   and solo-relog staleness. **R2 owns** creating the `invalidateExerciseLogged(sessionId, exerciseName)`
>   group in `lib/cache-groups.ts`. This plan's Chunk 4 only swaps the call site once that group exists.
> - **WK-10 = CACHE-F9 + CACHE-F15** — `exercise-history:` fetched at divergent TTLs
>   (`exercise-summary-screen.tsx:47` `TTL_SHORT` vs `active-workout-screen.tsx:117` `TTL_MEDIUM`;
>   canonical `EXERCISE_HISTORY_TTL` = `TTL_MEDIUM` already exists in `lib/cache-ttl.ts:19`) and the
>   `day-review-sheet` bare fetch. **R2 owns** the TTL/bare-fetch sweep.
> - **WK-17 = SEC-H5** — no Zod on `workout-entry` PATCH/DELETE (`route.ts:24,111`) and the new
>   `workout-sessions` DELETE (`route.ts:7`). **R1 owns** the schema fix.

---

## Chunk 1 — Data-loss highs (own small commits) — WK-1, WK-2, WK-4

**Governing rules:** *Zustand Persisted Store* (read transient/session identity via `getState()`,
not a stale closure), *Saves feel instant → in-flight guard on submit/complete* (session-86: 5
taps fired 4 POSTs), *Offline Sync — every user-visible write needs an outbox domain*.

**Land WK-1 and WK-4 as their own separate commits** — they touch the highest-regression-risk file
and each is independently reviewable/revertable.

### Task 1 — WK-1: `advance()` stale closure loses single-exercise completions + calendar payload

`advance` (`workout-screen.tsx:531-584`) is memoized on `[store.currentIdx, effectiveExercises,
store.soloMode]`. For a **one-exercise session** none of those change between mount (where
`workoutSessionId === ''`, `workoutStartMs === null`, `sessionLog === []`) and the final Next tap, so
`advance` never recreates — it closes over the render-0 copies of `store`, `completeWorkout`
(memoized on `[store.workoutSessionId, …]`, `:1058`) and `handleAddToCalendar` (memoized on
`[sessionType, store.workoutEndMs, store.workoutStartMs]`, `:988`). Two failures result at
`:569-582` (the final-exercise `else` branch):

1. `completeWorkout()` (`:573`) runs the render-0 closure whose `const wsId = store.workoutSessionId`
   (`:1022`) is `''` → `POST /api/complete-workout` with `workoutSessionId: ''` (fails the route's
   `.uuid()` Zod) **and** the outbox fallback is skipped by `if (wsId && userId)` (`:1037,1042`) →
   completion silently lost: no `completed_at`, no phase increment, no prescription consume.
2. `const snapLog = [...store.sessionLog]` (`:572`) reads the **stale** render-0 `sessionLog` (`[]`),
   so `handleAddToCalendar(snapLog)` (`:580`) early-returns on `if (!log.length) return` (`:962`) —
   no calendar event, and even when non-empty the stale `workoutStartMs`/`workoutEndMs` give a bogus
   ~1-min duration.

**Note:** the pre-workout "Complete Workout" button (`:1129-1141`) is an *inline* render callback
reading fresh `store`/`completeWorkout` — it is NOT affected. Only the `advance()` (post-summary
Next) path is broken.

**Fix — read session identity and log fresh via `getState()` inside `advance`'s final branch:**

```ts
} else {
  if (isCompletingRef.current) return;
  isCompletingRef.current = true;
  const snapLog = [...useWorkoutStore.getState().sessionLog]; // fresh, not the stale closure
  completeWorkout();
  const xpBefore = xpBeforeWorkout.current ?? 0;
  fetch('/api/achievements')
    .then(r => r.ok ? r.json() : null)
    .then((d: { xp?: number } | null) => { if (d?.xp != null) setXpEarned(Math.max(0, d.xp - xpBefore)); })
    .catch(() => {});
  hapticSuccess();
  handleAddToCalendar(snapLog);
  store.setMode("done");
}
```

And make `completeWorkout` read the live session id regardless of which closure invoked it — change
`const wsId = store.workoutSessionId;` (`:1022`) to:

```ts
const wsId = useWorkoutStore.getState().workoutSessionId;
```

Do the same for `handleAddToCalendar`'s timestamps — replace `store.workoutEndMs`/`store.workoutStartMs`
(`:964-965`) reads with `useWorkoutStore.getState()`. This makes both callbacks robust to being
called from a stale-memoized parent, which is the root class. (Alternatively add `completeWorkout`,
`handleAddToCalendar` to `advance`'s dep array — but `getState()` inside the callbacks is the
lower-blast-radius fix and matches the existing `restoreExercise`/`perSetWeights` pattern already used
throughout this file at `:449,541,703,736,800`.)

**Verify:** `pnpm dev`, program with a **single-exercise** session → Start → log the one exercise →
Complete → Next. Confirm: `workout_sessions.completed_at` is set (query the local dev DB), the done
screen shows, XP/PR/calendar populate, and `sessions_in_phase` advanced. Repeat with a 3-exercise
session (must still complete correctly). Confirm the pre-workout Complete-Workout button path is
unchanged.

### Task 2 — WK-2: supersets with unequal set counts orphan the tail

`handleLogCurrentSet` (`:690-720`) only consults the sequence for a handoff when the *current*
exercise still has sets left — `if (completedSetIndex + 1 < store.sets)` (`:713`). `buildSetSequence`
(`lib/workout/superset-order.ts:7-34`) is correct and DOES emit the longer partner's tail sets after
the shorter member is exhausted, but the consumer never asks for them: once the shorter member logs
its last set (`completedSetIndex + 1 === store.sets`), `handleCompleteSet` fires, commits that
exercise's summary, and `advance()` proceeds — the longer partner's stashed `exerciseBuffers` entry
(with its remaining sets) is silently abandoned.

**Fix — consult `nextStep` on the current exercise's last set too, and hand off if the sequence
still points at another (grouped) exercise with unfinished sets.** Replace the guarded block at
`:711-718`:

```ts
// After logging this set, check whether the superset sequence hands the next set to a
// different (grouped) exercise — this must run even on THIS exercise's last set, or the
// longer partner's remaining sets are orphaned when the shorter member finishes first.
const step = nextStep(sequence, { exerciseIndex: store.currentIdx, setIndex: completedSetIndex });
if (step && step.exerciseIndex !== store.currentIdx) {
  switchToExercise(step.exerciseIndex);
} else if (completedSetIndex + 1 >= store.sets) {
  // this exercise is done AND the sequence has no next grouped set for it — but an EARLIER
  // group member may still hold stashed sets (its own sequence turns already passed while it
  // was inactive). Resume the lowest-index buffered exercise before letting advance() finish.
  const buffers = useWorkoutStore.getState().exerciseBuffers;
  const pending = Object.keys(buffers).map(Number).sort((a, b) => a - b)[0];
  if (pending != null) switchToExercise(pending);
}
```

Note `nextStep` returns `null` at the end of the whole sequence — the `else if` fallback covers the
case where the shorter member finishes and the sequence's remaining steps all belong to a partner
whose buffer is stashed. `switchToExercise` (`:658-688`) already stashes the current exercise and
restores the target's WIP, so an orphaned tail resumes at its correct set. When no buffer remains,
neither branch fires and `handleCompleteSet` → `advance()` completes normally.

**Verify:** `pnpm dev`, build a program with two exercises in the same `supersetGroup`, one with 3
sets and one with 4. Run the superset: confirm the alternation is A1,B1,A2,B2,A3,B3,B4 (or the
inverse) and that the 4th set of the longer exercise is reached and logged — no exercise finishes
with an un-logged buffered set. Cross-check `set_logs` in the dev DB: both exercises have their full
set counts.

### Task 3 — WK-4: no in-flight guard on `handleCompleteSet` / `handleLogCurrentSet`

Neither `handleCompleteSet` (`:722-883`) nor `handleLogCurrentSet` (`:690-720`) guards against a
double-fire. A double tap mints a fresh `clientExerciseLogId`/`clientSetLogIds` on each call
(`:773-774`), so the server's replay-detection SELECT can't dedupe them → two `exercise_logs`, doubled
`user_stats.total_sessions/volume/sets`. CLAUDE.md mandates this guard (session-86: 5 rapid taps once
fired 4 `complete-workout` POSTs). `isCompletingRef` (`:182`) is the reference.

**Fix — add an `isLoggingRef` and gate both handlers, resetting after the state transition:**

```ts
const isLoggingRef = useRef(false); // near isCompletingRef at :182
```

At the top of `handleCompleteSet` (after the `if (!ex || store.currentSet < store.sets) return;`
guard at `:724`):

```ts
if (isLoggingRef.current) return;
isLoggingRef.current = true;
```

`handleCompleteSet` ends by calling `store.commitExerciseSummary(...)` which flips `mode` to
`exercise-summary` (`:866`) — reset the ref in the same tick after that call, and also in a
`useEffect` on `store.mode` so a re-entry after the mode flip is impossible:

```ts
// after commitExerciseSummary(...)
isLoggingRef.current = false;
```

For `handleLogCurrentSet` add the same guard at its top (after `:691`), resetting it at the end after
`store.setWorkoutPhase("rest")` / the optional `switchToExercise` — a per-set log completes
synchronously, so a plain set/reset around the body suffices. Since these two handlers can interleave
(log last set → complete), use **one shared** `isLoggingRef` so a Log tap immediately followed by a
Complete tap can't both fire mid-transition; reset it only once the terminal state (`rest` phase or
`exercise-summary` mode) is committed.

**Verify:** `pnpm dev`, rapidly double/triple-tap "Log Set" and "Complete →". Confirm exactly one
`exercise_logs` row per exercise and `user_stats` increments once. Check the PiP `onLog` path
(`:943-957`) also can't double-fire (it routes through the same guarded handlers).

---

## Chunk 2 — Superset & rest-timer fidelity — WK-3, WK-7, WK-8

**Governing rules:** *Zustand Persisted Store — reset-on-mount effects depend only on identity keys*,
*Mobile Perf — timers tick in a leaf reading refs*, *One Formula One Place* (the rest duration has one
superset-aware source, `store.lastSetRestSec`).

### Task 1 — WK-3: rest ring shows the wrong duration after a superset handoff

`active-workout-screen.tsx:155` derives the visible rest countdown from the **currently active**
exercise's style: `const currentRestSec = exercise?.progressionStyle?.[currentSet - 1]?.restSec ?? 90`.
But after a superset handoff `currentIdx` already points at the *other* group member, so `exercise`
and `currentSet` describe the wrong set. The beep (`workout-screen.tsx:346` `currentRestSec =
store.lastSetRestSec`), the OS notification (`:359`), and `PipView` (`:1223` is passed
`store.lastSetRestSec`) all correctly use `lastSetRestSec` — set from the just-logged set's own
`restSec` at `handleLogCurrentSet:706`. Only the on-screen ring disagrees.

**Fix — thread `lastSetRestSec` into `ActiveWorkoutScreen` and use it for the ring.** Add a prop:

```ts
// ActiveWorkoutScreenProps
restSecOverride?: number; // superset-aware rest duration (store.lastSetRestSec)
```

Pass it from the orchestrator (`workout-screen.tsx:1231-1261` render):

```tsx
<ActiveWorkoutScreen
  ...
  restSecOverride={store.lastSetRestSec}
/>
```

In `active-workout-screen.tsx`, prefer the override when it is a positive number (it's 0 before any
set is logged, in which case the style-derived value is the right ready-state default):

```ts
const styleRestSec = exercise?.progressionStyle?.[currentSet - 1]?.restSec ?? 90;
const currentRestSec = restSecOverride && restSecOverride > 0 ? restSecOverride : styleRestSec;
```

**Verify (device-preferred — timer behaviour):** superset with different `restSec` per member. After a
handoff, confirm the ring's total (`of {currentRestSec}s`, `:703`) matches when the beep fires — no
visual/audio mismatch. On web, confirm the non-superset path still shows each set's own rest.

### Task 2 — WK-7: per-set-weight init effect clobbers mid-set dial edits

The init effect at `:415-439` has deps `[store.currentIdx, effectiveExercises]` and **no
`timerStarted`/mode guard**. Any `setExercises` that changes `effectiveExercises` mid-set — a late
network fetch, the injury swap (`:596-618`), or a deload toggle — recomputes `perSetWeights` from
scratch, wiping the lifter's manual dial edits for the sets already staged. The sibling effect at
`:512-529` already guards with `if (store.mode !== "active" || store.timerStarted) return`.

**Fix — add the same guard, but preserve the injury-swap recompute** (which legitimately needs fresh
weights when `estimated1rm`/`equipment`/`exerciseType` change). Two parts:

1. Guard the init effect so it doesn't fire once the timer is running:

```ts
useEffect(() => {
  if (skipPerSetWeightsInitRef.current) { skipPerSetWeightsInitRef.current = false; return; }
  // Don't recompute once the user is mid-exercise — a late fetch/swap/deload toggle would
  // otherwise blow away staged manual dial edits. Fresh-init only happens pre-timer.
  if (store.timerStarted) return;
  const ex = effectiveExercises[store.currentIdx];
  ...
}, [store.currentIdx, effectiveExercises]);
```

2. `handleInjurySwap` (`:589-621`) currently relies on this effect refiring to recompute weights for
   the swapped exercise. With the guard added, make the recompute explicit — after the
   `est1rm`-resolving `setExercises` (`:618`), recompute `perSetWeights` for the swapped index if it's
   the active exercise and the timer is running (a swap can happen mid-exercise). Reuse the same weight
   derivation as `launchExercise:487-501` (extract it to a local helper
   `computeInitialWeights(ex, ds)` to satisfy One Formula One Place, since it now lives in three
   places — the init effect, `launchExercise`, and the swap path).

**Verify (device-preferred):** stage a set, manually dial the weight up, then trigger a late
`effectiveExercises` change (toggle a deload revert on the pre-workout screen before starting, or
force a slow network refetch) — the staged weight must survive. Then injury-swap an exercise mid-session
and confirm the new exercise loads correct target weights.

### Task 3 — WK-8: `skipPerSetWeightsInitRef` poisoning on same-index restore

`skipPerSetWeightsInitRef` is set `true` before a `setCurrentIdx` in three restore paths —
`launchExercise:451`, `advance:543`, `switchToExercise:663` — and consumed/reset by the init effect at
`:419`. But the effect only fires when `currentIdx` (or `effectiveExercises`) actually changes. When
"Continue Workout" restores an exercise that is **already** the current `currentIdx` (e.g. resuming the
same solo exercise), `setCurrentIdx(idx)` is a no-op, the effect never fires, and the ref stays `true`
— poisoning the *next* legitimate init, which is then silently skipped once.

**Fix — reset the ref defensively in the restore callers when the target index equals the current
index** (the effect won't run to clear it). In `launchExercise` (`:448-457`), after the restore check:

```ts
if (restored) {
  // If we're restoring the SAME index the effect won't re-fire to clear the skip flag —
  // clear it inline so the next real index change isn't skipped.
  if (idx === useWorkoutStore.getState().currentIdx) skipPerSetWeightsInitRef.current = false;
  else skipPerSetWeightsInitRef.current = true;
  ...
}
```

Apply the same same-index check in `advance` (`:541-543`) and `switchToExercise` (`:661-663`). (Since
`advance` always moves to `currentIdx + 1` it can't hit the same-index case, but the guard is
harmless and keeps the three paths uniform.)

**Verify (device-preferred):** start a solo exercise, log a set, leave to pre, "Continue Workout" back
into the same exercise (same index), then move to a different exercise — its per-set weights must
initialise correctly (not stay blank/stale).

---

## Chunk 3 — 1RM & PR correctness — WK-6, WK-12

**Governing rules:** *One Formula, One Place* (client and server must produce the same 1RM),
*Stored Counters / write-path ownership* (a reconcile must honour the same PR gate the log path used).

### Task 1 — WK-6: client/server 1RM divergence in baseline (AMRAP) phase

`handleCompleteSet` (`workout-screen.tsx:749-758`) picks the estimator by `exerciseType` only:
bodyweight → `estimateOneRm(..., { exerciseType: "bodyweight", style })`, else `calculate1RM(...)`.
It never passes `isBaseline`. The server (`lib/workout/log-exercise.ts:163-168`) sets
`const isBaseline = currentPhaseType === 'baseline'` and calls
`estimateOneRm(..., { exerciseType, style, isBaseline })`, which for a baseline **weighted** exercise
routes to `amrapAverage1Rm` (`lib/1rm.ts:155-158`) instead of `calculate1RM`. So the number the
summary/toast celebrates (`newEst1rm`, used in the optimistic PR check and `commitExerciseSummary`)
diverges from the AMRAP-scaled value the server stores.

**Fix — use the single `estimateOneRm` entry point client-side with `isBaseline` threaded through**
(the orchestrator already knows the phase via `phaseStatus?.isBaseline`, passed to `ActiveWorkoutScreen`
as `isBaseline` at `:1257`). Replace the branch at `:749-758`:

```ts
const isBaseline = phaseStatus?.isBaseline ?? false;
const { estimated1rm: newEst1rm, target80 } = estimateOneRm(
  snapWeights.map((w, i) => ({ weightKg: w, reps: snapReps[i] ?? 0 })),
  { exerciseType: ex.exerciseType === "bodyweight" ? "bodyweight" : "weighted", style: ex.progressionStyle, isBaseline },
);
```

This collapses both arms into the one shared estimator (`estimateOneRm` already handles the bodyweight
`BW_REF` offset internally, `lib/1rm.ts:151`), so the summary matches the stored value for weighted,
bodyweight, and baseline alike. `calculate1RM` is no longer needed in this file — drop the import if
unused elsewhere in the file.

**Related — optimistic PR check must mirror `shouldCountTowardPr`.** The optimistic PR toast at
`:817-825` gates on `if (newEst1rm > 0 && !aiDeload && !ex.deloaded)` but does not exclude an
active session-level deload. The server's `shouldCountTowardPr` (`log-exercise.ts:53-62`) excludes
`isAnyDeload` unless baseline. Add the session-deload exclusion so the client doesn't flash a PR the
server will reject:

```ts
const isAnyDeload = aiDeload || (phaseStatus?.isDeloadActive ?? false);
if (newEst1rm > 0 && (!isAnyDeload || isBaseline) && !ex.deloaded) {
  store_.getPersonalRecord(ex.name).then((prevPR) => { ... });
}
```

**Verify:** `pnpm dev`, run a baseline/AMRAP session on a weighted exercise. Log a high-rep AMRAP set,
note the summary's 1RM, then read `exercise_logs.estimated_1rm` / `personal_records.estimated_1rm` in
the dev DB — they must match (previously the summary was Epley/Brzycki-inflated while the stored value
was AMRAP-scaled). Confirm a session marked deload does not flash a "new PR".

### Task 2 — WK-12: `reconcilePersonalRecord` can't honour the per-exercise deload gate

`reconcilePersonalRecord` (`adapter.ts:2381-2410`) recomputes the all-time best 1RM after an
edit/delete, gating on **session-level** flags only — `workoutSessions.phaseType` and
`isEarlyDeload` (`:2393-2399`). It has no per-exercise deload gate because `exerciseDeloaded` is
**never persisted** on `exercise_logs` (`schema.ts:163-190` — the only `intensity_mode` column is on
`workout_sessions:157`). At log time `shouldCountTowardPr` excludes a per-exercise-deloaded set via the
`exerciseDeloaded` payload field, but that fact is lost after the write, so a later reconcile can
promote a 1RM the log path had correctly rejected.

**Fix (schema + write + reconcile, one PR):**
1. **Migration 118** (on-disk max is 115; 116 is pre-allocated by the Oura Phase-5 plan
   `oura_daily_summary`, 117 by the R3 offline-first plan's workout tombstones — claim **118** here;
   re-confirm against the directory + open plans at implementation time): add
   `exercise_deloaded BOOLEAN NOT NULL DEFAULT false` to `exercise_logs`; register it in
   `RECONCILE_COLUMNS` in the same commit (local SQLite mirror parity is not required here — this
   column is server-side PR-gating only, but confirm the sync chain doesn't need it before skipping).
2. **Persist it** in `logExerciseAndSets` (`adapter.ts` — the `exerciseLog` insert) from the
   `exerciseDeloaded` value already flowing through `logExerciseFromPayload` (`log-exercise.ts:82,212`).
   Add `exerciseDeloaded` to the `logExerciseAndSets` args and the insert column list, and update the
   `rowToExerciseLog`/SELECT mappers (CLAUDE.md: a missed mapper field fails silently as "save doesn't
   persist").
3. **Gate the reconcile query** — add `eq(s.exerciseLogs.exerciseDeloaded, false)` to the `where`
   clause at `:2386-2400`, alongside the existing session-deload gate, so a per-exercise-deloaded log
   can never win the `orderBy(desc(estimated1rm))` pick.

**Verify:** `pnpm dev`, log an exercise flagged `exerciseDeloaded` at a high weight (via the deload
path), confirm it does NOT set a PR (unchanged). Then edit an *earlier* non-deload log for that
exercise and confirm the reconcile does not resurrect the deloaded log's inflated 1RM as the PR.
Check `personal_records` in the dev DB.

---

## Chunk 4 — Recap / history invalidation & continuity — WK-9, WK-11, WK-5 call-site swap

**Governing rules:** *Cache Invalidation — writes go through cache groups; never rely on TTL to
surface fresh data after a write*, *Session identity = DB id, not name*, *New aggregate GET routes ship
SWR headers at creation*.

### Task 1 — WK-9: session recap cached forever, never invalidated on edit

`GET /api/workout-sessions/[id]/recap` caches its generated recap in `ai_health_insights` under
`session-recap:${sessionId}` (`route.ts:26-31`, written at `:87`). The `workout-entry` PATCH rewrites
weights/reps/1RM/PRs (`route.ts:19-103`) and DELETE removes logs (`:105-187`), but neither clears the
cached recap — so the recap describes the *pre-edit* session permanently.

**Fix — delete the cached insight when the underlying session changes.** There is no
`deleteAiHealthInsight` repo method today (only `get`/`upsert`, `repository.ts:510-511`) — add one:

```ts
// repository interface
deleteAiHealthInsight(userId: string, section: string): Promise<void>
```

Implement it in the adapter as a user-scoped delete on `(user_id, section)` (the section already
encodes the session id: `session-recap:<workoutSessionId>`). Then call it from `workout-entry`:

- **PATCH:** the context query at `:38-43` selects `el.exercise_name, el.style_id, ws.phase_type` — add
  `el.workout_session_id` to it, then after the successful COMMIT (`:93-95`) call
  `repo.deleteAiHealthInsight(userId, \`session-recap:${workoutSessionId}\`)`.
- **DELETE:** `workoutSessionId` is already captured at `:134` — call the same delete after the COMMIT
  at `:174` (skip if the whole session was deleted, since its recap section is orphaned harmlessly, but
  deleting it is cheap hygiene).

`daily-digest` has the same class (NUT-7) — out of scope here; note it in R5, do not fold in.

**Verify:** `pnpm dev`, open a completed session's recap (populates the cache), edit one of its
exercise's weights via the day-review/history edit sheet, reopen the recap — it must regenerate against
the new numbers (confirm the `ai_health_insights` row for that `session-recap:` section was deleted).

### Task 2 — WK-11: `workout-load-history` matches by session **name**, not id

`GET /api/workout-load-history` filters candidate sessions with `ws.sessionName === sessionName`
(`route.ts:21`) — a string match that breaks continuity the moment a session is renamed, violating
"session identity = DB id". The recap route does this correctly via
`getRecentSessionsOfType(userId, workoutSession.sessionId, …)`. This route also ships **no SWR headers**
(CACHE-F16) and its consumer (`day-review-sheet.tsx`) uses a bare `fetch` (CACHE-F15) inside a bottom
sheet that also has a stray `pb-safe` (UI-M1).

**Fix (the sessionName→sessionId matching is owned here; the header/fetch/pb-safe items cross-ref
R2/R7 — note them, don't double-fix):**
1. Accept a `sessionId` query param (keep `sessionName` as a fallback for old callers), resolve the
   caller's program session, and filter matching sessions by `ws.sessionId === sessionId` instead of by
   name. If `getWorkoutSessionsFrom` rows carry `sessionId`, filter on it directly; otherwise add a
   `sessionId`-scoped repo query mirroring `getRecentSessionsOfType`. Fall back to the name match only
   when the caller supplied no id (backward compat), same shape as `workout-data`'s
   id-first-then-name resolution (`workout-data/route.ts:130-132`).
2. Update the consumer (`day-review-sheet.tsx`) to pass `sessionId` and (per CACHE-F15) use
   `cachedFetch` — **cross-ref R2**, note the dependency, R2 owns the fetch conversion + the SWR-header
   retrofit (CACHE-F16) + the `pb-safe` removal (UI-M1). This task's scope is the route's matching key.

**Verify:** `pnpm dev`, log ≥2 sessions of one program session, rename that session, then open the load
comparison chart — history continuity is preserved (the pre-rename sessions still appear). Confirm the
route responds to `?sessionId=`.

### Task 3 — WK-5 call-site swap (depends on R2's `invalidateExerciseLogged`)

`handleCompleteSet` currently hand-rolls its post-log invalidation as an ad-hoc key list
(`workout-screen.tsx:852-857`: `weights-summary`, `weekly-stats`, `muscle-recovery`, `strength-trend`,
`workout-card:<id>`), plus `invalidateCalendarCache()` — forbidden at write sites and **missing**
`exercise-history:<name>` (which the summary screen immediately re-reads, `exercise-summary-screen.tsx:47`),
`day-log:`, `home-day-timeline`, `achievements:`, `workout-sessions-day:`, `training-load`,
`muscle-tonnage-trend`, etc. Normal workouts are eventually covered by `invalidateWorkoutSummaries()`
at complete (`workout-screen.tsx:995`), but **solo re-logs never complete**, so those keys stay stale.

**Fix — once R2 has added `invalidateExerciseLogged(sessionId, exerciseName)` to `lib/cache-groups.ts`,
replace the ad-hoc block at `:852-857` with a single group call.** Do NOT create the group here (R2
owns it, so its key list stays single-source). This task is purely the call-site swap and must land
after (or be sequenced with) the R2 group. If R2 hasn't landed when this batch is implemented, leave a
one-line backlog note and skip — do not re-introduce a second ad-hoc list.

**Verify:** `pnpm dev`, log a solo exercise (no full workout complete), navigate away and back to the
exercise summary/history — the freshly-logged set is reflected (no stale `exercise-history` re-read).

---

## Chunk 5 — Low-risk hygiene — WK-13, WK-14, WK-15, WK-16, WK-18

**Governing rules:** *Zustand persisted store — daily state keyed by local date*, *External/Zod
input clamped at the boundary; a poison mutation must never wedge the outbox*, *Session identity =
DB id*, *Date arithmetic — one "today" source per feature*, *WebView — stable keys, never
`key={index}`/duplicate keys*.

### Task 1 — WK-13: `todayLogged` rollover only enforced at rehydrate

`onRehydrateStorage` (`workout-store.ts:311-328`) resets `todayLogged`/`revertedDeloads` only when
`storedDate !== todayInTz()` — evaluated once, at app rehydrate. An app kept open across midnight keeps
yesterday's "done" ticks until a restart.

**Fix — add a lightweight midnight-rollover guard in the orchestrator** that re-checks `storedDate`
against `todayInTz()` on the workout screen's visibility/mount and clears the stale day. The cleanest
place is a `visibilitychange` listener (already a pattern in this file, cf. the app-state resync at
`:371-387`): on resume, if `useWorkoutStore.getState().storedDate !== todayInTz()`, call
`store.clearTodayLogged()` and stamp the new `storedDate`. Add a `setStoredDate`/rollover action to the
store rather than mutating state directly. Keep it a leaf-cheap check (no interval timer — the
CLAUDE.md render-discipline rule bans `setInterval` state in orchestrators).

**Verify (device-only):** requires crossing local midnight with the app foregrounded — mark
NOT-verified-on-device if no S25 session. On web, can simulate by setting `storedDate` to yesterday in
localStorage and firing a `visibilitychange`.

### Task 2 — WK-14: voice logging feeds unclamped values

`set-card.tsx` `handleVoiceResult` (`:188-191`) passes recognised weight/reps straight to
`onRepChange`/`onWeightChange` with no clamp. "0 reps" is accepted, and a mis-heard weight > 500
passes the local write but fails the server `LogExercisePayloadSchema` (`weights … .max(500)`,
`reps … .min(0).max(100)`, `log-exercise.ts:15-17`) → a quarantined poison mutation. The +/- buttons
already clamp.

**Fix — clamp in `handleVoiceResult` to the same bounds the buttons/schema use:**

```ts
const handleVoiceResult = (weight?: number, reps?: number) => {
  if (reps !== undefined) onRepChange(index, Math.max(1, Math.min(100, Math.round(reps))));
  if (weight !== undefined) onWeightChange?.(index, Math.max(0, Math.min(500, weight)));
};
```

(Use the same min-rep floor the +/- control enforces — confirm it's 1, not 0, when wiring.)

**Verify:** `pnpm dev`, drive the voice-input path with an out-of-range value (mock the recogniser) →
the logged value is clamped and the server POST succeeds (no quarantine).

### Task 3 — WK-15: phase counting keys off `sessionName.toLowerCase()`

Phase progress is counted via `countAllSessionsSinceStart` returning a Map keyed by **session name**
(lowercased): `sessionCounts.get(sess.name.toLowerCase())` (`workout-data/route.ts:109,165`) and
`sessionCounts.get(sessionName.toLowerCase())` (`log-exercise.ts:108`). Renaming a session resets its
phase progress — a "session identity = DB id" violation.

**Fix (note the migration nuance):** re-key the aggregation on `workout_sessions.session_id` (the
program-session UUID) instead of `session_name`. This touches the repo method
`countAllSessionsSinceStart` (return a `Map<sessionId, count>`) and all three call sites. **Caveat:**
`workout_sessions.session_id` is nullable and older rows may have it null (`schema.ts:147`) — those
rows currently only match by name, so a straight switch would drop their counts. Handle by counting
`COALESCE`-style: prefer `session_id` when present, fall back to a name match for legacy null-id rows,
or run a one-off backfill migration to populate `session_id` on historical rows from the session name.
Given the nullable-column complexity, **this is low priority** — if the backfill risk isn't worth it
in-batch, leave a backlog note rather than a half-migration. Do NOT ship a name→id switch that silently
drops legacy-row counts.

**Verify:** `pnpm dev`, log sessions to advance a phase, rename the program session, log again —
phase progress must be continuous (not reset). Confirm legacy (null `session_id`) sessions still count.

### Task 4 — WK-16: mixed "today" sources in one flow

`handleCompleteSet` stamps the outbox mutation date with `todayInTz()` (`:777`) while the payload's
`localDate` uses `localDatetimeString()` (device tz, `:759`); `completeWorkout` stamps the optimistic
calendar/streak caches and the outbox with `localDateString()` (device tz, `:1000,1038,1043`). Three
"today" sources in one completion flow — they diverge across midnight in a non-`Australia/Brisbane`
device tz.

**Fix — pick one source per this flow and use it consistently.** The app rule is `todayInTz()` (server
+ client, respects the user's Profile tz). Replace the `localDateString()`/`localDatetimeString()`
device-tz calls in `completeWorkout` and `handleCompleteSet`'s outbox-date/optimistic-stamp paths with
`todayInTz()` (and the datetime variant where a timestamp is needed). Keep the payload `localDate` a
full datetime but derived from the same tz basis. **Cross-ref DATE-A5/A7 (R8)** for the broader
device-tz-vs-`todayInTz` sweep — this task only unifies the workout-completion flow's three sources;
don't expand into the home calendar/week-strip.

**Verify:** `pnpm dev` with the user tz set to `Australia/Brisbane`; confirm completion stamps the
correct local day. The cross-midnight divergence is only observable on-device in a non-AEST tz — note
NOT-fully-verified if unavailable.

### Task 5 — WK-18: misc

- **`newPRs`/`xpEarned` unpersisted** — both are `useState` in the orchestrator (`:154-155`), so a
  mid-workout refresh (the store rehydrates but these don't) empties the done screen's PR list and XP.
  Persist them in the Zustand store (they're per-session results, cleared on `startWorkout`/`resetSession`
  like `sessionLog`), or re-derive on the done screen from `personal_records`/achievements. Prefer
  storing in the workout store alongside `sessionLog` — add fields + include them in `startWorkout`'s
  reset so they don't leak across sessions (Zustand transient-state rule).
- **Calendar-add failure has no retry/outbox** — `handleAddToCalendar` (`:960-989`) toasts on failure
  but drops the event; there is no outbox domain. Lowest priority (calendar is a Google side effect,
  not core data) — note it; a full fix means a `calendar_event` outbox domain (out of scope for this
  batch, backlog it if not done).
- **`key={ex.name}` in pre/warmup lists** — `pre-workout-screen.tsx:210` and `warmup-screen.tsx:150`
  key exercise rows by name; a program with the same exercise twice collides. Key by a stable id (the
  exercise's DB id if present on `WorkoutExercise`, else a `` `${ex.name}-${i}` `` composite). Confirm
  the type carries an id before using it.

**Verify:** `pnpm dev` — (a) complete a workout with a PR, refresh mid-done-screen, confirm PRs/XP
survive; (b) a program with a duplicated exercise renders both rows correctly in pre + warmup with no
React key warning.

---

## Suggested commit sequence

1. `WK-1 advance() completion loss` (own commit — highest risk)
2. `WK-4 in-flight log guard` (own commit — highest risk)
3. `WK-2 superset tail handoff`
4. Chunk 2 (WK-3/7/8) — superset & timer fidelity
5. Chunk 3 (WK-6/12) — 1RM/PR correctness (WK-12 carries a migration)
6. Chunk 4 (WK-9/11, + WK-5 swap once R2 lands)
7. Chunk 5 (WK-13/14/15/16/18) — hygiene

Bump `package.json` + `lib/changelog.ts` (patch — bug fixes) and append the journal/`projectOverview.md`
update in the same PR once the diff is final and CI is green.
