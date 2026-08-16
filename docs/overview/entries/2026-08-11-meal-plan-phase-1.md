# 2026-08-11 — Meal Plan, Phase 1 (Q-186, v1.282.0)

**Branch:** `claude/nutrition-tracking-review-eyftu1` · **Domain:** `nutrition`
**Plan:** [`docs/superpowers/plans/2026-08-11-meal-plan.md`](../../superpowers/plans/2026-08-11-meal-plan.md)

Shipped in two PRs the same day: the backend (#1256) and then the UI and sync. Built directly on
the calibrated calorie balance from earlier the same session — the plan's target comes from
`computeEnergyBalance`, never re-derived.

## Decisions the owner made, and what they cost

- **Supermarkets are a curated chain picker, not geolocation.** The list only biases what the model
  suggests; coordinates buy nothing without per-store stock data, and would cost a runtime
  permission plus a Play Store location declaration on a listing already facing a Health Connect
  review.
- **Training/rest variants ship in Phase 1**, not as a V2. `meal_plan_variants` sits between plan
  and meals. Retrofitting a day type later is a migration plus a reworked setup flow; upfront it is
  one table and a step that only appears if the toggle is on.
- **Dietary restrictions are a searchable structured picker**, stored per **user** rather than per
  plan — an allergy belongs to the person, so a new plan cannot silently forget it. A test covers
  exactly that: restrictions survive deleting the plan.
- **Setup is six steps**, not one sheet. `SheetFooter` owns the bottom inset, so no `pb-safe` goes
  near a primary button.
- **Each meal carries a "Save to my meals" switch**, defaulted on. The owner asked to be prompted;
  defaulting on means agreeing costs no taps while it stays visibly a per-meal choice.

## The two things worth remembering

**One active plan is enforced by a partial unique index, not application code.** Two concurrent
activations can both win against an app-level check. A test bypasses the repository entirely and
asserts the *database* refuses the second.

**The model is kept out of the arithmetic.** It picks foods and is told not to output numbers
because its numbers are discarded. Targets come from the energy-balance service and the per-meal
split from `splitMacrosAcrossMeals`, which reconciles exactly — rounding each share independently
drifts by up to n/2 grams, which would show as a plan whose meals do not add up to their own target.
Measured live against a real model call: totals reconcile on both variants, pre/post-workout roles
land on the meals bracketing the training time, and a declared peanut allergy reached the prompt.

## Safety constraint, stated once and honoured everywhere

Structured input makes *capturing* an allergy reliable. It does nothing for the model's filtering.
So no screen claims the plan is safe: no shield, no "allergen-free" badge, no tick beside the
allergy list. The review step shows each meal's ingredients next to the must-not-contain list and
says the plan was written by AI. Accepting it is the check. This is also why Q-187's prefill will
prompt per meal rather than logging silently.

## Offline

Local SQLite **v23** adds the three tables, registered in `RECONCILE_TABLES` in the same commit.
Rows carry names and macros, not just ids — a local table of foreign keys cannot render, which was
the `food_logs` → `food_items` data-loss bug. Plans carry a `deleted_at` tombstone emitted by
`getSyncDelta` (deliberately unfiltered there, like `mood_logs` and `food_logs`, because that is the
channel a delete travels down). Variants and meals ride the **same delta page** as their plan; a
plan whose meals arrive on a later page would render empty. The Nutrition section reads local-first.

## Things that moved under the plan while it queued

- Migrations shifted **175 → 177**; `main` landed 175/176 mid-session.
- **Q-166 resolved against SWR headers** — GET routes ship `private, no-store`, and
  `check-api-no-store.js` fails CI on the pattern the plan originally specified. Plan doc corrected.
- **Q-183/184 were taken by #1249** while the entry sat unmerged; renumbered to Q-186/187. The
  backlog file alone is never enough — check `list_pull_requests` too.

## Corrections to my own earlier claims

The design mockup said the saved-meals uplift would fix a missing `aria-expanded`. **That file has
no chevron toggle** — CLAUDE.md's list of nine offenders is stale for it. Nothing was fixed there,
and the CLAUDE.md count is left alone since only this one entry was verified.

## Three gaps found by re-reading what shipped (v1.283.0, same day)

Asked "what else is there to ship", I re-read my own work rather than answering from memory, and
found three things wrong with it:

1. **The "Save to my meals" switch did nothing.** The state was wired and the control rendered;
   `handleSave` never created a saved meal from it. The one control the owner explicitly asked for
   was decorative.
2. **No UI could deactivate or delete a plan** — the owner's brief said "set a meal plan as active
   or not". `setMealPlanActive` and `deleteMealPlan` existed and were tested; nothing called them.
3. **"Manage plan" opened the new-plan wizard.** Both handlers pointed at the setup sheet, so the
   button promised management and delivered replacement.

Fixed by itemising generated meals and adding a manage sheet. The owner chose itemisation "the same
way it happens when I AI scan an image", which turned out to be the right precedent and dissolved
my original objection: the scan route has the model supply per-ingredient **densities** and weights,
and `sumIngredients()` does the arithmetic in code with an Atwater cross-check. That is reference
data, not the model doing maths, so the meal-plan generator now uses the identical schema and helper.

Each meal therefore has two numbers — the target from `splitMacrosAcrossMeals` and the actual from
its ingredients — and the review step shows both, flagging a gap over 120 kcal. Measured live: a
3-meal plan came back with real ingredients and drifts of −70, +152 and −29 kcal. Surfacing that is
the point; reconciling it silently would hide a bad suggestion.

## Verified / not verified

3623 tests across 445 files, 17 custom rule checks, production build green. Rendering confirmed at
the 412×915 S25 viewport: empty state, setup step 1, and the restrictions picker with a seeded
allergy chip. Routes exercised live including a real generation.

**Not verified on device.** The sandbox reports safe-area insets as 0 and has no native SQLite, so
the setup sheet's real bottom clearance and every local-store path — the v23 upgrade, the
local-first read, the delta apply — are unexercised. Known-Issues row added.
