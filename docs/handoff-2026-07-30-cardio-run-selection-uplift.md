# Handoff — 2026-07-30 · Cardio run-selection uplift (bests, daily zone view, choose-your-run carousel)

_Domain: `cardio` · Branch: `claude/running-walk-features-cko1p3` · PR: [#942](https://github.com/nekodas-neko/TrainingAI/pull/942), open, CI running_

> **Read first:** `projectOverview.md` (status + the four Known-Issues entries this session added,
> newest first, tagged `[cardio]`), then `docs/domains/cardio/README.md`, then this file. This
> covers only what *this* session did and what it leaves behind — not the whole cardio redesign
> (that's `docs/superpowers/specs/2026-07-26-cardio-system-spec.md`, closed, and
> `docs/handoff-2026-07-30-cardio-guided-walk-uplift.md` for the separate guided-walk uplift line
> of work this session also merged, PR #906).

## Goal

The owner asked for a set of running/walk improvements (daily zone view, relocated time-picker,
running baseline stats, a better active-run screen, a fix for the skip dead-end). Before writing
any of it, discovered the full cardio redesign already existed as a closed spec and was already
~90% shipped across sessions since 2026-07-26 — so the actual work became a **gap sweep** against
that spec, not a new design pass, followed by two rounds of refinement the owner asked for after
seeing the first result: a real "choose your run" flow on skip, and a carousel-style picker with a
zone-gap-aware recommendation.

## Current status

- Build/test: `tsc --noEmit` clean, `eslint` 0 errors (119 pre-existing warnings, unchanged),
  `check-reconcile.js`/`check-push-mutations.js`/`check-doc-links.js` all clean, full vitest suite
  2569 passing (1 failure was my own `unset DATABASE_URL` in the test shell, confirmed passes in
  isolation with it restored — not a real regression).
- Dev-server: run live against the seeded local Postgres for every round, via Playwright
  (session-cookie auth, S25-width viewport) — created real plans, seeded a real `activity_logs` row
  with `bestEfforts` data, drove `/running` and `/cardio` end to end including full page reloads.
  Test data cleaned up from the local DB after each round.
- Device-verified: **no.** Nothing here touches native/Capacitor code, so the risk is low, but the
  new `LeaveActivityDialog` guard's actual hardware-back/gesture behavior is unverified — same
  caveat every other back-button guard in this codebase carries (see `projectOverview.md`'s
  `[cardio]` entries for the exact wording already recorded there).
- PR #942 is open; CI was still starting when this doc was written. Standing instructions say
  merge without asking once green (non-destructive, no auth/migration/secrets involved) — if CI is
  green and the PR is not yet merged when you pick this up, that's the next action, not a redesign.

## What shipped (4 commits on `claude/running-walk-features-cko1p3`, all in PR #942)

**Commit 1 — cardio-screen gaps:**
- `components/running/running-bests-card.tsx` + `app/api/running-bests/route.ts` +
  `lib/health/cardio-trends.ts`'s `computeRunningBests()` — all-time best 1K/5K/pace/longest run
  on `/running`, from `activity_logs.bestEfforts` data that was already computed, never rendered.
- `app/api/cardio-week/route.ts` + `components/cardio/zone-quota-card.tsx` — a Today/This week
  toggle on the zone-minutes card (Steps already had one; zone minutes didn't).
- `components/running/running-plan-content.tsx` — "Back to Cardio" button on the skip dead-end.
- `lib/stores/activity-store.ts` (`isActivityActive`) + `components/activity/leave-activity-dialog.tsx`
  + `components/mobile-auth-handler.tsx` + `components/shell/bottom-nav.tsx` — leave-confirmation
  guard on `/activity`, mirroring the existing `isGuidedWalkActive`/`LeaveWalkDialog` pattern.

**Commit 2 — choose-your-run + plan setup default:**
- `lib/running/prescription.ts` (`prescribeOverride`) + `lib/running/assemble-plan-context.ts`
  (new — extracted `assembleInputs`/`resolveSnapshot`/`resolvePushContext` out of
  `app/api/running-plan/route.ts` so the new override route can reuse them) +
  `app/api/running-plan/override/route.ts` (new) — pick a different run type/duration for today;
  still runs through the full recovery-gate safety pipeline, never bypasses it.
- `components/running/plan-setup-sheet.tsx` — default session length always asked, not just in
  "fixed time" mode.
- `components/cardio/modality-picker.tsx` — hub's "How much time do you have?" hidden once a plan
  exists.
- **Bug fix**: `GET /api/running-plan` always recomputed the prescription from the framework, so a
  reload right after an override reverted it. Fixed by checking whether today's persisted row's
  `rationale` starts with `OVERRIDE_RATIONALE_PREFIX` (`lib/running/prescription.ts`) and, if so,
  building the response from that row instead of recomputing — no schema migration needed.
- **Bug fix**: a slow initial `refresh()` GET could resolve after a faster override POST and
  clobber it — fixed with `requestSeqRef`, a monotonic counter in
  `running-plan-content.tsx` that drops any response whose request isn't the latest one fired.

**Commit 3 — carousel + zone-gap recommendation:**
- `components/running/run-type-carousel.tsx` (replaces the deleted `run-type-picker.tsx`) — built
  on the existing `components/ui/swipe-carousel.tsx` primitive, mirrors
  `app/workout-select/workout-select-content.tsx`'s session carousel shape (dot indicators, a
  "Recommended" badge whose dot stays distinct even off-screen, seeds to the *current* prescription
  on load — not the recommendation, so first paint matches the card below it).
- `lib/running/recommend-run-type.ts` (new, 5 unit tests in `lib/running/__tests__/`) —
  deterministic: sums each run type's open remaining zone-minutes (from the same `ZoneQuota` the
  hub shows) across the zones it predominantly fills, picks the highest score. Z1 never drives it
  (spec D-10 — passive fill, not trainable-toward). Returns `null` once every training zone is
  complete/not-required.
- **Bug fix (a second, subtler staleness bug)**: even with commit 2's fix, a reload could still
  revert — this time because `GET /api/running-plan`'s `Cache-Control: max-age=60` let the
  **browser's own HTTP cache** serve a stale response, invisible to and uninvalidated by the app's
  own `invalidateRunningPlan()` cache-group system. Fixed: that route now sends `no-store`. The
  override POST route's header was aligned too (though POST responses aren't browser-cached
  regardless).

