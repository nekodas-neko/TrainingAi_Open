# Data Layer Rules — Sync, Migrations, Stored Counters

Moved out of `CLAUDE.md` on 2026-09-02 to keep that file to what every session needs —
this is mostly Lane A's territory (`lib/data/**`, `lib/local-store/**`, `app/api/**`) per
the standing-agents lane split (`docs/agents/README.md`). Nothing changed in the move.

## Offline Sync — one write path per domain; the outbox must never wedge

**Strict rule.** Every offline-first domain has two server write paths: the web API route and its `pushMutations` branch in `lib/data/postgres/adapter.ts`. They have repeatedly drifted, and the failure mode is always the same: web works, the APK mutation strands silently.

- **Sync-push must mirror the web route.** If you change a route's write semantics — defaults (`sleepQuality ?? 'ok'`, #47), validation, `ON CONFLICT` target (#74: id-only vs the `(user_id, date, start_time)` partial index), or side effects (PR upserts, phase counters, ownership checks) — update the `pushMutations` branch **in the same PR** and diff the two paths as part of review. Prefer one shared repo function per domain.
- Every UPDATE/DELETE in `pushMutations` is scoped to `user_id`, no exceptions.
- **One bad mutation must never wedge the queue** (3 production incidents: #47, #74, #82). A 4xx/validation failure is a poison pill: quarantine it, don't retry forever, and never let it block the mutations behind it. 5xx/429 = back off and retry. Never `break` the whole push loop on a single failed batch.
- Confirm/delete outbox rows by their stable mutation `id`, never by `domain:date` composites — one failed food log must not strand its same-day siblings.
- When adding or touching a synced domain, verify the full chain in one pass: local table columns = server payload fields = `getSyncDelta` output = `pullDelta` mapping = `applyDelta` upsert columns, **including reference tables needed to render** (a log table must pull its item table too — the `food_items` gap was the #1 data-loss bug). `applyDelta` branches must gate on `sync_status === 'synced'` before overwriting — a pull must never revert a pending local edit.
- **Sync pulls and pushes are paginated — loop the cursor until exhausted** (`packages/shared/src/sync/cursor.ts`, PR #97). Never assume a single response carries the full delta; touching `getSyncDelta` means preserving the `pageLimit`/cursor contract on both ends.
- **Every user-visible write needs an outbox domain** — any POST reachable offline must queue a mutation or visibly fail; `fetch("/api/…").catch(() => {})` is the smell (complete-workout once shipped this way).
- **The outbox payload must carry every field the web route accepts** — adding a route field means updating the local table, the `queueMutation` payload, the `pushMutations` branch, and the pull mapping in the same PR (the GPS-data-loss bug).
- **Local upserts overwrite all columns by default** — a single-field save must read-merge first (copy `water-log-sheet`'s pattern, not `metric-log-sheet`'s).
- **A server hard DELETE is invisible to devices that haven't synced** — any domain with delete UI needs a `deleted_at` tombstone emitted by `getSyncDelta`, or cross-device deletes don't propagate. Any local write to an already-synced row must flip `sync_status='pending'`, or the pull-clobber gate above can't protect it.
- **`pullDelta` domain flags must cover every table the delta applies to** — a new synced domain needs its domain flag and sync-provider group mapping added in the same PR.
- `onConflictDoUpdate` arms are UPDATEs — scope them to `user_id` (`setWhere`) or pre-check ownership, same as any other write.

---

## Local SQLite Migrations — assume partial application

The local DB has been silently dead on Android **twice** from migration bugs (WAL pragma inside the upgrade transaction #27; non-idempotent `ADD COLUMN` rolling back the whole version #85), and each time every local read returned empty — the root of the recurring "my data disappeared" reports.

- No PRAGMAs inside upgrade `statements` — the Capacitor plugin wraps upgrades in a transaction and SQLite rejects journal-mode changes there. Set pragmas post-open.
- `ADD COLUMN` is not idempotent: a retried partial upgrade throws "duplicate column" and rolls back, leaving `open()` throwing forever. Assume any local migration can partially apply.
- Every new local table/column must be registered in `RECONCILE_TABLES`/`RECONCILE_COLUMNS` **in the same commit** as the migration — `reconcileSchema()` is the real schema authority after a partial upgrade, and 17 tables were once missing from it. Two CI checks split this: `check-reconcile.js` covers `ALTER TABLE … ADD COLUMN` and `CREATE TABLE`, and `check-local-column-upgrade-path.js` covers the case it cannot see — **a column added to a `CREATE TABLE IF NOT EXISTS` body reaches fresh installs only.** `CREATE TABLE IF NOT EXISTS` is a no-op on a device that already has the table and `reconcileSchema()` adds only columns named in `RECONCILE_COLUMNS`, so such a column is missing *forever* on upgraded devices while every test and every fresh install passes. Swept over all 41 commits touching `migrations.ts` on 2026-08-09: zero instances, and the check keeps it there.
- Never make a critical write path depend solely on the local store opening.

---

## Postgres Data Migrations — seeds don't fix drifted prod rows

- `ON CONFLICT DO NOTHING` seeds only govern fresh databases; a pre-existing or drifted production row is never corrected (treadmill `is_distance_based` stayed `true` in prod for months — migration 094 couldn't fix it, 101 had to). If a seeded value is load-bearing, ship an explicit idempotent `UPDATE … WHERE` migration.
- Never resolve seeded rows by name at migration run time — they may not exist yet for users who haven't logged in (the 042→047 fix chain). Create what you reference in the same migration; corrective migrations must be unconditional and idempotent.
- A bug that reproduces in prod but not locally: suspect **prod data drift vs the fresh local seed** before suspecting code — the local dev DB is always seeded correct.
- Never delete-and-reinsert rows that other tables FK onto — `ON DELETE SET NULL` wiped session identity on every config save and broke phase tracking across four deploys (sessions 107–109). Upsert in place; edit UIs must round-trip DB ids.
- **Claim migration numbers against both the directory AND open PRs/plan docs.** The tree already carries two collided pairs (081×2, 087×2) and `migrate.js` applies in plain filename sort order, so a duplicate number makes apply order ambiguous. When plans pre-allocate numbers (e.g. 103–107 across parallel batches), honour the allocation; same discipline for local SQLite version numbers.

---

## Stored Counters — derive, or reconcile on read

Every stored counter in this project has drifted (`sessions_in_phase`: over-counted on re-sync in session 87, never decremented on delete, inflated by direct DB edits — fixed three separate times). Derive counts from source-of-truth queries at read time. If a stored counter is unavoidable for performance, pair it with a reconcile-on-read self-heal (`reconcileSessionsInPhase` pattern) **in the same PR** that introduces it.

---


## A Correlation Across a Model Change Is Not Evidence

**Stamp the model, and split on it before you believe a number.** Scores in this app are recomputed
by models that change: `body_battery_daily.model_version` held **four distinct models** over 40
post-re-key days, with no recompute when the model changed. Pooling them produced a documented false
conclusion — the 2026-08-04 Known-Issues row recorded end-of-day battery vs next-day readiness at
**r = −0.06** and used it as evidence the model had no outcome signal. Split by version, **v5 days
alone give r = +0.67** (n = 11). The pooled figure was an artefact of mixing four models and it stood
in the docs for eleven days.

- **`oura_daily_derived.model_versions` is a MAP of pillar → version, and it MERGES.**
  `upsertOuraDailyDerived` concatenates it with `||` rather than `COALESCE`-replacing it, so each
  pillar writes only its own key and no writer can erase another's. Never re-introduce a read-merge
  in JS: that is two statements, so it races, and it reads a value that may already be stale. It was
  there because the upsert replaced the map — `backfillBodyComp` wrote `{bodyComp: …}` flat and
  erased the readiness stamp on every day it touched (Q-273).
- **`updated_at` is not evidence of which model wrote a row.** A bulk job bumped it on essentially
  every `oura_daily_derived` row without rewriting a single score, so auditing "did the recalibration
  land?" by timestamp gives the wrong answer (Q-501).
- **A stored score and the inputs stored beside it can disagree** — summaries get recomputed and the
  derived rows built from them are not recomputed in step. **5 of 33** recovery-index rows disagreed
  with the summary they derive from. So before quoting a stored score, know whether you are reading
  a value or a claim about one.

