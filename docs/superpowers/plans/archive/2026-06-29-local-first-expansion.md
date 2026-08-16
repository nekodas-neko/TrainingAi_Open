# Local-First Sync Expansion — Workout Outbox Unification + Reads + Oura Cache (Track A/B + D)

Status: ✅ IMPLEMENTED (phases 1–4, branch `claude/backlog-plan-review-byy3je`) · pending on-device validation · Created 2026-06-29 · Plan authored on Opus; implementation on Sonnet

> **Shipped:** Phase 1 (additive infra) `27b1bb5`/`b4ebbb4`, Phase 2 (write cutover + legacy removal) `1edc63f`, Phase 3+4 (local-first reads + Oura cache) `6a744d9`. `next build` + `tsc` + `eslint` clean. Opus-reviewed each phase; caught and fixed a PR-celebration regression and the local/server id-duplication risk. **Not yet validated on the S25 Ultra APK** — the SQLite write/sync paths are Capacitor-native and no-op on web, so the round-trip (log offline → outbox push → Railway → pullDelta → local reads) can only be confirmed on device.

## Context (corrected after investigation)

The original backlog said "workout logging still hits Railway directly on every log action." **That is stale.** Investigation of `components/workout-screen.tsx` shows workout *writes* are already local-first and optimistic:
- `writeLocalWorkout()` writes to local SQLite first,
- `/api/log-exercise` is fired **fire-and-forget** ("server sync runs in background so the UI transition is instant"),
- failures fall back to `addToOutbox()` → `drainOutbox()`,
- the client even mirrors the server's `useFor1rm` / 1RM math offline.

The genuine gaps are different:

1. **Two parallel outbox systems.** Workouts use the **legacy** system (`lib/sqlite/outbox.ts`: `writeLocalWorkout`/`addToOutbox`/`drainOutbox`; v1 tables `workout_sessions`/`exercise_logs`/`set_logs` with a boolean `synced` flag + `sync_outbox` table). Everything else uses the **current** system (`lib/local-store/`: `mutations_outbox` + `sync_status`/`deleted_at` + `pullDelta`/`pushMutations`/`applyDelta`). `sync-provider.tsx` and pull-to-sync call **both**.
2. **No server→local pull for workouts.** The legacy system has no pull. Local workout tables only contain workouts logged *on this device*. After a reinstall / on a new device / after `clearLocalStoreData`, local workout history is **empty**. So local-first reads would only cover *today's* freshly-logged sets, not history.
3. **All workout reads are server-side.** Every history/stats screen reads via `repo.getWorkoutSessionsFrom` (`weekly-stats`, `training-load`, `muscle-recovery`, `exercise-history`, `readiness-score`, `day-timeline`, …). Nothing reads the local `getWorkoutSessions`.
4. **Personal records have no local store entry.**
5. **Oura has no local cache** — readiness/sleep/HR screens fetch from Railway each load.

**Decision (user-approved):** do the full unification (option D) — migrate workouts onto the current sync engine, delete the legacy outbox, add server→local pull, then local-first history reads and PRs — plus the Oura local cache (B).

## Key architectural constraint

A workout-log mutation is **not** a dumb row upsert. `/api/log-exercise` does authoritative server-side computation: phase resolution (`getActiveProgramWithPhases`, `getCurrentPhase`, `isDeloadActive`), bodyweight substitution, 1RM/target80 estimation, and PR comparison (`upsertPersonalRecordIfBetter`). The legacy outbox exists precisely because it replays this computation server-side.

**Therefore:** extract the body of `app/api/log-exercise/route.ts` POST into a shared server function `logExerciseFromPayload(userId, payload, tz)` in `lib/workout/log-exercise.ts`. Both the route **and** the unified `pushMutations('workout_log')` handler call it — one source of truth for the computation, identical results whether logged online or replayed from the outbox. The mutation payload is exactly the existing `LogExerciseSchema` shape.

---

## Phase 1 — Additive infrastructure (no behavior change; low risk)

