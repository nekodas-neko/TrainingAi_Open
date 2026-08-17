# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the first session to run as Lane A · **Q band:** 314–349 (next free: **315** — Q-314 taken for the ring-clock reset-detection defect)
**Migrations:** 189 and 190 taken (Q-536); next free is **191**. Local SQLite unchanged at v22.

## Now
Nothing in flight. **Q-536 diagnosed and half-repaired** (v1.318.0, migration 189). The 43 midday bedtimes are a
spurious clock epoch, not a timezone bug: a 2026-08-17 re-pair made the ring re-drain buffered
history, `isClockEpochReset` read that as a reset, and the new epoch's offset — estimated at the p10
of anchor lag, which a re-drain contaminates — landed **+14.16 h** wrong. `aggregateOuraRawSamples`
resolves every ds against `currentEpoch`, so the full redecode re-timed all history.
[`entries/2026-08-17-q536-clock-epoch-diagnosis.md`](../../overview/entries/2026-08-17-q536-clock-epoch-diagnosis.md).

The owner approved the repair. **Migration 189 shipped** — it merges same-clock epochs, deciding
what to merge from measured evidence (two epochs are one clock when their *minimum* anchor lag
agrees within 10 min) rather than from a user id or an epoch number, so a genuine re-key is left
alone. Mutation-checked both ways.

⚠️ **STILL OWED: a full-history Redecode after deploy.** The migration relabels; it does not rewrite
the 43 stored nights, and the rollup's 35-day window does not reach the oldest of them (the damage
spans 44 days). **Health shows the wrong bedtimes until that is run** — it is the step that fixes
what the owner actually sees, and it has not been done. Q-535 notes Redecode reports a spurious
"failed: 502" for work that succeeded, so do not take that as failure.

Before that: **Q-310 shipped and merged** — #17, v1.317.5.

## Next
Work the queue top-down, taking the highest item in Lane A's ownership. As of this writing:

0. **Q-537** `[devices][platform]` is above Q-536 and is **not** takeable as-is: it is credential
   handling (reveal/export the ring key) and its own verification line says nothing is checkable
   from the sandbox. Needs owner sign-off before anyone builds it.
1. **Q-314** `[devices][platform]` — filed this session, the root cause behind Q-536. Reset
   detection treats a re-drain as a re-key. **Read its open-design-question block first**: there is
   no observed true reset in the data, so any threshold is unvalidated against the case it exists
   for, and missing a real re-key is worse and quieter than the current failure.
2. **Q-450** `[activity][cardio]` and **Q-451** `[workouts][app-shell]`: both root-cause into
   `components/` (`done-activity-screen.tsx`, the Workout empty state) — **Lane B's**, skip them.
3. **Q-452** `[app-shell][platform]` — the AI insight card runs an LLM over literal "no data" strings.
   Read it before claiming: the fix may sit in the route (Lane A) or the card (Lane B), and the
   entry does not settle which.
4. **Q-313** `[platform]` — a `next build` gate for `scripts/publish-dry-run.js`. `scripts/` is in
   neither lane's list, so **claim it in this file before touching it** and check Lane B's baton.
   Heed the entry's own note: a build is minutes, so gate it behind `--all`.
5. **Q-312** `[platform]` — the synthetic MET table is physiologically impossible, ~9 tests in CI.
6. **Q-263** `[platform]` — audit the remaining cache groups the way Q-262 audited one
   (`lib/cache-groups.ts`). Lane A.

## Blocked
- **Q-536 owes a full-history Redecode after v1.318.0 deploys.** Nothing in the queue depends on
  it, but Health is wrong until it runs. Then re-check the start-hour histogram: the 43 rows at
  10:00–14:00 Brisbane should move into the 20:00–00:00 band.
- **Q-537 needs owner sign-off** before anyone builds it: it is credential handling, and its own
  verification line says nothing about it is checkable from the sandbox.

One thing **owed** rather than blocked: the device check on Q-310, filed as a Known-Issues row in
`projectOverview.md` rather than left implicit. Server/JS only, so it reached the APK via the
Railway deploy with no rebuild — but the client half was verified from the route's response, not on
hardware. Confirm at the next engine-chosen deload: header "Deload", reduced weights, no PR badge.

## Claimed paths
None held.

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
