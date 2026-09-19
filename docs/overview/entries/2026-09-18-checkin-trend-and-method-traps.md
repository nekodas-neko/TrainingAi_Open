# Seven weeks of "ok", and two traps that nearly shipped as findings

**Tuning agent · 2026-09-18 · branch `tuning/tn50-checkin-trend` · docs-only**

Following the calibration sweep, the owner asked for whatever was learned to go into the backlog.
Two things did: one finding about him, one about how this agent works.

## TN-50 — the "self-report" is auto-filled from the score it feeds

Chasing why the `checkin` contributor under-delivers (TN-47 measured 6.5% of the score's movement
against a 10% weight), the first read of the stored `energy_level` column looked like a seven-week
slide: no `good` since 2026-07-30, `pumped` never logged, `low` the modal answer over 30 days.

**The owner corrected it before that reached a conclusion:** *"I dont really choose them; I let it
auto select … It should choose neutral by default. This was more a way to tune based on my response.
Not infer."*

He is right, and the code says so plainly. `mood-checkin-sheet.tsx:86` seeds the energy state from
`readinessToEnergy(readiness)` — its own prop comment reads *"Oura readiness score — sets energy
default"* — and `readiness-payload.ts:492` scores **today's** mood into **today's** readiness. The
loop closes inside a single day. Measured over the 62 days carrying both, the saved level is exactly
what the auto-select would have produced on **45 of them, 73%**, against roughly 20–25% by chance.
**So about 10% of the readiness weight is a re-reading of readiness on three days in four.**

`pumped` has never been logged because `readinessToEnergy` has **no branch that returns it** — not
because he never feels good. And `CHECKIN_ENERGY_SCORE.pumped = 100` is the only route to a readiness
of 100, which is why the ceiling is 87 across 65 days.

The 27% he *did* override is the only genuine signal in the column, and it disagrees in both
directions — readiness 37 saved as `good`, readiness 65 saved as `drained`. Exactly the independent
subjective reading the term is for, drowned out on the rest.

**The first draft of this entry drew the wrong conclusion from the same column**, and TN-50 keeps that
visible rather than quietly fixing it: anything else reading `energy_level` as a self-report will make
the same mistake. It also means TN-47's 6.5% figure is not independent and needs re-measuring.

Owner decision recorded: **default to neutral, do not infer.**

## PS-44 — the overnight window has not started, and the strap has never recorded at night

Binned by hour in Brisbane time over the whole of `rr_intervals`: **zero chest-strap samples between
22:00 and 05:00**, ever. Its mass sits 07:00–11:00, peaking at 53,685 samples at 08:00. The last
sample of any kind is 2026-09-15, two days before the decision was recorded. Night one is still owed,
and the entry's own "do not start the clock until the first night is in the table" guard held.

## Method — two traps, one mistake

Both went into the Tuning baton, because a baton carrying only *where I got to* lets the next session
repeat the *how*.

**Replay the shipped function; do not re-derive it in SQL.** Rebuilding the illness-radar z-scores by
hand got four things wrong at once — wrong column, wrong unit, wrong scale, and the same night's
baseline where the code uses the prior night's — and produced a temperature z of −25 that looked like
a live defect. Bundling the real module with esbuild and feeding it stored rows reproduced the
recorded score exactly, first try. A number that matches the stored one proves the replay is
faithful; a hand-rolled query has no such check.

**Bin by hour in the user's timezone, even in a throwaway query.** `rr_intervals.at` is UTC and
Brisbane is +10, so a chest-strap span printed as `00:00 → 02:04` reads as overnight and is actually
midday. That nearly became "the strap window has already started" in a report to the owner. The
repo's timezone rule reads as being about shipped code; it applies just as hard to the query you are
about to draw a conclusion from.

## What was not exercised

Reads of stored production rows in the sandbox. No code changed, no scoring touched, no device, no
UI. Row-scoped to the owner throughout. TN-50 reports what he typed into a check-in sheet; it is not
a mood assessment.
