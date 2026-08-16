# Handoff — 2026-07-30 · Navigation perf, two auth fixes, and the offline-first direction

_Domain: `app-shell` (also touches `platform`, `readiness`) · Branch: `fix/deactivation-claim-refresh` ·
PR: **#932, open, CI green, ready to merge**_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/app-shell/README.md`, then `docs/implementation-backlog.md` (the queue).
> For the direction this session set, read
> [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md) — it is new
> and it reframes Phase 3.

## Goal

Started as "screen transitions still feel slow" (issue #868, follow-up to #918/#919). Ended up
covering: the real cause of the transition delay, an audit for undocumented performance debt, two
auth-boundary bugs found alongside Phase 3, the Q-2 nightly-temperature bug, and — most
importantly — the owner clarifying that the destination is an **offline-first app**, not a faster
one.

## Current status

- **Build/test:** typecheck clean, lint 0 errors (119 pre-existing warnings), 2807 tests pass.
  `pnpm dev` exercised for the auth flow (sign-in, guarded route, `/api/auth/session`) and for the
  middleware A/B. Prefetch verified against a **production** build (see gotchas).
- **Device-verified:** **no.** Nothing this session was run on the S25. Specifically unverified:
  the transition/prefetch latency benefit on Samsung's WebView, the `/mobile-signin` fix against a
  real first-run install, the 24h `isActive` flip, and whether nightly temperature stops quantising
  on real ring data.

## What shipped

| PR | Version | What |
|---|---|---|
| #919 | 1.241.1 | Transition resolves on route commit, not a fixed timer (pre-session; corrected below) |
| #921 | 1.242.2 | `DetailHero` back button was covered by a sibling at equal z-index — visible but dead |
| #924 | 1.242.1 | Prefetch on the 7 remaining button-driven nav sites |
| #928 | 1.242.3 | `/mobile-signin` added to `PUBLIC_PATHS` — first-run APK sign-in was impossible |
| #930 | 1.243.0 | Q-2: nightly temperature from one sample per frame, `0x75` only |
| #933 | — | Task 4 decision recorded: **option B**, two apps in a workspace |
| **#932** | 1.243.1 | **Open.** `isActive` re-read on the session token, throttled to 24h |

## Deliberately NOT done

- **Q-28 (`applyDelta` bridge round-trips).** Filed with a full design. `runSQL` is one Capacitor
  bridge crossing per statement and `applyDeltaBody` awaits one per row across ~20 domains, so a
  pull is O(rows) sequential crossings. Left unbuilt because the benefit is confined to
  initial-sync/restore and is **unmeasured** — the row-count measurement needs prod data the sandbox
  cannot reach, and native SQLite does not run here at all. Do not build it before measuring.
- **Q-1 Task 3 (client-side auth, ~21 sites).** Was marked ⛔ mid-session, then unblocked when Task 4
  was decided. Still not started. **Sequence it after the workspace split** — its Step 4 removes
  `middleware.ts` route protection, which must not happen while middleware is the live gate.
- **A cold-start measurement on device.** I suggested it, then withdrew it: it was premised on Phase 3
  being a performance project. The owner's goal is architectural, so the measurement gates nothing.

## Key decisions (with rationale)

- **Task 4 = option B (two apps in a workspace).** Owner delegated with criteria "best not easiest",
  performance, and "more app updates in the future". Runtime performance does **not** discriminate —
  A and B both end with a bundled shell. What discriminates is that A's shell build mutates the tree
  (moving `app/api`/`middleware.ts`) on *every* future build, with a silent failure mode. B's cost is
  one refactor. Full reasoning in the plan's Task 4 decision block.
- **Deactivation: bound the window, don't close it.** Owner picked the ~24h re-read over a per-render
  DB query. Explicit requirement: an active user must never be re-prompted — satisfied, because this
  is a *claim refresh* inside the existing session, not a re-authentication.
- **Nightly temperature uses `0x75` alone.** Empirical, not protocol — which stream the ring itself
  consumes is an address in the Oura app binary and is unanswerable from `open_oura`.
- **The destination is offline-first, not faster.** Owner, 2026-07-30: the app works fully offline
  except AI calls and older data; Railway keeps the DB for calculated data (day rollups). Written up
  in `docs/offline-first-target-architecture.md`.

## Gotchas / what did NOT work

- **`router.prefetch` is inert under `next dev`.** Zero prefetch requests against the dev server;
  exactly one per screen against `pnpm build && pnpm start`. This **retroactively corrected #919** —
  its 190→118 ms figure was measured against dev, so the gain came entirely from the commit-poll fix
  and the prefetch half shipped unmeasured. **Any navigation-latency measurement must use a
  production build.**
- **Two backlog claims did not survive checking.** (1) "Re-check `isActive` per request against the
  co-located Postgres" — impossible: middleware is Edge and imports the deliberately Node-free
  `auth.config.ts`. (2) Q-2 "needs a redecode pass over archival `body_hex`, owner-run against prod"
  — unnecessary: `0x75` already decodes to `temps_c` and is already in `ROLLUP_TAGS`, so a
  re-aggregation suffices. **Verify backlog claims against source before planning around them.**
- **`"/mobile-signin".startsWith("/sign-in")` is `false`.** The existing `PUBLIC_PATHS` entry never
  covered it. Easy to assume it did.
- **Main moved 5 times during this session.** Every PR needed at least one merge-main-in round.
  Merge, never rebase/force-push. Expect `package.json` + `lib/changelog.ts` conflicts every time,
  and re-run the full gate on the merged tree — #922 rewrote the backlog from ~3,050 lines to ~510
  mid-session and #925 added `[domain]` tags, both of which conflicted structurally.
- **Queue IDs collide like migration numbers.** I filed Q-27 and #925 had already taken it; renumbered
  to Q-28. Claim against open PRs, not just the file on disk.
- **Dev-server artefacts poison a production build.** `.next` built by `next dev` then `pnpm start`
  gives `routesManifest.dataRoutes is not iterable`. `rm -rf .next` before a prod build.

## Files to look at

- `docs/offline-first-target-architecture.md` — **new**, and the most important thing here.
- `lib/auth/is-active-refresh.ts` — the throttled claim refresh, with 8 tests.
- `lib/health/temperature-baseline.ts` — `temperatureFrameSeries` collapses a frame's simultaneous probes.
- `lib/data/postgres/adapter.ts:4658–~5764` — `aggregateOuraRawSamples`, ~1,100 lines, the migration's hard part.
- `lib/view-transition.ts` — commit-poll transition; note the rAF deadlock comment.
- `docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md` — Task 4 decision block.

## Open questions / blockers

- **Backup and cross-device sync** — keeping Railway as the DB preserves both. Confirm that is the
  intent rather than an eventual fully-local store; it decides whether the sync engine grows or shrinks.
- **How much history must be local?** "Older data if needed" is the sanctioned exception, but the
  boundary (30 days? a year?) sizes the local schema and the device rollup window.
- **The owner should watch nightly temperature after the next ring sync.** If values still land on
  exact whole degrees, the median convention in `temperatureFrameSeries` is the first suspect — the
  plan's reference figure could not be reproduced without prod data.

## Pickup prompt

```
Work on TrainingAI. Read in this order:
  1. projectOverview.md — status and the Known Issues table
  2. docs/offline-first-target-architecture.md — the destination the owner set on 2026-07-30
  3. docs/domains/app-shell/README.md
  4. docs/handoff-2026-07-30-app-shell-perf-audit-auth-fixes-and-offline-direction.md
  5. docs/implementation-backlog.md — the queue

First action: check whether PR #932 (fix/deactivation-claim-refresh) merged. If it is still
open and green, merge it (squash) — the owner already approved it. If main has moved, merge
origin/main into the branch (never rebase or force-push), re-run the full gate
(pnpm tsc --noEmit, pnpm lint, npx vitest run, node scripts/check-doc-links.js), then merge.

Then: the top queue item is Q-1 Phase 3, now decided as option B (two apps in a workspace).
Do NOT start coding it. Write the implementation plan first, sequenced as:
workspace + shared lib/ package → app split (shell/ + api/) → Task 4c. Task 3 (client-side
auth) slots in AFTER the split — its Step 4 removes middleware route protection and must not
land while middleware is still the live gate.

Also unwritten and needed: a plan for migrating the Oura BLE derivation on-device
(aggregateOuraRawSamples, lib/data/postgres/adapter.ts:4658–~5764, ~1,100 lines). It is the
load-bearing piece of the offline-first target and is NOT a straight port — read the "Oura
rollup is the load-bearing migration" section of the architecture doc for what a plan must
settle, and docs/oura-ble-operations.md before touching the pipeline.

Constraints that will otherwise be re-discovered:
- Nothing from 2026-07-30 was verified on the S25. Anything touching offline-first domains,
  native plugins, safe-area, gestures or notifications needs the device smoke run or an
  explicit Known-Issues row.
- router.prefetch is INERT under `next dev`. Measure navigation latency against
  `pnpm build && pnpm start` only. rm -rf .next between dev and prod builds.
- Auth changes are confirm-first: present and ask before merging, never auto-merge.
- Main moves constantly (5 times in one session). Merge origin/main in; never rebase or
  force-push. Expect package.json + lib/changelog.ts conflicts and re-bump on the fresh base.
- Claim queue IDs and migration numbers against open PRs, not just the files on disk.
- Verify backlog claims against source before planning around them — two were wrong on
  2026-07-30 (an Edge-runtime impossibility, and an unnecessary redecode pass).
```
