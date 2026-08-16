# Offline-sync integrity — data-loss bugs in the outbox/push/pull chain

> Source: post-update review 2026-07-04 (offline-sync pass). **This is the most
> serious cluster in the review** — four HIGH data-loss bugs plus queue-wedge and
> ownership-scoping gaps. Anchors verified against `main`; **re-grep before
> editing**. The offline-first rule is strict and this domain caused prod incidents
> #47/#74/#82/#85, so this is deliberately split into **four PR-sized chunks by risk**:
> Chunk 1 is safe mechanical hardening; Chunks 2–4 each touch schema or a write
> path and want their own review. Do them in order. **Chunk 4 claims Postgres
> migration 111** (109 = Batch N `error_events`, 110 = Batch O `body_measurements`
> are already claimed).
>
> The blunt truth of this domain: the web sandbox has **no native SQLite**
> (`getLocalStore` returns null), so every local-store path here is verifiable only
> by code review + the APK. Treat all of it as unexercised until the S25 pass and
> say so in each PR.

---

## Chunk 1 — Push-loop hardening + ownership scoping (one PR, no schema)

Safe, mechanical, high-value. No local-table or Postgres-schema change.

### 1a. Push loop must not wedge on 4xx/429
`lib/local-store/sync-engine.ts:443-449` — `if (!res.ok) { if (res.status >= 500) {…backoff…} break; }`. A persistent 413/429/4xx blocks the **entire** queue behind that chunk, is retried on every trigger with zero backoff, and never increments per-item `attempts` (transport failures deliberately don't count), so it never dead-letters. Per the strict outbox rule: **429/5xx = backoff+retry; 4xx = quarantine that mutation, never `break` the whole loop.**
- On 429: apply the existing 5xx backoff path, don't `break`.
- On a non-429 4xx that is attributable to a specific mutation (the server already returns per-mutation results — `app/api/sync/push/route.ts:26-38` drops malformed mutations without 400ing the batch; extend that contract if needed): quarantine/dead-letter that mutation and continue the loop, don't block its siblings.
- Add `rateLimit()` to `/api/sync/push` (the most expensive route — workout_log ≈ 8 queries × chunk) matching sibling write routes.

### 1b. Scope every `onConflictDoUpdate` arm to `user_id`
The rule is "every UPDATE/DELETE scoped to user_id, no exceptions" and the conflict arms are UPDATEs. Unscoped today:
- `lib/data/postgres/adapter.ts:2883-2886` (food_logs, `target: id`)
- `adapter.ts:2923-2933` (supplements)
- `adapter.ts:2979-2983` (activity_logs id-path)
- `adapter.ts:3004-3012` (injuries)
Add a `setWhere: eq(table.userId, mut.userId)` (or a pre-insert ownership check) to each, mirroring the plain UPDATE/DELETEs which are already scoped. Also `supplement_logs` insert (`adapter.ts:2899-2904`) never verifies `supplementId` ownership — food_logs already verifies its FKs (`2865-2874`); apply the same check.

### 1c. `ensureWorkoutSession` existing-row path must check ownership
`adapter.ts:660-663` selects the session by `id` only, then `logExerciseAndSets` inserts log rows into it with no ownership guard — a crafted `workoutSessionId` appends to another user's session (web + push, shared `logExerciseFromPayload`). Add `AND user_id = ?` to the existing-row select.

### 1d. `setSessionRpe` must flip `sync_status` to pending
`lib/local-store/sqlite-backend.ts:331-336` updates `session_rpe` but leaves `sync_status` (usually already `'synced'` after `markWorkoutSynced`). The workoutSessions `applyDelta` arm (`sqlite-backend.ts:643-650`) overwrites any `synced` row with no `updated_at` comparison → a pull landing before the RPE outbox mutation re-nulls the RPE just tapped (session-167 class). Set `sync_status='pending'` on the local RPE write.

### 1e. `markWorkoutSynced` must not flip un-pushed exercises
`components/workout-screen.tsx:686` + `sqlite-backend.ts:338-352` flip the whole session to `synced` when *any* one exercise's POST succeeds. If exercise A's POST failed (queued to outbox) and B's succeeded, A's local rows are marked `synced` too; if A later dead-letters, the stranded sweep can't recover it (rows no longer `pending`, and the dead outbox row defeats the `NOT EXISTS` at `sqlite-backend.ts:172-175`). Scope `markWorkoutSynced` to the exercise/set rows actually confirmed by the server response, not the whole session.

**Verify (code + APK):** unit-test the push loop with a mocked 429 (backoff, no break), a 4xx (quarantine, siblings proceed), a 5xx (backoff). Confirm each conflict arm's SQL carries the user guard. On the APK: log two exercises with one offline, go online, confirm the offline one still syncs and isn't silently marked done.

---

## Chunk 2 — Complete-workout offline path (one PR)

**Root cause (HIGH):** `components/workout-screen.tsx:857-861` — `completeWorkout` is
a bare `fetch("/api/complete-workout").catch(() => {})`. No local `completed_at`
write, no outbox domain (`lib/sync/mutation-schema.ts:9` has no `complete_workout`),
no `pushMutations` branch. The route carries heavy side effects: `completeWorkoutSession`,
`updatePrescriptionStatus('consumed')`, `incrementSessionsInPhase`, AI prescribe.
Finish a workout in a no-signal gym → the session is **never** marked complete, the
phase counter never increments, the prescription never consumes — permanently, since
nothing retries.

**Fix:** give completion a real outbox domain.
- Add `complete_workout` to `lib/sync/mutation-schema.ts` and a `pushMutations`
  branch in `adapter.ts` that mirrors `app/api/complete-workout/route.ts`'s
  semantics **exactly** (complete session, consume prescription, increment phase
  counter, trigger prescribe) — diff the two paths as part of review, ideally
  extract one shared repo function per the one-function-per-domain ideal.
- Write `completed_at` to the local `workout_sessions` row synchronously, then
  `queueMutation`, then fire the network push fire-and-forget (mirror the
  log-exercise reference pattern). UI feedback (done-screen flip) fires after the
  local write, not after the fetch.
- **`incrementSessionsInPhase` is a stored counter** — the replay path must be
  idempotent (a re-queued completion must not double-increment). Guard by session
  id / a completed flag, and pair it with the existing reconcile-on-read if one
  exists; if not, this is the moment to add one (the `reconcileSessionsInPhase`
  pattern the counter rule mandates).

**Verify (code + APK):** complete a workout with the network blocked → the done
screen shows, the session is `completed_at`-stamped locally, and on reconnect the
outbox pushes it once (phase counter increments exactly once, verified by DB read).

---

## Chunk 3 — Activity GPS fields + local read-merge (one PR)

### 3a. Stop discarding GPS run detail (HIGH)
`components/activity/done-activity-screen.tsx:111-140` — the local-store save path's
`queueMutation` payload omits `routePolyline`/`splits`/`bestEfforts`/`paceSeries`/
`avgPaceSecPerKm`/`elevationGainM`/`elevationLossM` (only the web fallback at
`:155-175` sends them); the local `activity_logs` table has no columns for them
(`lib/sqlite/migrations.ts:244-252`); and the `activity_logs` `pushMutations` branch
(`adapter.ts:2936-2984`) doesn't accept them. `savedLocally` short-circuits before
the web fallback → a run recorded on-device loses its entire route/pace/elevation
data on every save.
**Fix (the full chain in one pass, per the checklist):** add the columns to the
local `activity_logs` table (new local-SQLite migration — **register every new
column in `RECONCILE_COLUMNS` in the same commit**, and remember `ADD COLUMN` is not
idempotent so guard the partial-apply case), widen the `queueMutation` payload, widen
the `pushMutations` branch, and add them to `getSyncDelta` + `pullDelta` +
`applyDelta`. Also pick up `notes`/`end_time` (activity) and `distance_km`
(body_metrics) which are pushed/stored server-side but missing from the local
columns + pull mapping (`sync-engine.ts:177-191`).

### 3b. Single-field body-metric saves must read-merge (HIGH)
`components/health/metric-log-sheet.tsx:62-78` and
`session-select-content.tsx:751-768` call `store.upsertBodyMetric` with every other
field hardcoded `null`; the local upsert overwrites all columns unconditionally
(`lib/local-store/sqlite-backend.ts:459-480`). The server merges via `COALESCE`
(`adapter.ts:1497-1528`) but the local store — the read source of truth — does not.
Log weight at night → today's steps/water/macros/HRV vanish from Health, and the
`applyDelta` `WHERE sync_status='synced'` gate blocks self-repair while pending.
**Fix:** read the existing local row and merge before upserting (copy the correct
pattern in `components/profile/water-log-sheet.tsx:33-51`), or make
`upsertBodyMetric` COALESCE-merge unspecified fields against the existing local row.
Apply to both call sites.

### 3c. Saved-meal logging must mirror `food_items` locally
`lib/nutrition/log-meal.ts:17-31` writes `food_logs` + outbox but never
`upsertFoodItem` (unlike `log-food.ts:176-184`). A saved-meal item not already in
local `food_items` renders nothing — `getFoodLogsWithItems`' JOIN drops the row
(`sqlite-backend.ts:1029-1037`) — the original #1 food-disappearing mechanism.
**Fix:** mirror the meal's food items into the local `food_items` table on log,
same as the single-food path. (Separately note, don't necessarily fix here: new-food
creation via `createFoodItem` is a mandatory network pre-fetch — logging a *brand
new* food fails entirely offline; a `food_items` outbox domain is the real fix,
flag it as a follow-up if out of scope for this chunk.)

**Verify (code + APK):** record a GPS run offline → its route/pace/elevation persist
locally and push on reconnect. Log a single body metric → the day's other metrics
survive. Log a saved meal whose items aren't cached → they render immediately.

---

## Chunk 4 — Delete tombstones (one PR, **claims Postgres migration 111**)

**Root cause (HIGH):** the server has `deleted_at` only on `body_metrics`,
`mood_logs`, `day_checkins` (`schema.ts:214,325,347`). All other deletes are hard
DELETEs — food logs (`adapter.ts:2861`), activity (`1778-1781`), supplements
(`3177-3180`), injuries, supplement logs — and `getSyncDelta` never emits
`deletedAt` for foodLogs (`adapter.ts:2569-2575`), workoutSessions, exerciseLogs,
setLogs, supplementLogs, injuries. Yet the client maps `r.deletedAt` for all of them
(`sync-engine.ts:114,133,151,282,302,315`) and `applyDelta` has tombstone-delete
branches (`sqlite-backend.ts:634-637,657,687,869,892,912`) that **can never fire**.
Delete a food log / workout / injury / supplement on the web → the phone renders it
forever (local-first reads).

**Fix:** make deletes soft + propagated.
- **Migration 111:** add `deleted_at timestamptz` to `food_logs`, `activity_logs`,
  `supplements`, `injuries`, `supplement_logs` (and any other hard-deleted synced
  domain). Idempotent `ADD COLUMN IF NOT EXISTS`.
- Convert the web + `pushMutations` delete paths for these domains to soft-delete
  (set `deleted_at`), scoped to `user_id`. **Reconcile the web/push delete
  semantics while here** — supplements currently hard-DELETE on web vs soft
  `active=false` on push (`adapter.ts:3177` vs `2909`); pick one.
- Emit `deletedAt` in `getSyncDelta` for every one of these domains (add to the
  SELECT lists) so the already-present `applyDelta` tombstone branches finally
  fire.
- Filter `deleted_at IS NULL` in every server read that lists these rows, and
  confirm the local reads already honour the tombstone.
- Update `rowToX` mappers / SELECT lists for the new column (a missed field is a
  silent "delete doesn't persist").

**Verify (code + APK):** delete a food log / supplement / injury on web → after a
pull on the phone it disappears. Confirm no row is *hard*-deleted out from under a
FK (per the "never delete-and-reinsert rows other tables FK onto" rule — soft-delete
sidesteps this).

---

## Cross-chunk wrap-up

- Per chunk: `pnpm tsc --noEmit && pnpm lint && pnpm test`; add/extend push-loop and
  parity unit tests (this domain has almost none — Batch N's parity-tests item is
  the broader effort, but each chunk here adds the tests for what it touches).
- **Declare in every PR:** native SQLite / outbox replay / cross-device pull /
  Samsung WebView are all unexercised in the sandbox — verify on the S25 via
  `docs/device-smoke-checklist.md` (offline round-trip section).
- Chunks 1–3 are bug fixes to shipped features (patch bump, merge-gate-exempt).
  Chunk 4 ships a migration and a delete-semantics change — treat as higher-risk:
  get CI green, summarise, and **ask before merging** (it deploys a schema change to
  prod). Version-bump per shipped chunk; changelog each.
- Remove/annotate this backlog entry as chunks land (leave the entry with remaining
  chunks noted until all four are done).
