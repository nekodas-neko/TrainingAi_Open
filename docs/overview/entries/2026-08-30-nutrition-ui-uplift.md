# Nutrition UI uplift: eight fixes shipped, two built and held (BF-45, BF-50, BF-51)

**Branch:** `feat/nutrition-ui-uplift` · **Lane B** · batch `nutrition-ui-uplift`

Two device passes (N4, N5) plus BF-45's screenshots. Eight items shipped; two were built, measured,
and deliberately not shipped — the measurements are on their entries and are the more useful half.

## Shipped

**The macro ring started at 9 o'clock, at all three call sites (BF-45 ④).** `conic-gradient(from
-90deg, …)`. In CSS a conic gradient already starts at 12 o'clock — 0deg is the top. `from -90deg`
is the **SVG/canvas** idiom, where 0° is at 3 o'clock and you subtract 90° to reach the top; carried
into CSS it rotates the start a quarter turn counter-clockwise. Home's ring had it identically and
nobody had reported it. The fix is dropping the clause.

**A collapsed meal kept its calories and lost its macros (BF-45 ②).** The totals footer lives inside
`CollapsibleContent`, so it left with the rows. The collapsed card now carries the same line below
its header — the shape the owner corrected to on the device (*"it should still show the total
calories and total macros below it"*), not the macro-trio-in-the-header the entry first proposed.
One `MealTotals` component serves both states, so they cannot report different numbers for one meal.
It shows from **one** log where the expanded footer needs two: open, a single row already states its
own macros; collapsed, nothing does.

**`My Meals` spans both columns (BF-45 ①)** — three buttons in a two-column grid left it beside dead
space. The diff says outright that the span is a *consequence* of the empty slot, so a fourth action
takes it back.

**Bottom-sheet gutters are 16 px (BF-45 ③ / BF-51 ④) — and not where the entry said to put them.**
It called for `SheetContent`'s bottom variant, "fix it once". Measured first: **26 of 48** bottom
sheets set their own `px-*` or `p-0`, and of the remaining 22 most already pad their inner content at
16 px (`water-log-sheet`, `time-picker-sheet`, `log-value-sheet`). A shared outer gutter would have
doubled theirs — a nutrition entry regressing the whole app. The nutrition sheets were the outliers
at `px-1` (4 px) against artboards that specify 16; those are what moved, plus the meal builder's
footer, which is a *sibling* of the scroll body rather than a child and so ran its Save button to
the sheet edge while the ingredients sat 16 px in.

**The Log Food capture row (BF-50 ①②③④).** Tiles are 62 px, from the artboard rather than a number
invented here — `min-h`, because "Describe or enter" wraps to two lines in a third of 412 dp. The
describe pane fills the sheet it is in (it had no `flex-1`, so an 80 px box sat at the top of a 90vh
sheet). Photo opens the camera directly — `CameraSource.Camera`, not `Prompt` — with the gallery
kept as its own text-weight control, because nothing can add a button to Android's camera UI and the
entry said explicitly not to drop it. And `Select` on the Meals tab is now `Delete meals`: deleting
is all it has ever done, and multi-log is a screen (a meal type and a portion per meal), not a label.

## Built, measured, held — and why that is the right outcome

**The two photo controls (BF-46 ①(a), BF-51 ②).** Built in full: `useMealPhotoPicker` for the
acquisition, `MealPhotoHero` for the band, the builder's tile lifted to the top, the meal's own
screen's *Add a photo* made a real picker writing through the same `saveMealToLibrary`,
`MealPhotoTile` deleted. Then the picker stopped working, and instrumenting it says the file arrives
(`size=442985`), the re-encode succeeds (**4,247 chars**), the cap passes (`reject=null`) — and the
component never receives it. That is close enough to BF-46 ①(b)'s *"I saved it; and it didnt show"*
that it is probably the same defect, and (b) says to reproduce on the device first. Full measurement
is on BF-46.

**The builder as its own back surface (BF-51 ①).** One line —
`useSheetBackDismiss(open && tab === 'build', backToMeals)` — gives exactly the asked-for behaviour
and makes `meal-photo-picker.spec.ts` fail at `page.goto` with `net::ERR_ABORTED`. Reproducible;
passes on `main`; passes here with that line disabled. The popped history entry is what every other
sheet does, so the app may be right and the spec merely first to navigate straight after a
button-close of a nested surface — but `sheet-back-stack.ts`'s three previous bugs were **all** found
on a device, and "it destabilises a spec" is not a diagnosis. Held rather than shipped, and
explicitly not resolved by loosening the spec.

## What the sandbox could not judge

Every one of these is a **layout or gesture** change on a phone, and none was seen on the S25. The
web sandbox renders safe-area insets as 0, so ③'s gutters are unverified there by construction;
a ring's start angle, a 62 px tile and a collapsed summary line are all size judgements at 412 dp.
`CameraSource.Camera` and the gallery route are **native**, so neither ran at all — the web path
falls back to a file input. Treat all eight as shipped-but-unverified until the device pass.

## Verification that did run

`pnpm check:rules` — Ran 62 of 62. Full unit suite: **5,482 passed**, 660 files. The meal and
library e2e specs (photo picker, empty library, both artboard-parity specs, edit-meal footer,
shared food row, meal thumb) — **13 passed** on the final tree, after the two holds.

A note on method that cost real time: **every e2e result taken while editing files was unreliable.**
Fast Refresh left the browser on a mixed build, and one run "passed" a change that could not work.
Every measurement quoted here was re-taken against a cold dev server, and the passing run that
disagreed is recorded on BF-46 as the artefact it was.
