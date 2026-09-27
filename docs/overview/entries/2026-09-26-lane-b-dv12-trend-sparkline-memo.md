# 2026-09-26 — DV-12: the `memo` that was doing nothing, and 578 → 0

Lane B, v1.465.63. One comparator, one extracted module, one unit test file, one e2e guard. The
owner's highest-priority entry — *"speed/performance/efficiency when switching pages tabs is my
highest priority"* — now has a measured fix on its largest named cost.

## What it was

All five canvases on the Health tab are the same component, `TrendSparkline`, rendered five times for
Protein/kg, Steps, Water, Session Duration and Workout Density. It is wrapped in `memo`, and the
wrapper was doing nothing.

`TabVisibilityProvider` bumps `epoch` on every tab re-show and the screens refetch because of it —
deliberately, since all five tabs stay mounted and a bare `useEffect(…, [])` would show one snapshot
until the app was killed. The refetch hands the sparkline a **new `trends` array with the same
contents**, so `memo`'s default shallow compare sees a different reference, re-renders, rebuilds
`data`/`options` inline, and `react-chartjs-2` runs `chart.update()` — which re-measures every axis
label.

This is the repo's own standing rule one level up. *"`React.memo` only works with stable props"* is
written about an inline literal at the call site; here the prop is an **equal-valued array**, which
reads as perfectly stable until you check the reference.

## The metric, which is the part that unstuck this

Counting the canvas `font` setter — the top self-time item in the device CPU profile — rather than
timing the tap:

| | before | after |
|---|---|---|
| → Health (5 canvases) | **578**, six times out of six | **0**, six out of six |
| → a tab with no charts | 0 | 0 |

Timing could not settle it: `next dev` is unminified, in React dev mode and compiles on demand, so an
A/B of `resizeDelay` across all twenty charts was unreadable against that noise (87–480 ms before,
73–420 ms after). The setter count has no such problem.

## Two corrections I owed this entry

**The resize suspect was wrong** — instrumented with a control, `ResizeObserver` fires 5 chart
callbacks during load and **zero** on a tab switch, so `content-visibility` never triggers one. That
also explains the dead `resizeDelay` A/B: it was debouncing an event that never happens.

**And "the third Health switch cost 0 because that refetch returned nothing to redraw" was wrong too.**
It cost 0 because the probe waited 1500 ms. At 2000 ms it is 578 every time. The redraw is
deterministic, and the update is **redundant** rather than merely legitimate — which is what made
candidate ① the right one and left ② and ③ unspent.

## Why the comparator is extracted and heavily tested

Its failure mode is silence. A comparator that returns `true` too eagerly does not crash; it leaves a
stale chart, invisible until someone notices the numbers are old. So
`components/health/trend-sparkline-equal.ts` is its own module with eight cases, **five of them
must-redraw**: the drawn field changes, a day is added or removed, the dates roll at midnight, any
presentational prop changes, a value becomes null. Mutation-tested three ways — dropping the length
check, dropping the `date` comparison, dropping the presentational-prop guard — each caught by a
different assertion.

It **deliberately ignores a field this sparkline does not draw**. Five sit on Health pointed at five
metrics, so a refetch that moves protein should redraw one chart, not five. That is the saving, not a
hole.

## The e2e guard counts, it does not time

`e2e/dv12-tab-switch-does-not-redraw-charts.spec.ts`, with two controls so a zero cannot be vacuous:
the instrument must fire during load, and the five canvases must still be mounted at the end. Control
run against the unfixed component — **fails**, *"a tab switch re-measured the chart axes"*.

## Not verified

**`Verify: device`.** The pass test is unchanged: `perf.js longtasks`, every tab tap's longest task
under 50 ms on the S25. This removes five chart redraws per tap; whether that alone clears 50 ms on the
phone is unmeasured, and the harness cannot say, because its timings are dominated by dev-mode work the
APK never does.
