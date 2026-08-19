# Nutrition — domain index

**Owns:** food logs and macros, saved meals, food search and scanning, supplements and supplement
reminders, and the nutrition screen's editing surfaces.

## Code

| Area | Where |
|---|---|
| Domain logic | `lib/nutrition/` |
| UI | `app/nutrition/` (`nutrition-content.tsx` is the offline-first **reference pattern**), `components/nutrition/` |
| Energy balance | `lib/health/energy-balance-service.ts` (the one server-side assembly — the route and the AI tool both call it), `packages/shared/src/nutrition/calorie-balance.ts` (bands), `packages/shared/src/nutrition/adaptive-tdee.ts` (calibrated maintenance) |
| Tables | `food_logs`, `food_items`, saved meals, supplements + supplement logs, `meal_plans` + `meal_plan_variants` + `meal_plan_meals`, `dietary_restrictions` + `user_dietary_restrictions` |
| Meal Plan | `lib/data/postgres/slices/meal-plans.ts`, `packages/shared/src/nutrition/meal-split.ts`, `components/nutrition/meal-plan-*.tsx`, `app/api/nutrition/meal-plans/` |

**`app/nutrition/nutrition-content.tsx` is the canonical local-first read pattern** for the whole
app — its supplements reads (`getLocalStore(userId)` → `store.getSupplements()`, API only as
fallback) are what every offline-first domain should copy. See CLAUDE.md, "Offline-First".

## Reference docs

- [`docs/reviews/2026-08-15-pillar-model-soundness-review.md`](../../reviews/2026-08-15-pillar-model-soundness-review.md)
  — §3: the energy model is sound (Schofield BMR + Mifflin factors + Compendium METs) and targets are
  internally consistent, but **adaptive TDEE has not fired once in 30 rolling windows** because food
  logging runs 1–4 days per 14 against a gate of 10 (Q-302), and the AI coaches on that sparse data
  unqualified (Q-303).
- Plans: `ls docs/superpowers/plans/*nutrition*` (4 today) — plus the NUT-* items in the
  journal.
- [`docs/superpowers/plans/2026-08-11-meal-plan.md`](../../superpowers/plans/2026-08-11-meal-plan.md)
  — **Meal Plan** (Q-186). Carries six decisions with reasoning; D1 deliberately deviates from the
  owner's ask (chain picker, not geolocation). **Shipped** 2026-08-11 across three releases:
  [`docs/overview/history-2026-08-08.md`](../../overview/history-2026-08-08.md)
  (v1.282.0/v1.283.0 — schema, setup flow, restrictions picker, itemised meals, manage sheet) and
  [`docs/overview/history-2026-08-08.md`](../../overview/history-2026-08-08.md)
  (v1.287.0 — portion scaling, per-meal reroll, macro bars, structural edits). Phase 2 prefill is
  Q-187, now unblocked. **Editing a saved plan and building one around meals you already eat**
  (Q-192/Q-193, v1.288.0):
  [`docs/overview/history-2026-08-08.md`](../../overview/history-2026-08-08.md).
