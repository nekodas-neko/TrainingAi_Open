# 2026-09-17 — BF-175: one day, one budget (`fix/bf175-assign-step-day-budget`)

**Lane B · v1.457.11**

## What the owner saw

Two screenshots taken in the same minute, with one line of commentary: *"2 different calorie goals
here."* The nutrition card read **1,355 OF 1,506**. The log-food sheet, two taps away, read **Today
after logging 1361 / 1660**.

The intake halves agreed — 1,355 plus the 6 kcal item is 1,361. Only the denominator diverged.

## Why it was not a cache bug

1660 is `nutrition_targets.calories`, which the sheet fetched for itself. That column is the
**rest-day floor**, not `restingBase + targetNet`. It is a different quantity that happens to be
measured in kcal, so no amount of invalidation would ever have closed the gap — the two surfaces
were answering two different questions.

`nutrition-content.tsx:423-441` already carries both the rule and the measurement behind it: three
budgets once appeared on one screen (zone bar 2,180, Home 2,451, ring 2,001), and the comment states
it outright. `home-nutrition-card.tsx:34` repeats it. The sweep that fixed the page did not reach
the sheet that logs into it.

## What shipped

One place resolves the day's budget, and every surface that prints a single day's denominator is
handed it:

- `app/nutrition/nutrition-content.tsx` → `<FoodLoggerSheet dayBudgetKcal={effectiveCalorieGoal}>`
- `components/nutrition/food-logger-sheet.tsx` → threads the prop through
- `components/nutrition/assign-step.tsx` → takes `dayBudgetKcal`; its `nutrition-targets` seed, its
  `cachedFetch`, the local `calorieTarget` state and the `NutritionTargets` import are all gone. The
  numerator, the `/ N kcal` and the green/orange flip read the prop. Null draws nothing.

`budgetProvenance` is deliberately **not** called in the sheet — `energy-card.tsx:50` records why a
second call site is the wrong shape: it becomes an independent number the moment its inputs differ.

## The second surface, which the entry's sweep could not see

The entry asked for a sweep of every `'nutrition-targets'` cache read. That sweep is clean:
`nutrition-content` (resolves the budget), `macro-targets-pane` (Profile, editing the goal itself),
the sync-provider warm list, the `cache-groups` invalidation. Only `assign-step` was misclassified.

But a cache-key sweep cannot see a value passed as a **prop**. Following `targets` down the page
found `EndOfDayReview` → `DaySummaryCard`, printing `eaten / target kcal` for ONE day off the same
stored row — and falling back to a flat `?? 2000` when no goal existed, a number nobody chose
rendered exactly like one they had. It now takes `effectiveTargets` (the earned-scaled value
`energy-card` above it already receives) and hides the ratio and bar entirely when no target is
known.

`WeeklyNutritionChart` was left alone, as the entry instructed: a seven-day reference line has no
single day's earned movement to add.

## The tests, and their controls

Both were run against unfixed `main` before being trusted. This is the fourth session in a row where
that step changed the outcome.

- `e2e/bf175-one-day-budget.spec.ts` — drives the real sheet and reads the figure it prints. The
  fixture forces `nutrition_targets.calories` to `budget + 154` (the owner's own gap), because a
  seeded goal that happened to equal the budget would pass against the unfixed sheet. On `main` it
  fails at the denominator assertion: **printed 1964 against a budget of 1810** — the injected
  offset exactly. The locator is anchored on the sheet's own "Today after logging" row, not the
  first `/ N kcal` on the page, since the card behind the sheet prints one too and reading that one
  would pass against the bug.
- `components/nutrition/__tests__/bf175-day-budget-single-source.test.ts` — pins the shape. **9 of
  its 10 assertions go red on `main`**; the tenth (`budgetProvenance` is not called in the sheet) is
  a forward guard against the obvious wrong fix and is annotated in the file as such, so it is never
  read as evidence.

## Gate

`Ran 75 of 75` Custom Rules · 932 test files / 8,847 tests passed · `tsc --noEmit` and
`tsconfig.tests.json` both clean (no new baseline entries) · `next lint` 0 errors · `pnpm build`
green · e2e spec green on the fix, red on `main`.

## Not exercised

**Device.** The arithmetic is pinned by the e2e, but the green/orange flip at the S25 width — the
half that made the wrong number believable — has not been looked at on the phone. BF-175 therefore
stays in the queue with a `Keep:` line rather than being removed, and carries a Known-Issues row.

Also untouched here: native SQLite / Capacitor paths, safe-area insets, drifted production data
(the local seed is fresh), Samsung WebView rendering.

## Filed, not fixed

`LB-118` (Lane A) — the explain page's `signals` block omits sore-tick provenance, which is what
parks `LB-117`. The LB-117 entry claimed *"the data is there"*; true of the repository, false of the
payload the page renders. The Lane-B-only workaround (`GET /api/mood`) is recorded in both entries
as the **wrong** answer: `next-session` is cached and the check-in can be edited after the score was
computed, so a separate fetch can explain a recommendation with inputs it never used.
