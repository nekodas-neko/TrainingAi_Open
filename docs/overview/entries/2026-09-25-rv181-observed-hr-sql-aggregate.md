# 2026-09-25 — RV-181: the observed HR profile is a SQL aggregate, not 90 days of rows

**Branch:** `rv181-observed-hr-sql-aggregate` · **Lane A**

## What this was

`getHrForWindow`'s range select was **565 s of 1,117 s of all database time — 50.6%** over 25.2
days, on 12,591 calls returning 212 M rows. The great majority of that was `resolveHrProfile`: seven
callers, each dragging 90 days of raw heart rate back to read six numbers off it.

It now computes those six numbers in SQL. `repo.getObservedHrProfile(userId, from, to)` returns one
row; `resolveHrProfile` never touches a row again.

## The entry's headline held; its evidence line did not

Re-measured against production before writing anything, because RV-181's whole value is a number:
**565 s, 50.6%, 12,591 calls, 44.84 ms mean, 16,843 rows a call** — unchanged in substance from
sweep 51 three weeks earlier.

But the fix it proposed was sized from a measurement of the wrong thing. Sweep 51's *"the same
statistic as a SQL aggregate at 54 ms"* was a plain aggregate over the raw window, with **no
chest-strap merge**. `preferStrapBuckets` drops a ring row when a strap row shares its 10-second
bucket, and the strap is 78% of the rows — reproducing it is the entire cost of the aggregate.
Measured on production, 2026-09-25:

| | DB time |
|---|---|
| plain aggregate, no merge (what "54 ms" measured) | **67 ms** |
| merge-preserving aggregate, `NOT EXISTS` index probe — shipped | **225–260 ms** |
| …same, hash anti-join | 317–333 ms |
| …same, `bool_or` window function | 394–438 ms |
| the 90-day row fetch it replaces | **~354 ms** (inferred: 2.66 µs a row from the mean) |

All three aggregate formulations returned identical values, which is the cross-check that the merge
semantics were reproduced rather than approximated.

**So the database-time saving is about a third, not the seven-eighths the 54 ms implies**, and the
entry now says so. The rest of the win is real but different in kind: 133,041 rows stop crossing the
wire and stop being materialised in Node on every resolve.

## What shipped

- **`getObservedHrProfile`** (`lib/data/postgres/slices/oura.ts`) — one statement reproducing every
  rule `computeObservedHr` applies: the strap-bucket merge (with the window bounds carried into the
  subquery, because the bucket set is built from rows *inside* the window), the plausibility band,
  `min`/`max` as k-th order statistics **with multiplicity** via `ORDER BY … OFFSET k-1 LIMIT 1`
  (which `percentile_disc` does not give), and the reliability and corroboration gates. The mean
  comes back unrounded and TypeScript rounds it, so the rounding rule stays in one language.
- **`resolveHrProfile`** reads the aggregate. **`resolveHrProfileWithWindow` is deleted** — RV-73
  added it so `/api/cardio-week` could slice its two 30-day windows out of the profile's 90 days,
  and it carried a documented boundary caveat because slicing a merged 90-day set is not quite the
  same as merging each window. With no rows to share, cardio-week queries each window directly and
  the caveat goes with it.
- **`EMPTY_OBSERVED_HR`** in `observed-hr.ts` — one definition of the no-data profile, which
  `computeObservedHr` now returns from its own zero branch and the two degrading call sites reuse.

## Two things the tests caught that reading would not have

1. **cardio-week lost a failure guard.** Its two windows used to come out of the profile's one
   `.catch`ed fetch, so a database fault left the card painting with an empty heart section. Calling
   the aggregate directly reinstated the 500 the *"still paints when the guarded reads fail"* test
   exists to prevent. Both direct calls now degrade to `EMPTY_OBSERVED_HR`.
2. **A mutation survived, and it was my test that was weak.** Removing the window bounds from the
   strap subquery — which would let a strap row outside the window thin a ring row inside it —
   passed. The case I had written put *both* rows past the end, where the ring row was excluded for
   its own sake anyway. Rewritten on the straddling bucket (window ends at 600 s, buckets are ten
   seconds, so 600 is the last row in and 605 the first row out) it kills the mutant.

## Verification

- `observed-hr-sql-equivalence.test.ts` — 14 cases, each running **both** paths over the same rows
  and comparing field for field. Nothing asserts a hand-written expected profile: an expectation
  copied from one side would pass while both sides were wrong together.
- **Mutation pass:** five real mutations (k-th → (k+1)-th, strap subquery loses its window bounds,
  band edge exclusive, corroboration off-by-one, window end exclusive) all killed; two deliberately
  equivalent controls (bucket arithmetic rewritten, reliability gate negated) both survived.
- **`pnpm dev`, logged in, against a 60-day seeded window mixing 17,281 ring rows with 42,912
  chest-strap rows:** `/api/hr-profile`, `/api/cardio-week`, `/api/cardio-trends`,
  `/api/zone-minutes`, `/api/health/hr-recovery-profile` and the SSR of `/baselines`,
  `/activity/guided-walk` and `/cardio` all 200, no errors in the server log. The merge dropped
  **exactly 288** ring rows — the number of 5-minute ring bins inside the one strap-covered day,
  which is the arithmetic being right rather than merely plausible.
- Cross-checked at scale on that window: both paths returned
  `{min:58, max:170, avg:127, sampleCount:59905, outOfBandRejected:0, highestPlausible:170}`.
- Full gate: `tsc` clean, `typecheck:tests` at baseline, lint 0 errors, **1051 test files / 9798
  tests passed**, **Custom Rules 78 of 78**, `pnpm build` green.

**Not exercised:** nothing device-, native-, safe-area- or notification-shaped is touched — this is
a server-side query change reaching the APK through a normal Railway deploy, with no APK needed. The
production timings above are reads against the live database, not a deployed run of this code.

## What is still open on RV-181

The entry stays in the queue with two parts. The **memo** is the one that holds the other two
thirds: the 90-day shape ran ~1,460 times in 25.2 days because a ring drain during a workout
refetches `hr-profile`, and the aggregate does not touch that count. It was not shipped here because
it needs a freshness call rather than a mechanism, and `use-hr-profile.ts` already argues at length
against pinning this key — that argument deserves an answer, not a detour. It should also be
re-measured first: with the row fetch gone, `pg_stat_statements` reports the small-window callers
only, so the saving is measurable instead of modelled. The second part, `/api/health/trends`
re-deriving HRR that `workout_hr_stats.hrr1_best` already stores, needs a per-day agreement check
against production that has not been done.
