# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The
> title is how five concurrent sessions stay tellable apart; a renamed successor is a lost thread
> even with a perfect baton.

**Updated:** 2026-08-20 · **By:** the seventh Lane B run · **Next ID:** `LB-5`
(`grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority; legacy
`Q-350…386` stay valid where already used)

---

## Now — there is an OPEN, UNMERGED PR on your branch. Deal with it first.

**[PR #265](https://github.com/nekodas-neko/TrainingAi_Open/pull/265)** on `claude/implementation-lane-b-0o7kb9`, **v1.334.0** — Q-415 + Q-417 + Q-323, one calorie budget
across every surface. Full context:
[`docs/handoff-2026-08-20-nutrition-one-calorie-budget.md`](../../handoff-2026-08-20-nutrition-one-calorie-budget.md),
which carries the pickup prompt.

**Every mechanical gate is green** — `tsc`, `pnpm build`, `pnpm check:rules` **Ran 50 of 50**,
`npx vitest run` 419 files / 3,744 tests / 0 failing. **What is missing is the "tested" bar**, and it
is missing for a specific, diagnosable reason rather than because nobody looked:

> On `pnpm dev`, `/api/nutrition/energy-balance` returns **`activeKcal: 0`** for the local today with
> a 60-minute `walk` (`calories_burned = 300`) **and** `body_metrics.steps = 18000` seeded — while the
> **same window's** food logs resolve fine (`intakeKcal: 2014`). So the `earned > 0` half of the work
> — the `+N from movement` subtitle, the scaled macro grams, the earned half of the budget line — is
> covered by unit tests and by nothing else.

**Filed as LB-4. Start at `lib/health/energy-balance-service.ts:131-150`:** `activeEnergyFor(day)`
filters activities with `a.date === day` and reads `metricByDate.get(day)`, both plain **string**
equality against whatever `rowToActivityLog` / `rowToBodyMetric` put in `.date`. A `Date` there makes
both filters miss silently and forever. Production is known to work (the owner's 2026-08-19
screenshots carried a live `551 earned from movement`), so if it is code it is data-shape-dependent.
LB-4 is tagged **Lane A** — hand it over if the fix is in the adapter.

**Then** exercise the four surfaces on `pnpm dev` (`donut total − eaten` must equal the Energy
Balance card's "left" exactly), re-merge `origin/main`, re-confirm green, and merge. It is a display
change on already-shipped features, so no confirmation is needed — but never a stale green.

---

## What this run shipped (2026-08-19 → 20, seventh)

Ten PRs merged, then the calorie-budget batch left open above.

| PR | entry | one line |
|---|---|---|
| #184 | Q-411 + Q-358 | meal-label code painted in **device space** — `ctx.setTransform(1,0,0,1,0,0)` and an integer `cellPx` — so modules stop landing on fractional pixels |
| #192/#199/#203/#209 | Q-359 slices 1–4 | the fetch-once-effect backlog: **can-bite group is now 0**, 12 latent sites across 10 files remain |
| #213/#219/#226 | Q-414 | energy in against energy out on one timeline (`components/health/energy-timeline.ts`) |
| #239 | Q-416 | `centredStackOffset` — the one-ingredient label's 8.6 mm dead band halved and moved above the block |
| #260 | Q-391 | per-session kcal on the day screen's Training card, keyed by `workoutSessionId` |
| **#265 (open)** | Q-415 + Q-417 + Q-323 | one calorie budget everywhere; the zone bar became a progress bar |

**`lib/hooks/use-invalidation-refetch.ts`** came out of the Q-359 work — the escape hatch for reads
`useCachedValue` cannot own (a read that also seeds from local SQLite, wraps its fetch in
`fetchWithRetry`, or sets several pieces of state). It subscribes to the *invalidation*, not to
`ta:oura-ble-synced`, which is strictly wider.

---

## Four things this run learned the hard way

**A guard that cannot fail is not a guard.** I wrote `expect(codeTop).toBe(codeTop)` and caught it
only on re-reading. Mutation-check every assertion: change the thing it guards and watch it go red.

**My own check script over-counted by 10 of 25.** `check-fetch-once-effects.js` was regex-based and
swallowed `useCallback` bodies. Rewritten with brace matching, every phantom hand-verified. A
mechanical count is evidence about the script until you have checked it against the source.

**Reasoning that holds within one source can break across two.** Q-414's first draft weighted HR
buckets by the **sum** of elevation, on the plausible ground that the ring samples more often when
you move. Over 14 days the chest strap logged **26,034** samples to the ring's **3,810**, and it is
worn only during workouts — so summing would hand a strap-worn workout ~100× the energy of an equally
hard ring-only walk. It weights by the **mean** now, pinned by a test in both directions.

**Diff against `origin/main`, never against your own merge commit.** I diffed against `dfbc8fb`,
which already contained the change I was looking for, and it hid that I had raised the square label's
`codeUnits` 70 → 90 — taking its ingredient list from 3 of 8 lines to 1. Square was *already* square
and gained nothing from Q-411. Capped at 76.

---

## Standing context for Lane B

- **Ownership:** `app/**` (except `app/api/**`), `components/**`, `app/globals.css`, `lib/hooks/**`,
  `lib/stores/**`. Reached by `app/api/**` or touching storage → Lane A. `packages/shared/**` is Lane
  A's — **LB-2 and LB-3 both live there; do not take them.**
- **No migration numbers, no local SQLite versions.** Hand any schema need to Lane A.
- **`pnpm check:rules` is the gate.** It reads the step list out of `.github/workflows/ci.yml` and
  prints `Ran N of N`. Quote that count; never a number from memory. It was 50 on 2026-08-20.
- **Arithmetic goes in a `.ts` beside the component, never inside the `.tsx`.** Both vitest projects
  are `environment: 'node'` with no `@testing-library/react`, so anything in a component file cannot
  be unit-tested at all. `energy-timeline.ts`, `calorie-progress.ts`, `ring-targets.ts` and
  `energy-summary.ts` are all this pattern.
- **The tab shell is persistent** — the five tab screens never unmount, and they render their sheets
  unconditionally with null props, so a "sheet" is usually persistent too. Judge a fetch-once effect
  by where it is MOUNTED, not by its filename.
- **`useCachedValue` for any new self-fetching card** (CLAUDE.md rule, from Q-402).
- **`get_check_runs` lags 30+ minutes and job logs 404 for as long.** Attempting the merge is the
  reliable green check. `total_count: 0` several minutes after opening a PR means a **stale base**,
  not slow CI — fetch, merge, push.
- **E2E is not a required check.** Required: Lint, Tests, Build, Custom Rules, Migration Check.
- **`lib/oura-models/constants/*` is gitignored** (public-repo cut), so the vendored MET tables are
  absent from every sandbox.

## Owed to the owner

- **A physical print of the fixed meal label.** Q-416's real acceptance test; the canvas *is* the
  printed artwork and nothing in a sandbox can stand in for paper.
- **The calorie-budget PR on a device.** Home's donut now draws a **four-stop** `conic-gradient`
  where it drew three, and Samsung's WebView compositor is the standing hazard for gradients inside
  card grids. JS-only, so it reaches the device on a Railway deploy — no new APK.
