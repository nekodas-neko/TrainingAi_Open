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

- [`docs/superpowers/plans/2026-08-25-unified-day-review.md`](../../superpowers/plans/2026-08-25-unified-day-review.md)
  — **Q-112, the unified day review** (Q-112a–e). Read it instead of Task 27 of the 2026-08-05 batch,
  whose central premise — that no per-day read-through screen exists — stopped being true when Q-110
  shipped `/health/day`. Covers the evening flow's three steps, the skip rule, and why the
  banner-vs-notification question was already answered by what shipped.
- [`docs/design/2026-08-18-nutrition-rework-mockups.html`](../../design/2026-08-18-nutrition-rework-mockups.html)
  — **the nutrition rework's twelve reference drawings**, at true S25 size in the app's own tokens.
  Open this before building **Q-395 / Q-395a / Q-395b / Q-395c** or **Q-406**; it is what they cite.
  Page 1 is the six reworked screens (day · add food · my meals · meal detail · edit meal ·
  quantity), page 2 the review that produced them (today's Saved Meals, the tap-target audit, the
  hardcoded-green finding, and `srv/g` options A/B/C).
  **Recovered and committed 2026-08-24** from the Claude Design canvas they had only ever lived in —
  which had blocked those four entries for six days. Two corrections it carries: there is no
  `unit-options.png` (it was a screenshot of the `srv/g` artboards), and Q-395a's expanded and
  collapsed rows are **two different artboards** (`UnitA` and `EditMeal`), not one.
- [`docs/superpowers/specs/2026-08-24-meal-creator-and-planner-design.md`](../../superpowers/specs/2026-08-24-meal-creator-and-planner-design.md)
  — **the meal creator / planner redesign** (BF-11), owner-agreed. Plans:
  [Part 1, the creator](../../superpowers/plans/2026-08-24-meal-creator.md) ·
  [Part 2, the library-first planner](../../superpowers/plans/2026-08-24-library-first-meal-planner.md).
  Part 2 §1.1 records that `fitDistance` (`packages/shared/src/nutrition/meal-macro-fit.ts`) is
  already the one place that ranks a meal against a target — do not write a second one — and §2 two
  live defects in `generate/route.ts` when pinned meals outnumber the slots.
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
- [`docs/overview/entries/2026-08-30-feat-self-contained-meal-label.md`](../../overview/entries/2026-08-30-feat-self-contained-meal-label.md)
  — **BF-57 engine half: the meal travels IN the code, not as a pointer to it.** Positional JSON, so
  a label scans offline for a user with no account, as a copy. Ids were deliberately **not** made
  globally resolvable — a photo of a label would become read access to someone's meal. **The totals
  are sacred:** the tail rolls into one remainder entry carrying its combined macros rather than
  anything being dropped.
- [`docs/overview/entries/2026-08-31-shared-meal-labels.md`](../../overview/entries/2026-08-31-shared-meal-labels.md)
  — **BF-57 surface half, and the measurement that reversed its plan.** The entry asked for the code
  to be given ~30 mm so version 11 fits every style; the five print styles are each **already** at
  the largest code that clears their content by 6 units, and four of the six cannot hold 62 bytes —
  below which the encoder trims the meal's **name**. Two payloads ship instead: the print styles keep
  the private bookmark, and a new **`share`** style spends the label on a 34.4 mm code. Read it
  before changing any `codeUnits`: `mealLabelShareBudget` derives the payload budget from the
  geometry, so shrinking a code silently shrinks what its label can carry. ⚠ **0.49 mm per module is
  a convention, not a measurement** — no label of any style has been through a printer.
- [`docs/overview/entries/2026-08-31-nutrition-sheet-surface.md`](../../overview/entries/2026-08-31-nutrition-sheet-surface.md)
  — **BF-75: the sheets carry the tab's palette.** Read before making any sheet translucent: the
  wallpaper is `z-[-1]` while `SheetOverlay` and `SheetContent` are both `z-50`, so transparency
  reveals the overlay's `bg-black/50`, not the tab. The palette is painted *inside* the sheet behind
  an opt-in `surface="page"` prop. ⚠ **Wallpapers ship `enabled: false`**, so the sandbox shows
  nothing by default and the e2e has to switch them on before it can assert anything — the
  passes-because-the-feature-is-off trap. The contrast check on the S25 is still owed.
