# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-18 · **By:** the second session to run as Lane A · **Q band:** 314–349 (next free: **316** — 314 is the ring re-key defect, 315 the `error_events` bloat)
**Migrations:** 189–192 taken; next free is **193**. Local SQLite unchanged at v22.

## Now
**The standing priority is the owner's 2026-08-17 instruction:** the 5 GB volume is temporary and
must be **deprecated by end of this week**. *All work aims at returning the database to the stock
500 MB.* Everything below is ordered by that.

**Production, measured 2026-08-18:** database **819 MB** (up from 786 MB the day before).
`oura_raw_samples` is **699 MB** — 255 MB heap, **443 MB indexes**. The four indexes and their scan
counts:

| index | size | idx_scan |
|---|---:|---:|
| `oura_raw_samples_user_id_ring_timestamp_ds_tag_body_hex_key` | 156 MB | 19,917 |
| `idx_oura_raw_samples_user_measured` | 136 MB | **165** |
| `oura_raw_samples_user_tag_ts` | 104 MB | 365 |
| `oura_raw_samples_pkey` | 48 MB | 43,195 |

Q-541's packing removes all of it — the rows go away — which is why it outranks the index work.

**Q-541 Tasks 0–3 shipped** (v1.318.11 + v1.318.12; migrations 191–192, `lib/oura-ble/frame-pack.ts`,
`lib/data/postgres/slices/oura-raw-frames.ts`). **Still inert in production: nothing writes a blob
and no row has moved.** Tasks 4–7 are the actual size win.

**Four owner decisions from 2026-08-17, recorded so they are not re-asked:**
1. **Q-314** → *declare a re-key explicitly*. Approved, not yet built.
2. **Q-537** → *reveal + copy, and warn on clearKey*. Approved, not yet built. Device-only verify.
3. **Q-540 vs Q-541** → my call: **take Q-541, skip Q-540's `bytea` half** (the packed blob *is*
   bytea — doing both rewrites 1.1 M rows twice). Q-540's `event_name` half is superseded too, since
   packed rows do not store it.
4. **Q-534** → the 5 GB volume is temporary, deprecated by end of week; all work aims at 500 MB.

## Next
1. **Q-541 Task 4 — the packer.** The next thing to build, and the first that touches data.
   Read plan §6 before writing a line: seal → write **and verify by re-reading** → delete, with the
   three phases NOT in one transaction. **The delete is the only destructive statement in the whole
   plan.** Admin-triggered, bounded per call, idempotent, resumable — never automatic on deploy.
2. **Q-541 Task 5 — backfill**, then `VACUUM FULL` *after*, not during. The plan's own gate: a
   verified backfill on a copy of production before the real one. 968 blobs is small; the delete
   side is 1.1 M rows, so batch it.
3. **Q-315 — `error_events`: 4 live rows in 49 MB.** The cheapest MB in the database and filed this
   session. One `VACUUM FULL` behind the existing admin gate; nothing re-grows because Q-539 already
   fixed the write path. Take it if Task 4 stalls — it is ~6% of the database for one statement.
4. **Q-541 Tasks 6–7** — hot-window prune (only after Task 5 verifies clean), then the `measured_at`
   range-query sweep, which is coupled to Q-534's index drop.
5. **Q-537** `[devices][platform]` — owner-approved but **credential handling**, and nothing about it
   is checkable from the sandbox. Device-only verification.
6. **Q-314** `[devices][platform]` — owner-approved: make a re-key **explicit** rather than inferred
   from counter shape. Until it lands, every ring re-pair reopens Q-536.
7. **Q-353** `[platform]` — the health-insight prompt substitutes the literal `"no data"` for an
   absent field at ten sites and the model reads it as **zero**. Smallest self-contained item in the
   band; `app/api/ai/health-insight/route.ts` only, exact line numbers in the entry.
8. **Q-535** `[platform][devices]` — the redecode holds the request open and 502s at the gateway,
   inviting a retry of a full-table rewrite. **Split across lanes**: the job id is Lane A, the client
   poller is Lane B. Agree the seam first.

**Q-313** touches `scripts/`, which neither lane lists — claim it here first and check Lane B's baton.

## Blocked
- **Q-537 needs nothing further from the owner** (approved 2026-08-17) but cannot be verified from
  the sandbox at all. Do not claim it done from a green build.
- Nothing else is blocked. Q-536 is closed: the full-history redecode ran and the owner confirmed on
  device — the midday cluster went 43 → 4 nights and 21:00–22:00 went 25 → 62, total unchanged at 82.
  The four survivors are short daytime fragments, which is Q-274.

One thing **owed** rather than blocked: the device check on Q-310, filed as a Known-Issues row in
`projectOverview.md`. Server/JS only, so it reached the APK through the Railway deploy with no
rebuild — but the client half was verified from the route's response, not on hardware. Confirm at the
next engine-chosen deload: header "Deload", reduced weights, no PR badge.

## Claimed paths
None held.

