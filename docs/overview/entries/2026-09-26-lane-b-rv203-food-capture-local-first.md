# 2026-09-26 — `lane-b/rv203-food-capture-local-first` (RV-203 ① and ③) — the user's own foods, offered before the model is

**Lane B · one entry part-shipped (RV-203), two filed (LB-158, LB-159).**

RV-203 is a Review sweep-61 finding: `nutrition-scan` is the second-largest AI user at 29 calls in
30 days, and four of its call sites ask the model something the device already knows. Two of the
four shipped here. One turned out to be unbuildable in this lane and is now **LB-158**. One is a
question rather than an implementation and is now **LB-159**.

## ① Describe went to the model without looking at the user's own foods

Typing *"chicken breast"* into **Describe or enter** posted straight to `/api/nutrition/scan`, so a
food already saved with real macros was re-estimated every time — and the flow failed outright with
no network. The panel now lists matching saved foods and saved meals above the Analyse button.

**Nothing is fetched for it.** Three sources, all already present: the local store's full
`searchFoodItems` LIKE (the half that works offline and reaches past twenty rows), the
`ALL_ITEMS_KEY` list the sibling `FoodList` already seeds (the web build, which has no local
store), and the parent's `savedMeals` array. A search-as-you-type cache key would churn for no
benefit, and the one route that could serve it is already read by the list behind the panel.
`check-bare-api-fetch.js` holds this file at its existing count of 1.

**The raw text cannot be the query, and that is the part worth remembering.** `searchFoodItems` is
`name LIKE %q%`, so the entry's own example — *"200g chicken breast with white rice and broccoli"* —
matches nothing as one substring. `describe-search-phrase.ts` reduces a description to the food
name it is about: it strips a leading quantity and unit, strips "some/a/the/my", and returns `null`
for anything that names more than one food. A composite meal is not a row in `food_items`, and a
partial match for one would be worse than no match.

One bug found by its own test while writing it: the unit alternation is **not** end-anchored, so
`cup` matched before `cups` and reduced *"2 cups of oats"* to *"s of oats"*. The alternatives are
now ordered longest-first and five plural units are pinned as regression cases.

**Analyse is untouched**, which is what makes a wrong phrase cheap: it costs a list nobody taps.

## ③ "It was 300g" asked the model to redo the whole estimate

The Refine box posted the estimate back to `/api/nutrition/scan` for every correction, including
the most common one there is — the portion, which is the one thing a photograph cannot tell the
model. The Review sheet's serving-size field already rescales every macro from a base snapshot, so
*"it was 300g"* has an exact local answer; asking the model produced a *different* one for no
reason, cost a round trip, and failed with no network.

`portion-correction.ts` is deliberately timid, and **the asymmetry is the whole design**: a miss
costs one model call, which is exactly today's behaviour, while a false positive silently rescales
the user's macros with nothing on screen to say the model was skipped. So it refuses unit-less
numbers, millilitres (grams are what the row stores, and ml→g is a density this app does not know),
and anything with a second clause — *"it was chicken thigh not breast"*, *"300g and it was fried"*
and *"double it"* all still go to the model. An estimate that arrived with no serving size has no
base to scale from, so it asks the model too.

Mutation-tested: dropping the gram ceiling and making the unit optional each break a different
assertion.

## ② Barcode — blocked, and the entry did not know why

RV-203 ② asks for "look up the user's saved foods by barcode first". There is nothing local to look
it up in: `food_items.barcode` exists on the server (`schema.ts:691`) and **nowhere on the device**
— not in `CREATE_FOOD_ITEMS`, not on `LocalFoodItem`, not in `foodItemRowToItem`, so the pull delta
drops it silently. That is a local SQLite version bump, which is Lane A's alone. Filed as
**LB-158**; the Lane B half afterwards is three lines at `handleBarcode`.

## ④ Meal plans — a question, not an implementation

RV-203 ④ wants `useLibrary` defaulted on. That changes what every generated plan contains, and the
off-by-default was a written choice rather than an oversight (BF-11h, 2026-08-27: *"on changes what
every generation returns, so it is the user's call rather than a new default"*). Filed as
**LB-159**, `Lane: O`, with the recommendation attached — default on when the library is non-empty,
off when it is empty — and the alternative's genuine upside stated: an invented plan is where new
meals come from.

## Not exercised

- **The offline half of ① is unverified here.** `getLocalStore` returns null in the sandbox and in
  vitest, so the suggestion list's local-store branch never ran; what ran was the seeded-cache
  branch. There is no DOM project in this suite either, so the wiring is held by source assertions
  (`rv203-local-first-capture.test.ts`) rather than by rendering.
- Native SQLite, Samsung WebView, safe-area insets and drifted production data: untouched.
- **Device pass test**, recorded on the entry: on the S25 in airplane mode, Log Food → Describe →
  type the name of a food logged before → it appears under *"You already have"*, and tapping it
  reaches the assign step.
