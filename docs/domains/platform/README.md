# Platform — domain index

**Owns:** the infrastructure every pillar depends on — offline sync and the outbox, the local
SQLite store, the client cache, Postgres/Drizzle and migrations, auth and security, AI
infrastructure (chat, tool calls, rate limits), notification transport, the admin surfaces, and CI
and dependency hygiene.

**Test for whether something belongs here:** would the bug exist for every domain equally? A wedged
outbox, a missed cache invalidation, migration drift, an auth hole — those are platform. A wrong
sleep score is not.

## Code

| Area | Where |
|---|---|
| Sync & outbox | `lib/sync/`, `lib/local-store/`, `lib/data/postgres/adapter.ts` (`pushMutations`) |
| Cache | `lib/sqlite/cache.ts`, `lib/cache-groups.ts`, `lib/cache-ttl.ts` |
| Data access | `lib/data/repository.ts`, `lib/data/postgres/` (schema, migrations, client) |
| Auth & security | `auth.ts`, `lib/security/`, `lib/validation/`, `lib/validators/` |
| AI | `lib/ai/`, `lib/ai-chat/` |
| Background & SW | `lib/background/`, `lib/sw/`, `app/sw.js/route.ts` |
| Admin & ops | `lib/admin/`, `app/admin/`, `lib/export/`, `scripts/` |

**[`docs/module-map.md`](../../module-map.md) is this pillar's real index** — §0 (there is **no cron
layer**) through §16. Read it before building any shared helper.

## Reference docs

- [`docs/reviews/2026-08-16-goal-invalidation-audit.md`](../../reviews/2026-08-16-goal-invalidation-audit.md)
  — Q-262: does `invalidateGoalRecommendations()` do anything? **No, for all six keys.** Establishes
  the method for auditing any cache group: an invalidation can only change a *settled* value where a
  call site passes `freshWithinTtl` or a read path is seed-only, because `cachedFetchCore` always
  revalidates otherwise. Q-263 applies it to the remaining groups, which are **not** expected to come
  out the same way.

- [`docs/reviews/2026-08-16-multi-user-load-test.md`](../../reviews/2026-08-16-multi-user-load-test.md)
  — **the multi-user load test, with a committed harness** (`scripts/load-test/`). Nothing breaks at
  10 users or at 100; first failures extrapolate to ~300 concurrent syncs. **A bigger pool does not
  help**, and the whole fan-out is 22.6 ms of query work for 21 connections (Q-308) — read this
  before treating Q-107/Q-213's "pool contention" as settled cause.
- [`docs/reviews/2026-08-15-uncovered-lenses-review.md`](../../reviews/2026-08-15-uncovered-lenses-review.md)
  — web push has no senders and no subscribers (Q-285), stranding the supplement reminder toggle
  (Q-286); the AI surfaces contradict each other and stated a false score (Q-291/292); no
  self-service account deletion and `/api/export` covers 27 of 80 tables (Q-287/288); AI **cost is
  a measured negative result** — do not optimise it (Q-295).
- [`docs/reviews/2026-08-15-comprehensive-app-review.md`](../../reviews/2026-08-15-comprehensive-app-review.md)
  — §3 confirms the 5,771-hit `[pg 21000]` hr-ingest fault stopped when Q-214 landed, and that the
  fix reached **one of three** same-shaped batch upserts (Q-280). §3.2 records `pnpm check:rules`
  at 35 of 35 and sweeps every standing bug class. §4 covers unused indexes (Q-283); §5 the
  accessibility-scanning gap in CI (Q-282).

