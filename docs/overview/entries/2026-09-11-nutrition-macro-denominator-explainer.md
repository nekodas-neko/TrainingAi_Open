# 2026-09-11 — the gap explainer says the wrong thing, and the base is still climbing (BF-142)

Third owner report in the same family — *"calories still not right"* — this time against the
Nutrition card with BF-134's explainer paragraph already shipped on it. Docs-only intake; no code
changed.

## The sentence is false, and its own module says so

`nutrition_targets` holds **1,660 kcal · 150 P / 141 C / 55 F**, written 2026-08-31. The card renders
**150 P / 185 C / 72 F = 1,988 kcal** — carbs and fat at 1.31× their stored values, protein alone
untouched. `energy-card.tsx:27-29` documents the prop as Q-323's *earned-scaled* macro grams; the
sentence at `:181-183` tells the owner the grams come from his stored daily goal, four lines below
the comment saying they do not.

The reason it offers is worse than the mislabel. `macro-budget-gap.ts:8-9` states that both numbers
carry the same `earned`, so it cancels — movement cannot be what separates them. The card explains
the gap as grams-from-goal versus a budget including today's movement, so a reader who believes it
expects the gap to close as he moves. It never does, which is the one thing the paragraph exists to
say.

The arithmetic underneath is right: `storedGoal − (restingBase + goalDelta)` gives
`1,660 − (2,150 − 200) = −290` against the printed −295, with gram rounding covering the difference.
Only the words are wrong, which keeps the fix in Lane B.

One thing the fix must not inherit: the docstring pins the gap at "406 kcal, at every hour of every
day", grams *above* budget. The card prints 295 *below* — the sign flipped, so the two do not differ
by 111. Reading the docstring's own formula backwards for the base gives 1,454 then and 2,155 now
against the card's 2,150: **the resting base has risen ~700 kcal**. 1,454 sits just under the 1,527
BMR, which is what a resting base with the step credit removed should look like, so the estimator
did not start wrong — it inflated.

## A cleaner proof that BF-137 is live

BF-137 argues the calibrated maintenance is fitting a drug-driven weight drop, and rests that
argument on a weight trend — the confounded signal, so it invites "your window is wrong". This does
not. The owner is **158 cm**, 69.95 kg, 33, male: Mifflin-St Jeor BMR is **1,527 kcal**. The card
calls **2,150** his *resting* burn — 1.41 × BMR, 623 above it. Nothing resting is 1.41 × BMR. Because
`restingBase = maintenanceKcal − avgActiveKcal` on the calibrated path, an inflated maintenance
surfaces in a field labelled resting, and measured movement is added on top of a number already
holding a day of it.

The height is what settles it, and it is the easy thing to get wrong: at 158 cm his BMR sits ~130
kcal below a 178 cm man of the same mass, so reasoning from weight alone understates the overshoot.
Recorded on BF-137 as well as BF-142.

## What the owner is reacting to

He set 1,660 on 2026-08-31. The card offers 2,283, prints 1,988 of macros beside it, and marks 1,331
eaten as "Well under so far" in red. None of the three numbers on the card is the one he chose.
Three reports of "the calories are wrong" are that, rather than three separate arithmetic faults.

## Not exercised

No code changed and nothing was run against the app. Every figure above is from the read-only
production query endpoint or direct source read. BF-142 carries `Verify: owner` — whether the
replacement sentence reads as true is his judgement, not a test's.

## A field error of my own, caught by the owner

BF-139, BF-140, BF-141 and BF-142 were all filed with a `Verify:` line. That field means *shipped,
awaiting a look* — `next-item.js` prints it under VERIFY and the entry never reaches READY. Four
unbuilt entries were therefore filed as finished work, and the owner found it the way you would
expect: both lanes reported nothing to start.

The backlog protocol says this outright — *"A device requirement on unbuilt work is a **Verification**
line, not a gate"* — and records the same class hiding the whole `nutrition-ui-uplift` batch, then
recurring in LB-26 the same day, by a session that had read the warning. This is that mistake again
in the `Verify:` field rather than `Gate:`.

All four are converted to prose `Verification:` lines stating what the check actually is. Lane B now
reads READY (2) with BF-139 and BF-142; Lane A reads READY (14) with BF-140 and BF-141 at the top.
