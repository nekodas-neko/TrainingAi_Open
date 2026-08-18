# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the first session to run as Lane A · **Q band:** 314–349 (next free: **315** — Q-314 taken for the ring-clock reset-detection defect)
**Migrations:** 189–192 taken; next free is **193**. Local SQLite unchanged at v22.

## Now
**Owner decisions received 2026-08-17** — all four recorded here so they are not re-asked:
1. **Q-314** → *declare a re-key explicitly*. Approved, not yet built.
2. **Q-537** → *reveal + copy, and warn on clearKey*. Approved, not yet built. Device-only verify.
3. **Q-540 vs Q-541** → my call: **take Q-541, skip Q-540's `bytea` half** (the packed blob *is*
   bytea — doing both rewrites 1.1 M rows twice). Q-540's `event_name` half is superseded too, since
   packed rows do not store it.
4. **Q-534** → the 5 GB volume is temporary and must be **deprecated by end of this week**. *All work
   aims at returning to the stock 500 MB.* This is the standing priority.

**Q-541 Tasks 0–2 shipped** (v1.318.11, migrations 191 + 192, `lib/oura-ble/frame-pack.ts`) —
additive only, nothing reads or writes the new table and no row has moved. **Tasks 3–7 are next and
are the actual size win.**

## Next
Queue is re-read as of the end of this session. Q-450/451 have shipped (Lane B); Q-536 and Q-539 are
done and removed.

1. **Q-537** `[devices][platform]` — top of queue and **owner-gated**: credential handling (reveal/
   export the ring key), and its own verification line says nothing about it is checkable from the
   sandbox. Do not build it without sign-off.
2. **Q-314** `[devices][platform]` — **owner-gated on a design call that has been asked and not yet
   answered.** Re-drain-as-reset misdetection; the recommendation put to the owner was to make a
   re-key *explicit* rather than inferred from counter shape. Read its open-question block: there is
   **no observed true reset in the data**, so any threshold is unvalidated against the case it
   exists for, and missing a real re-key fails silently — worse than the current failure.
3. **Q-353** `[platform]` — the health-insight prompt substitutes the literal `"no data"` for an
   absent field at ten sites, and the model reads that as **zero** and editorialises. Lane A,
   `app/api/ai/health-insight/route.ts` only, and the entry names the exact line numbers. This is
   the smallest genuinely-available item — take it first.
4. **Q-535** `[platform][devices]` — the redecode holds the request open through the heaviest pair of
   calls in the app and 502s at the gateway, inviting a retry of a full-table rewrite. Premise
   re-verified this session: `await runRedecodeOffLoop(...)` in the route, and its own comment says
   "the caller still waits". **Split across lanes** — returning a job id is Lane A, the client poller
   is Lane B. Worth agreeing the seam before starting.
5. **Q-540** `[devices][platform]` — **the `event_name` half is takeable now and gives up nothing**
   (20 MB, 30 values fully derivable from `tag`, already pinned by the Kotlin/TS parity test). Take
   the `bytea` half only if Q-541 is not imminent. ⚠️ It is a migration over 1.1 M rows — read the
   `statement_timeout` note under Method notes **before** writing it.
6. **Q-534** `[platform]` — **not the one-step index drop it reads as.** This session established
   the index has two live consumers; order is rewrite both call sites to be ds-keyed, prove
   equivalence, then drop. See its entry.
7. **Q-312** / **Q-263** `[platform]` — the synthetic MET table, and the cache-group audit.

**Q-313** touches `scripts/`, which neither lane lists — claim it here first and check Lane B's baton.

## Blocked
- **Q-536 owes a full-history Redecode after v1.318.0 deploys.** Nothing in the queue depends on
  it, but Health is wrong until it runs. Then re-check the start-hour histogram: the 43 rows at
  10:00–14:00 Brisbane should move into the 20:00–00:00 band.
- **Q-537 needs owner sign-off** before anyone builds it: it is credential handling, and its own
  verification line says nothing about it is checkable from the sandbox.

**Session ended on context, not on completion.** Q-540's `event_name` half was available and
deliberately not started: it is a 1.1 M-row migration, and starting one with little context left is
exactly how this session's three-deploy Q-536 detour began.

One thing **owed** rather than blocked: the device check on Q-310, filed as a Known-Issues row in
`projectOverview.md` rather than left implicit. Server/JS only, so it reached the APK via the
Railway deploy with no rebuild — but the client half was verified from the route's response, not on
hardware. Confirm at the next engine-chosen deload: header "Deload", reduced weights, no PR badge.

