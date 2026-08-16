# Set-Log Planned Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal (Chunk 1):** Snapshot the **planned** per-set percentage and rest onto each `set_logs` row at
log time, so the plan-vs-actual delta (did I hit the prescribed load? did I actually rest as long as
the plan asked?) is queryable later without re-deriving the program state that existed on the day.
Today `set_logs.intensity_pct` is the *computed actual* load ÷ estimated-1RM (not the target) and
`rest_time_sec` is the *measured actual* rest — there is no column holding what the plan asked for.
The planned targets already arrive at the log path (`progressionStyle: [{ pct, restSec, … }]` per set)
and are simply dropped after 1RM estimation. Two new nullable columns capture them.

**Goal (Chunk 2, PARKED):** per-rep time-under-tension. There is **no per-rep timing anywhere today**
— the finest granularity is the whole-set `setStartMs`/`setEndMs`/`setTimeSec`. Capturing TUT needs
new tempo instrumentation in the active-workout UI and a new per-rep payload + child table. That is
device-UI work behind the S25-APK on-device gate and is **not a blocker for Chunk 1** — it is written
up as a parked sub-section only.

**Architecture:** Chunk 1 is a pure data-capture change: a migration + one snapshot assignment in the
shared write function + the full offline-sync chain that mirrors it onto the device and back. **No new
formula, no UI change, no read-render requirement** — the columns are write-and-store for later
analysis. Because both the web route and the `pushMutations` outbox branch call the single shared
`logExerciseFromPayload` (`lib/workout/log-exercise.ts`), the snapshot logic is written **once**; the
outbox payload **already carries** `progressionStyle` (`components/workout-screen.tsx:946` →
`queueMutation` → `pushMutations` → `logExerciseFromPayload`), so **no `queueMutation`/mutation-schema
change is needed** — only the storage layers on both ends grow the two columns.

**Tech Stack:** TypeScript, Drizzle/Postgres (`set_logs`), Capacitor SQLite local store
(`lib/local-store/*`, `lib/sqlite/migrations.ts`), the sync delta/pull path
(`getSyncDelta` → `/api/sync/pull` → `sync-engine.ts` → `applyDelta`), vitest.

---

## Why now

The app prescribes per-set targets (`progressionStyle[i].pct` / `.restSec`) and logs actuals, but the
two are never stored side by side on the same row. Any later "adherence" analysis (did the user train
at the prescribed intensity? is rest discipline slipping?) currently has to reconstruct the plan that
was active on a past day — which is lossy once the program/style is edited (styles are upserted in
place; a config save changes today's targets, so yesterday's plan is unrecoverable). Snapshotting the
plan onto the log row at write time makes the delta durable and cheap to query, and it is a small,
self-contained, sandbox-verifiable change disjoint from the Oura/health cluster.

**Branch:** `feat/set-log-planned-snapshot`

**Lane:** Workout correctness (Lane 1) — touches `lib/workout/log-exercise.ts`, `set_logs`
schema, and the workout sync chain only. Disjoint from the Oura BLE / health-derived cluster
(`oura_daily_derived`, readiness, illness/stress wiring), so it can run in parallel with those.

## Design decisions (made in the planning session — encode, don't re-litigate)