Goal: stand up the new tables, types, store methods, pull, and the unified push handler **without** touching the live write path yet. Build stays green; existing logging unchanged.

1. **`lib/workout/log-exercise.ts` (new)** — extract the POST body of `app/api/log-exercise/route.ts` into `export async function logExerciseFromPayload(userId, payload: LogExercisePayload, tz): Promise<{ workoutSessionId, exerciseLogId, estimated1rm, target80, isPR }>`. Move the `LogExerciseSchema` there too (export it). The route becomes a thin wrapper: auth + rate-limit + parse + `logExerciseFromPayload`. **Drop the `PostgresWorkoutRepository` cast** — call `repo.logExerciseAndSets` via the repository interface (add it to the interface if missing). This also closes Track C3's log-exercise item.

2. **`lib/sqlite/migrations.ts` v7** — additive ALTERs + new tables:
   - `ALTER TABLE workout_sessions ADD COLUMN deleted_at TEXT`; add `sync_status TEXT NOT NULL DEFAULT 'synced'`. (Keep the existing `synced` column for now; removed in Phase 2.)
   - Same `deleted_at` + `sync_status` on `exercise_logs` and `set_logs`.
   - `CREATE TABLE personal_records (exercise_name TEXT PRIMARY KEY, exercise_id TEXT, estimated_1rm REAL NOT NULL, achieved_at TEXT, updated_at TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'synced')`.
   - `CREATE TABLE oura_daily (day TEXT PRIMARY KEY, readiness_score INTEGER, sleep_score INTEGER, activity_score INTEGER, temperature_deviation REAL, active_calories INTEGER, contributors TEXT, updated_at TEXT NOT NULL)` (read-only mirror; JSON contributors as TEXT).
   - Indexes: `idx_exercise_logs_session` (workout_session_id), `idx_set_logs_exercise` (exercise_log_id), `idx_exercise_logs_name` (exercise_name), `idx_oura_daily_day` (day).

3. **`lib/local-store/types.ts`** — add `LocalExerciseLog`, `LocalSetLog`, `LocalPersonalRecord`, `LocalOuraDaily`; extend `LocalWorkoutSession` with `deletedAt`/`syncStatus`; extend `PendingMutation.domain` union with `'workout_log'`. (Oura is read-only → no mutation domain.)

4. **`lib/local-store/index.ts` (`LocalStore` interface)** — add reads (`getExerciseLogs(workoutSessionId)`, `getSetLogs(exerciseLogId)`, `getWorkoutHistory(cutoffDate)` returning sessions+logs+sets joined, `getPersonalRecords()`, `getPersonalRecord(name)`, `getOuraDaily(cutoffDay)`), the atomic write `logWorkoutLocally(payload, syncStatus)`, and `applyDelta` entries for `exerciseLogs`/`setLogs`/`personalRecords`/`ouraDaily` (+ updated `workoutSessions`). Add these tables to `clearLocalStoreData()`.

5. **`lib/local-store/sqlite-backend.ts`** — implement all of the above. `logWorkoutLocally` wraps the session + exercise_log + all set_logs in **one transaction** (begin/commit; rollback on error) so a crash never leaves an exercise_log without its sets. Follow `food_logs`/`upsertFoodLog` for the row-mapping and `sync_status` conventions.

6. **`lib/data/repository.ts`** — extend `SyncDelta` with `exerciseLogs`, `setLogs`, `personalRecords`, `ouraDaily`; extend `MutationDomain` with `'workout_log'`; add `logExerciseAndSets` + `upsertPersonalRecordIfBetter` to the interface if not already present.

7. **`lib/data/postgres/adapter.ts`**
   - `getSyncDelta` — add to the `Promise.all`: exercise_logs + set_logs joined to the user's workout_sessions changed since `effectiveSince`; personal_records since `effectiveSince`; `oura_daily` since `effectiveSince` (map `contributors` JSONB → JSON string). Return them.
   - `pushMutations` — add an `else if (mut.domain === 'workout_log')` branch that calls `logExerciseFromPayload(userId, mut.payload, tz)` (resolve `tz` from the user once at the top of the loop). On error, push to `errors[]` and continue (matches the existing per-domain pattern).

