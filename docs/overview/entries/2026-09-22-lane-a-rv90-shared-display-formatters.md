# 2026-09-22 — one weigh-in, four spellings: a shared formatter for kg, minutes, h/m and pace

**Branch:** `lane-a/rv90-shared-display-formatters` · **Agent:** Implementation (Lane A) · **Code + docs.**

RV-90 said body weight renders five ways across seven sites with no shared formatter. The helper now
exists — `packages/shared/src/format/units.ts` — and the call sites route through it. Two things the
entry did not know turned up on the way, and one of them is a real bug that shipped in every pace
formatter in the tree.

## What the entry got right, and where its count does not match the tree

The premise holds: rounding and unit spacing were each decided per site, so the same stored value
printed differently on adjacent surfaces. For a weigh-in of **82.45**, the home card and Health › Body
read `82.45 kg`, the day detail `82.5 kg`, the week-day sheet `82.45kg` — raw **and** no space — and
the stats grid `82kg`.

**The "seven sites / five ways" count does not match the tree, and the difference matters for how
much this was worth doing.** What is actually there is **three** body-weight renders that genuinely
disagreed, plus six already sitting on `.toFixed(1)` and agreeing with each other. So this was mostly
latent drift — four of the sites would only diverge once a value with more than 1dp of precision
arrived from Health Connect or a hand-log — with three live disagreements on top. The entry's own
"Not established" bullet said as much about the scale's resolution; the site count overstated it.

## The bug my own tests found, which is not the one I was sent for

`formatPaceValue(359.6)` returned **`5:60`**.

Every pace formatter in the tree splits into minutes and seconds first and rounds the seconds after,
so anything in `[5:59.5, 6:00)` rounds 59.6 up to 60 and prints it in the seconds slot. It was in the
shared `formatPace` in `vdot.ts` and in all three hand-rolled copies, which is why routing them
through one helper did not fix it by itself. The helper rounds the **total** before splitting:

```ts
const total = Math.round(secPerKm)
return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
```

Pinned over `[59.5, 59.9, 119.6, 359.5, 359.99, 3599.7]`.

Second one, same pass: `formatKg(1.005, { decimals: 2 })` gave `1.00`. `toFixed` inherits the binary
representation of the multiply, and **`toPrecision(15)` does not help** — I tried it, because the
usual advice says it does; the artefact is already in the product, not in the printing. Exponential
shift (`Number(\`${x}e${d}\`)` → round → shift back) is what works.

## What routed where

- **kg** — `formatKg` through home-card-widget, week-day-sheet, day-sections (with `{ unit: false }`,
  because that surface renders value and unit as separate elements), scale-pairing ×3,
  capacitor-native-init ×3.
- **minutes** — `done-activity-screen.tsx:329`'s `.toFixed(1)` → `formatMinutes(…, { unit: false })`,
  which is the 42.4-then-42 disagreement the entry filed alongside.
- **pace** — two local `formatPace` copies deleted, three inline hand-rolls routed, `formatPaceValue`
  added for the sites that render their own `/km`.
- **h/m** — four of five converted to `formatHoursMinutes`.

**The fifth h/m is a deliberate exception, documented in the file it stays in.**
`components/health/hypnogram.tsx` keeps its own, because the shared helper pads (`2h 00m`) — right in
the `tabular-nums` columns the other four sit in, wrong on a chart stage label where an exact two
hours reads better as `2h`, and stages round to the minute so the zero case is common. The
consistency rule exists to stop the *same* quantity rendering two ways on adjacent cards; this
quantity appears on no card that uses the helper.

## Verification — and the half that was not achieved

- 17 new unit tests; **4 mutations caught, 1 deliberately-equivalent control** (whitespace inside a
  format string, correctly not caught).
- `pnpm check:rules` — **Ran 75 of 75**. `check-test-typecheck` — nothing above baseline.
- Full suite — **9,401 tests green**.

**The rendered output was not observed.** The e2e seed user has no weight data, so a probe spec
returned `KG_RENDERS: []` and the kg path was never painted in a browser during this work. The
formatter is unit-tested and the call sites typecheck; what is untested is that each site passes the
value I think it passes. Not device-verified either — no safe-area, native-SQLite or Samsung-WebView
surface was exercised, though none of these changes touch one.
