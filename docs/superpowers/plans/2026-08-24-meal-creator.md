# BF-11 Part 1 — the Meal Creator ("Build a Meal")

**Status:** plan · **Date:** 2026-08-24 · **Author:** planning session (owner-directed, from BugFix)
**Backlog entries:** BF-11a · BF-11b · BF-11c · BF-11d
**Design:** [`2026-08-24-meal-creator-and-planner-design.md`](../specs/2026-08-24-meal-creator-and-planner-design.md) items 1–5
**Part 2** (the planner) is a separate document:
[`2026-08-24-library-first-meal-planner.md`](2026-08-24-library-first-meal-planner.md). It depends
on this one shipping first — the owner's sequencing, stated twice.

This plan does **not** re-open the design. The owner settled the shape; this covers what the trace
found, which of the design's assumptions moved under it, and the build order.

---

## 1. Re-verification against `main` @ `3034169` (2026-08-24)

Everything the design cites still holds. Four things worth stating because they are load-bearing:

| Design claim | Verified | Note |
|---|---|---|
| `my-meals-picker.tsx` is the **only** `{ url }` sender | ✅ line 118 | Five files call `/api/nutrition/scan`; only this one can send a URL |
| Build a Meal sends `{ text }` only | ✅ `saved-meals-sheet.tsx:249` | `estimateAndAdd`, one ingredient at a time |
| `ScanSchema` returns exactly one meal | ✅ route lines 29–40 | One `name`, one `ingredients[]`, every input mode |
| Log Food's **History** action exists | ✅ `capture-step.tsx:245` | `onMyFoods` — the reusable source item 3 asks for |

**What moved since the design was written**, and neither invalidates it:

- **`food-row.tsx` shipped** (Q-406, v1.338.0) and the library sheet already draws it. New rows added
  by this plan should use it rather than inventing a fifth row shape — but see §5, the row's only
  trailing element is a chevron and two call sites are deliberately unconverted.
- **#407 added `.strict()`** to `keepMeals` in the planner route (Q-464's sweep). Part 2's concern,
  recorded so nobody reads it as drift.

### The headroom problem is real and measured

```
components/nutrition/saved-meals-sheet.tsx   774 lines   (ceiling 800)
app/nutrition/nutrition-content.tsx          789 lines   (ceiling 800)
```

**26 lines of headroom** in the file that receives four features. `scripts/check-component-size.js`
fails CI on any new `.tsx` over 800 outside its five recorded hotspots, and `saved-meals-sheet.tsx`
is **not** one of them. Extraction is therefore not hygiene here, it is the precondition — which is
why it is its own entry (BF-11a) rather than a first commit somebody skips under time pressure.

---

## 2. Build order

```
BF-11a  Lane B   extract the ingredient picker         (no behaviour change)
BF-11b  Lane A   scan route returns N candidates       (additive, back-compatible)
BF-11c  Lane B   URL add-method + candidate picker + History quick-add
                                                        Needs: BF-11a, BF-11b
BF-11d  Lane B   duplicate detection on save            Needs: BF-11c
```

**Lane assignment comes from the §3 rule, not from BF-11's old `Lane: B` line.** The scan route is
`app/api/**`, so BF-11b is **Lane A** and the engine half lands first. Everything else is
`components/**` only → Lane B.

BF-11c and BF-11d are one screen and one `pnpm dev` pass; an implementer may batch them under a
shared `Batch:` slug if BF-11c's save path lands unchanged. They are filed separately because BF-11d
is genuinely deferrable and BF-11c is not.

---

## 3. BF-11a — extract the ingredient picker (Lane B)

**No behaviour change. That is the whole point** — a refactor that also changes behaviour cannot be
reviewed as either.

`saved-meals-sheet.tsx` currently holds, in one file: the meals list, selection mode, bulk delete,
the build/edit form, the ingredient search (own library **and** Open Food Facts on two different
debounce clocks), `estimateAndAdd`, `addExternalFood`, `addIngredient`, per-ingredient quantity
editing in servings-or-grams, the add-food-by-hand form, and the label path.

Extract the **ingredient acquisition** half — search, external results, AI estimate, add-by-hand —
into `components/nutrition/ingredient-picker.tsx` (name it against the existing
`ingredient-search.tsx` so the two do not read as duplicates; if the seam lands better as an
extension of that file, say so in the PR rather than creating a near-twin).