## Findings recorded, so they are not re-derived
- **The two-tier reader is now the only sanctioned way to read raw frames** —
  `lib/data/postgres/slices/oura-raw-frames.ts`, and there is a `docs/module-map.md` row saying so.
  A hot-only read silently returns a 7-day history and raises nothing.
- **An aggregate cannot use that reader's dedupe.** The summary's per-tag counts double-counted a
  bucket present in both tiers — 80 frames read as **120** on the dev server — because identity
  dedupe needs the frames themselves. Count via an anti-join on `(epoch, tag, ds_bucket)`.
- **`event_name` and `measured_at` are derived now, never read**, because a packed frame carries
  neither. That also drops stale stored names — the drift `refreshRawSampleEventNames` exists to
  repair.
- **Q-534's finding 4 is not a drop-in index drop.** `idx_oura_raw_samples_user_measured` (136 MB)
  has two live consumers — `getLatestOuraBleMeasuredAt` (`slices/oura.ts:173`) and
  `getOuraRawSamplesForTags` (`adapter.ts`) — and both become sequential scans of the largest table
  without it. Order is rewrite → prove equivalence → drop.
- **`error_events` is 49 MB of dead tuples behind 4 live rows** (Q-315). Not a leak — Q-539 fixed the
  writer — just space MVCC never handed back.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md). Take Q numbers from the band above, never from the
  backlog's next-free pointer.
- **Q-541 Task 0 is answered structurally and must not be re-answered by counting.** `epoch` is not
  in the dedup unique constraint, so a cross-epoch duplicate was never insertable. Counting now
  returns "none" for the *wrong* reason, because migration 190 collapsed every sample to epoch 0.
- **Q-310's fix-direction items 2 and 3 were refuted and deliberately not built.** `estimateOneRm`
  returns exactly `0` when `deloaded` and the badge already gates on `> 0`; and
  `logExerciseFromPayload` reads `session_periodization` independently of the route, so the server
  zeroed the estimate and refused the PR throughout. Both production deload sessions carry
  `max(estimated_1rm) = 0` and no `personal_records` row.
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` saying "still open" until #17.

## Method notes worth keeping
- **A migration verified on a fixture is not verified.** Q-536's first migration passed a 5-test
  local suite and CI and still rolled back on every production boot: the fixture was 8 rows, the real
  table 434,707 on 667 MB, and the pool's `statement_timeout` is **15 s**. Ask what the production row
  count is *before* writing a data migration, and put `SET LOCAL statement_timeout` on anything not
  obviously small. `SET LOCAL` works inside `pool.query()`'s implicit transaction, both directions.
- **The tell that a migration silently failed:** absent from `schema_migrations` while `/api/version`
  reports the release carrying it. `ensureSchema` catches, logs to console only, and retries every
  boot — there is no `error_events` row. Check the table, not the logs.
- **Rehearse a data migration through the live dev server, not just the test suite.** Task 3's
  double-count survived tsc, lint, 3,937 tests and review; it took thirty seconds of `curl` against
  `pnpm dev` with the packer rehearsed by hand. Seed a few ring-days, pack half the buckets, and diff
  the API responses across all-hot / both-tiers / hot-deleted.
- **`CLAUDE_DB_QUERY_SECRET` is set in this environment** and `POST /api/admin/db-query` works from
  the sandbox. Note the `claude_ro` search_path: `pg_total_relation_size('oura_raw_samples')` resolves
  to the **view** and returns 0 — join `pg_class` to `pg_stat_user_tables` on `relnamespace =
  'public'::regnamespace` for real sizes. Row-scoped to the owner; phrase findings accordingly.
- **The seed user is not an admin and has no raw samples.** For the BLE admin routes: `UPDATE users
  SET is_admin = true WHERE email='test@local.dev'` (checked against the DB, not the JWT, so the
  existing cookie keeps working), and **revert it after**. `npx playwright test --project=setup` mints
  a real session cookie into `e2e/.auth/seed-user.json`.
- **Exercising an ai_dynamic route locally** means mutating the seed: it is `phase_mode = 'manual'`
  with no `session_periodization` row. Set the mode, insert a periodization row, hit the route, then
  **revert both** — the local DB is shared with the test suite.
- **Five lanes land fast enough that a merge can resurrect a backlog entry you deleted.** `grep` for
  your item's Q number after *every* `git merge origin/main`, not only the first.
- **`scripts/check-doc-index-size.js` conflicts on essentially every parallel merge.** Resolve it the
  way the changelog is: delete the numeric line, re-measure the merged file, write the number back,
  keep both prose blocks. Never splice a hunk. It conflicted three times in this one session.
- **`get_check_runs` returning `total_count: 0` several minutes after opening a PR is a stale base,
  not slow CI** — and it happened twice this session. Fetch, merge, push; checks start immediately.
  Conversely, when the endpoint looks frozen on a PR whose base *is* current, attempting the merge is
  the reliable check: branch protection refuses a genuinely pending required check.
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041` —
  `progression_styles.created_at` missing). Unrelated to any change; ignore them.
