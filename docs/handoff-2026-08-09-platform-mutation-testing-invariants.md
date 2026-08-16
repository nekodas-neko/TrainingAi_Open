# Handoff — 2026-08-09 · Mutation-testing the data layer's invariants

_Domain: `platform` (also touches `nutrition`, `workouts`, `app-shell`) · Branch: `docs/wrap-up-session` · PR: none yet (this doc); 10 PRs already merged, listed below_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/platform/README.md`](domains/platform/README.md), then
> `docs/implementation-backlog.md` (the queue). This file covers only what *this* session did.

## Goal

Spend a large token budget on review rather than features: find what is *actually* unverified in the
data layer, rather than what looks unverified by reading. The method that carried the session was
**mutation testing** — break an invariant on purpose and count how many tests notice.

## Current status

- **Build/test:** DB suite green at each merge (last: 75 files / 387 tests). `tsc --noEmit` clean.
  All twelve Custom Rules scripts + `check-doc-links` clean. `pnpm dev` was run and exercised only
  for the Q-174 change (three routes, authenticated, plus a forged-id 404 case).
- **Device-verified:** **no.** Nothing in this session was run on the S25. Almost all of it is
  tests, CI scripts and docs, so there is little device surface — but the Q-174 repository change
  reaches the phone via Railway with no rebuild, and was verified on web only.

## What shipped

| PR | What |
|---|---|
| #1192 | `check-numeric-bounds.js` + `check-sparkline-primitive.js` — two rules moved into CI |
| #1193 | `check-local-column-upgrade-path.js` — closes a **blind spot in `check-reconcile`** |
| #1194 | Widened three inline CI greps past `app/lib/components` to include `packages/` (21% of the TS surface); filed Q-165, Q-166 |
| #1196 | `check-contrast.js` — WCAG contrast from the theme tokens, after three failed browser attempts; filed Q-167 |
| #1200 | Ownership scoping **measured**: 246 predicates neutralised → 286 of 317 tests still passed |
| #1202 | Ownership burn-down: 9 → 30 tests; no slice at zero |
| #1210 | Bulk mutations covered; 36 tests; no quartile at zero |
| #1215 | Static audit of the 50 writes to `user_id`-less tables; filed Q-174 |
| #1219 | **Q-174 fixed** — volume-target methods now scope themselves |
| #1232 | Soft-delete filtering measured: 113 filters → **371 of 372 tests still passed**; 7 tests added |
| #1233 | Static sweep for *missing* soft-delete filters; filed **Q-179** (a live bug) |

**Two CI checks I wrote were already burned down by other sessions** (Q-164 numeric bounds, Q-167
contrast) — both grandfather lists are now empty, which is the shrink-only pattern working.

## Deliberately NOT done

- **Q-178 and Q-179 filed, not fixed.** Both turn on product decisions (see below). Filing with
  options was the right output; guessing a fix was not.
- **Q-181 — 35 soft-delete filters in `periodization.ts` / `oura.ts` / `user-stats.ts`** remain
  unguarded. These are the aggregate/rollup domains; seeding a realistic Oura rollup or weekly-stats
  window is a much bigger job than the six single-row domains covered. **Not attempted**, rather
  than attempted and abandoned.
- **Exact per-predicate ownership attribution** — the quartile bisect *bounds*, it does not
  attribute. Exact needs ~246 individual runs (~5.5 h) for a marginal gain.
- **Q-165 was deliberately filed as NOT a CI-check candidate.** Nine legitimate exceptions in 33
  cases means the exemption list would be as long as the violation list — a rule that documents
  drift rather than preventing it. That is the opposite call from #1192's two checks, and the
  difference is the size of the exception set.

## Key decisions (with rationale)

- **Mutation over reading.** The 2026-08-07 review certified ownership clean *by reading*, and was
  right — the scoping **is** correct. Mutation asks a different question: would anything tell you if
  it stopped being? That is what found 93 of 246 predicates unguarded.
- **Never claim "all covered".** The bisect bounds rather than attributes, so the docs say "the
  method that found the gap can no longer find a hole in it" — deliberately weaker and true.
- **Q-174's dead methods were deleted, not fixed.** `upsertVolumeTarget` and `deleteVolumeTarget`
  had zero callers; dead code with an unscoped signature is what the next feature reaches for.
- **A grandfather list that shrinks is the enforcement.** Every new check fails both on a new
  violation *and* on a grandfathered entry that starts passing, so lists cannot rot into permanent
  exemptions.

## Gotchas / what did NOT work

**Seven assertions I wrote could not fail.** Each was caught only by running the new test under
mutation as well as clean — none by reading it:

1. `getBodyBatteryHistory` maps to a row shape with **no `userId`**, so `not.toContain(USER_B)` had
   nothing to match; 2. the same test had no seeded B row; 3. `deleteFitnessTest` is a **soft**
delete, so asserting an untouched column was inert; 4. `deleteMealType` throws `MEAL_TYPE_HAS_LOGS`
*before* the ownership check; 5. `updatePrescribedRun` only writes `status`/`updated_at`;
6. `previewLbsToKgFix` echoes one summary per **requested** name, so asserting it empty **fails on
clean code**; 7. `deleteSavedMeal` is a **hard** delete with no `deleted_at` column at all.

**The rate is not dropping.** Assume any new ownership or soft-delete test cannot fail until you
have watched it fail.

**A fix that was wrong, caught by the second assertion.** Q-179's obvious fix — add the missing
`deleted_at` filter to `deleteMealType`'s in-use probe — makes the probe pass and then the hard
`DELETE FROM meal_types` fails on `food_logs.meal_type_id → meal_types` (**ON DELETE RESTRICT**),
trading a clean domain error for a **500**. The one-directional test passed. Reverted.

**Three scanners reported wrong numbers.** One found **zero** hits (regex built by string
concatenation inside `node -e`, escaping broken). One undercounted soft-delete filters **86 vs 113**
(matched Drizzle's `isNull` but not raw SQL). One undercounted `z.number()` occurrences **24 vs 28**
(`grep -c` counts *lines*, not matches). **Cross-check every count against a cruder tool** — a
scanner reporting a *smaller* number is as suspect as one reporting zero, and a clean result gets
believed because nothing has to be written up.

**`git checkout -- lib/data/postgres/`** reverted a mutation *and* my uncommitted test additions,
because the test file lives under that path. ~20 min lost, and one set of measurements was silently
taken against the reverted file — reading as "no coverage added". **Commit before every mutation
experiment; scope the revert to exactly what it mutates.**

**`pkill -f "next dev"`** matched the shell running it and killed the command mid-way, silently
skipping a commit. Use `pgrep | xargs kill` on a narrower pattern.

**A red suite right after a code change is not necessarily yours.** One run reported `3 failed | 19
skipped` — the dev server had just been killed and was still releasing pool connections, exactly the
case CLAUDE.md's "stop `pnpm dev` first" note describes. Clean re-run: 372/372.

**`claude_ro` is row-scoped to one user.** An `error_events` read returned **383 rows against a table
holding 7,331**. Every count from that endpoint is *the owner's faults only*. Now warned in
CLAUDE.md's session-start instruction, which showed the query without mentioning it.

**`EXPLAIN` cannot run through `/api/admin/db-query`** — it wraps every query in
`SELECT * FROM (…) _q LIMIT n`. Query-plan diagnosis is not possible with current tooling, on the
layer producing the unexplained production faults.

## Files to look at

- `lib/data/postgres/__tests__/repository-ownership-scoping.test.ts` — 39 tests, all mutation-verified
- `lib/data/postgres/__tests__/repository-soft-delete-filtering.test.ts` — 8 tests, same discipline
- `docs/reviews/2026-08-09-ownership-mutation-coverage.md` — method + all four passes
- `docs/reviews/2026-08-09-soft-delete-mutation-coverage.md` — §6 has the Q-179 reproduction
- `scripts/check-contrast.js` — self-tests before reporting; the chromatic anchor is load-bearing

## Open questions / blockers

- **Q-179 needs a product decision.** Four options; the cheapest (hard-delete orphaned children)
  destroys the sync tombstone — the bug class CLAUDE.md's sync rules exist to prevent.
- **Q-178 needs a product decision.** Add the `deleted_at` filter to the three `mood_logs` reads, or
  drop the column. Depends on whether mood-log deletion is wanted at all.
- **The APK still is not installed.** `"SpeechRecognition" plugin is not implemented on android`
  fired a **fourth** time on 2026-08-08 22:56. 46 rows in `projectOverview.md` carry a
  NOT-verified-on-device marker. Owner action; `apk-latest` is built and published.

## Pickup prompt

```
Work on the TrainingAI repo. Start by reading, in this order:
  1. projectOverview.md — current status and the Known Issues tables
  2. docs/domains/platform/README.md — the platform pillar's code, docs and open issues
  3. docs/handoff-2026-08-09-platform-mutation-testing-invariants.md — the previous session
  4. docs/implementation-backlog.md — the queue, worked top-down per the protocol at its head

