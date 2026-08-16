# Workout System Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fix every NEW finding from the 2026-07-10 workout-system full review
(`docs/reviews/2026-07-10-workout-system-review.md`) — revive the dead AI rep-completion signal
chain, make prescriptions re-evaluate on the training day, restore superset rest alerts, close
the remaining APK local-mirror holes, and clear the workout-surface caching/UI/HR debt.

**Architecture:** six independent chunks, each landable as its own PR (data-integrity first).
No schema migrations required anywhere in this plan. Chunks 1–3 are fully verifiable on the
local dev DB + `pnpm dev`; Chunks 2 and parts of 4–5 have APK-only failure surfaces (state so
in the journal per the Canonical Runtime rule).

**Tech stack:** existing — Next.js 15 route handlers, Drizzle/`sql` slices, Zustand persisted
store, `lib/sqlite/cache.ts` + `lib/cache-groups.ts`, `lib/local-store/` SQLite backend.

**Branch:** `fix/workout-system-hardening` (each chunk may use a suffixed branch
`fix/workout-system-hardening-c<N>` if landed separately).

> **Cross-references (do NOT re-plan here):**
> - **R4 (`2026-07-09-r4-workout-flow-correctness.md`)** owns WK-1..18. **Correction to R4
>   WK-3:** its premise "beep/notification/PiP correctly use `lastSetRestSec`" is wrong — they
>   receive the right *duration* but a dead/stale *start* in supersets (this plan's Task 4.1 /
>   review TMR-1). Land Task 4.1 together with (or instead of) WK-3's ring-only fix.
> - **R3 chunks 2–6** own the remaining sync/outbox items marked DUP in the review. This plan's
>   Chunk 2 covers only what R3 *missed* (SYN-1..8, SYN-10).
> - **R6** owns PERF-1/2/3/6/7/8/9/12. This plan's Task 6.3 extends R6's PERF-7 with two more
>   lazy initializers (PRF-7) — fold into whichever lands first.
> - **UB5/UB6** own the live-HR Measure-button rework and HR smoothing. This plan's Tasks
>   5.6–5.9 cover only what those plans exclude (error state, dead-Cloud copy, chart gridline
>   theme, buffer persistence).
> - **Measured-time plan (`2026-07-10-measured-time-model-budget-margins.md`)** owns
>   fitToBudget/duration-model consumption. This plan's Task 4.2 protects the *raw rows* that
>   model will consume.

---

## Chunk 1 — AI periodization correctness (review AI-1..6, AI-8..11, AI-17)

**Governing rules:** *Stored Counters — derive, or reconcile on read*; *Date Arithmetic — SQL
window boundaries in the user's timezone*; *One Formula, One Place*; *AI defaults — no LLM
number gates an automatic action*.

### Task 1.1 — AI-1: wire `setLastSessionRanPrescription` (revive the rep-completion chain)

**Files:** Modify `lib/workout/complete-workout.ts` (~:39-42).

- [ ] In `completeWorkoutFromPayload`, where the prescription is marked consumed / the phase
  counter increments, record whether the completed session ran under a prescription:

```ts
// after the existing markPrescriptionConsumed / incrementSessionsInPhase block
const ranPrescription =
  periodizationState?.prescriptionStatus === 'accepted' ||
  periodizationState?.prescriptionStatus === 'auto_applied' ||
  (periodizationState?.prescriptionStatus === 'pending' &&
    periodizationState?.prescription != null);
await repo.setLastSessionRanPrescription(userId, programSessionId, ranPrescription)
  .catch(() => {}); // advisory signal — must never fail completion
```

  (Adjust the status names to the actual enum in `lib/ai-periodization/types.ts` — the writer
  and the `state.lastSessionRanPrescription` reader at `lib/ai-periodization/signals.ts:250`
  already exist; only this call is missing.)
- [ ] Verify: complete a workout on the dev DB for an `ai_dynamic` program with an accepted
  prescription, then hit the prescribe route and confirm the prompt no longer prints
  "Rep completion rate: no data" (`lib/ai-periodization/prompt.ts:207`) and
  `repCompletionRate` is non-null in the stored signals.
- [ ] Add a unit/DB test: completion with an accepted prescription →
  `lastSessionRanPrescription = true`; without → `false`.
- [ ] Commit.

### Task 1.2 — AI-2 + AI-3: consumption-day re-evaluation of prescriptions