**Commit 4 — import-path fixes:**
- Mid-session, `main` picked up an unrelated `packages/shared` pnpm-workspace restructuring
  (`lib/date-utils.ts`, `lib/utils.ts`, and others moved to `packages/shared/src/`, imported as
  `@trainingai/shared/*`). Rebasing through it required resolving real conflicts in
  `running-plan-content.tsx` and `app/api/running-plan/route.ts` (both touched by both sides), plus
  a manual sweep of every NEW file this session wrote for stale `@/lib/date-utils` imports (3
  found: `app/api/running-bests/route.ts`, `app/api/running-plan/override/route.ts`,
  `lib/running/assemble-plan-context.ts` — `tsc` didn't catch these because `tsconfig.json`'s path
  alias resolves them at compile time regardless; `vitest`/Node's real resolution didn't). Also had
  to run `pnpm install` — the workspace package was declared in `pnpm-workspace.yaml` but never
  actually linked into `node_modules`, which is a **pre-existing gap from whoever landed that
  workspace move**, not something this session broke, but it silently broke `vitest` for anyone
  who rebases onto that commit without reinstalling.

## Deliberately NOT done

- **D-14's optional "beat-your-last" walk distance goal.** It's a closed spec decision, but was
  never actually wired into `components/guided-walk/walk-config.tsx`/`walk-active.tsx` (grepped,
  no match). Surfaced as a side effect of a clarifying question about guided-walk progression during
  this session, not something the owner explicitly asked to build — flagged in `projectOverview.md`
  instead of built.
- **Any change to guided walk's own progression.** Per the closed spec (D-1 revised, D-14), walks
  deliberately do not progress — they're a metric contributor to the weekly quota, not their own
  program. This session's carousel/recommendation work is running-only by design.
- **A sweep of other routes for the same browser-HTTP-cache bug class.** Commit 3's fix was scoped
  to `/api/running-plan` (the route that actually broke). Flagged in `projectOverview.md` as worth
  a future audit: any route with a `max-age` `Cache-Control` whose data can change multiple times
  within that window via rapid user action (not just occasional writes) is a candidate.

## Key decisions (with rationale)

- **The recommendation is a badge to swipe toward, never an auto-applied choice.** The carousel
  seeds to the *current* prescription's type on load, not the recommended one — so first paint
  never shows a mismatch against the `PrescribedRunCard` below it, and nothing changes server state
  just from opening the screen. Only an actual swipe/dot-tap calls the override endpoint.
- **The recovery gate always re-runs on an override**, via `prescribeOverride()` reusing the exact
  same `applyRecoveryGate`/`retarget` pipeline as the framework's own `prescribeNextRun()`. A
  manual pick for "Interval" can still be downgraded to "easy" if the interference/readiness/
  monotony/sleep checks fire — this was a deliberate design constraint (CLAUDE.md: the deterministic
  engine stays the source of truth for what to do), not an oversight.
