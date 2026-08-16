# Handoff — 2026-08-13 · Meal Plan build-out, from Phase 1 to one-tap logging

_Domain: `nutrition` (also touches `platform`) · Branch: merged to `main` (v1.282.0 → v1.299.0) · PRs: #1258, #1265, #1266, #1269, #1271, #1272, #1277, #1282, #1283, #1284, #1285, #1286, #1288, #1289, #1290 — **all merged**_

> **Read first:** `projectOverview.md`, then `docs/domains/nutrition/README.md`, then
> [`docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md`](superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md).
> The companion handoff for the same session's platform work — including a **live, undiagnosed
> production fault** — is
> [`docs/handoff-2026-08-13-platform-production-connection-starvation.md`](handoff-2026-08-13-platform-production-connection-starvation.md).

## Goal

The owner's stated end-game, verbatim:

> "ideally the end gsme goal is the meal plan will auto fill and require a yes/no if you had the
> food; then as you input your actuall food it can recalculate food based on the macros left. I.e
> if you eat too much during lunch it will cut some portions for other meals or vice versa."

This session built everything up to — but not including — the automatic prefill. Fifteen PRs, all
merged, driven by the owner testing on the S25 between sessions and reporting what was wrong.

## Current status

- **Queue is drained.** Every nutrition item filed against this work shipped, except **Q-187**
  (Phase 2 prefill) and **Q-201** (meal times), both covered below.
- Each PR passed CI and a `pnpm dev` pass exercising its changed routes.
- **Device-verified: no.** Nothing here has been confirmed on the phone by this session. The
  specific risk is called out under "The one thing to check on device first".

## What shipped

| # | Version | What |
|---|---|---|
| #1258 | v1.282.0 | Meal Plan Phase 1 (Q-186) — DB, offline sync, UI, review card, coach tool |
| #1265 | v1.283.0 | Portion sizing moved into code; single-meal reroll |
| #1266 | v1.288.0 | A saved plan keeps its ingredients (Q-192); build a plan around meals you already eat (Q-193) |
| #1269 | v1.290.0 | Kept meals marked as yours; a plan meal shows what it is made of |
| #1271 | v1.290.x | Ingredient search reaches Open Food Facts, not just your own items |
| #1272 | — | Five findings filed from a post-merge review |
| #1277 | v1.291.0 | "Milk" returns milk; the quantity control offers servings again |
| #1282 | v1.292.0 | A saved meal declares how many portions it makes (Q-207) — migration 182, local SQLite **v25** |
| #1283 | v1.293.0 | One offline-first food-creation path; self-contradicting database rows flagged (Q-197/199/196) |
| #1284 | v1.294.0 | Tell a plan meal what to change; move it earlier or later (Q-208/209) |
| #1285 | v1.295.0 | A plan can add food to a meal it cannot resize into shape (Q-210) |
| #1286 | v1.296.0 | The plan card's macro bars fill with the day that actually happened (Q-200) |
| #1288 | v1.297.0 | The targets screen says when macros do not add up to the calorie goal (Q-191) |
| #1289 | v1.298.0 | Reorder and instructed edits on the setup screen, not only on a saved plan |
| #1290 | v1.299.0 | **One-tap "I ate this"** — a planned meal logs every ingredient into the day |

Migrations claimed: **177–179** (meal plans, dietary restrictions, `claude_ro` views), **180/181**
(meal ingredients), **182** (`saved_meals.servings`), **183** (`claude_ro` regen). Local SQLite
versions **23, 24, 25**.

Owner-reported UI faults fixed along the way: the sheet close-X sitting on top of the New Meal
button, calories not prominent enough, the edit-meal section lacking granularity, ingredient search
reaching only saved items, meals not reorderable, the confusing serving control, and the missing
free-text edit box under the meals.

## Deliberately NOT done

- **Q-187 — the automatic prefill.** This is the first half of the owner's end-game and the single
  most valuable next item. Everything it needs now exists: a saved plan carries a denormalised
  ingredient snapshot (Q-192, v1.288.0), and #1290 proved the write path by logging a plan meal on
  demand. What is missing is the prefill itself plus the yes/no confirmation. **The
  recalculate-the-rest-of-the-day half is not designed yet** — the owner described it, nothing was
  written down beyond that quote, and it deserves its own planning pass rather than being bolted
  onto Q-187.