**Files:** Modify `app/api/workout-data/route.ts` (~:244-246), `lib/ai-periodization/`
(new small helper), `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`
(extract the deterministic layers so they're callable without the LLM).

The prescription is generated minutes after the *previous* session and consumed up to 7 days
later. Do **not** re-run the LLM at consumption (latency on the workout-open path). Instead:

- [ ] Extract the deterministic post-generation layers — per-exercise soreness deload
  (prescribe route ~:193,373-377) and emergency-deload evaluation
  (`lib/ai-periodization/emergency-deload.ts`) — into a pure
  `reevaluatePrescriptionForToday(prescription, freshSignals)` in
  `lib/ai-periodization/reevaluate.ts` that: (a) drops per-exercise soreness deloads whose
  soreness has cleared and adds ones for *today's* soreness; (b) re-computes the emergency
  conditions with today's `hoursSinceLastSession` (now a meaningful number, fixing AI-3's
  inverted semantics); (c) never touches the LLM's sets/reps/pct otherwise.
- [ ] In `workout-data`'s `prescriptionDrivesLoad` path: when
  `todayInTz(tz) !== toDateStr(prescription.generatedAt, tz)`, call the re-evaluator with a
  cheap fresh-signals subset (soreness from mood/check-in, hours since last session, active
  injuries — NOT the full 30-signal aggregation) before expanding to styles. Cache the
  re-evaluated result back onto the state row so it runs once per day, not per fetch.
- [ ] Enforce expiry at the consumption point: if `prescriptionExpiresAt < now`, do not let an
  `accepted` prescription drive load — fall back to the static style and flip status the same
  way the GET route does for `pending` (route.ts:50-57).
- [ ] Verify on dev DB: generate a prescription, manually backdate `generated_at` one day, log
  fresh soreness for a prescribed muscle, fetch workout-data → the affected exercise carries
  today's deload; backdate `prescription_expires_at` past → static style served.
- [ ] Commit.

### Task 1.3 — AI-4: stop injuries force-triggering emergency deloads

**Files:** Modify `lib/ai-periodization/emergency-deload.ts:24`,
`app/api/ai-periodization/session/[sessionId]/prescribe/route.ts` (~:143-160).

- [ ] Remove `activeInjuredMusclesInSession.length > 0` as a standalone emergency trigger (or
  gate it on severity ≥ the highest tier if the injuries table has severity). The prompt
  already receives `activeInjuredMusclesInSession` and documents the finer-grained
  `session_swap_recommended` path (prompt.ts:105-109) — let it run.
- [ ] Verify: with one active low-severity injury on the dev DB, prescribe → the LLM path runs
  (not the 2-set/50% emergency branch).
- [ ] Commit.

### Task 1.4 — AI-5: one definition for `sessions_in_phase`

**Files:** Modify `lib/data/postgres/slices/periodization.ts:156-176` (reconcile),
`lib/workout/delete-session.ts:65-72` + `app/api/workout-entry/route.ts:167-176` (decrement),
`lib/workout/complete-workout.ts:39-42` (increment), prescribe route (~:395).

- [ ] Canonical definition: **completed** (`completed_at IS NOT NULL`), non-deleted sessions
  since `phase_started_at`. Update `reconcileSessionsInPhase`'s COUNT to add
  `AND completed_at IS NOT NULL`; update both delete-decrement sites to only decrement when
  the deleted session had `completed_at IS NOT NULL`.
- [ ] Stop swallowing the increment error silently: keep the `.catch` (completion must not
  fail) but `console.error` it, and add `reconcileSessionsInPhase` at the top of the prescribe
  route so the phase-ceiling reader (:395-404) always sees a reconciled value (reconcile-on-
  read pattern; also fixes the DUP half — a second read site).
- [ ] Add a DB test: abandoned session (started, never completed) neither counts on reconcile
  nor decrements on delete.
- [ ] Commit.

### Task 1.5 — AI-6: weekly-volume window in user tz

**Files:** Modify `lib/data/postgres/slices/periodization.ts:367-368,384-385`.

- [ ] Replace `ws.started_at >= ${weekStart}::date` / `< ${weekEndNextStr}::date` with the
  `dateStrMidnightInTz(weekStart, tz)` pattern already used at :303 in the same file (both
  boundaries, both queries).
- [ ] Add a boundary test at 23:59/00:01 user-local Monday (per the Date Arithmetic rule):
  a session at Monday 08:00 AEST counts in the *new* week.
- [ ] Commit.

### Task 1.6 — AI-8: mark ai_dynamic deload sessions as deloads

**Files:** Modify `lib/workout/log-exercise.ts:100-114`.

