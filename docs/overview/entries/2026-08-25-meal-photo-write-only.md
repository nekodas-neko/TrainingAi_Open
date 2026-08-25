# 2026-08-25 — the meal photo is stored, pickable, and displayed nowhere

**Branch:** `feat/meal-photo-and-detail` · docs-only · BugFix Intake

## What the owner found

Reviewing the artboards against the app:

> *"I dont see this screen yet — Some are similar but not the same (i.e no spot for an image) it
> should show the default one in the mockup if no image is attached."*

Two findings in one sentence, and the second is the one no parity entry had caught.

## The photo feature is write-only

Grep says it plainly. `imageDataUri` appears in the routes, the adapter, the schema, the outbox
replay, the local mirror and the picker — and in nothing that renders.

| Piece | State |
|---|---|
| `saved_meals.image_data_uri` | ✅ Q-396 — round-trips both routes, outbox and local mirror |
| `MealPhotoTile` — pick, downscale to 128 px WebP, preview | ✅ Q-327, wired into Edit Meal |
| Anything that renders a stored photo | ✗ **nothing** |
| The placeholder | ✗ does not exist |

A photo picked today is written, synced, and never seen again. Two shipped halves and no third, which
is why neither half looked incomplete on its own — and why this survived a design pass, a phase
review and six parity entries.

**That framing matters for scope.** "Build meal photos" is a feature; "the render half is missing" is
a much smaller job on top of two things that already work.

## The owner's sentence is stronger than "add a thumbnail"

*"It should show the default one in the mockup if no image is attached"* makes the glyph tile the
**always-present** state of a row, not a fallback bolted on afterwards. A row with no photo shows the
placeholder; a row with one shows the photo in the same box; there is never a row without the box.
That is what makes a list read as one thing rather than ragged.

The artboards agree: the tile appears **nine times with identical values** and once in a lighter
variant — one shared component, not per-screen markup. Meal detail uses the same idea at hero scale.

## Two deferrals superseded

`food-row.tsx` carries a comment saying the thumbnail is *"deliberately not here yet — no call site
passes one"*, and Q-406 repeated it. Both are now overridden, and both say so, because a stale
*"deliberately not yet"* reads as a live decision rather than a superseded one. The entry also
records why the original objection has expired: the stored value is a **data URI**, so an `<img>` on
it needs no `no-img-element` exemption for an arbitrary remote host, which was the reason to wait.

## BF-30 lost its escape hatch

The entry previously allowed *"it stays a card, here's why"* as a legitimate outcome. **"I dont see
this screen yet" removes that** — the owner asked for the screen. What is still open is where it
lives: route, full-height sheet, or expanded card. A sheet reached from a My-meals row is the cheapest
shape that matches the drawing and keeps the back gesture working, but that is a recommendation for
the implementer's PR, not a decision made here.

BF-30 now `Needs: BF-32` — its hero band *is* the placeholder at hero scale, and building the screen
first would mean drawing a second one.
