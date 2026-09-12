# 2026-09-12 — BF-150: the daily budget anchors to the goal the owner set

**Branch:** `lane-a/bf150-goal-anchored-budget` · **Agent:** Implementation Lane A

## What the owner asked

*"When is this going to be back to the expected number? The 1350+ excercsise?"* He wants to eat to a
number he chooses, plus whatever movement earns. The app instead computed the number: base 2,196 −
200 goal + 131 earned = **2,127**, while the 1,660 he stored took no part in it.

## What shipped

`budgetProvenance` — the one place the budget is derived, read by Home's nutrition card, Home's
energy-balance card and the Nutrition tab — now uses the **stored calorie target** as the
zero-movement base when one exists. `restingBaseKcal + targetNetKcal` remains the fallback for a
user who has never set a goal. The service carries the stored target onto the balance
(`goalKcal`) so every surface anchors to one number instead of re-deriving it.

## Decisions

- **The goal delta is not applied on top.** He set 1,660 *as* the target he eats to; subtracting the
  deficit again would re-introduce the double-deduction the ⓘ copy already has to explain away.
- **The estimator stays computed and stays visible.** BF-137 and TN-29 are about making it true and
  still need somewhere to show it. What changes is that it no longer sets the number he eats to.
- **The provenance line follows the arithmetic.** On the anchored path there is no
  resting-base-plus-delta split to name, so the line reads *"1,660 your goal + 131 earned from
  movement"*. Printing "base − goal" there would name two numbers that are not addends of what is on
  screen — BF-99's defect wearing the opposite hat.
- **BF-99's source guard was narrowed, not weakened.** It banned *destructuring* `base` from
  `budgetProvenance`, which was a proxy for the defect rather than the defect. The anchored path
  prints `base` legitimately, so the ban is now on the only thing that was ever wrong: that value
  printed beside the word "base". The positive assertion that `restingBase` is still what carries
  the word is kept.

## ⚠ The number is not settled, and the entry contradicts itself about it

**BF-150 prescribes "stored goal + earned" but verifies against ~1,481, and those disagree by 310
kcal/day.** Measured from production 2026-09-12:

| | value | source |
|---|---|---|
| `nutrition_targets.calories` | **1,660** | stored 2026-08-31 |
| `users.calorie_goal` | **1,660** | same |
| `measured_rmr.rmr_kcal` | **1,325** | measured 2026-08-27 |

So the rule as written gives **1,660 + 131 = 1,791** today. The entry's verification line says the
budget should read **~1,481**, which is 1,350 + 131 — the owner's *remembered* figure, not the stored
one. And BF-99's own record has him calling 1,350 *"the 1350 RMR value"*, so his "expected number" is
his **measured resting rate**, not a calorie goal he ever stored.

**This is deliberately not resolved in code.** The rule is structural and identical either way; which
number he eats to is data he owns. What the change does is make that stored number load-bearing, so
setting it to 1,350 makes the budget 1,481. The owner has to say which he wants — the entry's
verification line should not be treated as the acceptance test while it disagrees with the entry's
own rule.

## A claim that needed no code

The entry asks for the macro grams and the calorie budget to share a denominator. They already do:
the stored macros are 150p/141c/55f = **1,659 kcal** against a stored goal of **1,660**. Anchoring
the budget to that goal makes them agree by construction, so the second bullet needed no separate
change — verified by a test rather than assumed.

## Verification

- **Mutation pass — 6 planted defects, 6 killed:** the anchor ignored; the goal delta applied on top
  of the goal; a zero/negative goal treated as real; a non-finite goal treated as real; the service
  no longer passing the stored goal; the legacy `users.calorie_goal` fallback dropped. The equivalent
  control (`typeof` check rewritten as `!= null`) survived.
- **The fifth mutant survived the first pass and is why `lib/__tests__/bf150-budget-anchored-to-stored-goal.test.ts`
  exists.** Every formula test passed with the service's wiring removed — the screen would have shown
  the old number while the unit tests stayed green.
- Driven against `pnpm dev` with the owner's real profile seeded locally: `goalKcal` comes back
  1,660 and anchors the budget; clearing the stored target returns `goalKcal: null` and falls back to
  the old rule.
- Full suite green (8,430 tests) with a `DATABASE_URL`, lint green, `pnpm check:rules` Ran 74 of 74.
  One run failed first on the known `onUserConsoleLog` teardown flake with all 892 files passing; a
  clean re-run confirmed it.

## Not exercised

No device run — this is server-computed and reaches the APK through Railway, but the Home and
Nutrition cards have not been seen rendering the new line on the S25. The provenance wording is the
part a screenshot would catch.
