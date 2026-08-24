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
| User preferences (server-authoritative) | `packages/shared/src/user/preferences.ts`, `app/api/user/preferences/route.ts`, `users.preferences` JSONB (mig 206) |

**[`docs/module-map.md`](../../module-map.md) is this pillar's real index** — §0 (there is **no cron
layer**) through §16. Read it before building any shared helper.

## Reference docs

- [`docs/handoff-2026-08-18-platform-database-reclaim.md`](../../handoff-2026-08-18-platform-database-reclaim.md)
  — **the database reclaim, 2026-08-18.** 819 MB against a 500 MB target with an end-of-week deadline.
  Everything is built and merged — migration 193's index drop (136 MB, needs no press), the Q-541
  frame packer (~630 MB) and a `VACUUM FULL` route for `error_events` (49 MB) — but **the last two
  have never run against production**, because a sandbox session cannot authenticate there. Carries
  the paste-ready runbook, the three ways to unblock it, and what protects the run.

- [`docs/overview/entries/2026-08-19-sandbox-energy-constants.md`](../../overview/entries/2026-08-19-sandbox-energy-constants.md)
  — **`pnpm dev` could not render the energy screens at all, and CI could not tell you (Q-361).**
  `/api/nutrition/energy-balance` and `/api/body-metadata` answered **500 in every session** because
  the gitignored model constants are never on disk here; the boot delivery now falls back to the
  committed synthetic fixtures outside production. Records why each CI job missed it (build reads on
  first use, vitest already points at the fixtures, no E2E spec visits either screen) — and the
  caveat to carry forward: **the energy numbers a sandbox now shows are arbitrary**, so they verify
  plumbing and never a value.

- [`docs/handoff-2026-08-17-cross-comprehensive-review-six-rounds.md`](../../handoff-2026-08-17-cross-comprehensive-review-six-rounds.md)
  — the six-round comprehensive review (Q-271 … Q-308), its five findings that died on verification,
  the Q-number collision and the conflict-markers-on-`main` incident. **Also records that PR #1401 did
  not make the public-repo migration** and how to port it.