- **Distance is dropped (`null`) on every manual override.** A framework-computed "long run"
  prescription carries a distance target from its own weekly-volume logic; a user manually picking
  "Long" via the carousel has no such basis to inherit one. Simpler and more honest than trying to
  guess a distance for a type the user picked outside the framework's own sequencing.
- **`gateReasons` are empty on an overridden day's GET**, by design — they were never persisted
  (only `gateAction` is a column on `prescribed_runs`), and the gate already ran once, during the
  override call itself. The amber "eased off today" *box* still shows correctly (it keys off
  `gateAction`), just without the itemized sentence list, until the row resets (next day or the run
  completes). Flagged in `projectOverview.md`, not silently accepted as unnoticed — a real, small,
  known gap.

## Gotchas / what did NOT work

- **Fixed-timeout Playwright waits gave an inconsistent read on the override-persistence bug.**
  The first attempt (commit 2's fix) looked correct with `waitForTimeout(1200)` between actions,
  then failed intermittently with a longer chain of actions in commit 3's testing. Switched to
  `page.waitForResponse()` keyed on the actual network call — deterministic, and is what actually
  surfaced the second (HTTP-cache) bug that timeout-based waits had been masking/missing.
  **If you're testing anything in this file again, wait on the response, not the clock.**
  `curl`-based "does it persist" checks are *not* sufficient either — curl has no HTTP cache, so it
  never reproduces the browser-cache bug at all; only a real browser round-trip does.
- **`pkill -f "next dev"` was unreliable in this sandbox** — several kill attempts silently didn't
  free port 3000, leaving Next fall back to 3001 on the next `pnpm dev`. If a smoke test's `curl`
  to `localhost:3000` returns something unexpected, check `tail` on the dev-server log for a port
  fallback line before assuming the app is broken.
- **`tsc --noEmit` passing is not proof `vitest` will run** after a workspace/package-path change
  — they resolve modules differently (tsconfig path aliases vs. real Node/pnpm resolution). Run
  both after any import-path-affecting rebase, not just the type-checker.

## Files to look at

- `lib/running/assemble-plan-context.ts` — the extracted signal-assembly shared by both
  `/api/running-plan` and `/api/running-plan/override`; any future recovery-gate signal change
  belongs here, not duplicated in either route.
- `lib/running/recommend-run-type.ts` — the zone-gap recommendation; if the owner ever wants a
  different scoring model (e.g. weighting toward the goal's declared markers instead of raw
  remaining minutes), this is the one function to change.
- `components/running/run-type-carousel.tsx` — the carousel component; the duration stepper lives
  outside the swiped content deliberately, so it composes with whichever type card is showing.
- `app/api/running-plan/route.ts` — read the `OVERRIDE_RATIONALE_PREFIX` check at the top of `GET`
  before touching this route again; it's load-bearing for override persistence, easy to
  accidentally regress by "simplifying" it back to always-recompute.

## Open questions / blockers

- None blocking. PR #942 needs CI to go green, then merges per standing instructions (no
  confirmation needed — non-destructive, no migration/auth/secrets).
- Worth asking the owner eventually (not blocking this PR): does the D-14 "beat-your-last" walk
  goal matter enough to build, now that it's flagged? It was never explicitly requested.

## Pickup prompt

```
Check out claude/running-walk-features-cko1p3 (or, if PR #942 has merged, start a fresh branch
from main instead — a merged PR is finished, never stack new work on it).

Read in order: projectOverview.md (status + the [cardio] Known-Issues entries from 2026-07-30,
newest first), docs/domains/cardio/README.md, then
docs/handoff-2026-07-30-cardio-run-selection-uplift.md (this file).

First action: check PR #942's state (mcp__github__pull_request_read, method=get). If it's still
open, check CI (method=get_check_runs) — if green and mergeable_state is clean, merge it (squash)
without asking, per standing instructions (non-destructive change). If it's already merged,
there's no more work queued from this session — the owner said this is a good stopping point for
run/walk features and wants to return to improving what already exists after this lands, not add
new scope. Do not start new cardio work speculatively; wait for the next explicit ask.

If picking this up because something broke: the two bugs this session fixed (stale prescription on
reload, browser-HTTP-cache staleness) were both found by testing with page.waitForResponse(), not
fixed timeouts or curl — if you suspect a regression in the override flow, test the same way rather
than trusting a curl round-trip (curl has no HTTP cache, so it can't reproduce the second bug class
at all).
```