Carry the comments. Three of them are load-bearing and were written from incidents:

- the **two separate effects** for own-items vs Open Food Facts, and why chaining them was wrong
  (a slow library fetch delayed the database section; a stalled one removed it);
- the **700 ms** OFF debounce and why it is not the 250 ms one (OFF rate-limits to ~10/min);
- `addExternalFood`'s `source: 'text'` and why a name search is not a barcode scan.

**Verification.** `pnpm dev`: build a meal from a library item, an OFF item, an AI text estimate and
a hand-entered food; edit quantities in both units; save; reopen and confirm the meal is identical.
The diff should be a move, so `git diff --stat` showing roughly equal insertions in the new file and
deletions in the old is the shape to expect.

**Target:** `saved-meals-sheet.tsx` under ~600 lines, which leaves BF-11c and BF-11d room to land
without a second extraction mid-flight.

---

## 4. BF-11b — the scan route returns N candidates (Lane A)

### 4.1 The change

`ScanSchema` gains a candidates array. **Additively** — the call sites read the current single-meal
shape today and must not break.

> **⚠ Corrected 2026-08-25 while implementing.** This said *four* call sites and named
> `saved-meals-sheet.tsx`, which **does not call this route** (its `fetch` goes to
> `/api/nutrition/saved-meals`). There are **five**, and the two it missed are the ones that matter
> most to the no-breaking-change rule: `my-meals-picker.tsx` reads `body.ingredients` and
> `ingredient-picker.tsx` gates on `scan.calories > 0`, so both fail silently if the top level ever
> becomes an array. The real list is `my-meals-picker.tsx`, `capture-step.tsx`, `review-step.tsx`,
> `ingredient-picker.tsx`, `meal-backfill-section.tsx`.

The shape that keeps them working is a response whose **top level is unchanged** and which carries
the extra candidates alongside:

```
{ …the existing single-meal fields…,      // = candidates[0], so old callers see the first dish
  candidates?: [ { name, brand, confidence, notes, ingredients[], fiberG, … }, … ] }
```

**Do not** flip the top level to an array. That is a breaking change to four callers for the benefit
of one, and three of those callers (a photo of one plate, a text correction, an end-of-day backfill)
are single-dish by nature and will never want the array.

The model half is a prompt change plus a schema change: the system prompt today says *"For a simple
single food… return exactly one ingredient covering the whole portion"* — which is right per-dish and
must stay — with a new instruction that **distinct dishes** become distinct candidates, and that one
plated meal is one candidate however many components it has. That distinction is the whole risk in
this item: a photo of a curry, rice and naan is **one** meal, not three, while a photo of five
meal-prep tubs is five.

### 4.2 What to pin, because this is a model behaviour and models drift

The route has no test today. Add fixture-driven tests for the **splitting decision**, not the
macros: given a description of five labelled containers → five candidates; given one plated dinner
→ one candidate; given a recipe page with a single recipe → one candidate. Assert the count and the
names, never the calories, or the test becomes a model-output snapshot and fails on every prompt
tweak for no reason.

### 4.3 Bounds

- Cap `candidates` at a small number (**8** is generous against any real meal-prep photo) so a
  hallucinated 40-item split cannot reach the client.
- `identified: false` keeps its current meaning and returns no candidates.
- The URL branch's `recipeYield` / `perServing` divide is **per candidate**. A page yielding 12
  servings across 3 recipes divides each of them by its own yield, not the page's. If the page
  states one yield and the model returns several dishes, that is ambiguous — apply the stated yield
  to each candidate and say so in `notes`, because the alternative (refusing) breaks the common case
  of one recipe on the page.
- No new rate limit — the existing `10/60s` per user already covers this route.

---

## 5. BF-11c — Build a Meal gains URL, candidates and History (Lane B)

Three additions to the extracted picker. All three are add-methods sitting beside the existing
search box; none replaces anything.

### 5.1 URL (design item 1)

The route already accepts `{ url }`. The client work is: detect an `https:` URL in the input,
POST `{ url }` instead of `{ text }`, and handle the **unstated-yield** case.