## Claimed paths
None held.

## Findings recorded this session, so they are not re-derived
- **Q-534's finding 4 is not a drop-in index drop.** `idx_oura_raw_samples_user_measured` (118 MB)
  has two live consumers — `getLatestOuraBleMeasuredAt` (`slices/oura.ts:173`) and
  `getOuraRawSamplesForTags` (`adapter.ts:6446`) — and both become sequential scans of the largest
  table in the DB without it. The entry's "can be expressed as ds ranges instead" is a plan, not a
  fact: it means converting the window bound through the clock anchors at both sites, one of which
  is a read path. Order is rewrite → prove equivalence → drop, and the entry now says so.
- **Q-535 is the next Lane A item and it is genuinely worth doing**, partly because it is what makes
  the redecode safe to re-run: the route holds the request open through the heaviest pair of calls
  in the app, 502s at the gateway, and the false failure invites a retry of a full-table rewrite.
  Note the split — returning a job id is Lane A, the client poller is Lane B.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md). Read it rather than re-deciding it. Take Q numbers from
  the band above, never from the backlog's next-free pointer.
- **Q-310's fix-direction items 2 and 3 were refuted and deliberately not built.**
  (2) `exercise-summary-screen.tsx`'s `isNewPR` needs no deload gate: `estimateOneRm` returns
  exactly `0` when `deloaded`, and the badge already gates on `newEst1rm > 0`. There is no
  "submaximal-adjusted estimate that still exceeds the bar". (3) No corrective migration:
  `logExerciseFromPayload` reads `session_periodization` independently of the route, so the server
  zeroed the estimate and refused the PR throughout. Both production deload sessions (2026-08-09,
  2026-08-16) carry `max(estimated_1rm) = 0` and no `personal_records` row on either date.
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` saying "still open" until #17. The
  un-prescribed deload branch exists below the `if (aiDrivesLoad)` block; verified in source and on
  the dev server.

## Method notes worth keeping
- **A migration verified on a fixture is not verified.** Q-536's first migration passed a 5-test
  local suite and CI, and still rolled back on every production boot: the fixture was 8 rows, the
  real table 434,707 on 667 MB, and the pool's `statement_timeout` is **15 s**. For any data
  migration, ask what the production row count is *before* writing it, and put `SET LOCAL
  statement_timeout` on anything that is not obviously small. `SET LOCAL` is confirmed to work
  inside `pool.query()`'s implicit multi-statement transaction, in both directions.
- **The tell that a migration silently failed:** it is absent from `schema_migrations` while
  `/api/version` reports the release that carries it. `ensureSchema` catches, logs to console only,
  records nothing, and retries every boot — so there is no `error_events` row to find. Check the
  table, not the logs.
- **`CLAUDE_DB_QUERY_SECRET` is set in this environment** and `POST /api/admin/db-query` works from
  the sandbox. It is the fastest way to answer "did this actually corrupt anything" before writing a
  migration an entry asks for. Row-scoped to the owner — phrase findings as "nothing of the owner's".
- **Exercising an ai_dynamic route locally** means mutating the seed: the seeded program is
  `phase_mode = 'manual'` with no `session_periodization` row. Set `phase_mode='ai_dynamic'`, insert
  a periodization row at the phase you want, hit the route, then **revert both** — the local DB is
  shared with the test suite.
- **`npx playwright test --project=setup` mints a real session cookie** into
  `e2e/.auth/seed-user.json`; extract it and `curl` the API directly. Far faster than driving the UI
  for a route-level check.
- **Five lanes land fast enough that a merge can resurrect a backlog entry you deleted.** #17 hit
  exactly the failure its own file warns about: a parallel PR inserted entries adjacent to the
  Q-310 block, and the three-way merge kept both sides. `grep` for your item's Q number after every
  `git merge origin/main`, not only after the first one.
- **`scripts/check-doc-index-size.js` is a shrink-only ratchet on `projectOverview.md`, the backlog
  and `CLAUDE.md`, and it conflicts on essentially every parallel merge.** Resolve it the way the
  changelog is resolved — take main's numbers as the base and add your own delta on top, never
  splice. A Known-Issues row for a fix that still owes a device check belongs in the index, so
  raising the baseline is correct there; say why in the comment.
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041` —
  `progression_styles.created_at` missing). Unrelated to any change; ignore them.