- [`docs/superpowers/plans/2026-08-31-ai-meal-builder-entry-point.md`](../../superpowers/plans/2026-08-31-ai-meal-builder-entry-point.md)
  — **BF-52: the meal builder's inputs all work and three share one slot.** Read before touching
  `ingredient-search.tsx`: the recipe-photo button, the URL import and the AI estimate are **mutually
  exclusive renders of the same slot**, chosen by what is typed into a field labelled *"Search your
  foods or the food database…"* — so the field advertises search and behaves as a mode switch, which
  is the whole of *"I dont see a URL option"*. `/api/nutrition/scan` already takes all three shapes
  (`image`+`mimeType`, `url`, `text`) in one handler, so the fix is an entry point and not an engine.
  The plan **declines** BF-52's instruction to absorb BF-63's barcode into the new row, and says why:
  photo and URL produce a whole ingredient list, the barcode and the estimate produce one ingredient.
- [`docs/overview/entries/2026-08-31-meal-builder-entry-point.md`](../../overview/entries/2026-08-31-meal-builder-entry-point.md)
  — **BF-52 shipped: the builder's source row.** Two findings bind future work here. The URL branch in
  `ingredient-search.tsx` is a **guard**, not just an affordance — delete it and a pasted link falls to
  the AI estimate, which produces a food called "https" with invented macros. And `runRecipeImport`
  now lives in `recipe-import-run.ts` with tests: the `recipeYield` refusal, the multi-candidate
  branch and the 0.01 floor were prose-only until two callers forced the extraction.
- No standalone system reference exists for this pillar yet; the offline-first section of
  [`CLAUDE.md`](../../../CLAUDE.md) and [`docs/module-map.md`](../../module-map.md) §3 carry the
  load-bearing rules.

- Reviews: [`docs/reviews/2026-08-07-full-app-review.md`](../../reviews/2026-08-07-full-app-review.md) — **full-app deep review, 2026-08-07** (saving/caching/performance/logic across all 201 routes and 40 pages; 53 findings queued as Q-117…Q-138, plus root cause for Q-73 and mechanisms for Q-72/Q-107)

- [`docs/reviews/2026-08-18-memo-stability-audit.md`](../../reviews/2026-08-18-memo-stability-audit.md) — **are the memos actually memoising? 2026-08-18**. All 66 `memo(...)` declarations collected and every call site scanned: Q-490 — `MealMacroBars`/`DayMacroTotals` are called with an inline `target={{…}}` inside `variant.meals.map(...)`, so every keystroke in the meal-plan edit sheet re-renders every meal row. Also notes the rule's *"both long-standing memos"* count is stale (66, not 2). **Q-490 SHIPPED 2026-08-18** (v1.324.9): both take scalars now, and `scripts/check-memo-prop-stability.js` enforces the class — [`journal`](../../overview/entries/2026-08-18-memo-scalar-props.md). **Two of this audit's claims did not survive that check:** `actual` is a fresh object at three of the four sites too, not just `target`, so fixing `target` alone would have left three still defeated; and *"64 hold, no inline arrows anywhere"* is wrong — there are **four** inline-arrow sites on four other memoised components, now baselined and filed as Q-357.
- [`docs/overview/entries/2026-08-24-recipe-spec-structural-attribution.md`](../../overview/entries/2026-08-24-recipe-spec-structural-attribution.md) — **LB-7, the recipe spec's attribution guard, 2026-08-24** (`getByText('example.com').last()` matched the row's NAME, which is the host while the scrape resolves — measured passing with the attribution deleted and the mock delayed 8 s. It asserts on a `data-testid` row now.)
- [`docs/overview/entries/2026-08-24-memo-call-site-stability.md`](../../overview/entries/2026-08-24-memo-call-site-stability.md) — **Q-357, the memo baseline emptied, 2026-08-24** (four defeated call sites cleared; the `SavedMealCard` one was inside a `.map()`, so its callbacks now take the meal and hand it back rather than being closed over per row). **Render saving not measured.**
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

