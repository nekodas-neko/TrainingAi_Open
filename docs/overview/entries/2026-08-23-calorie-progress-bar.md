# 2026-08-23 — the calorie bar becomes a progress bar, and Home's ring counts down (Q-323)

**Branch:** `feat/calorie-progress-bar` · **Lane B** · v1.336.0

Q-323's last two pieces. Its budget half shipped in v1.335.0 (#320), which is what unblocked these:
a progress bar is only worth drawing once the number it fills toward is right.

## A premise correction, made before building

The entry's first item says *"the macro ring shows its remainder in grey"* and describes it as
*"a full 360° split by macro"*. Those are two different components. The **Nutrition tab's**
`MacroRing` already sweeps a brand-coloured arc over a grey track — it has done the asked-for thing
all along. The 360° macro split is **Home's donut**. So item (1) is a change to Home, and the
Nutrition ring needed nothing.

Worth recording because the entry would have been implementable as written, on the wrong component,
and the result would have looked done.

## What shipped

| file | change |
|---|---|
| `packages/shared/src/nutrition/calorie-balance.ts` | `barProgress()` added; `barPosition`/`barBands`/`BAR_SCALE_KCAL` deleted — no callers left |
| `components/nutrition/calorie-progress-bar.tsx` | **new** — the bar |
| `components/nutrition/calorie-zone-bar.tsx` | draws the progress bar; the three gauge labels go |
| `components/home/home-energy-balance-card.tsx` | same bar — the sibling-surface rule |
| `components/home/home-nutrition-card.tsx` | donut → progress ring with a grey remainder |
| `e2e/calorie-progress-bar.spec.ts` | **new** — two cases |

**The x-axis is intake, from 0 to `budget + OUTER_KCAL`**, so the notch sits at the budget and the
tail past it is exactly the far-over threshold — long enough to read, short enough not to look like
a second target.

**The stops sit on the real thresholds, and that is the whole design.** A literal five-band reading
would make the on-target stripe `ON_TARGET_KCAL / (budget + OUTER)` wide — **under 6% of the bar**
on a 2,180 kcal day, too thin to see. Returning colour *stops* rather than band widths lets the
gradient interpolate: green is exact at the notch and blends across the ±150 window, so the green
region reads about as wide as it truly is while every boundary stays where `balanceZone()` puts it.
The fill is that same gradient clipped to `fillPct` with `backgroundSize` holding it to the full
track width, which gives the owner's *"the fill takes the colour of the band it currently ends in"*
for free — and means the bar's colour cannot drift from the zone label printed beside it.

## Two things the sandbox caught that would have shipped

**`var(--accent-red)` does not exist.** The ring's over-budget colour was written against it; there
are only `--accent-amber`, `--accent-cyan`, `--accent-foreground`, `--accent-green`, `--accent-purple`.
A `var()` that resolves to nothing paints transparent, so the ring would simply have vanished when
you went over — the silently-undefined-utility failure this repo has shipped before. It now takes
`balance.zoneColor` from the payload, which is the same colour the bar and the "Over" label use.

**At 0.28 opacity the empty track read as a full pink bar.** Screenshotted at the S25 viewport with
nothing logged, the dimmed ramp was indistinguishable from a fill. A neutral `bg-muted` base under
the ramp at 0.16 fixes it: empty reads as empty, and the fill is unmistakably the fill.

## Verification

Asserted through the rendered **geometry** (`data-fill-pct` / `data-notch-pct`), not a screenshot: a
pixel baseline pins how it looks and rots on the next style change, while the fill reaching
`intake / (budget + OUTER)` and the notch sitting at `budget / (budget + OUTER)` pins what it
*means*, which is the thing that changed.

Mutation-checked, both caught:

| mutant | result |
|---|---|
| bar → centred gauge (fill 50%, notch 50%) | ✗ failed |
| ring centre → eaten instead of remaining | ✗ failed |

`barProgress` also has seven unit tests, including a budget smaller than `OUTER_KCAL` (where
`budget - OUTER` goes negative and stops collapse onto 0 — the clamp has to leave them ordered or
the gradient renders backwards) and a zero budget.

Gates: `pnpm check:rules` 52 of 52 · full unit suite · full e2e suite · build clean.

## Not verified

**Nothing ran on the S25**, and for a purely visual change that is the gap that matters most. The
gradient, the notch and the conic-gradient ring were judged at the 412 px viewport in Chromium; the
Samsung WebView compositor is the known hazard for exactly this kind of drawing (it is why the ring
uses a masked conic-gradient rather than an SVG stroke in the first place). Colour choices were also
only seen in the light theme.
