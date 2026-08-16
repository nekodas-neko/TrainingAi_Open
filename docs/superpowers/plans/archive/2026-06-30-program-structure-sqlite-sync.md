# Implementation Plan — Program structure in the SQLite pull delta (offline program reads)

**Status:** Not started · **Created:** 2026-06-30 (session 168) · **Risk:** Medium (touches the load-bearing local-first sync layer; client half is device-only and cannot be runtime-tested in the web sandbox)

## Goal

Make the workout screen able to render a user's program (sessions → exercises, schedule, and per-set progression) **from the on-device SQLite store when offline**, instead of always depending on a live `/api/workout-data` fetch. The biometrics/workout/nutrition domains already do this; programs are the last domain still effectively API-only for structured offline reads.

Note: program data is **not currently broken offline** — `/api/workout-data` is cached via `cachedFetch` + a `sessionStorage` mirror, so after one online load it paints from cache. This task is a **robustness upgrade** (structured, durable local reads that survive a cold start with no network), not a bug fix. Scope it accordingly.

## Why it's bigger than the one-line backlog note implied

The backlog note ("Program structure not in SQLite pull delta") implied the data was already arriving and just needed writing locally. It isn't. Verified in session 168:

- **Server `getSyncDelta`** (`lib/data/postgres/adapter.ts`, ~lines 2210–2330) selects only the **flat** `programs` and `progression_styles` rows (`db.select().from(s.programs)…`). It does **not** include `program_sessions`, `session_exercises`, `schedules`, `schedule_days`, or `style_sets` — exactly the entities the workout screen needs.
- **`SyncDelta` type** (`lib/data/repository.ts:31`) has `programs: unknown[]` and `progressionStyles: unknown[]` and nothing else program-related.
- **`pullDelta`** (`lib/local-store/sync-engine.ts`, ~lines 167–178) maps those flat rows into minimal `LocalProgram` (`{id, name, isActive, updatedAt}`) and `LocalProgressionStyle` (`{id, name, updatedAt}`) — no sessions/exercises/sets.
- **Local stub tables** `local_programs` and `local_progression_styles` exist (migrations.ts v4, ~lines 173–184) but are minimal and (per the local-first audit) **not written by `applyDelta` nor read by any method**.
- **Workout screen** (`components/workout-screen.tsx`, `cachedFetch('workout-data:<tab>', '/api/workout-data?tab=…')`) reads from the API/`cachedFetch` cache, never from the local store.

So this requires expanding **both** halves: the server delta **and** the client SQLite layer.

## Design decisions (locked)

1. **Read-only on the client.** Programs are created/edited on the web/config UI, never mutated on mobile. So: no outbox domain, no `pushMutations` changes, no `sync_status`/soft-delete columns on the program tables — these are pure server→client mirrors (like `oura_daily` / `personal_records`).
2. **No FK constraints in local SQLite.** Denormalize relationships (store `program_id` on sessions, `session_id` on exercises, etc.) — matches the existing local schema style; avoids cascade/order bugs.
3. **Mirror the Postgres column set the workout screen needs**, not every column. Skip server-computed fields (phase status, 1RM target estimates, "logged today") — those stay server-side; the offline read renders the *structure* (session names, exercise list, progression sets), and computed extras degrade gracefully when offline.
4. **Delta keying.** Programs/styles already filter by `updatedAt > since` server-side. The nested children (sessions/exercises/schedule_days/style_sets) have no `updatedAt` and belong to a parent — pull **all children of any program/style whose parent changed** (i.e. when a program row is in the delta, re-send its full session/exercise/schedule subtree; same for styles → style_sets). This avoids per-child change tracking and keeps the local subtree consistent. On the client, **replace** a program's children on receipt (delete-then-insert by `program_id`) so renames/removals propagate.
5. **Workout-screen fallback order:** keep `cachedFetch`/API as the primary online path; add a **local-store seed** (read the assembled program from SQLite) used when the API/cache is unavailable — mirror how `health-content.tsx` seeds biometrics from the local store before the network resolves. Do **not** rip out the existing cache path.