- [ ] When the program is `ai_dynamic` and the automatic-mode phase engine yields no phase,
  resolve phase/deload from `session_periodization.phase` for the target session: if the
  stored phase is `deload`, set `intensityMode = 'deload'` / `currentPhaseType = 'deload'`
  before `shouldCountTowardPr` runs, and stamp `workout_sessions.phase_type` the same way the
  automatic path does. This closes the PR-minting hole for card-initiated deloads.
- [ ] DB test: log a beats-target set in an ai_dynamic deload phase → no `personal_records`
  update; same set in accumulation → PR updates.
- [ ] Commit.

### Task 1.7 — AI-9 + AI-17 + AI-10 + AI-11 small fixes

**Files:** Modify `app/api/workout-data/route.ts`, `components/workout/ai-prescription-card.tsx:143`,
`components/workout/pre-workout-screen.tsx:120-127`,
`app/api/ai-periodization/session/[sessionId]/transition/route.ts:32-40`,
`app/api/ai-periodization/baseline/complete/route.ts`.

- [ ] AI-9: in workout-data, when state is `consumed` with no stored prescription for an
  `ai_dynamic` session (the failed-generation signature), fire-and-forget a regenerate
  `POST /prescribe` (same idempotence as the completion path) so one Gemini outage no longer
  costs two sessions of prescriptions.
- [ ] AI-10: in the prescription card, round display weights with
  `mroundStepUp(est1rm * pct, weightStepFor(equipment))` — the same call the workout screen
  uses (workout-screen.tsx:453,517) — instead of `mround125Up`; key `liveOneRm`/
  `lastSetModeById` maps by exercise **id**, not name.
- [ ] AI-17: validate transitions server-side — reject a `toPhase` that isn't the recommended/
  adjacent phase unless `force: true` is sent; await the regen fetch's dispatch (still
  fire-and-forget execution) and log failure.
- [ ] AI-11: either delete the dead `amrapResults` branch of baseline/complete or fix its
  schema (`weightKg: z.number().min(0)` for bodyweight AMRAPs) and scope the auto-heal's
  `getLastExerciseLogsBatch` predicate to the program (`workout-data/route.ts:176-181` and
  `session/[sessionId]/route.ts:31-47`) so a new program can't skip baseline via another
  program's history. Prefer the delete + scoping (YAGNI).
- [ ] `pnpm dev` verify: prescription card weight now matches the loaded bar weight for a
  barbell exercise; transition to a non-adjacent phase 400s.
- [ ] Commit.

---

## Chunk 2 — Offline-first mirrors the R3 pass missed (review SYN-1..8, SYN-10)

**Governing rules:** *Offline-First — if a domain writes locally its UI reads local-first*;
*a server hard DELETE is invisible to devices that haven't synced*; *the outbox payload must
carry every field the web route accepts*; *sibling-surface sweep*.

⚠️ All failure surfaces here are APK-only (`getLocalStore` is null on web). Sandbox gate =
code-level tests + `pnpm dev` regression; journal must state device smoke not run.

### Task 2.1 — SYN-3: tombstone tail-set truncation in the PATCH

**Files:** Modify `app/api/workout-entry/route.ts:82-95`.

- [ ] Replace the hard DELETE with:

```sql
UPDATE set_logs SET deleted_at = now()
WHERE exercise_log_id = $1 AND set_number > $2 AND deleted_at IS NULL
```

  and make the upsert arm clear `deleted_at = NULL` on conflict (re-created set numbers
  resurrect cleanly). The `trg_set_updated_at` trigger bumps `updated_at`, so `getSyncDelta`
  emits the tombstone and the existing local delete arm (`sqlite-backend.ts:772`) applies it.
- [ ] DB test: 3-set log edited to 2 sets → set 3 has `deleted_at` set and appears in the next
  `getSyncDelta`; re-edit to 3 sets → row resurrected.
- [ ] Commit.

### Task 2.2 — SYN-4: mirrors must not strand rows in `pending`

**Files:** Modify `lib/local-store/sqlite-backend.ts:1106-1131`
(`updateExerciseLogLocally`/`deleteExerciseLogLocally`), `app/health/health-content.tsx:552-554`.

- [ ] The mirrors run only after the awaited web PATCH/DELETE succeeded — local == server at
  that instant. Write them with `sync_status = 'synced'` (not `'pending'`), so future pulls
  are not permanently blocked by the `WHERE sync_status='synced'` gates (:759,787).
- [ ] Make `updateExerciseLogLocally` also delete local set rows with `set_number > n` (the
  web PATCH truncates server-side; after Task 2.1, mark them `deleted_at` locally to match).
- [ ] Stop passing `intensityPct: null` from health-content — omit the field so the mirror
  preserves the stored value the server recomputes.