**Reuse `my-meals-picker.tsx`'s handling rather than re-deriving it** — it is already correct and it
was expensive to get right: `recipeYield: null` means the payload is the **whole recipe** (a
banana-bread page measured 1,956 kcal for the loaf), so the row asks *"how many does it serve?"* and
**cannot be kept until answered**. `perServing` (`packages/shared/src/nutrition/scan-totals.ts`) is
shared with the route so the two divides cannot drift. Use it here too — a second divide is exactly
the 4× calorie error that looks entirely plausible.

**One genuine difference from the wizard's version, and it is the interesting part.** In the wizard
the answer feeds a plan row. In Build a Meal there is already a first-class home for it:
`SavedMeal.servings`. A recipe importing as "makes 12" should land as `servings: 12` with the whole
recipe's items, **not** as a pre-divided single portion — because `SavedMeal.totals` is the whole
recipe by contract (`oneServingItems()` is the one place that divides, and both the log path and the
plan conversion call it). Pre-dividing here would make the saved meal lie about its own batch size
and would double-divide on log.

**⚠ CORRECTED 2026-08-26 — the route ALREADY pre-divides, so this instruction inverts.**
`/api/nutrition/scan`'s `toMeal` runs `perServing(c.ingredients, servings)` before it answers, so a
page stating *makes 12* comes back as **one slice**, not the loaf. Setting `servings: 12` on top of
that is the very double-divide this paragraph warns about — it logs a twelfth of a slice. The
contract above is right and the premise underneath it was wrong. What shipped is **`servings: 1`**,
which is exact (no divide-then-multiply round trip) and is the same encoding `savePlanMealToLibrary`
already uses. The decision is `recipeBuilderPatch` in `components/nutrition/recipe-import.ts`, with
tests, because both divides are correct in isolation and the failure is silent.

**The unstated-yield case is unaffected and is still the one that needs asking.** `recipeYield: null`
makes the route's own divisor 1, so nothing is divided and what arrives IS the whole batch.

### 5.2 Multi-candidate picking (design item 2)

When `candidates.length > 1`, show them as a list: name, calorie figure, item count, a keep/discard
per row. The user picks which to save. Each kept candidate becomes **its own saved meal** — that is
what "create a meal from each item" means.

Per-candidate adjustment before saving comes free if each kept candidate opens into the same build
form the manual path already uses. Do not build a second editor.

### 5.3 History quick-add (design item 3)

The narrowest of the three. Log Food's capture step already surfaces previously-used food items via
its **History** action; Build a Meal's picker is type-to-search only. Wire the same data source in
as a default list — what shows before you have typed anything, rather than a blank state.

**Reuse the existing source.** The design's first draft called this "doesn't exist" and was wrong;
the correction is recorded in the design doc and is the reason this item is small.

**⚠ MEASURED 2026-08-26, while building it: the picker was never type-to-search only.**
`searchFoodItems('')` returns the twenty most recently updated foods — its own comment calls this
"the browse-all path" — and `IngredientPicker` already fetched with an empty query on mount and
rendered the result unconditionally. So the default list was already there. What it lacked was a
**heading** saying what you were looking at, beside a *Food database* heading that had one; that is
what shipped. (`onMyFoods`, which this paragraph used to point at, was removed by LB-16.)

### 5.4 Row shape

`food-row.tsx` exists and the library sheet draws it. Use it for the History list. **Do not** force
it onto the candidate list without checking: its only trailing element is a chevron, and Q-406
records that adding slots for a per-row warning or spinner is what turns it into a wrapper rather
than a unification. A candidate row needs a keep/discard control, which is a trailing element the
agreed row does not have.

**RESOLVED 2026-08-26 — the candidate list is drawn separately** (`recipe-candidates.tsx`), and the
design answer this deferred to has since arrived. Q-406 shipped: all four call sites converted, and
the owner's concession was **one optional string** (`warning`), not a node. A keep/discard control is
a trailing *control* rather than a value, so it is the wrapper move that concession deliberately
avoided.

---

## 6. BF-11d — duplicate detection on save (Lane B)

Owner: *"happy to have this workflow for now"* — build it as designed, refine on use.

On save, if the new meal is close to an existing saved meal, ask **"you already have something like
this — update it or save as new?"**

**Close** needs a definition, and there is already one in the repo worth reusing rather than
inventing a threshold: `fitDistance(actual, target)`
(`packages/shared/src/nutrition/meal-macro-fit.ts`) reduces a macro comparison to one comparable
number, relative rather than absolute, and is documented as existing *"so two candidate versions of
the same meal can be compared without a second opinion about what 'better' means."* That is exactly
this question. Pair it with a normalised name comparison; **require both** to be close, since macros
alone will match every protein shake against every other one.