## Implementation steps

### 1. Server — expand `getSyncDelta` (`lib/data/postgres/adapter.ts`)
- Add parallel selects for the children of the user's programs/styles:
  - `program_sessions` (where `program_id IN (user's program ids)`)
  - `session_exercises` (where `session_id IN (those sessions)`)
  - `schedules` + `schedule_days` (by program)
  - `style_sets` (where `style_id IN (user's style ids)`)
- Decide the change-window: simplest correct approach — when **any** program/style row matches `updatedAt > since`, include that program/style's full child subtree. (For a single-user app the program set is tiny; selecting all children for all of the user's programs every sync is also acceptable and simpler — measure, prefer the simpler one unless payload is large.)
- Return the new arrays in the `SyncDelta`.

### 2. Types — extend `SyncDelta` (`lib/data/repository.ts`) and `lib/local-store/types.ts`
- `SyncDelta`: add `programSessions`, `sessionExercises`, `schedules`, `scheduleDays`, `styleSets` (`unknown[]`).
- Extend `LocalProgram` to the fields the screen needs (`trainingGoal`, `phaseMode`, `startedAt`, …) and add `LocalProgramSession`, `LocalSessionExercise`, `LocalSchedule`, `LocalScheduleDay`, `LocalStyleSet` interfaces.

### 3. Local migration — `lib/sqlite/migrations.ts` (v9)
- Append `{ toVersion: 9, statements: [...] }` with `CREATE TABLE IF NOT EXISTS` for: extend/replace `local_programs` columns as needed, `program_sessions`, `session_exercises`, `schedules`, `schedule_days`, `style_sets`. **No FK constraints.** Add indexes on `program_id` / `session_id` / `style_id`.
- **Also add the same `CREATE TABLE IF NOT EXISTS` statements to `RECONCILE_TABLES`** (top of migrations.ts) so `reconcileSchema()` self-heals devices that fail the upgrade (this backstop is what saved the WAL incident — use it).
- ⚠️ Do **not** put any `PRAGMA journal_mode` or transaction-level pragma in the migration (the v4 WAL-in-transaction bug; see CLAUDE.md / projectOverview session 166).

### 4. Local write — `applyDelta` in `lib/local-store/sqlite-backend.ts`
- Add upsert loops for the 6 entities. For each program in the delta: upsert the program row, then **delete its existing children** (`program_sessions`/`session_exercises`/`schedules`/`schedule_days` by `program_id`/`session_id`) and insert the incoming subtree. Same for styles → `style_sets`.
- These are read-only mirrors — no `sync_status` guard needed (unlike body_metrics, which protects pending local writes).

### 5. Local read — `lib/local-store/sqlite-backend.ts`
- Add `getActiveProgramLocal()` (or `getPrograms()` + `getProgramTree(programId)`) that reassembles a `Program`-shaped object: program → sessions (ordered by `position`) → exercises (ordered by `position`), schedule + days, and resolves each exercise's progression sets from `style_sets`.
- Match the shape `components/workout/pre-workout-screen.tsx` expects (`WorkoutExercise[]`) so the screen can consume it directly.

### 6. Sync-engine wiring — `lib/local-store/sync-engine.ts`
- Map the 5 new delta arrays (sessions/exercises/schedules/scheduleDays/styleSets) into the local types and pass them into the `store.applyDelta({...})` call.
- Extend the synced-domains signal so `domains.programs` is true when any program/style/child rows arrived (it already returns a `programs` boolean — confirm it covers the children).

### 7. Workout-screen seed — `components/workout-screen.tsx`
- Before/alongside the `cachedFetch('workout-data:…')` call, seed program structure from `getLocalStore(userId)?.getActiveProgramLocal()` when present (hydration-safe — in `useEffect`, mirroring the `health-content.tsx` local-seed pattern). Network response still overwrites once available.

