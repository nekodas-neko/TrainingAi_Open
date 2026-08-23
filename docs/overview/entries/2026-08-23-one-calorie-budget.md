# 2026-08-23 — one calorie budget, on both surfaces (Q-415 / Q-417, and Q-323's render half)

**Branch:** `fix/calorie-budget-surface` · **Lane B** · v1.335.0

## What was wrong

Three calorie budgets were live on one screen, from the same data:

| surface | expression | value |
|---|---|---|
| zone bar (both Energy Balance cards) | `restingBase + targetNet + activeKcal` | **2,180** ✅ |
| Home nutrition donut | `calorieGoal + activeEnergyKcalToday` | **2,451** (+271) |
| Nutrition tab ring | `targets.calories + burnedForSelectedDate` | **2,001** (−179) |

The visible consequence sat on one card: the ring printed **"Goal reached"** against 2,014 eaten,
because 2,014 clears its 2,001 — while the Energy Balance card two rows above said *"166 kcal left
today"*.

Both wrong figures were the **same** mistake in two places: `nutrition_targets.calories` is the
**rest-day floor**, not `restingBase + targetNet`, so adding movement to it produces a quantity that
matches nothing else. The ring was additionally 179 low because `activeEnergyKcalToday` was painted
optimistically from the local store ahead of the `body-metadata` fetch, with **nothing sequencing
the two** — and the local sum sees no strength sessions, no steps, and a Guided Walk writes
`caloriesBurned: null` (Q-96).

## What shipped

Both surfaces now read `budgetProvenance(balance).total` — the same function the provenance line
under the bar uses, so the number and the sentence explaining it cannot disagree.

| file | change |
|---|---|
| `components/home/home-nutrition-card.tsx` | **new.** Split out of the card switch so it can hold `useEnergyBalanceToday()`; a hook cannot live in a `switch` branch |
| `components/home/home-card-widget.tsx` | −53 lines; the donut branch is now one element |
| `app/nutrition/nutrition-content.tsx` | budget and macro grams both from the payload; the optimistic burn paint **deleted** |
| `components/nutrition/macro-ring.tsx` | `calsBurnedToday` → `earnedKcal`; "from cardio" → "from movement" |
| `app/session-select/session-select-content.tsx` | `activeEnergyKcalToday` removed — nothing reads it now |
| `e2e/one-calorie-budget.spec.ts` | **new.** Three cases |

**Q-417's suggested fix was "track which source last wrote".** Reading the budget from the payload
was better: `activeEnergyKcalToday` then has no consumer on either screen, so the optimistic paint
and its unsequenced race were **deleted** rather than ordered. A race you removed cannot be lost
again by a later edit.

**Q-323's render half rode along** — the ring shows `macroTargets.scaled`, which the server has
returned since #218 and nothing was reading. With 551 earned the card reported fat *over* when it
was well under.

## Verification

Each surface is asserted against **the route's own arithmetic**, never against the other: two
screens agreeing is not the property that matters, and they agreed before Q-401 too, on a wrong
number. The spec also asserts the expected budget **differs from `storedGoal + earned`** before
looking at any pixel, so a revert cannot pass by coincidence.

Mutation-checked, all three reverted expressions caught:

| mutant | result |
|---|---|
| ring budget → `targets.calories + earned` | ✗ failed |
| ring macros → `macroTargets.base` | ✗ failed |
| Home budget → `calorieGoal + activeKcal` | ✗ failed |

**The earned kcal in the fixture comes from a heart-rate session, not a logged walk.** The MET table
is a vendored constant this sandbox serves as synthetic fixtures, so an activity estimates to 0 here
and `earned` would be 0 — under which the old and new expressions differ only by the base and the
scaled macros equal the stored ones, i.e. two of the three assertions would prove nothing.
`estSessionKcal` prefers its HR estimate (Keytel), which is pure arithmetic over age/weight/sex/bpm.

Gates: `pnpm check:rules` 51 of 51 · 4,496 unit tests · 37 e2e (full suite) · build clean.

## Found on the way, not fixed here

**Q-417 part (a) has a cause, and it is not a missing eviction.** That entry asked whether the write
which logged 42 kcal invalidates `energy-balance:`. It does — `logFoodEntries` awaits
`invalidateNutritionWrite()` — but on the line **before** `pushMutations()`, which is
fire-and-forget. So the eviction lands before the server has the write, every subscriber refetches
the pre-log payload and re-caches it, and nothing invalidates again once the push completes. The
sibling delete path has the opposite, correct shape (`pushMutations(...).then(() => invalidate…)`).

Filed as **LB-4** rather than fixed here: `packages/shared/src/nutrition/log-food.ts` writes the
local store and the outbox, which is Lane A. The proposed fix is to invalidate **twice** — keep the
immediate call, because offline it is the only one that will ever fire, and add one after the push.

## Not verified

**Nothing ran on the S25.** Both changed surfaces are cards in the persistent tab shell, so the
paths that only exist on device — the local store feeding the deleted optimistic paint, and the
Samsung WebView's rendering of the conic-gradient ring the extraction moved — were exercised only in
the web sandbox. The sandbox also cannot produce a MET-based earned figure at all (see above), so
the *activity* contribution to the budget is unexercised end-to-end; only the HR contribution ran.
