# 2026-08-31 — a coordinate is not a promise the element is still there (LB-30)

**Branch:** `claude/implementation-agent-lane-b-43nmep` · **Lane B**

## Where this came from

BF-39's implementation was held for a week as a render-vs-remount question it never was. The real
cause: `toBeVisible()` is satisfied the moment a `SheetContent` mounts, ~500 ms before it lands, so
a `boundingBox()` taken straight after is a position the element is travelling through. Measured on
the meal library — the row read y=605 and sat at y=503 by the time the CDP touch arrived, so every
point of the gesture hit the scroll container beneath it and the drag handler was never invoked.
`swipeRowLeft` got a private `stableBox` then; LB-30 is the audit of everything else.

## The audit, which changes the entry's own numbers

LB-30 said "46 coordinate reads". Classified, they are not one population:

| | count | why |
|---|---|---|
| Coordinate taps inside an `expect(async () => …).toPass()` retry | **21** | Self-healing — a retry re-measures, which is what `openSavedMeal` already relies on. Safe. |
| Coordinate taps with a single measure | **11** | Exposed: nothing re-measures and nothing checks stability. |
| Reads feeding a geometry **assertion** | **6** | Not in the entry's scope at all, and worse than a missed tap — a moving box gives a *wrong verdict*. |

The remaining reads feed neither a tap nor an assertion.

**The 6 assertion reads are the find worth having.** `quantity-editor-option-a.spec.ts:159–160`
compares the toggle's box against the stepper's, and that comparison *is* BF-46 ③'s proof that the
control sits "beside the stepper" — the owner's whole request, and the one thing a text-only check
cannot see. Asserting it against a box read mid-animation is how that proof quietly stops meaning
anything.

## What ships

- **`stableBox` is exported** from `e2e/fixtures.ts` and **`tapCentre(page, locator)`** added beside
  it — measure once still, then dispatch. Both carry the measurement that motivates them.
- The **11 exposed taps** go through `tapCentre`; the **6 assertion reads** call `stableBox`
  directly. `food-log-swipe-delete`'s post-swipe `after` read is included: it is measured
  immediately after the row's slide, which is exactly the shape. Its pre-swipe `box` is deliberately
  left alone — that one wants the *original* right edge, and the comment says so.
- **`diary-nested-meal`'s `waitForTimeout(300)` is deleted.** It stood in this exact spot, guessing
  at the condition `stableBox` now waits for. Six `waitForTimeout` calls remain in the suite; this
  was the one a real condition could replace.

## Be accurate about what was proven

**One of these was measured failing; the rest are cheap prophylaxis, and the entry now says so.**
The proven hazard is a sheet animating over `duration-500`. The app sets no `scroll-behavior:
smooth`, so the `scrollIntoView` that precedes several of these settles immediately — those reads
were probably fine. `stableBox` returns as soon as two reads a frame apart agree, so on a settled
page it costs one frame; that is what makes converting all of them the cheap option rather than an
argument about which are genuinely at risk. It is **not** a sleep, which is the distinction that
lets it replace one.

## Verification

All 12 touched specs run locally against the dev server: `diary-nested-meal`,
`food-log-swipe-delete`, `quantity-editor-option-a`, `food-row-shared`, `zero-calorie-food`,
`food-logging-complete`, `single-foods-database-search`, `builder-barcode-scan`,
`day-review-one-door`, `meal-photo-picker`, `plan-meal-to-saved-meal`, `recipe-url-to-meal` — 39
tests, all passing. `tsc --noEmit` clean.

## Not exercised

- **This cannot be proven green.** It removes a race; a suite that passed before and passes after is
  consistent with the change doing nothing on this run. The evidence it rests on is the BF-39
  measurement, not this run's result. What a green run *does* establish is that no conversion broke
  a working spec, which is the failure mode a mechanical sweep actually risks.
- The 21 taps inside retries are untouched, deliberately — a retry already re-measures, and
  converting them would trade a proven mechanism for a new one.
