# Seven weeks of "ok", and two traps that nearly shipped as findings

**Tuning agent · 2026-09-18 · branch `tuning/tn50-checkin-trend` · docs-only**

Following the calibration sweep, the owner asked for whatever was learned to go into the backlog.
Two things did: one finding about him, one about how this agent works.

## TN-50 — the subjective signal has been sliding for seven weeks, unremarked

Chasing why the `checkin` contributor under-delivers (TN-47 measured it supplying 6.5% of the score's
movement against a 10% weight), the cause turned out to be the data rather than the mapping.

`pumped` has **never** been logged in the app's history. `good` has not been logged since
**2026-07-30**. Over the last 30 days: `low` 13, `ok` 11, `drained` 4 — and `low` is now the modal
answer.

The UI is not the constraint; `mood-checkin-sheet.tsx` offers Pumped ⚡ and renders it in three
surfaces. It has simply never been chosen.

Two consequences. Readiness cannot reach 100, because `pumped` → 100 is the only path to it and the
observed ceiling is 87 across 65 days. More usefully: a seven-week slide in **the one signal the
owner reports himself** is invisible, because the contributor consumes today's value and nothing
reads the series. It corroborates the objective picture — HRV 62 → 19 ms, resting HR +13 — from a
completely independent source.

The entry carries a guard against the obvious "fix": re-mapping the energy scale so 100 is reachable
would compress an honestly-used scale and hide the finding.

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
