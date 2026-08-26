# 2026-08-26 — the app's load time is measured now (BF-19)

**Branch:** `feat/app-load-metrics` · **Lane A** · v1.383.3
**Migrations:** Postgres **229** (table) + **230** (claude_ro views)

## Why

The owner reported the app *"VERY slowly lately… just in case there is a regression that's permanent
I need a second opinion"*, and there was no way to give one. The two existing timing endpoints
(`admin/timing-baseline`, `admin/time-audit`) measure **workout** duration. Nothing anywhere recorded
navigation timing, so the report could be neither confirmed nor refuted from data.

Everything server-side had already been ruled out by measurement — `SELECT 1` at 3 ms inside a
~460 ms round trip, 99.90% buffer-cache hit, zero `idle in transaction`, no migration replay on cold
start. The number that matters is on the device, and nothing was collecting it.

## What shipped

- **`lib/app-load-metrics.ts`** — `startAppLoadReporting(buildId)`, the single call a UI file makes.
- **`POST /api/app-load`** — Zod-validated, rate-limited ingest.
- **`GET /api/admin/app-load-report`** — p50/p95/worst per route, split cold vs warm.
- **`app_load_metrics`** — its own table, pruned at **14 days** on write.

## Three decisions that are the design

**1. The cold/warm split is the report, not a facet of it.** Merged PRs ran 13 / 80 / 7 across three
days, and every merge is a Railway deploy that rewrites the service worker's cache name (`ta-<sha>`),
invalidating the device's whole offline shell. On that cadence a warm load is rare, and a p95 pooling
both measures **release cadence rather than the app** — which is worse than no number, because it
looks like an answer. A test asserts the pooled p50 would land between the two and describe neither.

**2. Telemetry never touches the outbox.** Every other client write in this app queues a mutation so
it survives offline — the standing offline-first rule, and right for user data. This is not user
data: queueing it would put navigation rows ahead of the user's food logs on the next push. A dropped
measurement is strictly better than a delayed workout, so it reports online-only via `sendBeacon` and
silently drops otherwise.

**3. `buildId` is baked into the client bundle, not stamped on ingest.** The server knows
`RAILWAY_GIT_COMMIT_SHA` and stamping there would have been simpler — and subtly wrong. A device
holding a **stale shell from an earlier deploy is exactly the case this feature exists to measure**,
and server-stamping would label such a load with the deploy that is live *now*, attributing the
slowness to the wrong release. `next.config.ts` bakes it in at build time instead.

## Reported once per JS context, not per route change

`getEntriesByType('navigation')` describes the **document** load; a client-side route change does not
create a new one. A reporter firing on every route settle would post the same numbers repeatedly
under whichever route happened to be current — worse than not reporting, because it would look like
data. The guard is module state, and deliberately **not consumed by a premature read**: a React
effect runs well before `loadEventEnd` on a cold start, so `startAppLoadReporting` waits for `load`
when the document is still loading. Both halves have their own test.

## The lane line, and where it fell

BF-19 says *"Lane: A — a new `app/api/admin/` route plus a client reporter"*, but the **mount** is in
`components/error-reporter.tsx`, which is Lane B's path. Rather than reach into that file with logic,
all of it lives in `lib/app-load-metrics.ts` and Lane B's share is **one call plus its cleanup** —
added to the app's existing global client-telemetry mount rather than as a second component. Declared
rather than made quietly.

## Unblocks BF-22

BF-22 (*"the slow loads clear on a force restart, so they are in-memory client state"*) carries
`Needs: BF-19` and says outright that this reporter is what produces the device measurement it
cannot get for itself. Removing BF-19 from the queue clears that dependency.

## Verification

- **21** pure-logic cases for the reporter, **7** DB-backed for the report.
- **Mutation-tested with applied-proof:** pooling cold and warm in the aggregate fails 6 of 7;
  dropping the `user_id` scope, the once-per-context guard, or the cold/warm detection each fail
  their own test. Every mutation asserted its anchor first — **one of them didn't, and that is worth
  recording**: a shell-quoting error meant the fourth mutation never applied while the run still
  reported 16 passing, which is exactly the "a `sed` whose anchor drifted mutates nothing and reports
  a pass" trap. Redone with the anchor asserted in Python.
- Full suite, `pnpm check:rules` **Ran 59 of 59**, `tsc --noEmit`, lint.
- `check-export-coverage.js` caught the new table as unclassified — it is `ops`/excluded, with the
  reason recorded beside `error_events` and `ai_call_log`.

## Not exercised

**The device, which is the only surface where these numbers mean anything.** Web timings do not
represent the APK: the WebView's cache behaviour, the service worker's role in a cold start, and the
device's own CPU are all different. Nothing here has run on the S25, so the table will be empty until
it does — that is the next step, not a defect. Also not exercised: the prune (it fires at most once
per 24 h on a write), and a real deploy's `RAILWAY_GIT_COMMIT_SHA` (absent locally by design).
