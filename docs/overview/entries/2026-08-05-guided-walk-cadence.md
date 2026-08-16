# 2026-08-05 — Q-84: cadence was measured, saved, and dropped one step before the screen

**Domain:** cardio — v1.265.0, JS-only (no `android/**`, no migration, no new capture)

Owner report: the guided-walk "Walk complete" screen shows pace for the FAST/SLOW blocks but no
cadence, and for interval walking step rate is the more useful read on effort than a GPS pace
measured over a 1–3 minute block.

## Where it was actually lost

Nothing needed to be captured. Cadence is live on the walk screen (`CadenceReadout`), computed per
interval (`computeWalkSegmentStats` → `avgCadenceSpm`), and persisted
(`activity_logs.cadence_spm*`, migration 140). It fell out in exactly one place:
`aggregateSegmentsByKind` built `KindAggregate` from HR, pace and distance and read past the
`avgCadenceSpm` sitting on each segment. From there three render sites had nothing to show.

## Cadence leads, and falls back

The plan left the visual hierarchy as an implementation-time call. Cadence takes the headline **when
there is one**, and pace takes it otherwise — so a walk with no strap reads exactly as it did before
rather than leading with a dash. The unit disambiguates which is showing (`118 spm` vs `7:00/km`),
and whichever did not lead stays on the secondary row, so nothing is removed from any screen.

That choice is one function, `walkEffortDisplay()`, not three copies. Three surfaces render this
pair — the summary's fast/slow cards, its per-interval rows, and the walk-config history card — and
"which one leads" drifting between them is the display-format case CLAUDE.md's sibling-surface rule
names directly. Four tests cover it, including the treadmill case (cadence but no GPS pace).

## Two things caught while writing it

**A duplicate formatter, avoided.** I wrote `formatPaceSecPerKm` before checking; `formatPace` in
`@trainingai/shared/health/vdot` already produces byte-identical output. Deleted, and the shared one
imported.

**The historical-rows path.** `/api/guided-walk/segment-stats` flattens `segments` JSON from up to
three years of `activity_logs`. Rows written before cadence existed have no `avgCadenceSpm` key at
all, which reads as `undefined` — the `!= null` filter already handles it, and the aggregate simply
has no cadence for those walks rather than averaging a zero in.

## Verification

Full suite **400 files / 3,163 tests green**, 6 new.

Exercised against `pnpm dev` through the real route, not just unit tests: two walks seeded into
`activity_logs` — one with per-segment cadence, one GPS-only — and `/api/guided-walk/segment-stats`
returns

```
fast: avgHr 132.7, avgPace 430, avgCadenceSpm 119.7, count 3
slow: avgHr 102,   avgPace 695, avgCadenceSpm  96.2, count 2
```

`119.7` is the mean of the two cadence-bearing fast segments (118.4, 121.0) while `avgHr 132.7`
averages all three — the mixed case working exactly as intended: the null-cadence segment
contributes its heart rate and nothing to cadence. The `/activity/guided-walk` page renders 200 with
no server error. Seeded rows deleted afterwards.

**Not exercised: the rendered pixels.** The three card components are client-only and this repo has
no component-render test setup (jsdom is present, React Testing Library is not; adding it for a
formatting change was disproportionate). The *decision* those components make is now a pure function
with tests; what is unobserved is the layout — specifically whether the extra token on the
`KindColumn` secondary line wraps at the S25 width. It is a `<p>`, so it wraps rather than
overflowing, but that is reasoning, not observation.

Also not exercised: a real Polar H10 walk. Cadence only has a value with the strap connected
(`RING_CADENCE_VALIDATED = false` — ring cadence stays gated off), so on-device confirmation needs
an actual interval walk wearing it.
