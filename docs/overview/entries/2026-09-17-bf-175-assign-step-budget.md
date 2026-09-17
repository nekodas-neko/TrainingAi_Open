# 2026-09-17 — two calorie goals on one screen, and the rule against it was already written down

**BugFix intake.** Docs-only. Owner, with two screenshots timestamped the same minute: *"2 different
calorie goals here"*. Filed as **BF-175**.

## What he saw

| surface | shows | source |
|---|---|---|
| Nutrition card | `1,355 OF 1,506` · *"1,291 resting rate + 215 earned from movement"* | `budgetProvenance(balance).total` |
| Assign-to-Meal sheet | `Today after logging 1361 / 1660` | `nutrition_targets.calories`, raw |

`nutrition_targets.calories` reads **1660** in production. The intake halves agree — 1355 plus the
6 kcal item is 1361 — so only the denominator diverges, by 154 kcal.

## Why it matters more than a cosmetic mismatch

`assign-step.tsx:159-163` colours its bar green under target and orange over, against 1660. So the
sheet paints a full green bar and implies headroom while the card two taps away says **151 kcal
left**. The wrong number is the one attached to the decision he is making at that moment — whether
to log the food.

## The part worth recording

**This is a missed surface of a bug that was already found, measured and fixed**, not a new one.
`nutrition-content.tsx:423-441` carries both the fix and the evidence: three budgets once appeared
on one screen (zone bar 2,180, Home 2,451, ring 2,001), and the comment states the rule outright —
*"`nutrition_targets.calories` is the rest-day floor, not `restingBase + targetNet`"*.
`home-nutrition-card.tsx:34` repeats it. Two comments state the rule; the sheet that logs food into
that page never got the sweep.

The repo's own sibling-surface rule is the one that would have caught it: *"when fixing a pattern on
one surface, grep for every other surface handling the same domain and update them in the same PR"*.

## Checked and cleared

`WeeklyNutritionChart` also takes `targets?.calories`, and that is correct — a seven-day reference
line has no single day's earned movement to add, which is the same reason `effectiveCalorieGoal`
falls back to the stored goal rather than composing an addend. Written into the entry so it is not
"fixed" into a fourth number.

## What was not exercised

Nothing on the S25. The numbers were traced in source and confirmed against production rows; the
bar-colour flip at the S25 width is still owed a device look, and the entry says so.
