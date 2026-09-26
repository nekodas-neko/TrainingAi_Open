# 2026-09-25 — DV-12: the suspect was wrong, and the metric that settles it

Lane B, docs-only, on the owner's highest-priority entry. No fix — but the entry now names the right
mechanism and carries a measurement that can tell a fix from a no-op.

## The suspect is falsified

DV-12 said the lead was *"a responsive resize when a panel leaves `content-visibility: hidden`"*.
Instrumenting `ResizeObserver`, **with a control** this time:

- during load — **11 observers constructed, 6 callbacks, 5 of them on chart containers**, so the
  instrument works and chart.js does observe its container;
- on a tab switch — **0 callbacks, chart or otherwise.**

`content-visibility` does not fire a resize here. That also explains the `resizeDelay: 200` A/B I ran
earlier and recorded as inconclusive: it was debouncing an event that never happens.

## A metric that works

Patch the `font` setter on `CanvasRenderingContext2D.prototype` and count calls per tab tap. It is the
exact top self-time item in the device CPU profile, needs no chart.js internals, and is immune to the
dev-mode timing noise that made the earlier A/B unreadable.

| tap | canvas `font` setter calls |
|---|---|
| → Health (5 canvases) | **578**, then **578** again |
| → More, → Home (no charts) | **0** |
| → Health, later in the same run | **0** |

Two identical readings and a clean zero on the chart-free tabs. That is a discriminating instrument,
which is what this entry has lacked since it was filed.

## What is actually happening

`TabVisibilityProvider` increments `epoch` every time the shell re-shows a tab, and the screens thread
it into their effects' dependency arrays **deliberately** — all five tabs stay mounted, so without it a
`useEffect(…, [])` fetch would run once per app launch and the screen would show that snapshot forever.

So a tab switch refetches, the data objects are new, the charts re-render, and `chart.update()`
re-measures every axis label. **The update is legitimate.** The third Health switch costing 0 fits: that
refetch returned nothing the charts had to redraw.

## Which changes what a fix is allowed to be

Not "stop the update" — it is correct. Make a correct update cheaper or later, and that is a trade-off
against Q-402's staleness rule rather than a free win. Three candidates are on the entry, none measured:
compare fetched data by value before handing it to the chart (strongest fit — two of three Health
switches changed nothing); move the update off the tap's critical task; refetch less eagerly on show
(fights Q-402, so last).

## Two corrections this cost, both mine, both today

The "zero canvases" reading retracted in the previous entry, and now the resize suspect — which I had
repeated as confirmed-from-source before testing it. Reading the source told me *what could* fire a
resize; only the instrument told me whether anything did. **A mechanism inferred from source is a
hypothesis, and this entry has now burned two of them.**

## Not exercised

All of it is `next dev` in the harness with the seeded user. The device profile remains the authority on
the APK and agrees on the symptom. The pass test is unchanged: `perf.js longtasks`, every tab tap under
50 ms, on the phone.
