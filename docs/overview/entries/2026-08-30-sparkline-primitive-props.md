# The sparkline primitive can draw the charts that were bypassing it (Q-154)

**Branch:** `refactor/sparkline-primitive-props` · **Lane B**

Three files hand-rolled a `<polyline>` rather than using `components/ui/sparkline.tsx`. That was not
laziness and "replace on touch" would have been a bug: the primitive genuinely could not draw them.
Q-154 spent three sessions establishing what was missing and one owner decision clearing the design
question. This is the conversion.

## What the primitive gained

Six props, all defaulted, so the twenty call sites that predate them render byte-identically:

| prop | why |
|---|---|
| `pad` | uniform inset on both axes; the two callers inset by one number and the default's percentage y-band cannot express that |
| `valuePadding` | the default 0.5 is headroom; `0` is exact min/max |
| `strokeWidth` | hardcoded `1.5`; both callers draw at `2` |
| `gridLines` | three faint rules — `exercise-history-sheet` draws them |
| `emphasizeLast` | a larger final dot |
| `valueLabel` | already-formatted text above the last point; units and rounding stay with the caller |

**`valuePadding` is the one that matters and it is not cosmetic.** At 0.5, a 0.5 kg body-weight
spread renders at *half* its true amplitude — the chart says something different from the data. That
is why a blind conversion was refused twice, and it is now pinned by a test rather than a comment.

## The visual change, and whose call it was

The owner decided this on 2026-08-25, shown the three states rendered at true size: **option 2 — the
halo goes.** `exercise-history-sheet`'s decorative `r=7` ring around the final dot is removed, and
the non-final dots stop being dimmed (0.45 and 0.4 at the two callers).

The reasoning is worth keeping: a `haloLastDot` prop asks a shared primitive to draw one caller's
specific art, and a primitive that grows a prop per caller is a wrapper over a config object rather
than a unification. That is the same call Q-406 made when it declined a warning slot on `FoodRow`.
Everything else the callers needed — the inset, exact scaling, stroke width, grid lines, the
emphasized dot — are general wants any caller could have, so they became props rather than
compromises. *"Option 2" never meant "make the callers accept the primitive as it is today."*

## Two convertible, not three

`workout/active-workout-screen.tsx` stays inline **and is no longer a to-do.** It wants asymmetric
padding, uniform dots, no fill, a dimmed stroke and an end-anchored label — four more props no other
caller would use. `scripts/check-sparkline-primitive.js` now lists one grandfathered copy rather than
three, with that reason written into it.

The three time-axis charts (`day-sections`, `exercise-review-sheet`, `body-battery-card`) remain
EXEMPT: they project x by *time* and the primitive projects by *index*, so converting them would move
every unevenly-spaced point. (The primitive does have `times`/`timeDomain` now, but those three carry
their own domain semantics — a fixed whole-day axis, a duration axis — and are not the same thing.)

## Verification

The projection moved to `components/ui/sparkline-geometry.ts` → `sparklinePoints`, **so it can be
tested at all**: both vitest projects run in `node`, where a JSX-only component cannot be driven.
`fitWithin` in `downscale-image.ts` is split out for the same reason.

Seven tests, and the first is the point: the default padding *is asserted* to halve a 0.5 kg spread,
so the hazard is a fixture rather than a warning. The others pin exact scaling filling the inner
height, `pad` insetting both axes, the un-padded default still spanning full width at the original
10%/80% band (which is what says the twenty existing call sites are unchanged), a flat series not
dividing by zero, time projection, and a mismatched `times` array falling back to index.

Full unit suite **5,560 passed** / 664 files. Health e2e specs (instant paint, day-detail sheets,
score-band, first-run empty states) — **11 passed**. `pnpm check:rules` — Ran 62 of 62. Typecheck and
lint clean.

## Not exercised

**Neither converted chart was looked at.** The two sheets are reached through navigation no e2e spec
covers today, and a smoke check of `/health` found no polyline on the landing tab — so the geometry
is proven by unit test and the *rendering* is not. On top of that, this is a deliberate visual change
on a user-facing chart at 412 dp, which is a device judgement by nature. Both sheets want a look on
the S25: the 1RM trend in the exercise-history sheet and the metric trend in the health-metric sheet.
