# 2026-09-20 — TN-53's render half: the chart was drawing the gaps it was meant to show

**Lane B** · `feat/tn53-sparkline-gaps` · **v1.460.5**

## What the entry asked, and what was actually there

TN-53's engine half shipped earlier the same day (Lane A): `analyseHrRecovery` now returns `null`
unless the two readings behind `hrr1` are 45–75 s apart, so a day that cannot support the
measurement stops reporting one. Its `Keep:` named the follow-on and listed three things the
sparkline might do with a run of nulls — *"whether it interpolates across the gap, collapses the
axis, or renders an empty chart that reads as broken"* — under the heading **a gap that looks like
a bug is not an improvement over a wrong number**.

**It was the first of the three, and that is worse than the framing allowed for.**
`components/health/trend-sparkline.tsx` passed `spanGaps: true`, so Chart.js joined the last value
before the nulls straight to the first one after them and drew the missing days as a smooth,
tensioned line. There was no gap to look like a bug. The engine gate replaced a fabricated number
with an honest absence and the chart put the fabrication straight back — so on the one surface that
shows the trend, the gate changed nothing at all.

## Why this fixed eleven charts and not one

`TrendSparkline` is shared: resting HR, HRV, HR recovery, wear time, session duration, workout
density, protein per kg, steps, water, skin temperature, and the score details all render through
it. Every one of those fields is a daily measurement where `null` means *not measured*, so the
interpolation was making the same claim on all of them. Fixing only `hrr1Bpm` would have meant a
prop, two behaviours in one component, and the identical invention left on ten siblings. The
sibling-surface sweep rule says to do them together, and here it is the literal reading.

## The second defect, which only appears once you stop spanning

A line segment needs two adjacent points, and the chart drew no dot except on the last day. So
`spanGaps: false` on its own makes a reading with nothing either side of it render as **nothing at
all** — a sparse series can vanish while reporting no error. The sparse case is the normal one for
this metric: `ble` sessions carry 7.1 readings per set against the chest strap's 111.8. Hence a dot
on any stranded value, alongside the flag.

## Shape

`components/health/trend-sparkline-gaps.ts` holds the decision as a pure function, following the
repo's own convention for chart geometry (`stress-day.ts`, `sparkline-geometry.ts`) — the vitest
projects are node-only, so a React render test would need a DOM runner that is not configured, and
extracting the dataset fields makes the wiring node-testable instead. `gapDataset` returns
`pointRadius`, `spanGaps` and the coverage note together, with **`spanGaps` typed to the literal
`false`**: it is the flag whose reversion silently reinstates the invented line, and the type stops
that being a one-character edit in the component.

The note is phrased as **"3 days missing"** rather than "11 of 14". Leading nulls are trimmed before
drawing, so the denominator would not match the card's own "— 14 days" label and the reader would
be left working out which number was wrong. The header row also gained `flex-wrap gap-x-2`: the
note is new text in a row that already carries a delta chip, and at 412 px the two together are
close to the edge.

## Verification

- `components/health/__tests__/trend-sparkline-gaps.test.ts` — 15 cases, killed by five mutations:
  always isolate · `||` for `&&` · `!== null` so `undefined` counts as present · `!!v` so a zero
  drop counts as absent · print the note unconditionally.
- `e2e/tn53-sparkline-does-not-span-gaps.spec.ts` — seeds a real hole (an adjacent pair, a stranded
  reading, today) and asserts the note on `/health/heart-rate`, plus that no child overflows the
  header and the page does not scroll sideways. **Proven red against the pre-fix component:** *"the
  sparkline drew the gap without disclosing it"*, received `"Resting Heart Rate — 14 days"`.
- Gate: `Ran 75 of 75` Custom Rules · 7787 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline (320/90).

## The mistake worth keeping

The e2e was written against Postgres's `CURRENT_DATE` and failed at 21:30 UTC reading `4 days
missing` against an expected 3. The route builds its window from `todayInTz`, and after 14:00 UTC
that is already tomorrow in Brisbane — so an offset of 0 seeded the chart's *yesterday* and left the
window's last day empty. This is the exact shape `CLAUDE.md` describes under Q-356: **both sides
derived from a clock, but not the same clock.** Written the other way it would have passed for
fourteen hours a day and failed for ten. The fixture now anchors to the seeded user's own timezone,
read from `users.timezone`.

## Not exercised

The device look, which is the whole of what the entry still owes: a 3 px stranded dot and the
missing-days note at 412 px on the S25. The spec measures that nothing overflows; that is not the
same as it reading well. And the owner's pass test — *"the sparkline shows a gap across the period
the strap was not worn"* — needs production data. The local seed carries no `hrr1` at all, which is
why the e2e drives `rhrBpm` through the identical component path.

## Filing note

TN-53 printed as **UNCLASSIFIED**, not READY, because it carried no `Lane:` field — while its body
named the remaining half as Lane B in bold. Lane B's READY was 0 at the time. That is the same
class as LB-121 (an entry invisible to the lane meant to build it, for a reason that has nothing to
do with whether it is startable), reached by a different route: there a `⛔` used for emphasis, here
a missing field. The entry now carries `Lane: B`.
