# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** the second session to run as Lane A · **Q band:** 314–349 (next free: **317**)
**Migrations:** 189–193 taken; next free is **194**. Local SQLite unchanged at v22.

## Now

**The standing priority is the owner's instruction of 2026-08-17:** the 5 GB volume is temporary and
must be **deprecated by end of this week**. *All work aims at returning the database to the stock
500 MB.* Everything below is ordered by that.

### The reclaim is built. Almost none of it has run.

| Step | Worth | State |
|---|---:|---|
| Migration **193** drops `idx_oura_raw_samples_user_measured` | **136 MB** | ✅ merged — `DROP INDEX` frees the index's files immediately, so this lands on the next deploy with **no press needed** |
| Pack the raw frames (Q-541 Task 5 backfill) | **~630 MB** | ⛔ **needs a press against production** |
| `VACUUM FULL error_events` (Q-315) | **~49 MB** | ⛔ **needs a press against production** |

Production measured 2026-08-18: **819 MB**, `oura_raw_samples` **699 MB** (255 MB heap, 443 MB
indexes). With all three: **~140 MB**. Without the two presses: ~683 MB, still over.

**Nothing has been packed in production and no row has moved.** Do not read the shipped tasks as
progress against the deadline — say so plainly, as `projectOverview.md` now does.

### Why it needs a press, and the three ways out

Every reclaim is behind an admin-session-gated route, and **a sandbox session cannot authenticate to
production** (`CLAUDE_DB_QUERY_SECRET` is read-only; `ADMIN_EXPORT_SECRET` is GET-only on one route).
So one of these has to happen:

1. **The owner runs the curls** with their own session cookie. Exact commands are in
   `docs/handoff-2026-08-18-platform-database-reclaim.md`.
2. **Lane B builds the buttons** — Q-316 for the packer, and the same card wants one for
   `/api/admin/vacuum`. Then the owner presses in the app.
3. **A bearer-token path on the two routes**, like `ADMIN_EXPORT_SECRET` does for day-review, so a
   session can drive it. **This is an auth change and is confirm-first** — it has been put to the
   owner and not answered. Do not build it on your own judgement.

Note the plan's own gate on the backfill (§9): *a verified backfill on a copy of production before
the real one.* A sandbox cannot make that copy either. The mitigation actually in the code is the
packer's per-bucket verify — it re-reads each committed blob and refuses to delete unless the frames
prove equal — plus the bound, so the first press can be `{"maxBuckets": 1}` and the result inspected
before going further.

## Next

1. **Drive the two presses** (above) the moment the owner picks a route. This is the whole deadline.
2. **Q-541 Task 6 — hot-window prune.** Only after Task 5 has verified clean in production. Writable
   before that, not verifiable.
3. **Q-534 findings 1–3**, all still open: the dedup index stores `body_hex` a *second* time
   (**156 MB**, and note packing removes the rows it indexes, so this shrinks on its own once Task 5
   runs — do it after, or not at all); autovacuum has never run on the table; `work_mem` is 4 MB
   against a query that sorts 1.1 M rows.
4. **Q-353** `[platform]` — the health-insight prompt substitutes the literal `"no data"` for an
   absent field at ten sites and the model reads it as **zero**. Smallest self-contained item in the
   band, `app/api/ai/health-insight/route.ts` only, exact line numbers in the entry. Take this when
   the storage work is blocked.
5. **Q-314** `[devices][platform]` — owner-approved: make a ring re-key **explicit** rather than
   inferred from counter shape. Until it lands, every re-pair reopens Q-536.
6. **Q-537** `[devices][platform]` — owner-approved, but credential handling and **nothing about it
   is checkable from the sandbox**. Device-only verification.
7. **Q-535** `[platform][devices]` — the redecode 502s at the gateway. **Note it is now much smaller
   than its entry says**: the redecode's row-walking phase is a no-op since Q-541 Task 7, so the
   heavy half is gone and only the aggregate remains. Re-verify the premise before building. Split
   across lanes — job id is Lane A, poller is Lane B.

**Q-313** touches `scripts/`, which neither lane lists — claim it here first and check Lane B's baton.

## Blocked
- **Q-541 Task 5 and Q-315** — on the owner, per the three options above. This is the only thing
  standing between the current 819 MB and ~140 MB.
- **Q-537** — approved, but unverifiable from here.

Owed rather than blocked: the device check on Q-310, filed as a Known-Issues row in
`projectOverview.md`. Confirm at the next engine-chosen deload: header "Deload", reduced weights, no
PR badge.

## Claimed paths
None held. `app/api/admin/vacuum/` is new and Lane A's (under `app/api/**`).

## Findings recorded, so they are not re-derived
- **The two-tier reader is the only sanctioned way to read raw frames** —
  `lib/data/postgres/slices/oura-raw-frames.ts`, with a `docs/module-map.md` row saying so. A
  hot-only read silently returns a 7-day history and raises nothing.
