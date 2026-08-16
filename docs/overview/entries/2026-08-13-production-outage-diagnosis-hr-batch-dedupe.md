# 2026-08-13 — the production stalls diagnosed, and the chest-strap batch bug fixed (v1.302.2)

**Branch:** `claude/trainingai-production-outage-lfbgq7`

## What this session was for

An undiagnosed intermittent production outage. The pickup brief pointed at a prior handoff and
backlog entries Q-213…Q-216 — **none of which exist**, in the tree, on `origin/main`, on any remote
branch, or in an open PR. That session's evidence was never committed, so it was lost with the
container. Everything here was re-derived from live Railway telemetry.

That is the second investigation this project has lost to an uncommitted handoff. The findings below
were committed before anything else was attempted.

## The diagnosis (confirmed, not shipped)

The instability is **event-loop starvation**, not DB connection contention. `aggregateOuraRawSamples`
decodes a 35-day window of `oura_raw_samples` in main-thread JS on every BLE sync; the table holds
**984,862 rows** against ~37 days of ring history, so that "incremental" window covers effectively the
whole table, and one run outlasts the gap between syncs. Runs go back-to-back and the single Node main
thread stays pegged for 15–30 minutes.

The control that settles it: **`/api/version` — no DB, outbound call bounded to 5 s, cached for
300 s — measured 122,044 ms** during the window and 5 ms now. CPU sat at a sustained 1.0–1.6 of an
8-core limit against an idle 0.001, with memory at 0.9–2.1 GB against an idle 0.38 GB.

Three things worth carrying forward:

- **The connection errors are a symptom.** `pg`'s connect timeout is a JS `setTimeout`; on a blocked
  loop it fires late and kills healthy connections, which is exactly why the logs read `Connection
  terminated due to connection timeout` while the database answered in milliseconds.
- **It is chronic, and the morning's three PRs did not cause it.** Seven days of CPU history show
  1–3.5 hours a day of a pegged core, with *higher* peaks on 08-06…08-11 than on 08-13. The deploys
  are why it was noticed. The earlier framing invited a rollback that would have changed nothing.
- **The workout-data fan-out hypothesis is refuted.** A fan-out of DB queries shows CPU near zero and
  cannot make a DB-free route take two minutes. Both predictions fail.

Filed as **Q-213** with a plan
([`docs/superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md`](../../superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md)),
evidence in
[`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](../../handoff-2026-08-13-platform-production-event-loop-starvation.md).
Owner chose the correct-and-future-proof route over the cheap one, so the plan is incremental-recompute
first, then moving the rollup off the request loop, then fixing the coalescing predicate — not a
throttle-and-move-on. **No rollup code changed this session**; a 1,084-line function with subtle
window semantics is not something to rewrite in the same session it was diagnosed.

## What shipped: Q-214

`upsertOuraHeartrate` inserted in chunks of 5,000 with `onConflictDoUpdate` on
`(user_id, timestamp)` and **never deduped within the batch**. Postgres rejects a whole command whose
VALUES list hits the same conflict row twice, so one duplicated timestamp discarded **the entire
chunk** — up to 5,000 points, not just the duplicate. Production showed eight consecutive 1 Hz
retries, each failing identically; those samples are gone permanently.

The fix collapses repeats on the conflict target before the insert, last value wins, matching the
`ON CONFLICT` arm's `excluded.*` semantics. It went in `upsertOuraHeartrate` rather than the
`hr-ingest` route so every caller inherits it.

**The BLE rollup already did exactly this** (`hrByTimestamp`, `adapter.ts`), with a comment naming the
same Postgres error — so the failure mode was understood in one caller and never propagated to the
sibling. That is the sibling-surface rule catching a case where the first surface was fixed years of
commits ago and the second was never swept.

Verified by mutation: reverting the dedupe fails all three new tests with
`ON CONFLICT DO UPDATE command cannot affect row a second time`, the exact production error. Full
`lib/data/postgres/__tests__/` suite green afterwards — 84 files, 508 tests. `tsc --noEmit` clean;
lint clean apart from two pre-existing warnings on an unrelated line.

⚠️ **Not device-verified** — the chest-strap path runs through the Capacitor BLE plugin, which does
not run in the sandbox. The server-side write path is what was exercised.

## Also recorded, not fixed

- **Q-215** — `TOKEN_ENC_KEY` is unset in production; every container start logs
  `token writes will fail closed` at `error` severity. Needs an owner call on whether the variable is
  missing or the message overstates it.
- The Oura Cloud PAT returns 401 on `ring_configuration` and the `[post-completion-hr]` sync. Expected
  after the BLE re-key per `CLAUDE.md`, but the app still calls the API on a completion path and logs
  an error every time.
- `claude_ro.error_events` cannot see any of this — the app must reach the DB to write an error row,
  and during these windows it cannot. A quiet `error_events` is not a quiet production.

## Traps found

- **`RAILWAY_API_TOKEN` is a project token, not a personal one.** `Authorization: Bearer` returns
  `Not Authorized` on every query, which reads like a bad token and is not. Use
  `Project-Access-Token: $RAILWAY_API_TOKEN` against `https://backboard.railway.com/graphql/v2`.
- **Railway `httpLogs` is the single most useful view here** — it carries `upstreamRqDuration`
  per request, which is what made `/api/version` usable as a control. It pages via
  `anchorDate`/`beforeLimit`/`afterLimit`, not `startDate`/`limit`, unlike `deploymentLogs`.
- `pg_stat_user_tables.n_live_tup` gave the 984,862 row count in 32 ms, with no analytical query
  against the ~1M-row user-scoped `claude_ro.oura_raw_samples` view.