1. **Two nullable columns on the existing `set_logs` row — not a new table.** `planned_pct`
   (`double precision`, matches `pct`'s type) and `planned_rest_sec` (`integer`, matches `rest_sec`).
   Nullable because: (a) historical rows have no snapshot, (b) freeform/off-program logs and the
   legacy bulk-sync path have no plan to snapshot. A null means "no plan captured", never 0.
2. **Snapshot verbatim from `progressionStyle[i]`, do not recompute.** The value stored is exactly
   what the plan asked for that set — `progressionStyle[i].pct` and `.restSec` — taken at the same
   point `setData` is built in `logExerciseFromPayload`. No clamping, no fallback to a default: absent
   → null. (Actual `intensity_pct` and `rest_time_sec` keep their current meaning untouched — this is
   purely additive.)
3. **These columns are write-and-store; no read-render obligation in this PR.** The new `SetLog`
   fields are **optional** (`plannedPct?`, `plannedRestSec?`), so the many existing set-log SELECT
   mappers that don't select them stay valid without change. Only the write path and the sync
   round-trip (which must not silently drop the snapshot on a device sync) are updated.
4. **Local additive columns ship via `RECONCILE_COLUMNS` only — no local DB version bump, no versioned
   `ALTER`.** This is the established Batch-F / SYN-6/8 pattern (`lib/sqlite/migrations.ts`): additive
   columns are added by `reconcileSchema()` (which runs on every open) rather than a versioned
   `ALTER TABLE ADD COLUMN`, sidestepping the non-idempotent-`ADD COLUMN` rollback class (#85). The
   base `CREATE_SET_LOGS` in `RECONCILE_TABLES` keeps its original shape (as it already does for
   `set_start_ms`/`set_end_ms`, which are reconcile-only), and the columns are added to
   `RECONCILE_COLUMNS`.
5. **The legacy `logSets` bulk path (`app/api/sync-workout/route.ts:148`) stays snapshot-free.** It has
   no `progressionStyle` in scope and is not the canonical log path (the canonical path is
   `logExerciseFromPayload` → `logExerciseAndSets`). Its inserts simply leave the two columns null.
   Do **not** invent a plan for it.

## Verified current state (2026-07-16)

- `set_logs` schema — `lib/data/postgres/schema.ts:184-199`: columns are `id, exerciseLogId, setNumber,
  weightKg, reps, setTimeSec, restTimeSec, intensityPct, useFor1rm, setStartMs, setEndMs, rpe,
  updatedAt, deletedAt`. No planned-pct/planned-rest column. `intensityPct` = `doublePrecision`,
  `restTimeSec`/`setTimeSec` = `integer`.
- `SetLog` type — `lib/types/log.ts:3-16` (all timing/intensity fields are `?`-optional).
- Shared write fn — `lib/workout/log-exercise.ts:65` `logExerciseFromPayload`; `progressionStyle`
  destructured at `:82`; `setData` built per set at `:183-197` (`progressionStyle?.[i]?.useFor1rm` is
  already read here — the snapshot reads `.pct`/`.restSec` at the same spot); `setData` is handed to
  `repo.logExerciseAndSets` at `:199-214`.
- Server insert — `lib/data/postgres/adapter.ts` `logExerciseAndSets` `s.setLogs` insert at `:899-909`
  + `onConflictDoUpdate` set-arm at `:910-924`. (`logSets`, `:791-810`, is the legacy bulk path — see
  decision 5.)
- Outbox already carries the plan — `components/workout-screen.tsx:929-946` builds `logPayload` with
  `progressionStyle: ex.progressionStyle ?? undefined`; `queueMutation({ domain: 'workout_log',
  payload: logPayload })` at `:998/:1002`; `pushMutations` re-parses with `LogExercisePayloadSchema`
  and calls `logExerciseFromPayload` at `adapter.ts:3293-3302`. **No mutation-schema change needed.**
- Sync delta (server → device) — `getSyncDelta` `s.setLogs` select at `adapter.ts:2880-2898` (camelCase
  projection). `SyncDelta.setLogs` is typed `unknown[]` (`repository.ts:225`).
- Pull mapping (device) — `lib/local-store/sync-engine.ts:152-168` maps the raw delta rows to
  `LocalSetLog`.
- `applyDelta` upsert (device) — `lib/local-store/sqlite-backend.ts:801-823` (INSERT + `ON CONFLICT`
  columns + bind params).
- Local write (device) — `sqlite-backend.ts:322-345` `INSERT OR REPLACE INTO set_logs` inside the local
  `workout_log` write; `LocalSetLog` type at `lib/local-store/types.ts:81-97`; `mapSetLog` read at
  `sqlite-backend.ts:138-156`.
- Local schema authority — `lib/sqlite/migrations.ts`: `RECONCILE_COLUMNS` at `:87-167` (set-log
  `set_start_ms`/`set_end_ms` are reconcile-only, `:97-98`), base `CREATE_SET_LOGS` at `:217-229`,
  `MIGRATIONS` highest `toVersion` = **13** (`:710`); the effective DB version is derived as
  `upgrades[last].toVersion` (`lib/sqlite/sqlite-service.ts:31`), so reconcile-only additions leave it
  at 13. `lib/sqlite/__tests__/migrations.test.ts:18-23` asserts every versioned-`ALTER` column is
  mirrored in `RECONCILE_COLUMNS` — reconcile-only columns don't trip it.
- **Next free Postgres migration number = `126`.** Disk highest = `124_rr_intervals.sql`; `125` is
  pre-allocated by `docs/superpowers/plans/2026-07-16-respiratory-illness-biomarker.md`
  (`125_breathing_baseline.sql`); `120` is pencilled for the ring walk-detection plan and
  `120_health_data_source.sql`; `105` is reserved-unused. `grep -rn "126_\|migration 126"
  docs/superpowers/plans/ docs/implementation-backlog.md` is empty. **Re-verify `126` is still free at
  implementation time** (`ls lib/data/postgres/migrations/` + the grep) and take the next free number
  if another PR claimed it in the interim.

## File structure

**Create:**
- `lib/data/postgres/migrations/126_set_log_planned_snapshot.sql` — two `ADD COLUMN IF NOT EXISTS`.

**Modify (Chunk 1):**
- `lib/data/postgres/schema.ts` — `plannedPct` / `plannedRestSec` on `setLogs`.
- `lib/types/log.ts` — `plannedPct?` / `plannedRestSec?` on `SetLog`.
- `lib/workout/log-exercise.ts` — snapshot into `setData`.
- `lib/data/postgres/adapter.ts` — `logExerciseAndSets` insert + conflict arm; `getSyncDelta` select.
- `lib/local-store/types.ts` — `LocalSetLog` gains the two fields.
- `lib/local-store/sync-engine.ts` — pull-delta mapping.
- `lib/local-store/sqlite-backend.ts` — local insert, `mapSetLog`, `applyDelta` upsert.
- `lib/sqlite/migrations.ts` — two `RECONCILE_COLUMNS` entries (reconcile-only).
- Tests: `lib/workout/__tests__/log-exercise.test.ts` (snapshot into `setData`),
  `lib/sqlite/__tests__/migrations.test.ts` (planned columns present in `RECONCILE_COLUMNS`).
- `lib/changelog.ts` + `package.json` version, journal + `projectOverview.md`, backlog removal (final).

---

### Task 1: Postgres migration + Drizzle schema + `SetLog` type

**Files:**
- Create: `lib/data/postgres/migrations/126_set_log_planned_snapshot.sql`
- Modify: `lib/data/postgres/schema.ts`, `lib/types/log.ts`

- [ ] **Step 1: Re-verify the migration number.** `ls lib/data/postgres/migrations/ | sort | tail -3`
  (expect `124_rr_intervals.sql` highest on disk) and
  `grep -rn "126_\|migration 126" docs/superpowers/plans/ docs/implementation-backlog.md` (expect
  empty). If `126` was taken since this plan was written, use the next free number and update every
  reference below.

- [ ] **Step 2: Write the migration** (`126_set_log_planned_snapshot.sql`):

```sql
-- Snapshot the PLANNED per-set target (pct + rest) onto each set_logs row at log time,
-- so the plan-vs-actual delta stays queryable after the program/style is later edited.
-- Nullable: historical rows, freeform logs, and the legacy bulk-sync path carry no plan.
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS planned_pct      double precision;
ALTER TABLE set_logs ADD COLUMN IF NOT EXISTS planned_rest_sec integer;
```

- [ ] **Step 3: Add the Drizzle columns** in `schema.ts` `setLogs` (insert before `updatedAt`, `:197`):

```typescript
  plannedPct:     doublePrecision('planned_pct'),
  plannedRestSec: integer('planned_rest_sec'),
```

- [ ] **Step 4: Extend the `SetLog` type** (`lib/types/log.ts`, after `rpe?: number` at `:15`):

```typescript
  plannedPct?: number
  plannedRestSec?: number
```

- [ ] **Step 5: Apply locally + typecheck + commit**

Run: `node scripts/local-db/migrate.js && npx tsc --noEmit 2>&1 | head -5`
Expected: migration applies (idempotent — safe to re-run); typecheck clean (optional fields break no
existing SELECT mapper).

```bash
git add lib/data/postgres/migrations/126_set_log_planned_snapshot.sql lib/data/postgres/schema.ts lib/types/log.ts
git commit -m "Add planned_pct/planned_rest_sec columns to set_logs (migration 126)"
```

---

### Task 2: Snapshot the plan in the shared write function

**Files:**
- Modify: `lib/workout/log-exercise.ts`
- Test: `lib/workout/__tests__/log-exercise.test.ts`

- [ ] **Step 1: Write the failing test.** Add a case asserting `setData`/the persisted set carries the
  planned snapshot from `progressionStyle`. Follow the file's existing harness (it exercises
  `logExerciseFromPayload` against the repository); assert that for a payload with
  `progressionStyle: [{ pct: 80, reps: 5, restSec: 180 }, { pct: 70, reps: 8, restSec: 120 }]` the
  written set rows have `plannedPct` `80`/`70` and `plannedRestSec` `180`/`120`, and that a payload
  with **no** `progressionStyle` writes `plannedPct == null`/`plannedRestSec == null`. If the existing
  test file mocks the repo and inspects the `logExerciseAndSets` `sets` argument, assert on that
  argument; otherwise read the rows back via the local Postgres.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/workout/__tests__/log-exercise.test.ts`
Expected: FAIL — snapshot not populated.

- [ ] **Step 3: Implement.** In `logExerciseFromPayload`'s `setData` map (`:183-197`), add to the
  returned object (next to the existing `useFor1rm: progressionStyle?.[i]?.useFor1rm ?? …` line):

```typescript
      plannedPct:     progressionStyle?.[i]?.pct ?? undefined,
      plannedRestSec: progressionStyle?.[i]?.restSec ?? undefined,
```

(`undefined` — not `null` — so the `?? null` at the insert sites owns the DB null; `SetLog`'s fields
are optional.)

- [ ] **Step 4: Run to verify it passes, then commit**

Run: `npx vitest run lib/workout/__tests__/log-exercise.test.ts`
Expected: PASS.

```bash
git add lib/workout/log-exercise.ts lib/workout/__tests__/log-exercise.test.ts
git commit -m "Snapshot planned pct/rest onto each logged set from the progression style"
```

---

### Task 3: Persist the snapshot server-side + emit it in the sync delta

**Files:**
- Modify: `lib/data/postgres/adapter.ts`

- [ ] **Step 1: `logExerciseAndSets` insert** (`:900-909`) — add to the `.values(sets.map(set => ({…})))`
  object:

```typescript
          plannedPct: set.plannedPct ?? null,
          plannedRestSec: set.plannedRestSec ?? null,
```

- [ ] **Step 2: `logExerciseAndSets` conflict arm** (`:912-924`) — add to the `onConflictDoUpdate.set`:

```typescript
            plannedPct: sql`EXCLUDED.planned_pct`,
            plannedRestSec: sql`EXCLUDED.planned_rest_sec`,
```

- [ ] **Step 3: `getSyncDelta` set-log projection** (`:2880-2893`) — add before `updatedAt`:

```typescript
        plannedPct:    s.setLogs.plannedPct,
        plannedRestSec: s.setLogs.plannedRestSec,
```

This is the server→device leg — without it a set logged on the web (or by another device) syncs down
with the snapshot silently dropped, so the two paths would diverge for cross-device rows.

- [ ] **Step 4 (legacy path — leave null, but keep types valid).** `logSets` (`:791-810`) needs no
  change (its `sets` come from `app/api/sync-workout/route.ts` which has no plan) — the optional fields
  default to undefined and the driver stores null. Confirm the file still typechecks.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "adapter\|log.ts" || echo clean`
Expected: `clean`.

```bash
git add lib/data/postgres/adapter.ts
git commit -m "Persist and sync-emit the planned set snapshot server-side"
```

---

### Task 4: Local store — insert, read mapper, pull-delta, applyDelta

**Files:**
- Modify: `lib/local-store/types.ts`, `lib/local-store/sync-engine.ts`, `lib/local-store/sqlite-backend.ts`

- [ ] **Step 1: `LocalSetLog` type** (`types.ts:81-97`) — add after `rpe`:

```typescript
  plannedPct:    number | null;
  plannedRestSec: number | null;
```

- [ ] **Step 2: Local write** (`sqlite-backend.ts:322-345`, the `INSERT OR REPLACE INTO set_logs`) — add
  `planned_pct, planned_rest_sec` to the column list and two `?` placeholders, then in the bind array
  (mirroring the `useFor1rm` snapshot already read from `payload.progressionStyle?.[i]`):

```typescript
            payload.progressionStyle?.[i]?.pct ?? null,
            payload.progressionStyle?.[i]?.restSec ?? null,
```

Place the columns/values in a stable order (e.g. right after `rpe`) and keep the placeholder count in
sync — an off-by-one here silently shifts every column.

- [ ] **Step 3: `mapSetLog` read** (`sqlite-backend.ts:138-156`) — add:

```typescript
      plannedPct:    (r.planned_pct as number) ?? null,
      plannedRestSec: (r.planned_rest_sec as number) ?? null,
```

- [ ] **Step 4: Pull-delta mapping** (`sync-engine.ts:152-168`) — add before `updatedAt`:

```typescript
    plannedPct:    (r.plannedPct as number) ?? null,
    plannedRestSec: (r.plannedRestSec as number) ?? null,
```

(camelCase — matches the `getSyncDelta` projection from Task 3.)

- [ ] **Step 5: `applyDelta` upsert** (`sqlite-backend.ts:805-823`) — add `planned_pct, planned_rest_sec`
  to the INSERT column list + two `?`, add them to the `ON CONFLICT DO UPDATE SET`
  (`planned_pct=excluded.planned_pct, planned_rest_sec=excluded.planned_rest_sec`), and append to the
  bind params:

```typescript
      r.plannedPct, r.plannedRestSec,
```

Keep the `WHERE set_logs.sync_status='synced'` guard — the snapshot must never clobber a pending local
edit (pull-clobber rule).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit 2>&1 | grep "local-store" || echo clean`
Expected: `clean`.

```bash
git add lib/local-store/types.ts lib/local-store/sync-engine.ts lib/local-store/sqlite-backend.ts
git commit -m "Thread the planned set snapshot through the local store and sync delta"
```

---

### Task 5: Local schema authority — RECONCILE_COLUMNS (no version bump)

**Files:**
- Modify: `lib/sqlite/migrations.ts`
- Test: `lib/sqlite/__tests__/migrations.test.ts`

Per decision 4 these are reconcile-only additive columns (Batch-F pattern) — **no versioned `ALTER`,
no local DB version bump.** `reconcileSchema()` runs on every open and adds any absent column, which is
also the recovery path after a partial upgrade.

- [ ] **Step 1: Add to `RECONCILE_COLUMNS`** (`migrations.ts:87-167`, next to the other `set_logs`
  entries):

```typescript
  { table: 'set_logs', column: 'planned_pct',      ddl: `ALTER TABLE set_logs ADD COLUMN planned_pct REAL` },
  { table: 'set_logs', column: 'planned_rest_sec', ddl: `ALTER TABLE set_logs ADD COLUMN planned_rest_sec INTEGER` },
```

(`REAL` mirrors `intensity_pct`'s local type; `INTEGER` mirrors `rest_time_sec`.) Do **not** add these
to the base `CREATE_SET_LOGS` in `RECONCILE_TABLES` — it keeps its original shape (as it does for
`set_start_ms`/`set_end_ms`); reconcile supplies the additions.

- [ ] **Step 2: Guard test.** Add an assertion to `migrations.test.ts` that
  `RECONCILE_COLUMNS` contains `set_logs.planned_pct` and `set_logs.planned_rest_sec` (so a future
  refactor can't silently drop them). The existing ALTER-mirror test (`:18-23`) is unaffected because
  there is no versioned `ALTER` for these.

- [ ] **Step 3: Run + commit**

Run: `npx vitest run lib/sqlite/__tests__/migrations.test.ts`
Expected: PASS.

```bash
git add lib/sqlite/migrations.ts lib/sqlite/__tests__/migrations.test.ts
git commit -m "Register set_logs planned columns in the local reconcile schema"
```

---

### Task Final: Gate + dev-server smoke + version/docs

- [ ] **Step 1: Full gate** — `pnpm lint && npx tsc --noEmit && pnpm test && pnpm build`. All green
  (DB integration tests run against local Postgres on 5433).

- [ ] **Step 2: Dev-server smoke against the local DB** (`pnpm dev`, log in as `test@local.dev` /
  `testpass123`). Log an exercise for the seeded Push/Pull/Legs program (whose sessions carry a
  progression style, so `progressionStyle` is populated in the log payload), then verify the snapshot
  landed (psql on port 5433, `trainingai_dev`):

```sql
SELECT set_number, weight_kg, intensity_pct, planned_pct, rest_time_sec, planned_rest_sec
FROM set_logs ORDER BY updated_at DESC LIMIT 5;
```

Expected: `planned_pct`/`planned_rest_sec` populated with the style's per-set targets on the just-logged
sets, distinct from the computed `intensity_pct` / measured `rest_time_sec`. Log a freeform/no-style
exercise (or one with no `progressionStyle`) → those columns are `NULL`. Confirm the log POST returns
200 and the workout UI flow is unbroken (mode flips, toast).

- [ ] **Step 3: Version + changelog + journal + index.** This is data plumbing with **no user-visible
  surface** — bump `package.json` **patch** and add a terse `lib/changelog.ts` line only if the project
  convention wants internal changes logged (otherwise skip the changelog per "user-visible changes"
  wording and note the omission). Append the session note to the current `docs/overview/history-*.md`,
  update `projectOverview.md` (current status; add a What's-Left note if Chunk 2 is being tracked), and
  **remove this plan's backlog entry from `docs/implementation-backlog.md`** — all on this branch before
  merge.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/set-log-planned-snapshot
```

Standard change: one additive, non-destructive migration (two nullable `ADD COLUMN IF NOT EXISTS`, no
backfill, no data drop), no auth/security. Merge on green per the CI/CD workflow once the smoke passes.

**Migration-safety note for the PR:** migration 126 is purely additive and idempotent
(`ADD COLUMN IF NOT EXISTS`); it does not fall under the destructive/irreversible carve-out
(no data drop, no non-reversible transform), so it does not require merge-confirmation. State this
explicitly in the PR body.

---

## Verification summary

- **Automated (sandbox):** snapshot-into-`setData` test (Task 2), reconcile-columns guard (Task 5),
  full existing workout suites (`log-exercise`, `log-exercise-pr-gate`, `set-aggregates`,
  `complete-workout`, migrations) still green; full gate.
- **Dev-server (sandbox):** log an exercise with a style → `planned_pct`/`planned_rest_sec` land and
  differ from actual `intensity_pct`/`rest_time_sec`; no-style log → nulls; POST 200, UI flow intact.
- **NOT exercisable in the sandbox — state in the PR (Communication rule):**
  - **Native SQLite local-store leg** (`getLocalStore` returns `null` in web/dev). The local
    `INSERT`/`mapSetLog`/`applyDelta`/`RECONCILE_COLUMNS` changes (Tasks 4-5) run only on the APK. The
    on-device check is: log a set offline on the S25 → kill/reopen → confirm the set still renders and,
    after reconnecting, the row round-trips with `planned_*` intact through `pushMutations` and back via
    `getSyncDelta`/`applyDelta`. Cover it with `docs/device-smoke-checklist.md` or add a
    `projectOverview.md` Known-Issues row marking the device path not-yet-verified.
  - **Cross-device pull** of a web-logged set carrying the snapshot (needs two real clients).

## Notes for the implementer

- **One write function.** The snapshot assignment lives only in `logExerciseFromPayload`; both the web
  route and the outbox `pushMutations` branch reach it. Do not duplicate the snapshot into
  `pushMutations` — it already parses the payload and calls the shared fn.
- **Column-order discipline in the raw SQLite inserts.** `sqlite-backend.ts` uses positional `?`
  binding; adding a column means adding both the column name **and** the value in the same position.
  Recount the placeholders after editing the local insert and the `applyDelta` upsert.
- **Keep `intensity_pct`/`rest_time_sec` semantics untouched.** They are actual/measured; the new
  columns are planned. Nothing in this PR reads or re-bands them.
- **Do not add read-render code.** The columns are for later analysis; no card, chart, or API response
  needs to surface them in this PR. If a future consumer renders the plan-vs-actual delta, it reads
  these columns — it does not re-derive the plan.
- If line numbers have drifted at implementation time, re-anchor by symbol name (`logExerciseAndSets`,
  `getSyncDelta` set-log select, `mapSetLog`, the `applyDelta` `set_logs` loop), not by re-designing.

---

## Chunk 2 (PARKED — NEEDS-NATIVE, do NOT block Chunk 1): per-rep time-under-tension

**Status: parked. This sub-section is a scoping note, not an executable task list.** It is captured here
so the Chunk-1 PR can reference a known follow-up; it should become its own plan doc (and its own
backlog entry) when picked up, behind the S25-APK on-device gate.

**Why it's separate from Chunk 1.** Chunk 1 snapshots data the log path *already receives*. TUT is data
that **does not exist anywhere today**: the finest timing granularity captured is the whole-set window
(`setStartMs`/`setEndMs`/`setTimeSec`). There is no per-rep timestamp, no tempo/eccentric-concentric
split, and no UI that records rep boundaries. Capturing it is device-UI instrumentation, not a storage
change — it cannot be verified in the web sandbox (safe-area/gesture/timer behaviour on Samsung
WebView, native SQLite) and so is gated on the on-device smoke run.

**Shape of the eventual work (indicative, to be designed in its own plan):**
- **Capture UI** — new tempo/per-rep timing instrumentation in `components/workout/active-workout-screen.tsx`
  and `components/workout/set-card.tsx` (e.g. a rep-tick affordance or an inferred cadence), driven off
  the existing leaf-level timer hooks (`useElapsedSec`/refs) so the ~1,000-line workout screen does not
  re-render per tick (render-discipline rule). No new `setInterval` in the orchestrator.
- **Payload** — a new per-rep array on `WorkoutMode`/`SessionLogEntry` (`components/workout/types.ts`)
  and on `LogExercisePayloadSchema` (a `repTimings?: number[][]` or `{repMs}[]` per set), Zod-validated
  at creation, `.optional()` (never `null` — omit when absent).
- **Storage** — a child table (`set_rep_timings`) or a JSONB column on `set_logs`; the full offline-sync
  chain again (local table + `RECONCILE_TABLES`/`RECONCILE_COLUMNS`, outbox payload already-carries vs
  new field, `getSyncDelta`/pull/`applyDelta`, row mappers), plus a new Postgres migration number
  (claim it fresh at that time — do **not** pre-allocate now).
- **Derived metric** — if TUT drives any score/recommendation, the formula lives once in `lib/`
  (One Formula, One Place) and is unit-tested with a boundary case; no LLM-derived number gates an
  automatic action.
- **Verification** — device-first: the capture accuracy and the offline round-trip are only real on the
  APK; `docs/device-smoke-checklist.md` is the merge gate, not green `pnpm dev`.

**Do not begin Chunk 2 as part of the `feat/set-log-planned-snapshot` PR.** When it is scheduled, open a
new plan (`docs/superpowers/plans/YYYY-MM-DD-set-log-rep-tut.md`) and a new backlog entry.
