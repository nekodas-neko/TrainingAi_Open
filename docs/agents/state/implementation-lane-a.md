# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** the second session to run as Lane A · **Q band:** 314–349 (next free: **319**)
**Migrations:** 189–197 taken; next free is **198**. Local SQLite unchanged at v22.

## Now

**The standing priority is still the owner's instruction of 2026-08-17:** the 5 GB volume is
temporary and must be **deprecated by end of this week**. *All work aims at returning the database to
the stock 500 MB.*

### The reclaim is built. Two thirds of it has still not run.

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged — `DROP INDEX` frees the files immediately, so it lands on deploy with **no press** |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

Production was **819 MB** on 2026-08-18 (`oura_raw_samples` 699 MB: 255 MB heap, 443 MB indexes).
With all three: **~140 MB**. Without the two presses: ~683 MB, still over.

**Nothing has been packed and no row has moved.** Do not read the shipped tasks as progress against
the deadline; `projectOverview.md` says so and should keep saying so.

**Why it needs a press, and the three ways out** — full detail and a paste-ready runbook in
[`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md).
In short: every reclaim is admin-session-gated and **a sandbox session cannot authenticate to
production** (`CLAUDE_DB_QUERY_SECRET` is read-only; `ADMIN_EXPORT_SECRET` is GET-only on one route).
Either the owner runs the curls, or Lane B builds the buttons (Q-316), or a **confirm-first**
bearer-token path is added. **Do not build the third without an explicit yes — it is an auth change.**

## Shipped this session (for the successor's orientation, not for credit)
Q-310, Q-536, Q-539, Q-351, Q-541 Tasks 0–4 and 7, Q-534 finding 4, Q-315 (route), Q-353, Q-314,
Q-535 (Lane A half), Q-356. Everything is on `main`.

## Next
1. **Drive the two presses** the moment the owner picks a route. This is the whole deadline.
2. **Q-541 Task 6 — hot-window prune.** Only after Task 5 has verified clean in production.
   Writable before that, not verifiable.
3. **Q-534 findings 1–3**, still open: the dedup index stores `body_hex` a *second* time
   (**156 MB** — but packing removes the rows it indexes, so it shrinks on its own once Task 5 runs;
   do it after, or not at all); autovacuum has never run on that table; `work_mem` is 4 MB against a
   query sorting 1.1 M rows.
4. **Q-460** `[workouts][platform]` — the session-RPE route reports success for a write that matched
   nothing, and the sync path then discards the mutation. Genuine data loss; not yet triaged by Lane A.
5. **Q-463 / Q-464** `[platform]` — "the row you named does not exist" answered five different ways
   with five 500s; and request schemas almost never `.strict()`, which on a date-bearing write route
   turns a mistyped key into a silent wrong-day write.
6. **Q-537** `[devices][platform]` — owner-approved, but credential handling and **nothing about it
   is checkable from the sandbox**. Device-only verification.
7. **Q-540** `[devices][platform]` — largely superseded by Q-541; take only if packing is abandoned.

**Q-313** touches `scripts/`, which neither lane lists — claim it here first and check Lane B's baton.

## Blocked
- **Q-541 Task 5 and Q-315** — on the owner, per the three options above.
- **Q-537** — approved, unverifiable from here.

Owed rather than blocked: the device check on Q-310, filed as a Known-Issues row in
`projectOverview.md`. Confirm at the next engine-chosen deload: header "Deload", reduced weights, no
PR badge.

## Claimed paths
None held. `app/api/admin/vacuum/`, `app/api/oura-ble/rekey/` and
`lib/data/postgres/slices/oura-raw-{frames,pack}.ts` are new and Lane A's.

## Findings recorded, so they are not re-derived
- **All raw-frame reads go through `lib/data/postgres/slices/oura-raw-frames.ts`.** A hot-only read
  silently returns a 7-day history and raises nothing. There is a `docs/module-map.md` row.
- **An aggregate cannot use that reader's dedupe** — the summary's per-tag counts double-counted a
  bucket in both tiers (80 read as **120**). Count via an anti-join on `(epoch, tag, ds_bucket)`.
- **`oura_raw_samples.measured_at` and `event_name` are DEAD COLUMNS.** Present, written at ingest,
  read by nothing. **Do not add a new reader.** Dropping them is data-dropping and owner-gated.
- **The redecode's re-stamp — the mechanism of the 2026-08-17 disk_full outage — is a no-op now**,
  so Q-534's ask for a free-space pre-flight guard on that route is moot.
- **A ds regression is NOT evidence of a ring-clock reset** (Q-314). A re-drain produces one. The
  discriminator is the *ratio* to the epoch ceiling — 53% and 89% on the two real events, against a
  5% bound. A re-key is **declared** (`POST /api/oura-ble/rekey`); the ratio is only a net, and it is
  unvalidated in the direction it exists for because there is no observed true reset in the data.
- **The `VACUUM FULL` allowlist is a safety boundary, not validation** — VACUUM takes no bind
  parameter. `hasOwnProperty`, never `in` (`'toString' in obj` is true for every object).
- **`error_events`: 4 live rows in 49 MB.** Not a leak — Q-539 fixed the writer — just space MVCC
  never handed back.
- **The redecode's `?async=1` job path exists but is opt-in** (Q-535). The default is unchanged
  because both consoles report completion from the synchronous shape; flipping it blind makes them
  say finished work had finished when it had only started. **Q-318** is the other half.

## Do not re-litigate
- Lane contract, authority limits and Q bands are in [`docs/agents/README.md`](../README.md). Take Q
  numbers from the band above, never from the backlog's next-free pointer.
- **Q-541 Task 0 is answered structurally and must not be re-answered by counting.** `epoch` is not
  in the dedup unique constraint. Counting now returns "none" for the *wrong* reason, because
  migration 190 collapsed every sample to epoch 0.
- **Q-540 is superseded by Q-541** — a packed blob *is* `bytea`, and packed rows store no
  `event_name`. Doing both rewrites 1.1 M rows twice.
- **Q-310's fix-direction items 2 and 3 were refuted and deliberately not built.**
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` saying otherwise.

## Method notes worth keeping
- **A migration verified on a fixture is not verified.** Q-536's first migration passed a 5-test
  suite and CI and still rolled back on every production boot: the fixture was 8 rows, the table
  434,707 on 667 MB, and the pool's `statement_timeout` is **15 s**. Ask the production row count
  *before* writing a data migration; put `SET LOCAL statement_timeout` on anything not obviously
  small.
- **The tell that a migration silently failed:** absent from `schema_migrations` while
  `/api/version` reports the release carrying it. `ensureSchema` catches, logs to console only, and
  retries every boot — there is no `error_events` row.
- **Rehearse a data change through the live dev server, not just the suite.** Q-541 Task 3's
  double-count survived tsc, lint, 3,937 tests and review; thirty seconds of `curl` against
  `pnpm dev` caught it. Same for Q-353, where the real model's output is what proved the fix.
- **A new table needs a regenerated `claude_ro` view migration** or the coverage guard goes red.
  Generate it **after** the table exists locally — the generator reads the live schema, so running it
  first silently emits a file with no view for the new table.
- **A Next.js `route.ts` may not export arbitrary symbols.** Exporting helpers for tests fails the
  generated route-type check (`Property 'x' is incompatible with index signature`). Put them in a
  sibling module.
- **`CLAUDE_DB_QUERY_SECRET` works from the sandbox**, but mind the `claude_ro` search_path:
  `pg_total_relation_size('oura_raw_samples')` resolves to the **view** and returns 0. Join
  `pg_class` to `pg_stat_user_tables` on `relnamespace = 'public'::regnamespace`.
- **The seed user is not an admin and has no raw samples.** `UPDATE users SET is_admin = true WHERE
  email='test@local.dev'` (checked against the DB, not the JWT, so an existing cookie keeps working)
  and **revert after**. `npx playwright test --project=setup` mints a cookie into
  `e2e/.auth/seed-user.json`.
- **The rate limiter has an in-memory L1 in the dev-server process.** `DELETE FROM rate_limits` does
  not clear it — restart `pnpm dev` if you 429 yourself.
- **The local DB is shared across branches.** A table created by another branch's migration makes the
  `claude_ro` coverage guard fail on a branch that lacks it — local skew, not a defect. It clears when
  the other branch merges.
- **`scripts/check-doc-index-size.js` conflicted on EIGHT consecutive merges this session.** Resolve
  mechanically, never by splicing: delete the numeric lines, re-measure the merged files, write them
  back, keep both prose blocks. Same for `package.json`/`changelog.ts` — rebuild from
  `git show origin/main:…` and prepend your entry.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a stale base, not slow
  CI.** Fetch, merge, push. Conversely, when it looks frozen on a current base, attempting the merge
  is the reliable check — branch protection refuses a genuinely pending required check.
- **After merging another lane's work, `pnpm install` before believing a `tsc` error.** A missing
  `qrcode` module read as a code error and was an uninstalled dependency.
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041`).
  Unrelated to any change; ignore them.
