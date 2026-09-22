# 2026-09-22 — the rail is where readiness loses its information, and the marker defect reappeared overnight

**Branch:** `tuning/unpark-lb124-and-guard` · **Agent:** Tuning · **Docs-only.**

## The update: a correct catch against yesterday's filing

Lane B took TN-58 off READY and filed **LB-124**, because TN-58 said *"add the comparative field
beside `perceived_recovery`"* and that field exists nowhere — no column, neither Zod schema, not the
route. TN-58 named TN-57 as its engine half; TN-57's own entry says it ships **no migration**. So the
two entries I filed together left the chain unbuildable, and LB-124 says so plainly: *"Read TN-57's
scope rather than TN-58's description of it."* That is the lane system working, and the catch is right.

LB-124 also found something I would have burned two weeks on: `Body` in the check-in route is **not**
`.strict()`, so a sheet posting an unknown `vsYesterday` gets **201 and writes nothing**. TN-58's
pass test would have read "self-report is not available from this owner" when the truth was a dropped
field.

**And LB-124 was itself parked on arrival**, by a prose marker reading *"the failure mode is SILENT,
which is why this is filed rather than attempted"* — an explanation of why it was written up, not a
statement that it cannot start. Lane B's entire READY list went to zero. Unparked here; it is now
Lane A's #2, and the TN-58 chain is alive again.

## TN-60 — the readiness composite's weights are not what it says

Variance decomposition of 69 stored days (2026-07-16 → 2026-09-22), weighted sd of each contributor's
score as a share of all movement in the final number:

| contributor | declared | sd | share of movement |
|---|---:|---:|---:|
| **hrvBalance** | 0.15 | **35.8** | **22.8%** |
| previousNight | 0.16 | 23.6 | 16.0% |
| restingHeartRate | 0.15 | 24.7 | 15.7% |
| sleepBalance | 0.10 | 32.6 | 13.8% |
| recoveryIndex | 0.09 | 28.0 | 10.7% |
| temperature | 0.10 | 16.6 | 7.0% |
| checkin | 0.10 | 15.2 | 6.5% |
| prevDayActivity | 0.09 | 12.1 | 4.6% |
| activityBalance | 0.06 | 11.1 | 2.8% |

`hrvBalance` carries half again the influence its weight says; `activityBalance` half of its. Nobody
chose that distribution — it falls out of the contributors being measured on rulers of different widths.

**The mechanism is the rail.** `Z_POINTS_PER_UNIT = 50/1.5` floors and ceilings the score at z = ±1.5.
`hrvBalance` is railed on **26 of 69 days (38%)** — and the z values landing on score **0** span
**−1.63 to −4.37**. A 2.7σ spread renders as one number. On more than a third of days the biggest
contributor to readiness says "as bad as possible" and cannot say which kind of bad.

Recommendation is a compressive tail rather than a hard clip: the linear middle is unchanged, extreme
days keep their ordering, and nothing needs re-fitting. Filed `Gate: owner` because it re-scores
history.

## Two things I checked before believing them

**`recoveryIndex` is `provisional: true` on 69 of 69 days** — which looked like a contributor the app
itself flags as unsettled while scoring it at 9%. It is not a defect: `provisional` there means *the
curve is an approximation*, deliberate and documented, and Q-278 exists because that sense used to be
conflated with "input missing". Dropped before filing.

**`checkin` scores 50 on 19 days with `gap: null`** — which looked like the neutral colliding with a
real `low` reading. It does collide numerically, but the `gap` field separates them correctly (only 2
days are true `no_input`). No defect; the field does its job.

## TN-59 — the marker defect needs a check, because the sweep did not hold

Two days ago a sweep converted 17 prose markers by hand and took READY from 6 to 21. Today: **28
entries still parked by a prose marker alone**, and LB-124 filed and parked within hours. Filed for
Lane O: fail when an entry's only block is a prose marker, baseline the 28 shrink-only.

Its own drafting hit the trap twice, both recorded in the entry because they are the argument for it:
writing the marker character inside backticks parked the entry describing it, and using the
`Reference:` field for background reading filed it under *read, do not build*. **Third field-semantics
slip of the day in my own filings** — TN-56 had the same `Reference:` mistake yesterday. The pattern
is mine, not the tool's, and it is why the check is worth more than another sweep.

## Not exercised

Nothing runs; documentation and queue ordering. The decomposition is read-only over
`oura_daily_derived`, **row-scoped to the owner**, correct here since the claim is about his composite.
**Not established:** whether the rail's cost shows up in any decision the app makes — a railed
contributor loses resolution, but whether that changes a recommendation is unmeasured, and TN-60's
pass test deliberately asks only about the score's own distribution. `pnpm check:rules` **Ran 75 of
75**, all passed.
