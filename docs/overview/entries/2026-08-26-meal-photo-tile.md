# 2026-08-26 — the meal photo finally renders, and every row gets the box

**Branch:** `feat/meal-photo-tile` · **Entries:** BF-32, and Q-406's thumbnail half · **Lane:** B

## The finding BF-32 named, confirmed

**The photo feature was write-only, and had been since the picker landed.**
`saved_meals.image_data_uri` round-trips through both write paths, the outbox replay and the local
mirror (Q-396); `MealPhotoTile` picks, downscales to 128 px WebP and previews it (Q-327). Nothing
rendered it — every `imageDataUri` hit in the tree was a route, an adapter or the picker. A photo
taken today was stored, synced, and never seen again.

## What shipped

- `components/nutrition/meal-thumb.tsx` (new) — the tile. A photo when there is one, the placeholder
  when there is not, in the same box at the same size.
- `food-row.tsx` — `showThumb` / `thumbSrc`, and the stale *"deliberately not here yet"* comment is
  gone. Two props rather than one nullable string, because the distinction is real: `showThumb` says
  *this list has tiles*, `thumbSrc` says *this row has a photo*. A row in a tiled list with no photo
  still gets the placeholder — which is the whole point — and one nullable prop could not say so.
- `--meal-tile-from` / `--meal-tile-to` in `globals.css`; call sites in `meal-card.tsx` (the day
  screen), `saved-meal-card.tsx` (My Meals) and `meal-detail-sheet.tsx`'s hero.

## The owner's sentence is stronger than "add a thumbnail"

> *"it should show the default one in the mockup if no image is attached."*

The placeholder is the **always-present** state, not a fallback bolted on afterwards — there is never
a row without the box, which is what stops the list reading as ragged. So the assertion that carries
the spec is the one about a meal with **no** photo: a test that only checked a photo renders would
pass against a build that draws nothing when there isn't one.

## The artboards narrowed the scope the entry's prose stated

BF-32 listed *"the day screen rows, My meals rows, Meal detail's hero, the ingredient lists"*. The
drawings put the tile on **artboards 1 and 3 only** — nine identical instances, all on meal-level
rows. Artboards 4 and 5 list ingredients with **no** tile. That is coherent rather than an omission:
the tile identifies a meal you logged, not a component of one. So `ingredient-search.tsx`,
`food-library-sheet.tsx` and the builder's ingredient list do not opt in, and `showThumb` is per call
site rather than always-on. Per BF-28, the artboard is the acceptance test.

## Decisions the entry asked to be settled rather than guessed

- **Size: 40 px, with a 9 px radius**, exactly as drawn, and the radius scales at 0.225 × size so the
  hero variant keeps the proportion.
- **The gradient is fixed, not brand-tinted.** `data-brand` is user-picked (seven colours, and BF-25
  kept that while pinning the theme); this is decoration meaning "a meal", not a brand surface, so it
  should not shift under the accent picker. Structure from the artboards, colours as tokens —
  `check-hex-literals.js` matches `#rrggbb` only, so pasted `oklch()` literals would **not** have
  failed it, which is the reason to hold to the rule rather than the check.
- **The glyph is Lucide's `Utensils`**, not the artboard's inline paths — the repo's icons come from
  Lucide, and the drawing's path data is a variant of the same icon.
- **The hero is the row's placeholder grown**, not a second design.

## Not verified

**Device.** A data-URI `<img>` inside a scrolling list is exactly the shape Samsung's WebView
compositor has mishandled before (the SVG-in-card-grid regression), and the day screen renders one
per diary row. Check a long day for compositing artefacts and for scroll jank.

**Also unexercised:** the day screen's tile is *always* the placeholder today, because a food log
points at `food_items`, which has no image column. The photo path there is untested because it is
unreachable — only saved meals can have one.
