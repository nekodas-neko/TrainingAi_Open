# 2026-08-12 — Full-database ingredient search, gram-level meal editing, and the sheet close-button collision

**Release:** v1.290.0 · **Domain:** nutrition (plus one app-shell fix) · **Branch:** `fix/saved-meals-header-and-calories`

Four device reports from the owner, all against the Saved Meals surfaces that the Meal Plan work
had just made load-bearing.

## What shipped

**Ingredient search reaches a real food database.** Building a saved meal could only search food
items this user had already created, so the library could never grow past what was in it —
searching "Milk" returned the four things you had saved and nothing else. `GET
/api/nutrition/food-search` now queries Open Food Facts, the same source the barcode scanner
already trusts, so this adds no new dependency, no key and no new provenance to explain. Results
are labelled as external and merged below the user's own items.

Two deliberate limits on it. The route returns **only** external hits so the client can label them
rather than blending two provenances into one list. And it is documented as best-effort: on a
non-2xx or a timeout it returns `unavailable: true` and the UI says the database is not responding,
because rendering "no results" for a failed lookup is a lie. `sort_by=unique_scans_n` — the default
ordering matches on ingredient lists and returns cheese for "milk".

**Every search has a dependable exit.** Alongside the external results the picker always offers
"Add *<query>* — work out its macros", which calls the existing `POST /api/nutrition/scan` with
`{ text }`, creates the food item, and adds it to the meal. So the search box is never a dead end
regardless of what OFF has or whether it answers.

**Gram-level meal editing.** Ingredient quantity was a whole-number multiplier — `1×`, `2×`, `3×` —
which is not how anyone thinks about 40 g of oats. Each line is now a grams input backed by the
item's serving size, the ± steps went from 0.5 to 0.25 of a serving, and each line shows its own
P/C/F instead of just kcal and protein, with a running total for the meal.

**The calorie figure is a pill.** It is the one number people scan the saved-meal list for and it
was one item in a dot-separated run-on.

**The close X no longer sits on the New Meal button.** `SheetHeader` now reserves the corner the
close button occupies, for every sheet in the app.

## The two things worth remembering

**A shared-component fix can be silently overridden by its call sites.** The first attempt put
`pr-16` on `SheetHeader`'s outer element and measurably changed nothing: eight sheets pass `px-*`
to that className, and tailwind-merge lets the later class win. The reservation had to move to an
inner wrapper div where no call site can reach it. The comment in `components/ui/sheet.tsx` says so.

**And then the size was wrong.** With the reservation safely on the inner element, measurement
still showed a 12px overlap — `pr-12` (48px) is measured from the *header's* content edge, but the
close button is positioned from the *SheetContent's* edge, and `px-1` at this call site leaves only
4px between them. `pr-16` (64px = the button's 48px plus its 16px offset) is the number that holds
whatever horizontal padding a call site passes, since it can only ever over-reserve. Measured at
412px: `NewMeal` 236–344, close 348–396.

Both halves were found by measuring boxes in a headless browser at the S25 viewport, not by reading
the screenshot. Neither would have been caught by looking at the code.

## A bug found while verifying

The OFF serving-size parser — extracted from the barcode route, pre-existing behaviour — matched
`(\d+)\s*g` with no boundary, so **"1 glass (200 ml)" read the "g" of "glass" and returned a
one-gram serving**, dividing every macro by a hundred. Text search is what made it visible: a list
of oat drinks came back as "1 g · 44 kcal". The unit now has to be followed by a non-letter, `ml` is
read as the same number of grams (OFF states beverages per 100 ml), and the bare-`parseFloat`
fallback that produced the bug is gone. Pinned by
`packages/shared/src/nutrition/__tests__/open-food-facts.test.ts`. This fixes the **barcode**
scanner too, which shared the same code.

## Not exercised

- **Not verified on device.** Native SQLite, safe-area insets and Samsung's WebView renderer are
  all absent from the sandbox. The gram inputs, the new picker and the sheet-header change are all
  measured in headless Chromium at 412×915 only.
- **Open Food Facts availability is not under our control.** It answered every probe during this
  session (3/3 at ~1.3 s) but returned 503 on an earlier one, which is exactly why the unavailable
  state exists. The failure path was exercised — the UI rendered the "not responding" copy for real
  during verification.
- No new migration, no schema change, no sync-path change in this release.

## Files

| Path | Change |
|---|---|
| `packages/shared/src/nutrition/open-food-facts.ts` | New — OFF product → nutrition shape, shared by barcode and search |
| `packages/shared/src/nutrition/__tests__/open-food-facts.test.ts` | New — 8 tests, including the "1 glass" regression |
| `app/api/nutrition/food-search/route.ts` | New — OFF text search, rate-limited, fails to an honest unavailable state |
| `app/api/nutrition/barcode/route.ts` | Now calls the shared parser instead of its own copy |
| `components/nutrition/ingredient-search.tsx` | New — extracted so `saved-meals-sheet.tsx` stays under 800 lines (831 → 737) |
| `components/nutrition/saved-meals-sheet.tsx` | Gram inputs, per-line macros, AI-estimate add, external-food add |
| `components/nutrition/saved-meal-card.tsx` | Calorie pill |
| `components/ui/sheet.tsx` | Close-button clearance on `SheetHeader`, override-proof |
