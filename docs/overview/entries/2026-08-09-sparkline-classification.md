# 2026-08-09 — half the "inline sparklines" were time-axis charts, and converting them would have broken them (Q-154)

**Branch:** `fix/sixth-inline-sparkline` · **Domain:** `app-shell` · docs + classification, no
version bump

## What the entry said, and what the files say

Q-154: six files hand-roll a `<polyline>` mini-chart instead of using
`components/ui/sparkline.tsx`; convert them, `day-sections.tsx` first.

Reading all six first — **three of them are not sparklines.**

`components/ui/sparkline.tsx` projects x by **index**: `step = width / (values.length - 1)`. Three
of the six draw a **time** axis:

| file | x is | consequence of converting |
|---|---|---|
| `health/day-detail/day-sections.tsx` | `minute / 1440` | the overnight trough stops sitting where the night was |
| `activity/exercise-review-sheet.tsx` | `(timestamp - startMs) / durationMs` | every unevenly-sampled HR reading moves |
| `body-battery-card.tsx` | `(t - t0) / span` | same, and it has a 50% guide line and wall-clock end labels |

`day-sections.tsx` **already carried that reason in a comment** — *"a sparkline primitive would
rescale per-render and this needs a stable 0-1440 x-axis"* — written by whoever added it. The
"sixth copy landed anyway" framing read straight past it.

All three are now `EXEMPT` in `scripts/check-sparkline-primitive.js`, the category
`live-hr-chart.tsx` already occupied for exactly this reason. The check's own error text invites
this ("if this genuinely is not a sparkline… add it to EXEMPT with a reason"), so this is the
sanctioned route, not a bypass.

## The three that really are sparklines are blocked on the primitive

`exercise-history-sheet.tsx`, `health-metric-sheet.tsx` and `workout/active-workout-screen.tsx`
are index-projected — genuinely the pattern. Each needs something the primitive does not have:

| need | primitive today |
|---|---|
| value label on the last point | no such prop (2 of the 3 draw one) |
| `strokeWidth` | hardcoded `1.5`; all three draw at `2` |
| emphasized last dot | `showDots` gives every dot r=2.5, full opacity |
| exact min/max scaling | pads by **±0.5** |
| grid lines | none (`exercise-history-sheet` draws three) |

The ±0.5 is the one that matters: on a body-weight series spanning 0.5 kg it halves the visible
amplitude. That is a change to what the chart *says*, not how it looks, so converting without
adding the prop would be a silent regression on a health trend.

## And there is a second primitive

`components/ui/sparkline-chart.tsx` already draws this exact "1RM trend" shape — line, gradient,
last-value label, unit — and `exercise-stats-sheet` and `exercise-summary-screen` use it. It is not
the answer here: it is **chart.js**, `active-workout-screen.tsx` imports no chart.js today, and
CLAUDE.md's own performance rule forbids pulling it into a hot top-level screen.

So the app has two sparkline primitives with overlapping purpose, and neither fits all three
remaining call sites. That is the actual finding, and it wants a decision before any conversion.

## One name collision, fixed

`health-metric-sheet.tsx` defined a **local component also called `Sparkline`**. It never imported
the primitive, so `grep -rn '<Sparkline'` counted its two call sites as uses of the shared one —
which is how a file on the violation list could look like a compliant caller. Renamed
`MetricTrendChart`, with the blocking difference (exact min/max scaling) written above it.

## Verified

- `tsc --noEmit` clean · **430 files / 3429 tests** green · all 15 custom-rule scripts pass ·
  eslint clean on the changed file.
- `check-sparkline-primitive.js` now reports *"3 pre-existing copies to replace on touch, 6
  exempt"*, down from 6 and 3.
- Browser at 412×915: opened the Body Weight metric sheet on `/health` and confirmed
  `MetricTrendChart` still draws — **1 polyline inside the dialog**, value label `82.5 kg`, no page
  errors. It needed 6 seeded readings to appear at all (it returns null under 2 points, and the
  stock seed's weights predate the recent window); the probe rows were deleted afterwards.

## Not done, deliberately

**No conversions.** Adding five props to the primitive and re-scaling three charts is a change to
what those charts show, on two surfaces I cannot reach in the sandbox
(`active-workout-screen` needs a workout in progress; `exercise-history-sheet` needs logged history
for a specific exercise). Q-154 stays open, rewritten with the exact prop list and the
`SparklineChart` conflict, so the next session starts from the map instead of re-deriving it.

CLAUDE.md's own count line said **five** violations and named the three time-axis files among them;
it now says three, points at the script rather than a hand-count, and records that the second
primitive exists.
