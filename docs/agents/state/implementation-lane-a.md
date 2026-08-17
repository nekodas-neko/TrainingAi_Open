# Implementation Agent (A) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (A) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the first session to run as Lane A · **Q band:** 314–349 (next free: 314 — none taken)

## Now
Nothing in flight. **Q-310 shipped and merged** — #17, v1.317.5. An engine-chosen ai_dynamic deload
was prescribing full weights: `/api/workout-data`'s catch-all phase branch existed as two verbatim
copies that both hardcoded `isDeloadActive: false` while title-casing the *same*
`aiPeriodizationState.phase` field into the header label "Deload". Both now call
`aiDynamicFallbackPhaseStatus()` in `packages/shared/src/workout/session-data.ts`. Detail, evidence
and what was refuted:
[`entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md`](../../overview/entries/2026-08-17-ai-dynamic-deload-fallback-not-flagged.md).

## Next
Work the queue top-down, taking the highest item in Lane A's ownership. As of this writing:

1. **Q-450** `[activity][cardio]` and **Q-451** `[workouts][app-shell]` sit at the top. Both
   root-cause into `components/` (`done-activity-screen.tsx`, the Workout empty state) — **Lane B's**,
   skip them.
2. **Q-452** `[app-shell][platform]` — the AI insight card runs an LLM over literal "no data" strings.
   Read it before claiming: the fix may sit in the route (Lane A) or the card (Lane B), and the
   entry does not settle which.
3. **Q-313** `[platform]` — a `next build` gate for `scripts/publish-dry-run.js`. `scripts/` is in
   neither lane's list, so **claim it in this file before touching it** and check Lane B's baton.
   Heed the entry's own note: a build is minutes, so gate it behind `--all`.
4. **Q-312** `[platform]` — the synthetic MET table is physiologically impossible, ~9 tests in CI.
5. **Q-263** `[platform]` — audit the remaining cache groups the way Q-262 audited one
   (`lib/cache-groups.ts`). Lane A.

## Blocked
Nothing on the owner. One thing **owed**: the device check on Q-310, filed as a Known-Issues row in
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
