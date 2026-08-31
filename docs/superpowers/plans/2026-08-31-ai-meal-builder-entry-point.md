# One AI meal builder entry point (BF-52)

**Written:** 2026-08-31 · **Domain:** `nutrition` · **Lane:** B
**Status:** plan only. Nothing here is implemented.

> The owner, device pass N5: *"I dont see a URL option or does it just go into the add ingredients?
> Id rather it just be an 'AI Meal builder' option; similar to the food logging where you can
> write/type to it - or upload a photo; or upload a URL link etc."*

---

## 1. Why the URL option is invisible, from source

Every input works. **Three of the four share one slot**, and which one appears is decided by what you
type into a field whose placeholder says *"Search your foods or the food database…"*:

| What is in the search box | What renders in the slot below it | What it produces |
|---|---|---|
| empty | **Import a recipe from a photo** (`RecipeImageButton`) | a whole ingredient list |
| looks like a URL | **Import the recipe from `<host>`** | a whole ingredient list |
| ≥ 2 characters | **Add "…" — work out its macros** | one ingredient |

Plus a barcode icon inside the field itself (BF-63), always visible, which also produces one
ingredient.

**So the field's label advertises search and its behaviour is a mode switch.** That is the complete
answer to *"I dont see a URL option"*: it is not hidden behind a menu, it does not exist until you
have already pasted the thing it imports. `ingredient-search.tsx:138` states the reasoning honestly —
*"a third permanent button would crowd the one control that matters here — the search itself"* — and
that reasoning is right about the search field and wrong about the builder, which has room above it.

**Correction to the entry:** it says the photo path *"shipped as BF-40"* and locates the URL import
in the search field. Both true, but the entry treats them as two separate discoverability problems.
They are one: `RecipeImageButton` and the URL button are **mutually exclusive renders of the same
slot**, so making either findable means taking both out of it.

## 2. The engine is already one route, and that is the argument for the whole change

`/api/nutrition/scan` accepts all three shapes in one handler — `body.image` + `mimeType`,
`body.url`, `body.text` — as three branches of one `if`. `importRecipeFrom` in
`ingredient-picker.tsx` already posts to it with either an image or a URL and shares everything
except the request body, *"extracted rather than copied: the multi-candidate branch, the serial
minting, the 0.01 floor and the `recipeYield` refusal are the parts that took two entries to get
right"*.

**So this is an entry point and nothing else.** No new extraction, no new route, no new component for
the result. The entry's recommendation is right and stronger than it knew: the three inputs are
already siblings at the API and already share a client function.

## 3. The design: split by GRANULARITY, not by input type

The four inputs are not four of a kind. **Photo and URL produce a whole meal; estimate and barcode
produce one ingredient.** Today all four sit in or beside one search field, which says they are the
same kind of thing. That conflation is the defect underneath the discoverability one.

```
Build a meal
  ┌─ Start this meal from ───────────────────────┐
  │   [ Photo ]   [ Link ]   [ Describe ]        │   ← whole ingredient list
  └──────────────────────────────────────────────┘
  Search your foods or the food database…   [barcode]  ← one ingredient
  (results · estimate · add by hand)
```

- **Mirror Log Food's capture row**, which is the owner's own comparison and a row they have just
  learned one screen away. Same tile shape, same sizing as BF-73 left it — padding-driven height,
  `h-7` icons, `text-xs` labels, and **no `min-h-[Npx]`**, which is inert on a button in this app.
- **Do NOT absorb BF-63's barcode into it**, which is what the entry asks for. A barcode names one
  product; putting it in a row headed *"start this meal from"* promises it will build a meal from a
  packet, which it cannot. It belongs where BF-63 put it — beside the search that also adds one
  ingredient. **This is the entry's one instruction the plan declines, and the reason is the
  granularity split above.**
- **`Describe` is new as a builder affordance** and is the smallest piece of the three: it posts
  `{ text }` to the same route. Today the builder's only text path is the per-ingredient estimate.
- **When to show the row.** Recommended: always, above the search, with the heading changing from
  *"Start this meal from"* to *"Add to this meal from"* once the builder holds an ingredient —
  `importRecipe` already appends rather than replaces, so the behaviour needs no change and only the
  copy does. The alternative (empty builder only) hides it exactly when someone has started by hand
  and then remembers they have a link.

## 4. What must not regress

- **`recipeYield: null` stays null.** A page that states no yield hands up null rather than
  defaulting to 1 — the banana-bread four-fold error — and the builder's batch-size field asks
  instead. The amber *"set how many portions"* line goes with it. Both import paths already refuse
  correctly; a new entry point must not add a default on the way in.
- **A multi-dish page still asks which dishes to keep** rather than adding all four meals' worth.
- **The `<input type="file">` hazard.** The builder would then have the recipe-photo input plus
  whatever the capture row adds. Two file inputs on one screen is a silent failure — the first one
  in the DOM takes the pick and the wrong one fails without a sound. Name them, and keep one.

## 5. Verification

- Each of the three inputs reaches the builder with **the same populated ingredient list it produces
  today** — the point of routing them at the existing shapes is that the result is unchanged.
- The barcode still adds exactly one ingredient, from the search, unchanged by this.
- Yield behaviour: a page with no stated yield still produces `null` and the amber line.
- **On the S25**, where N5 was reported. The row is three tiles at 412 dp — the same geometry BF-73
  measured at 79 px tall — and *"Describe or enter"* wraps to two lines in a third of that width,
  which is why the tiles must stay padding-driven rather than fixed-height.

## 6. Sequencing

Nothing blocks this. BF-63 shipped, and this plan leaves its button where it is rather than absorbing
it. **BF-52's backlog entry should carry a `Plan:` pointer** so the planning half is visibly done and
the next implementer reads this rather than re-deriving it.
