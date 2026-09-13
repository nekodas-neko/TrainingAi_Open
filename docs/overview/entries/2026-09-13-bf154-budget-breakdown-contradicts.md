# 2026-09-13 — BF-154: the budget's explanation contradicts the budget (BugFix intake)

Docs-only. The owner opened the Nutrition tab the evening BF-152 deployed and sent a screenshot:
*"There is so many numbers here. I thought the base would be above 1350?"*

## The base is right; the sentence under it is not

**1,294 is correct.** BF-152's entry quoted 1,342, computed from the scale's raw 25.5% body fat. The
app uses the DEXA-corrected figure (BF-2) — about 28.7%, so fat-free mass of 50.1 kg rather than 52.3
— and `cunninghamBmr(50.1) − 157` gives 1,294. The measurement, its Cunningham residual and the
calibration are all doing their jobs. Only the number quoted at him came from the uncorrected input,
which is worth recording so the expectation is not refiled as a bug.

What is broken is the line beside it, verbatim from his screen:

> Today's budget is **1,294** — **2,278** resting burn, **−200** for your goal, **+0** moved.

`2,278 − 200 + 0 = 2,078`. The sentence names one number and then decomposes it into terms summing to
another, 784 kcal away.

## It prints the retired formula next to the new number

BF-152 made the budget `restingRate + earned`. `energy-card.tsx:195-201` still renders
`restingBaseKcal`, `targetNetKcal` and `activeKcal` — the addends of the expression that was
replaced — against a `goal` that no longer comes from them.

**BF-150's journal named this exact hazard the day before**: *"printing base − goal there would name
two numbers that are not addends of what is on screen — BF-99's defect wearing the opposite hat."*
The guard it narrowed bans destructuring `base` from `budgetProvenance`. This call site never asks
`budgetProvenance` anything — it reads the balance fields directly — so the guard could not see it.

## The number it prints is the one BF-152 was escaping

On the calibrated path `restingBaseKcal` is `maintenance − avgActive`, carrying the estimator
inflation BF-137 is about. So the card shows **2,278 "resting burn"** ten lines above **1,294
"resting rate"** — 984 kcal apart, both called resting, one of them retired.

## And the macro grams came unmoored

The grams still key off the stored 1,660 goal while the budget is 1,294, so the gap printed on the
card has gone from ~295 to **365**. BF-150's journal had recorded that the two *"already share a
denominator"* — 150p/141c/55f = 1,659 against a stored 1,660. BF-152 separated them and nothing
re-derived the grams. Which anchor the grams should take is a decision rather than a fix;
`macro-budget-gap.ts` says outright that choosing it is not its business.

## Not exercised

Docs only. The contradiction was read off the owner's screenshot and confirmed against the shipped
`energy-card.tsx` and `budgetProvenance`; 1,294 was reproduced by solving `personalRmr` backwards for
the fat-free mass that yields it.