8. **`lib/local-store/sync-engine.ts`** — in `pullDelta`, map the new arrays and pass to `applyDelta` (mark `syncStatus:'synced'`); add their lengths to the synced count; add a `workouts` flag to the returned `domains` (for scoped cache invalidation in Phase 3). In `pushMutations`, after a successful push of a `workout_log` mutation, mark the local workout rows `synced` (mirror the food_logs marking).

**Phase 1 verification:** `pnpm exec tsc --noEmit` + `pnpm exec eslint` clean. `pnpm dev` against local Postgres — log a workout as today: behaviour identical to before (still uses the legacy path; new code is dormant). `POST /api/sync/pull` returns the new arrays without error. Commit.

## Phase 2 — Cut writes over to the unified outbox; delete legacy (the risky part)

Goal: route live logging through the current system; remove the legacy outbox. This touches the most important UX flow — do it as its own commit, test hard.

### 2.0 — CRITICAL prerequisite: client-generated ids (prevents pull duplicates)

Phase 1's `logWorkoutLocally` and the server's `logExerciseAndSets` each generate their **own** `exerciseLogId` and set-log ids. If left as-is, after a `workout_log` mutation is pushed, the next `pullDelta` would bring the server's rows back with *different* ids and **duplicate** them locally. The legacy outbox avoided this by carrying client-generated ids. Replicate that:

- **Extend `LogExercisePayloadSchema`** (`lib/workout/log-exercise.ts`) with optional `exerciseLogId: z.string().uuid().optional()` and `setLogIds: z.array(z.string().uuid()).optional()`. `workoutSessionId` is already in the schema.
- **`components/workout-screen.tsx`** generates `exerciseLogId` and a `setLogIds[]` (one per set) at log time and includes them in the payload — same UUIDs used for the local write, the outbox mutation, and the server insert.
- **`logExerciseFromPayload` / `repo.logExerciseAndSets`** must **honor** provided ids: insert the exercise_log with the given `exerciseLogId` and each set with the given id, `ON CONFLICT(id) DO UPDATE` (idempotent — a re-pushed mutation updates rather than duplicates). When ids are absent (web fallback / old clients), fall back to generated UUIDs as today.
- **`logWorkoutLocally`** uses `payload.exerciseLogId` / `payload.setLogIds[i]` instead of `crypto.randomUUID()` so the local row id == the server row id == the id that comes back via `pullDelta`. Pull then upserts by the same PK — no duplicate.
- **Store the client's offline 1RM estimate locally.** Phase 1 writes `estimated_1rm = NULL` locally (computed server-side). For offline-correct history reads (Phase 3), pass the offline estimate (already computed in `workout-screen`'s `offlinePayload`) into `logWorkoutLocally` and persist it; `pullDelta` later overwrites it with the authoritative server value.
- **Fix the synced-marking:** replace the sync-engine's `pushMutations` call that re-runs `store.logWorkoutLocally(payload, 'synced')` (which would re-insert) with a lightweight `store.markWorkoutSynced(workoutSessionId)` that does `UPDATE ... SET sync_status='synced'` across the session + its exercise_logs + set_logs. Add `markWorkoutSynced` to the `LocalStore` interface + backend.

### 2.1 — Wire the write path

1. **`components/workout-screen.tsx`** — in the log handler (around the current `writeLocalWorkout` + fire-and-forget `fetch('/api/log-exercise')` + `addToOutbox`):
   - Generate `exerciseLogId` + `setLogIds[]` (see 2.0); include them in the payload.
   - Replace `writeLocalWorkout(...)` with `store.logWorkoutLocally(payload, 'pending')` (payload carries ids + offline estimate).
   - Replace the direct `fetch('/api/log-exercise')` + `addToOutbox` with `store.queueMutation({ userId, domain:'workout_log', date: rawDate, payload })` then a background `pushMutations(userId)` (fire-and-forget, like today).
   - Keep the optimistic UI, the offline 1RM/`useFor1rm` mirror, the haptics, and the cache invalidations. PR celebration uses the optimistic local estimate immediately; the authoritative `isPR` reconciles when `pushMutations` returns (acceptable — document it).
   - Preserve the **web fallback**: when `getLocalStore` is null (no SQLite, web), POST directly to `/api/log-exercise` as today (now sending the ids too, which the server honors).