**SHIPPED 2026-08-26.** `components/nutrition/meal-duplicate.ts` → `findDuplicateMeal`, with tests.
Two things the plan did not know: BF-11c added a **second save path** (`keepCandidates`, N meals at
once), and four dialogs for four dishes is not asking — so on that path the ask is the tick that is
already there, with duplicates unticked and labelled *already in your meals*. The name test is
**equality after normalisation, not fuzzy**, following BF-38's *prefer under-merging*: a duplicate is
deletable, an offer to overwrite the wrong meal is not.

Three rules that keep this from being annoying:

- It **asks**, never merges. "Save as new" must always be one tap and must be the safe default if
  the sheet is dismissed.
- It runs on save, not on every keystroke.
- "Update it" overwrites the existing meal's items and keeps its id — which matters, because
  `meal_plan_meals.saved_meal_id` and the printed label both reference that id. Changing the id
  would orphan a label the owner has already stuck on a container.

---

## 7. What this plan does not do

- **No PDF support.** Descoped by the owner: screenshot it and upload as an image. The scan route's
  MIME allowlist (`ALLOWED_IMAGE_MIME` — JPEG/PNG/WebP) is unchanged.
- **No migration.** Nothing here changes a table. Part 2's tag join is the only schema work in BF-11,
  and Lane A numbers it there.
- **No rename.** Q-395c renames `Saved meals`/`My Meals` → `My Foods` and merges `FoodLibrarySheet`
  into `SavedMealsSheet`. This plan deliberately leaves every user-facing string alone — see §8.

---

## 8. Collision with the Q-406 → Q-395a/b/c chain — read before starting

**That chain is parked on `Gate: owner`** (Q-395's reference drawings, `unit-options.png` among
them, were never committed to `docs/design/`). It may land before this, after this, or not at all.
**Do not plan around it landing, and do not wait for it.**

Where the two touch the same file:

| Q-395 phase | Touches | Collision with this plan |
|---|---|---|
| Q-395a | Edit Meal's collapsing rows — `saved-meals-sheet.tsx` | **Direct.** Both edit the build form. BF-11a's extraction *helps* here: it gives Q-395a a smaller file to change. |
| Q-395c | Merges `FoodLibrarySheet` + `SavedMealsSheet`, renames to `My Foods` | **Direct and larger.** Q-395c's own entry says to diff the two sheets and carry every action across. **Whatever this plan adds becomes part of that diff.** |

**The rule for whoever lands second:** Q-395c's instruction is to carry every action across or say in
the PR which was dropped. If Q-395c lands after BF-11c, the URL add-method, the candidate picker and
the History list are actions that must survive the merge. Add them to Q-395c's carry-across list in
the same PR that builds them, so the list is complete before anyone reads it as complete.

If Q-395c somehow lands first, BF-11c targets the merged sheet instead. Nothing in this plan depends
on which sheet it is, only that Build a Meal is reachable — which is why the entries name the
*capability*, not the filename, where they can.

---

## 9. Verification

Per phase, and none of it is optional:

- **BF-11a** — the four add paths still work, meals round-trip unchanged, file under ~600 lines.
- **BF-11b** — the fixture tests in §4.2, plus the four existing callers exercised at runtime
  (`pnpm dev`) to prove the additive shape really is additive. A type-check passing is not that
  proof; the callers read fields off a JSON response.
- **BF-11c** — a real recipe URL end-to-end (a page that states a yield, and one that does not);
  a multi-dish image producing more than one candidate; History showing before any typing.
- **BF-11d** — save a near-duplicate and take both branches; confirm "update" keeps the id by
  checking a plan meal or label that references it still resolves.

**Not exercisable in the sandbox, and must be said plainly when this is presented:** the native
camera branch, the on-device SQLite write path for saved meals (`getLocalStore` returns null in the
web sandbox, so every local-first assertion here is untested), and safe-area/tap-target behaviour on
the S25. Saved-meal offline create/edit/delete is a sync domain that is **already** flagged
not-device-verified in the pillar index; this plan does not clear that, and BF-12's open question
about a dead local store on the owner's device sits underneath all of it.