- **AI Coach (backlog Q-157)** — three ordered plans plus the design rounds behind them. Read the
  protocol plan before touching anything AI-write-related; it records two findings that are easy to
  re-derive wrongly (why the `<sheet_chart>` in-text block pattern must not be extended to input
  widgets, and why the SDK's tool-approval flow cannot carry per-row toggles).
  - [`plans/2026-08-08-ai-coach-widget-protocol.md`](../../superpowers/plans/2026-08-08-ai-coach-widget-protocol.md)
    — client-side tools as widgets, the patch schema, `POST /api/coach/apply` with drift
    re-validation, undo.
  - [`plans/2026-08-08-ai-coach-route-and-thread.md`](../../superpowers/plans/2026-08-08-ai-coach-route-and-thread.md)
    — the `/coach` route, `useChat`, the resolved-widget collapse, persistence, `gemini-3.6-flash`
    + grounding, repointing all four entry points.
  - [`plans/2026-08-08-ai-coach-write-domains.md`](../../superpowers/plans/2026-08-08-ai-coach-write-domains.md)
    — the remaining widgets and write domains, the tier-3 pushed confirm. **Injury is nearly free:
    the deload/swap behaviour already exists downstream and Coach must not reimplement it.**
  - Design: [`docs/design/2026-08-08-ai-coach-mockups.html`](../../design/2026-08-08-ai-coach-mockups.html)
    (capability map + tiers) · [`-conversational-ui.html`](../../design/2026-08-08-ai-coach-conversational-ui.html)
    (widget vocabulary, interaction rules) · [`-round3-widgets.html`](../../design/2026-08-08-ai-coach-round3-widgets.html)
    (paired widgets, the added domains; §4 records every settled decision).
  - **Shipped** across #1191, #1195, #1197, #1199 and the `early_deload` follow-up. Journals:
    [`…-widget-protocol`](../../overview/entries/2026-08-08-ai-coach-widget-protocol.md) ·
    [`…-route-and-thread`](../../overview/entries/2026-08-09-ai-coach-route-and-thread.md) ·
    [`…-write-domains`](../../overview/entries/2026-08-09-ai-coach-write-domains.md) ·
    [`…-tier3-and-widgets`](../../overview/entries/2026-08-09-ai-coach-tier3-and-widgets.md) ·
    [`…-early-deload`](../../overview/entries/2026-08-09-coach-early-deload.md). Six write domains;
    remaining follow-ups (device verification, cardio goals) are **Q-168**.
- **[`docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](../../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md)**
  — 🆕 backlog **Q-49**, the top platform item. How the gitignored models still reach Railway (they
  run server-side, and the loaders fail silently), then the repo cut itself: snapshot, CI, the
  Railway repoint, archive. **Releases the Q-1 + Q-30 gates on Q-31/Q-32.** Read the triage plan
  below first — it decides *what*, this decides *how it ships*.
- [`docs/superpowers/plans/2026-08-02-oura-ip-triage.md`](../../superpowers/plans/2026-08-02-oura-ip-triage.md)
  — what to do about the vendored Oura model constants and weights before any public repo cut:
  seven live imports (not the two Q-31 claims), one dead module deletable today, a
  replace/gitignore/delete verdict per module, and the fresh-repo-vs-history question that blocks
  the gitignore half.
- [`docs/module-map.md`](../../module-map.md) — what exists and where, for all infrastructure.
- [`docs/db-volume-cleanup-handover.md`](../../db-volume-cleanup-handover.md) — the Postgres volume
  investigation (approaching 1 GB for one user); structural fix still pending. **Its recommended
  `bytea` migration is in tension with the Oura on-device program's own D4 decision** (drop the raw
  table after it's pulled to device, vs `bytea` — mutually exclusive per that plan's owner-decision
  table) — see backlog Q-30.
- **[`docs/offline-first-target-architecture.md`](../../offline-first-target-architecture.md)** —
  the owner's offline-first destination (2026-07-30): device-primary compute, Railway holds
  calculated data only. Sequences Phase 3, the Oura on-device program, the DB volume fix and the
  public-repo migration against each other.
- **[`docs/handoff-2026-08-02-platform-offline-architecture-review.md`](../../handoff-2026-08-02-platform-offline-architecture-review.md)**
  — 🆕 open question, not yet resolved: whether Next.js+Capacitor is the right architecture at all
  (prompted by #952 breaking production during the Phase 3 workspace split), vs a from-scratch
  native rewrite. Has a stress-test-me opinion and a ready-to-run research prompt for the next
  session. Read before resuming the Phase 3 workspace-split infra blocker below.
- [`docs/handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md`](../../handoff-2026-07-30-platform-public-repo-migration-gated-on-apk-offline-build.md)
  — the public-repo/Oura-IP audit: what's vendored, what's live vs dormant, why the release is
  gated on Phase 3 + the DB volume fix. Backlog Q-30–Q-32.
- [`docs/data-quality-review-charter.md`](../../data-quality-review-charter.md) — the charter the
  data-quality audits run under.
- [`docs/superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md`](../../superpowers/plans/2026-08-02-owner-bug-batch-sync-anchor-prescription-strap.md)
  — Workstream B: the local SQLite store fails its version upgrade on **every** launch (the v13
  `ADD COLUMN attempts` re-runs forever because the fallback reopen never stamps the version
  forward), WAL has never actually been enabled (the PRAGMA is sent through `execute()`, which
  cannot return rows), and a local-apply failure is reported with the same generic toast as a
  network failure. Backlog Q-37 — **device gate applies**.
- Reviews: [`docs/reviews/2026-08-08-db-scalability-and-tooling-review.md`](../../reviews/2026-08-08-db-scalability-and-tooling-review.md) (**the only review of the database layer** — index coverage, table growth and connection behaviour; the `err.cause` diagnostic gap, the failure distribution that argues against pool contention, and the 12 MB/day volume re-measurement behind Q-30) ·
  [`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](../../reviews/2026-08-02-native-convergence-roadmap-review.md) (roadmap alignment vs the native endpoint — eight findings, backlog Q-46) ·
  [`docs/reviews/2026-08-05-data-analysis-opportunities.md`](../../reviews/2026-08-05-data-analysis-opportunities.md) (what else the recorded data can tell us — and why the shared `correlationInsight` engine behind eight live surfaces cannot tell a real finding from noise, Q-75) ·
  [`docs/reviews/2026-07-27-prod-data-audit.md`](../../reviews/2026-07-27-prod-data-audit.md) ·
  [`docs/reviews/2026-07-16-data-efficiency-review.md`](../../reviews/2026-07-16-data-efficiency-review.md) ·
  [`docs/reviews/2026-07-11-offline-support-review.md`](../../reviews/2026-07-11-offline-support-review.md) ·
  [`docs/reviews/2026-07-06-full-app-overview-review.md`](../../reviews/2026-07-06-full-app-overview-review.md)
- Runbooks: [`docs/runbooks/db-backup-restore.md`](../../runbooks/db-backup-restore.md) ·
  [`docs/runbooks/account-recovery.md`](../../runbooks/account-recovery.md)

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

## Open issues

```bash
grep -n '^### .*\[platform\]' projectOverview.md   # 30 entries today
grep -n '\[platform\]' docs/implementation-backlog.md   # 6 queue items today
```

Live at the time of writing (2026-07-30):

- ⚠️ **Q-155 — the DB suite is largely blind to a loss of user scoping.** Partly mechanised
  2026-08-09: `scripts/check-repository-user-scoping.js` fails any adapter/slice method that takes
  `userId` and never uses it (368 take it, all use it today). That catches an *omitted* scope, not
  a wrong one, not a join that mentions `userId` without constraining, and not a broken pre-check.
  See [`the journal entry`](../../overview/entries/2026-08-09-repository-user-scoping-check.md).

- 🔴 **Postgres volume approaching 1 GB for one user** — handed over, structural fix pending.
- **`/mobile-signin` sits behind the auth gate**, which likely breaks first-run APK sign-in.
- **Deactivating a user has no effect until their JWT is re-minted.**
- ⏰ **Claude read-only prod-DB access is approved for the beta period only** — revisit on beta exit.
- 📊 **Reach for `pg_stat_user_indexes.idx_scan` and `pg_relation_size` before assuming a size problem
  is a row-count problem.** Measured 2026-08-13: the database was 484 MB with **54% of it indexes**,
  and one never-scanned index on `oura_heartrate` was 52 MB against 6.6 MB of actual rows. A REINDEX
  took it to 2.75 MB and the database to 435 MB (Q-219).
- 🧭 **Owner decision 2026-08-13 — device-primary is the direction, and the reason is multi-user.**
  Raw/timeseries is **364 MB** against **1.6 MB** of derived data the app actually renders — a **231×**
  ratio, or ~3.6 GB/year/user versus ~16 MB/year/user. That ratio is what makes the current shape
  single-user-only. Confirms D4 over any in-place compaction; see Q-30 for what it does *not* settle
  (device retention is currently a 14-day cache window, which an archive cannot live inside).
- **Dependabot** is a standing backlog item worked on a threshold (≥5 high/critical, or any
  critical older than a week), not every session.

## History

- **[`docs/handoff-2026-08-13-cross-combined-backlog-handover.md`](../../handoff-2026-08-13-cross-combined-backlog-handover.md)**
  — ⭐ **START HERE for backlog work.** Reconciles the two sessions that ran in parallel on 2026-08-13
  (the queue drain and the production outage) into one queue and one pickup prompt, and corrects two
  places where they disagreed: the outage cause is **event-loop starvation, not pool contention**, and
  "custom rules pass" means **31 run-steps, of which 20 are `scripts/*.js`** — not the 35/4 either
  session reported. Carries the Railway telemetry recipe, the environment traps, and what is still
  waiting on the owner.


- **[`docs/handoff-2026-08-13-platform-queue-drain-owner-decisions.md`](../../handoff-2026-08-13-platform-queue-drain-owner-decisions.md)**
  — a queue drain that ran out of implementer-takeable items, put five decisions to the owner, and
  built four of them (Q-202, Q-185, Q-189, Q-72-partial) plus Q-155's ownership coverage. Read it
  for two standing traps: **"custom rules pass" locally means 4 of 35 checks** (Q-206), and **a Q
  number in an unmerged PR is provisional**. Also records that Q-72's filed premise was wrong on
  two counts, and that its correlation target is unusable as an acceptance measure.

- **[`docs/handoff-2026-08-13-platform-production-event-loop-starvation.md`](../../handoff-2026-08-13-platform-production-event-loop-starvation.md)**
  — 🔴 **live, diagnosed, unfixed.** The follow-up that confirmed the outage below. It is **event-loop
  starvation, and the pool exhaustion is a symptom**: `aggregateOuraRawSamples` decodes a 35-day
  window of `oura_raw_samples` (984,862 rows against ~37 days of history) in main-thread JS on every
  BLE sync, so runs go back-to-back and the single Node main thread stays pegged for 15–30 minutes.
  `pg`'s connect timeout is a JS timer and fires late on a blocked loop, which is why healthy
  connections die while the DB answers in milliseconds. The control that proves it: `/api/version`,
  DB-free and bounded to 5 s, measured **122 seconds**. Chronic for at least a week, so the morning's
  deploys were not the cause, and **the workout-data fan-out hypothesis is refuted**. Carries the
  Railway telemetry recipe — the token is a **project** token (`Project-Access-Token`, not
  `Authorization: Bearer`), and `httpLogs` pages via `anchorDate`/`beforeLimit`. **Resolved and verified
  on a real sync (15–30 min → 2 min); Stage 2 remains and now has measured justification.** Two
  regressions were introduced and fixed inside the session, both caught by watching production rather
  than reading code — see the journal entry for why that distinction matters. Plan:
  [`plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md`](../../superpowers/plans/2026-08-13-oura-ble-rollup-incremental-and-off-loop.md).
  **Stage 2 shipped 2026-08-13** — the rollup now runs in a `worker_threads` realm; see
  [`entries/2026-08-13-rollup-off-the-request-loop.md`](../../overview/entries/2026-08-13-rollup-off-the-request-loop.md)
  for the worker-bundle constraint (`onnxruntime-node` cannot be webpack-bundled, so it needs its own
  esbuild output) and the in-process fallback that keeps a broken bundle harmless.

- **[`docs/handoff-2026-08-13-platform-production-connection-starvation.md`](../../handoff-2026-08-13-platform-production-connection-starvation.md)**
  — the session that found the outage and scoped it. Superseded on cause by the handoff above, but
  its measurements stand and two carry-forwards outlive the incident: **`claude_ro.error_events`
  cannot see an outage of this shape**, because the app must reach the DB to write an error row (13
  rows across 90 minutes of it) — so a quiet `error_events` is not a quiet production; and
  `getLocalStore()` hands out a **live store while the DB is still opening**, which silently
  swallowed a check-in behind a success toast until #1292. Queued as Q-213…Q-217.

- **[`docs/handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md`](../../handoff-2026-08-11-platform-queue-drain-deload-coverage-coach-charts.md)**
  — 🆕 an eight-PR queue drain that **closed the soft-delete burn-down** the mutation-testing session
  below opened (all 35 remaining filters, each verified individually). Three carry-forwards worth
  more than the tests: a mutation's substitute predicate must name a table the query already joins,
  or the "failure" is a SQL error rather than detection; **counting tests calls a two-query function
  covered when it is not** (`getWeeklySetsByMuscleGroup` left two filters alive); and Q-182's own
  deferral of `oura.ts` as "needs a seeded rollup window" was **wrong** — the estimate came from the
  slice's name, and the deferral cost more than the work. Also: two queue entries were stale when
  re-verified (one targeting a route no UI links to, one already shipped and resurrected by a
  stale-base merge), so **re-verify before implementing** is now load-bearing, not advice.

- **[`docs/handoff-2026-08-09-platform-mutation-testing-invariants.md`](../../handoff-2026-08-09-platform-mutation-testing-invariants.md)**
  — 🆕 a review-only session that changed almost no application code and merged 10 PRs of tests, CI
  checks and audits. Its method is the carry-forward: **mutation testing** — break an invariant on
  purpose and count what notices. Ownership scoping: 246 predicates neutralised left **286 of 317
  tests passing**. Soft-delete filtering: 113 filters neutralised left **371 of 372 passing**, with
  every slice but one at zero. Both are *correct* today; nothing held them in place. Four new CI
  checks (numeric bounds, sparkline primitive, local-column upgrade path, WCAG contrast), Q-174 found
  and fixed, and Q-178/Q-179/Q-181 filed. **The lesson worth carrying: seven assertions the session
  wrote could not fail**, each caught only by running the new test under mutation as well as clean —
  and three scanners reported wrong counts, one of them zero. Verify a test by watching it fail, and
  cross-check every scanner against a cruder grep.

- **[`docs/handoff-2026-08-09-platform-single-agent-queue-drain.md`](../../handoff-2026-08-09-platform-single-agent-queue-drain.md)**
  — 🆕 first session with no territory split. Q-150, Q-152, Q-143 and Q-145 fixed; **Q-151 refuted**
  and downgraded to a dated re-check; Q-159 filed. Its theme is worth carrying: **three entries had
  premises that were factually wrong** — Q-151 did not reproduce and its production count belonged
  to other routes entirely, Q-145 was filed "not implementable" from a misread of the repo's own
  local type rather than Next's, and Q-143's title blamed the rollup when the hot caller was the
  ingest path. Verify an entry against `main` before implementing it. Also records why Q-42 needs a
  shape decision before anyone starts it, and that Q-7b/Q-104/Q-114 are device-gated despite an
  earlier handoff listing them as ready.

- **[`docs/overview/entries/2026-08-14-sleep-stale-window-and-pool-contention.md`](../../overview/entries/2026-08-14-sleep-stale-window-and-pool-contention.md)**
  — 🆕 much sharper burst evidence for the standing Q-107 DB-pool-contention fault (two ~20-minute
  bursts hitting 15-20+ unrelated routes at once, a cleaner signature than the 2026-08-08
  measurement), found while diagnosing an unrelated `[sleep]` bug (Q-225) via a full local
  reproduction of `aggregateOuraRawSamples`. Candidate but unconfirmed link between the two.

- **[`docs/handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md`](../../handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md)**
  — 🆕 the Agent-1 half of the 2026-08-07 review dispatch, cleared (Q-122, Q-123a, Q-124, Q-128,
  Q-129, Q-130, Q-131, Q-134), plus Q-139 and Q-149, plus a **production data audit** that found two
  bugs the queue did not know about. Its three carry-forward lessons: a stored sentinel is not a null
  (`IS NOT NULL` let a deliberate `0` render as a lift dropping to zero); a constant is worse than an
  absence (`rest_adequate` was true for all 278 verdicts); and check a derived column's distribution
  before trusting it. Also records why Q-107 has no evidence yet and exactly what to look for.

- **[`docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md`](../../handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md)**
  — 🆕 wrap-up for the 2026-08-07 full-app-review backlog drain (9 PRs merged: Q-108, Q-106, Q-105,
  Q-103, Q-73, Q-117, Q-118, Q-140, plus the review itself). Splits the remaining ~18 ready items
  (Q-119–Q-136) into two parallel-agent pickup prompts by file territory — Agent 1 (platform/sync/
  security: `lib/data/postgres/adapter.ts`, `app/api/workout-data/route.ts`) and Agent 2 (app-shell/
  UI/cache: `lib/cache-groups.ts`, `components/*`) — to minimise cross-agent merge conflicts. Filed
  under `cross` because it spans both pillars; linked here and from `app-shell`.

- **[`docs/handoff-2026-08-04-platform-observability-and-measure-first-drain.md`](../../handoff-2026-08-04-platform-observability-and-measure-first-drain.md)**
  — 🆕 PRs #1062–#1071. **Q-58 complete** (`onRequestError` + the 21 self-handled 500s: 30 of 31
  routes that can return a 500 now report it), **Q-56** (step rollup can no longer date frames into
  the future), **Q-59** (update banner tracks the APK; `package.json` removed from the Android path
  gate, which had been republishing the APK on *every* merge), **Q-54** (prescription + status in
  one write), and a **navigation-timing instrument** in the admin data-capture console. Four queue
  items turned out to be different from how they were filed — read its "Deliberately NOT done" and
  "Gotchas" sections before picking any of Q-27, Q-42, Q-51, Q-71 or Q-72. ⚠️ **Live:** a React
  hydration mismatch on the home screen, 283 occurrences and ongoing (**Q-73**), with two leads
  already disproven. ⚠️ **`GITHUB_RELEASES_TOKEN` is unset in Railway** — the update card cannot
  work and More → Download APK has been failing.