- [`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md)
  — **ingredient search reaches Open Food Facts**, gram-level meal editing, and the app-wide
  `SheetHeader` close-button clearance (v1.290.0). Read it before touching `SheetHeader` or the
  external-food path; it carries the tailwind-merge override trap and the OFF serving-size bug.
- [`docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md`](../../superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md)
  — **batch servings, plan top-up, reorder and instructed edits** (Q-207…Q-210), from owner testing
  on the S25. Carries the measurement behind Q-210: the plan **scales a saved meal and never adds to
  it**, so a 63P/15C meal in an 83C slot cannot get there at any allowed factor. Slice A shipped as
  v1.292.0 ([`docs/overview/history-2026-08-12.md`](../../overview/history-2026-08-12.md)).
- [`docs/superpowers/plans/2026-08-17-saved-meal-printable-label.md`](../../superpowers/plans/2026-08-17-saved-meal-printable-label.md)
  — **Q-389, printable saved-meal labels with a scannable code. ✅ BUILT 2026-08-18 (v1.320.0)** —
  see [the journal entry](../../overview/entries/2026-08-18-saved-meal-printable-label.md); two owed
  checks remain and both are physical (a test print, and the camera scan path). Carries three
  corrections to the intake entry: a 21×21 QR **cannot** hold a meal id (v2 25×25 minimum, so the
  module pitch is 0.49–0.64 mm, ~16% finer than recorded); the "log one serving" requirement is
  already met by `oneServingItems`/`logMealItems`; and consequently **`SavedMeal.totals` is the whole
  recipe**, so a label must render `totals / servings` or it prints double what scanning it logs.
- [`docs/overview/entries/2026-08-18-meal-label-ingredient-breakdown.md`](../../overview/entries/2026-08-18-meal-label-ingredient-breakdown.md)
  — **Q-393, the ingredient breakdown on the label (v1.323.0).** A square-only style, because a round
  50 mm label has **7 units of slack — zero lines** — once the default's content is on it. **Carries a
  correction worth reading before any print test: every module-pitch figure in Q-389/Q-393 is ~24%
  optimistic**, since the quiet zone is drawn *inside* the code box (band is 0.369 mm, not 0.487).
  The round trimmed variant was measured at 0.353 mm and deliberately **not** built.
- [`docs/overview/entries/2026-08-19-label-line-budget.md`](../../overview/entries/2026-08-19-label-line-budget.md)
  — **Q-399: the default label promised the ingredient breakdown and printed zero lines of it for a
  release (v1.324.0–v1.324.6), and three separate gates stayed quiet.** The sheet's "Printing N
  ingredients" copy was gated on `> 0`, so the one reading worth having removed itself; the picker
  went on claiming "the full ingredient list"; and the only test on that style asserted the code's
  **size**, which a bigger code scored better on. Read it before changing any label geometry: the
  four vertical gaps are spec data now, `centredStackLineBudget` derives the line count from them,
  and a test asserts the promise rather than a constant.
- [`docs/overview/entries/2026-08-18-meal-label-inline-centred.md`](../../overview/entries/2026-08-18-meal-label-inline-centred.md)
  — **Q-397, the label that actually shipped to the agreed design (v1.324.0), and the reasoning
  worth keeping.** Q-393's "the list does not fit a round label" was true only for a **stacked**
  list; running the ingredients as one **wrapping** run spends width instead of height, so the
  list fits a round die with a code *larger* than the old default. **`inlineCentred` is the new
  default.** Process lesson recorded there and in Q-397: the correction was made in chat and never
  written back into the queue entry, so the superseded analysis shipped as a work order.
  **Corrected 2026-08-19 by Q-399** — the "0.529 vs 0.369" this line carried was the pitch of a code
  box with **no room for the list underneath it**: the style drew zero ingredient lines for a full
  release. Retuned to 0.401 with three wrapped lines, and the line count is asserted now, not just
  the code size. **Superseded again 2026-08-19 by Q-411**, which retired the round constraint
  entirely — every style draws square, the default is **0.561 with four lines**, and both test
  thresholds were raised because the square canvas made the old ones unable to fail
  ([`journal`](../../overview/entries/2026-08-19-square-label-canvas.md)). ⚠ That gain holds only if
  the owner's circle template **crops**; if it **scales**, the default lands at 0.397 — worse than
  what it replaced. Unresolved until one test print — [`journal`](../../overview/entries/2026-08-19-label-line-budget.md).
- No standalone system reference exists for this pillar yet; the offline-first section of
  [`CLAUDE.md`](../../../CLAUDE.md) and [`docs/module-map.md`](../../module-map.md) §3 carry the
  load-bearing rules.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-18-memo-stability-audit.md`](../../reviews/2026-08-18-memo-stability-audit.md) — **are the memos actually memoising? 2026-08-18**. All 66 `memo(...)` declarations collected and every call site scanned: Q-490 — `MealMacroBars`/`DayMacroTotals` are called with an inline `target={{…}}` inside `variant.meals.map(...)`, so every keystroke in the meal-plan edit sheet re-renders every meal row. Also notes the rule's *"both long-standing memos"* count is stale (66, not 2). **Q-490 SHIPPED 2026-08-18** (v1.324.9): both take scalars now, and `scripts/check-memo-prop-stability.js` enforces the class — [`journal`](../../overview/entries/2026-08-18-memo-scalar-props.md). **Two of this audit's claims did not survive that check:** `actual` is a fresh object at three of the four sites too, not just `target`, so fixing `target` alone would have left three still defeated; and *"64 hold, no inline arrows anywhere"* is wrong — there are **four** inline-arrow sites on four other memoised components, now baselined and filed as Q-357.