- **Q-201 — plan meal times schedule nothing.** A meal's `suggestedTime` is stored, displayed, and
  used for nothing else. **Left unimplemented on purpose**: it is a three-way fork the owner has to
  pick, and the notification surface cannot be verified from the sandbox. The options are (a) the
  plan time replaces the meal-type reminder time, (b) a second "time to eat" notification stream
  alongside the existing reminders, (c) leave them as labels. **Do not guess.**

## Key decisions (with rationale)

- **Portion sizing is arithmetic, not the model's job.** The model proposes foods; code scales them
  to the slot's macro target. An LLM asked to hit numbers gets them wrong quietly.
- **Top-up is gated on a real improvement, not any improvement.** `scaleWithTopUp`
  (`lib/nutrition/meal-top-up.ts`) keeps an addition only when `fitDistance` improves by
  `TOP_UP_MIN_IMPROVEMENT` (10%). Without the floor it added 40 g of celery to an ice cream for a
  0.4% gain.
- **`reconcileDailyMacros`'s tolerance is 2 kcal, not 1.** `carbsFromRemainder` rounds to whole
  grams, so 153 g against a 1,750 kcal goal lands at 1,752 — the function flagged its own output as
  inconsistent. Named as `MACRO_RECONCILE_TOLERANCE_KCAL` so the next reader does not "tighten" it.
- **Ingredient quantities offer both servings and grams**, defaulting to servings. Grams alone
  cannot say "two scoops" without the user knowing what a scoop weighs; a bare multiplier cannot say
  "137 g of chicken". The stored value is always the serving multiplier.
- **A recipe makes "portions"; an ingredient is measured in "servings" of that food.** They were the
  same word meaning two different things and the owner said so.

## Gotchas / what did NOT work

- **I published a wrong diagnosis twice, on the same bug.** The owner's ice cream would not scale to
  its slot, and I wrote that it needed "6.3× against a 2.5× clamp". Measured truth: the milk in it
  is filed as a **fat** (31 kcal fat vs 18 carb, 22% protein share), so the meal contains **no carb
  source at all** and no scaling factor of any size helps. Widening the clamp — the fix I had
  proposed — would have done nothing. The corrected account is in the plan doc, the backlog entry
  and the code comments. **The lesson: measure the failing case before writing the cause down.**
- **The OFF serving-size parser matched the "g" in "glass"**, making "1 glass (200 ml)" a one-gram
  serving. Units now need a non-letter after them, and the barcode scanner shared the bug. Pinned by
  tests in `packages/shared/src/nutrition/open-food-facts.ts`.
- **A search for "milk" returned cheese.** I first claimed `sort_by` fixed it; it only reorders. OFF
  matches ingredient *lists*, so anything containing milk scores. The real fix was a region filter
  plus a whole-word name match — "milk" is a substring of "Milka".
- **OFF "not responding" was our own fault.** The 503s were rate limiting caused by our 250 ms
  debounce chained behind the food-items fetch. Fixed with a separate 700 ms effect, a 12/min limit
  and one retry at 400 ms. Do not read an OFF 503 as OFF being down.
- **I shipped a half-fix and the owner caught it.** Reorder and the instructed-edit box went into
  `meal-plan-edit-sheet.tsx` (the *saved* plan) while the owner's screenshots were of the setup
  flow's review step. Fixed in #1289. The sibling-surface rule in CLAUDE.md exists precisely for
  this and I did not run it.
- **`pnpm test` failed once on `rate_limits` poisoning** — a burst of suite runs inside one limit
  window makes an unrelated assertion fail. `DELETE FROM rate_limits` and re-run before believing it.
- **Component-size CI failures** forced three extractions: `IngredientSearch`, `IngredientRow`, and
  `app/nutrition/use-plan-meal-logging.ts` (which took `nutrition-content.tsx` from 811 to 773).

## The one thing to check on device first

