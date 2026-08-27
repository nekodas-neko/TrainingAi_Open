# 2026-08-27 — `feat/meal-plan-library-surface` (BF-11h) — the wizard can finally reach the library, and stops dropping pins silently

**Lane B · v1.389.0 · one entry shipped (BF-11h), closing Part 2 of the library-first planner.**

BF-11g shipped the engine — the library pass, `matchReason`, `libraryMatchCount`, `droppedPins` —
and **nothing on the client sent `useLibrary` or read any of it.** A grep across `app/`,
`components/` and `lib/` returned zero hits for all four. The library search was off for every real
request since the day it landed. This is the surface.

## The four things

**1. "Use my saved meals" (→ `useLibrary`).** A switch in the *Yours* step, above the pin
checkboxes rather than below, because the distinction only reads if you meet the broad question
first: **ticking a meal forces it in; the toggle lets the planner choose.** The pin list's own
heading changed from "Keep meals from your library" to **"Always include these"** for the same
reason, and its help text now says which of the two you are looking at when the toggle is on. Off by
default — on changes what every generation returns, so it is the user's call, not a new default.

**2. Why this meal.** `matchReason` renders under the meal — but the more important half is a bug it
exposed. The existing badge keyed off `savedMealId != null` → **"Yours — kept"**, and a *library*
pick carries a `savedMealId` too. So the moment BF-11g shipped, a meal the planner **chose** started
claiming to be one the user had **pinned** — you would read it as your own decision and never
question the fit. The badge now keys off `source`, in `meal-source-badge.tsx`, with three states:
kept, chosen-for-this-slot, and (on an AI slot) *"No saved meal fitted this slot."*

That last one is only shown when `matchReason` is non-null, which the route sets **only when the
library was actually searched**. `null` and "nothing fitted" are different answers and the
distinction is load-bearing: it is the difference between *the planner ignored my meals* and *none
of them fitted here*.

**3. Reroll offers the library first, AI second.** The refresh button opens a two-way choice —
**One of mine** / **Something new** — instead of going straight to the model. `library-swap.ts`
runs `selectLibraryMeals`, the generator's own matcher, on data the client already has cached: **no
route, no model call, no cost**, which is exactly why it goes first. A second matcher would have
drifted from the one that built the plan.

`replaceMealInDraft` now carries provenance with the food. An AI reroll drops the `savedMealId`,
sets `source: 'ai'` and clears `matchReason` — carrying the old reason would explain a match that is
no longer there. A library swap sets the new link and the new reason instead, because the slot still
holds a meal the user owns.

**4. The meal-count reduction prompt.** The live silent drop, and the part the entry insisted be
*driven rather than inspected*.

`MyMealsPicker` caps pins at `mealCount - 1` **at the moment you pick** — one slot always stays open
for the plan to work with. Nothing re-checked it, and `setMealCount(Number(v))` was the entire
handler. Pin six meals at seven, go back, drop to three, and three pins vanished. The server capped
them (`kept.slice(mealCount)`) and reported `droppedPins`; nothing on the client read that field.

Now lowering the count runs `reductionNeeded(pins, next)` and, if the pins overflow, asks which to
keep — pre-ticked with the first `M - 1` in pick order so agreeing is one tap, Cancel restoring the
**previous** count (not `count + 1`: `5 → 2` is one tap on that chip row). A dropped typed meal is
**unticked, not deleted** — losing text the user typed, to answer a question nobody asked them,
would be its own small betrayal.

**Two thresholds, and the prompt uses the stricter one.** The client's is `K > M - 1`; the server's
is `K > M`. Both are correct for what they guard — the server's is a backstop against any client —
and `droppedPins` is now rendered in the review step as the last place a bypassed pin can still be
named.

## Verification

- **The regression was driven, not inspected.** With `changeMealCount` reverted to `setMealCount`,
  **both** reduction e2e tests fail; with it, all three pass. Run both ways, as with LB-20.
- 21 new unit tests: `meal-count-reduction` (9 — including that the prompt fires at `K = M`, which
  the server would have accepted), `library-swap` (8 — a swap never returns the meal already in the
  slot, never one used elsewhere in the day, respects meal-type windows, and offers an untagged meal
  anywhere), `draft-provenance` (4).
- `e2e/meal-plan-library-surface.spec.ts` stubs the library with two known meals rather than reading
  the seed: the whole reduction case turns on *how many* meals exist to pin, so a seed-dependent
  spec would pass or skip for reasons unrelated to the code.
- `pnpm check:rules` — Ran 60 of 60. Full vitest and full Playwright suites.
- Component sizes: review step 379, setup sheet 433 — both well under the 800 ceiling, with four new
  small files rather than growth in either.

## Not exercised

**The APK**, and here that matters more than usual: the reroll's library swap reads `saved-meals`
and `nutrition-meal-types` from the client cache, and on device those are also hydrated from the
local store. The web path is verified; the device path is not. No migration, no new route, no write
— so the risk is a swap offering nothing where it should offer something, not data loss.

Also untested: a plan generated with `useLibrary` **on** against a real library, end to end. The
e2e stubs the library for the wizard steps but does not run a generation, which would mean an AI
call in CI.
