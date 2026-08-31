# BF-52 — the URL option is not hidden, it does not exist until you have already pasted the URL

**Branch:** `docs/bf-52-meal-builder-entry-plan` · **Lane B** · docs-only (planning PR, no version bump)

BF-52 is marked a planning item, so this is its PR 1. No code.

## What the inventory found

The owner asked *"I dont see a URL option"*. Everything works; **three of the four inputs share one
slot**, and which appears is decided by what is typed into a field whose placeholder reads *"Search
your foods or the food database…"*:

| Search box | Slot below it | Produces |
|---|---|---|
| empty | Import a recipe from a photo | a whole ingredient list |
| looks like a URL | Import the recipe from `<host>` | a whole ingredient list |
| ≥ 2 characters | Add "…" — work out its macros | one ingredient |

Plus the barcode icon inside the field (BF-63), always visible, also one ingredient.

**So the field's label advertises search and its behaviour is a mode switch.** The URL option is not
behind a menu — it does not exist until you have already pasted the thing it imports.

**That sharpens the entry rather than restating it.** BF-52 treats the photo path and the URL import
as two separate discoverability problems. They are one: those two buttons are *mutually exclusive
renders of the same slot*, so making either findable means taking both out of it.

## The engine is already one route

`/api/nutrition/scan` takes all three shapes — `image` + `mimeType`, `url`, `text` — as three
branches of one handler, and `importRecipeFrom` already posts to it with either an image or a URL,
sharing everything except the request body. So this is an entry point and nothing else: no new
extraction, no new route, no new result component. The entry's recommendation is right and stronger
than it knew.

## The one instruction the plan declines

BF-52 says to absorb BF-63's barcode button into the new capture row. **The plan declines, and the
reason is a split the entry does not draw.** The four inputs are not four of a kind: photo and URL
produce a **whole ingredient list**; the estimate and the barcode produce **one ingredient**. A
barcode inside a row headed *"start this meal from"* promises it can build a meal from a packet,
which it cannot. So the split is by granularity — a `Photo · Link · Describe` row above the search,
and the barcode beside the search where BF-63 already put it.

That is written into the entry as a strike-through with its reason, not only into the plan. An
instruction quietly not followed is worse than one argued with in writing.

## Also carried

`Describe` is new as a builder affordance and is the smallest of the three — it posts `{ text }` to
the same route. `recipeYield: null` must stay null (the banana-bread four-fold error), and the
builder's batch-size field asks instead. And the builder would then hold two `<input type="file">`s:
the first in the DOM takes the pick and the wrong one fails silently, so they need naming or merging.

## Not exercised

- **No code changed.** Verified by `pnpm check:rules` (**Ran 65 of 65**), `check-backlog-pointers`
  (235 entries) and `check-doc-index-size`.
- **The row's geometry at 412 dp is inherited, not re-measured.** BF-73 measured those tiles at 79 px
  with padding-driven height; whether *"Describe or enter"* wraps acceptably in a third of the
  builder's width is a device question.