**Local SQLite v25's `ALTER TABLE saved_meals ADD COLUMN servings REAL NOT NULL DEFAULT 1` has
never run on a phone.** It is the three-part pattern (versioned ALTER + the column in the
`CREATE TABLE` body + a `RECONCILE_COLUMNS` row), so it should be safe — but it is unverified.

**If Saved Meals comes up blank after the update, revert; do not debug forward.** A blank local read
is the signature of a failed upgrade leaving the store unusable, and this project has been there
twice (#27, #85). The same window is what swallowed a check-in on 2026-08-13 — see the platform
handoff.

Also unverified on device: offline food creation and its push, safe-area on the new controls, and
Samsung WebView rendering of the new cards.

## Files to look at

- `app/nutrition/nutrition-content.tsx` — the section root; reads local-first, hydrates from server.
- `app/nutrition/use-plan-meal-logging.ts` + `packages/shared/src/nutrition/log-plan-meal.ts` — the one-tap logging path, and the write path Q-187's prefill should reuse.
- `components/nutrition/meal-plan-draft.ts` — `reorderDraft`; targets and timing stay with the slot, food moves, ingredients rescale.
- `lib/nutrition/meal-top-up.ts` — the top-up and its improvement floor.
- `packages/shared/src/nutrition/goal-recommendation.ts` — `reconcileDailyMacros` and the tolerance constants.
- `packages/shared/src/nutrition/open-food-facts.ts` + `app/api/nutrition/food-search/route.ts` — the OFF integration and its ranking.
- `app/api/nutrition/meal-plans/generate/route.ts` and `generate/meal/route.ts` — generation and instructed single-meal regeneration.

## Open questions / blockers

- **Q-201 needs the owner's answer** before it can be built (three-way fork above).
- **Q-187's second half — recalculating the rest of the day against what was actually eaten — has
  no design.** Worth a planning session before implementation; the owner's quote is the entire
  specification that exists.
- Nothing else is blocked.

## Pickup prompt

```
Continue the TrainingAI meal-plan work. The queue for it is drained; the next item is the
feature the owner actually asked for.

Read, in order:
  1. projectOverview.md
  2. docs/domains/nutrition/README.md
  3. docs/handoff-2026-08-13-nutrition-meal-plan-build-out.md — what shipped and what it left
  4. docs/superpowers/plans/2026-08-12-meal-plan-portions-and-editing.md
  5. docs/implementation-backlog.md — Q-187 and Q-201 are the two nutrition items left

The owner's end-game, in their words: "the meal plan will auto fill and require a yes/no if you
had the food; then as you input your actuall food it can recalculate food based on the macros
left. I.e if you eat too much during lunch it will cut some portions for other meals or vice
versa."

First action: implement Q-187 (prefill the day's food logs from the active plan, with a yes/no
confirmation per meal). Everything it needs exists — a saved plan carries a denormalised
ingredient snapshot, and app/nutrition/use-plan-meal-logging.ts + the shared logPlanMeal() are
the proven write path. Reuse them rather than writing a second one.

Do NOT fold the second half — recalculating the remaining meals against what was actually eaten
— into that PR. It has no design yet; the owner's quote above is the whole specification. Plan
it separately.

Do NOT implement Q-201 (plan meal times currently schedule nothing). It is a three-way fork the
owner must choose: (a) the plan time replaces the meal-type reminder time, (b) a second "time to
eat" stream, (c) leave them as labels. The notification surface cannot be verified from the
sandbox either. Ask, do not guess.

Constraints that will otherwise be re-discovered:
- Local SQLite v25 (saved_meals.servings) has never run on a phone. If Saved Meals comes up
  blank after an update, REVERT — do not debug forward. A blank local read is the signature of a
  failed upgrade, and this project has hit it twice (#27, #85).
- An Open Food Facts 503 is usually our own rate limiting, not OFF being down.
- Before adding a control to a plan-editing surface, grep for its sibling: the saved-plan sheet
  and the setup flow's review step are two different screens showing the same meals, and a fix
  applied to one and not the other shipped and was caught by the owner (#1289).
- There is a separate, LIVE production fault open — see
  docs/handoff-2026-08-13-platform-production-connection-starvation.md (Q-213). If the app is
  slow or unresponsive while you work, that is it, not your change.
```
