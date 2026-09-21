# 2026-09-21 — stress on the heart-rate charts, and a recommendation the owner overruled

**Lane B** · `feat/tn3b-stress-on-hr-chart` · **v1.461.0**

## The entry I recommended striking turned out to be live work

TN-3b's remaining text promised *"overlaying stress on the HR charts"*. I read that as leftover
prose: the 2026-09-10 conversation reshaped the entry and moved the overlay onto the **day timeline**
as TN-35, every buildable claim in TN-3b was discharged, and `hr-day-chart.tsx` drew sleep and
workout bands and no stress. Three earlier sessions had reached the same reading and filed it as a
scope call.

Put to the owner with a recommendation to strike, the answer was **no — he still wants stress on the
HR charts**. Both surfaces, not one.

**The reasoning that produced the wrong recommendation is worth naming: I treated the reshape as
superseding the original ask.** It did not. The reshape added the day-timeline overlay as a second
deliverable; it never withdrew the first. A later decision that expands scope reads identically to
one that replaces it, and nothing in the entry distinguished them. **Asking cost one turn. Striking
it would have deleted a live request and left no trace of what was lost.**

## What shipped

The day's stress series is drawn on `hr-day-chart.tsx` against the same clock as the heart rate.

**A second hidden scale, not a second chart.** The question is *what was my heart doing while this
happened*, which needs one x axis. The stress axis is `display: false` and fixed to [−1,+1]: a tick
reading `−0.4` beside one reading `62 bpm` invites two scales to be compared as if they shared
units, and fitting the axis to the day would stretch a flat ±0.1 day into violent swings.

**The measured series, not "stressed" bands.** Shaded windows would read better on a phone. They
would also require inventing the number that decides what counts as stressed — a calibration, and
calibration belongs to Tuning and the owner, not to the lane drawing the chart. A display threshold
is still a claim about someone's day. The line states the measurement and stops.

**Gaps are `toSegments`', not a second copy.** The runs are re-joined with an explicit `null` so
Chart.js breaks the line. Coverage averages 13.3 of 24 hours and one measured day jumps 06:45 →
13:15 — a joined line would draw a stress level for six hours nobody recorded. That is the same
defect fixed hours earlier on the trend sparklines (TN-53), reached from the other direction: there
a flag spanned the gaps, here the data arrives in runs and had to be kept in them.

**Two surfaces, and one deliberately left out.** `/health/heart-rate` and `hr-day-card.tsx` get the
overlay. **Home's compact widget does not**: its legend is hidden in compact mode, so the line would
be an unexplained second stroke on a glance card, and it would add a GET to Home's first paint. That
is a judgement, not an oversight — revisit if the owner wants it there.

## Two things fixed on the way through

`lib/hooks/use-stress-day.ts` now owns the key, URL and TTL for `stress-day:`. The standalone strip
was swept onto it in the same PR — with the HR chart there were two readers and two copies of the
same three constants, which is what `check-cache-ttl-divergence.js` exists to catch.

`app/health/heart-rate/page.tsx` derived its whole day from `todayInTz(DEFAULT_TZ)`, keying the page
to Brisbane for every user. Fixed here rather than filed, because the feature needs it: placing
buckets in one zone while asking for another zone's date is the exact split that renders a Brisbane
morning as an afternoon.

## Verification

- `components/health/__tests__/hr-stress-overlay.test.ts` — 10 cases: local minute-of-day rather
  than the device's, the real 06:45 → 13:15 hole, a 60-minute tolerance under the 75-minute
  threshold, no leading or trailing null, out-of-order back-fill sorted, level 0 kept as a reading
  rather than a gap.
- `e2e/tn3b-stress-on-hr-chart.spec.ts` — seeds both series and asserts the legend on
  `/health/heart-rate`. **Proven red with the props unwired, and it failed at the stress assertion
  with the chart still rendering** — *"the HR chart did not pick up the day's stress series"*. Where
  it goes red is the point: a control that failed at the chart-exists assertion would have proved
  only that the page was broken.
- Gate: `Ran 75 of 75` Custom Rules · 7825 vitest passed, 0 failed · tsc clean · lint 0 errors ·
  tests-typecheck at baseline (320/90).

**The spec had to seed HR readings as well**, because `seed.sql` records nothing for today and the
chart returns null without them — so the first run asserted the absence of a chart rather than the
presence of an overlay, and said so out loud rather than passing.

## BF-185: answered, and still not mine

The owner also chose **an editable time control** for BF-185, whose engine half shipped the same
night (#1358) and removed the only way to correct a wrong dose time.

**It is still not startable by Lane B, and the blocker is the same field that was wrong the first
time.** The entry says *"the server already honours an explicit `takenAt`"*. That is true of the
repository and false of the route in front of it: `SupplementLogSchema` is `.strict()` with exactly
`amount`, `unit` and `doseText`, so a client sending `takenAt` gets a **400 before the handler
runs**. The control would ship unable to save. The schema and the route are Lane A; the entry now
says so, with the sequencing.

The general lesson, which is not about this entry: *"the server honours X"* is a claim about a
repository method, and what a client talks to is the route's schema. **Read the schema, not the
repository, before believing a UI can send a field.**

## Not exercised

The device look, which is what the entry still owes: an amber stress line over the HR line with
sleep and workout bands behind both, at 412 px on the S25. Four things in one chart is exactly what
a browser cannot judge.

And the **cross-day stress aggregate** — the other pre-reshape promise in TN-3b. The owner was asked
about the HR-chart overlay only and answered that. It is recorded as a `Keep:` with an instruction
not to assume it is wanted.
