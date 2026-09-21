# RV-72 — progress bars composite instead of forcing layout

**Branch:** `fix/rv72-progress-bar-scalex` · **Lane B** · **v1.464.1**

## What shipped

`components/ui/progress-fill.tsx` — a primitive that renders a full-width fill at
`transform: scaleX(pct)` with `origin-left` and `transition-transform
motion-reduce:transition-none`. The five solid-fill bars that transitioned `width` now use it:
`health/contributor-chart.tsx`, `workout/time-summary-card.tsx`, `nutrition/meal-macro-bars.tsx`,
`nutrition/meal-plan-section.tsx`, `guided-walk/walk-pacer-bar.tsx`. Animating `width` forces
layout and paint every frame *and reflows the bar's siblings* — the target tick sharing a track on
the time-summary card, the label and numbers beside each macro row.

`nutrition/calorie-progress-bar.tsx` is deliberately left on `transition-[width]`, as the entry
directed, and now carries the comment saying why: its fill clips a gradient ramp with a
hand-computed `backgroundSize`, so scaling it would squash the ramp and change *which colour the
leading edge shows* — what the bar says about the day, not just how it moves. It is the only
remaining `transition-[width]` in the app.

## Two decisions worth not re-litigating

**The primitive renders the FILL, not the track.** Every call site's track already carries the
`role="progressbar"` and its ARIA values, a background often derived from the fill colour at low
alpha, a height varying from 1.5 to 2.5, and in one case an absolutely-positioned target tick.
Swallowing all of that would have meant a prop for each; owning the fill alone is the part that is
genuinely identical across the five.

**The radius stays on the track, and that is load-bearing.** `scaleX` scales the fill's horizontal
radius with it, so a `rounded-full` fill goes visibly oval at low percentages. All five tracks
already set `overflow-hidden rounded-full`, which clips a square fill to the same shape at every
value. A new caller without those two classes gets square ends — the spec asserts the fill's own
radius is 0 for exactly that reason.

## Testing

`e2e/rv72-progress-bars-composite.spec.ts` reads `transform`, `transformOrigin` and
`transitionProperty` off the live element — **computed style, not class strings**. That is not
stylistic: on the previous PR `duration-250` compiled to nothing (it is not in Tailwind's default
scale) and would have shipped as a convincing no-op, because a typo'd Tailwind class fails no gate.
The contributors are injected via a route intercept the way `score-gap-reason.spec.ts` does it —
whether the seeded user has readiness contributors today is a fact about fixtures, and a bar that
never rendered would pass every assertion vacuously.

**Mutation-checked, four ways.** Reverting `ProgressFill` to `width` fails it ("no progress fill is
using scaleX"); dropping `origin-left` fails it ("transform-origin is 85px 5px, not the left edge");
adding `rounded-full` to the fill fails it ("the fill kept its own radius — it will go oval under
scaleX"); converting the calorie bar to `scaleX` fails the exclusion guard.

**The exclusion guard lives in `e2e/calorie-progress-bar.spec.ts`, not in the RV-72 spec.** It was
written there first and passed vacuously: the gradient fill renders only when intake > 0 and the
seeded nutrition day is empty, so the selector matched nothing. That sibling spec is the only place
that seeds a non-zero intake, so it is the only place the guard can actually see the element.

## Not exercised

No device pass. No sandbox drives a Samsung WebView, and frame timing on that device is the entire
payoff of a compositing change — this is felt, not measured, and the `motion-polish` batch keeps one
on-device sitting for RV-71, RV-72 and RV-75 together. Nothing here was watched moving on hardware.

## Left undone, on purpose

The entry also names bars using a blanket `transition-all` over an inline `width`
(`metric-tiles-card.tsx:108`, `recommendation-card.tsx:224`, `goal-progress-bar.tsx:7`) and 26 bars
with no transition at all. Neither was converted — separate files, separate risk, and a large diff
is the one least likely to land under the current merge rate. The primitive they would use now
exists. RV-72 stays queued with a `Keep:` for those and for the device pass.

## Incidental

RV-72's `⛔` emphasis glyph — the fourth measured instance of LB-121 — is gone, so the entry no
longer parks itself in `next-item.js`.