- [`docs/reviews/2026-08-18-cross-user-isolation.md`](../../reviews/2026-08-18-cross-user-isolation.md) — **cross-user isolation, driven with two real accounts, 2026-08-18** (**10 of 11 probes rejected by the route's own ownership check**, including logging a set into another user's session and completing their workout; **the enumeration control passed** — a nonexistent id and another user's id return byte-identical responses. Q-556 — `DELETE /api/activity-logs` returns `200 {"success":true}` for a row it did not delete; **verified not a leak**, the row is intact, but it is inconsistent with every sibling and a false 2xx confirms an outbox mutation away). **The first run reported eleven clean results and proved almost nothing** — six hit routes that do not exist, and an HTML 404 reads exactly like an access-control pass.
- [`docs/reviews/2026-08-18-offline-read-surfaces.md`](../../reviews/2026-08-18-offline-read-surfaces.md) — **offline read surfaces, driven for real, 2026-08-18** (**both paths work** once the SW controls the page: a reload serves the precached offline document, and an offline tab tap paints **2515 chars vs 2486 online, ~101%**. Q-555 — in the **uncontrolled** state, which is the first-ever load, the same tap is a **silent no-op**: no navigation, no offline page, no feedback). **Web only** — `cachedFetch` falls back to `localStorage` there, so the seed path was verified, not the native SQLite store.
- [`docs/reviews/2026-08-18-module-map-symbol-claims.md`](../../reviews/2026-08-18-module-map-symbol-claims.md) — **do the module map's `path → symbol` claims hold? 2026-08-18** (**yes — 110 of 110**, every claim names a symbol that exists in the file it is attributed to). Bounds the Q-554 worry: the never-built row was one row, not a pattern. Now ratcheted by `scripts/check-module-map-symbols.js`, step 43 of 43. **A correction worth keeping:** the first probe implied 38 broken paths, contradicting a check shipped an hour earlier — the probe was wrong (it omitted the `lib/…` → shared-package remap), and *a measurement that contradicts a green check is a bug in the measurement until proven otherwise*.
- [`docs/reviews/2026-08-18-orientation-index-paths.md`](../../reviews/2026-08-18-orientation-index-paths.md) — **the orientation indexes named paths that do not exist, 2026-08-18** (Q-554 — `module-map.md:232` carried a row for `lib/oura-ble/steps-motion-decoder.ts` → `decodeStepsPacket`, **neither of which has ever existed**; the real port is the row below and is itself flagged "NOT yet wired", so the map presented planned work as existing infrastructure. Plus three stale domain rows — `app/history/`, `docs/oura-models/`, `app/overview/` — and 49 malformed history display labels (a stray `../` made them resolve to a non-existent root `overview/`).) Now enforced by `scripts/check-index-doc-paths.js`, step 42 of 42, over **748 paths**.
- [`docs/reviews/2026-08-18-known-issue-duplication.md`](../../reviews/2026-08-18-known-issue-duplication.md) — **a Known Issue in two lists at once, 2026-08-18** (Q-553 — **Q-139 read `🔴 OPEN` in `projectOverview.md` and `✅ fixed` in the resolved archive for ten days**, 69 lines describing a bug fixed 2026-08-08; **Q-81** was a byte-identical 31-line entry in both. Both were also **archived early** — the rule forbids moving while a device check is owed, and both name one. Fixed here, and now enforced by `scripts/check-known-issue-duplication.js`, step 41 of 41.)
- [`docs/reviews/2026-08-18-card-429-reproduction.md`](../../reviews/2026-08-18-card-429-reproduction.md) — **Q-499 reproduced in a browser, 2026-08-18** (`/api/weights-summary` forced to 429 by route interception at the S25 viewport: **`Estimated 1RM` went 1 node → 0, no error wording anywhere**; **control holds** — blocking a different endpoint left it at 1). **The vanish is invisible on a warm cache and visible on a cold one**, so it reads as intermittent. Also **Q-552** — the Q-number block ledger omitted 544–551, so the README's own *"next block of 50 above 529"* instruction would have collided with fourteen live numbers; claimed 552–601 and added the missing grep-before-claiming step.
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
    [`…-widget-protocol`](../../overview/history-2026-08-07.md) ·
    [`…-route-and-thread`](../../overview/history-2026-08-08.md) ·
    [`…-write-domains`](../../overview/history-2026-08-08.md) ·
    [`…-tier3-and-widgets`](../../overview/history-2026-08-08.md) ·
    [`…-early-deload`](../../overview/history-2026-08-08.md). Six write domains;
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
- [`docs/superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md`](../../superpowers/plans/2026-08-17-admin-db-snapshot-endpoint.md)
  — backlog **Q-530**, the designed half of Q-251. A prod-shaped snapshot for local migration
  rehearsal, built by paginating over the **existing** `claude_ro` views rather than writing a second
  scoping map. Carries the production volume measurements (**477 MB DB; `oura_raw_samples` is 360 MB
  and 99.98% of it is the owner's, so scoping is a consent fix and never a size fix**), the runtime
  drift gate that makes an unregenerated view schema **fail the export** rather than omit a table,
  and the leak analysis for the new secret.
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

- [`docs/reviews/2026-08-17-failure-cells-running-the-app.md`](../../reviews/2026-08-17-failure-cells-running-the-app.md) — **the failure-cells lens, run against a live app, 2026-08-17** (Q-453/454/455 — date-param fallback, auth-after-validation, bodiless 500; plus the clean sweeps: 122 GET routes anonymous, 122 as a zero-data user, 51 screen renders). Findings Q-450…Q-455; four areas recorded **clean**.

- [`docs/reviews/2026-08-17-repo-migration-architecture.md`](../../reviews/2026-08-17-repo-migration-architecture.md) — **the repo migration reviewed as an architecture change, 2026-08-17** (Q-456 the owner user ID in 18 committed migrations, Q-457 the archived-repo release default, Q-458 `.env.example` drift both ways, Q-459 the APK 404 window). Findings Q-456…Q-459; **no credentials leaked and the public-repo CI posture is correct**, plus five more clean results.

- [`docs/reviews/2026-08-18-silent-card-failures.md`](../../reviews/2026-08-18-silent-card-failures.md) — **three lenses: leaked error text, AI rate-limit coverage, and cards that vanish, 2026-08-18** (Q-499 — 78 components call `cachedFetch`, **18** reference its `onError` hook; two verified by hand conflate "fetch failed" with "no data" and simply disappear, including on a **429 from the app's own limiter**. **Corrects `CLAUDE.md`'s premise**: `cachedFetch` does *not* unconditionally swallow `!res.ok` — `cachedFetchCore` takes `onError` and swallows only when the caller declines it.) **Two lenses came up clean:** every route returning `err.message` is admin- or session-gated (and `admin/db-query` doing so is correct by design), and every route that actually calls an LLM has a rate limit — the 7 that looked unlimited make **zero** LLM calls.
- [`docs/reviews/2026-08-18-unbounded-request-bodies.md`](../../reviews/2026-08-18-unbounded-request-bodies.md) — **request-body size guards, and which routes never got one, 2026-08-18** (Q-498 — 113 routes take a body, **7** are guarded, **93** are not, and of those exactly **3 are reachable without a session**: `auth/register`, `auth/exchange-mobile-token`, `health-connect/ingest`. Measured: 20 MB was cut off at 2.9 MB on a guarded route and accepted **whole** on the unguarded ones. **`health-connect/ingest` reads and Zod-parses the body at lines 35/40 but rate-limits at 53 and checks the secret at 58** — a caller holding no secret makes the server parse an arbitrary body, unthrottleable. Compounds with Q-493.) **`readJsonLimited` itself is correct** — `Content-Length` is only a fast path, the authoritative check is the streamed measurement.
- [`docs/reviews/2026-08-18-admin-range-loop-termination.md`](../../reviews/2026-08-18-admin-range-loop-termination.md) — **the admin date-range routes, and a loop that does not terminate, 2026-08-18** (Q-497 — `shiftDateStr` does not pad the year, so one day after `9999-12-31` is `10000-01-01`, and the loop's `d <= end` **string** compare makes that *true*. `from=9999-12-01&to=9999-12-31` passes every guard and spans exactly 31 = `MAX_RANGE_DAYS`, then runs forever at ~12 queries an iteration; measured still looping at 5000. **Two sites — `backfill-derived-scores` has it too and that one writes.**) All three of `CLAUDE.md`'s claims about `day-review` (GET-only, fail-closed, token widens transport not authority) **hold**, and its `normalizeDateParamIso` returning 400 where `health-connect/ingest` returns 500 corroborates Q-496 directly.
- [`docs/reviews/2026-08-18-health-connect-ingest.md`](../../reviews/2026-08-18-health-connect-ingest.md) — **the secret-gated Health Connect ingest route, driven for real, 2026-08-18** (Q-493 — the SEC-I3 brute-force gate keys on `x-forwarded-for`'s **leftmost, client-supplied** hop, so rotating one header bypassed it: fixed header → 1 limiter key at count 20, rotating → **30 keys at count 1, all reaching the secret compare**; 7 sites share the pattern. Q-494 — `{"date":"9999/12/30","weightKg":499}` took `getMostRecentConfirmedWeightKg` from **81 kg to 499 kg permanently**, and the ranked source merge is orthogonal to it because ranking is per column *per date*. Q-495/Q-496 — coercion laundering and a 500-on-invalid-date). **What the route gets right is stated first** — the gate precedes the compare, `safeCompare` is length-safe, the date regex takes both separators.
- [`docs/reviews/2026-08-18-workout-write-path.md`](../../reviews/2026-08-18-workout-write-path.md) — **the workout write path, driven live and probed cross-user, 2026-08-18** (Q-460 missing affected-row check on a client-id-driven scoped UPDATE, Q-462 a permanent ownership refusal reported as a transient 500). Findings Q-460…Q-462; **cross-user write protection holds across the whole workout surface** (verified against a second live account, with a control for every probe), plus three more clean results.

- [`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md) — **nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for the not-found answer, 2026-08-18** (Q-463 — 16 bare `throw new Error('… not found')` in the repository layer reach five routes as 500s; the sync client classifies 5xx as retryable). Finding Q-463; **cross-user protection holds across all four write pillars**, and the idempotent `DELETE` pattern is recorded as clean rather than filed.

- [`docs/reviews/2026-08-18-ingest-and-input-validation.md`](../../reviews/2026-08-18-ingest-and-input-validation.md) — also carries **Q-466**: CI re-downloads the Playwright browser on every E2E run with no cache, and stalled twice on 2026-08-18 on a required check.

- [`docs/reviews/2026-08-18-ms-offset-to-calendar-day.md`](../../reviews/2026-08-18-ms-offset-to-calendar-day.md) — **the banned ms-offset time-window pattern, sorted, 2026-08-18** (Q-489 — five sites turn an ms offset into a calendar day, and on the 25-hour DST fall-back day three of them compute "today" when they mean "yesterday"; measured). **Records that most of the 12 instances are correct** — rolling instant windows feeding hours-based consumers — so a sweep that greps the pattern and files all of them files mostly false positives.
- [`docs/reviews/2026-08-18-local-first-write-coverage.md`](../../reviews/2026-08-18-local-first-write-coverage.md) — **the generalisation of Q-488, 2026-08-18**: every mutating write to a local-first domain audited for a local-store call *inside the handler*. All eight delete/patch handlers write locally; **Q-488 is the only instance**, so its fix is one handler rather than a class sweep. Records that the file-level version of the check is unsound (it clears the Q-488 file) and that "no pull mapping" is not evidence of a gap — `saved_meals` is push-only and hydrate-on-read by design.
- [`docs/reviews/2026-08-18-seed-only-read-paths.md`](../../reviews/2026-08-18-seed-only-read-paths.md) — **case (b) of the staleness test, 2026-08-18**. Five seed-only candidates, **all five revalidate** — via `cachedFetch`, a raw `fetch`+`setCached`, or a **local-store read**+`setCached`. Records that the mechanical test (`readCacheSync` minus `cachedFetch`) over-reports and why, and that a `Q-NNN:` comment in this codebase is usually a fix's rationale rather than an open defect — the second time that cost a false alarm this run.
- [`docs/reviews/2026-08-18-load-bearing-cache-audit.md`](../../reviews/2026-08-18-load-bearing-cache-audit.md) — **every `freshWithinTtl` cache key audited against its invalidation group, 2026-08-18**. Seven load-bearing keys, all `TTL_LONG`; all covered, and every client writer calls its group — **no gap**. Closes the audit `CLAUDE.md` flagged as never done for any group but `invalidateGoalRecommendations`. Records that the invalidations are **device-local** (a shared table stays stale ≤6 h on other clients — deliberate today, a real problem if multi-user lands) and that **case (b), seed-only read paths, is still unaudited**.
- [`docs/reviews/2026-08-18-production-verification-round-2.md`](../../reviews/2026-08-18-production-verification-round-2.md) — **this run's fourteen findings checked against production, 2026-08-18**. Q-475 upgraded: `/api/sync/pull` has **69** recorded faults and `/api/sync/push` has **zero, ever**, across six days with 125 database connection failures — and `sync-provider.tsx` runs push *before* pull in the same cycle, so the zero means push cannot report. Q-482/Q-483 confirmed never triggered; Q-484 latent confirmed; Q-481/Q-485 shown unprovable from production, one with a trap query recorded so it is not cited.
- [`docs/reviews/2026-08-18-implausible-value-silent-drop.md`](../../reviews/2026-08-18-implausible-value-silent-drop.md) — **the same out-of-range value sent down both write paths, 2026-08-18** (Q-485 — web refuses it with a message, sync-push writes the row, drops the field and reports `errors: []`, with no log and no `error_events` row; 12 of 14 value checks in `pushMutations` coerce silently while 2 throw). **The bounds themselves mirror correctly** — both paths share one validation module.
- [`docs/reviews/2026-08-18-unvalidated-create-bodies.md`](../../reviews/2026-08-18-unvalidated-create-bodies.md) — **oversized and unvalidated request bodies, 2026-08-18** (Q-484 — `POST /api/injuries` accepts and stores a 10 MB note and an unvalidated `startedDate` while its own PATCH sibling caps the same fields; 33 body-bearing routes read `req.json()` with no schema parse, a candidate count rather than a defect count).
- [`docs/reviews/2026-08-18-malformed-route-ids.md`](../../reviews/2026-08-18-malformed-route-ids.md) — **every dynamic route called with an id that is not a UUID, 2026-08-18** (Q-483 — three routes reply with the raw driver error including the full `SELECT` and every column name of `workout_sessions`, from their own catch, unredacted in production; Q-482 — 21 route/method pairs across 14 routes 500 on a malformed id while answering a valid-but-missing one correctly, and only 2 of 30 dynamic routes validate the id at all).
- [`docs/reviews/2026-08-18-empty-and-single-datapoint-accounts.md`](../../reviews/2026-08-18-empty-and-single-datapoint-accounts.md) — **126 static GET routes driven at zero data and at n=1, 2026-08-18**. No unguarded division anywhere in the aggregate code; no route changes behaviour between no history and one reading; `onRequestError` verified writing `error_events` for a bodiless 500. **Carries a method correction worth reading before writing any numeric-corruption probe:** `JSON.stringify` turns `NaN` and `Infinity` into `null`, so grepping a response body for them detects nothing.
- [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](../../reviews/2026-08-18-outbox-replay-idempotency.md) — **the same mutation pushed twice, 2026-08-18** (Q-481 — `waterMlDelta` replayed three times stores 750 ml for 250 logged; it is the only non-idempotent branch of nineteen, and the server keeps no record of processed mutation ids). Three clean replay results, including a second independent confirmation of the Q-473 fix on the outbox-replay vector.
- [`docs/reviews/2026-08-18-server-tz-and-rate-limit-verification.md`](../../reviews/2026-08-18-server-tz-and-rate-limit-verification.md) — **verification, not bug-hunting, 2026-08-18**: the server side of the Q-477 timezone problem does not exist. Every caller of the tz-defaulting repository and shared-sleep helpers threads the session tz, all four timezone-sensitive SQL sites are parameterised, all 13 AI routes are rate-limited and all 104 rate-limit keys are user- or IP-scoped. One finding (Q-480): the `CLAUDE.md` line calling the repo helpers timezone-hardcoded is stale and misdirects anyone picking up Q-477.
- [`docs/reviews/2026-08-18-auth-session-boundaries.md`](../../reviews/2026-08-18-auth-session-boundaries.md) — **privilege revocation and the fail-closed secret gates, tested for the first time, 2026-08-18** (Q-479 — `app/api/exercises` trusts the JWT `isAdmin` claim, which refreshes only once a day, so a revoked admin wrote a row into the shared `exercise_library`; the `requireAdmin` control refused at the same instant). Five clean results: all 61 `requireAdmin` routes DB-check, `health-connect/ingest` is the reference fail-closed implementation, and both bearer paths reject on partial config.
- [`docs/reviews/2026-08-18-timezone-non-default-user.md`](../../reviews/2026-08-18-timezone-non-default-user.md) — **the app driven as a user who is not in Brisbane, for the first time, 2026-08-18** (Q-477 — the Profile "Auto-detect timezone" button is what breaks dates: the server honours the new zone, 100 of 125 client call sites do not, and the calendar marks the wrong day; Q-478 — two cache today-guards compare a server-stamped date to a client `DEFAULT_TZ` date, so they are false for up to 14 hours a day and one of them leaves a loading state that never clears). **Every API route threads the user's timezone** — all findings are client-side.
- [`docs/reviews/2026-08-18-outbox-under-failure.md`](../../reviews/2026-08-18-outbox-under-failure.md) — **the outbox pushed for real, including with the database stopped, 2026-08-18** (Q-475 — a DB outage returns HTTP 200 with per-item errors, so the client resets its 5xx backoff and dead-letters every queued mutation after ~43 minutes of downtime; Q-476 — a schema-rejected mutation is deleted with no badge, toast or retry, while a strictly-worse in-handler failure is kept and retryable). **The poison-pill rule itself holds** — poison isolated by outbox id, all four siblings written; four clean results recorded.
- [`docs/reviews/2026-08-18-coach-apply-path.md`](../../reviews/2026-08-18-coach-apply-path.md) — **the AI Coach's write path, reviewed for the first time, 2026-08-18** (Q-467/Q-468 — a complete undo subsystem with no caller, and an apply/undo asymmetry (`driftAgainst` on the way in, nothing on the way back)). Findings Q-467/Q-468; the **apply** path came back clean and is documented at length as the reference for LLM-initiated writes.

- [`docs/reviews/2026-08-18-ai-double-trips.md`](../../reviews/2026-08-18-ai-double-trips.md) — **the AI-usage screen's double-trips traced to cause, 2026-08-18** (Q-471 — the double-trip fingerprints are too coarse on three meal-plan sections, so deliberate rerolls read as redundant and the screen's top row is an artefact). Findings Q-469…Q-471; corroborates **Q-295** exactly and confirms **Q-170's latency fix is holding** (7-day Coach average 2,307 ms).

- [`docs/reviews/2026-08-18-production-verification.md`](../../reviews/2026-08-18-production-verification.md) — **this run's own findings checked against production, 2026-08-18** (the `error_events` read done properly — nothing unrecorded in 7 or 30 days; the 5,771-hit `[pg 21000]` on `hr-ingest` is already recorded and fixed). Filed Q-472; **amended Q-460, Q-465, Q-467, Q-468** — one refuted, two re-scoped to zero exposure, one shown unprovable either way.

- [`docs/reviews/2026-08-18-claude-md-prose-counts.md`](../../reviews/2026-08-18-claude-md-prose-counts.md) — **every count in `CLAUDE.md`, verified mechanically, 2026-08-18** (Q-492 — script-backed counts 3 of 3 current, hand-typed prose counts **7 of 9 stale**: hex literals 471 → **428**, the >800-line hotspot list still names a 476-line file, "22 of 33" → **29 of 40**). Two items are more than drift: `more/profile-tab.tsx` should already have been struck under the file's own rule, and the rollup-glob maintenance command at `CLAUDE.md:976` is scoped to the directory the glob covers, so it **can only confirm the glob against itself** (latent — nothing mis-timed today). Recommendation: **cite the command, or delete the number and keep the rule.**
- [`docs/reviews/2026-08-18-model-version-clobber.md`](../../reviews/2026-08-18-model-version-clobber.md) — **the readiness model stamp is erased within hours, 2026-08-18** (Q-518 — same row read at 04:38:27 carries `{"bodyComp","readiness"}` and at 10:18:40 carries `{"bodyComp"}` alone; stamped rows table-wide go 1 → 0. `upsertOuraDailyDerived` sets every column with `COALESCE(excluded, existing)`, which for a `jsonb` column replaces the document **whole**, so the merge is left to each caller and only `readiness-payload.ts` does it. **Retracts PR #85's claim that the merge "held in production"** and defeats Q-501's purpose. Fix belongs in the upsert (`existing || excluded`), the same shape as Q-280).
- [`docs/reviews/2026-08-20-non-workout-write-surface-ownership.md`](../../reviews/2026-08-20-non-workout-write-surface-ownership.md) — **the non-workout write surface, probed live with two accounts, 2026-08-20** (RV-33 — `POST /api/progression-styles` and `PATCH /api/nutrition/food-logs/[id]` answer a correct ownership refusal with an **empty-bodied 500** and file it into `error_events` as a server fault; the Q-462/Q-463 class on two routes that fix missed). **`CLAUDE.md`'s write-path ownership rule (b) — a raw request body into Drizzle `.set()` — is audited for the first time and is clean**: 116 mutating routes, 325 `.set()` sites, every one built field by field. Rule (a) remains the one with no evidence.

- [`docs/reviews/2026-08-19-cross-pillar-score-ranges.md`](../../reviews/2026-08-19-cross-pillar-score-ranges.md) — **every pillar's range side by side, and why range alone is the wrong test, 2026-08-19.** Only **Body Battery** genuinely spans (sd 29.6 — though 5 of 51 days sit exactly on a clamp bound); **activity is the most compressed** (sd **6.0**, zero days under 50); sleep's stored 85.3 is the **old** model. Range catches the stuck-score class instantly but **cannot see a score that moves the wrong way** — Q-507's stress metric has a fine spread and correlates **+0.40** with readiness. Pair it with a correlation against an independent signal.

- [`docs/reviews/2026-08-19-daily-summary-replace-wipe.md`](../../reviews/2026-08-19-daily-summary-replace-wipe.md) — **`oura_daily_summary` holds 1 row against 198,223 raw samples, 2026-08-19**
  (Q-528). `replaceOuraDailySummary` **deletes unconditionally and then checks for emptiness** —
  the guard sits on the INSERT, not the DELETE — so a full-history pass over a narrow input wipes
  the history and returns successfully, with no error and no log. The windowed path is safe, which
  is why it survived: only the rarely-taken `fullHistory` branch can do it. **Illness scores from
  the same array survived** because they write through a COALESCE upsert to a different table.
  Also records `oura_bucket` and `step_live_windows` at **0 rows system-wide** — the first carries
  `met_mean`/`motion_mad`, the drift-proof anchor Q-522 needs. **Corrects Q-525's diagnosis.**

## Open issues

```bash
grep -n '^### .*\[platform\]' projectOverview.md   # 30 entries today
grep -n '\[platform\]' docs/implementation-backlog.md   # 6 queue items today
```

Live at the time of writing (2026-07-30):

- ⚠️ **Sixteen writes revalidated around their push, not after it** (LB-6, 2026-08-24, v1.344.0).
  Invalidating beside a fire-and-forget `pushMutations` makes subscribers refetch and **re-cache**
  the pre-write payload for the key's full TTL; one site had the mirror image and repainted nothing
  offline. The entry found six — its finder looked only *above* each call.
  `scripts/check-invalidate-after-push.js` holds the class shut. **Not device-verified: every
  converted branch takes the web fallback here** —
  [`journal`](../../overview/entries/2026-08-24-invalidate-after-push-sweep.md).

- ⚠️ **Q-155 — the DB suite is largely blind to a loss of user scoping.** Partly mechanised
  2026-08-09: `scripts/check-repository-user-scoping.js` fails any adapter/slice method that takes
  `userId` and never uses it (368 take it, all use it today). That catches an *omitted* scope, not
  a wrong one, not a join that mentions `userId` without constraining, and not a broken pre-check.
  See [`the journal entry`](../../overview/history-2026-08-08.md).

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

- **[`docs/handoff-2026-08-20-platform-migration-gate-and-energy-weight.md`](../../handoff-2026-08-20-platform-migration-gate-and-energy-weight.md)**
  — the CI job named **Migration Check** could not fail on a broken migration: `migrate.js` exited 0
  whatever happened, and it had no error classifier, so it also called four already-applied
  migrations "failed" where `ensureSchema()` calls them benign. Fixing the gate immediately caught a
  real one — **`142_claude_ro_views.sql` creates a view over a table `143` creates**, so on every
  fresh CI database 142 aborted and every view below it rolled back, in three green jobs. Also
  carries the CSP work (`'wasm-unsafe-eval'`, and two dead Oura Cloud hosts removed) and the
  body-weight source fix behind the done screen's calorie figure.

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
  [`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md)
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

- **[`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md)**
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
  see [`2026-08-03-model-asset-bucket-report.md`](../../overview/history-2026-07-30.md).
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

- [`handoff-2026-08-20-platform-review-sweeps-29-39.md`](../../handoff-2026-08-20-platform-review-sweeps-29-39.md) — **Review sweeps 29–39, 2026-08-20** (11 PRs, Q-492…Q-499 + Q-552…Q-556; three CI checks added for documentation facts nothing was checking). **10 of 13 findings have since shipped**, verified in source. Its most transferable output is the method section: **five measurements were wrong, each producing a plausible result in the expected direction** — and the keeper, *corroboration between two weak signals is not evidence when they can fail for the same reason*.
- [`handoff-2026-08-18-platform-decision-brief-rule.md`](../../handoff-2026-08-18-platform-decision-brief-rule.md)
  — the `CLAUDE.md` rule governing how a decision is brought to the owner (#69), and the merge
  friction that shipping it exposed: **three of four CI rounds were base collisions on the doc-index
  BASELINE object**, none on the content being changed. Filed as **Q-543**, with the resolution
  method that avoids silently reverting another lane's raise.
- [`handoff-2026-08-17-platform-prod-snapshot-endpoint-plan.md`](../../handoff-2026-08-17-platform-prod-snapshot-endpoint-plan.md)
  — Q-530, the designed half of Q-251: a prod-shaped DB snapshot built by paginating the **existing**
  `claude_ro` views rather than writing a second scoping map. Carries the measurement that inverts
  the intuition Q-251 was written on (**the owner owns 99.98% of `oura_raw_samples`, so scoping to
  one user removes 0.02% of the volume — a consent fix, never a size fix**), why the drift gate must
  read `pg_catalog` rather than `information_schema` from the read-only role, and the two traps in
  `/api/export` that make Q-288's coverage fix unsafe on its own.

- [`handoff-2026-08-17-platform-agent-model-and-device-session-findings.md`](../../handoff-2026-08-17-platform-agent-model-and-device-session-findings.md) — the standing-agent model (roles, lane contract, Q bands, batons, prompts), the documentation reorganisation and its two CI guards, and six findings from a live APK reinstall + Oura re-sync: the ring key an uninstall destroys, the emulator job that could not pass, `disk_full` in production, and the clock-epoch collision behind 43 wrong sleep windows (Q-536).
- [`handoff-2026-08-17-platform-context-warning-window.md`](../../handoff-2026-08-17-platform-context-warning-window.md)
  — the wrap-up warning fired at ~111% while the window was 22% full. It is a `Stop` hook
  (`.claude/hooks/context-usage-warn.mjs`), **not** a CLAUDE.md rule — worth knowing before hunting
  for it in the wrong file. Its window constant was 200k against a real 1M, now corrected so the
  thresholds land at 900k/950k. Records that the transcript exposes no window size, so the hook
  cannot self-calibrate and this constant goes stale silently.
- [`handoff-2026-08-16-platform-public-repo-cut-a4b.md`](../../handoff-2026-08-16-platform-public-repo-cut-a4b.md)
  — Q-49 public-repo cut. **Updated at the Phase B boundary:** A4b has shipped, Oura's material is
  out of the tree, and the handoff now carries what A4b cost beyond the plan — the constants were
  still a build-time dependency and `publish-dry-run` has no build gate to see it (Q-313), the
  measured blast radius was 17 files not 16, and the guards had to go finer than per-`describe`.
  Runbook: [`public-repo-cut-runbook.md`](../../public-repo-cut-runbook.md), steps 8–14 remain.
- [`overview/entries/2026-08-16-public-repo-cut-a4b.md`](../../overview/history-2026-08-15.md)
- [`docs/overview/entries/2026-08-24-recipe-spec-structural-attribution.md`](../../overview/entries/2026-08-24-recipe-spec-structural-attribution.md) — **LB-7, the recipe spec's attribution guard, 2026-08-24** (`getByText('example.com').last()` matched the row's NAME, which is the host while the scrape resolves — measured passing with the attribution deleted and the mock delayed 8 s. It asserts on a `data-testid` row now.)
- [`docs/overview/entries/2026-08-24-metric-bounds-at-keyboard.md`](../../overview/entries/2026-08-24-metric-bounds-at-keyboard.md) — **Q-321, bounds asked at the keyboard, 2026-08-24** (`validation/body-metrics.ts` held every threshold and nothing under `components/`/`app/` imported it, so a 5,000 kg weight was queued and dropped server-side. Three sheets now share `components/health/metric-bounds.ts`; `log-value-sheet.tsx` had no check at all across seven fields.) **Device path not exercised.**
  — the A4b journal entry.
