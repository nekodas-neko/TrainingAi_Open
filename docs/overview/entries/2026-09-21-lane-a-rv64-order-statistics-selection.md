# RV-64 — the fix was in the reduction, not in SQL, and the entry's own unread function is why

**Branch:** `lane-a/rv64-order-statistics-selection` · **Lane A** · no migration, no native change.

`computeObservedHr` needs three numbers — the k-th highest bpm, the k-th lowest, and the mean — and
got the first two by sorting the *entire* series descending. It now keeps two k-element windows in
one pass. **60.8 ms → 30.4 ms on the owner's 130,580-row window, identical output.**

That is not the fix RV-64 asked for. The entry asked for the reduction to move into SQL, and that
turns out to be wrong twice over.

## The entry's fix computes a different answer

RV-64 proposed *"a repo method returning the order statistics directly — `ORDER BY bpm DESC LIMIT k`
and its mirror"*, citing an aggregate that answered in 54 ms against the 130k-row pull.

But `getHrForWindow` does not return the rows it selects. It returns `preferStrapBuckets(rows)`,
which drops every ring row in a 10-second bucket the chest strap already covers. **The entry flagged
that function as unread** — *"`preferStrapBuckets` was not read, so its own per-row cost is
unquantified"* — and it is precisely the thing that makes the proposed aggregate unsafe. Measured
against production over the owner's 90 days:

- **1,350 of 130,580 rows** are dropped by the merge.
- The naive aggregate's **k-th lowest is 36**; the current code's is **37**.
- The k-th highest agreed at **175** — which is luck, not structure. Those 1,350 rows fall during
  strap-worn periods, i.e. workouts, which is exactly where the top of the distribution lives.

So a correct aggregate has to reproduce the bucket merge in SQL.

## And a merge-correct aggregate is not faster

Three formulations, all returning the right answer (k-th low 37), timed against production:

| formulation | production |
|---|---|
| raw scan + sort, rows discarded server-side | 20–55 ms |
| merged set, join + DISTINCT | 313–396 ms |
| merged set, window functions | 460–600 ms |
| merged set, NOT EXISTS | 623–790 ms |

**I got the conclusion wrong once on the way here and it is worth recording why.** Comparing 313–600
against 20–55 says the aggregate is a 6–20× regression. It is not, because the 20–55 ms is only the
server's share: it omits the pg driver building 130,580 row objects. Measured apples-to-apples on one
machine, same data, same pool:

| path | total |
|---|---|
| full pull + driver materialisation | **197.9 ms** |
| …plus the old JS reduction | ~260 ms |
| merge-correct SQL aggregate, one row back | **266.2 ms** |
| …plus this PR's reduction | **~228 ms** |

The aggregate is a **wash**, not a win and not a regression. The pull's real cost is row
materialisation in the driver, and no SQL rewrite removes it — which is why the useful change was
the 30 ms sitting in the reduction, not the 130k rows.

## What shipped, and what deliberately did not

**Shipped:** two k-element windows replacing the full descending sort inside `computeObservedHr`.
`topK` holds the k largest ascending (so `topK[0]` is the k-th highest, `topK[k-1]` the highest),
`bottomK` the k smallest descending. Pure function, no API change, no call site touched.

**Deliberately not shipped:** `preferStrapBuckets` ends with a `.sort()` by timestamp that
`resolveHrProfile` never uses — it maps straight to bpm. Dropping it too is **30.4 → 26.9 ms**, worth
3.5 ms, and it would mean a second variant of a shared helper whose other callers (`computeDayZoneSeconds`,
the live chart) genuinely need time order. Not worth the API surface; the number is recorded so the
next reader does not have to re-measure to decide that.

## RV-64 is re-laned, and RV-73's batch is dissolved

The reduction was never the order of magnitude. `live-hr-chart.tsx:46` fetches `hr-profile` in a
mount-once effect and `active-workout-screen.tsx:520` mounts it as
`{workoutPhase === "rest" && …}`, so it **remounts once per rest period** — ~20 times in a 5×4
workout, against the same 10-connection pool as `log-exercise`. Fixing the reduction took 30 ms off a
260 ms call; fixing the remount takes 19 calls off 20. That half is `components/**`, so **RV-64 is
re-laned to B** and stays queued with the remount as its `Keep:`.

**RV-73's `Batch: hr-window-aggregate` and `Needs: RV-64` are both removed.** Both rested on RV-64
moving the reduction into SQL — *"the same fix on the same helper"* — and that fix does not exist. Its
own fix (slice the two contained 30-day windows out of the 90-day pull that already happened) is
independent, still valid, and still Lane A's.

## Verification

- **5 new tests**, the load-bearing one being a **200-trial randomised equivalence check** against
  the old full-sort implementation, kept in the file as the oracle. Plus the adversarial shapes
  random data never produces: a monotonically rising series (every reading displaces the window), a
  falling series, an all-equal series, and a series shorter than the corroboration count.
- **Mutation pass — four mutations, one control.** max = highest rather than k-th highest → 7 failed;
  min = lowest → 5 failed; `highestPlausible` = k-th rather than top → 7 failed; window one element
  too small → 7 failed. The deliberately equivalent control (`>=` for `>` on the insertion test,
  where a tie replaces an equal value) → **28 passed**.
- The existing `observed-hr`, `hr-profile` and `hr-window-merge` suites pass unchanged.
- Full suite, `check:rules` and `check-test-typecheck` below.

## Not exercised

- **No device check and no route run.** The route could not be authenticated against in production —
  the same gap the entry recorded — so its end-to-end wall time is still inferred from component
  timings rather than measured on the wire.
- **The 197.9 ms and 266.2 ms figures are from local Postgres**, seeded with 130,580 rows matching
  production's shape (97,901 strap / 32,679 ring). The production figures in the first table are real
  production timings. The two tables should not be read against each other.
- **Production was read, not written**, and `claude_ro` is row-scoped to the owner — the 1,350 dropped
  rows are the owner's, not a claim about every account.