- 🎨 **The nutrition rework is specified and phased (Q-395, split 2026-08-23).** Sixteen screens are
  drawn at true S25 size in this app's own tokens, the owner has reviewed them twice and answered
  every blocking question, and the coverage audit is done — so the design is not the bottleneck.
  **Q-395 is now the spec and the final checkpoint, not a work item.** The work is **Q-406** (one
  shared `food-row.tsx`, replacing four shapes for one thing) → **Q-395a** (quantity sheet + Edit
  Meal) → **Q-395b** (the day screen, against an 11-section coverage list) → **Q-395c** (the merged
  list and the naming sweep) → **LB-16** (Log Food as one screen). **All phases have shipped**, so
  Q-395 itself is startable — but wait for the LB-16/BF-37 device pass before signing off parity on a
  screen nobody has seen on the phone. Read Q-395 before starting any phase; the phases point back
  rather than copying its decisions.
- ⚠️ **The finished-logging control was never reached** (BF-6, 2026-08-24, v1.344.0) — last on the
  page, **zero presses in seven weeks**, while the calibration it feeds excludes an unmarked day
  rather than treating it as light. Now directly under the meals, End of Day last. **Not
  device-verified** — [`journal`](../../overview/entries/2026-08-24-finish-logging-above-end-of-day.md).
