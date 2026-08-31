# 2026-08-31 — the swipe tray's first tap, a scan in the builder, a tab called Search, and real clearance (BF-60/61/62/63)

**Branch:** `feat/nutrition-batch-bf60-63` · **Lane B** · batch `nutrition-ui-uplift`

Four owner reports from one device pass, shipped as one PR because they share one screen and one
device check.

## BF-61 — Delete needed two presses

The row carries `transition: transform 0.22s`, and hit-testing follows the **animated** transform.
For those 220 ms the row is still physically over part of the tray, so a tap lands on the row, which
swallows it; the second tap, after the settle, reaches the button. The owner confirmed the cause
himself — *"if I wait a second it works."* The tray now stacks above the row while open.

**Shortening the animation was explicitly not the fix**: a window that swallows input at 220 ms
still swallows it at 100 ms, only less reportably.

### The regression test took three attempts, and the failures are the useful part

1. **A long drag proves nothing.** 200 px rubber-bands past the resting offset, so the row animates
   back **rightwards** and never covers the tray. Measured at −97 px against a −64 px rest.
2. **A short flick snaps closed.** `@use-gesture` derives velocity from the interval, and a
   CDP-paced drag with `waitForTimeout(16)` lands under `FLICK_VELOCITY` — so `shouldRestOpen` fell
   through to its distance rule, which a 20 px drag also fails. The probe showed
   `trayHidden=true`: the tray never opened at all, and the test was failing for the wrong reason.
3. **A tap at the tray's centre is uncovered almost at once.** The tray uncovers from its **right
   edge** first, so a point 32 px in is clear within a frame of release.

What reproduces it: a **36 px** drag (rests open on distance, leaving the row short of its offset), a
tap **52 px** into the tray, and the transition stretched to **6 s** so the window is wider than one
protocol round-trip. Only the duration is changed; the fix is duration-independent. Without the
stretch the tap sometimes lands after the settle and the test passes whether or not the bug exists —
**a false green, which the first version of this test actually was.**

## BF-62 — the fix is not the one the entry proposed

The entry's hypothesis was `h-[92vh]` overshooting under edge-to-edge. It is not that, and the real
answer was already written down in this repo: `SheetContent side="bottom"` bakes `.pb-safe-action`,
which is the inset against a **0.75rem** floor, and the comment beside `.pb-safe-action-lg` in
`globals.css` records the on-device measurement — under Capacitor's edge-to-edge the WebView is
drawn behind the nav bar, so **the inset reports the bar's own height**. Padding by
`max(inset, 0.75rem)` therefore pads by exactly the bar and leaves a primary button flush on it.
That is *"the safe space is still a little off"*, and the height was never involved.

`SheetContent` and `SheetFooter` — the two places that bake the bottom inset — take
`bottomInset="takeover"`, and five takeover-height nutrition sheets pass it. **The class is chosen,
not appended**, because tailwind-merge cannot see these custom classes and the two would stack, which
is the same fact CLAUDE.md records about `p-0` not stripping the baked padding.

## BF-60 — `Single foods` → `Search`

The label was right when written and BF-48 made it wrong by giving that tab the food database. Meals
keeps a box of its own, so the two are worded to carry the distinction the label now rests on: Meals
**filters** a list you own, this **searches** past it (`Filter your meals`). Five specs selected the
tab by its old name and were swept with it.

## BF-63 — a packet can be scanned instead of typed

Log Food has had `Photo · Barcode · Describe` since it shipped; the builder, one screen further into
the same sheet, had only the text field.

**Not `CaptureActions`, though it holds the same scanner.** Its hit routes into the food logger and
lands on today's diary — reusing it would have silently logged breakfast while the user was writing a
recipe. A scan inside a builder is `addExternalFood` with `source: 'barcode'` instead of `'text'`,
which is the distinction that file's own comment already asked for.

A printed meal label scans as a 22-character token; inside a builder that would mean nesting a meal
as an ingredient, which does not exist, so it is recognised and refused rather than handed to a
product lookup that can only 400 it.

**The code itself is not stored, and that is a decision rather than an omission.** `barcode` is NULL
on every `food_items` row in production, including the three already marked `'barcode'`: the route
does not return what it looked up and `NewFoodItem` has no field for it. Threading it is the route,
the shared create path, the local table and the outbox payload — all **Lane A**, all BF-38's subject.
This defers rather than becoming a fourth writer of NULL.

## Not done

- **Nothing here is device-verified**, and three of the four entries stay in the queue for exactly
  that. BF-62 needs **both** navigation modes: the inset differs, and checking one is what lets this
  class through. BF-61 needs the fast tap on **both** trays — BF-29's pass on 2026-08-30 was the meal
  list, tapped slowly. BF-63's scan needs a camera, which no harness here has; its spec asserts the
  affordance and that it reaches the scanner, and stops there.
- `components/activity/exercise-review-sheet.tsx` (`h-[85vh]`) was left alone: no bottom-anchored
  action row, another domain, nothing reported.