- **[`docs/handoff-2026-08-02-platform-model-assets-to-bucket-and-home-perf.md`](../../handoff-2026-08-02-platform-model-assets-to-bucket-and-home-perf.md)**
  — 🆕 Q-49 A0/A1 and Q-51 Tasks 1–2. The models now live in the app's **existing Railway bucket**
  (`oura-model-onnx/`), read bucket-first with the repo tree as a fallback. ⚠️ **Its "A1 finishes on
  the first deploy's `[oura-models]` logs" step is superseded** — the loaders are lazy, so those
  lines prove nothing by their absence. The gate is now Admin → Tools → Additional tools → **Model
  asset delivery** (`GET /api/admin/model-assets`, v1.252.3), which asks the bucket directly;
  see [`2026-08-03-model-asset-bucket-report.md`](../../overview/entries/2026-08-03-model-asset-bucket-report.md).
  Also records that `constants/` (12 MB) *cannot* move
  because it is statically imported — so the repo cannot go fully public on the `.onnx` move
  alone — and that ~14 kB is close to the home screen's bundle ceiling.

- **[`docs/handoff-2026-08-02-platform-native-roadmap-review-and-public-repo-plan.md`](../../handoff-2026-08-02-platform-native-roadmap-review-and-public-repo-plan.md)**
  — 🆕 why the public-repo cut jumped the queue (the private repo's daily cost), why its real
  blocker is server-side **model delivery** rather than Phase 3, and where the review + plan live.
  Read before taking **Q-49**. Does not change the queue-drain run-list or the device checklist.
- [`docs/handoff-2026-08-02-platform-batch-queue-drain-run-1.md`](../../handoff-2026-08-02-platform-batch-queue-drain-run-1.md)
  — run 1 of the batch queue drain (items 1–7): Q-43/Q-38/Q-39/Q-40 shipped, Q-35 and Q-28 retired
  after measuring them against production, Q-31 re-scoped. Read it before taking run-list items 8+.
- **[`docs/handoff-2026-08-02-platform-batch-queue-drain.md`](../../handoff-2026-08-02-platform-batch-queue-drain.md)**
  — the owner's four unblocking decisions of 2026-08-02 (Phase 3 deferred not cancelled; device
  access available on one consolidated checklist; production read-only SQL verified reachable from
  a session; the `body_hex` bytea migration declined in favour of Q-35) plus the ordered run-list
  they produced. Read this before taking anything off the queue.
