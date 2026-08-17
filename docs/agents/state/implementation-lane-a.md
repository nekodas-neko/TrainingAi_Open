# Implementation Lane A — baton

**Last written:** 2026-08-17 · **Branch:** `claude/implementation-lane-a-ctx048`
**Working branch this run:** `fix/ai-dynamic-deload-fallback-not-flagged`

> This file is rewritten in full each session, never appended. It is the state the previous Lane A
> left; if it says a PR is open, that PR is yours.

## Lane contract (as given, since `docs/agents/README.md` does not exist yet)

**Owned paths:** `lib/data/**` (every Postgres migration), `lib/local-store/**`, `lib/sqlite/**`,
`lib/cache-groups.ts`, `app/api/**`, `packages/shared/**` except `changelog.ts`, the domain-math
directories under `lib/`, the BLE and device pipelines, auth/security, `android/**`.
Lane B owns screens and components (`app/**/*-content.tsx`, `components/**`).

**Q band:** 313–349, taken directly. **None taken yet** — this run worked an existing entry.
Postgres migration numbers and local SQLite versions are Lane A's alone. **None taken this run.**
Next free Postgres migration per the backlog header is **177**; local SQLite is at **v22**.

## In flight

**PR: Q-310 — an engine-chosen ai_dynamic deload prescribed full weights.**
Branch `fix/ai-dynamic-deload-fallback-not-flagged`, v1.317.4. Full local gate green (see the
journal entry for the numbers). If the PR is still open when you read this, drive it to green and
merge it — it is a standard bug fix, not destructive, so no confirmation is needed.

Files: `packages/shared/src/workout/session-data.ts` (new `aiDynamicFallbackPhaseStatus`),
`app/api/workout-data/route.ts` (both catch-all copies), a new test, plus bookkeeping
(journal entry, `projectOverview.md`, backlog removal, `docs/domains/workouts/README.md`,
`package.json` + `changelog.ts`).

## Next

Work the backlog queue top-down, taking the highest item inside Lane A. As of this writing the
queue head is:

1. **Q-306** `[platform]` — add a `next build` gate to `scripts/publish-dry-run.js`. Lane A
   (tooling/platform, no component surface). Small. Note the entry's own caution: a build is
   minutes, so consider gating it behind the `--all` flag rather than the default path.
2. **Q-307** `[platform]` — the synthetic MET table is physiologically impossible and costs ~9
   tests in CI. Lane A.
3. **Q-261** `[app-shell][platform]` — six `<Label>`s in `components/profile/`. **Lane B**, skip.
4. **Q-263** `[platform]` — audit the remaining cache groups the way Q-262 audited one
   (`lib/cache-groups.ts`). Lane A.

**Re-verify each premise against `main` before building.** Q-310's entry was right about the root
cause and wrong about two of its three consequences — see below.

## Things learned this run, worth not re-learning

- **The backlog's leads are half-right in a specific way.** Q-310 nailed the root cause and the
  first symptom, and was wrong about the other two: `personal_records` was never corrupted (the
  server has its own independent gate), and the summary badge needs no deload check of its own
  (`estimateOneRm` returns exactly `0` when `deloaded`, and the badge already gates on `> 0`). Both
  were settled by reading the code and querying production, in under an hour. Do that before
  writing any corrective migration an entry asks for.
- **`CLAUDE_DB_QUERY_SECRET` is set in this environment** and the admin `db-query` endpoint works
  from the sandbox. It is the fastest way to answer "did this actually corrupt anything". Remember
  it is row-scoped to the owner — write findings as "nothing of the owner's".
- **Exercising an ai_dynamic route locally** means mutating the local seed: the seeded program is
  `phase_mode = 'manual'` with no `session_periodization` row. Set `phase_mode='ai_dynamic'` and
  insert a periodization row at the phase you want, hit the route, then **revert both** — the DB
  is shared with the test suite.
- **`npx playwright test --project=setup` gives you a real session cookie** at
  `e2e/.auth/seed-user.json`; extract it and `curl` the API routes directly. Much faster than
  driving the UI for a route-level check.
- The local dev DB reports 3 pre-existing `ensureSchema` failures (`038`, `040`, `041` —
  `progression_styles.created_at` missing). Unrelated to any change; ignore them.

## Blocked / owner

Nothing blocked on the owner from this run. The one outstanding item is the **device check** on
Q-310, recorded as a Known-Issues row in `projectOverview.md` rather than left implicit: confirm on
the S25 that an engine-chosen deload shows reduced weights and no PR badge.