- [`docs/reviews/2026-08-18-malformed-route-ids.md`](../../reviews/2026-08-18-malformed-route-ids.md) — **every dynamic route called with an id that is not a UUID, 2026-08-18** (Q-483 — three routes reply with the raw driver error including the full `SELECT` and every column name of `workout_sessions`, from their own catch, unredacted in production; Q-482 — 21 route/method pairs across 14 routes 500 on a malformed id while answering a valid-but-missing one correctly, and only 2 of 30 dynamic routes validate the id at all).
- [`docs/reviews/2026-08-18-outbox-replay-idempotency.md`](../../reviews/2026-08-18-outbox-replay-idempotency.md) — **the same mutation pushed twice, 2026-08-18** (Q-481 — a water quick-add replayed by the outbox stores 750 ml for 250 logged; `waterMlDelta` is the only non-idempotent branch of nineteen, and the server keeps no record of processed mutation ids). The additive write is deliberate (SYNC-P7) and must stay — the fix is mutation-id dedupe, not a change of semantics.
- [`docs/reviews/2026-08-18-write-surface-not-found.md`](../../reviews/2026-08-18-write-surface-not-found.md) — **nutrition/cardio/activity writes probed cross-user, and the whole write surface measured for the not-found answer, 2026-08-18** (Q-463 — `PUT /api/nutrition/meal-types/[id]` and both supplement write routes answer a missing row with a bodiless 500). Finding Q-463; **cross-user protection holds across all four write pillars**, and the idempotent `DELETE` pattern is recorded as clean rather than filed.

- [`docs/reviews/2026-08-18-ai-double-trips.md`](../../reviews/2026-08-18-ai-double-trips.md) — **the AI-usage screen's double-trips traced to cause, 2026-08-18** (Q-471 — the meal-plan reroll path is correctly guarded; its double-trip count is a fingerprint artefact, not tap-spam). Findings Q-469…Q-471; corroborates **Q-295** exactly and confirms **Q-170's latency fix is holding** (7-day Coach average 2,307 ms).

- [`docs/reviews/2026-08-18-nutrition-tdee-calibration.md`](../../reviews/2026-08-18-nutrition-tdee-calibration.md) — **the TDEE outcome check, 2026-08-18** (Q-517 — the food log captures **~45%** of actual intake, so taking it at face value implies a maintenance *below the owner's own BMR*. `adaptive-tdee.ts` already anticipated this and its gates refuse **75%** of windows — but `MIN_PLAUSIBLE_MAINTENANCE = 1000` sits **52 kcal below** where the artefact lands (1,052), and `MIN_LOGGED_FRACTION` counts logged *days* rather than log *completeness*, so a 45%-complete record passes a 70% gate. Proposed: floor at the user's own BMR — blocks every harmful value, tightening the range to 1,902–2,219).

## Open issues

```bash
grep -n '^### .*\[nutrition\]' projectOverview.md   # 6 entries today
grep -n '\[nutrition\]' docs/implementation-backlog.md   # Q-187, Q-191, Q-196…Q-201, Q-208…Q-210 today (Q-192, Q-198, Q-207 done)
```

Live at the time of writing (2026-07-30):

- **Offline saved-meal create/edit/delete** is a new sync domain and is **not device-verified**.
- **Offline food search** is APK-only and unverified on device.
- The quick-edit sheet fixes and the NUT-10/11 hygiene pass shipped, but interactive verification
  was blocked in the sandbox.
- Supplement reminders and meal-type reminder cancellation are unverified on device.

## History

- **[`docs/handoff-2026-08-13-nutrition-meal-plan-build-out.md`](../../handoff-2026-08-13-nutrition-meal-plan-build-out.md)**
  — 🆕 the Meal Plan build-out, Phase 1 through one-tap "I ate this" (v1.282.0 → v1.299.0, fifteen
  merged PRs, migrations 177–183, local SQLite v23–v25). **Start here for anything meal-plan.**
  What it leaves: **Q-187** (prefill the day from the plan — the owner's actual ask, and fully
  unblocked, **plan written 2026-08-13**:
  [`plans/2026-08-13-meal-plan-prefill-and-confirmation.md`](../../superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md)
  — keep unconfirmed prefills out of `food_logs` rather than filtering a column across its 24 readers)
  and **Q-201** (meal times schedule nothing — a three-way fork awaiting the owner).
  Carry-forwards worth more than the features: portion sizing is arithmetic, never the model's job;
  an OFF **503** is usually our own rate limiting, but a **502 is a real outage** (measured
  2026-08-13 — OFF served a downtime page across its whole API for hours), and the two must reach
  the user differently: `offFetchJson()` in `packages/shared/src/nutrition/open-food-facts.ts`
  returns `null` for "OFF did not answer", which callers must keep distinct from "OFF has no such
  product" — collapsing them told the owner their food was not in the database; and local SQLite
  **v25 has never run on a phone** —
  if Saved Meals comes up blank after an update, revert rather than debug forward.
- Handoffs: `ls docs/handoff-*-nutrition-*.md`
- Journal: `grep -rl 'nutrition\|food\|supplement' docs/overview/entries/`

## Gotchas specific to this domain

