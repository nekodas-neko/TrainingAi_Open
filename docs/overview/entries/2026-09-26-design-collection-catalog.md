# The cat collection's design set is complete: 7 classes, 4 coats, 12 scenes

**Branch:** `design/collection-catalog` · **2026-09-26** · **v1.469.0**
**Follows:** [`2026-09-26-feat-collection-cat-names.md`](2026-09-26-feat-collection-cat-names.md) (#1710)
**Filed:** PS-53 (design review, Lane O, with a Tuning part) · **Catalogue:**
[`cat-collection-design-catalog.md`](../../domains/app-shell/cat-collection-design-catalog.md)

## The owner's close-out brief

*"We are just creating the designs here for now"*: enough backgrounds to assign to trophies, all the
cat sprites, animated and named, and a cat for every category worth tracking, including extras (*"we
dont need to use them all as long as they exist"*). Then merge, document, and hand review to the
Orchestrator or Tuning.

## What was added

- **Three classes**, so every trackable category has a cat: **Mage** (sleep), **Alchemist**
  (nutrition), **Monk** (mood & recovery), each with six tiers of gear. That makes seven with Tank,
  Ranger, Rogue and the Health cat.
- **Two skins, frost and ember**, for every class and tier, alongside the shiny. That is 168
  sprites in all.
- **Eight scenes**: gym, park, bedroom, kitchen, beach, snowfield, space, cherry blossom. That makes
  twelve, each with a proposed trophy in the catalogue.
- **An ear flick** added to the in-SVG animation (tail, paws, blink, bob). Every loop was checked
  frame by frame by freezing a sprite at eight points in its cycle.
- **The sleep ladder now draws the Mage.** It counts nights of sleep, and the Health cat is for
  logging, which PS-49 will build.
- **`scripts/collection-art/preview.mjs`**: an animated gallery of everything, written to the temp
  directory, for reviewers.
- `classArt(cls, tier, variant)` and `CAT_CLASSES`/`CAT_VARIANTS` in `collection-sprites.ts`. The
  drift test now covers all 180 generated files and checks that every class × tier × variant
  exists.

## Not exercised

The S25 (BF-126 `Verify: owner` covers it). Most of the new assets are not yet reachable in the app
by design: they are catalogued, not awarded.

## Gates

`pnpm check:rules`: see the PR. Collection tests pass. eslint and `tsc --noEmit` are clean.
