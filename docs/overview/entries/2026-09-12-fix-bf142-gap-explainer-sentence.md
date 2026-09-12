# 2026-09-12 — The gap explainer stops giving a reason its own module rules out (BF-142)

**PR:** `fix/bf142-gap-explainer-sentence` · **Lane B** · `components/nutrition/energy-card.tsx`,
`components/nutrition/macro-budget-gap.ts`, `app/nutrition/nutrition-content.tsx`,
`components/nutrition/__tests__/macro-budget-gap.test.ts`.

Owner, third report in this family: *"calories still not right"*.

## The words were wrong, not the arithmetic

The card printed: *"The grams come from your stored daily goal; the budget is built from your
resting burn, your goal adjustment, and the movement recorded today."*

Both halves were false in a way the file already knew about.

**The grams were not the stored goal.** `energy-card.tsx` documents that prop four lines above as
*"the **effective** targets ... Q-323's earned-scaled macro grams"*. Measured: `nutrition_targets`
holds 150 P / 141 C / 55 F; the card rendered 150 / 185 / 72 — carbs and fat at **1.31×**.

**And movement cannot be what separates the two numbers.** `macro-budget-gap.ts` says so in its own
docstring: *"Both addends carry the same `earned`, so it cancels."* A reader who believed the card
waits for a gap that never closes — which is the one thing that paragraph exists to say.

The printed numbers checked out to the kcal: `1,660 − (2,150 − 200) = −290` against a printed −295,
gram rounding covering the 5. So this was a sentence, not a recalculation.

## What it says now

Rendered against the seeded account:

> Macro targets add up to **1,900 kcal** — 463 below the calorie budget. Your stored goal is
> **1,900**. Today's budget is **2,363** — 2,063 resting burn, +300 for your goal, +0 moved. The
> grams are that goal scaled up by the same movement, so moving more raises both numbers and the gap
> stays.

Every number is named, the stored goal sits beside the computed one, and the last clause says
outright that moving will not close the gap. The card gained one prop — `storedGoalCalories`, printed
and never computed with. Resting burn, goal delta and earned all come from the balance it already
received.

**Two fixes the entry ruled out in advance and this did not take:** re-labelling the grams as
earned-scaled and stopping (true, and still leaves the reader two numbers and no guidance), and
closing the gap by scaling the stored goal up to the budget (which would raise what he eats to a
maintenance figure that is ~600 kcal too high).

## The docstring's own constant was stale, and inverting it recovered a real finding

It pinned the gap at *"406 kcal on the owner's account, at every hour of every day"*. On 2026-09-11
the card printed **295 the other way**. The sign had flipped, so the two do not differ by 111 — read
the formula backwards for the base and it gives **1,454 then** against **~2,155 now**. The resting
base has risen **~700 kcal**.

1,454 was sane: just under the 1,527 Mifflin BMR, which is what a resting base with the step credit
taken out should look like. This did not start wrong; it inflated. The module no longer restates the
number, and a test fails any attempt to re-pin it as current fact.

**That corroborates BF-137 from a direction that entry does not use.** BF-137 rests on a weight
trend, which is the confounded signal. This does not: the owner is 158 cm, 69.95 kg, 33, male, so
Mifflin BMR is 1,527 and the card calls 2,150 his *resting* burn — **1.41 × BMR**. No resting figure
is 1.41 × BMR; that is a fully active TDEE. The height is what makes it conclusive, and it is easy to
miss from the weight alone: at 158 cm his BMR is ~130 kcal below a 178 cm man of the same mass.
**Left with BF-137 and Lane A** — this PR fixed the sentence, not the base.

## Verification

A **source guard**, not a render assertion, because the defect was the words: the retracted claims
(*"grams come from your stored daily goal"*, *"the movement recorded today"*) cannot come back, the
stored goal must be named, and no gap figure may be hardcoded. Three mutations were run — restoring
the false sentence, dropping the stored-goal clause, re-pinning 406 — and each was caught. The
existing non-convergence test is kept: it is the assertion the wrong sentence contradicted.

The replacement was rendered in the Playwright harness against real data to confirm the arithmetic
prints (2,063 + 300 + 0 = 2,363), then the probe was deleted rather than kept as a spec — it asserts
a sentence that is meant to be reworded if it still reads wrong.

Full unit suite **7,189 passed / 8,458**; `pnpm check:rules` **Ran 73 of 73**; production build
clean; lint clean in every touched file.

**Not exercised:** the owner's own account. Every figure above was measured from it on 2026-09-11,
but the seeded account's numbers are different, so what the harness proves is that the sentence
renders and its parts add up — not that it reads true to the person it is for. He is the check.
