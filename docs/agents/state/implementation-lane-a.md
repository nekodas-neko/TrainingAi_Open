# Implementation Lane A — baton

**Updated:** 2026-08-17 · **By:** the first session to run as Lane A · **Q band:** 314–349 (next free: 314 — none taken)

## Now
**Q-310 is built and its PR is open** on `fix/ai-dynamic-deload-fallback-not-flagged` (v1.317.5).
An engine-chosen ai_dynamic deload was prescribing full weights: `/api/workout-data`'s catch-all
phase branch existed as two verbatim copies that both hardcoded `isDeloadActive: false` while
title-casing the *same* `aiPeriodizationState.phase` field into the header label "Deload". Both now
call `aiDynamicFallbackPhaseStatus()` in `packages/shared/src/workout/session-data.ts`.

Full local gate green — `tsc` clean, lint 0 errors, `pnpm build` green, `pnpm check:rules` **Ran 38
of 38**, suite 477 files / 3,893 tests, and both fixed copies exercised on a running `pnpm dev`
against a seeded deload phase. Numbers and method are in
[`entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md`](../../overview/entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md).
Standard bug fix, not destructive — drive it to green and merge without asking.

## Next
Work the queue top-down, taking the highest item in Lane A's ownership. At the time of writing (numbers as renumbered by the 2026-08-17 duplicate-Q sweep):

1. **Q-313** `[platform]` — a `next build` gate for `scripts/publish-dry-run.js`. Lane A. Small;
   heed the entry's own note that a build is minutes, so gate it behind `--all` rather than the
   default path.
2. **Q-312** `[platform]` — the synthetic MET table is physiologically impossible and costs ~9
   tests in CI. Lane A.
3. **Q-261** `[app-shell][platform]` — `<Label>`s in `components/profile/`. **Lane B's**, skip it.
4. **Q-263** `[platform]` — audit the remaining cache groups the way Q-262 audited one
   (`lib/cache-groups.ts`). Lane A.

## Blocked
Nothing on the owner. One thing still **owed**: the device check on Q-310, filed as a Known-Issues
row in `projectOverview.md` rather than left implicit. Server/JS only, so it reaches the APK via the
Railway deploy with no rebuild — but the client half was verified from the route's response, not on
hardware.

## Claimed paths
None held. Q-310 touched only Lane A paths plus its own bookkeeping. It deliberately did **not**
touch `components/workout/exercise-summary-screen.tsx` (Lane B) — see below.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md). Read it rather than re-deciding it. Take Q numbers from
  the band above, never from the backlog's next-free pointer.
- **Q-310's fix direction items 2 and 3 are refuted, and were deliberately not built.**
  (2) `exercise-summary-screen.tsx`'s `isNewPR` needs no deload gate: `estimateOneRm` returns
  exactly `0` when `deloaded`, and the badge already gates on `newEst1rm > 0`. There is no
  "submaximal-adjusted estimate that still exceeds the bar". (3) No corrective migration is needed:
  `logExerciseFromPayload` reads `session_periodization` independently of the route, so the server
  zeroed the estimate and refused the PR throughout. Both production deload sessions (2026-08-09,
  2026-08-16) carry `max(estimated_1rm) = 0` and no `personal_records` row on either date. The badge
  the owner photographed was the *client's* optimistic display.
- **Q-185 is closed**, despite `docs/domains/workouts/README.md` having said "still open" until this
  session. The un-prescribed deload branch exists below the `if (aiDrivesLoad)` block; verified in
  source and on the dev server.

## Method notes worth keeping
- **`CLAUDE_DB_QUERY_SECRET` is set in this environment** and `POST /api/admin/db-query` works from
  the sandbox. It is the fastest way to answer "did this actually corrupt anything" before writing
  a migration an entry asks for. Row-scoped to the owner — phrase findings as "nothing of the
  owner's".
- **Exercising an ai_dynamic route locally** means mutating the seed: the seeded program is
  `phase_mode = 'manual'` with no `session_periodization` row. Set `phase_mode='ai_dynamic'`, insert
  a periodization row at the phase you want, hit the route, then **revert both** — the local DB is
  shared with the test suite.
- **`npx playwright test --project=setup` mints a real session cookie** into
  `e2e/.auth/seed-user.json`; extract it and `curl` the API directly. Far faster than driving the UI
  for a route-level check.
- The local dev DB reports three pre-existing `ensureSchema` failures (`038`, `040`, `041` —
  `progression_styles.created_at` missing). Unrelated to any change; ignore them.
