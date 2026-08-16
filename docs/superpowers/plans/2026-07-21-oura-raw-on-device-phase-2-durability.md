# Oura Raw-On-Device — Phase 2: Derived→Railway Backup + Full-History Restore

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the on-device calculated forms **durably backed up to Railway** and **fully restorable to a new/wiped phone** — the durability guarantee that justifies the whole raw-on-device inversion. Today "restore from Railway" does not exist for most Oura forms and is capped at 90 days; this phase builds the real thing.

**Architecture:** Device-primary (Garmin/Apple-Health pattern): the phone computes the finished forms (Phase 1 rollup) and is the source of truth; Railway holds a **complete, restorable backup** of the *calculated* forms only (never raw). Each form becomes a first-class offline-sync domain (device writes → outbox → server upsert; server → pull-delta → local), and a restore path re-hydrates the entire history — not a 90-day slice — like iCloud/Samsung Cloud.

**Tech Stack:** the existing offline-sync chain — `lib/local-store/` (outbox, `pushMutations`, `applyDelta`), `lib/data/postgres/adapter.ts` (`pushMutations`, `getSyncDelta`), `lib/sync/cursor.ts`, `lib/data/repository.ts` (`SyncDelta`, `MutationDomain`). CI gates: `check-push-mutations.js` (one shared write fn per domain), `check-reconcile.js`.

**Parent docs (read first):** the spec `2026-07-21-oura-raw-on-device-architecture.md` (esp. Review Outcome D2 + §11 findings D1/D2/D4/D5/D6/D7/R5), and Phase 1 `2026-07-21-oura-raw-on-device-phase-1.md`. **Also:** CLAUDE.md "Offline Sync", "Cache Invalidation", "Database — Connection Pool", "Canonical Runtime".

**Prerequisite:** Phase 1 merged (local v18 tables exist; the rollup writes them). This phase adds the sync; it does **not** touch the cursor/raw path.

---

## ⚠️ Review Outcome (2026-07-21) — NOT yet implementation-ready; read before executing any task

Three independent adversarial reviews (sync-chain completeness, restore + single-writer, pool/volume + reality) ran against this plan. Verdict: **the architecture is right and the mid-volume forms are well-specified, but the plan is NOT ready to implement — it has two unscoped structural gaps, a restore path that can't actually drain a large history, and a row-freeze bug that affects all six domains.** The first-draft tasks (Task 0–9) have been **removed and replaced by the Revised Breakdown below**, which incorporates R1–R7. This section stays as the record of *why* the revision looks the way it does.

### R1 (BLOCKER) — `oura_bucket` has no server table; `oura_heartrate` has no `updated_at`
- **`oura_bucket` exists only in local SQLite** (`migrations.ts`) — there is **no** `oura_bucket` in `schema.ts`, no Postgres migration, no upsert fn. Task 7's coarse-tier backup has nowhere to land. **Needs a new Postgres migration + `schema.ts` table + repo write fn**, none of which the plan scoped.
- **`oura_heartrate` server table is `{id, user_id, timestamp, bpm, source}` — no `updated_at`** (`schema.ts:733`). The whole `updatedAt`-cursor pull (links 6–7) is impossible for it, and keying the delta on `timestamp` means a **re-decoded/re-rolled historical point never re-syncs** (its timestamp is old → below `effectiveSince` → silently skipped). Re-decode backfill is the raw pipeline's stated design, so this is real silent loss. **Needs a Postgres migration adding `updated_at` (+ local column + `RECONCILE_COLUMNS`).**

### R2 (BLOCKER) — intraday HR does not fit the shared sync machinery; give it a dedicated path
`oura_heartrate` is ~288 pts/day. Three independent breakages converge (all consequences of forcing a time-series through one-row-per-(user,date) machinery):
- **Cursor stall (tied timestamps):** `resolveSyncCursor` advances to `min(maxUpdatedAt)−1ms` with **no id tiebreak** (`cursor.ts:17`). >`pageLimit`(500) rows sharing one `updated_at` (a rollup that bulk-stamps `now()` across a multi-day backfill) → the cursor recomputes the same value → re-pulls the same 500 rows forever → silent truncation.
- **`getSyncDelta` fan-out (I19):** `getSyncDelta` is itself a ~20-way `Promise.all` (`adapter.ts:2986`) that already checks out up to all `max:10` pool connections per pull — the exact prod I19 starvation. Adding the heaviest domain and looping it 100+× during restore is the recipe. The "single-connection, no fan-out" gate is **unachievable on the pull side** as structured.
- **Outbox can't replace-by-day:** `queueMutation` uses a random UUID id (`sqlite-backend.ts:1790`), so `INSERT OR REPLACE` never collides — every re-roll of a day **appends** another ~288-pt payload → unbounded outbox growth.
- **Resolution:** serve intraday HR via a **dedicated, timestamp-cursored, single-connection HR sync endpoint** (outside the shared `getSyncDelta` `Promise.all` and the shared outbox), and give the outbox a **deterministic id (`oura_heartrate:${date}`)** so replace-by-day actually collides. The bucket coarse-tier backup (R1) likely wants the same dedicated treatment.