- [ ] Unit test against the sqlite backend (vitest better-sqlite3 harness already used by
  local-store tests): after `updateExerciseLogLocally`, the row is `synced` and a subsequent
  `applyDelta` with a newer server row overwrites it.
- [ ] Commit.

### Task 2.3 — SYN-1 + SYN-2: the missing mirrors (stats edit/delete, session delete)

**Files:** Modify `app/stats/stats-content.tsx:117-151`, `app/health/health-content.tsx:565-614`,
`lib/local-store/sqlite-backend.ts` + `lib/local-store/index.ts` (new method).

- [ ] Add `deleteWorkoutSessionLocally(sessionId)` to the LocalStore interface + sqlite
  backend: tombstone (`deleted_at`, `sync_status='synced'`) the `workout_sessions` row and
  all child `exercise_logs`/`set_logs`, mirroring `deleteExerciseLogLocally`'s shape.
- [ ] `health-content.tsx`: call it in `handleDeleteSession` after the awaited DELETE
  succeeds, and in `handleDelete` when the response carries `sessionDeleted: true`
  (`app/api/workout-entry/route.ts:187`) so the empty session shell disappears.
- [ ] `stats-content.tsx`: copy health-content's (post-Task-2.2) mirror blocks into
  `handleEditSave` and `handleDelete` — the sibling-surface sweep R3 Task 1.2 cited but
  didn't apply.
- [ ] Commit.

### Task 2.4 — SYN-5: local-first exercise history mid-workout

**Files:** Modify `components/workout/active-workout-screen.tsx:114-116`,
`components/workout/exercise-summary-screen.tsx:46-47`.

- [ ] Before the existing `cachedFetch('exercise-history:<name>')`, seed synchronously from
  the local store using the same query shape `components/exercise-history-sheet.tsx:31` uses
  (per-exercise rows from `store.getWorkoutHistory`), then let the cachedFetch revalidate.
  Keep the shared `EXERCISE_HISTORY_TTL`.
- [ ] Commit.

### Task 2.5 — SYN-6 + SYN-8: outbox payload fidelity for stranded workouts

**Files:** Modify `lib/sqlite/migrations.ts:185-192` (new columns on the local
`workout_sessions`/`exercise_logs` tables + `RECONCILE_COLUMNS` in the same commit),
`lib/local-store/sqlite-backend.ts:321` (`logWorkoutLocally`),
`lib/local-store/sync-helpers.ts:52-92` (`buildWorkoutLogPayload`).

