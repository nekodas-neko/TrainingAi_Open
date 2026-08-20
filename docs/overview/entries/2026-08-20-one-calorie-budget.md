# 2026-08-20 — one calorie budget, and a bar you finish (Q-415, Q-417, Q-323)

**Branch:** `claude/implementation-lane-b-0o7kb9` · **Lane:** Implementation B · **PR:** #TBD ·
**v1.334.0**

## What this closes

Three backlog entries that were one defect wearing three hats, batched as
`calorie-budget-surface` plus Q-323's remaining Lane B half.

**Three calorie budgets were on the owner's screen at the same moment, from the same data.**

| surface | what it computed | 2026-08-19 |
|---|---|---|
| both Energy Balance cards | `restingBase + targetNet + activeKcal` | **2,180** ✅ |
| Home's nutrition donut (Q-415) | `users.calorie_goal + activeEnergyKcalToday` | 2,451 (+271) |
| Nutrition tab's ring (Q-417) | `nutrition_targets.calories + <local activity sum>` | 2,001 (−179) |

The visible consequence was on one card: the ring printed **"Goal reached"** at 2,014 eaten,
because 2,014 clears its 2,001 — while the Energy Balance card two rows above said
*"166 kcal left today"*.

## What shipped

- **`components/nutrition/ring-targets.ts` (new)** — `ringTargets(balance, stored)` resolves the
  Nutrition ring's budget **and** macro grams from `/api/nutrition/energy-balance`
  (`budgetProvenance().total`, `macroTargets.scaled`). 7 tests.
- **`components/home/home-nutrition-card.tsx` (new)** — Home's donut extracted out of the card
  switch and onto the same payload, self-fetching through `useEnergyBalanceToday` exactly as
  `HomeEnergyBalanceCard` beside it does (one cache key, `cachedFetch` de-dupes, `useCachedValue`
  repaints on invalidation).
- **`CalorieZoneBar` → `CalorieProgressBar`** (`components/nutrition/calorie-progress-bar.tsx`,
  arithmetic in `calorie-progress.ts`, 10 tests) — Q-323's second display change. The five-band
  scale with a marker became a progress bar: red → amber → green up to a notch at the goal, then a
  short amber-then-red tail, fill coloured by the band it ends in.
- **Home's ring sweeps to `eaten / budget` with a grey remainder** — Q-323's first display change.
  The centre counts down to `left` and flips to `over`.
- **The Nutrition ring renders `macroTargets.scaled`**, so a 551 kcal day asks for 271 g carbs and
  85 g fat instead of reporting fat over at 68/60.
- **`+N from cardio` → `+N from movement`** — the figure is `computeActiveEnergy`, strength sessions
  and steps included, so on a leg day it credited a leg session to cardio.

## The two decisions worth not re-litigating

**Q-417's fix is not the one the entry proposed.** The entry called for tracking which source last
wrote, so the optimistic local paint could not overwrite an arrived server value. The actual fix is
that the ring stopped computing a budget at all — which removes the race *and* the disagreement in
one move, and deletes the optimistic `activity_logs` read rather than sequencing it.

**No budget beats a wrong budget.** Where there is no derived baseline — an incomplete profile, or
the payload has not arrived — the calorie budget renders as absent rather than falling back to the
stored goal. Substituting the stored goal for a derived baseline *is* the defect; `nutrition_targets.calories`
is the rest-day floor the baseline is built from, not a number to display. The macro grams still fall
back to the stored row, because a macro target is a target rather than something derived from movement.

## What was NOT verified, and why it matters

- **The "earned > 0" path was verified by unit test only.** On `pnpm dev` against `trainingai_dev`,
  `/api/nutrition/energy-balance` returned `activeKcal: 0` with a 60-minute walk **and** 18,000 steps
  seeded for the day, while the same window's food logs resolved correctly (`intakeKcal: 2014`).
  Filed as **LB-4** with the suspected mapper-type mismatch to check first. Everything below the
  `earned = 0` line — budget source, ring sweep, bar layout, scaled macros — is exercised live;
  the subtitle and the scaled grams are not.
- **Nothing rendered in a browser.** The headless login did not complete inside the session.
- **Not verified on device.** Safe-area is untouched, but Samsung's WebView compositor is the known
  hazard for `conic-gradient` rings, and Home's donut now draws a four-stop gradient where it drew
  three. See the Known-Issues row.

## Filed, not fixed

- **LB-2** — `logFoodEntries` awaits `invalidateNutritionWrite()` and only *then* starts
  `pushMutations()`, so the invalidation-driven refetch reaches a server that does not hold the row
  yet and the fresh-but-pre-write answer settles for a full TTL. **This is the measured root cause of
  Q-417(a)** — the 42 kcal gap between two identical Energy Balance cards. The entry guessed a
  missing group member; `energy-balance:` has been in `invalidateNutritionWrite()` all along. Lane A.
- **LB-3** — `barBands`/`barPosition`/`BAR_SCALE_KCAL` now have no callers. Lane A.
- **LB-4** — the local `activeKcal: 0` above.

## Gate

`pnpm check:rules` **Ran 50 of 50** · `npx vitest run` 419 files / 3,744 tests, 0 failing (119 DB
files skipped — no `DATABASE_URL` in that run) · `pnpm build` green · `tsc --noEmit` clean.
