# 2026-09-13 — the stored stress buckets get a read path, and a second metric turns up (LB-102)

**Branch:** `lane-a/lb102-stress-day-read` · one new API route, one test file, docs. No product code
renders it yet; no user-visible change, no version bump.

## What was wrong

`/api/body-battery` takes no parameters — `export async function GET()` — and computes its stress
series live from today's ring dHRV. TN-3a's `oura_daytime_stress_buckets` has persisted 30-minute
buckets since **2026-08-24** and **nothing published them**, so a past day was unreachable from any
surface.

That blocked TN-3b's owner-approved pass test: *"open a past day, read a stressed window off the axis,
and say whether it matches what you were doing"* — his recall being the ground truth, since TN-33
found no independent target with variance (`perceived_recovery` reads 3 on all 17 days). Today-only
answers half the question he approved.

`GET /api/body-battery/stress-day?date=YYYY-MM-DD` now serves the stored buckets for a day.

## The entry proposed `?date=` on the existing route; the code said otherwise

Two reasons, and the second is the one worth carrying.

**The battery response is a live model anchored to `now`** — the HR walk, the reserve, the label —
and none of it can be computed for a finished day. A parameter that changes a response's *shape* is
one endpoint behaving as two. Hence a sibling route, which the entry explicitly allowed for.

**And the two series are not the same number.** The rollup builds the persisted buckets from
`latest.rhrLowBpm` + `nightHrvMs`; the live route builds its own from `restingHr` + a 28-day HRV mean.
TN-3a chose to store only the rollup's, and said why in `run.ts`:

> *"Writing from one place also settles the two-baselines hazard … persisting both would put two
> numbers behind one metric. The rollup wins because it is the only one that can reach history."*

**So a chart reading today live and a past day from storage would put two metrics on one axis** — and
the owner's pass test is a comparison *across days*, exactly the dimension two baselines destroy. The
route therefore serves **every** day from storage, today included, rather than special-casing today.
One chart, one baseline, days that are comparable with each other.

The cost is real and is reported rather than hidden: today's stored series ends at the last rollup
rather than at this minute, so the response carries `throughMs` and a surface can say where the day's
data stops instead of implying the day stopped. **Which source TN-3b's chart should read for today is
Lane B's call and is filed as LA-104**, with the instruction not to answer it by persisting the live
series — that is the thing TN-3a rejected.

## Verified

- Eight database-backed tests. **Mutation pass: five mutants, all killed** — the day window built in
  the server's timezone instead of the user's, a dash-only date guard (which would reject everything
  `localDateString()` emits), ignoring `?date=` altogether (the original defect), `throughMs` pinned
  null, and the auth check removed.
- **One deliberately equivalent control, and the honest version of what happened:** widening the
  window's end from `23:59:59` to `23:59:59.999` was first reported KILLED by a harness running the
  mutants back to back, then **survived** on an isolated re-run. The isolated run is the authoritative
  one; the back-to-back harness most likely carried fixture state from the preceding auth mutant,
  which is the trap CLAUDE.md already records about interrupted local runs. Worth knowing: a control
  that "dies" may be indicting the harness rather than the test.

**Not exercised:** no device, nothing renders this yet, and production's 478 stored rows were not read
— the local database has none, so the tests seed their own.

## Worth carrying

**Data that persists with no read path is invisible to every surface and to CI both.** LB-98 cost a
card its verifiability; this cost an approved feature its pass test. Same shape, two days apart — and
in both cases the write had been correct and shipping for weeks.