- **An aggregate cannot use that reader's dedupe.** The summary's per-tag counts double-counted a
  bucket present in both tiers — 80 frames read as **120** on the dev server. Count via an anti-join
  on `(epoch, tag, ds_bucket)`.
- **`oura_raw_samples.measured_at` and `event_name` are DEAD COLUMNS.** Still present, still written
  at ingest, read by nothing. Every reader derives from the anchors and from `tag`. **Do not add a
  new reader of either.** Dropping the columns is a data-dropping migration and owner-gated.
- **The redecode's re-stamp — the mechanism of the 2026-08-17 disk_full outage — is now a no-op**,
  because it wrote those dead columns. That removes the operation rather than mitigating it, so
  Q-534's request for a pre-flight free-space guard on that route is moot.
- **`/api/oura/stats` read `connected` off "can we name a last-measured time"**, which stopped being
  the same question once the time became derived. Split into `hasOuraBleSamples`. The failure would
  have been silent — `oura-section.tsx` returns null on `!connected`.
- **The `VACUUM FULL` allowlist is a safety boundary, not validation** — VACUUM takes no bind
  parameter, so the table name is interpolated. Checked with `hasOwnProperty`, never `in`
  (`'toString' in obj` is true for every object); mutation-checked test.
- **`error_events`: 4 live rows in 49 MB.** Not a leak — Q-539 fixed the writer — just space MVCC
  never handed back.

## Do not re-litigate
- Lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md). Take Q numbers from the band above, never from the
  backlog's next-free pointer.
- **Q-541 Task 0 is answered structurally and must not be re-answered by counting.** `epoch` is not
  in the dedup unique constraint, so a cross-epoch duplicate was never insertable. Counting now
  returns "none" for the *wrong* reason, because migration 190 collapsed every sample to epoch 0.
- **Q-540 is superseded by Q-541** — a packed blob *is* `bytea`, and packed rows store no
  `event_name`. Doing both rewrites 1.1 M rows twice.
- **Q-310's fix-direction items 2 and 3 were refuted and deliberately not built.** `estimateOneRm`
  returns exactly `0` when `deloaded` and the badge already gates on `> 0`; and
  `logExerciseFromPayload` reads `session_periodization` independently of the route.
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` saying "still open" until #17.

## Method notes worth keeping
- **A migration verified on a fixture is not verified.** Q-536's first migration passed a 5-test
  local suite and CI and still rolled back on every production boot: the fixture was 8 rows, the real
  table 434,707 on 667 MB, and the pool's `statement_timeout` is **15 s**. Ask what the production
  row count is *before* writing a data migration, and put `SET LOCAL statement_timeout` on anything
  not obviously small.
- **The tell that a migration silently failed:** absent from `schema_migrations` while
  `/api/version` reports the release carrying it. `ensureSchema` catches, logs to console only, and
  retries every boot — there is no `error_events` row. Check the table, not the logs.
- **Rehearse a data change through the live dev server, not just the suite.** Task 3's double-count
  survived tsc, lint, 3,937 tests and review; thirty seconds of `curl` against `pnpm dev` with the
  packer rehearsed by hand caught it. Seed a few ring-days, pack half the buckets, diff the API
  responses across all-hot / both-tiers / hot-deleted.
- **`CLAUDE_DB_QUERY_SECRET` works from the sandbox**, but mind the `claude_ro` search_path:
  `pg_total_relation_size('oura_raw_samples')` resolves to the **view** and returns 0. Join
  `pg_class` to `pg_stat_user_tables` on `relnamespace = 'public'::regnamespace` for real sizes.
  Row-scoped to the owner; phrase findings accordingly.
- **The seed user is not an admin and has no raw samples.** For BLE/admin routes:
  `UPDATE users SET is_admin = true WHERE email='test@local.dev'` (checked against the DB, not the
  JWT, so an existing cookie keeps working) and **revert it after**.
  `npx playwright test --project=setup` mints a real session cookie into `e2e/.auth/seed-user.json`.
- **The rate limiter has an in-memory L1 in the dev-server process.** `DELETE FROM rate_limits` does
  not clear it — restart `pnpm dev` if you 429 yourself while testing a route.
- **`scripts/check-doc-index-size.js` conflicted on SIX consecutive merges this session.** Resolve it
  mechanically, never by splicing a hunk: delete the numeric lines, re-measure the merged files,
  write the numbers back, keep both prose blocks. A reusable resolver is worth keeping to hand.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a stale base, not slow
  CI** — hit three times this session. Fetch, merge, push; checks start immediately. Conversely, when
  it looks frozen on a PR whose base *is* current, attempting the merge is the reliable check:
  branch protection refuses a genuinely pending required check.
- **After merging another lane's work, `pnpm install` before believing a `tsc` error.** A missing
  `qrcode` module read as a code error and was just an uninstalled dependency.
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041` —
  `progression_styles.created_at` missing). Unrelated to any change; ignore them.
