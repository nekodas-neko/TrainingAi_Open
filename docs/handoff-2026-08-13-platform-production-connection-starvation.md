# Handoff — 2026-08-13 · Production connection starvation, and a check-in lost to the local-store init window

_Domain: `platform` (also touches `readiness`, `app-shell`) · Branch: `fix/local-store-init-silent-write-loss` · PR: [#1292](https://github.com/nekodas-neko/TrainingAI/pull/1292), open, CI running_

> **⚠️ SUPERSEDED ON CAUSE.** Its leading hypothesis — connection-pool contention from a
> `/api/workout-data` fan-out — is **refuted**. The confirmed cause is event-loop starvation from
> the BLE rollup; see
> [`…-event-loop-starvation.md`](handoff-2026-08-13-platform-production-event-loop-starvation.md),
> or [`…-cross-combined-backlog-handover.md`](handoff-2026-08-13-cross-combined-backlog-handover.md)
> to pick up work. **Its measurements stand** and two carry-forwards outlive the incident.

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md`. This file covers only
> what *this* session did and what it leaves behind.
>
> **Companion handoff:** the same session's nutrition work — the Meal Plan build-out from Phase 1
> to one-tap logging, and the two items it leaves — is
> [`docs/handoff-2026-08-13-nutrition-meal-plan-build-out.md`](handoff-2026-08-13-nutrition-meal-plan-build-out.md).
> Read that one if you are picking up the feature work rather than the outage.

## Goal

The owner reported, on the S25, while using the app first thing in the morning: saving "not
working", then a readiness check-in that took ~2 minutes, then everything network-bound crawling,
then Railway errors. Two separate problems turned out to be tangled together — one client-side and
fixed here, one server-side and **still live and unresolved**.

## Current status

- **Production is degraded and intermittently down.** This is the live problem. `/api/version` —
  a route that touches nothing — measured 0.47 s healthy, then 3–14 s, then seven minutes of
  total non-response (23:31–23:38 UTC), then 5–11 s again. It recovers on its own and re-degrades.
- Build/test for PR #1292: `pnpm dev` exercised `POST`/`GET /api/day-checkin?phase=morning`
  (201/200) and `POST`/`GET /api/mood` (200) against the local DB; `/`, `/workout-select`,
  `/health` render 200 with a clean dev log. `tsc --noEmit` clean, lint clean, all
  `scripts/check-*.js` pass, `lib/sqlite` + `lib/local-store` 146 tests pass.
- **Device-verified: no.** Native SQLite does not run in the sandbox, so the init window PR #1292
  fixes cannot be reproduced here. Nothing in this session was verified on the phone.

## The live problem — production connection starvation

**It is our app, not Railway.** The evidence points one way:

| Measurement | Value |
|---|---|
| DB time for an admin query | **353 ms** |
| End-to-end time for that same request | **14 s** |
| `pg_stat_database.numbackends` | **10** — exactly our pool's `max: 10` |
| `/api/version` (no DB access at all) | 5–11 s, or no response |
| Railway edge | Accepts every connection; the origin does not answer |

Postgres is healthy and nowhere near a limit. Our pool is at its own ceiling, every request queues
behind `connectionTimeoutMillis: 5_000`, and the failures cascade. The owner's Railway log shows
exactly that: `[rate-limit] shared store unavailable, memory-only: …timeout exceeded when trying to
connect`, followed by a `programs` select failing the same way.

`claude_ro.error_events` **cannot see this** — the app must reach the DB to write an error row, and
that is the thing failing. Only 13 rows in the 90 minutes covering the worst of it. Do not read a
quiet `error_events` as a quiet production.

### Leading hypothesis (NOT confirmed — do not treat as diagnosed)

A single `GET /api/workout-data` issues **9 queries in one `Promise.all`**
(`app/api/workout-data/route.ts:149`), each taking its own connection from a pool of `max: 10`.
One request can hold nearly the whole pool. #1287 added the 9th (`getLastRealOneRmBatch`) and
merged at **08:50 Brisbane**, the hour the degradation started. The single-session path lower in
the same file has the same shape.

This is a real fragility whatever else is true, but it is **not proven to be the cause**. Two
things argue against it being the whole story:

- The queries themselves are fast; a pool at `max` with fast queries queues, it does not wedge.
- `/api/version` touches no DB at all and still times out, which points at the Node event loop
  being starved rather than at connection contention alone.

Chronic background load worth weighing: `oura_raw_samples` holds **984,216 rows** with continuous
BLE ingest; `POST /api/hr-ingest` logged **2,472** `[pg 21000]` cardinality violations (an
`ON CONFLICT DO UPDATE` batch containing duplicate keys); `POST /api/oura-ble/samples` shows
recurring `aborted` and one `[pg 57014]` statement-timeout kill. Days of
`timeout exceeded when trying to connect` across a dozen unrelated routes predate today.

### Why the next session needs Railway logs

Everything above is measured **from outside**. What is missing is what the process is actually
doing while it holds those ten connections. The owner has added a Railway API token to the
environment — **it needs a fresh session to become visible**, which is the reason this handoff
exists. Read the deploy logs before writing any fix; do not ship the fan-out change on the strength
of the hypothesis alone.

## What shipped

| Change | Where |
|---|---|
| `runSQL` waits for an in-flight `initSQLite` instead of no-opping, and **throws** on the canonical runtime if the DB never opened | `lib/sqlite/sqlite-service.ts` (`awaitOpen`, `unavailable`) |
| Reads stay soft (`querySQL` still returns `[]`) — an empty result degrades a screen to its API fallback where a throw would blank it | `lib/sqlite/sqlite-service.ts` |
| Cache writes stay soft for the same reason; the localStorage mirror already holds the seed | `lib/sqlite/cache.ts` (`setCached`, `clearAllCache`) |
| Morning check-in gained the API fallback it never had | `components/morning-checkin-sheet.tsx` |
| Both check-in sheets stop blocking their close on the local write; invalidation still runs before `onSaved`, now behind the write rather than the tap | `components/mood-checkin-sheet.tsx`, `components/morning-checkin-sheet.tsx` |
| Regression test for the init window | `lib/sqlite/__tests__/init-race.test.ts` |

Version bumped to **1.302.1** with a changelog entry. No migration.

### The bug, precisely

`getLocalStore()` screens out the **dead** store (K4) but not the **not-open-yet** one. `_db` is
null for the whole of `initSQLite` — `addUpgradeStatement`, `open()` running the versioned upgrade,
the WAL pragma, then a full `reconcileSchema()` pass with a `PRAGMA table_info` per reconciled
column. On the first launch after a release that adds a local migration (v25 shipped in #1282) that
is seconds, and `initSQLite` is awaited in a `useEffect`, so the sheets are interactive throughout.

A Save landing in that window hit `if (!_db) return` in `runSQL`: nothing written, nothing queued
to the outbox, `savedLocally = true`, success toast. **Production has no `day_checkins` row for
2026-08-13** and no client error to explain it. That is the silent loss.

The ~2 minutes of "Saving…" is a *different* failure: the Capacitor plugin has one SQLite
connection, so a tap landing while the sync pull's `applyDelta` transaction runs queues behind the
whole delta. Awaiting the local write before closing the sheet is what turned that queue wait into
a stuck button. The owner confirmed a force-close and reopen cleared it, which is what a
startup-window problem looks like.

## Deliberately NOT done

- **The sync pull holding the single SQLite connection long enough for a tap to queue behind it.**
  PR #1292 stops it being *visible*; it does not stop it happening. Filed as a backlog entry.
- **The `workout-data` pool fan-out.** Deliberately not changed — see above; it should be confirmed
  against real logs first. Filed as a backlog entry.
- **The `hr-ingest` cardinality violations** (2,472 failures). Found, not investigated. Filed.
- **A sibling sweep of every `getLocalStore` write site** for a missing API fallback. 34 files
  reference it; only the two check-in sheets were audited. The `runSQL` throw already converts
  silent loss into visible failure everywhere, so the remaining sites fail loudly rather than
  silently, but they do not all fall back. Filed.

## Key decisions (with rationale)

- **Writes throw, reads stay soft.** A write that reaches nothing is data loss and the caller must
  learn about it. A read that returns nothing degrades the screen to its API fallback; throwing
  there would blank screens that currently work.
- **Cache writes stay soft.** `lib/sqlite/cache.ts` is a cache, not the source of truth, and
  `setCached` already writes the localStorage mirror first. `invalidateCache` already swallowed
  this exact error with a comment naming "DB not open" — the change makes its siblings consistent.
- **The sheets close on the tap rather than on the write.** CLAUDE.md's "saves feel instant" rule
  already mandates feedback-first, and the web branch already worked this way. The comment claiming
  "the local-store write above is already fast" was true only while nothing else held the DB.
- **PR #1292 was not merged.** Merging auto-deploys to Railway, and adding a container swap to an
  unstable production service is the wrong move. The fix is correct and CI-gated; it is waiting on
  production being stable, not on doubt about the change.

## Gotchas / what did NOT work

- **`get_check_runs` returning `total_count: 0`** forty minutes after opening #1292 was a stale
  base, not slow CI — exactly as CLAUDE.md warns. `main` had moved to **1.302.0** (#1293, #1294,
  and the chat-screen removal). Fixed by merging `origin/main`; `package.json` and `changelog.ts`
  were rebuilt from `origin/main` and re-bumped rather than spliced.
- **`npx tsc --noEmit` reports errors for `app/api/ai-chat/*` and `app/chat/page`** after that
  merge. They are stale `.next/types` artifacts for routes `main` deleted, left behind by the local
  dev server. Not real; CI builds fresh. Delete `.next` if they get in the way.
- **Heavy analytical queries against `claude_ro.oura_raw_samples` hang** — it is ~1 M rows behind a
  user-scoped view, and a `date_trunc` group-by over it timed out repeatedly against an already
  struggling app. Avoid that table while production is degraded; `pg_stat_user_tables.n_live_tup`
  gives row counts for free.
- **`/api/admin/db-query` returned `Forbidden` once** mid-outage and worked immediately after with
  the same secret. Treat a single `Forbidden` during instability as transient, not as a credential
  problem.
- **The first attempt at `init-race.test.ts` hung**: `releaseOpen` was assigned inside the promise
  executor, which had not run yet when the test called it. Create the deferred up front.

## Files to look at

- `lib/sqlite/sqlite-service.ts` — `awaitOpen`, `runSQL`, `querySQL`; the init window lives here.
- `lib/local-store/index.ts:174` — `getLocalStore`, and the K4 comment that covers only the dead store.
- `app/api/workout-data/route.ts:149` and the second `Promise.all` lower in the same file — the 9-query fan-out.
- `lib/data/postgres/client.ts` — pool config. `max: 10`, `connectionTimeoutMillis: 5_000`,
  `statement_timeout: 15_000`. The error handler and both timeouts are load-bearing (CLAUDE.md).
- `components/sync-provider.tsx:96` — the only `initSQLite` caller, awaited in a `useEffect`.

## Open questions / blockers

- **Blocked on the Railway token being visible** — added to the environment, needs a fresh session.
- **Open for the owner:** is the phone's Oura BLE foreground service running continuously? Pausing
  it for ten minutes is a clean A/B test of whether ingest load is what starves the pool, and it
  costs nothing to try.
- **Q-201** (unrelated, carried from the nutrition work): plan meal times schedule no notification.
  Three-way fork awaiting an owner decision — (a) plan times replace the meal-type reminder time,
  (b) a second "time to eat" stream, (c) leave them as labels. Do not implement without it.

## Pickup prompt

```
Production for TrainingAI is intermittently down and the cause is not yet diagnosed. Pick this up.

Read, in order:
  1. projectOverview.md — status and the live Known Issues table
  2. docs/domains/platform/README.md
  3. docs/handoff-2026-08-13-platform-production-connection-starvation.md — the full evidence
  4. docs/implementation-backlog.md — Q-213, Q-214, Q-215, Q-216 were filed by that session

First action: confirm RAILWAY_API_TOKEN is present in the environment, then read the deploy
logs for the `production` service (Railway GraphQL at https://backboard.railway.com/graphql/v2;
the sandbox allows HTTPS). You are looking for what the Node process is doing while it holds all
ten of its Postgres connections — the handoff establishes from outside that the DB answers in
milliseconds while the app takes 14 seconds, and that /api/version, which touches no DB, also
times out. That points at the event loop, not at connection contention alone. Do not ship the
workout-data fan-out change (Q-213) on the hypothesis alone; confirm against the logs first.

Constraints that will otherwise be re-discovered:
- claude_ro.error_events cannot see this outage — the app must reach the DB to write an error
  row. A quiet error_events is not a quiet production.
- Do not run analytical queries against claude_ro.oura_raw_samples; it is ~1M rows behind a
  user-scoped view and those queries hang while the app is degraded.
- PR #1292 (check-in save fixes, v1.302.1) is open and CI-gated but deliberately unmerged:
  merging auto-deploys to Railway and a container swap during instability is the wrong move.
  Merge it once production is stable. It is NOT device-verified — native SQLite does not run in
  the sandbox, so the on-device check is a force-stop, reopen, and tap Save on the readiness
  sheet within a second or two of the app appearing.
- The owner uses this app daily on a Samsung S25 Ultra. Three PRs merged between 08:10 and 08:50
  Brisbane while they were using it, which is how the degradation window and the local-store
  schema upgrade landed on top of each other. Prefer batching deploys away from their morning.
```
