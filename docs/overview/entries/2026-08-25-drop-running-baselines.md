# 2026-08-25 — drop the `running_baselines` table (Q-301b)

**Branch:** `chore/drop-running-baselines` · **Lane A** · migrations 220 + 221. No user-visible change.

Q-301 removed the code half on 2026-08-24 — `saveRunningBaseline`/`getRunningBaseline`, the
`RunningBaseline` interface, the dead write in `app/api/running-plan/route.ts`, and the Drizzle
`schema.ts` entry. That left the physical table behind as a leftover no query could name. The owner
authorised the drop the same day and the `Gate: owner` was cleared; this is that follow-up.

## Why it was safe to drop, evidenced rather than assumed

Re-verified against production immediately before writing the migration, because the authorisation
rests on the table never having been written:

- **`n_tup_ins = 0`**, with `n_tup_upd` and `n_tup_del` also 0, and 16 kB total. That counter is a
  lifetime insert count maintained on every write — **not** a planner estimate like `n_live_tup`
  (which is stale on this database: `last_analyze` is NULL on every table, and trusting it once
  filed a data-loss incident, Q-528, that had never happened) and **not** row-scoped to one user
  like a `claude_ro` `count(*)`. No row has ever been inserted by anyone.
- **The emptiness is explained**, not a mystery: the writer landed in migration 146 *after* the only
  `running_plans` row was created (2026-07-21), and no plan has been created since. Not a silent
  write failure.
- **The feature uses something better.** `resolveSnapshot()` in
  `packages/shared/src/running/assemble-plan-context.ts` recomputes from `fitness_tests` and
  `body_metrics` fresh on every request, so the 12 `prescribed_runs` derive from live data rather
  than the plan-creation-time snapshot this table would have held.

## The dependency the backlog entry did not mention

`claude_ro.running_baselines` is a **view over the table**, rebuilt by every claude_ro migration
through 218. A bare `DROP TABLE` would have failed on the dependency, and a `CASCADE` would have
taken the view silently. So this is two migrations, following the exact shape of the
`214_drop_push_subscriptions` / `215_claude_ro_views_drop_push` pair:

- **220** drops the view **by name** — cascade would silently take whatever else happened to depend
  on the table, and the point of a migration like this is that its blast radius is written down —
  then drops the table. Both `IF EXISTS`, so a re-run is a no-op.
- **221** regenerates the whole claude_ro schema from
  `scripts/generate-claude-ro-views.js`. A **new** number rather than an edit to 218: `ensureSchema`
  tracks applied migrations by filename, so an edited already-applied file is skipped forever and
  the change silently never lands.

Filename sort order is what guarantees 220 runs first.

The generator **reads the live local schema**, not `schema.ts`, so 220 had to be applied locally
before 221 could be generated. Worth knowing for the next table drop — it is not obvious from the
file, and generating first would have silently reproduced the view.

## Verified

- **593 test files, 4,877 tests, 0 failures** (`unit` 570 files / 4,809 tests; `rollup` 23 files /
  68 tests). The three `claude_ro` suites were run again on their own to confirm they **ran** rather
  than skipped — 31 passed, 0 skipped. That matters because `claude-ro-readonly-role.test.ts` skips
  silently under the socket-form `DATABASE_URL`; both runs used the TCP form.
- `tsc --noEmit` clean · `pnpm lint` 0 errors (123 pre-existing warnings) · `pnpm check:rules`
  **Ran 57 of 57** · `check-migration-numbers` 218 numbers, no collisions, next free 222 ·
  `check-export-coverage` OK at 84 tables.
- Diffed 221's view list against 218: **the only difference is the removal of `running_baselines`**
  (88 → 87 `CREATE VIEW` statements). No other view changed.
- Confirmed the generated file contains no owner id — views scope on
  `current_setting('app.claude_ro_owner', true)` since Q-456, and the value passed to the generator
  appears nowhere in the output.
- `pnpm dev` booted clean, `[ensureSchema] 0 applied, 0 already present, 0 failed`, no
  relation-does-not-exist errors in the log. `/api/version` 200, `/api/running-plan` 401 unauth
  (fail-closed, as it should be).

## Not exercised

- **The migrations have not run against production** — that happens on the Railway deploy after
  merge. Locally they applied cleanly to a database that already carried all 219 prior migrations,
  and CI's Migration Check runs them against a fresh one.
- **No authenticated round-trip of `/api/running-plan`.** Its code no longer references the dropped
  table (Q-301 removed every reference; `tsc` and the full suite confirm), so the unauthenticated
  load check plus the suite was judged sufficient. Nothing device-specific is involved.
- Nothing native, offline-first, safe-area or gesture-related is touched, so no device smoke run is
  owed.

## Left in the queue deliberately

The entry's closing observation is **not** actioned here and is not lost: this is the third instance
of a recurring class — Q-270 (`training_load_ots`: live producer, zero rows) and Q-231 (the
"Exercise detected" card losing its only writer) — and it proposes a CI check that flags a
repository read method with no callers outside the data layer. That is its own piece of work, filed
as **LA-26** rather than folded in here.
