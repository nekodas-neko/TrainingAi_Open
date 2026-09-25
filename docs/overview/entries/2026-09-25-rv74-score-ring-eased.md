# 2026-09-25 — RV-74: matching the duration was not enough to make it one gesture

**Branch:** `lane-b/rv74-score-ring-motion` · **Lane:** Implementation B

The health hero eased its number over 600 ms and snapped its ring. One component, two behaviours, on
the app's most prominent element — which is what makes it a defect rather than a preference, and why
it was Lane B's to fix rather than the owner's.

## The prescribed curve does not make them one gesture

The entry says to add `transition: stroke-dashoffset 600ms cubic-bezier(0.05,0.7,0.1,1)` and to
"match 600 ms so ring and number are one gesture". The duration is right; the curve is not.

`useCountUp` eases with `1 - (1-t)³` — a cubic ease-out — and the two curves diverge sharply in the
middle:

| t | count-up `1-(1-t)³` | entry's curve |
|---|---|---|
| 0.5 | **0.875** | **0.762** |

So the ring would trail the digits by eleven points of progress halfway through, and still read as two
things happening. Matching only the duration gets you two gestures of equal length.

The exact CSS form of the hook's easing is **`cubic-bezier(0.333, 1, 0.667, 1)`**. That is derivable
rather than a guess: for a CSS Bézier to be a pure function of elapsed time, x(t) must be linear,
which fixes the x-controls at 1/3 and 2/3; solving y(t) = 3a·t − 6a·t² + 3a·t³ + 3b·t² − 3b·t³ + t³
against 3t − 3t² + t³ gives a = b = 1. Verified numerically to 1e-16 on both axes, and the test
re-derives it rather than asserting the literal — so if anyone changes the hook's easing, the test
fails with the reason rather than the number.

## Why CSS and not an inline transition

The entry offers both. The inline route wanted gating on `useReducedMotion()`, and the component
cannot: `useCountUp` reads that hook **internally**, so the boolean never reaches the caller. Adding a
second `useReducedMotion()` call beside it would work but duplicates the source of truth.

`.score-ring` in `globals.css`, with `transition: none !important` in the reduced-motion block beside
`.border-run`, is the route the entry itself pointed at — the same class of thing (a
`stroke-dashoffset` animation), handled the same way, needing no new hook call.

## A near-miss worth recording

Mutation-testing the curve left `globals.css` mutated, and I cleaned up with `git checkout -- <file>`.
That restores from the **index**, which never held my changes — so it silently reverted the whole CSS
half while the component half survived. The final verification run caught it (3 failed, 1 passed)
because I re-ran the tests after cleanup rather than assuming the cleanup was a no-op. Had I not, the
PR would have shipped a class that nothing defines.

**Not exercised:** no device. `docs/mobile-ui-and-performance.md` warns that stroke-dash donuts in
card grids can wipe sibling cards' gradients on Samsung's WebView compositor; this ring is in a hero
rather than a grid, so it is *probably* outside that failure mode — and "probably" is exactly why the
entry named a device look as its verification. It keeps `Verify: device` and prints in `--sittings`.