- Handoffs: `ls docs/handoff-*-platform-*.md` — plus
  [`docs/handoff-2026-08-02-cross-owner-bug-batch-investigation.md`](../../handoff-2026-08-02-cross-owner-bug-batch-investigation.md)
  (Q-37 — the local SQLite open path failing on every launch), filed under `cross` because it spans five pillars and so is not matched by the glob above.
  Also [`docs/handoff-2026-08-03-cross-owner-bug-batch-triage.md`](../../handoff-2026-08-03-cross-owner-bug-batch-triage.md)
  (Q-67 — the scale's persistent "listening" notification is unwanted noise), same reason.
- Journal: `grep -rl 'sync\|migration\|cache\|auth' docs/overview/entries/`

## Gotchas specific to this domain — the repeat offenders

- **Cache invalidation is the single most repeated bug class in the project** (12+ incidents).
  Writes invalidate through a named group in `lib/cache-groups.ts` — never an ad-hoc key list at the
  call site.
- **One bad mutation must never wedge the outbox** (3 production incidents). A 4xx is a poison
  pill: quarantine it, never `break` the push loop.
- **The web route and the `pushMutations` branch must call the same shared function** — CI enforces
  it (`scripts/check-push-mutations.js`).
- **Local SQLite migrations can partially apply** — `ADD COLUMN` is not idempotent, no PRAGMAs
  inside the upgrade transaction, and every new table/column must join
  `RECONCILE_TABLES`/`RECONCILE_COLUMNS` in the same commit.
- **Seeds don't fix drifted prod rows** — `ON CONFLICT DO NOTHING` only governs fresh databases.
- **Claim migration numbers against both the directory and open PRs** — the tree already carries two
  collided pairs.
- **Never weaken the `pg` Pool config** (error handler + statement timeouts) — both took production
  down in session 165.
- **Security fails closed** — a missing signature header or signing key is a rejection, never a skip.

## Handoffs

- [`handoff-2026-08-16-platform-public-repo-cut-a4b.md`](../../handoff-2026-08-16-platform-public-repo-cut-a4b.md)
  — Q-49 public-repo cut. **Updated at the Phase B boundary:** A4b has shipped, Oura's material is
  out of the tree, and the handoff now carries what A4b cost beyond the plan — the constants were
  still a build-time dependency and `publish-dry-run` has no build gate to see it (Q-306), the
  measured blast radius was 17 files not 16, and the guards had to go finer than per-`describe`.
  Runbook: [`public-repo-cut-runbook.md`](../../public-repo-cut-runbook.md), steps 8–14 remain.
- [`overview/entries/2026-08-16-public-repo-cut-a4b.md`](../../overview/entries/2026-08-16-public-repo-cut-a4b.md)
  — the A4b journal entry.