- ⚠️ **A recipe link becomes a meal** (Q-409's Lane B half, 2026-08-24, v1.342.0) — the plan
  wizard's "meals you usually eat" step takes a URL. **A page that states no yield hands back the
  WHOLE recipe**, so the row asks how many it serves and refuses to be kept until answered;
  `perServing` is shared with the route so the two divides cannot drift —
  [`journal`](../../overview/entries/2026-08-24-recipe-url-to-meal-ui.md).
- ⚠️ **Saved meals can carry a photo at last** (Q-327, 2026-08-24, v1.341.0) — a 64 px tile in
  Edit Meal, downscaling to 128 px WebP so the picture fits `SAVED_MEAL_IMAGE_MAX_BYTES`. The
  storage half had shipped with Q-396 and nothing could reach it. **Not device-verified**: the
  native camera branch never runs in a browser —
  [`journal`](../../overview/entries/2026-08-24-saved-meal-photo-picker.md).
- 🔴 **The whole meal-plan write surface was dead, and is fixed** (Q-398, 2026-08-24, v1.340.0).
  Five routes guarded the request body and then validated a variable nothing assigned, so creating a
  plan, renaming/activating/deleting one, restructuring it, editing a meal and saving dietary
  restrictions all answered `400 Invalid input: expected object, received undefined`.
  `scripts/check-json-body-parsed.js` holds the class shut.
- ⚠️ **Plan meals become saved meals** (Q-398, 2026-08-24, v1.340.0) — `Save to My Meals` per meal
  plus `Save all`, idempotent on `meal_plan_meals.saved_meal_id`, with a derived `From plan` tag.
  `savePlanMealToLibrary` is now the one copy path; the setup sheet's own used to duplicate against
  it. **Not device-verified**, and the entry's step 3 (deleting the plan surface) still needs the
  owner — [`journal`](../../overview/entries/2026-08-24-meal-plan-to-saved-meals.md).
- ⚠️ **The maintenance calibration can engage at last** (Q-387, 2026-08-23, v1.337.0) — the
  "I've finished logging" button + counter shipped, so days can be flagged complete. **Not
  device-verified, and the write has no outbox domain** —
  [`journal`](../../overview/entries/2026-08-23-food-logging-complete.md).
- ⚠️ **Q-323 turned the calorie bar into a progress bar and Home's donut into a progress ring**
  (2026-08-23, v1.336.0). `barPosition`/`barBands` are gone; `barProgress()` replaces them. **Not
  device-verified** — [`journal`](../../overview/entries/2026-08-23-calorie-progress-bar.md).
- ⚠️ **Three calorie budgets were live on one screen; there is now one** (Q-415/Q-417, fixed
  2026-08-23, v1.335.0). Home's nutrition card and the Nutrition ring both read
  `budgetProvenance(...).total` rather than composing `nutrition_targets.calories` — the **rest-day
  floor** — plus a separately-sourced burn. Follow-up **LB-4** (food logs invalidate before their
  push) and **not device-verified** —
  [`journal`](../../overview/entries/2026-08-23-one-calorie-budget.md).

- **Offline saved-meal create/edit/delete** is a new sync domain and is **not device-verified**.
- **Offline food search** is APK-only and unverified on device.
- The quick-edit sheet fixes and the NUT-10/11 hygiene pass shipped, but interactive verification
  was blocked in the sandbox.
- Supplement reminders and meal-type reminder cancellation are unverified on device.

## History

- **[`docs/handoff-2026-08-31-nutrition-diary-and-swipe-tray.md`](../../handoff-2026-08-31-nutrition-diary-and-swipe-tray.md)**
  — 🆕 the session that shipped BF-39, BF-60/61/62/63, LB-28 and LB-30. **Read its gotchas before
  writing an e2e that taps a coordinate**: `Input.dispatchTouchEvent` performs none of
  `locator.tap()`'s actionability checks, and the three gestures that do *not* reproduce BF-61 are
  written down there.
- **[`docs/overview/entries/2026-08-31-nutrition-uplift.md`](../../overview/entries/2026-08-31-nutrition-uplift.md)**
  — 🆕 **BF-72/73/74/76**. Read it before touching a nutrition sheet's padding or a button's height:
  **`min-h-[Npx]` does nothing on a `<button>`** here (a bare `button { min-height: 48px }` in
  `globals.css` beats the utility — measured), and **BF-76's safe-area sweep found the opposite of
  what it expected** — nothing under-padded, three sheets over-padded, and the `vh`→`dvh` fix is not
  the mechanism because a bottom sheet is `fixed bottom-0`. Also the one-line BF-72 cause: an
  `applyDelta` payload that omits a column writes NULL over it.
- **[`docs/overview/entries/2026-08-31-bf-71-clinical-entry.md`](../../overview/entries/2026-08-31-bf-71-clinical-entry.md)**
  — 🆕 **BF-71**: a measured RMR can now be stored, and it replaces the predicted one in the calorie
  target — **BMR 1328 / TDEE 1594 against 1485 / 1782 predicted, a 188 kcal/day difference** on the
  owner's own test. Relevant here because `nutrition-goals/recommend` was already reading
  `getLatestMeasuredRmr` and getting null every time.
- **[`docs/overview/entries/2026-08-31-diary-nested-meal-rows.md`](../../overview/entries/2026-08-31-diary-nested-meal-rows.md)**
  — 🆕 **BF-39**: a logged meal draws as **one** diary row, headed by the meal's name and photo, and
  opens to its ingredients. Grouped on `meal_group_id`, never `saved_meal_id`; the name and photo
  come from [`use-saved-meal-summaries.ts`](../../../lib/hooks/use-saved-meal-summaries.ts), a
  local-first read on the shared `saved-meals` key. **Read the second half before trusting any
  measurement made against a swipe spec**: the week-long hold, recorded as a `useDrag` being dropped
  by a sibling re-render, was the spec measuring a row the sheet had not finished animating — the
  drag handler was never invoked at all.
- **[`docs/overview/entries/2026-08-30-nutrition-ui-uplift.md`](../../overview/entries/2026-08-30-nutrition-ui-uplift.md)**
  — 🆕 **BF-45 / BF-50 / BF-51**: eight surface fixes from two device passes — the macro ring starting
  at 9 o'clock (`from -90deg` is the SVG idiom; CSS conic gradients already start at the top, and
  Home's ring had it too), a collapsed meal losing its macros, 4 px bottom-sheet gutters against
  artboards that say 16, and the Log Food capture row. **⚠ Two items were built, measured and
  deliberately held** — the meal-photo rework and the builder's back surface. Read BF-46 and BF-51
  before rebuilding either: the photo picker acquires the image correctly and it reaches nothing,
  which is probably BF-46 ①(b) itself.
- **[`docs/overview/entries/2026-08-30-log-food-database-search.md`](../../overview/entries/2026-08-30-log-food-database-search.md)**
  — 🆕 **BF-48**: Log Food → Single foods searches the **food database**, not only foods you have
  already logged. The query and its results section are shared with the meal builder
  ([`use-food-database-search.ts`](../../../lib/hooks/use-food-database-search.ts),
  [`food-database-results.tsx`](../../../components/nutrition/food-database-results.tsx)) so the
  macro/calorie mismatch warning has one implementation. **The 700 ms debounce travels with the
  hook** — Open Food Facts rate-limits to roughly ten searches a minute, so the own-foods search's
  250 ms clock gets 503ed. The foods tab's search box is now unconditional: it had been hidden while
  the list was empty, which is the state the report was made from.
- **[`docs/overview/entries/2026-08-26-saved-meal-duplicate-detection.md`](../../overview/entries/2026-08-26-saved-meal-duplicate-detection.md)**
  — 🆕 **BF-11d**: saving a meal you already have **asks** instead of adding it again
  ([`meal-duplicate.ts`](../../../components/nutrition/meal-duplicate.ts)). *Close* is two
  independent tests and both must pass — `fitDistance` on the macros, and **equality of the
  normalised name, not a fuzzy match** (BF-38's *prefer under-merging*: a duplicate is deletable, an
  offer to overwrite the wrong meal is not). Both save paths check; **Update keeps the existing id**,
  because a printed QR label points at it. The write moved to
  [`save-meal.ts`](../../../components/nutrition/save-meal.ts) and Q-216's source-text guard followed
  it there.
- **[`docs/overview/entries/2026-08-26-build-a-meal-add-methods.md`](../../overview/entries/2026-08-26-build-a-meal-add-methods.md)**
  — 🆕 **BF-11c**: Build a Meal takes a pasted **recipe link**, and a page holding several dishes
  asks which to keep (each becomes its own saved meal). **⚠ Read this before touching any recipe
  import**: `/api/nutrition/scan` **divides before it answers**, so a page stating *makes 12* arrives
  as one slice — a caller that then sets `servings: 12` logs a twelfth of a slice. The decision is
  [`recipe-import.ts`](../../../components/nutrition/recipe-import.ts) → `recipeBuilderPatch`, with
  tests. Also: the picker's default list was never missing, only unlabelled.
- **[`docs/overview/entries/2026-08-26-log-food-one-screen.md`](../../overview/entries/2026-08-26-log-food-one-screen.md)**
  — 🆕 **LB-16 + BF-37**: Log Food is **one screen** — no tile grid, a
  `Recent · Meals · Single foods` tab strip and a `Photo · Barcode · Describe or enter` action row
  ([`capture-actions.tsx`](../../../components/nutrition/capture-actions.tsx),
  [`recent-foods-panel.tsx`](../../../components/nutrition/recent-foods-panel.tsx), both rendered by
  `saved-meals-sheet.tsx`). **Two consequences to know before touching it:** `FoodLoggerSheet` renders
  **no sheet of its own** at the capture step — one screen is one sheet is one back-stack layer — and
  the entry below's merged list is **un-merged**, because the owner reported it the same morning
  (*"they are 2 seperate things"*). `FoodList` takes a `show` prop; nothing else about it moved.
  `Recent` is scoped to a meal bucket, which is **LB-18**'s open question rather than a defect.
- **[`docs/overview/entries/2026-08-26-one-food-list.md`](../../overview/entries/2026-08-26-one-food-list.md)**
  — **Q-395c** *(the merge above reversed the list half of this the same day)*: *My Meals* and the
  food library were **one list called My Foods**
  ([`components/nutrition/food-list.tsx`](../../../components/nutrition/food-list.tsx));
  `food-library-sheet.tsx` is deleted and `/nutrition`'s button opens the logger onto the list,
  because a food's tap needs the assign step and that step is `FoodLoggerSheet`'s. **Two things to
  know before touching it:** the list is one list over **two sources** — a food row opens the assign
  step, a meal row opens its own screen — so it is not one shape over a merged type; and **MRU is
  unavailable**, because `food_logs` carries no `saved_meal_id` and a saved meal therefore has no
  last-used timestamp at all. It sorts `createdAt DESC` until a Lane A column exists.

- **[`docs/overview/entries/2026-08-25-saved-meal-meal-type-tags.md`](../../overview/entries/2026-08-25-saved-meal-meal-type-tags.md)**
  — BF-11e: saved meals carry meal-type tags (migration 217, local SQLite v29). **Storage and
  transport only — no picker yet (BF-11f), so nothing is user-visible.** Read it before touching the
  saved-meal write path: `undefined` leaves stored tags alone and `[]` clears them, soft-deleted meal
  types are filtered on read rather than by deleting join rows, and the sheet's outbox payload
  deliberately does **not** carry tags yet — BF-11f must add it there and to `upsertSavedMeal` in the
  same PR or tags will save on the web and strand offline.
- **[`docs/overview/entries/2026-08-25-scan-multi-candidate.md`](../../overview/entries/2026-08-25-scan-multi-candidate.md)**
  — BF-11b: `/api/nutrition/scan` returns one candidate per meal instead of merging several into one
  estimate. The top level stays the first dish because five call sites read it and two gate on it.
  Its measurement is worth knowing before touching that prompt: the first split rule was a **coin
  flip** on identical meal-prep containers (5, 5, 1, 1, 5, 1) and the shipped one is 30 of 30.


- **[`docs/handoff-2026-08-13-nutrition-meal-plan-build-out.md`](../../handoff-2026-08-13-nutrition-meal-plan-build-out.md)**
  — 🆕 the Meal Plan build-out, Phase 1 through one-tap "I ate this" (v1.282.0 → v1.299.0, fifteen
  merged PRs, migrations 177–183, local SQLite v23–v25). **Start here for anything meal-plan.**
  What it leaves: **Q-187** (prefill the day from the plan — the owner's actual ask, and fully
  unblocked, **plan written 2026-08-13**:
  [`plans/2026-08-13-meal-plan-prefill-and-confirmation.md`](../../superpowers/plans/2026-08-13-meal-plan-prefill-and-confirmation.md)
  — keep unconfirmed prefills out of `food_logs` rather than filtering a column across its 24 readers)
  and ~~**Q-201**~~ (meal times schedule nothing — **decided 2026-08-24: they stay labels and
  schedule nothing.** See *Decided, and deliberately not built* below; the entry is out of the queue).
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

## Decided, and deliberately not built

- **A plan meal's `suggestedTime` stays a LABEL — it schedules nothing (owner, 2026-08-24 — Q-201,
  removed from the queue).** *"For now it can stay as a label; we already have the notification
  system for when meals are missed, that's fine."* `meal_plan_meals.suggested_time` is written by the
  generator, synced, rendered on three surfaces and fed to the AI as context; nothing fires from it,
  and nothing should. **Keep it that way**, and do not read the dead field as a bug to fix.
  - The two things were never the same notification, which is what made this a fork rather than a
    task: the existing reminders (`computeMealReminderActions`, `lib/meal-reminders.ts`) fire at a
    **meal type's end hour** as a *"you didn't log this"* catch-up, while `suggestedTime` is a
    *"time to eat"* prompt. Meal types and plan meals are not 1:1 either — a plan meal's
    `mealTypeId` is usually null, so there is often no meal type to hang a plan time on.
  - **Both build options were rejected for the same underlying reason:** making plan times drive the
    existing reminders changes what today's catch-up reminder *means*, and adding a second stream
    puts two independent schedulers behind one interrupting surface. Notifications are also
    verifiable **only** on the device, so either choice ships an unverifiable behaviour change to
    the one surface that interrupts the user.
  - **What meets the underlying need instead: Q-187's prefill.** The day's food logs pre-populate
    from the active plan, so the plan is present in the day without anything having to interrupt.
    That is the entry's own *"cheapest thing that would make an active plan feel alive"*, without a
    notification.
  - **Revisit only if** the owner reports actually wanting a prompt at the time — at which point the
    fork above is still the fork, and prefill will have shown whether presence beats interruption.

- **A meal type's entries can be MOVED, never bulk-deleted (owner, 2026-08-23 — LB-2, removed from
  the queue).** Q-326's delete dialog offers *"move them"* and no *"delete them instead"*, and the
  server has no `deleteFoodLogsByMealType` to back one — the button was never built rather than
  built dead. **Keep it that way.** The move is already the escape, so nobody is stuck; the meal
  type can be deleted the moment it is empty. What the second option would buy is one tap, and what
  it would cost is a single irreversible action that discards real logged history — which feeds the
  calorie trends, the adaptive-TDEE calibration, and the burn-estimate fitting in Q-422. It would
  also be the only bulk destructive action in the app. Revisit only if the move itself becomes a
  real annoyance; building it later is a repository function and a route parameter.

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