2. **`components/sync-provider.tsx`** — remove the `drainOutbox()` calls (network-reconnect + mount); `pushMutations` now covers workouts. Keep everything else.
3. **Delete `lib/sqlite/outbox.ts`** and all imports of `writeLocalWorkout`/`addToOutbox`/`drainOutbox`. Leave the v1 `sync_outbox` table in the schema (harmless; dropping it is a separate migration if desired).

**Phase 2 verification:** `tsc`/`eslint` clean. `pnpm dev`: log a multi-set exercise + an AMRAP → instant UI; rows land in local SQLite (`sync_status='pending'`) and reach Railway via `pushMutations`; `sync_status` flips to `synced`. Simulate offline (DevTools) → log → reconnect → outbox drains, no duplicate rows. Confirm PR flag and haptics still fire. Confirm a fresh `pullDelta` (clear cache) repopulates workouts + PRs locally. Commit.

## Phase 3 — Local-first history reads

Goal: make history/PR screens instant from the local store, server as fallback.

- Add Dexie/SQLite fast-path reads (read local first, then `cachedFetch` to revalidate) on the high-value history screens: `components/exercise-history-sheet.tsx` (per-exercise history + 1RM trend), the Health calendar/day-log path, and strength/PR cards (`components/health/strength-trend-card.tsx`, `strength-progress-card.tsx`). Use the existing `cachedFetch`/`readCacheSync` pattern; seed from `store.getWorkoutHistory` / `store.getPersonalRecords` before the network resolves.
- **Leave server-side aggregations as-is** (`training-load`, `readiness-score`, `muscle-recovery`, `weekly-stats`) — they already use `cachedFetch` and converting their aggregation logic client-side is out of scope and low value.
- Wire the Phase 1 `domains.workouts` flag: after `pullDelta`, call the workout-summary cache invalidations (`invalidateWorkoutSummaries` in `lib/cache-groups.ts`).

**Phase 3 verification:** cold load (cleared API cache, populated local store) → exercise history + PR cards render from local before any network. Confirm numbers match the server.

## Phase 4 — Oura local cache (B)

Goal: instant readiness/sleep/HR/activity screens.

- `oura_daily` is already pulled in Phase 1. Add fast-path reads on `/health/readiness`, `/health/sleep`, `/health/heart-rate`, `/health/activity` and the home readiness card: seed from `store.getOuraDaily` before `cachedFetch`. No outbox (read-only).
- Optionally add `LocalOuraSleep`/`LocalOuraHeartRate` later if the detail charts need a fast-path; defer unless needed.

**Phase 4 verification:** cold load → readiness/sleep render from local first; values match server after revalidate.

---

## Global rules for the implementer
- All date strings via `todayInTz()` (`lib/date-utils.ts`) — never `toISOString().slice(0,10)`.
- Next migration **must be additive** and idempotent (`IF NOT EXISTS`); the SQLite plugin only runs unseen versions.
- Don't break the web (no-SQLite) path — every local-first write needs the existing `fetch` fallback.
- One commit per phase, each with `tsc`+`eslint`+`pnpm dev` smoke test green before moving on.
- Do **not** convert the server aggregation routes to local-first (out of scope).

## Out of scope / recorded decisions
- Exercise library stays cache-only (6h `cachedFetch`) — no local domain.
- Server aggregation routes stay server-side.
- Device (S25 Ultra APK) validation of the SQLite migration + offline round-trip is tracked separately — not testable in sandbox.

## Sequencing & ownership
Opus authored this plan. **Implementation on Sonnet, phase by phase, with an Opus review of the diff between phases.** Phase 1 is additive and safe to do in full; Phase 2 is the risk point — review carefully before Phase 3/4.