- [ ] Add local columns `session_id`, `intensity_mode`, `was_override`, `exercise_deloaded`
  (dovetails with R4 WK-12's server column — if R4 lands first, match its name), persisted by
  `logWorkoutLocally` from the payload; register every new column in `RECONCILE_COLUMNS`
  **in the same commit** (local-migration rule).
- [ ] Thread them through `buildWorkoutLogPayload` so a stranded deload/override replay is no
  longer degraded to a normal log with name-fallback phase attribution.
- [ ] SYN-8: replicate the server's `useFor1rm` default (`allRepsEqual ? true : reps ===
  minReps`, `lib/workout/log-exercise.ts:172-184`) in the shared payload/local write path —
  extract the two-line default into `lib/workout/log-exercise.ts` as an exported
  `defaultUseFor1rm(reps: number[], i: number)` and call it from both (One Formula rule).
- [ ] Local-migration test: idempotent re-run of the new version; reconcile adds columns on a
  partially-applied DB.
- [ ] Commit.

### Task 2.6 — SYN-7 + SYN-10 small fixes

**Files:** Modify `lib/local-store/sync-engine.ts:561-563`,
`app/session-select/session-select-content.tsx:258,630`.

- [ ] SYN-7: in `markSessionSynced`'s confirm path, skip flipping the session row to `synced`
  while any other pending outbox mutation references the same `workoutSessionId` (query the
  outbox table by payload session id).
- [ ] SYN-10: seed Home's `workout-sessions-day:<date>` widget from
  `store.getWorkoutSessions(today)` before the cachedFetch (same local-first shape as the
  Task 1.3 body-metric seed R3 shipped).
- [ ] Commit.

---

## Chunk 3 — Caching & staleness on the workout surfaces (review CCH-1..8)

**Governing rules:** *Cache Invalidation — writes go through groups*; *freshWithinTtl requires
a written invalidation proof*; *today-keyed caches*; *one canonical TTL per key*.

### Task 3.1 — CCH-1: prescription writes invalidate the card caches

**Files:** Modify `lib/cache-groups.ts`, `components/workout-screen.tsx:302-307`
(`refreshExercises`), `components/workout/ai-prescription-card.tsx:65-96`.

- [ ] Add (or extend) a group `invalidatePrescriptionChanged(programSessionId)` in
  `lib/cache-groups.ts` covering: `workout-data:<tab>`, `workout-card:<id>`,
  `workout-card:<id>:deload` (check the exact twin-key spelling at the seed sites), plus a
  call into the existing `invalidateAiPeriodization()`.
- [ ] Call it from the card's respond/transition success handlers (before `onChanged`/refetch
  callbacks fire — invalidate-before-refetch rule) and from `refreshExercises`.
- [ ] Update the freshWithinTtl invalidation proof comment next to the `workout-card:` fetch
  sites (`session-select-content.tsx:460`, `workout-select-content.tsx:170`) to list
  respond/transition as covered writers.
- [ ] Extend `lib/__tests__/cache-groups.test.ts` with the new group's key list.
- [ ] Commit.

### Task 3.2 — CCH-2/SYN-9 + CCH-3: missing invalidations

**Files:** Modify `app/health/health-content.tsx:537-563`, `lib/cache-groups.ts:95-108`.

- [ ] health-content `handleEditSave`: add `invalidateWorkoutSummaries()` after the successful
  PATCH (mirror of its own delete path at :589 and stats-content:129).
- [ ] `invalidateProgramStructure()`: also remove `ta_meta_v1` and `ta_recommendation_v1`
  sessionStorage seeds (same two lines `invalidateWorkoutSummaries` uses at :54-59).
- [ ] Commit.

### Task 3.3 — CCH-4: make `next-session` today-keyed

**Files:** Modify `app/session-select/session-select-content.tsx:139-146,280-287,439`,
`app/workout-select/workout-select-content.tsx:125`, the sync-provider warm list, and the
`ta_recommendation_v1` seed write/read sites.

- [ ] Convert `next-session` to `cachedFetchToday` + `readTodayCacheSync` at **every** read
  site and flip the warm-list entry to `today: true` in the same commit (one-variant rule).
- [ ] Date-stamp `ta_recommendation_v1` (store `{ date: todayInTz(), data }`; ignore on
  mismatch) or delete the legacy seed if the today-cache seed makes it redundant — prefer
  deletion if home still instant-paints from `readTodayCacheSync` alone (test at a cold
  navigation).
- [ ] Commit.

### Task 3.4 — CCH-5..8 small fixes

**Files:** Modify `components/workout-screen.tsx:332-340,1065-1074`,
`app/api/ai-periodization/session/[sessionId]/route.ts:8`, `app/api/achievements/route.ts:11`,
`components/mood-checkin-sheet.tsx:159,170`, `lib/cache-ttl.ts`,
`app/api/oura/hr-data/route.ts` (HR-6 rides here).

- [ ] CCH-5: convert the periodization-state fetch to
  `cachedFetch('ai-periodization-session:<id>', …)` seeded via `readCacheSync` (add the key to
  the Task 3.1 group + complete-workout's invalidation), and add
  `Cache-Control: private, max-age=60, stale-while-revalidate=120` to the GET route.
- [ ] CCH-6: add `private, ` to the achievements route's Cache-Control.
- [ ] CCH-7: route `completeWorkout`'s phase-change detection fetch through `cachedFetch` on
  the just-invalidated `workout-data:<tab>` key so the response re-warms the cache.
- [ ] CCH-8: add a named `MOOD_TTL` in `lib/cache-ttl.ts` (= `TTL_SHORT`) and use it at both
  mood call sites.
- [ ] HR-6: add the standard SWR header to `app/api/oura/hr-data`.
- [ ] `pnpm dev` verify: accept a prescription → home card updates without a hard refresh;
  curl the two routes for the new headers.
- [ ] Commit.

---

## Chunk 4 — Timer integrity (review TMR-1,2,3,5,6,7,8)

**Governing rules:** *Zustand Persisted Store — transient state must not survive rehydration*;
*Ingest routes get a Zod schema*. ⚠️ Coordinate with R4: Task 4.1 amends WK-3; if R4 lands
first, rebase this on its ring fix (and vice versa).

### Task 4.1 — TMR-1 + TMR-5: a dedicated live rest anchor

**Files:** Modify `lib/stores/workout-store.ts` (new field), `components/workout-screen.tsx`
(:372-388,707,730), `components/workout/active-workout-screen.tsx:151-155`,
`components/workout/pip-view.tsx`.

- [ ] Add `lastSetRestStartMs: number | null` to the store beside `lastSetRestSec`, set in
  `handleLogCurrentSet` at the same moment as `restStartMs = now` (:730), **never** written by
  `switchToExercise`/`restoreExercise`/`stashExercise` — the per-exercise buffered
  `restStartMs` remains solely the physiological rest_time_sec anchor.
- [ ] Derive one shared "effective rest target": `effectiveRestSec = lastSetRestSec > 0 ?
  lastSetRestSec : (styleRestSec ?? 90)` in one place (a small selector/helper in the store
  file), and drive **all four** consumers — beep effect (:372-377), notification effect
  (:381-388 via `computeRestNotificationAction`), the on-screen ring
  (active-workout-screen.tsx:151-155), and PiP — from `(lastSetRestStartMs,
  effectiveRestSec)`. This also fixes TMR-5 (style-less sets now beep at the same 90 s the
  ring shows) and supersedes WK-3's ring-only fix.
- [ ] Persisted-store rule: exclude/reset `lastSetRestStartMs` in `onRehydrateStorage` the
  same way Task 4.2 treats the other anchors.
- [ ] `pnpm dev` verify with a superset session: log A1 → ring + (dev-sim) beep timer anchored
  at the log moment; switch to B, log B1, return to A → ring restarts from B1's log, not A1's.
- [ ] Commit.

### Task 4.2 — TMR-2: staleness guard on rehydrated timer anchors

**Files:** Modify `lib/stores/workout-store.ts:311-328` (`onRehydrateStorage`).

- [ ] On rehydrate, when `mode === 'active'` and any live anchor is implausibly old —
  `now - lapStartMs > 4h` (or `restStartMs`/`exerciseStartMs` likewise), or `storedDate !==
  todayInTz()` — clear `lapStartMs`/`restStartMs` (and `lastSetRestStartMs`) to `null` and
  set `workoutPhase` to `'set'`-idle equivalent rather than resuming a timer that never ran.
  Keep `workoutStartMs` (the session may legitimately span the guard? No — cap it too: a
  >4 h-old active workout across a date rollover resets to `mode: 'pre'`, matching the
  existing summary/done reset).
- [ ] Unit test the rehydrate handler with a mocked persisted blob 20 h old → anchors cleared,
  mode reset; 30 min old → untouched.
- [ ] Commit.

### Task 4.3 — TMR-3 + TMR-8 + TMR-6 + TMR-7: bounds, semantics, listener

**Files:** Modify `lib/workout/log-exercise.ts:19-24`, `components/workout-screen.tsx:394-410,
763-768`, `lib/stores/workout-store.ts:50`.

- [ ] TMR-3: bound the timing fields in `LogExercisePayloadSchema`:

```ts
timeToCompleteSet: z.number().int().min(0).max(86_400).optional(),
setTimes: z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
restTimes: z.array(z.number().int().min(0).max(86_400)).max(20).optional(),
setStartTimes: z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
setEndTimes: z.array(z.number().int().min(1_600_000_000_000).max(4_100_000_000_000)).max(20).optional(),
interExerciseRestSec: z.number().int().min(0).max(86_400).optional(),
```

  Client-side, clamp negatives to 0 at the write sites (:719-721,766-767) so an NTP step
  degrades to a 0 rather than a rejected log (the outbox must never queue a payload the
  schema rejects — poison-pill rule).
- [ ] TMR-8: make the `timeToCompleteSet` fallback (:763-768) subtract accumulated rest
  (`sum(restTimes)`) from the wall-clock delta, flooring at `sum(lapTimes)` when laps exist;
  or return `undefined` when laps are empty. Pick the subtract variant (keeps the field
  populated for legacy rows' consumers).
- [ ] TMR-6: fix the `restTimes` comment at workout-store.ts:50 to "rest seconds taken
  *after* each set (index i → rest following set i+1's row server-side)".
- [ ] TMR-7: hoist the `appStateChange` listener to a mount-scoped effect (deps `[]`) reading
  fresh state via `useWorkoutStore.getState()` inside the callback; guard the async
  `addListener` resolution with a cancelled flag that removes a late-arriving handle.
- [ ] Commit.

---

## Chunk 5 — UI/UX & in-workout HR (review UI-1..12, HR-1..4)

**Governing rules:** *Android WebView Gotchas — no nested interactive controls*; *touch
feedback within 100 ms, synchronously with the local write*; *theme tokens, no white-alpha in
light mode*; *colour never sole state*; *self-fetching cards need explicit failure states*;
*Oura BLE — never steer the user toward the Cloud sync/official app*.
⚠️ Light-mode and tap-target findings need on-device confirmation before being journalled as
verified.

### Task 5.1 — UI-2: synchronous set-log haptic

**Files:** Modify `components/workout-screen.tsx:865` (region ~:840-875).

- [ ] Move `hapticLight()` out of the POST `.then()` to fire synchronously beside the mode
  flip/`setLoggedCount` local write (reference: the log-exercise "saves feel instant"
  pattern). Remove it from the network callback entirely.
- [ ] Commit.

### Task 5.2 — UI-1: un-nest the deload chip

**Files:** Modify `components/workout/pre-workout-screen.tsx:210-260`.

- [ ] Restructure the exercise row: the stats `<button>` no longer wraps the deload chip; the
  chip becomes a sibling real `<button>` inside the row's flex `<div>` (session-select APK
  banner pattern), inheriting the global 44 px floor (use `tap-dense` spacing if the row gets
  tight).
- [ ] Commit.

### Task 5.3 — UI-3 + UI-4: RPE strip targets, aria, and light-mode text

**Files:** Modify `components/workout/rpe-strip.tsx`.

- [ ] Container `h-9` → `h-11`, drop `overflow-hidden` clipping of the buttons; add
  `aria-pressed={selected}` per segment.
- [ ] Replace `#ffffffcc`/`#000` with theme-aware values (dark text on the light tints in both
  schemes, or `color-mix` with the segment token) so RPE numbers are readable in light mode.