### 8. Cache invalidation — already wired
- `sync-provider.tsx` already calls `invalidateProgramStructure()` when `domains.programs` is set, and `lib/cache-groups.ts` already has it. Confirm it invalidates `workout-data` keys. No new code expected here.

## Test plan

### Sandbox-testable (do these here)
- **Server delta:** unit/integration check that `getSyncDelta` returns the nested arrays for a seeded program (use the local Postgres dev DB + the `test@local.dev` user; seed a program with sessions/exercises/schedule/style sets). Assert the subtree comes back and respects `since`.
- `npx tsc --noEmit`, `pnpm lint`, `pnpm test`, `pnpm build` all clean.
- Optionally a pure unit test for the reassembly mapper (feed rows → expect a `Program` tree) — keep the mapper pure so it's testable without SQLite.

### Device-only (user verifies on the S25 after deploy) — **cannot be done in the sandbox**
1. Fresh APK launch: v9 migration runs, no `[initSQLite] failed` in the console.
2. Pull-to-sync while online: program rows land in local SQLite (`programs`, `program_sessions`, `session_exercises`, `schedules`, `schedule_days`, `style_sets` populated).
3. Airplane mode → open the workout screen cold: session tabs, exercise list, and per-set targets render from the local store.
4. Edit the program on web → pull-to-sync on device → the change (renamed session, added/removed exercise) reflects locally (replace-children works).
5. No regression online: the workout screen still loads/paints normally with network.

## Risks & mitigations
- **Untestable client half in sandbox** → keep the reassembly logic in a **pure, unit-tested mapper**; rely on `reconcileSchema` backstop; ship CI-green and gate real confidence on the device checklist above.
- **Load-bearing sync layer** (caused 3 prod outages — see CLAUDE.md) → read-only mirror, no new outbox/push paths, no pragmas in migrations, additive tables only.
- **Payload size** if re-sending full subtrees each sync → for a single-user app this is negligible; revisit only if syncs get heavy.
- **Schema drift** between Postgres and the local mirror → mirror only the needed columns and add them to `RECONCILE_TABLES`; a missed column fails silently offline, so cross-check against `lib/data/postgres/schema.ts` during step 2/3.

## Files to touch
| File | Change |
|------|--------|
| `lib/data/postgres/adapter.ts` | Expand `getSyncDelta` with the 5 child selects |
| `lib/data/repository.ts` | Add 5 fields to `SyncDelta` |
| `lib/local-store/types.ts` | Extend `LocalProgram`; add 5 child interfaces |
| `lib/sqlite/migrations.ts` | v9 tables + `RECONCILE_TABLES` entries |
| `lib/local-store/sqlite-backend.ts` | `applyDelta` write loops + `getActiveProgramLocal()` reassembly |
| `lib/local-store/sync-engine.ts` | Map + pass the 5 new arrays; confirm `domains.programs` |
| `components/workout-screen.tsx` | Seed program from local store (offline) |
| `lib/__tests__/…` | Pure reassembly-mapper test + (optional) getSyncDelta test |
| `components/sync-provider.tsx`, `lib/cache-groups.ts` | Verify only — likely no change |

## Reference (verified session 168)
- Server delta: `lib/data/postgres/adapter.ts` `getSyncDelta` (~2210–2330) — flat programs/styles only.
- `SyncDelta`: `lib/data/repository.ts:31`.
- `pullDelta` program mapping + `applyDelta` call: `lib/local-store/sync-engine.ts` ~167–234.
- Local migrations + stubs: `lib/sqlite/migrations.ts` (v8 latest; stubs ~173–184). **Next migration → v9.**
- Program schema: `lib/data/postgres/schema.ts` — `programs`, `programSessions`, `sessionExercises`, `schedules`, `scheduleDays`, `progressionStyles`, `styleSets`.
- Existing assembly to mirror: `getActiveProgram` in `lib/data/postgres/slices/programs.ts`.
- Pattern to copy end-to-end: `body_metrics` (type → migration → delta map → applyDelta write → read method → screen seed).
