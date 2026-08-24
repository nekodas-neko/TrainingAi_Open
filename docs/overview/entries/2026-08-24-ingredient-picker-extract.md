# The ingredient picker comes out of the saved-meals sheet (BF-11a)

**Branch:** `refactor/ingredient-picker-extract` · **Lane B** · no version bump — nothing user-facing
changed

## What shipped

`components/nutrition/ingredient-picker.tsx` (227 lines), holding the ingredient-**acquisition**
half of `saved-meals-sheet.tsx`: the two searches, their two debounce clocks, and the three add
paths (Open Food Facts, AI text estimate, add-by-hand).

`saved-meals-sheet.tsx`: **774 → 590 lines**. It was 26 lines under `check-component-size.js`'s
800-line ceiling and is not one of the five recorded hotspots, so it fails CI the moment it crosses
— and BF-11c/d land four features in it. The target was ~600.

## It pairs with `ingredient-search.tsx` rather than duplicating it

The plan asked for this to be said either way. `ingredient-search.tsx` draws the results and owns no
state; `ingredient-picker.tsx` owns the searches, the clocks and the three add paths, and renders it.
Neither is useful without the other and neither repeats the other's job, so a wrapper name would have
been the misleading one.

## The one mechanism that changed, and why

`openBuild` used to reset the picker by calling `setQuery('')`, `setSearchResults([])` and
`setShowAddFood(false)` directly. Those setters now live in the child, so the parent bumps a
`buildSession` counter and passes it as `key` — a remount, which is what actually clears that state.

**Driven, not assumed:** typed `chicken` in one build session, went back, opened build again — query
`""`, no stale results. That is the behaviour the three setters produced.

The three load-bearing comments the plan names all moved with their code: the two separate search
effects and why chaining them was wrong, the 700 ms Open Food Facts debounce against the 250 ms one
(OFF rate-limits to ~10/min), and `addExternalFood`'s `source: 'text'` — a name search is not a
barcode.

## Verification

Driven in a browser against `pnpm dev` + local Postgres, through the real sheet:

- **Library search** — `GET /api/nutrition/food-items?q=chick` at the 250 ms clock.
- **Open Food Facts** — `GET /api/nutrition/food-search?q=chicken` at the 700 ms clock, **real
  results** (Drava Chicken pate, Campbell's Chicken Stock, …). Both effects fired independently, which
  is the property the separate-effects comment exists to protect.
- **Add from OFF** — ingredient added, query cleared.
- **AI text estimate** — "two boiled eggs" → 160 kcal · 14.3P · 1.1C · 11F, added.
- **Add by hand** — reachable on a query neither source matches, and the form still opens pre-filled
  with the typed name.
- **Quantity units** — toggled srv ↔ g on the added row.
- **Save and reopen** — the meal lands in `saved_meals` + `saved_meal_items` with the right food item,
  and reopening shows it identical: 149 kcal, 48 g, P 4.8 / C 1.2 / F 13.8.
- Zero page errors throughout.

`tsc --noEmit` clean · `eslint` zero warnings introduced (the file's 3 are pre-existing unused
imports — `Sparkles`, `cn`, `cancelMealReminder` — left alone to keep the diff a move) ·
`pnpm check:rules` **Ran 55 of 55** · `check-component-size` clean.

Diff shape is what a move should look like: **10 insertions, 191 deletions** in the old file against
227 lines of new file.

## Not exercised

**Nothing on the S25.** This is a browser-verifiable refactor with no native path, so the device risk
is low — but `getLocalStore` returns null in the sandbox, so the picker's **local-first branch**
(`store.searchFoodItems(query)`, the offline half of the library search) never ran. It moved
unchanged, and the server revalidation that runs beside it was exercised.

**The offline hint was not triggered** — `offlineHint()` reads `navigator.onLine`, and the probe was
online throughout.

## A harness note worth carrying

`page.click()` on the Nutrition tab's **Saved Meals** button does not open the sheet — on `main` as
well as here, checked by stashing. `touchscreen.tap()` at the element's centre opens it in 1.5 s.
Anything driving that sheet needs the tap.
