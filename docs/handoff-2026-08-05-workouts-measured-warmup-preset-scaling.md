# Handoff — 2026-08-05 · measured warmup carve-out scaled to the chosen duration preset

_Domain: `workouts` · Branch: `fix/measured-warmup-scale-with-preset` · PR: opened this session (see below)_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/workouts/README.md`](domains/workouts/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md) (the queue). This file covers only
> what *this* session did and what it leaves behind.

## Goal

Work the backlog queue top-down. Q-84 (guided-walk cadence) was already open as #1093 at session
start; the ready item after it was Q-83 — the owner picked "Quick" (30 min) on a Push session and
got two exercises, because a learned warmup median was being subtracted whole from a shortened
budget.

## Current status

- **Q-84 / #1093: merged.** Five checks green on a base that was exactly current `main`.
- **Q-83: implemented, verified, committed, PR opened.** Full suite 400 files / 3,165 tests green
  (+2 new). Typecheck clean, lint clean (warnings pre-existing, unrelated files),
  `check-push-mutations` OK.
- **Build/test:** `pnpm dev` run and the changed route exercised authenticated end-to-end, before
  and after, on identical seeded data.
- **Device-verified:** not applicable and not claimed — this is server-side AI-periodization math
  with no native, safe-area, offline-first or WebView surface. JS-only, so it reaches the device
  through a Railway deploy with **no APK rebuild**.

## What shipped

| Change | Where |
|---|---|
| `WARMUP_CEILING_FRACTION = 0.2` and a gated proportional ceiling in `warmupBudgetMin` | `packages/shared/src/workout/duration-model.ts` |
| `standardBudgetMin` threaded through `workingBudgetMin` | same file |
| Call site passes the session's own configured length | `packages/shared/src/ai-periodization/signals.ts:499-503` |
| Two test blocks: cap binding at a shortened budget (incl. the floor/ceiling meeting point), and inertness at/above standard length | `lib/__tests__/duration-model.test.ts` |
| Journal entry | `docs/overview/entries/2026-08-05-measured-warmup-scale-with-preset.md` |
| Q-83 entry removed, **Q-85 filed** | `docs/implementation-backlog.md` |
| v1.266.0 | `package.json`, `packages/shared/src/changelog.ts` |

## Key decisions (with rationale)

- **The ceiling is gated on `totalBudgetMin < standardBudgetMin`, not applied unconditionally.**
  The plan proposed a plain fraction-of-budget cap. That is wrong for a session *genuinely
  configured* at 30 minutes: there a 9-minute measured warmup really is 30% of the session, learned
  at that length, and capping it would under-reserve and make the session overrun. The
  double-charge only exists when a median learned at 60 meets a budget shortened for today. A plain
  fraction cannot tell those apart. **Do not "simplify" this back to an ungated cap.**
- **0.20, not 0.15 or 0.25.** Above `WARMUP_FRACTION` on purpose — warmup does not shrink linearly
  with the working portion (walking to the gym, joint prep, ramp sets cost what they cost), so a
  squeezed session may spend a larger *share*, just not an unbounded one. And
  `0.20 × MIN_PRESET_BUDGET_MIN (20) = MIN_WARMUP_MIN (4)` exactly, so floor and ceiling meet at the
  shortest legal budget and can never invert for anything `budgetForPreset` emits. 0.15 would bind
  at Normal for anyone with a >9 min measured warmup, discarding real measured signal.
- **Q-71 and Q-73 stay skipped as ⛔ blocked**, annotated in the backlog rather than re-derived.

## Deliberately NOT done

- **Rest compression on shortened sessions.** This is the lever that would actually move exercise
  counts, and it trades intensity quality for volume — an owner decision, not a mechanical fix.
  Filed as **Q-85** with the measurements behind it rather than folded in here.
- **No change to the trimmer** (`dropToBudget`) or to the weekly-volume-rebalance gap.

## Gotchas / what did NOT work

- **The seeded dev DB never exercises the measured path.** All 9 completed sessions have
  `warmup_ended_at = NULL` and there is no set-start column feeding the fallback, so
  `buildMeasuredTimeBudget` returns `warmupSec: null` and everything runs on the flat-fraction
  branch. My first probe looked like a clean pass and had simply not touched the changed code. To
  exercise it: `UPDATE workout_sessions SET warmup_ended_at = started_at + interval '9 minutes'
  WHERE user_id='0166533d-0e2e-492e-9bdf-eba901721130' AND completed_at IS NOT NULL` — **and revert
  it to NULL afterwards** (this session did).
- **`tsx` is not installed.** Ad-hoc DB probes have to be written as temporary vitest files. Also
  `PostgresRepository` is not a constructor — the export is `PostgresWorkoutRepository`; use
  `const { getRepository } = await import('@/lib/data')`, which is what the DB tests do.
- **`npx vitest run --project=default` fails** — this repo's vitest config names its projects
  (`unit`, `rollup`), so there is no `default`. Just omit the flag.
- **The prescribe route is stochastic in general but was stable here.** 4/4 identical runs on each
  side of the change; a single `long` run once read 62 min rather than 64 — that is the model
  picking different sets/reps, not the budget path. Verify budget claims with a deterministic
  `aggregateSignals` probe, not the route's estimate, and re-run before believing a one-sample delta.
- **A synthetic five-exercise Push under-sold the fix** (no threshold crossed at +3 min) while the
  real seeded session crossed one. Neither number generalises — the honest claim is the one in the
  journal entry.

## Files to look at

- `packages/shared/src/workout/duration-model.ts` — the two clamps and why they meet where they do.
- `packages/shared/src/workout/time-audit.ts:307-332` — where the measured median is learned, and
  `decomposeSessions` (~line 352) for how `warmupSec` is derived from `warmup_ended_at`.
- `packages/shared/src/ai-periodization/time-budget.ts:306` — `dropToBudget`, the trimmer whose
  thresholds Q-85 is about.

## Open questions / blockers

- **Q-85 needs an owner decision before it can be planned:** should a Quick session prefer fewer
  exercises at full rest, or more exercises at compressed rest? Likely differs by role (main vs
  accessory). Nothing to build until that is answered.
- **Q-71** — the ~5-minute sleep-boundary shift on future-only rollups is still the owner's call.
- **Q-73** — still needs an un-minified hydration error captured on the S25.

## Pickup prompt

```
Work the TrainingAI implementation backlog. Start by reading, in order:
projectOverview.md, docs/domains/workouts/README.md, and docs/implementation-backlog.md.

