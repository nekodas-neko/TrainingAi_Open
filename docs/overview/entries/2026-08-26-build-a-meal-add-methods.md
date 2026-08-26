# 2026-08-26 — Build a Meal gains a recipe link, and the divide that was already done

**Branch:** `feat/build-a-meal-add-methods` · **Entry:** BF-11c · Implementation Lane B

BF-11's original ask: the recipe scan reachable without starting the whole plan wizard. Three
add-methods beside the existing search, none replacing anything.

## What shipped

**A pasted `https:` link imports the recipe.** It replaces the AI-estimate offer rather than sitting
beside it — running an estimate over the text of a URL produces a food called *https* with invented
macros, which is worse than no offer. Each ingredient is created through `ingredientToEntry`, the
same conversion the plan's copy-to-library path uses, so a recipe imported here and the same recipe
saved from a plan mint identical food items. It stores per 100 g with the weight in the quantity, so
the library gains *Cooked quinoa* rather than *Cooked quinoa (236 g)*.

**A page holding several dishes asks which to keep.** The scan route's prompt is explicit that
separate portions are separate candidates — a page listing four recipes is four — and the response's
top level is only `candidates[0]`, so filling the builder from it and stopping silently discarded the
rest. Each kept dish becomes **its own** saved meal, and nothing is minted until the user chooses.

**The picker's default list is headed.** See the correction below.

## The bug this entry warned about, written and then found

BF-11c says a *"makes 12"* recipe must land as `servings: 12` with the whole recipe's items, because
`SavedMeal.totals` is the whole batch by contract and `oneServingItems()` is the one place that
divides. The contract is right. **The premise under it is not: `/api/nutrition/scan` already
divides.** `toMeal` runs `perServing(c.ingredients, servings)` before it answers, so a page stating
*makes 12* comes back as **one slice**.

The first commit on this branch set `servings = recipeYield` on those already-divided ingredients.
That is the exact double-divide the entry warns about, arrived at by following the entry: every log
would have been **a twelfth of a slice** — a plausible-looking number, twelve times too small.

Found by reading `toMeal` while scoping the candidate picker, not by a test. So the decision is a
pure function with tests now (`recipe-import.ts`, `recipeBuilderPatch`): both divides are correct in
isolation, they live in different files, and the failure is silent.

**What shipped is `servings: 1`** — exact, no divide-then-multiply round trip, and the same encoding
`savePlanMealToLibrary` already uses. Honouring the entry's literal shape would have meant
multiplying the route's division back out, which is lossy for no gain.

**The unstated-yield case is unaffected and is the one that still needs asking.** `recipeYield: null`
makes the route's divisor 1, so nothing is divided and what arrives IS the whole batch — a
banana-bread page measured 1,956 kcal for the loaf. Left alone that silently becomes one portion, so
the builder says so in an amber line pointing at the batch-size field directly above it.

## The History item was already built

§5.3 asked for a default list *"rather than a blank state"*, on the premise that the picker was
type-to-search only. It was not. `searchFoodItems('')` returns the twenty most recently updated
foods — its own comment calls it *the browse-all path* — and `IngredientPicker` already fetched with
an empty query on mount and rendered the result unconditionally.

What it actually lacked was a **heading**, next to a *Food database* heading that had one. That is
what shipped: `Recently used` before you type, `Your foods` after.

## Decisions worth not re-deriving

- **The candidate list does not use `food-row.tsx`.** §5.4 deferred this to a design answer that has
  since arrived: Q-406 shipped, all four call sites converted, and the owner's concession was **one
  optional string**, not a node. A keep/discard control is a trailing *control* rather than a value,
  so it is the wrapper move that concession avoided. Drawn separately, and the plan says so now.
- **Kept candidates are saved, not merged.** A page of four dinners is four things you log
  separately; combining them produces one meal nobody eats.
- **`asHttpsUrl`/`hostOf` moved to `recipe-url.ts`** — both surfaces that accept a recipe link now
  agree on what one is by construction rather than by both being written correctly.

## Two extractions, both forced by the 800-line ceiling

`saved-meals-sheet.tsx` hit it twice. `meal-batch-size.tsx` came out first (the unstated-yield
prompt), then `meal-builder-footer.tsx` (the candidate picker). Both are memoised with scalar props —
they re-render on every keystroke in the ingredient list, and an object prop would defeat the memo
silently. The file ends at **786**, with BF-11d and BF-11f still due to land in it.

## Verification

- `npx tsc --noEmit` clean · lint clean on `components/nutrition`
- `pnpm check:rules` — **Ran 60 of 60**, all passed. It caught one real thing: an inline arrow into
  memoised `MealBatchSize`, which is the rule working rather than a formality.
- Unit suite — **5,208 passed / 57 skipped**, including 7 new tests on the divide
- `check-component-size` — nothing over 800 beyond the four recorded hotspots

### Failure surfaces NOT exercised

- **A real recipe page.** Every scan here is the live Gemini route against a live URL, so nothing in
  the sandbox exercises it end to end — the candidate path in particular has never seen a real
  multi-dish page, only the shape the route promises.
- **The S25.** A new list with a keep/discard control, and a moved footer. `Gate: device`.
- **The native local store.** `createFoodItem` and `savePlanMealToLibrary` both take their web
  fallback here; the offline branch that queues N mutations is device-only.
