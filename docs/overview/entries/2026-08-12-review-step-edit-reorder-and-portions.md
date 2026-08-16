# 2026-08-12 — Reorder and edit while building the plan, and portions that stop colliding with servings

**Release:** v1.298.0 · **Domain:** nutrition · **Branch:** `feat/review-step-edit-and-reorder`

Three owner reports from the S25, all against work that had shipped hours earlier.

## The first two were the same mistake

> *"cant move meals around to re-order in meal plan"*
> *"no AI text box under the meals for editing/changing of plan"*

Both **were** built — in `meal-plan-edit-sheet.tsx`, the editor for a plan you have already saved.
The screenshots were the **setup flow's review step** (`meal-plan-review-step.tsx`, "Check this
over", step 7 of 7), which is where you first meet the meals and the natural place to change them.
Adding a control to one of two screens that show the same thing is a half-done job, and the
sibling-surface rule in CLAUDE.md exists precisely for this.

**Reordering a draft cannot use the server route.** The saved-plan editor PATCHes
`.../[id]/structure`, which re-splits and re-scales. A draft has no id — it does not exist in the
database yet — so `reorderDraft()` does the same work in memory.

The load-bearing rule is the same on both sides: **targets belong to the slot and the food moves
between slots.** `splitMacrosAcrossMeals` weights carbs toward the meals bracketing training and fat
away from the pre-workout meal, so a swap-the-names shortcut would silently re-target both meals.
Eight tests pin it, including the decisive one: a meal moved from a 90 g carb slot into a 40 g slot
comes out with its rice **shrunk**, its new slot's time, and the `pre_workout` role left behind.

The instruction box reuses the review step's existing request builder, the same way the edit sheet
does — one body, two optional fields, so targets and exclusions cannot drift between a reroll and a
rewrite.

## The third was a word collision

> *"serving ui is a little confusing"*

Two different things were both called a serving, stacked on one screen:

- the **meal**'s batch size — "Makes 2 servings"
- each **ingredient**'s quantity unit — "2 srv", "1 serving = 30 g"

So "Whey Protein Isolate, 2 srv, 1 serving = 30 g, 60 g total" sat under "Makes 2 servings", and
nothing said whether 60 g was the batch or the portion.

They are now different words. A recipe makes **portions**; a food is measured in **servings** of
itself:

- `THIS RECIPE MAKES 2 portions`
- `1 serving of Rice cakes = 100 g · using 200 g`
- the totals box shows **`WHOLE BATCH · 2 PORTIONS`** and **`ONE PORTION — WHAT GETS LOGGED`** as two
  labelled rows, so the number that gets written is never inferred.

The card carries the same wording, since it is the other place the two meanings met.

## Verification

`tsc` clean · 0 lint errors · 17/17 custom checks · **454 files / 3,741 tests green** (8 new).

The portions UI was read back out of the running app rather than eyeballed:
`THIS RECIPE MAKES 2 portions` → `Enter the ingredients for the whole batch below … takes one
portion — 387 kcal of the 774 below` → `WHOLE BATCH · 2 PORTIONS 774 kcal` → `ONE PORTION — WHAT
GETS LOGGED 387 kcal`.

One run of the suite failed a single test and passed on re-run after `DELETE FROM rate_limits` —
the documented local-DB poisoning from repeated suite runs, not a real failure.

## Not exercised

- **Not verified on device**, and the review step specifically was not driven end-to-end here: it
  needs a full plan generation to reach, so the reorder and instruction controls are covered by unit
  tests and by the identical code already shipped on the saved-plan editor, not by clicking through
  the setup flow.
- No migration, no schema change, no sync-path change.
