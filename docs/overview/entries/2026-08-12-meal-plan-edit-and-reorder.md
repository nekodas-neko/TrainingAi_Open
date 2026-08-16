# 2026-08-12 — Tell a meal what to change, and move it earlier or later

**Release:** v1.294.0 · **Domain:** nutrition · **Branch:** `feat/meal-plan-edit-and-reorder`
**Closes:** Q-208, Q-209 — slices B and C of
[`plans/2026-08-12-meal-plan-portions-and-editing.md`](../../superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md).

Two owner asks from S25 testing:

> *"there should be an ai text box or so to try edit the meal"*
> *"there is no option to reorder the food — if I want a certain meal to be earlier or later"*

## Q-208 — the instructed edit

`POST /api/nutrition/meal-plans/generate/meal` gains `instruction` (≤200 chars) and `currentMeal`.
With both present it rewrites rather than regenerates.

**It reuses that route deliberately** rather than adding a sibling: same response schema, same
scaling, same rate limit, and — the load-bearing part — the same allergy handling, where
restrictions are read from the DB and never from the request body.

Two details that would have been wrong done naively:

- **The "be different from the plan" line is suppressed when rewriting.** `avoidNames` exists so a
  reroll does not duplicate a sibling meal; applied to an edit it fights an instruction whose whole
  point is to keep this meal and change one thing.
- **The reroll and the rewrite share one request builder** (`askForMeal`). They differ by two
  optional fields, so building the body twice would have let targets, stores or exclusions drift
  between them.

A rewritten meal clears its `savedMealId` — its ingredients changed, so it is no longer the library
meal it started as.

Measured against the real model: *"make it vegetarian — no chicken"* on a Grilled Chicken and Quinoa
Power Bowl returned **Grilled Halloumi and Quinoa Power Bowl** — chicken swapped for halloumi and
chickpeas, quinoa and olive oil kept, carbs landing exactly on 70 g.

That same run is a good illustration of what is still missing: protein came back **31.8 g against a
45 g target**, because vegetarian protein sources are less dense and the portion clamp stops at
2.5×. The gap is displayed, not hidden — closing it is Q-210.

## Q-209 — reordering re-splits the day

`PATCH .../[id]/structure` gains `order`: the old positions listed in their new order. Up/down
buttons on each meal in the edit sheet.

**Reordering lives in the structure route because moving a meal is not a relabel.**
`splitMacrosAcrossMeals` weights carbs toward the meals bracketing training and fat away from the
pre-workout one, so a meal that moves gets a *different target*. Any "swap the two names" shortcut
would leave the numbers behind. Verified against a real plan: reordering `[2, 0, 1]` moved the
post-training meal to 07:00 and its carb target went **57 g → 38 g**, which is slot 0's share.

The route rejects anything that is not a permutation of the existing slots (400) — a duplicate entry
would clone one meal and silently drop another.

**Buttons, not drag.** 1–6 items on a 6.9" screen, and drag-reorder in this codebase has a
documented history of WebView trouble (persist synchronously in the handler, `onDragOver` not
`onDragEnd`, gesture capture fighting the scroll container). None of that applies to two 44px
buttons.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **451 files / 3,717 tests green** (6 new).

Exercised live on `pnpm dev` against a real plan and the real model: the vegetarian rewrite above,
the `[2, 0, 1]` reorder with its carb re-split, and the malformed order `[0, 0, 1]` correctly
refused with 400.

The new tests pin the permutation rule and the reason the re-split is necessary — that slots
genuinely carry different carb shares, and that the day still sums exactly whatever the arrangement.

## Not exercised

- **Not verified on device.** No local-store path here (both are server round-trips), but the sheet
  layout, the new 44px controls and their safe-area clearance are unverified on the S25.
- No migration, no schema change, no sync-path change.