Context: the previous session was review-only and merged 10 PRs of tests, CI checks and audits.
It changed almost no application code. It left three queue entries of its own:

  - Q-179 (live, user-facing): deleting your last food log makes the meal type undeletable
    forever. NEEDS A DECISION between four options before any code — the cheapest one destroys
    the sync tombstone. Do not just add the deleted_at filter to the in-use probe: that was tried
    and it fails on the ON DELETE RESTRICT foreign key, turning a clean domain error into a 500.
  - Q-178 (latent): three server reads of mood_logs have no deleted_at filter while the device
    does. Also a decision — add the filter, or drop the column.
  - Q-181 (not urgent): 35 soft-delete filters in periodization.ts / oura.ts / user-stats.ts are
    still unguarded. Copy the shape from
    lib/data/postgres/__tests__/repository-soft-delete-filtering.test.ts.

Hard constraints that will otherwise cost you time:

  - Verify a backlog entry against current main before implementing it. Entries go stale.
  - If you add an ownership or soft-delete test, VERIFY IT BY MUTATION before counting it as
    coverage. Seven assertions in those files could not fail when first written. Rewrite
    eq(x.userId, userId) -> eq(x.userId, x.userId), or isNull(s.X.deletedAt) -> eq(s.X.id, s.X.id)
    and raw `deleted_at IS NULL` -> `1 = 1`, and confirm the test fails.
  - Commit before running any mutation experiment, and scope the revert to exactly the files it
    mutates. `git checkout -- lib/data/postgres/` will also wipe uncommitted tests under that path.
  - Cross-check any scanner count against a cruder grep. Three scanners reported wrong numbers
    last session, including one that found zero.
  - Nothing last session was verified on device. The APK has still not been installed — voice
    logging has now failed four times in production for that reason, and 46 projectOverview rows
    carry a NOT-verified-on-device marker. That is owner action, not yours.
  - Merge policy: feature branch + PR + green CI. Merge a tested, CI-green change without asking,
    except destructive/irreversible ones (data-dropping migrations, auth/session/security, secrets).

First concrete action: read the four docs above, then take the top unblocked item from
docs/implementation-backlog.md and verify its premise against main before writing any code.
```
