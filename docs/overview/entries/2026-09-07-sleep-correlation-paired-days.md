# 2026-09-07 — "233 paired days" was 48 days (PS-29)

**Branch:** `fix/sleep-correlation-paired-days` · **Lane A**

## The defect

`/api/sleep-performance-correlation` pushed one correlation point per **exercise**, inside
`for (const ex of ws.exercises)`, with one sleep value per day. Every point from a given day carried
the **same x**, so they were not independent observations of anything — the textbook shape of
pseudoreplication, and it inflates in the direction that manufactures significance.

**Measured on the owner's real 90 days:** 233 points as exercises, **48** as days. So the screen has
been rendering *"233 paired days"* for 48, and computing its p-value at n = 233. `correlationInsight`
words every one of its outputs as "paired days" on the assumption that callers hand it days.

**The bucket gate was inflated the same way**, which the entry did not mention. `bucketize` counts
points, so a single day of five lifts satisfied the per-bucket `minCount` floor on its own — the
floor that was raised 3 → 5 on 2026-08-05 with the reason *"three observations in a bucket cannot
support a claim about someone's body"*.

## What shipped

One point per **day**, y = the mean of that day's per-session mean % deviation from baseline.

Two helpers move to `packages/shared/src/health/correlation.ts`, beside the function whose contract
they serve: `buildExercise1rmBaseline` (which was byte-identical in `health-trends` and inline here)
and `sessionMean1RmPct` (which existed only in `health-trends` — its absence here *is* the defect).
`health-trends` now imports both instead of declaring them.

**Aggregated by day rather than by session, and that is a deliberate difference from the siblings.**
The eight bucketed views in `/api/health-trends` aggregate per session, correctly: their x is a
per-session quantity (rest adherence, session RPE), so two sessions are two observations. Here x is
one night's sleep, identical for every session that follows it, so the day is the unit. On the
owner's data the two are indistinguishable — **48 sessions across 48 days**, he never trains twice in
a day in this window — so the choice is reasoned rather than measured.

## Verification

- **Mutation-tested three ways.** Summing instead of averaging, treating a missing baseline as zero
  deviation, and dropping the 3-session baseline floor each fail.
- **The first mutation initially survived.** My "averages the lifts" case used +10% and −10%, which
  sum *and* average to zero — it could not tell a mean from a sum. Replaced with an asymmetric pair
  (+10%/+20% → 15, not 30) plus a case asserting the value does not grow with the lift count.
- Full suite **6717 passed | 86 skipped**; `tsc` clean; Custom Rules 68 of 68.

## Not exercised

No `pnpm dev` call and no device check. The route needs paired sleep and workout history the seeded
dev user does not have, so the change is covered at the helper level — where the defect lives and
where the mutations bite — rather than through the running endpoint. The **numbers the screen now
shows have not been seen by a human**: on production data n should fall from 233 to 48, which is
still above the `DEFAULT_MIN_N = 20` floor, so the insight should keep rendering with a corrected
count and a p-value computed at the honest n. If it instead starts reporting "no reliable
relationship", that is the fix working, not a regression — the previous significance was partly an
artefact of the inflated n.
