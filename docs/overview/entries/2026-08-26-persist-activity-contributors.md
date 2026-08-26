# 2026-08-26 — The Activity score stores its own breakdown (Q-526)

**Lane A · branch `fix/persist-activity-contributors`**

## What was wrong

`oura_daily_derived.activity_contributors` held `{base, adjustment, trained}` — the *blend wrapper*
that folds an Oura Cloud activity score into ours — and not one of the six component sub-scores
`computeActivityScore` produces. The components were already in memory on the same request; the route
even serves them to the client as `activityContributors`. They were simply never written.

Activity was the only score with the gap. Sleep stores 10 real sub-scores, readiness stores its
contributors (and since Q-501, each contributor's own input), illness stores all four biomarker
z-scores on every scored row.

**The cost is a measurement that cannot be made afterwards.** Rebuilding a past day's contributors
means recomputing from raw inputs at *today's* goals — and `strengthFreqGoal` went 3 → 5 and the
volume target changed basis on 2026-08-11. So *"what did `strengthFreq` score on 2026-08-02?"* has no
answer, and the 2026-08-19 contributor audit had to report a *predicted* sd ceiling instead of the
real historical spread.

## Premise re-verified, and it got sharper

Measured against production before building:

| | |
|---|---|
| derived rows | 100 |
| rows with an activity score | **30** (the entry said 23) |
| rows carrying any component key | **0** |
| rows where `adjustment` is 0 | **30 of 30** |
| rows where `base` equals `activity_score` | **30 of 30** |

So the column was not merely storing the wrong thing — **it was storing the score twice and a
constant zero.** The blend only ever adjusts an Oura *Cloud* activity score, and no such row has
existed since the BLE re-key (the 30 rows span 2026-07-28 → 08-26, all post-re-key). The entry's
caveat that the wrapper "is real information — it is how a Cloud-era adjustment is distinguished from
our own base" is right in principle and describes no row that exists.

The wrapper is kept anyway: the entry asks for a merge rather than a replacement, `trained` is the one
bit the components cannot re-derive, and keeping it costs nothing.

## What shipped

One object at the existing persist site in `lib/health/readiness-payload.ts`:

- the six component sub-scores, spread in — **absent contributors stay absent**, because weights
  renormalise over whichever lanes ran and a stored zero would read as "scored nothing";
- **`preTaper`** — what the components reproduce under the model's weights;
- **`acwr`** — the over-exertion taper's only input;
- `base` / `adjustment` / `trained`, unchanged.

`preTaper` and `acwr` are what turn an itemisation into a re-derivation: the components reproduce
`preTaper`, and `score = round(preTaper × (1 − taper(acwr)))` closes the loop from the row alone.

**No score moves** and there is no migration — the column is JSONB and the write already existed.

## Verification

`pnpm check:rules` **Ran 59 of 59**; `tsc --noEmit` clean; full suite green.

Six mutations, each with an asserted anchor. **One survived the first pass**: dropping `acwr` changed
nothing, because every fixture had a null ACWR — the route only resolves it for a program older than
28 days, and the harness returned no program. That is precisely the untested half, since the taper is
the only thing standing between `preTaper` and the stored score, and it bites on the overreaching days
most worth auditing later. A fixture with a light month, a heavy last week and a 60-day-old program
pushes ACWR past the threshold; the mutation dies there.

**Not exercised:** nothing on-device (this is a server write path), and the pre-2026-08-26 rows, which
are addressed below rather than fixed.

## What this does not do

**It is forward-only.** Every row before today still holds `{base, adjustment, trained}`, and those
days cannot be recovered — that is the same loss the entry describes, now bounded rather than
growing. Q-505 (the Activity redesign) carried a `⛔ Do Q-526 FIRST` constraint so the old model's
contributor history would exist for a before/after comparison; that constraint is satisfied **from
today**, and the comparison window starts here. Which inverts its urgency: the longer Q-505 waits, the
better that window gets.