- [ ] Commit.

### Task 5.4 — UI-5: session RPE re-tap to change

**Files:** Modify `components/workout/done-screen.tsx:100-115,315-339`.

- [ ] Keep the 1–10 grid mounted after selection with the chosen value highlighted
  (`aria-pressed`); a re-tap re-POSTs (the write path already upserts `session_rpe`). Drop the
  `rpeSaved` unmount + guard; keep an in-flight guard on the POST itself.
- [ ] Commit.

### Task 5.5 — UI-6..12 sweep (theme, a11y, glyphs, voice-weight snap)

**Files:** Modify `components/workout/set-card.tsx:386,188-191`,
`components/workout/active-workout-screen.tsx:201,218,362,383,398,570,600,614`,
`components/workout/exercise-summary-screen.tsx:84,89-100,110`,
`components/workout/done-screen.tsx:261-283,401`, `app/workout-select/workout-select-content.tsx:376-391`,
`components/ui/weight-dial.tsx:135,180`.

- [ ] UI-6: white-alpha borders → `var(--color-border)`/token color-mix (set-card :386,
  active-workout :362,:600).
- [ ] UI-7: carousel dots → token colours + real `<button>`s with `aria-label="Session N"`.
- [ ] UI-8/9: exercise-summary header chevron → either remove or a labelled
  `ChevronRightIcon`/`XIcon` that matches its `onNext` action; add `aria-label` to the
  active-screen back + 1RM-calculator buttons.