### R3 (BLOCKER) — the cross-cutting cursor tiebreak
Even for the day-grained forms, the `min(updated_at)−1ms` cursor with no `(updated_at, id)` tiebreak is fragile whenever a batch shares a timestamp. **Add a composite `(updated_at, id)` tiebreak to `resolveSyncCursor` + every domain's `orderBy` + the page-cursor encoding** — a whole-sync-system change, not Oura-only. This is the correct fix for R2's stall and hardens all domains.

### R4 (BLOCKER) — restore cannot drain in one pass
`pullDelta` hard-caps at **20 pages** per call (`sync-engine.ts:457`) and returns **no `hasMore`** (`:488`). Task 8's "loop to exhaustion" does not exist. **`pullDelta` must return `hasMore`, and the restore trigger must loop `pullDelta(restore=true)` until `hasMore` is false.** Fix the plan's "`since=0`" wording too — the client sends `lastSync.toISOString()` (epoch ISO), never literal `0`.

### R5 (BLOCKER, all six domains) — the mark-synced freeze
After a confirmed push the client flips the local row to `sync_status='synced'` via a **per-domain switch** (`sync-engine.ts:593-643`). **None of the six Oura domains is in it.** A rollup row written `sync_status='pending'` whose mutation is confirmed+deleted stays `pending` forever — and the clobber-guard (`WHERE sync_status='synced'`) then **permanently blocks every future server pull from correcting it.** Each new domain needs a mark-synced arm. Missing this hard-freezes device-authored rows.

### R6 (HIGH) — `sleep_sessions` restore comes back gutted + stomps other sources + dup rows
- The **client pull mapping** (`sync-engine.ts:120-128`) and the **`applyDelta` branch** (`sqlite-backend.ts:844-859`) keep only 6 fields — they drop `average_hrv_ms`, `avg_heart_rate`, `lowest_heart_rate`, `efficiency`, `sleep_score`, `onset_latency_sec`, `respiratory_rate`, `sleep_phase_5_min`, `oura_id`, `sync_status` even though v18 added those local columns. Restore brings sleep back stripped of all HRV/RHR/stage data. **Task 3 must extend the pull mapping + `applyDelta` column list + the `LocalSleepSession` type**, not just add the clobber-guard.
- The shared write fn must **reuse `upsertOuraSleep`** (which does the `sourceMap`/`mergeSet` per-field merge, `slices/oura.ts:343`) with `source='oura_ble'` — NOT a plain overwrite (which stomps Samsung-Health/manual sleep).
- **Surrogate-id vs natural-key:** local conflicts on `id`, server upserts on `(user_id, sleep_start)`. A device-authored night with a client id that already exists server-side under a different id → the pull-back creates a **duplicate** local row. Task 3 must reconcile the id (e.g. key local sleep on `oura_id`/`sleep_start`, or map server id back).

