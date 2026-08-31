# The nutrition uplift batch — BF-72, BF-73, BF-74, BF-76

**Branch:** `feat/nutrition-uplift-bf72-76` · **Lane B** · v1.407.0 · four entries, one PR, because
they are verified the same way: one device pass over the same two screens.

## BF-72 — the diary's own hydration wiped the grouping it had just drawn

The owner's report was the diagnosis: *"when I add my saved meal it starts as the meal with the
image, then breaks into its ingredients."* The optimistic write is right; something after it is
wrong.

`use-food-logs-loader.ts` re-hydrates the local store from the server response and then immediately
re-reads and renders it. Its `foodLogs` payload omitted `savedMealId` and `mealGroupId` — and a local
upsert **overwrites every column it is given**, writing `record.savedMealId ?? null`. So the screen
destroyed its own grouping and then displayed the damage.

**The sweep the entry demanded is now evidence rather than an assumption.** There are exactly two
`applyDelta` callers. The sync engine's mapping already carries both ids, under a BF-39 comment
saying why it must. This screen-level hydrate was the one site that audit did not reach.

**Extracted to `food-log-hydration.ts` rather than fixed in place**, because the defect is a *missing
field in an object literal* — the shape no type error catches, since every field is optional going
in. As a named function it has a test that lists the columns.

**The entry's second finding was measured and is inert.** It flagged `syncStatus: 'synced'` as
possibly handing the pull-clobber guard a value it did not earn. `applyDelta`'s food-logs arm
hardcodes `'synced'` in both its VALUES and its SET, never reads the payload's field, and gates on
`WHERE food_logs.sync_status='synced'` — so a row with a mutation still in the outbox is protected by
its *stored* status regardless. Changing it would have looked like a fix and been none. Decided
rather than inherited, which is what the entry asked for.

## BF-73 — and the finding that came out of it

Tiles **60 px → 79 px** (measured), icons `h-5` → `h-7`, label to `text-xs`. `New` is now 324×48
filling the row with a 48×48 bin beside it — the hierarchy the owner asked for, since creating a
meal is frequent and deleting several is rare.

**The mechanism was not the one anyone assumed.** `min-h-[Npx]` **does nothing on a `<button>` in
this app**: `globals.css` sets a bare `button, [role="button"] { min-height: 48px }` and it beats the
utility. Measured — a button with `min-h-[84px]` computes `48px`; the same class on a `<div>`
computes `84px`.

So **BF-50 ①'s `min-h-[62px]` never applied**, and its comment — *"62 px, from the artboard's capture
tiles"* — describes a tile that actually measured **60**. The height has always come from padding and
icon size. The inert class is removed rather than left implying a floor it does not set, and the
general case is filed as **LB-32**: 46 of the app's `min-h-[Npx]` uses are `44px` and 26 are `48px`,
all at or under the floor and therefore over-satisfied, so only a handful can lose anything.

The bin is icon-only but its accessible name is `Delete meals`, not `Delete`. Those words are the fix
BF-50 ④ shipped for *"you cant do anything with it except delete"*, and the accessible name is now
the only thing carrying them.

## BF-74 — a destructive control in the dismiss corner

`meal-detail-sheet` passes `hideCloseButton`, so the photo's ✕ at `right-0 top-0` was the **only** ✕
on the screen, in the one corner a user reads as "close this". A reach for dismiss deleted the photo.
That is a wrong-meaning problem, not a small-target one — which is why making it bigger would have
made it easier to hit by accident.

It is a **bin at the bottom-right** now, 44 dp, and removal is **undoable**. Undo rather than a
confirm because re-picking is already one tap: the toast spares the gallery round-trip without
putting a dialog in front of the common case.

**The sibling sweep found one shape, not two:** `MealPhotoTile` has a `tile` variant, but both call
sites pass `hero`, so `tile` has no callers at all.

## BF-76 — the sweep, and why nothing changed

**The entry's leading hypothesis is wrong, and that is the useful output.** It proposed
`h-[92vh]` → `dvh`, reasoning that `vh` overshoots the WebView viewport. But a bottom sheet is
`fixed inset-x-0 bottom-0`, so its height moves only its **top** edge — the bottom clearance is
entirely the baked `pb-safe-*` class. Swapping the unit would change where a sheet clips at the top
and nothing about the gesture bar.

Measured in a browser with the real class strings (the sandbox reports the inset as 0):
`pb-safe-action` = 12 px, `pb-safe-action-lg` = 64 px, and `p-0` does **not** strip either — both
`p-0` sheets compute 12 px, so the repo's standing tailwind-merge claim holds.

| clearance below the bottom control | sheets |
|---|---|
| 64 px — the BF-62 reference | `meal-detail`, `saved-meals` (declared once, on the content) |
| **76 px web / 88 px device — declared twice** | `meal-plan-setup`, `meal-plan-manage`, `meal-plan-edit` |
| 12 px web / 24 px device, content-sized, no bottom control | the other seven |

**Nothing is under-padded. Three are over-padded** — the opposite of what was expected. Those three
declare the inset on the `SheetContent` (default `action`) *and* on a `SheetFooter` (`takeover`), and
the two add.

**No code changed, and that is the decision rather than an omission.** The primitive cannot express
the fix: `SheetContent side="bottom"` and `SheetFooter` each always emit a `pb-safe-*` class, so the
options are 76 px (today), 80 px (move it to the content), or a `"none"` escape hatch whose failure
mode is a sheet with no bottom inset at all. Trading a 12–24 px cosmetic gap for that footgun is a bad
deal, and every candidate sits within ~24 px of the reference.

## Verified

`tsc --noEmit` clean · `pnpm check:rules` **Ran 64 of 64** (the count moved with #676's new check, re-run after merging it) · full suite **526 files / 4783 passed** ·
`meal-photo-picker` + `zero-calorie-food` e2e green (7 tests), which is the pair that exercises the
renamed remove control and the capture tiles.

Every guard is **mutation-tested**: reinstating BF-72's exact omission fails 3 of its 6 tests, and
putting the ✕ back in the dismiss corner / renaming the bin to `Delete` / pinning the tile to a fixed
height each fail their own.

Measured at 412 dp in a browser and screenshotted: tiles 79 px, `New` 324×48, bin 48×48.

**One gate failure worth recording, because it was prose rather than code.** The *No nested button
inside a role=button wrapper* rule is a line grep, and it flagged a **comment** in
`capture-actions.tsx` that happened to name both `<button>` and the role attribute on one line. The
comment was reworded rather than the rule weakened — it is doing its job, and the ambiguity was
mine.

## Not exercised

- **The device, for all four.** BF-72's is not a formality: the whole repaired path lives in
  `getLocalStore`, which **returns null in the web sandbox**, so it cannot execute off-device at all.
  What is proven is the mapping function; what is unproven is the owner's own report.
- **BF-74's undo toast against a thumb.** Whether it is reachable before it dismisses is the one
  thing a desktop browser cannot judge.
- **BF-76 entirely.** The sandbox reports `env(safe-area-inset-bottom)` as 0, so every number above
  is the web column; the device column is arithmetic, not measurement.
- **The bin at fewer than two saved meals.** `canSelect` hides it, and the seeded database has none —
  two were inserted to photograph the row and removed again.