- [ ] UI-10: text glyphs → Lucide (`Timer`, `Check`, `X`, `Play`, `ArrowUp`, `Circle`) at the
  listed sites (all files already import Lucide).
- [ ] UI-11: PR yellows → `var(--accent-amber)` + color-mix per the R7 chunk-4 idiom; make the
  done-screen share icon always-visible at rest (drop the hover-only `/0` reveal).
- [ ] UI-12: snap voice-logged weights with
  `mroundStep(parsed, weightStepFor(equipment))` before `onWeightChange` (set-card :188-191).
- [ ] `pnpm dev` visual pass at 384×832 viewport, both themes.
- [ ] Commit.

### Task 5.6 — HR-1 + HR-2: done-screen HR failure state + dead-Cloud copy

**Files:** Modify `components/workout/done-screen.tsx:134-151,404-414`,
`components/workout/hr-recovery-chart.tsx:133`.

- [ ] Wrap `loadHr` in try/catch with a `res.ok` check → new `hrError` state rendering an
  explicit error row + Retry button, distinct from the genuine-empty copy.
- [ ] Delete the legacy `POST /api/oura/hr-sync` call; rewrite both empty-state strings around
  the BLE pipeline ("ensure the ring was worn and connected during the workout — data arrives
  via the ring's background sync"), never suggesting an Oura Cloud sync.
- [ ] Commit.

### Task 5.7 — HR-3: recovery-chart theme-safe gridlines

**Files:** Modify `components/workout/hr-recovery-chart.tsx:116-125`.

- [ ] Replace the `rgba(255,255,255,0.04)` grid + fixed gray ticks with scheme-conditional
  resolved values via the shared `resolveColor` (hoisted to `lib/` by R7 UI-H1 — if R7 hasn't
  landed, import from its current home; never pass `var(--x)` to canvas).
- [ ] Commit.

### Task 5.8 — HR-4: persistent live-HR trace buffer

**Files:** Modify `components/workout/live-hr-readout.tsx:14-27` (+ `lib/live-hr/manager.ts`
if the buffer lands there).

- [ ] Move the sparkline `points` buffer out of component state into a module-scoped rolling
  buffer keyed by workout session (cleared on manager stop), so each rest-period remount
  resumes the trace instead of showing "waiting". Coordinate with UB5's chip rework — if UB5
  lands first, apply to its chip component.
- [ ] Commit.

---

## Chunk 6 — Hygiene, docs, perf leftovers (review TMR-4/PRF-4/UI-14, PRF-3, PRF-7, PRF-13, PRF-16)

### Task 6.1 — delete TimerRing + fix CLAUDE.md drift

**Files:** Delete `components/workout/timer-ring.tsx`. Modify `CLAUDE.md` (Key Files table
row, Animations section, "the 1 Hz workout tick re-renders the entire ~1,000-line workout
screen" hotspot claim → point at ActiveWorkoutScreen instead).

- [ ] Delete the file (zero imports — re-verify with grep before deleting), remove its Key
  Files row, rewrite the Animations "TimerRing" bullet to describe the inline rest ring
  (`active-workout-screen.tsx:665-706`), and correct the stale orchestrator-tick claim in the
  Mobile UI & Performance section.
- [ ] `pnpm exec tsc --noEmit` green.
- [ ] Commit.

### Task 6.2 — PRF-13 + PRF-16: memo AiChatOverlay, leaf-ify countdown

**Files:** Modify `app/session-select/session-select-content.tsx:1349`,
`components/ai-chat-overlay.tsx` (memo export), `components/workout/pre-workout-screen.tsx:93-102`.

- [ ] `useMemo` the `sessionNames` array; wrap `AiChatOverlay`'s export in `React.memo`.
- [ ] Extract the 3-2-1 countdown into a small self-ticking leaf component so the 382-line
  pre-workout screen stops re-rendering during the countdown.
- [ ] Commit.

### Task 6.3 — PRF-7: fold the two extra lazy initializers into the PERF-7 conversion

**Files:** Modify `app/session-select/session-select-content.tsx:126-127`.

- [ ] Convert `pillColors`/`cardColors` from lazy `useState` initializers to effect seeding
  (the visibility-change handler at :217-234 already re-reads them — reuse its loader). If R6
  PERF-7 already landed, just extend its pattern; if this lands first, note it in the R6 plan.
- [ ] Commit.

---

## Verification gate (per chunk PR)

- [ ] `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build` all green.
- [ ] `pnpm dev` against the local dev DB: exercise the changed flows (Chunk 1: prescribe →
  workout-data → log → complete round-trip; Chunk 3: prescription accept → home repaint;
  Chunk 4: superset rest ring/beep; Chunk 5: done-screen HR error + both themes).
- [ ] Journal every APK-only surface not exercised (all of Chunk 2, TMR-2's rehydrate on
  device, light-mode/tap-target confirmations) per the Communication rule.
- [ ] Version bump: minor is not warranted — patch per chunk that ships user-visible fixes,
  with `lib/changelog.ts` entries.

## Self-review notes

- Every NEW finding from the review doc maps to a task above (AI-1→1.1, AI-2/3→1.2, AI-4→1.3,
  AI-5→1.4, AI-6→1.5, AI-8→1.6, AI-9/10/11/17→1.7, SYN-3→2.1, SYN-4→2.2, SYN-1/2→2.3,
  SYN-5→2.4, SYN-6/8→2.5, SYN-7/10→2.6, CCH-1→3.1, CCH-2/3→3.2, CCH-4→3.3, CCH-5/6/7/8+HR-6→3.4,
  TMR-1/5→4.1, TMR-2→4.2, TMR-3/6/7/8→4.3, UI-2→5.1, UI-1→5.2, UI-3/4→5.3, UI-5→5.4,
  UI-6..12→5.5, HR-1/2→5.6, HR-3→5.7, HR-4→5.8, TMR-4/PRF-4/UI-14+PRF-3→6.1, PRF-13/16→6.2,
  PRF-7→6.3). DUP findings are owned by their existing queued plans and deliberately absent.
- Cross-plan collisions called out inline: 4.1↔R4 WK-3, 2.5↔R4 WK-12, 5.7↔R7 UI-H1,
  5.8↔UB5, 6.3↔R6 PERF-7. Whichever lands second rebases.
