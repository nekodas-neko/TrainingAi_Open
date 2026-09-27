# The heart-rate chart was redrawing itself behind the screen you just left

Implementation Lane B, 2026-09-26. `OR-162`, the mechanism behind `DV-12` — the owner's stated
number-one, *"speed/performance/efficiency when switching pages tabs is my highest priority."*

## What shipped

`HrDayChart` is now `memo(HrDayChartBase, hrDayChartPropsEqual)`, with the comparator and the props
type in `components/health/hr-day-chart-equal.ts` and every "must redraw" case pinned in
`components/health/__tests__/hr-day-chart-equal.test.ts`.

## Why this chart, and why by value

Device sweep 4a hooked the canvas `font` setter and counted it **per canvas per tab switch**, which
is what turned `DV-12`'s minified profile into two named components. On **every** switch the two
*HEART RATE · TODAY* charts re-measure their axes **while their panel is hidden** — Home's 30 writes
per switch, Health's 80 — so none of that work can ever be seen.

It is not a resize. `e2e/dv12-tab-switch-does-not-redraw-charts.spec.ts` established that
instrumenting `ResizeObserver` gives five chart callbacks during load and **zero** on a tab switch,
so `content-visibility` never triggers one. What fires is `TabVisibilityProvider`'s `epoch`: the tab
shell bumps it on every re-show, both call sites refetch because of it — deliberately, since all
five tabs stay mounted — and the refetch hands `setState` a **new array holding the same day**. The
default shallow `memo` compares identity, so it never skips, and chart.js re-measures.

That is exactly the defect `TrendSparkline` had, fixed the same way in #1675 (578 font writes per
switch to Health → 0). `HrDayChart` never got the treatment because nothing pointed at it until the
per-canvas count existed.

The comparator walks `readings` in full rather than sampling or checking the length. A day is a few
thousand primitive comparisons against tens of milliseconds of label measurement, so the cheap
version buys nothing — and being too eager does not crash, it leaves yesterday's line on screen,
which is invisible until someone notices the numbers are old. `source` is compared for the same
reason it is easy to miss: `findSourceWindows` draws the sleep and rest shading off it, so a change
there is visible even when the line is not.

The source guard in that test covers **both** charts. `TrendSparkline` has had none since #1675, and
the failure mode is identical: dropping the second argument to `memo` leaves a component that still
reads as optimised and skips nothing.

## What is deliberately not done

**The arrival half is a different mechanism and is untouched** — 180 font writes on arriving at
Home, 320 on arriving at Health, and Wear Time's 43. Wear Time is the tell: it is an
already-memoised `TrendSparkline`, so its per-switch cost is already zero and what is left on
arrival cannot be a re-render. `OR-162` lists three directions for it — chart.js `resizeDelay`
behind a shared defaults module, holding the canvas size across the hidden state, skipping the
update when the previous box was zero — and none is measured. Picking one off a guess would be the
LB-108 shape.

**The sandbox cannot put an after-number on this, and that is measured rather than assumed.** The
e2e seed renders no `HrDayChart` at all: the account has no heart-rate readings, so both call sites
take their empty branch, and a probe at 384 px found zero canvases on Home. The existing DV-12 spec
reads **0 font writes per switch to Health both before and after this change**, because the five
canvases it finds are the sparklines #1675 already fixed. Seeding a day of HR into the shared e2e
database was rejected: every spec shares that user, and today's HR would move other specs'
expectations. So the after-number is the device's to take, against sweep 4a's before.

## Failure surfaces not exercised

Samsung WebView rendering, safe-area, native SQLite, real Oura data, and the tab-switch timing
itself — all of it is the S25's. `DV-12` is the pass test: `perf.js longtasks`, every tab tap's
longest task under 50 ms.

## Verification run here

`pnpm lint` 0 errors / 817 warnings (unchanged against the base), `pnpm check:rules` Ran 80 of 80,
`pnpm test` 1086 files / 10164 passed, `pnpm build` clean, `npx tsc --noEmit` clean,
`check-test-typecheck` none above baseline. Two control runs: weakening the comparator to ignore
`source` fails the shading case, and dropping the comparator from `memo` fails the source guard.