State of play: PR for branch `fix/measured-warmup-scale-with-preset` (Q-83, v1.266.0) was
opened on 2026-08-05 with CI running. First action: check its check runs via the GitHub MCP
tools (never bash curl to api.github.com — the token there is a non-authenticating
placeholder). If green and its base is still current main, merge it; if red, read the job
logs and fix. If it has already merged, skip to the queue.

Then take the top ready item from docs/implementation-backlog.md. Q-71 and Q-73 are marked
⛔ blocked on the owner and must be skipped, not worked. Q-85 (rest compression on shortened
sessions) is filed but is NOT ready — it needs an owner decision on whether a Quick session
should prefer fewer exercises at full rest or more at compressed rest; do not start building
it without that answer.

Constraints worth knowing before you start:
- Everything reaches main through a PR; direct pushes are blocked. Cut branches from a
  freshly-fetched main, and re-merge main immediately before opening each PR — in a session
  that lands several PRs, a base that was current when you branched goes stale. The tell is
  get_check_runs returning total_count: 0 several minutes after opening; that is a stale base,
  not slow CI.
- A tested, CI-green, non-destructive PR merges without asking. Fold the journal entry (a new
  file in docs/overview/entries/), the projectOverview.md update, the backlog removal and the
  version/changelog bump into that same PR, before it merges.
- The local seeded DB does not exercise the AI time-budget measured-warmup path: all completed
  sessions have warmup_ended_at NULL. Seed it and revert it if you touch that code — see
  docs/handoff-2026-08-05-workouts-measured-warmup-preset-scaling.md for the exact SQL and
  several other sandbox traps (no tsx, no --project=default, PostgresWorkoutRepository).
- Server/JS changes reach the device via a Railway deploy with no APK rebuild; only android/**,
  capacitor.config.ts and dependency changes need a new APK.
```