- **`food_logs` storing only a `food_item_id` was the #1 data-loss bug.** A log table must hold
  (or locally mirror) everything needed to *render* the row offline — the reference table has to be
  pulled too.
- **Zod `.optional()` rejects `null`** — clients must omit empty fields. Sending null broke every
  food save in v1.42.4.
- **Never `await` POSTs serially in a loop** — a multi-ingredient scan once meant one blocking
  round-trip per item before the toast appeared.
- **A meal plan never claims to be allergen-safe.** Structured capture makes the restriction
  reliable; the model's filtering is not. No shield, badge or tick on the review screen, and no
  automatic action may depend on the filtering having worked.
- **Dietary restrictions belong to the USER, not the plan.** Putting them on the plan means the
  next plan silently forgets an allergy.
- **Single-field saves must read-merge first** — local upserts overwrite all columns by default;
  copy `water-log-sheet`'s pattern, not `metric-log-sheet`'s.
- **The daily calorie target lives in `nutrition_targets.calories`.** `users.calorie_goal` is a
  denormalised mirror that the Health tab and Home tiles read, kept in step by write-through in
  both `/api/nutrition/targets` and `/api/user/goals`. They drifted 200 kcal apart in production
  (1950 vs 1750) because the TDEE nudge card wrote only one. Do not add a third writer.
- **The model picks the food; code decides the grams.** `scaleIngredientsToTargets`
  (`packages/shared/src/nutrition/meal-split.ts`) sizes each ingredient group so its macro lands on
  target. Two classification traps it already fell into: **a fatty protein is a protein source, not
  a fat one** (salmon is 59% fat by energy — filing it under fat emptied the protein group and gave
  32 g of protein against a 50 g target), and **a group whose macro is already overshot by the
  others must shrink, not be skipped** (15 g of olive oil stayed in a meal already past its fat
  target).
- **A meal with no source for a macro cannot reach that macro's target, however it is resized.**
  The generator prompts explicitly for a protein, a carb and a fat source; without that line, runs
  came back with 7 g of carbs against a 60 g target.
- **Open Food Facts parsing lives in one place** —
  `packages/shared/src/nutrition/open-food-facts.ts`, shared by the barcode route and the text
  search. Two traps already caught there: a product with no usable kcal must return `null` rather
  than a zero-calorie ingredient, and **a serving-size unit has to be followed by a non-letter** —
  `"1 glass (200 ml)"` matched the "g" of "glass" and reported a one-gram serving, dividing every
  macro by a hundred. Its macros are also not guaranteed to agree with its own calorie figure
  (Q-196).
- **Text → macros already exists: `POST /api/nutrition/scan` with `{ text }`.** It returns the same
  `NutritionIngredient` shape everything else in nutrition works in. Do not add a second route for
  this; the meal-plan picker reuses it.
- **"Do not repeat these" does not stop a model repeating them.** A kept meal came back generated
  again in the next slot under that wording. What works is stating the plan already contains them
  and demanding genuinely different food — same phrasing the per-meal reroll uses.
- **A saved meal's `totals` is the WHOLE recipe, not one portion.** `saved_meals.servings` says how
  many portions it makes; `oneServingItems()` (`packages/shared/src/nutrition/saved-meal-ingredients.ts`)
  is the one place that divides, and both the log path and the meal-plan conversion call it. Dividing
  inside `listSavedMeals` would silently change what every existing caller means.
- **A plan meal stores its own ingredients** (`meal_plan_meals.ingredients`, Q-192). Without that
  snapshot there is nothing to re-scale, replace or render, which is why per-meal editing could not
  exist on a saved plan before it. Anything new that shows or edits a plan meal reads this, not the
  library.
- **Regenerating the `claude_ro` views migration has two traps.** Capturing the generator with
  `2>&1` writes its summary line into the SQL (the migration then fails to parse on every boot), and
  `CLAUDE_RO_OWNER_USER_ID` must be the **production** owner id — a local one scopes every prod view
  to a user that does not exist. Diff the new file against its predecessor; only the new columns
  should differ.
- **Saved macro targets need not sum to the saved calorie goal** — nothing enforces it (Q-191).
  Anything planning against both must call `reconcileDailyMacros` first, or it is solving an
  unsatisfiable problem and will show a permanent gap that has nothing to do with the data.
- **Calibrated maintenance excludes the current day.** A day in progress has only part of its food
  logged; counting it drags mean intake down, so maintenance would sag every morning and recover
  each evening. Same partial-day trap as the Oura `wornHours` mistake.
- **An unlogged day is a gap, never a zero-calorie day.** Feeding nulls in as zeros halves the mean
  intake and reports a starvation-level maintenance.
