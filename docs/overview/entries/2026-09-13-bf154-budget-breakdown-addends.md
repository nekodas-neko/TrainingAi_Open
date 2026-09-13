# BF-154 — the budget's explanation now names the terms it was built from

**Branch:** `lane-a/bf154-budget-breakdown-addends` · **Lane A** · one component, one caller, one
docstring, two test files.

## What was wrong

The sentence under the macro row on Nutrition named the day's budget and then broke it into terms.
Those terms were the addends of the formula BF-152 retired — `restingBaseKcal`, `targetNetKcal`,
`activeKcal` — printed beside a budget the new formula produced. The owner's screenshot, the evening
BF-152 deployed: *"Today's budget is 1,294 — 2,278 resting burn, −200 for your goal, +0 moved."*
`2,278 − 200 + 0 = 2,078`. One sentence, naming a number and then contradicting it by 784 kcal.

The second half is the worse half. On the calibrated path `restingBaseKcal` is
`maintenance − avgActive`, which carries the estimator inflation BF-152 moved away from — so the card
printed **2,278 labelled "resting burn"** ten lines above the zone bar's **1,294 labelled "resting
rate"**. Two figures 984 apart, both named resting, one of them a number the app has stopped using.

## Why the existing guard did not catch it

`base-label-reconciles.test.ts` reads `calorie-zone-bar.tsx` and nothing else, and bans one
destructured value beside one word. This call site never asked `budgetProvenance` anything — it read
the balance fields off the payload directly — so there was nothing for that guard to match, on a file
it was not looking at. BF-150's own journal entry had already named this shape in the abstract
(*"printing base − goal there would name two numbers that are not addends of what is on screen"*);
what was missing was a check that could see a second surface.

## What shipped

`EnergyCard` gains `baseKcal` and `baseIsRestingRate`, passed down from the `budgetProvenance` call
`nutrition-content.tsx` already makes. **Deliberately not a `budgetProvenance` call inside the
card** — that file's whole discipline is that it derives no number, and three prior findings put it
there (Q-401's two budgets 274 apart, Q-417's third budget from a locally-composed sum, Q-323's
unscaled macro ring). A fourth computation of the same quantity is the thing the discipline exists to
prevent, so the values arrive as scalars beside the `earnedKcal` prop that was already doing this.

The sentence now branches the way the zone bar does: the resting rate on the anchored path, resting
burn plus a named goal delta on the unanchored one, then the earned term. It sums to the budget it
names on both.

**One judgment call, made rather than asked.** With nothing earned the budget *is* the base, and the
first cut printed *"1,815 — 1,815 resting rate"* — the same figure twice, three words apart, in a
sentence whose report opened *"There is so many numbers here."* That case now reads *"your resting
rate"* without repeating the number. Cheap to reverse; it is one ternary.

**Not done, deliberately:** the macro grams still key off the stored goal while the budget follows
the resting rate, so the printed gap moved from ~295 to ~365 and does not close. Whether the grams
should follow the anchor is a change to what the user is told to eat, and it belongs to whoever owns
the target rather than to the card that prints the difference. `macro-budget-gap.ts` — whose
docstring stated the retired formula as fact and now does not — says so where the next reader will
find it.

## Verification

| check | result |
|---|---|
| Mutation — retired addends restored | **killed** (3 assertions) |
| Mutation — anchored base labelled "resting burn" | **killed** (3) |
| Mutation — goal delta dropped on the unanchored path | **killed** |
| Mutation — `budgetProvenance` recomputed inside the card | **killed** |
| Control — `budget?.base ?? null` → `budget ? budget.base : null` | **survived**, as it should |

Driven through the real page with Playwright, both branches, numbers parsed out of the rendered
sentence rather than matched against an expected string:

- no movement → *"Today's budget is 1,815 — your resting rate, nothing moved yet."*
- with movement → *"Today's budget is 2,529 — 1,815 resting rate, +714 moved."* → `1,815 + 714 = 2,529`

**The spec was run against the defect before being run against the fix**, which is the only thing
that makes it evidence: with the old card restored it failed with *"Today's budget is 1,815 — 2,069
resting burn, +300 for your goal, +0 moved"* — `2,369` against a named `1,815`, the same class as the
owner's 784 and reproduced on a fixture.

Gate: `pnpm check:rules` 74 of 74 · full suite by real exit code · lint 0 errors · `tsc --noEmit`
clean.

**Not exercised:** no device or APK run — this is a WebView-delivered JS change, so it reaches the
phone on the next Railway deploy with no rebuild, but the sentence has not been read on the S25 at
412 dp. The owner's own check is one look at the Nutrition tab: the terms beside the budget must add
up to it, and no figure labelled *resting* may appear twice with different values.