### R7 (HIGH/MEDIUM) — the smaller pins
- **`oura_daily_derived` is assembled server-side from ≥4 separate COALESCE upserts** (illness_*, bdi, resilience_*, body_comp/readiness — `adapter.ts:4829/4843/4849/4950`). One device COALESCE push that omits any group strands those columns NULL for every server reader (readiness, body-battery, digests). **Add a field-coverage test keyed off the four upsert sites**, not a hand-listed field set.
- **`body_metrics` push branch hardcodes `source='manual'`** (`adapter.ts:3287`) — Task 2 must **change** it to thread `payload.source` (it currently says "confirm," which is factually wrong); today an `oura_ble` push is misfiled as `manual` (rank 4) and would stomp genuine manual values. Also **`active_calories` can't round-trip** through `body_metrics` (no local column / push / pull field) — either add the column end-to-end or route it via `oura_daily` only.
- **`oura_daily` local table has no `sync_status` column** (`migrations.ts:14`), so Task 7's clobber-guard is a **schema change** (local column + `RECONCILE_COLUMNS`), not just an SQL edit.
- **Migration number collision:** 136 is claimed for the bucket tables in the parent spec AND for the Task 9 flag here. **130 is free** — reassign one.
- **Single-writer flip:** reversibility is *coverage-only* (COALESCE fills gaps, can't correct a wrong device value); and post-flip Railway's backup freshness becomes a pure function of device connectivity (raw still ingests but is no longer rolled up server-side). State both as accepted trades. Add the `(user_id, updated_at)` **pagination index** on the high-volume tables in their migration.

### Verified sound (no change)
Task 0 (the `windowDays=null` unclamp) is byte-identical for the default path and semantically safe. **`oura_daily_summary` and `oura_daily_derived` chains are essentially complete** (both server tables have `updated_at`; the v18 local tables are faithful mirrors incl. the EMA baselines; the shared fns `upsertOuraDailySummary`/`upsertOuraDailyDerived` exist) — modulo R5 (mark-synced) and R7. The named shared write fns all exist; `check-push-mutations` will pass; the **push direction is pool-safe** (serial server loop, `PUSH_CHUNK_SIZE=5` client).

**Bottom line:** the two day-grained score tables are ready; **intraday HR + the coarse buckets need dedicated infrastructure the plan didn't scope (R1/R2)**, the **restore path needs the cursor tiebreak + drain-driver (R3/R4)**, and the **mark-synced arm (R5)** is a silent row-freeze across all six. None reached code. **R1–R7 are resolved in the Revised Breakdown below** — the superseded first-draft tasks (Task 0–9) are removed; the breakdown below replaces them.

**Sandbox vs device:** the **server** changes (`getSyncDelta` window, `pushMutations` branches + shared write fns, the restore route) are **sandbox-testable** and CI-gated. The **client** changes (`applyDelta` branches, outbox `pushMutations` switch, restore trigger) run only in the Capacitor store → **device-verified** (`getLocalStore` is null on web). State which half each PR touches.

---
## ✅ Second Review Outcome (2026-07-21) — pre-implementation gate CLEARED, with amendments (READ THIS + the section above)

A second, code-grounded adversarial pass (three parallel reviewers: F1/F2/F3 · Track A/F4 · Track B) ran the "another agent's review before implementation" gate the Status section required. **Verdict: the architecture is sound; the plan is implementation-ready once the amendments below are applied.** The review found **3 structural blockers** (each would have shipped a data-loss bug) plus reference/scoping fixes. These amendments **supersede** the corresponding Revised-Breakdown task text. Owner decision on the F2 fork: *"most future-proof and safe — the good fix, not the easiest"* (standing theme for the whole initiative).

### Path / label corrections (apply to every task below)
- Sync engine + local backend: **`lib/local-store/sync-engine.ts`**, **`lib/local-store/sqlite-backend.ts`** (bare `sync-engine.ts`/`sqlite-backend.ts` in task text; line offsets are accurate).
- Local SQLite schema: **`lib/sqlite/migrations.ts`** (NOT `lib/local-store/migrations.ts`).
- The calc-form local tables are **v17** (v18 was corrective); the sleep Oura columns are `RECONCILE_COLUMNS` additions with **no version bump** — grep by column, not "v18 migration".

### BLOCKER-1 — F2 cursor: DROP the cross-cutting shared-cursor change; put the keyset cursor in Track B only
The shared sync cursor is a **single scalar** (`resolveSyncCursor` collapses ~14 domains to one `syncedAt`; the client passes one `?since=ISO`; every domain filters `gt(updatedAt, since)`). A composite `(updated_at, id)` built from one domain's **random-UUID** id and applied cross-domain **silently skips** rows at a shared `updated_at` in the *other* domains → data loss, strictly worse than today's stall (which only re-pulls, never loses). **Resolution (future-proof + safe, per owner):**
- **Day-grained domains (Track A + existing):** keep the proven, skip-safe `min(updated_at)−1ms` overlap cursor **unchanged**. Make **B4 load-bearing** — every rollup/backfill writes a **per-row monotonic `updated_at`** (its own compute time, not a bulk `now()`), so a day-grained domain (one row per user per day) can never put >`pageLimit` rows at one `updated_at` for one user → the overlap cursor never stalls. Add a `resolveSyncCursor` **stall-guard assertion** in dev (if a page returns `pageLimit` rows all sharing the min `updated_at`, log loudly) so a future bulk-write regression is caught, not silently stuck.
- **Track B time-series (dedicated endpoint, B2):** implement a proper **`(updated_at, id)` keyset cursor INSIDE the dedicated single-domain endpoint** — safe there precisely because it is single-domain (one id-space, no cross-domain comparison). This is the correct keyset design, scoped to the only path that actually needs it.
- **F1 stays**, but the null-guard must precede the arithmetic: `windowDays == null ? since : (since > windowStart ? since : windowStart)` — `null * 86400000 === 0` would otherwise clamp to *now* (worse than 90d). `repository.ts:626` widens to `number | null`.
- **Delete** the plan's "F2 = change every domain's `orderBy` + `resolveSyncCursor` return shape + page token" text. Do NOT touch the shared scalar cursor. (Note: unpaginated domains — `programs`/`progressionStyles`/`supplements`/food-items/`personalRecords` — never fed the cursor anyway.)

### BLOCKER-2 — B1: the server write silently drops corrections (`onConflictDoNothing`)
`upsertOuraHeartrate` uses **`.onConflictDoNothing()`** on `(user_id, timestamp)` (`slices/oura.ts:392-402`), so a re-decoded/corrected bpm at an existing timestamp **never reaches Railway** — `updated_at` alone does not fix re-decode durability. **Convert to `onConflictDoUpdate` (scoped to `user_id`, `set { bpm, source, updated_at }`).** The server upsert must **store the client-supplied `updated_at`** (not a per-chunk `now()`), which is also what makes B4 meaningful. B1's "add the local heartrate column + `RECONCILE_COLUMNS`" is **stale** — local `oura_heartrate.updated_at`/`sync_status` already exist (`lib/sqlite/migrations.ts:150-156`) and it's already in `RECONCILE_TABLES`; **only the Postgres side needs the `updated_at` column.** Migration numbers **130 + 137** confirmed free; **136** is pre-claimed by the parent spec.

### BLOCKER-3 — B3: deterministic `domain:date` mutation id re-introduces a mid-flight-replace loss
A deterministic id (`oura_heartrate:${date}`) + delete-by-id races: a re-roll `INSERT OR REPLACE`s the pending row **after** it's read into the in-flight push chunk but **before** the confirm-delete, so the delete removes the newer, never-pushed payload (and F4 flips it `synced`) → silent loss. This inverts the CLAUDE.md rule "confirm/delete by stable mutation id, never a `domain:date` composite." **Resolution (good fix):** keep **random-UUID mutation ids** (preserving the safe in-flight semantics), and bound outbox growth by **collapsing on enqueue** — in the enqueue transaction, delete only prior **non-in-flight** pending same-`(domain,date)` rows (never a row already handed to an in-flight push). One pending mutation per day in steady state, zero in-flight loss.

### GO-with-amendments (reference/scoping fixes — not structural)
- **F3:** the per-page `hasMore` plumbing already exists (`sync-engine.ts:447,483`; `cursor.ts` returns `{syncedAt, hasMore}`); the real work is surfacing `hasMore` on the **outer** `pullDelta` return + a `?mode=restore` route + **adding rate limiting** (the pull route has *none* today). Fix the resumability contradiction: restore must seed the cursor to epoch **once** then loop on the **persisted advancing** cursor (`force=true, fullResync=false`) — NOT `fullResync` per call (which re-drains the first 20 pages forever). Handle the "Restore from cloud on an already-synced device" case (reset `lastSyncAt` to epoch at loop entry).
- **F4:** correct — but **drop `body_metrics`** from the list (its mark-synced arm already exists, `sync-engine.ts:594-597`); only `oura_daily` needs a new arm among the day-grained set.
- **A2:** the four `upsertOuraDailyDerived` COALESCE sites are **`adapter.ts:4866/4880/4987/5012`** (plan's 4829/4843/4849/4950 are stale). Base the field-coverage test on the **`DERIVED_COLS` map** (`slices/oura.ts:871-885`, 34 cols) + those four sites, not a hand list.
- **A3:** key the local sleep upsert/conflict on **`oura_id`** for BLE rows — **`sleep_start` does not exist in the local table** (has `date`), so the plan's `sleep_start` alternative needs a column add first; use `oura_id`. The restore-gutting (pull mapper + `applyDelta` + `LocalSleepSession` all carry only 7 fields) and missing clobber-guard are confirmed real.
- **A4:** **strike `non_wear_time_sec`** — it does **not** exist in the local `oura_daily` table (or anywhere in `lib/sqlite/migrations.ts`); either drop the claim or scope the column end-to-end. `active_calories` routes via `oura_daily` only (confirmed no local `body_metrics` column). `body_metrics` push hardcodes `source='manual'` at **`adapter.ts:3287`** — change to thread `payload.source`.
- **B2:** **split retention** — `oura_heartrate` 180d (`ZONE_HR_RETENTION_DAYS`, `slices/oura.ts:407`); coarse `oura_bucket` tiers are **forever-retained** (the RRD ladder's purpose) — do NOT apply the 180d cap to buckets. Resolve push-direction: the **push** side is already pool-safe, so reuse the shared outbox/push for push and build the dedicated endpoint for **pull only** — and then add `oura_heartrate`/`oura_bucket` to `SYNCED_MUTATION_DOMAINS` + the `MutationSchema` enum (`lib/sync/mutation-schema.ts`).
  - **⚠ HR-churn note (found building B1):** the **server** rollup writes `oura_heartrate` by **delete-source='ble'-in-window + re-insert** (`adapter.ts:4774→4779`, because moving-clock-anchor bins would else near-miss-duplicate), so every rollup restamps the last ~14 days' `updated_at` — the B1 `DO UPDATE`+`setWhere` churn-guard only helps stable-key (device-push) writes, not this path. Bounded (~14d × 288 pts re-sync per rollup), not the whole history, but B2 should decide: (a) make the device the sole `oura_heartrate` writer post-cutover (C1) so the server delete-reinsert stops, or (b) accept the bounded 14-day re-pull. Do not let the server rollup and the device both delete-reinsert the same span.
- **B4:** elevated from "low value" to **required** — it is the day-grained stall-safety mechanism under the F2 resolution above (server must persist the client `updated_at`, tying B4↔B1).
- **B5:** tighten the gate — add a **concurrent** scenario (normal `getSyncDelta` pull + a timeseries restore loop + an outbox push at once) asserting `pool.totalCount` never exceeds `max:10`; name the instrumentation (`pool.totalCount`/`pg_stat_activity`); numeric wall-clock/memory thresholds; assert the F3 drain loop terminates (~54k rows ÷ 500 ≈ 108 pages).

### Dependency-order note
F1 → (B1/B4 server infra + the day-grained mark-synced/monotonic-`updated_at` work) → Track A → Track B dedicated endpoint (keyset cursor) → F3 restore driver → Cutover → RST device proof. F1 is the safe first ship (no blocker depends on it).

---
## Revised breakdown (resolves R1–R7) — two sync tracks

The review's core lesson (R1/R2): **the six forms are not one homogeneous group.** Four are day-grained
(one row per user per day) and fit the existing shared `getSyncDelta`/outbox machinery; two are
high-cardinality time-series (`oura_heartrate` ~288 pts/day; `oura_bucket` fine+coarse tiers) that
**structurally do not** — they lack server infra, stall the shared cursor, and reproduce the I19 pool
fan-out. So this phase splits into **Track A (shared path)** and **Track B (dedicated path)**, over a set
of **Foundation** changes that are cross-cutting (they harden the whole sync system, not just Oura).

Dependency order: **Foundation (F1–F4) → Track A (A1–A4) → Track B (B1–B5) → Cutover (C1) → Restore
(RST) → prove on device.** Track A can start once F2/F4 land; Track B needs its own server infra (B1)
first. Nothing flips the single-writer switch or removes anything server-side until Restore is
device-verified.

State per PR which half it touches: **server** (`getSyncDelta`/routes/`pushMutations`/migrations —
sandbox-testable, CI-gated) vs **client** (`applyDelta`/outbox switch/restore trigger — device-verified,
`getLocalStore` null on web).

---

## Foundation (cross-cutting; mostly sandbox-testable)

### Task F1 — `getSyncDelta` full-history unclamp (server; sandbox-TDD)
Unchanged from the sound first-draft Task 0. `getSyncDelta(userId, since, windowDays: number | null = 90, pageLimit = 500)`; `windowDays == null` skips the `now−90d` floor (`adapter.ts:2971`), honouring the real `since` (epoch = full history). Default path stays byte-identical. Update `repository.ts:626` signature. **Test:** seed a 200-day-old row; normal pull misses it, `windowDays=null` includes it. Sandbox (local Postgres).

### Task F2 — `(updated_at, id)` cursor tiebreak (server + client; the R3 cross-cutting fix)
`resolveSyncCursor` (`lib/sync/cursor.ts:11-19`) advances to `min(maxUpdatedAt)−1ms` with **no id tiebreak**, so any domain with >`pageLimit` rows sharing one `updated_at` stalls forever (re-pulls the same page). Fix it for the whole sync system:
- Change each paginated `getSyncDelta` SELECT to `orderBy(asc(updatedAt), asc(id))` and the page filter to a **composite** `(updated_at > cur.ts) OR (updated_at = cur.ts AND id > cur.id)`.
- `resolveSyncCursor` returns a `{ ts, id }` cursor (the last row of the min-capped domain), not `ts−1ms`. Encode it in the page token.
- **Boundary test (sandbox):** seed 1,200 rows all at one `updated_at`; assert a paged pull drains all 1,200 across 3 pages (not an infinite loop on the first 500).
- This is a whole-sync change — verify existing domains (body_metrics, workouts, food) still page correctly. It is the correct fix for R2's stall and hardens every domain.

### Task F3 — restore drain-loop: `pullDelta` returns `hasMore`; restore loops to true exhaustion (server route + client; R4)
`pullDelta` hard-caps at 20 pages and returns no `hasMore` (`sync-engine.ts:457,488`), so a large restore silently truncates. Fix:
- Pull route accepts `?mode=restore` → `getSyncDelta(userId, since, /*windowDays*/ null, pageLimit)`; give restore its own rate-limit bucket (heavier).
- `pullDelta(userId, force, fullResync, restore=false)` returns `{ synced, domains, hasMore }` (surface the cursor-`hasMore`). Do **not** just raise the 20-page cap — that only moves the ceiling.
- Restore trigger calls `pullDelta(restore=true)` **in a loop until `hasMore === false`** (resumable — the cursor persists via `setLastSyncAt` inside `pullPage`). Fix the first-draft "`since=0`" wording: the client sends `lastSync.toISOString()` (epoch ISO for `fullResync`), never literal `0`.
- Client half is device-verified in RST.

### Task F4 — mark-synced arms for all six Oura domains (client; R5, the freeze fix)
The push-reconciliation switch (`sync-engine.ts:593-643`) flips a confirmed row to `sync_status='synced'`; **no Oura domain is in it**, so a device-authored row stays `pending` forever and the clobber-guard then permanently blocks future pulls from correcting it. Add a mark-synced arm for each of: `oura_daily_summary`, `oura_daily_derived`, `sleep_session`, `oura_bucket` (Track B), `oura_heartrate` (Track B), and the `body_metrics`/`oura_daily` fields. Each arm flips the local row(s) that mutation covered to `synced`. **Device-verified** (a pushed rollup row must end `synced`, then survive a subsequent pull). Ship the day-grained arms with Track A, the time-series arms with Track B.

---

## Track A — shared-path day-grained forms (fit the existing 8-link template)

**8-link template (reference: `body_metrics`):** (1) local table + offline trio *(done, v18)* → (2) `MutationDomain` entry → (3) `store.upsertX` + `queueMutation(domain,date,payload)` with every field the server upsert needs → (4) server `pushMutations` branch delegating to a **shared repo fn** (CI `check-push-mutations`) → (5) client push POST → (6) `getSyncDelta` SELECT (F2-tiebroken, paginated) + `SyncDelta` member → (7) `resolveSyncCursor` page entry → (8) `applyDelta` branch, **`sync_status='synced'` clobber-guarded** + the F4 mark-synced arm.

### Task A1 — `oura_daily_summary` (new domain; server + client)
Complete per review. Apply the 8-link template; shared fn = existing `upsertOuraDailySummary` (`slices/oura.ts:794`). Payload carries **every column incl. the `*_baseline_*_x8` + `n_history` EMA state** (offline baseline folding needs it). Bridge server key `date` ↔ local `day` (alias `date AS day` in the SELECT/mapping). Clobber-guarded `applyDelta` + F4 arm. Tests: push→pull round-trips all columns incl. baselines; clobber-guard holds; `check-push-mutations`/`check-reconcile` green.

### Task A2 — `oura_daily_derived` (new domain; server + client)
As A1; shared fn = `upsertOuraDailyDerived` (COALESCE, `slices/oura.ts:887`), key `day` (no bridge). **R7 field-coverage:** the server assembles this table from **four separate COALESCE upserts** (illness_*, bdi, resilience_*, body_comp/readiness — `adapter.ts:4829/4843/4849/4950`). Add a test that the device push payload covers **every column those four sites write** (derive the expected set from the four upserts, not a hand list) — a missing group goes NULL for `readiness-score`/`body-battery`/`weekly-digest`/etc. Clobber-guarded + F4 arm.

### Task A3 — `sleep_sessions` (add push; fix restore mapper + source-merge + id; server + client; R6)
- **Push:** add `'sleep_session'` to `MutationDomain`; server branch delegates to the existing **`upsertOuraSleep`** with `source='oura_ble'` (it does the `sourceMap`/`mergeSet` per-field merge, `slices/oura.ts:343`) — NOT a plain upsert (which stomps Samsung-Health/manual sleep). Zod-whitelist the payload.
- **Restore mapper (the R6 data-loss fix):** extend the client pull mapping (`sync-engine.ts:120-128`) AND the `applyDelta` column list (`sqlite-backend.ts:844-859`) AND the `LocalSleepSession` type to carry the Oura columns v18 added: `oura_id, efficiency, onset_latency_sec, average_hrv_ms, avg_heart_rate, lowest_heart_rate, restless_periods, sleep_score, respiratory_rate, sleep_phase_5_min, time_in_bed_hours, sync_status`. Without this, restore returns sleep stripped of all HRV/RHR/stage data.
- **Clobber-guard:** add `WHERE sync_status='synced'` to the `applyDelta` `ON CONFLICT` (missing today, finding D4) + F4 arm.
- **Id reconciliation:** local conflicts on `id`, server upserts on `(user_id, sleep_start)`. Key the local `sleep_sessions` upsert/conflict on **`oura_id`** for BLE rows (or map the server `id` back on pull) so a device-authored night that already exists server-side doesn't create a duplicate local row.
- Device-verify a BLE night round-trips device→Railway→(2nd device) restore **with HRV/stages intact**.

### Task A4 — `body_metrics` Oura fields + `oura_daily` (server + client; R7)
- **`body_metrics`:** the push branch **hardcodes `source='manual'`** (`adapter.ts:3287`) — **change** it to `upsertBodyMetrics(userId, rows, payload.source ?? 'manual')` so an `oura_ble` push writes at oura rank (3) and the `mergeSet` priority preserves manual/HC fields (don't misfile it as rank-4 manual). Test the source-merge (seed manual weight, push oura_ble hrv → weight preserved). **`active_calories`** has no local `body_metrics` column and isn't in the push/pull mapping — route it via `oura_daily` only (do not claim it round-trips through `body_metrics`).
- **`oura_daily`:** local table has **no `sync_status`** (`migrations.ts:14`) — add the column (+ `RECONCILE_COLUMNS`, `check-reconcile`) before the clobber-guard; convert the `INSERT OR REPLACE` (`sqlite-backend.ts:964`) to a `sync_status`-guarded upsert. Add a push arm for the BLE-authored field(s) (`non_wear_time_sec`) + F4 arm.

---

## Track B — dedicated high-volume path for intraday HR + coarse buckets (R1/R2)

These do **not** go through the shared `getSyncDelta` `Promise.all` or the shared outbox. They get their own single-connection, timestamp-cursored endpoint so a 100-page restore can't monopolise the pool (I19) and a bulk backfill can't stall the shared cursor.

### Task B1 — server infrastructure the first draft never scoped (server; migration)
- **`oura_heartrate.updated_at`:** the server table is `{id,user_id,timestamp,bpm,source}` — **no `updated_at`** (`schema.ts:733`). Add it (Postgres migration; default `now()`; backfill from `timestamp`) + the local column + `RECONCILE_COLUMNS`. Without it the delta must key on `timestamp`, and a re-decoded historical point (old timestamp) would never re-sync.
- **`oura_bucket` server table:** it exists only in local SQLite — **no server table at all**. Create the Postgres table (`schema.ts` + migration) mirroring the local coarse-tier columns, unique `(user_id, tier, bucket_start_ms)`, with `updated_at`; add `upsertOuraBucket`. Add the `(user_id, updated_at, id)` **pagination index** on both tables in the same migration.
- **Migration numbering (R7):** claim **130** (free) + **137** for these two + the Track-C flag — NOT 136 (already claimed for the local bucket work in the parent spec). Verify against the dir AND open PRs at pickup.

### Task B2 — dedicated timestamp-cursored HR/bucket sync endpoint (server; single-connection)
- A `POST /api/sync/oura-timeseries` (pull + push) that serves `oura_heartrate` and coarse `oura_bucket` **outside** the shared `getSyncDelta` fan-out, each query on **one** pooled connection (never a `Promise.all` that checks out the whole pool — the I19 lesson; the fix that collapsed the rollup's fan-out, `adapter.ts:4062`, is the pattern).
- Cursor keyed on `(updated_at, id)` (B1) with the F2 composite paging, `pageLimit` per response, an explicit **per-pull row budget** (e.g. 5k) so a first restore returns bounded responses, and a real `hasMore` the restore loop (F3) drains.
- Retention parity: don't restore/keep intraday HR older than the server's ~180-day retention.

### Task B3 — replace-by-day outbox for the time-series (client; R2)
`queueMutation` uses a random UUID id, so `INSERT OR REPLACE` never collides and every re-roll **appends** another full-day payload (`sqlite-backend.ts:1790`). For the time-series domains, queue with a **deterministic id `oura_heartrate:${date}` / `oura_bucket:${date}`** so a re-roll of a day **replaces** its pending payload. Confirm the id is also the server confirm/dedup key (`sync-engine.ts:573`) — the deterministic id must not collide across domains (prefix with the domain). One mutation per day, payload = that day's point/bucket array.

### Task B4 — monotonic `updated_at` within a rollup batch (client/server; R2)
A backfill that bulk-stamps `now()` across many days puts >`pageLimit` rows at one `updated_at` → even the F2-tiebroken cursor pages them, but keep it sane: the rollup sets each row's `updated_at` from its own compute time (or derives a per-row monotonic value), so a day's ~288 points don't all share one instant. Boundary test: a 3-day backfill drains fully via the B2 endpoint.

### Task B5 — load test the dedicated path (server; the gate)
Seed 180 days × ~300 pts, run a full push + full restore through the B2 endpoint; assert **one connection per request** (no fan-out), the pool never exceeds `max:10` under concurrent outbox sync, and wall-clock/memory are acceptable. **Gate: do not enable the time-series domains if this starves the pool.** Record numbers.

---

## Cutover — Task C1: single-writer flip (server; the flip)

Once push + restore are device-verified, the device becomes the **sole author** of the finished forms so the dual-write `COALESCE` first-writer-wins race (D5) is gone. A per-user `oura_device_authoritative` flag (migration 137, per B1) gates `aggregateOuraRawSamples`: when set, it **skips writing the finished forms** (raw ingest continues as the Phase-3 backstop). Flip only after RST is verified for that user. **State the two honest trades (M-findings):** reversibility is *coverage-only* — clearing the flag lets the server COALESCE-fill gaps but cannot *correct* a wrong device value; and post-flip Railway's backup freshness becomes a function of device connectivity (raw still ingests but isn't rolled up server-side until the flag clears, which re-derives from stored `body_hex`). Reversible, deliberate, owner-facing — never automatic. Sandbox test: flag set → server writes no finished-form rows; clear → it does.

---

## Full-history restore flow — Task RST (client; device-verified — the durability proof)

Tie it together: on a fresh/empty local store (or a manual "Restore from cloud"), run the F3 restore loop (`pullDelta(restore=true)` until `hasMore=false`) across every day-grained domain **and** the B2 time-series endpoint, until both are drained. Background, resumable, progress-shown; never blocks first paint (screens read local-first as rows land); the `sync_status='synced'` guard is never bypassed. **Device verification (the guarantee):** wipe the app's local data (or use a 2nd device), restore, confirm the **entire** history of sleep/HRV/RHR/SpO₂/scores/HR comes back — **not a 90-day slice, and sleep with its HRV/stage columns intact** — matching Railway. Record in the PR + `docs/device-smoke-checklist.md`.

---

## Cache invalidation (every local-write task)
Each `applyDelta`/rollup write of an Oura form fires the named cache groups (`invalidateOuraSync()` + `invalidateReadinessInputs()`, `lib/cache-groups.ts`) — never hand-rolled key lists (CLAUDE.md strict rule).

## Phase-2 exit criteria
- [ ] F2 cursor tiebreak lands and every existing domain still pages correctly; a >pageLimit same-timestamp batch drains fully (no stall).
- [ ] F3 restore loop drains to `hasMore=false`; F4 mark-synced arms flip every pushed Oura row to `synced` (no freeze).
- [ ] Track A: four day-grained forms are full 8-link domains; `oura_daily_derived` field-coverage test green; sleep restore returns HRV/stage columns; `body_metrics` source-merge preserves manual/HC; `check-push-mutations`/`check-reconcile` green.
- [ ] Track B: `oura_heartrate.updated_at` + `oura_bucket` server table exist; the dedicated endpoint is single-connection; replace-by-day outbox verified; B5 load test within the pool budget.
- [ ] **Device (the durability proof):** wipe + restore returns the full calculated history matching Railway, sleep incl. HRV/stages.
- [ ] Single-writer flip verified; reversibility/freshness trades documented.

**Out of scope (Phase 3–4):** retiring the server *raw* ingest, the 437k-row drop (confirm-first + completeness audit), the read-flip's native-capability probe (D7), the ops-doc I10 "redecode forever" rewrite (rides with the Phase-3 drop).

## Status
✅ **Entry-gate review CLEARED (2026-07-21)** — the "another agent's review before implementation" pass ran (three code-grounded reviewers). It found 3 structural blockers + reference fixes, all resolved in the **Second Review Outcome** section near the top (which supersedes the affected task text). **Implementation may begin**, in the dependency order stated there: F1 first (safe, no blocker depends on it), then B1/B4 server infra + day-grained monotonic-`updated_at`, Track A, the Track-B dedicated pull endpoint (keyset cursor), the F3 restore driver, cutover, and the RST device proof. Every client/`applyDelta`/restore half remains device-verified per the Sandbox-vs-device note.
